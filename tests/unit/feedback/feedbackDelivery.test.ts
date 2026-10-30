import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackSubmission } from '@/common/types/feedbackDiagnostics';
import { deliverFeedbackReport } from '@/process/feedback/reports';

const sdk = vi.hoisted(() => {
  const listeners = new Set<(event: { event_id: string }, response: { statusCode?: number }) => void>();
  const state = { configured: true, enabled: true, deliver: true, status: 200 as number | undefined };
  const client = {
    getDsn: () => (state.configured ? {} : undefined),
    getOptions: () => ({ enabled: state.enabled }),
    getTransport: () => ({}),
    flush: vi.fn().mockResolvedValue(true),
    on: vi.fn((_hook: string, cb: (event: { event_id: string }, response: { statusCode?: number }) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
  };
  return {
    listeners,
    state,
    client,
    setTag: vi.fn(),
    setUser: vi.fn(),
    captureEvent: vi.fn((event: { event_id: string }) => {
      if (state.deliver) queueMicrotask(() => listeners.forEach((cb) => cb(event, { statusCode: state.status })));
      return event.event_id;
    }),
  };
});
vi.mock('@sentry/electron/main', () => ({
  getClient: () => sdk.client,
  captureEvent: sdk.captureEvent,
  withScope: (cb: (scope: unknown) => void) => cb({ setTag: sdk.setTag, setUser: sdk.setUser }),
}));
const input: FeedbackSubmission = {
  message: 'Test',
  description: 'Synthetic feedback',
  module: 'system-settings',
  attachments: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  sdk.listeners.clear();
  Object.assign(sdk.state, { configured: true, enabled: true, deliver: true, status: 200 });
  sdk.client.flush.mockResolvedValue(true);
});
describe('main-process feedback acknowledgement', () => {
  it('accepts upstream 2xx and returns the exact event ID', async () => {
    const receipt = await deliverFeedbackReport({ ...input, contactEmail: ' person@example.com ' });
    expect(receipt.eventId).toMatch(/^[a-f0-9]{32}$/);
    expect(sdk.captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: receipt.eventId }),
      expect.anything()
    );
    expect(sdk.setUser).toHaveBeenCalledWith({ email: 'person@example.com' });
    expect(sdk.listeners.size).toBe(0);
  });
  it.each([403, 429, 503, undefined])('rejects response %s even if the queue flushes', async (status) => {
    sdk.state.status = status;
    await expect(deliverFeedbackReport(input)).rejects.toThrow('did not accept');
    expect(sdk.listeners.size).toBe(0);
  });
  it('rejects an unconfigured transport without capturing', async () => {
    sdk.state.configured = false;
    await expect(deliverFeedbackReport(input)).rejects.toThrow('not configured');
    expect(sdk.captureEvent).not.toHaveBeenCalled();
  });
  it('rejects a disabled client', async () => {
    sdk.state.enabled = false;
    await expect(deliverFeedbackReport(input)).rejects.toThrow('not configured');
  });
  it('times out on a dropped event and removes its listener', async () => {
    sdk.state.deliver = false;
    await expect(deliverFeedbackReport(input, 20)).rejects.toThrow('timed out');
    expect(sdk.listeners.size).toBe(0);
  });
  it('rejects an incomplete flush', async () => {
    sdk.client.flush.mockResolvedValue(false);
    await expect(deliverFeedbackReport(input)).rejects.toThrow('did not complete');
  });
  it('ignores acknowledgements for unrelated events', async () => {
    sdk.state.deliver = false;
    const promise = deliverFeedbackReport(input, 100);
    await vi.waitFor(() => expect(sdk.captureEvent).toHaveBeenCalled());
    sdk.listeners.forEach((cb) => cb({ event_id: 'other-event' }, { statusCode: 200 }));
    await expect(promise).rejects.toThrow('timed out');
  });
  it('rejects invalid reports before transport access', async () => {
    await expect(deliverFeedbackReport({ ...input, description: '' })).rejects.toThrow('Invalid');
    expect(sdk.captureEvent).not.toHaveBeenCalled();
  });
});
