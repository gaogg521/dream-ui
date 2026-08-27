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
import useSWR from 'swr';
import { computeMediaCost, formatUsd, resolveUserUnitPriceUsd } from '@/common/media/pricing';
import type { MediaGenParams, MediaKind } from '@/common/media/types';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';

/**
 * SWR key for the cost-display preference. Exported so the settings switch can
 * revalidate it and every send box / job card updates without a reload.
 */
export const SHOW_MEDIA_COST_SWR_KEY = 'client-setting:tools.showMediaCost';

/**
 * Whether the user asked to see cost figures at all.
 *
 * Off unless explicitly enabled — see `tools.showMediaCost` in
 * `clientSettings.ts` for why the default is off. Read through SWR rather than
 * an effect so the two display sites share one fetch and both react to the
 * switch immediately.
 */
export const useShowMediaCost = (): boolean => {
  const { data } = useSWR<boolean>(
    SHOW_MEDIA_COST_SWR_KEY,
    () => getClientBusinessSetting('tools.showMediaCost').then((value) => value === true),
    { revalidateOnFocus: false }
  );
  return data === true;
};

export type MediaCostDisplay = {
  text: string;
  tooltip: string;
  /** False when no rate exists — callers may want to style that differently. */
  known: boolean;
  /**
   * True when the user declaring a price would replace this figure with an
   * exact one — i.e. the number came from the built-in table, or there is no
   * number at all.
   *
   * Exposed so the display sites can offer the way there instead of only naming
   * it in prose: the tooltip has said "go to Settings > Models" since this
   * shipped, but the field it points at is several clicks deep and only appears
   * after the model is declared as image/video, which is not something a user
   * can be expected to discover from that sentence.
   *
   * False for a user-declared price: there is nothing to improve.
   */
  actionable: boolean;
};

/**
 * The price the user declared for this exact model on this exact provider, for
 * the resolution this request is asking for.
 *
 * Looked up by provider id, not by model name: two providers can carry the same
 * model name at different prices, and a figure attributed to the wrong one is
 * worse than no figure.
 *
 * `params` decides which per-resolution entry applies. The lookup itself lives
 * in `pricing.ts` because the usage report performs the same one — see
 * `resolveUserUnitPriceUsd`.
 */
export const useDeclaredUnitPriceUsd = (
  providerId?: string,
  model?: string,
  params?: MediaGenParams
): number | undefined => {
  const { data: providers } = useProvidersQuery();
  return useMemo(() => {
    if (!providerId || !model) return undefined;
    const settings = providers?.find((provider) => provider.id === providerId)?.model_settings?.[model];
    return resolveUserUnitPriceUsd(settings, params);
  }, [providers, providerId, model, params]);
};

export const useMediaCost = (input: {
  kind: MediaKind;
  model?: string;
  providerId?: string;
  count: number;
  durationSeconds?: number;
  /**
   * The request's parameters, for picking the per-resolution price. Optional:
   * a caller with no parameters simply gets the flat rate.
   */
  params?: MediaGenParams;
  /** `estimate` reads "about to spend", `actual` reads "did spend". */
  variant: 'estimate' | 'actual';
}): MediaCostDisplay | null => {
  const { t } = useTranslation();
  const { kind, model, providerId, count, durationSeconds, params, variant } = input;
  const userUnitPriceUsd = useDeclaredUnitPriceUsd(providerId, model, params);
  const showCost = useShowMediaCost();

  return useMemo(() => {
    // Returning null rather than gating at each call site: "do not show a cost"
    // is one rule, and both display sites already handle a null (a model with
    // no rate has always produced one).
    if (!showCost) return null;
    if (!model) return null;
    const cost = computeMediaCost({ kind, model, count, durationSeconds, userUnitPriceUsd });

    if (cost.source === 'unknown' || cost.totalUsd === undefined) {
      return {
        text: t('conversation.mediaCostUnknown'),
        tooltip: t('conversation.mediaCostNoRate'),
        known: false,
        actionable: true,
      };
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
      actionable: cost.source === 'builtin',
    };
  }, [count, durationSeconds, kind, model, showCost, t, userUnitPriceUsd, variant]);
};
