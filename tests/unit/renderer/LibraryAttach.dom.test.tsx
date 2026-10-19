/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RagDocumentEntry } from '@/common/types/devops/devopsTypes';
import { libraryFileKind } from '@/renderer/pages/knowledge/shared/LibraryFileIcon';
import {
  libraryDocumentToFile,
  uploadLibraryDocumentPaths,
} from '@/renderer/pages/knowledge/attach/libraryAttachments';
import { requestConversationSendBoxFiles, useConversationSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxDraft';
import AddToConversationModal from '@/renderer/pages/knowledge/attach/AddToConversationModal';

const mocks = vi.hoisted(() => ({
  getContent: vi.fn(),
  download: vi.fn(),
  processDropped: vi.fn(),
  navigate: vi.fn(),
  conversations: [] as Array<{ id: string; name: string; modified_at: number }>,
}));

vi.mock('@/common', () => ({ ipcBridge: { oneDevops: { getRagContent: { invoke: mocks.getContent } } } }));
vi.mock('@/common/adapter/httpBridge', () => ({ httpDownloadBinary: mocks.download }));
vi.mock('@/renderer/services/FileService', () => ({ FileService: { processDroppedFiles: mocks.processDropped } }));
vi.mock('@arco-design/web-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arco-design/web-react')>()),
  Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContextSafe: () => ({ conversations: mocks.conversations }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }),
}));

const doc = (overrides: Partial<RagDocumentEntry>): RagDocumentEntry => ({
  id: 'orag_1',
  title: 'Notes',
  filePath: null,
  fileSize: null,
  mimeType: null,
  status: 'ready',
  lastError: null,
  chunkCount: 1,
  scope: 'personal',
  teamId: null,
  visibility: 'all',
  createdBy: 'me',
  createdAt: 1,
  ...overrides,
});

describe('libraryFileKind', () => {
  it.each([
    [{ title: 'Plan.md' }, 'markdown'],
    [{ title: 'Meeting notes' }, 'markdown'],
    [{ title: 'Budget', mimeType: 'text/csv' }, 'csv'],
    [{ title: 'report.pdf', mimeType: 'application/pdf', filePath: 'rag-source:x' }, 'pdf'],
    [{ title: 'deck.pptx', filePath: 'rag-source:x' }, 'slides'],
    [{ title: 'sheet.xlsx', filePath: 'rag-source:x' }, 'sheets'],
    [{ title: 'spec.docx', filePath: 'rag-source:x' }, 'word'],
    [{ title: 'page.html', mimeType: 'text/html', filePath: 'rag-source:x' }, 'html'],
    [{ title: 'photo.png', mimeType: 'image/png', filePath: 'rag-source:x' }, 'image'],
    [{ title: 'blob', filePath: 'rag-source:x', mimeType: 'application/octet-stream' }, 'other'],
  ])('classifies %j as %s', (entry, expected) => {
    expect(libraryFileKind(entry)).toBe(expected);
  });
});

describe('libraryDocumentToFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downloads the stored original and keeps its extension', async () => {
    mocks.download.mockResolvedValue({ blob: new Blob(['%PDF'], { type: 'application/pdf' }) });
    const file = await libraryDocumentToFile(
      doc({ id: 'orag_pdf', title: 'Contract', filePath: 'rag-source:orag_pdf', mimeType: 'application/pdf' })
    );
    expect(mocks.download).toHaveBeenCalledWith('/api/one/devops/rag/documents/orag_pdf/source');
    expect(file.name).toBe('Contract.pdf');
    expect(file.type).toBe('application/pdf');
  });

  it('exports an in-app document body as a Markdown file', async () => {
    mocks.getContent.mockResolvedValue('# Hello');
    const file = await libraryDocumentToFile(doc({ title: 'Weekly sync' }));
    expect(mocks.getContent).toHaveBeenCalledWith({ id: 'orag_1' });
    expect(file.name).toBe('Weekly sync.md');
    expect(await file.text()).toBe('# Hello');
  });

  it('exports a table document as CSV', async () => {
    mocks.getContent.mockResolvedValue('a,b\n1,2');
    const file = await libraryDocumentToFile(doc({ title: 'Table', mimeType: 'text/csv' }));
    expect(file.name).toBe('Table.csv');
  });

  it('uploads into the conversation workspace and returns the stored paths', async () => {
    mocks.getContent.mockResolvedValue('body');
    mocks.processDropped.mockResolvedValue([{ path: '/work/uploads/Notes.md' }]);
    await expect(uploadLibraryDocumentPaths([doc({})], 'conv_1')).resolves.toEqual(['/work/uploads/Notes.md']);
    expect(mocks.processDropped.mock.calls[0]?.[1]).toBe('conv_1');
  });
});

describe('queued conversation files', () => {
  it('waits for the conversation send box to mount, then delivers once', () => {
    requestConversationSendBoxFiles('conv_late', ['/a.md']);
    requestConversationSendBoxFiles('conv_late', ['/b.md']);
    const received: string[][] = [];
    renderHook(() => useConversationSendBoxFiles('conv_late', (paths) => received.push(paths)));
    expect(received).toEqual([['/a.md', '/b.md']]);
    renderHook(() => useConversationSendBoxFiles('conv_late', (paths) => received.push(paths)));
    expect(received).toHaveLength(1);
  });

  it('delivers straight away to a mounted send box and ignores other conversations', () => {
    const received: string[][] = [];
    renderHook(() => useConversationSendBoxFiles('conv_now', (paths) => received.push(paths)));
    act(() => requestConversationSendBoxFiles('conv_now', ['/c.md']));
    act(() => requestConversationSendBoxFiles('conv_other', ['/d.md']));
    expect(received).toEqual([['/c.md']]);
  });
});

describe('AddToConversationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContent.mockResolvedValue('body');
    mocks.processDropped.mockResolvedValue([{ path: '/work/Notes.md' }]);
    mocks.conversations = [
      { id: 'conv_old', name: 'Older chat', modified_at: 1 },
      { id: 'conv_new', name: 'Newest chat', modified_at: 9 },
    ];
  });

  it('starts a new conversation with the document attached', async () => {
    const onClose = vi.fn();
    render(<AddToConversationModal documents={[doc({})]} onClose={onClose} />);
    fireEvent.click(await screen.findByText('newConversation'));
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/guid', { state: { attachFiles: ['/work/Notes.md'] } })
    );
    expect(mocks.processDropped.mock.calls[0]?.[1]).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('lists the newest conversation first and attaches to the one picked', async () => {
    render(<AddToConversationModal documents={[doc({})]} onClose={vi.fn()} />);
    const titles = (await screen.findAllByText(/chat$/)).map((node) => node.textContent);
    expect(titles).toEqual(['Newest chat', 'Older chat']);
    const received: string[][] = [];
    renderHook(() => useConversationSendBoxFiles('conv_old', (paths) => received.push(paths)));
    fireEvent.click(screen.getByText('Older chat'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/conversation/conv_old'));
    expect(mocks.processDropped.mock.calls[0]?.[1]).toBe('conv_old');
    expect(received).toEqual([['/work/Notes.md']]);
  });
});
