/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill list / import-history / detail paths.
 *
 * These used to be resolved from the current pathname, because skills were
 * reachable both standalone and as a tab of the merged "Capabilities" page. That
 * page is gone (its routes now redirect here), so there is a single entry point
 * and the paths are constant.
 */
export const SKILLS_ROUTES = {
  listPath: '/settings/skills',
  importHistoryPath: '/settings/skills/import-history',
  detailPath: (name: string) => `/settings/skills/detail/${encodeURIComponent(name)}`,
} as const;
