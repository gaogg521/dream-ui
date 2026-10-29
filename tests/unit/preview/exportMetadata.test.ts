import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { PDFDocument } from 'pdf-lib';
const bridge = vi.hoisted(() => ({
  renderHtmlToPdfBuffer: vi.fn(),
  renderHtmlToPngBuffer: vi.fn(),
  convertViaWindowsCom: vi.fn(),
  convertViaSoffice: vi.fn(),
  convertViaOfficecliHtml: vi.fn(),
  detectNativeOfficeConverter: vi.fn(),
}));
vi.mock('@process/bridge/exportBridge', () => bridge);
import { startExportPdfMcpServer, stopExportPdfMcpServer } from '@/process/services/exportPdfMcpServer';
let folder: string;
let port: number;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'one-work-export-qa-'));
  port = await startExportPdfMcpServer();
});
afterAll(async () => {
  await stopExportPdfMcpServer();
  expect(dirname(resolve(folder))).toBe(resolve(tmpdir()));
  await rm(folder, { recursive: true, force: true });
});
beforeEach(() => vi.clearAllMocks());
const request = (body: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolveResult, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let received = Buffer.alloc(0);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(Error('export response timeout'));
    });
    socket.on('error', reject);
    socket.on('connect', () => {
      const text = Buffer.from(JSON.stringify(body));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(text.length);
      socket.write(Buffer.concat([header, text]));
    });
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 4 && received.length >= 4 + received.readUInt32BE(0)) {
        socket.end();
        resolveResult(JSON.parse(received.subarray(4, 4 + received.readUInt32BE(0)).toString()));
      }
    });
  });
it('returns the actual page count for a compressed PDF rather than a regex guess', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: true }));
  bridge.renderHtmlToPdfBuffer.mockResolvedValue(bytes);
  const path = join(folder, 'two-pages.pdf');
  const result = await request({ source: '<h1>Task</h1>', source_type: 'html', output_path: path });
  expect(result).toMatchObject({ success: true, file_path: path, page_count: 2, size_bytes: bytes.length });
  expect((await stat(path)).size).toBe(bytes.length);
});
it('does not report a corrupt or empty PDF as a successful export', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('not a PDF')]) {
    bridge.renderHtmlToPdfBuffer.mockResolvedValue(bytes);
    expect(await request({ source: 'x', source_type: 'html', output_path: join(folder, 'invalid.pdf') })).toMatchObject(
      { success: false }
    );
  }
});
it('returns verified PNG dimensions and file size for a generated checklist card', async () => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  );
  bridge.renderHtmlToPngBuffer.mockResolvedValue(bytes);
  expect(
    await request({ kind: 'image', source: 'x', source_type: 'html', output_path: join(folder, 'card.png') })
  ).toMatchObject({ success: true, image_width: 1, image_height: 1, size_bytes: bytes.length });
});
it('rejects a renderer result that is not a PNG instead of returning a fake image path', async () => {
  bridge.renderHtmlToPngBuffer.mockResolvedValue(Buffer.from('not a PNG'));
  expect(
    await request({ kind: 'image', source: 'x', source_type: 'html', output_path: join(folder, 'bad.png') })
  ).toMatchObject({ success: false });
});
