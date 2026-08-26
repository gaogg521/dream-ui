/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Take me to the model that just failed" — a one-shot navigation intent from
 * a failed media job card straight to that model's settings row.
 *
 * Same read-once module-level variable idiom as `useDeepLink.ts`'s
 * `pendingDeepLinkData`, kept separate rather than reused: that module is
 * specifically for OS-level `dream://` deep links, and this is a plain
 * in-app button click with nothing to do with the deep-link protocol.
 */

let pendingProviderId: string | null = null;

export const requestModelSettingsHighlight = (providerId: string): void => {
  pendingProviderId = providerId;
};

/** Read and clear. Returns null once already consumed. */
export const consumeModelSettingsHighlight = (): string | null => {
  const id = pendingProviderId;
  pendingProviderId = null;
  return id;
};
