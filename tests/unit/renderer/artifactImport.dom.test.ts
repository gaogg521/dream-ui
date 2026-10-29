import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  register: vi.fn(),
  chunk: vi.fn(),
  upload: vi.fn(),
  revision: vi.fn(),
  content: vi.fn(),
  remove: vi.fn(),
  extract: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      readRagSourceChunk: { invoke: api.chunk },
      extractRagDocumentFiles: { invoke: api.extract },
      cancelRagExtraction: { invoke: api.cancel },
    },
    oneDevops: {
      registerRagDocument: { invoke: api.register },
      getRagContentState: { invoke: api.revision },
      setRagContent: { invoke: api.content },
      deleteRagDocument: { invoke: api.remove },
    },
  },
}));
vi.mock('@/common/adapter/httpBridge', () => ({ httpUploadMultipart: api.upload }));
vi.mock('@/renderer/pages/knowledge/original/originalCache', () => ({
  cacheOriginal: vi.fn(),
  originalCacheKey: vi.fn(),
}));
import { importLocalArtifact, saveLibraryOriginal } from '@/renderer/pages/knowledge/attach/artifactImport';
beforeEach(() => {
  vi.resetAllMocks();
  api.register.mockResolvedValue({ id: 'qa-doc' });
  api.revision.mockResolvedValue({ revision: 4 });
  api.remove.mockResolvedValue(undefined);
  api.upload.mockResolvedValue({});
});
describe('artifact import', () => {
  it('uploads the original to the selected private library and writes searchable text with a revision', async () => {
    await saveLibraryOriginal({
      title: '报告',
      content: '正文',
      personal: true,
      libraryId: 'mine',
      source: new File(['content'], '报告.txt'),
    });
    expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ scope: 'personal', libraryId: 'mine' }));
    expect(api.upload).toHaveBeenCalled();
    expect(api.content).toHaveBeenCalledWith({ id: 'qa-doc', content: '正文', expectedRevision: 4 });
  });
  it('removes a newly registered shell when upload fails and rejects', async () => {
    api.upload.mockRejectedValue(new Error('offline'));
    await expect(
      saveLibraryOriginal({ title: 'qa', content: '', personal: true, source: new File(['x'], 'x.pdf') })
    ).rejects.toThrow('offline');
    expect(api.remove).toHaveBeenCalledWith({ id: 'qa-doc' });
  });
  it('also removes partial content on an indexing write failure', async () => {
    api.content.mockRejectedValue(new Error('conflict'));
    await expect(saveLibraryOriginal({ title: 'qa', content: 'text', personal: true })).rejects.toThrow('conflict');
    expect(api.remove).toHaveBeenCalledWith({ id: 'qa-doc' });
  });
  it('does not register a file when cancelled before extraction', async () => {
    const c = new AbortController();
    c.abort();
    await expect(importLocalArtifact('D:/qa.txt', { personal: true }, c.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(api.register).not.toHaveBeenCalled();
  });
  it('preserves an original even if text extraction cannot handle its format', async () => {
    api.extract.mockResolvedValue([{ fileName: 'qa.png', filePath: 'D:/qa.png', fileSize: 0, error: 'unsupported' }]);
    api.chunk.mockResolvedValue({ name: 'qa.png', size: 0, base64: '' });
    const result = await importLocalArtifact('D:/qa.png', { personal: true }, new AbortController().signal);
    expect(result.sourceOnly).toBe(true);
    expect(api.upload).toHaveBeenCalled();
  });
  it('does not create a document for files over the source limit', async () => {
    api.extract.mockResolvedValue([
      { fileName: 'large.pdf', filePath: 'D:/large.pdf', fileSize: 101 * 1024 * 1024, text: '' },
    ]);
    await expect(importLocalArtifact('D:/large.pdf', { personal: true }, new AbortController().signal)).rejects.toThrow(
      '100 MiB'
    );
    expect(api.register).not.toHaveBeenCalled();
  });
});
