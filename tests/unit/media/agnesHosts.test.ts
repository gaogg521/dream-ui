/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agnes serves the same API from `agnes-ai.com` and `agnes-ai.cn`, and every
 * catalog entry knew only the first one.
 *
 * A key is issued against one host and rejected by the other — measured
 * 2026-09-15 with a real `.cn` key, the same `POST /v1/videos` body answered
 * `401 Invalid token` at `apihub.agnes-ai.com` and `200 queued` at
 * `api.agnes-ai.cn`. So a Chinese account can only be configured with the `.cn`
 * base_url, and `baseUrlIncludes: ['agnes-ai.com']` then matched nothing:
 *
 *   - video resolved to null, which hides the model from the picker entirely
 *     (video refuses to guess an endpoint style), and
 *   - image fell through to the generic OpenAI entry, which sends the body
 *     Agnes rejects in four separate ways — including the top-level `image`
 *     that answers `400 LLM Provider NOT provided`.
 *
 * That last part is why this matters beyond one missing string: all of the
 * Agnes-specific request shaping is downstream of resolution, so a host the
 * catalog does not recognise silently turns every one of those fixes off.
 */

import { describe, expect, it } from 'vitest';
import { AGNES_HOSTS } from '@/common/media/catalog/agnesHosts';
import { resolveMediaModelSpec } from '@/common/media/catalog/resolve';

/** Both spellings of the vendor, as a user would actually configure them. */
const HOSTS = {
  cn: { platform: 'custom', base_url: 'https://api.agnes-ai.cn/v1', name: 'Agnes' },
  com: { platform: 'custom', base_url: 'https://apihub.agnes-ai.com/v1', name: 'Agnes' },
};

describe('Agnes host coverage', () => {
  it.each(Object.entries(HOSTS))('resolves every Agnes media model on the %s host', (_label, provider) => {
    expect(resolveMediaModelSpec('image', provider as never, 'agnes-image-2.5-flash')?.id).toBe('agnes-image');
    expect(resolveMediaModelSpec('video', provider as never, 'agnes-video-2.5-flash')?.id).toBe('agnes-video-25');
    expect(resolveMediaModelSpec('video', provider as never, 'agnes-video-v2.0')?.id).toBe('agnes-video');
  });

  it('still refuses an Agnes-named model served by somebody else', () => {
    // The host list widens which hosts are Agnes; it must not turn the match
    // into a name-only one. A relay with "agnes" in the model name would be
    // handed a body its own API does not understand, and the video driver
    // would send the request straight past it to the vendor.
    const relay = { platform: 'openai', base_url: 'https://relay.example.com/v1', name: 'Relay' };
    expect(resolveMediaModelSpec('image', relay as never, 'agnes-image-2.5-flash')?.id).not.toBe('agnes-image');
    expect(resolveMediaModelSpec('video', relay as never, 'agnes-video-2.5-flash')).toBeNull();
  });

  it('matches on the registrable domain so any subdomain is covered', () => {
    // `api.`, `apihub.` and whatever the vendor adds next all contain these.
    expect(AGNES_HOSTS).toEqual(['agnes-ai.com', 'agnes-ai.cn']);
    for (const host of AGNES_HOSTS) expect(host.startsWith('.')).toBe(false);
  });
});
