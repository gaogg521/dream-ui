/**
 * Copyright 2026 One Work
 */

/**
 * The company's export-protection policy, as this client last saw it, plus
 * this machine's watermark seed.
 *
 * Read fresh when an export starts (exports are rare, so the extra round trip
 * buys freedom from the five-minute sync delay) and cached so a server that
 * is down does not change behaviour: the cached policy stays in force, and
 * only a client that has never seen one falls back to the defaults — which
 * are exactly "this company never turned the feature on".
 */

import { ipcBridge } from '@/common';
import { getEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { base64ToBytes } from './packageFormat';

export type EncryptionMode = 'optional' | 'default' | 'required';

export type ExportPolicy = {
  /** The company's plan includes export protection. Nothing below applies otherwise. */
  entitled: boolean;
  watermark: boolean;
  encryptionMode: EncryptionMode;
};

export const DEFAULT_EXPORT_POLICY: ExportPolicy = { entitled: false, watermark: false, encryptionMode: 'optional' };

export type WatermarkSeed = { seedId: string; key: Uint8Array<ArrayBuffer>; expiresAt: number };

const POLICY_CACHE_KEY = 'one.secureExport.policy.v1';
const SEED_CACHE_KEY = 'one.secureExport.seed.v1';
/** Ask for a new seed this long before the current one expires. */
const SEED_REFRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

let enterpriseActive = false;
let seedInMemory: WatermarkSeed | null = null;

/**
 * Whether export protection can apply at all. Set by the app shell from the
 * org context; personal mode leaves it false and every export goes through
 * untouched.
 */
export function setSecureExportEnterpriseActive(active: boolean): void {
  enterpriseActive = active;
  if (!active) seedInMemory = null;
}

export function isSecureExportEnterpriseActive(): boolean {
  return enterpriseActive;
}

function cacheScope(): string {
  return getEnterpriseServerUrl() ?? 'unknown';
}

function readCachedPolicy(): ExportPolicy | null {
  try {
    const raw = localStorage.getItem(POLICY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { scope: string; policy: ExportPolicy };
    return parsed.scope === cacheScope() ? parsed.policy : null;
  } catch {
    return null;
  }
}

function writeCachedPolicy(policy: ExportPolicy): void {
  try {
    localStorage.setItem(POLICY_CACHE_KEY, JSON.stringify({ scope: cacheScope(), policy }));
  } catch {
    // Storage full or unavailable: the policy still applies for this export.
  }
}

function normalizeMode(mode: unknown): EncryptionMode {
  return mode === 'default' || mode === 'required' ? mode : 'optional';
}

/**
 * Current policy. `fresh` asks the server first; any failure falls back to
 * the cache, then to the defaults.
 */
export async function loadExportPolicy(options: { fresh: boolean }): Promise<ExportPolicy> {
  if (!enterpriseActive) return DEFAULT_EXPORT_POLICY;
  if (!options.fresh) return readCachedPolicy() ?? DEFAULT_EXPORT_POLICY;
  try {
    const [policy, plan] = await Promise.all([
      ipcBridge.onePlatform.mySecurityPolicy.invoke(),
      ipcBridge.oneBilling.myPlan.invoke(),
    ]);
    const entitled = Boolean(plan?.entitlements?.some((e) => e.feature === 'secure_export' && e.allowed));
    const next: ExportPolicy = {
      entitled,
      watermark: entitled && Boolean(policy?.exportWatermarkEnabled),
      encryptionMode: entitled ? normalizeMode(policy?.exportEncryptionMode) : 'optional',
    };
    writeCachedPolicy(next);
    return next;
  } catch (error) {
    console.warn('[secureExport] policy refresh failed, using cached policy:', error);
    return readCachedPolicy() ?? DEFAULT_EXPORT_POLICY;
  }
}

async function persistSeed(seed: { seedId: string; seedKey: string; expiresAt: number }): Promise<void> {
  try {
    const sealed = await ipcBridge.credential.encrypt.invoke({ plainText: JSON.stringify(seed) });
    if (sealed?.success && sealed.data?.value) {
      localStorage.setItem(SEED_CACHE_KEY, JSON.stringify({ scope: cacheScope(), value: sealed.data.value }));
    }
  } catch {
    // Without OS encryption the seed stays in memory only; nothing is written in the clear.
  }
}

async function readPersistedSeed(): Promise<WatermarkSeed | null> {
  try {
    const raw = localStorage.getItem(SEED_CACHE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { scope: string; value: string };
    if (stored.scope !== cacheScope()) return null;
    const opened = await ipcBridge.credential.decrypt.invoke({ cipherText: stored.value });
    if (!opened?.success || !opened.data?.value) return null;
    const seed = JSON.parse(opened.data.value) as { seedId: string; seedKey: string; expiresAt: number };
    return { seedId: seed.seedId, key: base64ToBytes(seed.seedKey), expiresAt: seed.expiresAt };
  } catch {
    return null;
  }
}

/**
 * This machine's seed: memory, then the OS-encrypted cache, then the server.
 * A seed close to expiry is renewed when the server is reachable and used as
 * long as it is still valid when it is not. `null` means no watermark can be
 * made right now — the export itself must still go ahead.
 */
export async function getWatermarkSeed(): Promise<WatermarkSeed | null> {
  if (!enterpriseActive) return null;
  const now = Date.now();
  const cached = seedInMemory ?? (await readPersistedSeed());
  if (cached && cached.expiresAt - now > SEED_REFRESH_WINDOW_MS) {
    seedInMemory = cached;
    return cached;
  }
  try {
    const issued = await ipcBridge.onePlatform.secureExportSeed.invoke();
    if (issued?.seedId && issued.seedKey) {
      seedInMemory = { seedId: issued.seedId, key: base64ToBytes(issued.seedKey), expiresAt: issued.expiresAt };
      await persistSeed(issued);
      return seedInMemory;
    }
  } catch (error) {
    if (isBackendHttpError(error) && error.code === 'PLAN_FEATURE_REQUIRED') return null;
    console.warn('[secureExport] seed refresh failed:', error);
  }
  return cached && cached.expiresAt > now ? cached : null;
}

/** Forget the seed and policy (leaving the company). */
export function clearSecureExportState(): void {
  seedInMemory = null;
  try {
    localStorage.removeItem(SEED_CACHE_KEY);
    localStorage.removeItem(POLICY_CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}
