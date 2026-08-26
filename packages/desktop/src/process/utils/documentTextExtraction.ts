/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extract plain text from local files or a URL, for the enterprise RAG
 * knowledge base (see `RagSection.tsx` / `useRuntimeNodeHeartbeat`-adjacent
 * `oneDevops.rag.*` endpoints). The backend only ever stores a `content`
 * string plus filename/mime metadata — this module is the missing "read the
 * actual file/webpage and turn it into text" step; without it, registering a
 * document meant copy-pasting its full text into a textarea by hand.
 *
 * Main-process only: PDF/Office parsing needs Node APIs (`officeparser`
 * explicitly does not work in browser bundles), so this must run here, not
 * in the renderer.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parseOfficeAsync } from 'officeparser';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { RAG_DOCUMENT_EXTENSIONS } from '@/common/config/constants';

export type ExtractedDocument = {
  text: string;
  mimeType: string;
  /** Best-effort title (e.g. an HTML page's `<title>`); null if none found. */
  suggestedTitle: string | null;
};

// Grouped by handling strategy (derived from the shared, renderer-visible
// RAG_DOCUMENT_EXTENSIONS list so the file-picker filter and this dispatch
// table can never drift apart).
const PLAIN_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const OFFICE_EXTENSIONS = new Set(
  RAG_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`).filter(
    (ext) => !PLAIN_TEXT_EXTENSIONS.has(ext) && !HTML_EXTENSIONS.has(ext)
  )
);

function htmlToText(html: string): string {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  turndown.use(gfm);
  return turndown.turndown(html);
}

function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title ? title : null;
}

async function extractByExtension(ext: string, read: () => Promise<Buffer | string>): Promise<ExtractedDocument> {
  const lowerExt = ext.toLowerCase();
  if (PLAIN_TEXT_EXTENSIONS.has(lowerExt)) {
    const content = await read();
    return {
      text: typeof content === 'string' ? content : content.toString('utf-8'),
      mimeType: 'text/plain',
      suggestedTitle: null,
    };
  }
  if (HTML_EXTENSIONS.has(lowerExt)) {
    const content = await read();
    const html = typeof content === 'string' ? content : content.toString('utf-8');
    return { text: htmlToText(html), mimeType: 'text/html', suggestedTitle: extractHtmlTitle(html) };
  }
  if (OFFICE_EXTENSIONS.has(lowerExt)) {
    const content = await read();
    const text = await parseOfficeAsync(content);
    return { text, mimeType: `application/${lowerExt.slice(1)}`, suggestedTitle: null };
  }
  throw new Error(`Unsupported file type "${ext}". Supported: ${RAG_DOCUMENT_EXTENSIONS.join(', ')}`);
}

/** Read a local file and extract its text, dispatching by extension. */
export async function extractTextFromFile(filePath: string): Promise<ExtractedDocument> {
  const ext = path.extname(filePath);
  return extractByExtension(ext, async () => {
    // officeparser accepts a Buffer directly; plain-text/HTML branches coerce
    // to string themselves, so reading as a Buffer once covers every case.
    return fs.readFile(filePath);
  });
}

/** Fetch a URL and extract its text, dispatching by content-type / extension. */
export async function extractTextFromUrl(url: string): Promise<ExtractedDocument> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported');
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());

  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    const html = buffer.toString('utf-8');
    return { text: htmlToText(html), mimeType: 'text/html', suggestedTitle: extractHtmlTitle(html) };
  }
  if (contentType === 'text/plain' || contentType === 'text/markdown') {
    return { text: buffer.toString('utf-8'), mimeType: contentType, suggestedTitle: null };
  }

  // No conclusive content-type (e.g. a CDN serving `application/octet-stream`
  // for a .pdf) — fall back to the URL's own extension.
  const extFromPath = path.extname(parsed.pathname);
  if (extFromPath) {
    try {
      return await extractByExtension(extFromPath, async () => buffer);
    } catch {
      // fall through to the generic error below
    }
  }
  throw new Error(`Unrecognized content type "${contentType || 'unknown'}" for ${url}`);
}
