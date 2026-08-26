/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ httpRequest: vi.fn() }));

// The gate deliberately does NOT go through `httpBridge`: that module reads
// renderer localStorage to pick local-vs-remote, which the main process cannot
// see, so from here it always resolved to the member's own local backend where
// the company does not exist. See `process/services/governanceEndpoint.ts`.
vi.mock('@process/services/governanceEndpoint', () => ({ governanceFetch: hooks.httpRequest }));

const { checkMediaPolicy, reportMediaUsage, reportMediaAsset } = await import('@process/services/mediaJob/governance');

afterEach(() => {
  hooks.httpRequest.mockReset();
});

describe('checkMediaPolicy', () => {
  it('allows when the backend allows', async () => {
    hooks.httpRequest.mockResolvedValueOnce({ allow: true });
    await expect(checkMediaPolicy('video', 'seedance-2-0-fast')).resolves.toEqual({ allow: true });

    const [method, path, body] = hooks.httpRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/api/one/billing/media-precheck');
    expect(body).toEqual({ kind: 'video', model: 'seedance-2-0-fast' });
  });

  it('blocks with the reason the policy gave', async () => {
    hooks.httpRequest.mockResolvedValueOnce({
      allow: false,
      reason: 'video generation blocked by company policy: model not allowed',
    });
    const decision = await checkMediaPolicy('video', 'sora-2');
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain('not allowed');
  });

  it('still blocks when a denial arrives without a reason', async () => {
    hooks.httpRequest.mockResolvedValueOnce({ allow: false });
    const decision = await checkMediaPolicy('image', 'gpt-image-2');
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  // A refusal must mean "policy said no", not "the request did not get through".
  // Failing closed here would take media generation down for every personal
  // user the moment this endpoint hiccups, to enforce a policy they don't have.
  it('fails open when the endpoint is unreachable', async () => {
    hooks.httpRequest.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(checkMediaPolicy('image', 'gpt-image-2')).resolves.toEqual({ allow: true });
  });

  it('treats a malformed answer as permissive rather than guessing', async () => {
    hooks.httpRequest.mockResolvedValueOnce(undefined);
    await expect(checkMediaPolicy('image', 'gpt-image-2')).resolves.toEqual({ allow: true });
  });
});

describe('reportMediaUsage', () => {
  it('reports what was actually produced', async () => {
    hooks.httpRequest.mockResolvedValueOnce({});
    await reportMediaUsage('image', 'gpt-image-2', 3);

    const [, path, body] = hooks.httpRequest.mock.calls[0];
    expect(path).toBe('/api/one/billing/media-usage');
    expect(body).toEqual({ kind: 'image', model: 'gpt-image-2', count: 3, durationSeconds: 0 });
  });

  it('carries video duration so per-second pricing is right', async () => {
    hooks.httpRequest.mockResolvedValueOnce({});
    await reportMediaUsage('video', 'seedance-2-0-fast', 1, 10);
    expect(hooks.httpRequest.mock.calls[0][2]).toMatchObject({ durationSeconds: 10 });
  });

  // A generation started from the compose box writes no conversation message,
  // so this is the only trail it leaves in the company ledger. Without it an
  // admin sees a charge attached to nothing.
  it('attributes the spend to the conversation it came from', async () => {
    hooks.httpRequest.mockResolvedValueOnce({});
    await reportMediaUsage('image', 'gpt-image-2', 1, undefined, undefined, 'conv_abc');
    expect(hooks.httpRequest.mock.calls[0][2]).toMatchObject({ conversationId: 'conv_abc' });
  });

  it('omits the conversation rather than sending an empty one', async () => {
    hooks.httpRequest.mockResolvedValueOnce({});
    await reportMediaUsage('image', 'gpt-image-2', 1, undefined, undefined, '');
    expect(hooks.httpRequest.mock.calls[0][2]).not.toHaveProperty('conversationId', '');
  });

  // The media is already produced and saved; failing the job over a bookkeeping
  // call would throw away work the user already paid the provider for.
  it('never throws when reporting fails', async () => {
    hooks.httpRequest.mockRejectedValueOnce(new Error('offline'));
    await expect(reportMediaUsage('video', 'seedance-2-0-fast', 1, 5)).resolves.toBeUndefined();
  });
});

// T8: the consolidated ledger — distinct from `reportMediaUsage` above
// (cost/attribution only). This is additive: it reports the FILE, and the
// prompt it sends is always the true one, since retention is a server-side
// decision, never a client-side one.
describe('reportMediaAsset', () => {
  it('reports the generated file to the ledger endpoint', async () => {
    hooks.httpRequest.mockResolvedValueOnce({});
    await reportMediaAsset('image', 'gpt-image-2', '/workspace/img-1.png', 'a cat in a hat', 'conv_abc');

    const [method, path, body] = hooks.httpRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/api/one/billing/media-ledger/report');
    expect(body).toEqual({
      kind: 'image',
      model: 'gpt-image-2',
      filePath: '/workspace/img-1.png',
      prompt: 'a cat in a hat',
      conversationId: 'conv_abc',
    });
  });

  it('omits an empty prompt/conversation rather than sending empty strings', async () => {
    hooks.httpRequest.mockResolvedValueOnce({});
    await reportMediaAsset('video', 'seedance-2-0-fast', '/workspace/vid-1.mp4', '', '');
    const body = hooks.httpRequest.mock.calls[0][2];
    expect(body).not.toHaveProperty('prompt', '');
    expect(body).not.toHaveProperty('conversationId', '');
  });

  // The file already exists on disk; a ledger-bookkeeping failure must not
  // read as a failed generation, same reasoning as `reportMediaUsage`.
  it('never throws when reporting fails', async () => {
    hooks.httpRequest.mockRejectedValueOnce(new Error('offline'));
    await expect(reportMediaAsset('image', 'gpt-image-2', '/workspace/img-1.png', 'a cat')).resolves.toBeUndefined();
  });
});
