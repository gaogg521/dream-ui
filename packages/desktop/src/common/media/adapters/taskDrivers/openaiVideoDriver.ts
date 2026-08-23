/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAI Videos API (Sora), and the OpenAI-compatible gateways that proxy it.
 *
 * Two things set this apart from the other task drivers:
 *
 * 1. The finished video is not a public URL. It is served from
 *    `/videos/{id}/content` behind the same bearer token as the rest of the
 *    API, which is why the result item carries auth headers.
 * 2. Progress is a real number here (`progress`), not just a stage, so the
 *    percentage is passed through instead of being invented.
 */

import { ensureVersionedBaseUrl } from '../baseUrl';
import {
  readJsonOrThrow,
  type TaskDriver,
  type TaskPollContext,
  type TaskPollResult,
  type TaskSubmitContext,
} from './types';

const apiRoot = (baseUrl: string): string => ensureVersionedBaseUrl(baseUrl) || 'https://api.openai.com/v1';

const authHeaders = (apiKey: string): Record<string, string> => ({ Authorization: `Bearer ${apiKey}` });

const jsonHeaders = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...authHeaders(apiKey),
});

export const openaiVideoDriver: TaskDriver = {
  id: 'openai-video',

  async submit(ctx: TaskSubmitContext): Promise<{ taskId: string }> {
    const body: Record<string, unknown> = { model: ctx.model, prompt: ctx.prompt };
    // The API spells duration `seconds` and takes it as a string.
    if (ctx.params.durationSeconds) body.seconds = String(ctx.params.durationSeconds);
    if (ctx.params.size) body.size = ctx.params.size;

    const reference = ctx.params.firstFrameImage || ctx.inputs[0];
    if (reference) body.input_reference = reference;

    const response = await fetch(`${apiRoot(ctx.baseUrl)}/videos`, {
      method: 'POST',
      headers: jsonHeaders(ctx.apiKey),
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'OpenAI video submission');
    const taskId = payload.id as string | undefined;
    if (!taskId) {
      throw new Error(`OpenAI video submission returned no id: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    return { taskId };
  },

  async poll(ctx: TaskPollContext, taskId: string): Promise<TaskPollResult> {
    const response = await fetch(`${apiRoot(ctx.baseUrl)}/videos/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: jsonHeaders(ctx.apiKey),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'OpenAI video poll');
    const status = String(payload.status || '').toLowerCase();
    const percent = typeof payload.progress === 'number' ? payload.progress : undefined;

    switch (status) {
      case 'queued':
        return { state: 'pending' };
      case 'in_progress':
      case 'processing':
        return { state: 'running', percent };
      case 'completed': {
        const error = payload.error as { message?: string } | undefined;
        if (error?.message) return { state: 'failed', error: error.message };
        return {
          state: 'succeeded',
          items: [
            {
              url: `${apiRoot(ctx.baseUrl)}/videos/${encodeURIComponent(taskId)}/content`,
              headers: authHeaders(ctx.apiKey),
            },
          ],
        };
      }
      case 'failed':
      case 'cancelled':
      case 'canceled': {
        const error = payload.error as { message?: string } | undefined;
        return { state: 'failed', error: error?.message || `OpenAI video task ${status}` };
      }
      default:
        // Unknown states are treated as still running; the shared timeout is
        // what bounds this, rather than guessing a vendor's vocabulary.
        return { state: 'running', percent };
    }
  },

  async cancel(ctx: TaskPollContext, taskId: string): Promise<void> {
    await fetch(`${apiRoot(ctx.baseUrl)}/videos/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      headers: jsonHeaders(ctx.apiKey),
    }).catch(() => {
      // Best effort: the job is already being torn down locally.
    });
  },
};
