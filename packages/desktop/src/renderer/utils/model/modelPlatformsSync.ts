/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pulls the canonical model platform preset list from dream-core
 * (`GET /api/model-platforms`, see `dream-core-system::model_platforms`) and
 * merges it into the local `MODEL_PLATFORMS` array in place, so a platform
 * added on the backend reaches this picker without a frontend release.
 *
 * dream-en's admin console keeps its own copy (`console/components/
 * modelPlatformPresets.ts`, decoupled SPA in a separate repo) and syncs from
 * the same endpoint — see that file's `modelPlatformsSync.ts` counterpart.
 *
 * Deliberately additive and best-effort: `MODEL_PLATFORMS`'s hardcoded
 * literal is the fallback whenever the backend is unreachable or predates
 * this endpoint (offline use, an install mid-upgrade) — every existing call
 * site that reads `MODEL_PLATFORMS` keeps working unchanged either way, and
 * a failed sync is silent rather than surfaced as an error the user did
 * nothing to cause.
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import { buildLogoAssetUrl, MODEL_PLATFORMS, type PlatformConfig, type PlatformType } from './modelPlatforms';

type BackendModelPlatformPreset = {
  name: string;
  value: string;
  platform: string;
  base_url?: string;
  logo_path?: string;
  i18n_key?: string;
};

const KNOWN_PLATFORM_TYPES: readonly PlatformType[] = [
  'gemini',
  'gemini-vertex-ai',
  'anthropic',
  'custom',
  'new-api',
  'bedrock',
  'ollama',
];

const isKnownPlatformType = (value: string): value is PlatformType =>
  (KNOWN_PLATFORM_TYPES as readonly string[]).includes(value);

/**
 * `null` when the backend sent a protocol family this build predates — an
 * older client talking to a newer backend that has grown a platform type its
 * engine doesn't know how to dispatch yet. Skipping it is safer than showing
 * a picker entry that can never produce a working provider.
 */
const toPlatformConfig = (preset: BackendModelPlatformPreset): PlatformConfig | null => {
  if (!isKnownPlatformType(preset.platform)) {
    return null;
  }
  return {
    name: preset.name,
    value: preset.value,
    logo: preset.logo_path ? buildLogoAssetUrl(preset.logo_path) : null,
    platform: preset.platform,
    base_url: preset.base_url,
    i18nKey: preset.i18n_key,
  };
};

/**
 * Merges `incoming` into `target` in place, keyed by `value`: updates an
 * existing entry, appends anything new. A plain, exported function so the
 * part actually worth testing — the merge semantics — doesn't need a mocked
 * `fetch` to exercise.
 */
export function mergeModelPlatformPresets(target: PlatformConfig[], incoming: PlatformConfig[]): void {
  const indexByValue = new Map(target.map((preset, index) => [preset.value, index]));
  for (const preset of incoming) {
    const existingIndex = indexByValue.get(preset.value);
    if (existingIndex !== undefined) {
      target[existingIndex] = preset;
    } else {
      indexByValue.set(preset.value, target.length);
      target.push(preset);
    }
  }
}

let syncStarted = false;

/**
 * Fire-and-forget: call once at app startup. Never throws — a stale or
 * unreachable backend just means the picker keeps showing the built-in list
 * until the next successful sync.
 */
export async function syncModelPlatformsFromBackend(): Promise<void> {
  if (syncStarted) return;
  syncStarted = true;
  try {
    const response = await httpRequest<{ platforms: BackendModelPlatformPreset[] }>('GET', '/api/model-platforms');
    const mapped = response.platforms.map(toPlatformConfig).filter((preset): preset is PlatformConfig => preset !== null);
    mergeModelPlatformPresets(MODEL_PLATFORMS, mapped);
  } catch (error) {
    console.debug('[modelPlatformsSync] backend fetch failed, keeping the built-in preset list', error);
  }
}
