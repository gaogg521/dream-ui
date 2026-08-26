/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Zhipu CogVideoX async video API.
 *
 * Submission and polling live on different paths (`/videos/generations` then
 * `/async-result/{id}`) rather than the usual `.../tasks/{id}` shape, and the
 * status vocabulary is upper-case, so both are spelled out here.
 *
 * The provider is normally configured for chat at `.../api/paas/v4`, which is
 * also the root for these endpoints — credentials carry over untouched.
 */

import { ensureVersionedBaseUrl } from '../baseUrl';
import {
  readJsonOrThrow,
  type TaskDriver,
  type TaskPollContext,
  type TaskPollResult,
  type TaskResultItem,
  type TaskSubmitContext,
} from './types';

const apiRoot = (baseUrl: string): string => ensureVersionedBaseUrl(baseUrl) || 'https://open.bigmodel.cn/api/paas/v4';

const headers = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
});

export const cogvideoxDriver: TaskDriver = {
  id: 'cogvideox',

  async submit(ctx: TaskSubmitContext): Promise<{ taskId: string }> {
    const body: Record<string, unknown> = { model: ctx.model, prompt: ctx.prompt };
    if (ctx.params.durationSeconds) body.duration = ctx.params.durationSeconds;
    if (ctx.params.resolution) body.size = ctx.params.resolution;
    if (ctx.params.seed !== undefined) body.seed = ctx.params.seed;

    const reference = ctx.params.firstFrameImage || ctx.inputs[0];
    if (reference) body.image_url = reference;

    const response = await fetch(`${apiRoot(ctx.baseUrl)}/videos/generations`, {
      method: 'POST',
      headers: headers(ctx.apiKey),
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'CogVideoX submission');
    const taskId = (payload.id as string | undefined) || (payload.request_id as string | undefined);
    if (!taskId) {
      throw new Error(`CogVideoX submission returned no id: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    return { taskId };
  },

  async poll(ctx: TaskPollContext, taskId: string): Promise<TaskPollResult> {
    const response = await fetch(`${apiRoot(ctx.baseUrl)}/async-result/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: headers(ctx.apiKey),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'CogVideoX poll');
    const status = String(payload.task_status || '').toUpperCase();

    switch (status) {
      case 'PROCESSING':
        return { state: 'running' };
      case 'SUCCESS': {
        const results = (payload.video_result as Array<{ url?: string; cover_image_url?: string }> | undefined) ?? [];
        const items: TaskResultItem[] = results
          .filter((entry) => !!entry.url)
          .map((entry) => ({ url: entry.url as string }));
        if (items.length === 0) {
          return { state: 'failed', error: 'CogVideoX reported success but returned no video url' };
        }
        return { state: 'succeeded', items };
      }
      case 'FAIL':
      case 'FAILED':
        return { state: 'failed', error: String(payload.message || 'CogVideoX task failed') };
      default:
        return { state: 'running' };
    }
  },
};
