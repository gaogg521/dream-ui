/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import type { MeteredQuotaStatusResponse, TrialQuotaStatusResponse } from '@/common/types/provider/providerApi';
import useSWR, { useSWRConfig } from 'swr';
import { useCallback } from 'react';
import { isMeteredTrialVendor, type TrialVendor } from './useTrialModelClaim';

/**
 * A trial vendor's spend position, tagged by which billing model it is.
 *
 *  - `issued` — mode A (OpenRouter): USD against a broker-set cap.
 *  - `metered` — mode B (Baoyun): the broker's local CNY-cents ledger.
 */
export type TrialQuotaView =
  | { kind: 'issued'; vendor: TrialVendor; data: TrialQuotaStatusResponse }
  | { kind: 'metered'; vendor: TrialVendor; data: MeteredQuotaStatusResponse };

const swrKey = (vendor: TrialVendor) => ['trial-quota', vendor] as const;

async function fetchTrialQuota(vendor: TrialVendor): Promise<TrialQuotaView | null> {
  if (isMeteredTrialVendor(vendor)) {
    const data = await ipcBridge.mode.meteredQuota.invoke({ vendor });
    return data ? { kind: 'metered', vendor, data } : null;
  }
  const data = await ipcBridge.mode.trialKeyQuota.invoke({ vendor });
  return data ? { kind: 'issued', vendor, data } : null;
}

/**
 * Where this install's trial allowance for `vendor` stands. `null` data means
 * this device never claimed it (the broker answers 404 → SWR error → the
 * caller renders nothing).
 */
export function useTrialQuota(vendor: TrialVendor, enabled = true) {
  return useSWR<TrialQuotaView | null>(enabled ? swrKey(vendor) : null, () => fetchTrialQuota(vendor), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
}

/** Refetch one vendor's quota — call after a top-up settles. */
export function useRefreshTrialQuota() {
  const { mutate } = useSWRConfig();
  return useCallback((vendor: TrialVendor) => mutate(swrKey(vendor)), [mutate]);
}

/** `remaining` in a trial view, in minor units for metered / major units for issued. */
export function remainingLabel(view: TrialQuotaView): { text: string; exhausted: boolean } {
  if (view.kind === 'metered') {
    const { remaining_cents, currency } = view.data;
    return { text: formatMinorUnits(remaining_cents, currency), exhausted: view.data.exhausted };
  }
  const { remaining_usd, exhausted, currency } = view.data;
  if (remaining_usd === null) return { text: '', exhausted };
  // `currency` is optional only for a broker predating multi-vendor mode A,
  // whose one vendor (OpenRouter) was always USD.
  const symbol = CURRENCY_SYMBOL[currency ?? 'USD'];
  const amount = remaining_usd.toFixed(2);
  return {
    text: symbol ? `${symbol}${amount}` : `${amount} ${currency}`,
    exhausted,
  };
}

/** `12345` cents in `CNY` -> `¥123.45`; unknown currency falls back to `123.45 XXX`. */
export function formatMinorUnits(cents: number, currency: string): string {
  const major = (cents / 100).toFixed(2);
  const symbol = CURRENCY_SYMBOL[currency];
  return symbol ? `${symbol}${major}` : `${major} ${currency}`;
}

/**
 * `10` in `CNY` -> `¥10.00`; unknown currency falls back to `10.00 XXX`.
 * Unlike `formatMinorUnits`, the input is already in the vendor's major
 * currency unit — mode A's real-money top-up orders (`TopupOrderResponse`)
 * carry `amount` this way, not minor-unit cents.
 */
export function formatMajorUnits(amount: number, currency: string): string {
  const major = amount.toFixed(2);
  const symbol = CURRENCY_SYMBOL[currency];
  return symbol ? `${symbol}${major}` : `${major} ${currency}`;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  GBP: '£',
};
