/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OriginalFileViewer from '@/renderer/pages/knowledge/original/OriginalFileViewer';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }) }));
const createUrl = vi.fn(() => 'blob:test-original');
const revokeUrl = vi.fn();
beforeEach(() => {
  createUrl.mockClear();
  revokeUrl.mockClear();
  const BaseURL = URL;
  vi.stubGlobal(
    'URL',
    class extends BaseURL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('original file reader', () => {
  it('shows the PDF original and releases its URL without refetching on ordinary rerenders', async () => {
    const load = vi.fn().mockResolvedValue(new Blob(['%PDF-test'], { type: 'application/pdf' }));
    const view = render(<OriginalFileViewer id='one' title='Guide.pdf' mime='application/pdf' load={load} />);
    await waitFor(() =>
      expect(screen.getByTitle('Guide.pdf')).toHaveAttribute('src', 'blob:test-original#toolbar=1&navpanes=1')
    );
    view.rerender(<OriginalFileViewer id='one' title='Guide.pdf' mime='application/pdf' load={load} />);
    expect(load).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(revokeUrl).toHaveBeenCalledWith('blob:test-original');
  });
  it('retries a failed read and provides a truthful download fallback for unsupported files', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(new Blob(['office-data']));
    render(<OriginalFileViewer id='office' title='Guide.doc' mime='application/msword' load={load} />);
    fireEvent.click(await screen.findByRole('button', { name: 'retryOriginal' }));
    expect(await screen.findByText('originalUnsupported')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'downloadOriginal' })).toHaveAttribute('download', 'Guide.doc');
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not create a URL for a stale response after navigating away', async () => {
    let finish!: (blob: Blob) => void;
    const load = () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      });
    const view = render(<OriginalFileViewer id='old' title='Old.png' mime='image/png' load={load} />);
    view.unmount();
    await act(async () => {
      finish(new Blob(['image']));
    });
    expect(createUrl).not.toHaveBeenCalled();
  });
});
