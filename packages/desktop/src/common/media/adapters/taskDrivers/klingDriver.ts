/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Kuaishou Kling video API.
 *
 * The one vendor here that does not take a bearer API key: it authenticates
 * with a short-lived JWT signed by an access-key/secret pair. The app's
 * provider record has a single `api_key` field, so the pair is carried in it as
 * `accessKey:secretKey` (`|` and whitespace also accepted, since users paste
 * these in whatever shape the console showed them).
 *
 * Signing uses Web Crypto rather than `node:crypto` so this file stays
 * environment-agnostic like every other driver.
 *
 * Text-to-video and image-to-video are different endpoints here, not a flag on
 * one endpoint, so the reference image decides which is called.
 */

import {
  readJsonOrThrow,
  type TaskDriver,
  type TaskPollContext,
  type TaskPollResult,
  type TaskResultItem,
  type TaskSubmitContext,
} from './types';

const DEFAULT_ROOT = 'https://api.klingai.com';

/** Kling has its own host; a chat base_url would be the wrong root entirely. */
const apiRoot = (baseUrl: string): string => {
  const trimmed = (baseUrl || '').replace(/\/+$/, '');
  return trimmed.includes('kling') ? trimmed : DEFAULT_ROOT;
};

const base64Url = (input: string | Uint8Array): string => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa exists in Electron's renderer and in Node 16+.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Split the console-provided credential pair out of the single api_key field. */
export const parseKlingCredentials = (apiKey: string): { accessKey: string; secretKey: string } | null => {
  const parts = (apiKey || '')
    .split(/[:|\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { accessKey: parts[0], secretKey: parts[1] };
};

/**
 * Build Kling's short-lived JWT. `nbf` is backdated a few seconds because the
 * vendor rejects tokens whose not-before is even marginally in the future
 * relative to their clock.
 */
export const buildKlingToken = async (accessKey: string, secretKey: string, nowMs: number): Promise<string> => {
  const nowSec = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iss: accessKey, exp: nowSec + 1800, nbf: nowSec - 5 }));
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
};

const authHeaders = async (apiKey: string): Promise<Record<string, string>> => {
  const credentials = parseKlingCredentials(apiKey);
  if (!credentials) {
    throw new Error(
      'Kling needs an access key and a secret key. Enter them in the API key field as "accessKey:secretKey".'
    );
  }
  const token = await buildKlingToken(credentials.accessKey, credentials.secretKey, Date.now());
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
};

/** Image-to-video is a separate endpoint, so the reference image picks the path. */
const submitPath = (hasImage: boolean): string => (hasImage ? '/v1/videos/image2video' : '/v1/videos/text2video');

export const klingDriver: TaskDriver = {
  id: 'kling',

  async submit(ctx: TaskSubmitContext): Promise<{ taskId: string }> {
    const reference = ctx.params.firstFrameImage || ctx.inputs[0];
    const body: Record<string, unknown> = { model_name: ctx.model, prompt: ctx.prompt };
    if (ctx.params.durationSeconds) body.duration = String(ctx.params.durationSeconds);
    if (ctx.params.aspectRatio) body.aspect_ratio = ctx.params.aspectRatio;
    if (ctx.params.negativePrompt) body.negative_prompt = ctx.params.negativePrompt;
    if (ctx.params.camera && ctx.params.camera !== 'none') {
      body.camera_control = { type: ctx.params.camera };
    }
    if (reference) body.image = reference;

    const response = await fetch(`${apiRoot(ctx.baseUrl)}${submitPath(!!reference)}`, {
      method: 'POST',
      headers: await authHeaders(ctx.apiKey),
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'Kling submission');
    // Kling reports business errors inside a 200 envelope.
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      throw new Error(`Kling submission failed: ${payload.message || `code ${payload.code}`}`);
    }
    const data = payload.data as { task_id?: string } | undefined;
    if (!data?.task_id) {
      throw new Error(`Kling submission returned no task id: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    return { taskId: data.task_id };
  },

  async poll(ctx: TaskPollContext, taskId: string): Promise<TaskPollResult> {
    // The query endpoint mirrors the submit endpoint, and by poll time we no
    // longer know which was used — text2video answers for both task kinds.
    const response = await fetch(`${apiRoot(ctx.baseUrl)}/v1/videos/text2video/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: await authHeaders(ctx.apiKey),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'Kling poll');
    if (payload.code !== undefined && Number(payload.code) !== 0) {
      return { state: 'failed', error: String(payload.message || `Kling error code ${payload.code}`) };
    }

    const data = payload.data as
      | {
          task_status?: string;
          task_status_msg?: string;
          task_result?: { videos?: Array<{ url?: string }> };
        }
      | undefined;
    const status = String(data?.task_status || '').toLowerCase();

    switch (status) {
      case 'submitted':
        return { state: 'pending' };
      case 'processing':
        return { state: 'running' };
      case 'succeed':
      case 'succeeded': {
        const items: TaskResultItem[] = (data?.task_result?.videos ?? [])
          .filter((video) => !!video.url)
          .map((video) => ({ url: video.url as string }));
        if (items.length === 0) {
          return { state: 'failed', error: 'Kling reported success but returned no video url' };
        }
        return { state: 'succeeded', items };
      }
      case 'failed':
        return { state: 'failed', error: data?.task_status_msg || 'Kling task failed' };
      default:
        return { state: 'running' };
    }
  },
};
