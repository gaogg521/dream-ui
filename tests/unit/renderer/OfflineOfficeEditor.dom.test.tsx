/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfflineOfficeEditor from '@/renderer/pages/knowledge/original/OfflineOfficeEditor';
import type { OfficeEvent, OfflineOfficeApi } from '@/common/types/offlineOffice';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }) }));
let receive: (event: OfficeEvent) => void;
let api: OfflineOfficeApi;
const save = vi.fn();
function Page() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/away')}>leave</button>
      <OfflineOfficeEditor
        fileName='test.docx'
        mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        load={async () => new Blob(['original'])}
        save={save}
        registerBeforeLeave={() => {}}
      />
    </>
  );
}
beforeEach(() => {
  save.mockReset().mockResolvedValue({});
  api = {
    open: vi.fn().mockResolvedValue({ sessionId: 'session' }),
    bounds: vi.fn().mockResolvedValue(undefined),
    visibility: vi.fn().mockResolvedValue(null),
    flush: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    prewarm: vi.fn().mockResolvedValue(undefined),
    releasePrewarm: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((callback) => {
      receive = callback;
      return vi.fn();
    }),
  };
  window.__offlineOffice = api;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  delete window.__offlineOffice;
  vi.unstubAllGlobals();
});
async function open() {
  render(
    <MemoryRouter>
      <Routes>
        <Route path='/' element={<Page />} />
        <Route path='/away' element={<p>destination</p>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(api.open).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}
describe('offline Office persistence', () => {
  it('acknowledges a revision only after the original upload succeeds', async () => {
    await open();
    receive({ sessionId: 'session', kind: 'save', revision: 4, base64: btoa('edited document') });
    await waitFor(() => expect(api.acknowledge).toHaveBeenCalledWith('session', 4));
    expect(save.mock.calls[0][0].name).toBe('test.docx');
    expect(save.mock.calls[0][0].size).toBe(15);
    expect(await screen.findByText('autoSaved')).toBeTruthy();
  });
  it('reports a failed upload to the engine and retains the error state', async () => {
    save.mockRejectedValue(new Error('offline storage unavailable'));
    await open();
    receive({ sessionId: 'session', kind: 'save', revision: 5, base64: btoa('edited document') });
    await waitFor(() =>
      expect(api.acknowledge).toHaveBeenCalledWith('session', 5, 'Error: offline storage unavailable')
    );
    expect(await screen.findByText('saveFailed')).toBeTruthy();
    expect(screen.queryByText('autoSaved')).toBeNull();
  });
  it('keeps the editor open when flushing fails and navigates only after persistence succeeds', async () => {
    await open();
    vi.mocked(api.flush).mockResolvedValue(false);
    fireEvent.click(screen.getByText('leave'));
    await waitFor(() => expect(api.flush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('destination')).toBeNull();
    vi.mocked(api.flush).mockResolvedValue(true);
    fireEvent.click(screen.getByText('leave'));
    expect(await screen.findByText('destination')).toBeTruthy();
    await waitFor(() => expect(api.close).toHaveBeenCalledWith('session'));
  });
  it('boots a spare engine once the document is on screen, for 编辑 and the next open', async () => {
    await open();
    expect(api.prewarm).not.toHaveBeenCalled();
    receive({ sessionId: 'session', kind: 'ready' });
    await waitFor(() => expect(api.prewarm).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
  it('shows the last snapshot of the same document version while the engine loads it again', async () => {
    const editor = (cacheKey: string) => (
      <MemoryRouter>
        <OfflineOfficeEditor
          cacheKey={cacheKey}
          fileName='deck.pptx'
          mime='application/vnd.openxmlformats-officedocument.presentationml.presentation'
          load={async () => new Blob(['deck'])}
          save={save}
          registerBeforeLeave={() => {}}
        />
      </MemoryRouter>
    );
    const first = render(editor('doc-1:rag-source:v1'));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.open).mock.calls[0][0].hideUntilReady).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    receive({ sessionId: 'session', kind: 'ready' });
    receive({ sessionId: 'session', kind: 'snapshot', image: 'data:image/jpeg;base64,AAAA' });
    first.unmount();

    const second = render(editor('doc-1:rag-source:v1'));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.open).mock.calls[1][0].hideUntilReady).toBe(true);
    expect(second.container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
    await new Promise((resolve) => setTimeout(resolve, 0));
    receive({ sessionId: 'session', kind: 'ready' });
    await waitFor(() => expect(second.container.querySelector('img')).toBeNull());
    second.unmount();

    // A new version (after a save) has no picture yet.
    render(editor('doc-1:rag-source:v2'));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.open).mock.calls[2][0].hideUntilReady).toBe(false);
  });
  it('does not boot a spare for an editor that closed before it was ready to', async () => {
    await open();
    receive({ sessionId: 'session', kind: 'ready' });
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(api.prewarm).not.toHaveBeenCalled();
  });
  it('retries retained engine bytes after an upload failure without reopening the original', async () => {
    save.mockRejectedValue(new Error('storage temporarily unavailable'));
    await open();
    receive({ sessionId: 'session', kind: 'save', revision: 6, base64: btoa('retained edit') });
    fireEvent.click(await screen.findByText('retry'));
    await waitFor(() => expect(api.flush).toHaveBeenCalledWith('session'));
    expect(await screen.findByText('autoSaved')).toBeTruthy();
    expect(screen.queryByText('storage temporarily unavailable')).toBeNull();
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(api.close).not.toHaveBeenCalled();
  });
});
