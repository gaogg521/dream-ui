/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sibling protocols to try when a submission proves the chosen one is not
 * served at this host.
 *
 * The problem this closes: the built-in catalog matches Seedance on the model
 * name alone (`/seedance/i` → `ark-task`), deliberately, because pinning it to
 * a host would mean writing a specific deployment's address into the product.
 * The consequence is that the same model behind a relay gateway resolves to
 * Volcano Ark's native task API, which that gateway does not proxy — every
 * generation fails, and the only recovery was for the user to know to go pick
 * `seedance-gateway` by hand in model settings.
 *
 * Retrying the sibling protocol costs one request against a path that answers
 * in milliseconds, and it needs no host list: both styles run against whatever
 * `base_url` the provider already carries, differing only in path shape, poll
 * verb, and how generation options travel. Whichever one answers is the truth
 * about that deployment.
 *
 * Scope is deliberately narrow — only Form C task-driver pairs, reachable at the
 * same host with the same credentials, so one `TaskPollAdapter` submission can
 * try both. The image-side counterpart (`seedream-gateway` vs the plain OpenAI
 * images API) is also both Form A, but it never reaches this table: the two
 * routes live in a single adapter (`openaiImagesAdapter.ts`), which retries the
 * sibling route inline on a routing miss without a protocol swap.
 */

import { IMPLEMENTED_ENDPOINT_STYLES } from './resolve';

/**
 * Both directions are listed. The gateway → native direction is not
 * hypothetical: the failure that prompted the prevention hints on 2026-08-10
 * was exactly that, a model manually pinned to a gateway protocol while its
 * `base_url` pointed at the vendor's own host.
 */
export const ENDPOINT_STYLE_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  'ark-task': ['seedance-gateway'],
  'seedance-gateway': ['ark-task'],
};

/**
 * Styles worth retrying after `style` failed as unrouted, filtered to the ones
 * a driver actually exists for.
 *
 * Returns an empty array for a style with no sibling, which is the normal case
 * — most vendors have exactly one wire protocol and a failure there is real.
 */
export const fallbackEndpointStyles = (style: string | undefined): readonly string[] => {
  if (!style) return [];
  const candidates = ENDPOINT_STYLE_FALLBACKS[style] ?? [];
  return candidates.filter((candidate) => candidate !== style && IMPLEMENTED_ENDPOINT_STYLES.includes(candidate));
};
