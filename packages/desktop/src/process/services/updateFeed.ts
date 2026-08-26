/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { CdnGenericProvider } from './cdnGenericProvider';
import type { CdnGenericProviderConfiguration } from './cdnGenericProvider';

// Fork's own Tencent COS bucket (public read), same layout the upstream CDN
// used: updater metadata (latest-arm64-mac.yml / latest-mac.yml / latest.yml /
// …) sits at this `releases/` base, and CdnGenericProvider.resolveFiles injects
// `{version}/` so installers resolve to `releases/{version}/{file}`. Never point
// this at the upstream static.dream.com CDN — that pulls upstream Dream UI builds
// onto forks. Publishing is done by .github/workflows/release-distribute.yml.
export const CDN_UPDATE_BASE_URL = 'https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases';

export type CdnFeedOptions = CdnGenericProviderConfiguration & {
  updateProvider: typeof CdnGenericProvider;
};

export function buildCdnFeedOptions(): CdnFeedOptions {
  return {
    provider: 'custom',
    url: CDN_UPDATE_BASE_URL,
    updateProvider: CdnGenericProvider,
  };
}
