/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The cost figure shown next to a generation, before and after it runs.
 *
 * Spend was invisible from both ends — nothing said what a request would cost,
 * nothing said what it had cost — while the company ledger recorded both. This
 * closes that gap on the side of the person actually spending the money.
 *
 * The hook returns text rather than markup so the two display sites (the send
 * box chip and the finished job card) can place it in their own layout while
 * sharing one set of rules about what a number means and how it may be worded.
 *
 * **A figure is never invented.** Three sources, and the wording differs for
 * each: the user's own declared price is exact, the built-in table is labelled
 * an estimate, and a model with neither says so instead of showing `$0.00` —
 * which would read as free.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { computeMediaCost, formatUsd } from '@/common/media/pricing';
import type { MediaKind } from '@/common/media/types';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';

export type MediaCostDisplay = {
  text: string;
  tooltip: string;
  /** False when no rate exists — callers may want to style that differently. */
  known: boolean;
};

/**
 * The price the user declared for this exact model on this exact provider.
 *
 * Looked up by provider id, not by model name: two providers can carry the same
 * model name at different prices, and a figure attributed to the wrong one is
 * worse than no figure.
 */
export const useDeclaredUnitPriceUsd = (providerId?: string, model?: string): number | undefined => {
  const { data: providers } = useProvidersQuery();
  return useMemo(() => {
    if (!providerId || !model) return undefined;
    const price = providers?.find((provider) => provider.id === providerId)?.model_settings?.[model]
      ?.media_unit_price_usd;
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined;
  }, [providers, providerId, model]);
};

export const useMediaCost = (input: {
  kind: MediaKind;
  model?: string;
  providerId?: string;
  count: number;
  durationSeconds?: number;
  /** `estimate` reads "about to spend", `actual` reads "did spend". */
  variant: 'estimate' | 'actual';
}): MediaCostDisplay | null => {
  const { t } = useTranslation();
  const { kind, model, providerId, count, durationSeconds, variant } = input;
  const userUnitPriceUsd = useDeclaredUnitPriceUsd(providerId, model);

  return useMemo(() => {
    if (!model) return null;
    const cost = computeMediaCost({ kind, model, count, durationSeconds, userUnitPriceUsd });

    if (cost.source === 'unknown' || cost.totalUsd === undefined) {
      return { text: t('conversation.mediaCostUnknown'), tooltip: t('conversation.mediaCostNoRate'), known: false };
    }

    // The built-in table is a coarse illustration keyed off model names; saying
    // so is the difference between an estimate and a wrong invoice.
    const amount = cost.source === 'builtin' ? `≈${formatUsd(cost.totalUsd)}` : formatUsd(cost.totalUsd);
    return {
      text: t(variant === 'estimate' ? 'conversation.mediaCostEstimate' : 'conversation.mediaCostActual', { amount }),
      tooltip: t(
        cost.source === 'builtin' ? 'conversation.mediaCostFromBuiltinRate' : 'conversation.mediaCostFromUserPrice'
      ),
      known: true,
    };
  }, [count, durationSeconds, kind, model, t, userUnitPriceUsd, variant]);
};
