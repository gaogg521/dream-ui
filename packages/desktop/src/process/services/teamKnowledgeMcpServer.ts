/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-process TCP server backing the `search_team_knowledge` MCP tool.
 *
 * The MCP client spawns `builtin-mcp-team-knowledge.js` as a stdio MCP server;
 * that script forwards tool calls here over TCP (4-byte BE length header +
 * JSON). This server turns them into a call on the backend's existing
 * `/api/one/devops/rag/search` endpoint.
 *
 * # Why this indirection exists
 *
 * The knowledge base does not always live on the local backend. `/api/one/devops`
 * is a *governance* path, so in enterprise client mode it is served by the
 * remote server. Picking that backend (and carrying the member's bearer token)
 * is `governanceEndpoint`'s job — see that module for why the main process
 * cannot work it out for itself.
 *
 * Access control is never re-implemented here. The backend applies the caller's
 * visibility filter, so a member cannot retrieve another group's documents no
 * matter what this process asks for.
 */

import net from 'net';
import { governanceFetch } from '@process/services/governanceEndpoint';

const START_PORT = 19840;
const MAX_PORT_ATTEMPTS = 10;

/** Matches the backend's own default in `search_rag`. */
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

type SearchRequest = {
  query?: string;
  top_k?: number;
};

type SearchHit = {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  score: number;
};

type SearchResponse = {
  success: boolean;
  hits?: SearchHit[];
  error?: string;
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

async function handleSearchRequest(req: SearchRequest): Promise<SearchResponse> {
  const query = (req.query ?? '').trim();
  if (!query) {
    return { success: false, error: 'query is required' };
  }
  const topK = Math.min(MAX_TOP_K, Math.max(1, Math.trunc(req.top_k ?? DEFAULT_TOP_K)));

  try {
    const payload = await governanceFetch<SearchHit[] | undefined>('POST', '/api/one/devops/rag/search', {
      query,
      topK,
    });
    return { success: true, hits: payload ?? [] };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function handleConnection(socket: net.Socket): void {
  const reader = createTcpMessageReader((msg) => {
    handleSearchRequest(msg as SearchRequest)
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

export async function startTeamKnowledgeMcpServer(): Promise<number> {
  if (server) return currentPort;
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = START_PORT + i;
    const ok = await listenOnPort(port);
    if (ok) {
      console.log(`[teamKnowledgeMcpServer] Listening on 127.0.0.1:${port}`);
      return port;
    }
  }
  throw new Error(
    `[teamKnowledgeMcpServer] No available port in range ${START_PORT}-${START_PORT + MAX_PORT_ATTEMPTS - 1}`
  );
}

export function getTeamKnowledgeMcpPort(): number {
  return currentPort;
}

export async function stopTeamKnowledgeMcpServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server!.close(() => {
      server = null;
      currentPort = 0;
      resolve();
    });
  });
}
