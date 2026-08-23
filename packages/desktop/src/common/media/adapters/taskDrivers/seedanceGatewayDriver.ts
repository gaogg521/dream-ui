/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seedance behind a gateway that fronts it with its own task API.
 *
 * Not a variant of `ark-task` — three things differ structurally, which is why
 * this is a separate driver rather than a flag:
 *
 * 1. The routes live under `/api/seedance/*`, not `/v1/contents/generations/*`.
 * 2. **Polling is a POST with a JSON body** (`{id, model}`), not a GET on a
 *    path containing the id. The model has to be resent on every poll.
 * 3. Cancellation is `DELETE /api/seedance/task/{id}?model=...` — id in the
 *    path, model in the query.
 *
 * Generation options are ordinary JSON fields here (`resolution`, `ratio`,
 * `duration`, `generate_audio`), where Ark encodes them as `--flag` suffixes on
 * the prompt text. Sending Ark's decorated prompt to this API would put the
 * flags into the generated scene description.
 *
 * The shapes below come from a working request captured against a real
 * deployment, not from documentation.
 */

import { stripCompatSuffix } from './types';
import {
  readJsonOrThrow,
  type TaskDriver,
  type TaskPollContext,
  type TaskPollResult,
  type TaskResultItem,
  type TaskSubmitContext,
} from './types';

/**
 * The gateway root.
 *
 * `stripCompatSuffix` removes the `/v1` a chat-configured provider carries, so
 * the same credentials and host serve both. Unlike the Ark driver this must NOT
 * add a version segment — these routes sit directly under the host.
 */
const apiRoot = (baseUrl: string): string => stripCompatSuffix(baseUrl);

const headers = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
});

export const seedanceGatewayDriver: TaskDriver = {
  id: 'seedance-gateway',

  async submit(ctx: TaskSubmitContext): Promise<{ taskId: string }> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: ctx.prompt }];

    const firstFrame = ctx.params.firstFrameImage || ctx.inputs[0];
    if (firstFrame) {
      content.push({ type: 'image_url', image_url: { url: firstFrame }, role: 'first_frame' });
    }
    if (ctx.params.lastFrameImage) {
      content.push({ type: 'image_url', image_url: { url: ctx.params.lastFrameImage }, role: 'last_frame' });
    }

    // Only fields the caller actually chose are sent: the gateway has its own
    // defaults, and inventing values here would silently override them.
    const body: Record<string, unknown> = { model: ctx.model, content };
    if (ctx.params.resolution) body.resolution = ctx.params.resolution;
    if (ctx.params.aspectRatio) body.ratio = ctx.params.aspectRatio;
    if (ctx.params.durationSeconds) body.duration = ctx.params.durationSeconds;
    if (ctx.params.generateAudio !== undefined) body.generate_audio = ctx.params.generateAudio;
    if (ctx.params.seed !== undefined) body.seed = ctx.params.seed;

    const response = await fetch(`${apiRoot(ctx.baseUrl)}/api/seedance/createVideo`, {
      method: 'POST',
      headers: headers(ctx.apiKey),
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'Seedance task submission');
    const taskId = payload.id as string | undefined;
    if (!taskId) {
      throw new Error(`Seedance task submission returned no id: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    return { taskId };
  },

  async poll(ctx: TaskPollContext, taskId: string): Promise<TaskPollResult> {
    const response = await fetch(`${apiRoot(ctx.baseUrl)}/api/seedance/getVideoResult`, {
      method: 'POST',
      headers: headers(ctx.apiKey),
      // The model travels with every poll — this API keys the lookup on the
      // pair, not on the id alone.
      body: JSON.stringify({ id: taskId, model: ctx.model }),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'Seedance task poll');
    const status = String(payload.status || '').toLowerCase();
    const error = payload.error as { message?: string } | undefined;

    switch (status) {
      case 'queued':
      case 'pending':
        return { state: 'pending' };
      case 'succeeded': {
        const content = payload.content as { video_url?: string; image_url?: string } | undefined;
        const items: TaskResultItem[] = [];
        if (content?.video_url) items.push({ url: content.video_url });
        if (content?.image_url) items.push({ url: content.image_url });
        if (items.length === 0) {
          return { state: 'failed', error: 'Seedance reported success but returned no video' };
        }
        return { state: 'succeeded', items };
      }
      case 'failed':
      case 'cancelled':
      case 'canceled':
      case 'expired':
        return { state: 'failed', error: error?.message || `Seedance task ${status}` };
      default:
        // Anything else (`running`, and any status this gateway adds later) is
        // still in flight. Treating an unknown status as failure would abandon
        // a task that is about to succeed — and one already paid for.
        return { state: 'running' };
    }
  },

  async cancel(ctx: TaskPollContext, taskId: string): Promise<void> {
    const url = `${apiRoot(ctx.baseUrl)}/api/seedance/task/${encodeURIComponent(taskId)}?model=${encodeURIComponent(ctx.model)}`;
    await fetch(url, { method: 'DELETE', headers: headers(ctx.apiKey) }).catch(() => {
      // Best effort: the job is already being torn down locally.
    });
  },
};
