/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer-safe catalog barrel. Nothing under catalog/ may import Node.js
 * APIs — the settings UI imports from here.
 */

export type {
  CatalogApiForm,
  CatalogMediaKind,
  MediaModelMatch,
  MediaModelParamSupport,
  MediaModelPolling,
  MediaModelSpec,
} from './types';
export { BUILTIN_IMAGE_MODELS } from './imageModels';
export { BUILTIN_VIDEO_MODELS } from './videoModels';
export {
  EXECUTABLE_FORMS,
  IMPLEMENTED_ENDPOINT_STYLES,
  SYNC_IMAGE_ENDPOINT_STYLES,
  clipParamsToSpec,
  inferModelKindFromName,
  isMediaGenSupported,
  isSpecExecutable,
  resolveDisplayModelKind,
  resolveMediaModelSpec,
  resolveModelKindLabel,
  type ClippedParams,
  type MediaProviderShape,
} from './resolve';

export { applyCatalogOverridesJson, parseCatalogOverrides, type OverrideParseResult } from './overrides';
export { getUserMediaModelSpecs, setUserMediaModelSpecs } from './userSpecs';
export {
  diagnoseEndpointMismatch,
  ENDPOINT_STYLE_INFO,
  type EndpointMismatchDiagnosis,
  type EndpointStyleInfo,
} from './endpointStyleInfo';
