/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server: search_team_knowledge tool.
 *
 * This is the fix for the core gap in the team knowledge base: before it, the
 * knowledge base was only ever consulted automatically when dispatching a task
 * to a digital employee. During ordinary conversation the agent had no idea the
 * company even had a knowledge base. Exposing retrieval as an MCP tool makes it
 * reachable from every agent backend (aionrs / Claude Code / Codex CLI) because
 * MCP is the one protocol all three speak.
 *
 * Spawned by the MCP client as a stdio server; forwards tool calls to the
 * main-process TCP server (teamKnowledgeMcpServer), which owns the routing and
 * credentials needed to reach whichever backend actually holds the knowledge
 * base. Access control is NOT re-implemented here — the backend's existing
 * viewer filter decides what the caller may see.
 *
 * TCP protocol: 4-byte big-endian length header + UTF-8 JSON body.
 * Port comes from the TEAM_KNOWLEDGE_MCP_PORT env var.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as net from 'node:net';
import { BUILTIN_TEAM_KNOWLEDGE_NAME } from './constants';

const PORT = parseInt(process.env.TEAM_KNOWLEDGE_MCP_PORT || '0', 10);
if (!PORT) {
  process.stderr.write('[team-knowledge-mcp] TEAM_KNOWLEDGE_MCP_PORT environment variable is required\n');
  process.exit(1);
}

type SearchHit = {
  documentTitle?: string;
  documentId?: string;
  chunkIndex?: number;
  content?: string;
  score?: number;
};

type SearchResponse = {
  success?: boolean;
  hits?: SearchHit[];
  error?: string;
};

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
    // Retrieval embeds the query then queries the index; a cold embedding
    // endpoint is the slow part. Far below the PDF converter's ceiling.
    socket.setTimeout(60_000);
    socket.on('timeout', () => {
      socket.destroy(new Error('TCP request timeout'));
    });
  });
}

function renderHits(hits: SearchHit[]): string {
  return hits
    .map((hit, i) => {
      const title = hit.documentTitle || hit.documentId || 'untitled';
      const score = typeof hit.score === 'number' ? ` (relevance ${hit.score.toFixed(3)})` : '';
      return `### ${i + 1}. ${title}${score}\n${hit.content ?? ''}`;
    })
    .join('\n\n');
}

async function main() {
  const server = new McpServer({
    name: BUILTIN_TEAM_KNOWLEDGE_NAME,
    version: '1.0.0',
  });

  server.tool(
    'search_team_knowledge',
    `Search the company/team knowledge base for internal documents the current user is allowed to see. ` +
      `Use this whenever a question might depend on internal, company-specific information — product specs, ` +
      `internal processes, onboarding material, meeting notes, past decisions, naming conventions, ` +
      `customer or project details — i.e. anything you would not reliably know from general knowledge. ` +
      `Prefer calling this BEFORE answering from memory when the question mentions the company, its products, ` +
      `its people, or its internal practices. ` +
      `Results are already access-filtered for the current user; if it returns nothing, the knowledge base ` +
      `either has no match or the user is not permitted to see it — say so rather than inventing an answer.`,
    {
      query: z
        .string()
        .describe(
          'Natural-language search query. Use the words the document would plausibly contain, not a question addressed to the assistant.'
        ),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('How many chunks to return. Defaults to 5; raise it for broad questions.'),
    },
    async ({ query, top_k }) => {
      try {
        const response = (await sendTcpRequest(PORT, { query, top_k })) as SearchResponse;

        if (response?.success === false) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Knowledge base search failed: ${response.error ?? 'unknown error'}`,
              },
            ],
            isError: true,
          };
        }

        const hits = response?.hits ?? [];
        if (hits.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                // Explicitly steer away from confabulating: an empty result is
                // information, not an invitation to guess.
                text: 'No matching documents in the team knowledge base (or none visible to this user). Do not invent internal details — say the knowledge base has no answer.',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${hits.length} relevant excerpt(s) in the team knowledge base:\n\n${renderHits(hits)}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Knowledge base tool error: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[team-knowledge-mcp] stdio server ready, forwarding to 127.0.0.1:${PORT}\n`);
}

main().catch((err) => {
  process.stderr.write(`[team-knowledge-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
