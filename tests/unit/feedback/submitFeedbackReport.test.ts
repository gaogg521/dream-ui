import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitFeedbackReport } from '@/renderer/services/feedback/submitFeedbackReport';

const send = vi.fn();
const input = {
  module: 'conversation-session',
  moduleLabel: 'Conversations',
  description: 'A problem',
  collectLogs: false,
};
beforeEach(() => {
  send.mockReset().mockResolvedValue({ eventId: 'accepted-id', acceptedAt: 1 });
  vi.stubGlobal('window', { electronAPI: { submitFeedbackReport: send, logFeedbackEvent: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe('acknowledged feedback submission', () => {
  it('returns the receipt and preserves description formatting', async () => {
    const result = await submitFeedbackReport({
      ...input,
      description: '  first\nsecond  ',
      contactEmail: ' person@example.com ',
      tags: { source: 'test' },
      extra: { trace: 'safe' },
      attachments: [{ filename: 'a.png', contentType: 'image/png', data: new Uint8Array([1]) }],
    });
    expect(result).toEqual({ eventId: 'accepted-id', acceptedAt: 1 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'first\nsecond',
        message: 'Conversations: first second',
        contactEmail: 'person@example.com',
        tags: { source: 'test' },
        extra: { trace: 'safe' },
        attachments: [expect.objectContaining({ filename: 'a.png' })],
      })
    );
  });
  it('cannot report success before the main process acknowledges delivery', async () => {
    let accept!: (value: { eventId: string; acceptedAt: number }) => void;
    send.mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      })
    );
    let done = false;
    const pending = submitFeedbackReport(input).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    accept({ eventId: 'ack', acceptedAt: 2 });
    await pending;
    expect(done).toBe(true);
  });
  it('rejects missing IPC without collecting logs', async () => {
    const collect = vi.fn();
    vi.stubGlobal('window', { electronAPI: { collectFeedbackLogs: collect } });
    await expect(submitFeedbackReport({ ...input, collectLogs: true })).rejects.toThrow('unavailable');
    expect(collect).not.toHaveBeenCalled();
  });
  it('rejects a missing acknowledgement instead of treating a queued event as delivery', async () => {
    send.mockResolvedValue(undefined);
    await expect(submitFeedbackReport(input)).rejects.toThrow('acknowledgement');
  });
  it('propagates upstream failure', async () => {
    send.mockRejectedValue(new Error('upstream unavailable'));
    await expect(submitFeedbackReport(input)).rejects.toThrow('upstream unavailable');
  });
  it('attaches collected logs and forwards the requested timeout', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        submitFeedbackReport: send,
        collectFeedbackLogs: vi.fn().mockResolvedValue({ filename: 'logs.gz', data: [1, 2] }),
      },
    });
    await submitFeedbackReport({ ...input, collectLogs: true, flushTimeoutMs: 2000 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 2000,
        attachments: [expect.objectContaining({ filename: 'logs.gz', data: new Uint8Array([1, 2]) })],
      })
    );
  });
  it('continues when optional log collection fails', async () => {
    vi.stubGlobal('window', {
      electronAPI: {
        submitFeedbackReport: send,
        collectFeedbackLogs: vi.fn().mockRejectedValue(new Error('missing logs')),
      },
    });
    await submitFeedbackReport({ ...input, collectLogs: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] }));
  });
  it('collects selected diagnostics into an attachment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { privacy: { raw_content_included: false }, profiles: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    await submitFeedbackReport({
      ...input,
      collectDbDiagnostics: { selectedModule: input.module, explicitContext: { conversationId: 'conv-test' } },
    });
    expect(fetchMock.mock.calls[0][0]).toContain('conversation_id=conv-test');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            filename: expect.stringMatching(/^db-diagnostics\.json/),
            data: expect.any(Uint8Array),
          }),
        ],
      })
    );
  });
});
