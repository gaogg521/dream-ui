/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NavigateFunction, NavigateOptions } from 'react-router-dom';

/**
 * Module-level handle to React Router's `navigate`, registered once by a
 * component mounted inside the Router (see `Layout`). This lets code that runs
 * *outside* the Router context — e.g. the globally-mounted FeedbackReportModal,
 * which lives above `<Router>` in the provider tree — trigger navigation
 * without calling `useNavigate()` during render (which would throw
 * "useNavigate() may be used only in the context of a <Router>").
 */
let navigateRef: NavigateFunction | null = null;

export const setGlobalNavigate = (navigate: NavigateFunction | null): void => {
  navigateRef = navigate;
};

/**
 * Navigate to a path from anywhere, including outside the Router tree. No-op
 * (with a console warning) if the Router hasn't mounted yet — callers treat
 * navigation as best-effort rather than a hard dependency.
 */
export const globalNavigate = (to: string, options?: NavigateOptions): void => {
  if (!navigateRef) {
    console.warn('[navigation] globalNavigate called before Router mounted; ignoring.');
    return;
  }
  navigateRef(to, options);
};

/**
 * Validate a post-login `redirect` target read from a URL query param and fall
 * back to `/guid` when it is missing or unsafe. Only in-app hash-router paths
 * are allowed: a single leading slash, no protocol/host (`//` or `scheme://`),
 * no backslashes. This closes the open-redirect vector while letting the WebUI
 * login honor entry points like `?redirect=/settings/enterprise`.
 */
export const resolveSafeRedirect = (raw: string | null | undefined, fallback = '/guid'): string => {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('://') || raw.includes('\\')) {
    return fallback;
  }
  return raw;
};
