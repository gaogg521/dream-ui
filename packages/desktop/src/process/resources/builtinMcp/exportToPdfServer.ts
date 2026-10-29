/**
 * Copyright 2026 One Work
 */

/**
 * Built-in MCP server: export_to_pdf tool.
 *
 * Spawned by the MCP client (e.g. the dream agent) as a stdio MCP server.
 * Forwards tool calls to the main-process TCP server (exportPdfMcpServer)
 * which owns BrowserWindow/printToPDF + Office COM/soffice logic.
 *
 * TCP protocol: 4-byte big-endian length header + UTF-8 JSON body.
 * Port comes from EXPORT_PDF_MCP_PORT env var.
 *
 * The same script also serves `one-html-render` (EXPORT_MCP_TOOLS=image):
 * one tool, `render_html_to_image`, backed by the same main-process server.
 * It is registered as its own MCP server because the agent backend decides
 * per server name which built-ins every conversation receives, and HTML → PNG
 * is meant to be always available while the PDF exporter is not.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as net from 'node:net';
import { BUILTIN_EXPORT_PDF_NAME, BUILTIN_HTML_RENDER_NAME } from './constants';

const PORT = parseInt(process.env.EXPORT_PDF_MCP_PORT || '0', 10);
if (!PORT) {
  process.stderr.write('[export-pdf-mcp] EXPORT_PDF_MCP_PORT environment variable is required\n');
  process.exit(1);
}
const IMAGE_ONLY = process.env.EXPORT_MCP_TOOLS === 'image';

function sendTcpRequest(port: number, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      const json = JSON.stringify(data);
      const body = Buffer.from(json, 'utf-8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    });

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
    });
    socket.on('end', () => {
      if (buffer.length < 4) {
        reject(new Error('Incomplete TCP response'));
        return;
      }
      const bodyLen = buffer.readUInt32BE(0);
      if (buffer.length < 4 + bodyLen) {
        reject(new Error('Incomplete TCP response body'));
        return;
      }
      const jsonStr = buffer.subarray(4, 4 + bodyLen).toString('utf-8');
      try {
        resolve(JSON.parse(jsonStr));
      } catch (err) {
        reject(new Error(`Failed to parse TCP response: ${(err as Error).message}`));
      }
    });
    socket.on('error', (err: Error) => {
      reject(new Error(`TCP connection error: ${err.message}`));
    });
    // PDF conversion can take a while (COM startup, large docs) — 3 min ceiling
    socket.setTimeout(180_000);
    socket.on('timeout', () => {
      socket.destroy(new Error('TCP request timeout'));
    });
  });
}

async function main() {
  const server = new McpServer({
    name: IMAGE_ONLY ? BUILTIN_HTML_RENDER_NAME : BUILTIN_EXPORT_PDF_NAME,
    version: '1.0.0',
  });

  if (IMAGE_ONLY) {
    registerImageTool(server);
  } else {
    registerPdfTool(server);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[export-pdf-mcp] stdio server ready (${IMAGE_ONLY ? 'image' : 'pdf'}), forwarding to 127.0.0.1:${PORT}\n`
  );
}

type ToolResponse = {
  success?: boolean;
  file_path?: string;
  error?: string;
  page_count?: number;
  size_bytes?: number;
  image_width?: number;
  image_height?: number;
};

function registerImageTool(server: McpServer): void {
  server.tool(
    'render_html_to_image',
    `Render an HTML page to a PNG image with the app's built-in Chromium. ` +
      `Use it to deliver posters, 小报/手抄报, calendars, infographics, menus, invitations, certificates, ` +
      `timetables and any other picture whose text, numbers or dates must be exactly right: lay the picture out ` +
      `as HTML/CSS first (text stays editable and correct), then call this tool to produce the PNG. ` +
      `Prefer source_type="html_file" so relative image paths next to the HTML file resolve. ` +
      `The whole page is captured unless a CSS selector is given. Returns the PNG path. ` +
      `For calendars, 小报, posters and similar pictures, load the "html-visual" skill first (Skill tool): ` +
      `it holds the verified calendar/lunar data script and the working order.`,
    {
      source: z
        .string()
        .describe('For source_type="html_file" an absolute path to a .html file; for "html" the raw HTML markup.'),
      source_type: z.enum(['html', 'html_file']).describe('"html_file" (preferred) or "html".'),
      output_path: z.string().describe('Absolute path of the PNG to write. Must end with .png. Overwrites if exists.'),
      width: z
        .number()
        .optional()
        .describe('Viewport width in CSS pixels (default 1080). Set it to the design width of the page.'),
      scale: z.number().optional().describe('Device pixel ratio, 1-3 (default 2, print-sharp).'),
      selector: z
        .string()
        .optional()
        .describe('CSS selector of the element to capture, e.g. "#poster". Omit to capture the full page.'),
    },
    async ({ source, source_type, output_path, width, scale, selector }) => {
      try {
        const response = (await sendTcpRequest(PORT, {
          kind: 'image',
          source,
          source_type,
          output_path,
          width,
          scale,
          selector,
        })) as ToolResponse;
        if (response?.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `PNG rendered to: ${response.file_path ?? output_path}\nVerified output: ${JSON.stringify({ size_bytes: response.size_bytes, width: response.image_width, height: response.image_height })}`,
              },
            ],
          };
        }
        return {
          content: [{ type: 'text' as const, text: `Failed to render PNG: ${response?.error ?? 'unknown error'}` }],
          isError: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Render tool error: ${msg}` }], isError: true };
      }
    }
  );
}

function registerPdfTool(server: McpServer): void {
  server.tool(
    'export_to_pdf',
    `Export content to a PDF file using the app's built-in converter. ` +
      `Supports three input types: (1) raw HTML string, (2) an HTML file path, (3) an Office file path (.docx/.xlsx/.pptx). ` +
      `Office files are converted via MS Office COM (Windows) or LibreOffice (mac/Linux) for vector-quality output; ` +
      `falls back to officecli HTML rendering if neither is installed. ` +
      `ALWAYS prefer this tool over installing Puppeteer or other PDF libraries — it produces higher-quality output and needs no extra dependencies. ` +
      `The output_path must be absolute. Returns { success, file_path?, error? }.`,
    {
      source: z
        .string()
        .describe(
          'The content to convert. For source_type="html" this is raw HTML markup; for "html_file" and "office_file" this is an absolute file path.'
        ),
      source_type: z
        .enum(['html', 'html_file', 'office_file'])
        .describe(
          '"html" = raw HTML string; "html_file" = path to a .html file; "office_file" = path to a .docx/.xlsx/.pptx file.'
        ),
      output_path: z
        .string()
        .describe('Absolute path where the PDF will be written. Must end with .pdf. Overwrites if exists.'),
    },
    async ({ source, source_type, output_path }) => {
      try {
        const response = (await sendTcpRequest(PORT, {
          source,
          source_type,
          output_path,
        })) as ToolResponse;

        if (response?.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `PDF exported successfully to: ${response.file_path ?? output_path}\nVerified output: ${JSON.stringify({ page_count: response.page_count, size_bytes: response.size_bytes })}. Compare page_count with the requested page limit; reflow the source and export again if needed. No shell command is needed to check file size or count pages.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to export PDF: ${response?.error ?? 'unknown error'}`,
            },
          ],
          isError: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Export tool error: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}

main().catch((err) => {
  process.stderr.write(`[export-pdf-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
