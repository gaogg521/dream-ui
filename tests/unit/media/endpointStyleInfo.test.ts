/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `ENDPOINT_STYLE_INFO` is what turns a raw `media_endpoint` id into a human
 * label and a host-mismatch hint in the settings UI. A style with no entry
 * here silently falls back to showing its bare id — not broken, but back to
 * the unhelpful state this file exists to fix. This pins the two id lists
 * that actually reach the picker (`IMPLEMENTED_ENDPOINT_STYLES` for video +
 * declared image styles, `SYNC_IMAGE_ENDPOINT_STYLES` for the synchronous
 * image-only styles) against the metadata map, so adding a new driver without
 * adding its metadata fails a test instead of shipping a silently bare label.
 */

import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_ENDPOINT_STYLES, SYNC_IMAGE_ENDPOINT_STYLES } from '@/common/media/catalog/resolve';
import { diagnoseEndpointMismatch, ENDPOINT_STYLE_INFO } from '@/common/media/catalog/endpointStyleInfo';

describe('ENDPOINT_STYLE_INFO', () => {
  it('has an entry for every implemented (video/task) endpoint style', () => {
    for (const style of IMPLEMENTED_ENDPOINT_STYLES) {
      expect(ENDPOINT_STYLE_INFO[style], `missing metadata for "${style}"`).toBeDefined();
    }
  });

  it('has an entry for every synchronous image-only endpoint style', () => {
    for (const style of SYNC_IMAGE_ENDPOINT_STYLES) {
      expect(ENDPOINT_STYLE_INFO[style], `missing metadata for "${style}"`).toBeDefined();
    }
  });

  it('gives every entry a label and description key', () => {
    for (const [id, info] of Object.entries(ENDPOINT_STYLE_INFO)) {
      expect(info.labelKey, `${id} missing labelKey`).toBeTruthy();
      expect(info.descriptionKey, `${id} missing descriptionKey`).toBeTruthy();
    }
  });

  it('marks host-agnostic and gateway styles as such instead of giving them false host hints', () => {
    expect(ENDPOINT_STYLE_INFO.kling.hostAgnostic).toBe(true);
    expect(ENDPOINT_STYLE_INFO.kling.hostHints).toBeUndefined();
    expect(ENDPOINT_STYLE_INFO['seedream-gateway'].gatewayStyle).toBe(true);
    expect(ENDPOINT_STYLE_INFO['seedream-gateway'].hostHints).toBeUndefined();
    expect(ENDPOINT_STYLE_INFO['seedance-gateway'].gatewayStyle).toBe(true);
  });

  it('gives fixed-host styles at least one host hint', () => {
    for (const id of ['ark-task', 'dashscope-task', 'openai-video', 'cogvideox']) {
      expect(ENDPOINT_STYLE_INFO[id].hostHints?.length, `${id} should carry host hints`).toBeGreaterThan(0);
    }
  });
});

describe('diagnoseEndpointMismatch', () => {
  /**
   * The real case that surfaced this feature (2026-08-10): a model's real
   * host is Ark's official direct endpoint, but the provider's `media_endpoint`
   * override was left pointed at `seedream-gateway` — a style with no fixed
   * host by design. That combination has no host to compare, so this must
   * fall into `gatewayStyle`, not silently report "no problem".
   */
  it('flags a gateway-only style regardless of base_url', () => {
    expect(diagnoseEndpointMismatch('seedream-gateway', 'https://ark.cn-beijing.volces.com/api/v3')).toEqual({
      kind: 'gatewayStyle',
    });
    expect(diagnoseEndpointMismatch('seedance-gateway', undefined)).toEqual({ kind: 'gatewayStyle' });
  });

  it('flags kling as host-agnostic no matter what base_url is configured', () => {
    expect(diagnoseEndpointMismatch('kling', 'https://api.klingai.com')).toEqual({ kind: 'hostAgnostic' });
    expect(diagnoseEndpointMismatch('kling', 'https://ark.cn-beijing.volces.com/api/v3')).toEqual({
      kind: 'hostAgnostic',
    });
  });

  it('flags a fixed-host style whose base_url does not contain the expected host', () => {
    expect(diagnoseEndpointMismatch('ark-task', 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toEqual({
      kind: 'hostMismatch',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      hints: ['volces.com'],
    });
  });

  it('stays silent when the base_url matches (case-insensitively)', () => {
    expect(diagnoseEndpointMismatch('ark-task', 'https://ARK.cn-beijing.volces.com/api/v3')).toBeNull();
    expect(diagnoseEndpointMismatch('dashscope-task', 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toBeNull();
  });

  it('stays silent for an unknown style id, and flags a fixed-host style with no base_url at all', () => {
    expect(diagnoseEndpointMismatch('not-a-real-style', 'https://anything.example.com')).toBeNull();
    // An empty base_url can't contain any hint either — same soft-warning
    // treatment as a wrong one, not a special no-signal case.
    expect(diagnoseEndpointMismatch('ark-task', undefined)).toEqual({
      kind: 'hostMismatch',
      baseUrl: '',
      hints: ['volces.com'],
    });
  });
});
