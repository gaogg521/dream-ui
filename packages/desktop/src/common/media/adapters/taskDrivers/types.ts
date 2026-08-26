/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form C task drivers describe ONLY what differs between vendors: where to
 * submit, how to read a status response, where the result lives. The polling
 * loop, backoff, timeout, download and persistence are shared (taskPollAdapter).
 */

import type { MediaGenParams, MediaKind } from '../../types';
import type { MediaModelSpec } from '../../catalog/types';

export type TaskSubmitContext = {
  kind: MediaKind;
  prompt: string;
  params: MediaGenParams;
  /** Reference inputs already normalized to HTTP URLs or data URLs. */
  inputs: string[];
  model: string;
  /** Provider base_url exactly as configured (usually a chat endpoint). */
  baseUrl: string;
  apiKey: string;
  spec: MediaModelSpec;
  signal?: AbortSignal;
};

export type TaskPollContext = Omit<TaskSubmitContext, 'prompt' | 'params' | 'inputs'>;

/**
 * One result item; exactly one of url/b64 is set.
 *
 * `headers` exists because not every vendor hands back a public URL: some
 * expose the result as an authenticated download on their own API (OpenAI's
 * `/videos/{id}/content`, and Azure-style deployments generally). Without it a
 * driver would have to pull the bytes itself and hand back base64, ballooning
 * a whole video in memory for no reason.
 */
export type TaskResultItem = { url?: string; b64?: string; headers?: Record<string, string> };

export type TaskPollResult =
  | { state: 'pending' }
  | { state: 'running'; percent?: number }
  | { state: 'succeeded'; items: TaskResultItem[] }
  | { state: 'failed'; error: string };

export interface TaskDriver {
  readonly id: string;
  submit(ctx: TaskSubmitContext): Promise<{ taskId: string }>;
  poll(ctx: TaskPollContext, taskId: string): Promise<TaskPollResult>;
  /** Best-effort remote cancellation; absent when the vendor has no such endpoint. */
  cancel?(ctx: TaskPollContext, taskId: string): Promise<void>;
}

/** `1024x1024` → `1024*1024` (DashScope's spelling). */
export const toStarSize = (size?: string): string | undefined => size?.replace(/x/i, '*');

/** Strip an OpenAI-compatibility suffix to get the vendor's API root. */
export const stripCompatSuffix = (baseUrl: string): string =>
  baseUrl
    .replace(/\/+$/, '')
    .replace(/\/compatible-mode\/v1$/i, '')
    .replace(/\/v1$/i, '');

export async function readJsonOrThrow(response: Response, what: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    // Include a short body slice: vendor task APIs put the actionable reason
    // (quota, unsupported size, content policy) there, not in the status text.
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // ignore
    }
    throw new Error(`${what} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  // A 2xx does not guarantee a JSON body: an OpenAI-shaped gateway can answer
  // 200 with an empty body for a path it does not route at all.
  //
  // An earlier version of this message blamed the API key ("not entitled to this
  // model"). That was wrong, and the correction matters because it points at a
  // different fix: probing a real deployment with a *valid* key showed that a
  // deliberately non-existent path (`/v1/zzz-not-a-real-endpoint-9f3a`) answers
  // 200-empty exactly like the task endpoints do, while routed paths answer a
  // real validation error. So an empty body says "this gateway does not proxy
  // this API" — no key will change that, and the resolution is to point the
  // model at an endpoint that serves it.
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      `${what} failed: the endpoint returned HTTP ${response.status} with an empty body, ` +
        'which is how this gateway answers a path it does not route. It does not proxy ' +
        'this generation API, so a different key will not help — point this model at an ' +
        'endpoint that serves it.'
    );
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${what} failed: expected JSON but got — ${text.slice(0, 300)}`);
  }
}
