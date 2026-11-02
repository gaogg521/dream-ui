/**
 * Copyright 2026 One Work
 */

import { CdnGenericProvider } from './cdnGenericProvider';
import type { CdnGenericProviderConfiguration } from './cdnGenericProvider';

// Fork's own Tencent COS buckets (public read), same layout the upstream CDN
// used: updater metadata (latest-arm64-mac.yml / latest-mac.yml / latest.yml /
// …) sits at each `releases/` base, and CdnGenericProvider.resolveFiles injects
// `{version}/` so installers resolve to `releases/{version}/{file}`. Never point
// this at the upstream static.dream.com CDN — that pulls upstream Dream UI builds
// onto forks. Publishing is done by scripts/publish-cos-release-asset.sh, which
// writes BOTH buckets.
//
// Two buckets run in parallel while installs migrate (2026-11-02):
//   - onework-1521070673  new bucket; preferred.
//   - 1onework-1251001122 legacy bucket; the only address builds shipped before
//     this change know about, so it must keep receiving every release until
//     those builds have aged out. Here it is the fallback.
// The provider asks every base for the channel manifest and takes the newest
// version, so a bucket that is unreachable (or was skipped by a one-sided
// publish) never hides an update that the other one carries.
export const CDN_UPDATE_BASE_URLS: readonly string[] = [
  'https://onework-1521070673.cos.ap-shanghai.myqcloud.com/releases',
  'https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases',
];

/** Preferred base (first in the list). */
export const CDN_UPDATE_BASE_URL = CDN_UPDATE_BASE_URLS[0];

/** Hostnames of every update base — the download allow-list is derived from this. */
export const CDN_UPDATE_HOSTS: readonly string[] = CDN_UPDATE_BASE_URLS.map((url) => new URL(url).hostname);

export type CdnFeedOptions = CdnGenericProviderConfiguration & {
  updateProvider: typeof CdnGenericProvider;
};

export function buildCdnFeedOptions(): CdnFeedOptions {
  return {
    provider: 'custom',
    url: CDN_UPDATE_BASE_URL,
    mirrors: CDN_UPDATE_BASE_URLS.slice(1),
    updateProvider: CdnGenericProvider,
  };
}
