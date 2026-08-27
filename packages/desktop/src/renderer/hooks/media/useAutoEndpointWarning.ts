/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "The protocol was guessed for you, and the guess looks wrong."
 *
 * The settings modal already warns about a protocol/host mismatch, but only for
 * a style the user picked by hand — it returns early when nothing was chosen.
 * That leaves the default path unwatched, and the default path is where the
 * common failure lives: a model matched to a vendor-native API by name alone
 * while the channel address points at a relay gateway that does not proxy it.
 *
 * Shown before sending rather than after failing. The executor also retries the
 * sibling protocol on its own now, so this is the second line of defence, not
 * the only one — which is why it is a hint next to the chip and not a block.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { diagnoseAutoEndpointMismatch } from '@/common/media/catalog/resolve';
import type { CatalogMediaKind } from '@/common/media/catalog/types';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';

/** The warning line for this provider+model, or null when nothing looks off. */
export const useAutoEndpointWarning = (kind: CatalogMediaKind, providerId?: string, model?: string): string | null => {
  const { t } = useTranslation();
  const { data: providers } = useProvidersQuery();

  return useMemo(() => {
    if (!providerId || !model) return null;
    const provider = providers?.find((item) => item.id === providerId);
    if (!provider) return null;

    const diagnosis = diagnoseAutoEndpointMismatch(kind, provider, model);
    if (diagnosis?.kind !== 'hostMismatch') return null;

    return t('conversation.mediaEndpointAutoMismatch', {
      baseUrl: diagnosis.baseUrl,
      hints: diagnosis.hints.join(' / '),
    });
  }, [providers, providerId, model, kind, t]);
};
