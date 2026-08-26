/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Branded label for a conversation's agent backend.
 *
 * A conversation stores the raw backend identifier ('dream', 'claude', …).
 * Capitalising that string is not a display name — it is an internal
 * identifier with a capital letter, which is how the chat header came to read
 * "DreamEngine" and the send box "DreamCLI" while the rest of the product says
 * "1ONE CLI".
 *
 * The branded name lives on the managed-agent catalog row (the dream entry
 * reads "1ONE CLI", set by migration 019), so resolve through the catalog and
 * never hardcode a label — the same rule `employeeDisplay` follows for the
 * digital-employee roster, which hit this first.
 */

import type { ManagedAgent } from '@renderer/utils/model/agentTypes';

/**
 * Look `backend` up in the catalog and return its product name.
 *
 * Returns `undefined` rather than a guess when the catalog has no row for it
 * (not loaded yet, or an agent uninstalled since): callers decide what to show
 * meanwhile, and a wrong-but-confident label is worse than none.
 */
export const resolveBackendLabel = (
  backend: string | undefined,
  catalog: ManagedAgent[] | undefined,
  localeKey = 'en-US'
): string | undefined => {
  if (!backend) return undefined;
  const row = (catalog || []).find((entry) => entry.backend === backend || entry.agent_type === backend);
  if (!row) return undefined;
  return row.name_i18n?.[localeKey] || row.name || undefined;
};
