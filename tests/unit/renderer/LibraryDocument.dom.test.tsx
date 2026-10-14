import React from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LibraryDocument from '@/renderer/pages/knowledge/LibraryDocument';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }) }));
const props = {
  title: 'Guide.md',
  location: 'Team',
  content: '# Welcome\n\nExisting document content.',
  reading: true,
  canEdit: true,
  onReading: vi.fn(),
  onChange: vi.fn(),
  onBack: vi.fn(),
  onSave: vi.fn(),
};
describe('inline knowledge document', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it('marks an asynchronously loaded document as saved', () => {
    const view = render(<LibraryDocument {...props} content='' loading />);
    view.rerender(<LibraryDocument {...props} loading={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('autoSaved');
  });
  it('flushes the final edit before returning to the library', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    const view = render(
      <LibraryDocument {...props} reading={false} mimeType='text/html' onSave={onSave} onBack={onBack} />
    );
    view.rerender(
      <LibraryDocument
        {...props}
        reading={false}
        mimeType='text/html'
        content='Last edit'
        onSave={onSave}
        onBack={onBack}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'backToLibrary' }));
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith(true);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onBack.mock.invocationCallOrder[0]);
  });
  it('automatically persists the latest edits, including clearing the body', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(<LibraryDocument {...props} reading={false} mimeType='text/html' onSave={onSave} />);
    view.rerender(
      <LibraryDocument {...props} reading={false} mimeType='text/html' content='Updated body' onSave={onSave} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByRole('status')).toHaveTextContent('autoSaved');
    view.rerender(<LibraryDocument {...props} reading={false} mimeType='text/html' content='' onSave={onSave} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
  });
  it('preserves failed edits and allows an explicit retry', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const view = render(<LibraryDocument {...props} reading={false} mimeType='text/html' onSave={onSave} />);
    view.rerender(
      <LibraryDocument {...props} reading={false} mimeType='text/html' content='Keep this edit' onSave={onSave} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.getByRole('status')).toHaveTextContent('saveFailed');
    expect(screen.getByRole('textbox')).toHaveValue('Keep this edit');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'save', exact: true }));
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('autoSaved');
  });
  it('queues edits made during a save without sending concurrent requests', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const view = render(<LibraryDocument {...props} reading={false} mimeType='text/html' onSave={onSave} />);
    view.rerender(
      <LibraryDocument {...props} reading={false} mimeType='text/html' content='First edit' onSave={onSave} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    view.rerender(
      <LibraryDocument {...props} reading={false} mimeType='text/html' content='Latest edit' onSave={onSave} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('autoSaved');
  });
  it('renders the document in a page region without opening a dialog', () => {
    render(<LibraryDocument {...props} />);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByText('Existing document content.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('knowledge-document')).toBeInTheDocument();
  });
  it('previews HTML in an isolated frame with no script or same-origin privileges', () => {
    render(
      <LibraryDocument
        {...props}
        title='Preview.html'
        mimeType='text/html'
        content='<h1>Preview</h1><script>window.parent.compromised=true</script>'
      />
    );
    const frame = screen.getByTestId('knowledge-document').querySelector('iframe')!;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Preview</h1>');
  });
});
