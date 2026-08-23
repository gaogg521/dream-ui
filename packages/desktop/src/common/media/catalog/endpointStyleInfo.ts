/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Human-facing metadata for `media_endpoint` styles.
 *
 * The style ids themselves (`ark-task`, `seedance-gateway`, ...) are wire
 * values a user has to pick blind from a dropdown of raw strings — video has
 * no auto fallback, so getting this wrong is common, and the failure only
 * surfaces later as an opaque error from the real generation call (see
 * `useMediaFailureAdvice.ts`'s `notRouted` class). This file exists to move
 * that discovery earlier: a label and, where the driver has one, a host hint
 * a settings UI can compare against the provider's `base_url` before saving.
 *
 * `hostHints` are read off each driver's own `apiRoot()` fallback — not
 * guessed. Two styles (`seedance-gateway`, `seedream-gateway`) have no
 * default host by design (their own doc comments: "the host is deliberately
 * not written down anywhere") — those get `gatewayStyle: true` instead of
 * hints, since there is nothing to compare against. `kling` has its own fixed
 * host independent of whatever `base_url` the provider's chat traffic uses
 * (`klingDriver.ts`'s own comment: "a chat base_url would be the wrong root
 * entirely") — that gets `hostAgnostic: true`.
 *
 * Renderer-safe: no Node.js imports, mirrors the rest of catalog/.
 */

export type EndpointStyleInfo = {
  /** i18n key (settings namespace) for the short human label. */
  labelKey: string;
  /** i18n key for the one-line "what shape is this" description. */
  descriptionKey: string;
  /** Substrings expected in the provider's base_url when this style applies. */
  hostHints?: string[];
  /** This style's real host is fixed and unrelated to the provider's base_url. */
  hostAgnostic?: boolean;
  /** This style has no fixed host — it IS whatever gateway the base_url points at. */
  gatewayStyle?: boolean;
};

/** What, if anything, looks off about picking `styleId` given `baseUrl`. */
export type EndpointMismatchDiagnosis =
  | { kind: 'hostAgnostic' }
  | { kind: 'gatewayStyle' }
  | { kind: 'hostMismatch'; baseUrl: string; hints: string[] }
  | null;

/**
 * Pulled out of the settings UI so it is testable without mounting a modal —
 * this is pure string comparison against data already in `ENDPOINT_STYLE_INFO`,
 * nothing about it needs React or a DOM.
 */
export const diagnoseEndpointMismatch = (styleId: string, baseUrl: string | undefined): EndpointMismatchDiagnosis => {
  const info = ENDPOINT_STYLE_INFO[styleId];
  if (!info) return null;
  if (info.hostAgnostic) return { kind: 'hostAgnostic' };
  if (info.gatewayStyle) return { kind: 'gatewayStyle' };
  if (info.hostHints?.length) {
    const url = (baseUrl ?? '').toLowerCase();
    const matches = info.hostHints.some((hint) => url.includes(hint.toLowerCase()));
    if (!matches) return { kind: 'hostMismatch', baseUrl: baseUrl ?? '', hints: info.hostHints };
  }
  return null;
};

export const ENDPOINT_STYLE_INFO: Record<string, EndpointStyleInfo> = {
  'ark-task': {
    labelKey: 'settings.mediaEndpointStyleLabel_arkTask',
    descriptionKey: 'settings.mediaEndpointStyleDesc_arkTask',
    hostHints: ['volces.com'],
  },
  'dashscope-task': {
    labelKey: 'settings.mediaEndpointStyleLabel_dashscopeTask',
    descriptionKey: 'settings.mediaEndpointStyleDesc_dashscopeTask',
    hostHints: ['dashscope.aliyuncs.com'],
  },
  'openai-video': {
    labelKey: 'settings.mediaEndpointStyleLabel_openaiVideo',
    descriptionKey: 'settings.mediaEndpointStyleDesc_openaiVideo',
    hostHints: ['api.openai.com'],
  },
  cogvideox: {
    labelKey: 'settings.mediaEndpointStyleLabel_cogvideox',
    descriptionKey: 'settings.mediaEndpointStyleDesc_cogvideox',
    hostHints: ['bigmodel.cn'],
  },
  kling: {
    labelKey: 'settings.mediaEndpointStyleLabel_kling',
    descriptionKey: 'settings.mediaEndpointStyleDesc_kling',
    hostAgnostic: true,
  },
  'agnes-task': {
    labelKey: 'settings.mediaEndpointStyleLabel_agnesTask',
    descriptionKey: 'settings.mediaEndpointStyleDesc_agnesTask',
    hostAgnostic: true,
  },
  'seedance-gateway': {
    labelKey: 'settings.mediaEndpointStyleLabel_seedanceGateway',
    descriptionKey: 'settings.mediaEndpointStyleDesc_seedanceGateway',
    gatewayStyle: true,
  },
  'seedream-gateway': {
    labelKey: 'settings.mediaEndpointStyleLabel_seedreamGateway',
    descriptionKey: 'settings.mediaEndpointStyleDesc_seedreamGateway',
    gatewayStyle: true,
  },
};
