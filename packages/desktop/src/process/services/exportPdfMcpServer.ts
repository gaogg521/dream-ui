/**
 * Copyright 2026 One Work
 */

/**
 * Main-process TCP server that backs the `export_to_pdf` MCP tool.
 *
 * The MCP client (e.g. the dream agent) spawns `builtin-mcp-export-pdf.js` as
 * a stdio MCP server. That script forwards tool calls here over TCP (4-byte
 * BE length header + JSON). This server invokes the shared PDF conversion
 * logic from exportBridge.ts.
 */

import net from 'net';
import { existsSync } from 'fs';
import path from 'path';
import {
  renderHtmlToPdfBuffer,
  renderHtmlToPngBuffer,
  convertViaWindowsCom,
  convertViaSoffice,
  convertViaOfficecliHtml,
  detectNativeOfficeConverter,
} from '@process/bridge/exportBridge';
import { writeFile, readFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';

const START_PORT = 19820;
const MAX_PORT_ATTEMPTS = 10;

type ExportRequest = {
  /** Absent on requests from the PDF tool, which predates image export. */
  kind?: 'pdf' | 'image';
  source: string;
  source_type: 'html' | 'html_file' | 'office_file';
  output_path?: string;
  width?: number;
  scale?: number;
  selector?: string;
};

type ExportResponse = {
  success: boolean;
  file_path?: string;
  error?: string;
  page_count?: number;
  size_bytes?: number;
  image_width?: number;
  image_height?: number;
};

let server: net.Server | null = null;
let currentPort = 0;

function writeTcpMessage(socket: net.Socket, data: unknown): void {
  const json = JSON.stringify(data);
  const body = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

function createTcpMessageReader(onMessage: (msg: unknown) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const bodyLen = buffer.readUInt32BE(0);
      if (buffer.length < 4 + bodyLen) break;
      const jsonStr = buffer.subarray(4, 4 + bodyLen).toString('utf-8');
      buffer = buffer.subarray(4 + bodyLen);
      try {
        onMessage(JSON.parse(jsonStr));
      } catch {
        // Malformed JSON — skip
      }
    }
  };
}

/** Parse the actual PDF, including compressed page trees, rather than counting text patterns. */
export async function inspectPdfFile(filePath: string): Promise<{ page_count: number; size_bytes: number }> {
  const bytes = await readFile(filePath);
  if (bytes.length === 0) throw new Error('The PDF output is empty');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPageCount();
  if (pages < 1) throw new Error('The PDF output contains no pages');
  return { page_count: pages, size_bytes: bytes.length };
}

async function pdfSuccess(filePath: string): Promise<ExportResponse> {
  return { success: true, file_path: filePath, ...(await inspectPdfFile(filePath)) };
}

async function handleExportRequest(req: ExportRequest): Promise<ExportResponse> {
  const { source, source_type, output_path } = req;

  if (!output_path) {
    return { success: false, error: 'output_path is required' };
  }
  if (!source) {
    return { success: false, error: 'source is required' };
  }

  if (req.kind === 'image') {
    return handleImageRequest(req, output_path);
  }

  try {
    if (source_type === 'html') {
      const pdfBuffer = await renderHtmlToPdfBuffer(source);
      await writeFile(output_path, pdfBuffer);
      return await pdfSuccess(output_path);
    }

    // html_file + office_file both need a real file on disk
    if (!existsSync(source)) {
      return { success: false, error: `Source file not found: ${source}` };
    }

    if (source_type === 'html_file') {
      const html = await readFile(source, 'utf-8');
      const pdfBuffer = await renderHtmlToPdfBuffer(html);
      await writeFile(output_path, pdfBuffer);
      return await pdfSuccess(output_path);
    }

    // office_file: COM / soffice / fallback
    const ext = path.extname(source).toLowerCase();
    if (!['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'].includes(ext)) {
      return { success: false, error: `Unsupported office file type: ${ext}` };
    }

    const { hasNative, sofficePath } = await detectNativeOfficeConverter();
    try {
      if (hasNative) {
        if (process.platform === 'win32') {
          await convertViaWindowsCom(source, output_path);
        } else if (sofficePath) {
          await convertViaSoffice(source, output_path, sofficePath);
        }
      } else {
        await convertViaOfficecliHtml(source, output_path);
      }
      return await pdfSuccess(output_path);
    } catch (e) {
      // Native failed — try fallback before giving up
      try {
        await convertViaOfficecliHtml(source, output_path);
        return await pdfSuccess(output_path);
      } catch (e2) {
        return { success: false, error: e2 instanceof Error ? e2.message : String(e2) };
      }
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * HTML → PNG for the `render_html_to_image` tool. Office files are refused
 * rather than guessed at: the tool exists for pages the agent laid out itself.
 */
async function handleImageRequest(req: ExportRequest, outputPath: string): Promise<ExportResponse> {
  if (req.source_type === 'office_file') {
    return { success: false, error: 'image export accepts html or html_file, not office_file' };
  }
  if (path.extname(outputPath).toLowerCase() !== '.png') {
    return { success: false, error: 'output_path must end with .png' };
  }
  if (req.source_type === 'html_file' && !existsSync(req.source)) {
    return { success: false, error: `Source file not found: ${req.source}` };
  }
  try {
    const png = await renderHtmlToPngBuffer(
      req.source_type === 'html_file' ? { kind: 'file', filePath: req.source } : { kind: 'html', html: req.source },
      { width: req.width, scale: req.scale, selector: req.selector }
    );
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('The renderer did not produce a valid PNG');
    const image_width = png.readUInt32BE(16);
    const image_height = png.readUInt32BE(20);
    if (!image_width || !image_height) throw new Error('The rendered image has no dimensions');
    await writeFile(outputPath, png);
    return { success: true, file_path: outputPath, size_bytes: png.length, image_width, image_height };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function handleConnection(socket: net.Socket): void {
  const reader = createTcpMessageReader((msg) => {
    const req = msg as ExportRequest;
    handleExportRequest(req)
      .then((result) => {
        writeTcpMessage(socket, result);
        socket.end();
      })
      .catch((err) => {
        writeTcpMessage(socket, {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        socket.end();
      });
  });
  socket.on('data', reader);
  socket.on('error', () => {
    // Client disconnect — ignore
  });
}

function listenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tryServer = net.createServer(handleConnection);
    tryServer.once('error', () => resolve(false));
    tryServer.listen(port, '127.0.0.1', () => {
      server = tryServer;
      currentPort = port;
      resolve(true);
    });
  });
}

export async function startExportPdfMcpServer(): Promise<number> {
  if (server) return currentPort;
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = START_PORT + i;
    const ok = await listenOnPort(port);
    if (ok) {
      console.log(`[exportPdfMcpServer] Listening on 127.0.0.1:${port}`);
      return port;
    }
  }
  throw new Error(
    `[exportPdfMcpServer] No available port in range ${START_PORT}-${START_PORT + MAX_PORT_ATTEMPTS - 1}`
  );
}

export function getExportPdfMcpPort(): number {
  return currentPort;
}

export async function stopExportPdfMcpServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server!.close(() => {
      server = null;
      currentPort = 0;
      resolve();
    });
  });
}
