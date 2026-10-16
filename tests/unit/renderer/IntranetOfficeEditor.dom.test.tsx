/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OfficeEditor from '@/renderer/pages/knowledge/original/intranet/OfficeEditor';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  flush: vi.fn(),
  load: vi.fn(),
  destroy: vi.fn(),
  config: {} as Record<string, unknown>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').at(-1), i18n: { language: 'zh-CN' } }),
}));
vi.mock('@/renderer/pages/knowledge/original/intranet/officeApi', () => ({
  officeApi: { open: mocks.open, flush: mocks.flush },
  loadOfficeApi: mocks.load,
}));
const saved = vi.fn();
function Page() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/away')}>leave</button>
      <OfficeEditor documentId='document' onSaved={saved} registerBeforeLeave={() => {}} />
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockResolvedValue({ sessionId: 'session', scriptUrl: 'http://office/api.js', config: {} });
  mocks.flush.mockResolvedValue({ saved: true, revision: 1, sourceVersion: 'new-source' });
  mocks.load.mockResolvedValue({
    DocEditor: class {
      constructor(_id: string, config: Record<string, unknown>) {
        mocks.config = config;
      }
      destroyEditor() {
        mocks.destroy();
      }
    },
  });
  saved.mockResolvedValue(undefined);
});
afterEach(cleanup);
async function open() {
  render(
    <MemoryRouter>
      <Routes>
        <Route path='/' element={<Page />} />
        <Route path='/away' element={<p>destination</p>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
}
function ready() {
  act(() => (mocks.config.events as { onDocumentReady: () => void }).onDocumentReady());
}
describe('intranet Office persistence and navigation', () => {
  it('waits for callback persistence and metadata refresh before allowing navigation', async () => {
    let complete: (value: unknown) => void = () => {};
    mocks.flush.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    await open();
    ready();
    fireEvent.click(screen.getByText('leave'));
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledWith('session'));
    expect(screen.queryByText('destination')).toBeNull();
    expect(mocks.destroy).not.toHaveBeenCalled();
    await act(async () => complete({ saved: true, revision: 1, sourceVersion: 'new-source' }));
    expect(await screen.findByText('destination')).toBeTruthy();
    expect(saved).toHaveBeenCalledWith('new-source');
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it('retains the editing session after save failure and retries without reopening it', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('callback unavailable'));
    await open();
    ready();
    fireEvent.click(screen.getByText('leave'));
    expect(await screen.findByText(/callback unavailable/)).toBeTruthy();
    expect(screen.queryByText('destination')).toBeNull();
    expect(mocks.destroy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('retry'));
    expect(await screen.findByText('autoSaved')).toBeTruthy();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith('new-source');
  });
  it('also persists edits made while an earlier save is in flight before leaving', async () => {
    const complete: Array<(value: unknown) => void> = [];
    mocks.flush.mockImplementation(() => new Promise((resolve) => complete.push(resolve)));
    await open();
    ready();
    fireEvent.click(screen.getByText('leave'));
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));
    act(() => {
      const events = mocks.config.events as { onDocumentStateChange: (event: { data: boolean }) => void };
      events.onDocumentStateChange({ data: true });
      events.onDocumentStateChange({ data: false });
    });
    await act(async () => complete[0]({ saved: true, revision: 1, sourceVersion: 'first-source' }));
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('destination')).toBeNull();
    await act(async () => complete[1]({ saved: true, revision: 2, sourceVersion: 'latest-source' }));
    expect(await screen.findByText('destination')).toBeTruthy();
    expect(saved).toHaveBeenLastCalledWith('latest-source');
  });
  it('can retry a failed initialization instead of leaving a dead retry button', async () => {
    mocks.load.mockRejectedValueOnce(new Error('engine unavailable'));
    await open();
    expect(await screen.findByText('originalLoadFailed')).toBeTruthy();
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    ready();
    expect(await screen.findByText('autoSave')).toBeTruthy();
  });
});
