import { randomUUID } from 'node:crypto';
import type { FeedbackReceipt, FeedbackSubmission } from '@/common/types/feedbackDiagnostics';

/** Resolve only after the main-process transport receives an upstream acknowledgement. */
export async function deliverFeedbackReport(input: FeedbackSubmission, timeoutMs = 10000): Promise<FeedbackReceipt> {
  if (
    !input ||
    typeof input.module !== 'string' ||
    !input.module.trim() ||
    input.module.length > 100 ||
    typeof input.description !== 'string' ||
    !input.description.trim() ||
    input.description.length > 2000 ||
    typeof input.message !== 'string' ||
    input.message.length > 300
  )
    throw new Error('Invalid feedback report');
  if (
    !Array.isArray(input.attachments) ||
    input.attachments.length > 5 ||
    input.attachments.some(
      (a) =>
        !a ||
        typeof a.filename !== 'string' ||
        a.filename.length > 255 ||
        !(a.data instanceof Uint8Array) ||
        typeof a.contentType !== 'string'
    ) ||
    input.attachments.reduce((size, a) => size + a.data.byteLength, 0) > 25 * 1024 * 1024
  )
    throw new Error('Feedback attachments exceed the limit');
  const Sentry = await import('@sentry/electron/main');
  const client = Sentry.getClient();
  if (!client?.getDsn() || client.getOptions().enabled === false || !client.getTransport())
    throw new Error('Feedback delivery is not configured');
  const eventId = randomUUID().replaceAll('-', '');
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const accepted = new Promise<FeedbackReceipt>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Feedback delivery acknowledgement timed out')), timeoutMs);
    unsubscribe = client.on('afterSendEvent', (event, response) => {
      if (event.event_id !== eventId) return;
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300)
        resolve({ eventId, acceptedAt: Date.now() });
      else reject(new Error('Feedback service did not accept the report'));
    });
  });
  try {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(input.tags ?? {}))
        if (typeof value === 'string') scope.setTag(key, value);
      scope.setTag('type', 'user-feedback');
      scope.setTag('module', input.module);
      if (input.contactEmail?.trim()) scope.setUser({ email: input.contactEmail.trim() });
      Sentry.captureEvent(
        {
          event_id: eventId,
          level: 'info',
          message: input.message,
          extra: { ...input.extra, description: input.description },
        },
        { attachments: input.attachments.map((a) => ({ ...a, data: new Uint8Array(a.data) })) }
      );
    });
    const [receipt] = await Promise.all([
      accepted,
      client.flush(timeoutMs).then((flushed) => {
        if (!flushed) throw new Error('Feedback delivery did not complete');
      }),
    ]);
    return receipt;
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}
