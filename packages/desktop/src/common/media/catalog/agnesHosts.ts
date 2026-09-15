/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agnes AI serves the same API from two hosts, and a catalog entry that knows
 * only one of them silently disables the vendor.
 *
 * `agnes-ai.com` is what the international docs print; `agnes-ai.cn` is what
 * the Chinese docs print and what an account created there is actually issued.
 * They are not interchangeable per key — measured 2026-09-15 with the key
 * configured in this app, `POST /v1/videos`:
 *
 *   apihub.agnes-ai.com -> 401 {"message":"Invalid token"}
 *   api.agnes-ai.cn     -> 200 {"video_id":"task_…","status":"queued"}
 *
 * Every Agnes entry matched on `agnes-ai.com` alone, so a `.cn` provider
 * matched nothing: `resolveMediaModelSpec` returned null, which hides a video
 * model from the picker outright and drops an image model onto the generic
 * OpenAI body — the exact shape Agnes rejects four different ways (see
 * `agnesImage.ts`). Both the Agnes-specific request shaping and the model's
 * visibility hang on this list, so it is kept in one place rather than spelled
 * out per entry.
 *
 * Matching is a substring test against the configured `base_url`, so these
 * cover `api.`, `apihub.` and any other subdomain on the same registrable
 * domain without enumerating them.
 */
export const AGNES_HOSTS = ['agnes-ai.com', 'agnes-ai.cn'];
