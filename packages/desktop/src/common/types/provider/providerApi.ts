/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire-contract types for `/api/providers/*`.
 *
 * Direct mirror of the Rust types in
 * `crates/dream-api-types/src/provider.rs`. Keep in sync with the
 * backend spec.
 */

import type { IProvider, ModelCapability } from '@/common/config/storage';

export interface CreateProviderRequest {
  /**
   * Optional caller-supplied id. When omitted, the server generates one.
   * Validated leniently (any non-empty string) to accept the frontend's
   * 8-char `uuid()` helper output.
   */
  id?: string;
  platform: string;
  name: string;
  base_url: string;
  api_key: string;
  models?: string[];
  enabled?: boolean;
  capabilities?: ModelCapability[];
  context_limit?: number;
  model_protocols?: Record<string, string>;
  model_enabled?: Record<string, boolean>;
  model_health?: IProvider['model_health'];
  model_settings?: IProvider['model_settings'];
  bedrock_config?: IProvider['bedrock_config'];
  is_full_url?: boolean;
}

/**
 * Partial-update shape for `PUT /api/providers/:id`.
 * Every field is optional — only fields sent are updated.
 */
export interface UpdateProviderRequest {
  platform?: string;
  name?: string;
  base_url?: string;
  api_key?: string;
  models?: string[];
  enabled?: boolean;
  capabilities?: ModelCapability[];
  context_limit?: number;
  model_protocols?: Record<string, string>;
  model_enabled?: Record<string, boolean>;
  model_health?: IProvider['model_health'];
  model_settings?: IProvider['model_settings'];
  bedrock_config?: IProvider['bedrock_config'];
  is_full_url?: boolean;
}

/**
 * Response for `POST /api/providers/:id/models` and
 * `POST /api/providers/fetch-models`.
 */
export interface FetchModelsResponse {
  /** Mixed-shape array: bare id strings or `{ id, name }` pairs. */
  models: Array<string | { id: string; name: string }>;
  /** Present when backend auto-corrected the provider's base_url. */
  fixed_base_url?: string;
}

/**
 * Anonymous fetch-models request used by the pre-create form flow.
 * No provider row needs to exist yet — credentials travel in the body.
 */
export interface FetchModelsAnonymousRequest {
  platform: string;
  base_url?: string;
  api_key: string;
  bedrock_config?: IProvider['bedrock_config'];
  try_fix?: boolean;
}

export type ProviderHealthCheckErrorKind =
  | 'timeout'
  | 'invalid_authorization_header'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'insufficient_quota'
  | 'aws_credentials'
  | 'invalid_request'
  | 'rate_limited'
  | 'connection_error'
  | 'api_error'
  | 'unknown';

export interface ProviderHealthCheckRequest {
  provider_id: string;
  model: string;
}

/**
 * Response for `POST /api/providers/trial-key`. No request body — the
 * per-install dedup id is resolved server-side by dream-core.
 *
 * Turn this straight into a `CreateProviderRequest` with `platform:
 * 'OpenRouter'` to materialize it as a normal, user-editable provider.
 */
export interface TrialKeyResponse {
  /** Plaintext API key. Returned once; the broker cannot retrieve it again. */
  key: string;
  base_url: string;
  /** A small curated starter model list, picked by the broker. */
  models: string[];
  /**
   * Which provider platform to create this key as.
   *
   * Comes from the broker rather than being named here: the broker can be
   * pointed at a different token platform without a client release, and a
   * hardcoded platform would silently mis-create the provider that day.
   * Optional so an older broker still works.
   */
  platform?: string;
  /** Stable id of the platform that issued the key. */
  vendor?: string;
}

/** Where a trial key's spend allowance stands, as the broker reports it. */
export interface TrialQuotaStatusResponse {
  vendor: string;
  /** `null` when the upstream reports no cap — not the same as a cap of zero. */
  limit_usd: number | null;
  used_usd: number;
  remaining_usd: number | null;
  /** How the allowance renews: `monthly`, `daily`, or `cumulative` (never). */
  reset: string | null;
  exhausted: boolean;
}

/**
 * Mode B (metered proxy). Response for `POST /api/providers/metered/claim`.
 *
 * Unlike {@link TrialKeyResponse} there is no real upstream key: the broker
 * proxies inference under its own master key and meters the spend. Turn this
 * into a `CreateProviderRequest` with `platform: 'custom'`, `base_url` = the
 * broker's proxy address, `api_key` = `device_token`.
 */
export interface MeteredAccessResponse {
  vendor: string;
  /** The broker's own proxy address for this vendor — the provider `base_url`. */
  base_url: string;
  /** Returned once; the provider `api_key`. Rotates on every claim. */
  device_token: string;
  models: string[];
  /** ISO 4217 code every amount on this vendor is in, e.g. `CNY`. */
  currency: string;
  /** One-time free grant, in the vendor's minor units (分). */
  free_grant_cents: number;
  /** Balance left now, minor units. `<= 0` → the proxy hard-blocks the next call. */
  remaining_cents: number;
}

/** Mode B balance, from the broker's local ledger. */
export interface MeteredQuotaStatusResponse {
  vendor: string;
  currency: string;
  free_grant_cents: number;
  purchased_cents: number;
  consumed_cents: number;
  remaining_cents: number;
  exhausted: boolean;
}

/** A mode-B top-up order, as the broker reports it. */
export interface MeteredOrderResponse {
  id: string;
  vendor: string;
  package_id: string;
  /** What the user pays, in the vendor's minor units. */
  amount_cents: number;
  /** What lands in the balance once paid. */
  credit_cents: number;
  currency: string;
  /** `pending` | `paid` | `failed` | `expired`. */
  status: string;
  /** `mock` | `alipay` | `wechat`. */
  gateway: string;
  /** Gateway pay instructions (QR / redirect / mock marker). Only on create. */
  payment?: Record<string, unknown> | null;
}

export interface ProviderHealthCheckResponse {
  provider_id: string;
  platform: string;
  model: string;
  status: 'unknown' | 'healthy' | 'unhealthy';
  elapsed_ms: number;
  message?: string;
  error_kind?: ProviderHealthCheckErrorKind;
  http_status?: number;
  timeout_stage?: string;
}
