/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { assistantRuntimeKey, type AssistantDetail } from '@/common/types/agent/assistantTypes';

/**
 * Resolve the `model` value a team agent should send to `POST /api/teams`.
 *
 * Backend `service.rs` consumes `input.model` verbatim with no default, so an
 * empty or backend-name-only value (e.g. "gemini") ends up persisted as
 * `use_model: null`. Downstream, GeminiSendBox / DreamEngineSendBox gate the
 * textarea on `current_model?.useModel` and render disabled. See mnemo #297.
 *
 * This resolver reads assistant-owned defaults first and then falls back to
 * backend-safe defaults when the selected assistant has no explicit model.
 *
 * For ACP backends (claude, codex, acp) the model is resolved from the
 * agent's handshake data or cached model info so the backend receives a
 * valid model ID (e.g. "claude-sonnet-4-5-20250514") instead of the bare
 * backend name.
 */
export async function resolveDefaultTeamAgentModel(params: {
  assistant_id?: string;
  assistant_backend?: string;
}): Promise<string> {
  const { assistant_id, assistant_backend } = params;

  const assistantDetail = await resolveAssistantDetail(assistant_id);
  if (assistantDetail) {
    const agent = assistantDetail.engine?.agent;
    const runtimeKey = assistantRuntimeKey(agent ? { agent } : undefined);
    const assistantModel = resolveAssistantModel(assistantDetail);

    // An assistant-owned model is a preference, not a guarantee. `last_model_id`
    // in particular outlives the provider it came from — a marketplace persona
    // ships one, a provider gets swapped, a model is retired — and the value
    // stays behind. The dream backend resolves the model against the enabled
    // providers' model lists server-side, so handing it a stale name fails team
    // creation outright with "no enabled provider offers model '<name>'".
    // Verify before trusting it, and fall back to a model that exists.
    if (runtimeKey === 'dream') {
      return resolveDreamEngineModel(assistantModel);
    }

    if (assistantModel) {
      return assistantModel;
    }

    return resolveBackendDefaultModel(runtimeKey);
  }

  return resolveBackendDefaultModel(assistant_backend);
}

async function resolveAssistantDetail(assistant_id?: string): Promise<AssistantDetail | undefined> {
  if (!assistant_id) return undefined;

  try {
    const detail = (await ipcBridge.assistants.get.invoke({ id: assistant_id })) as AssistantDetail | null;
    return detail ?? undefined;
  } catch {
    return undefined;
  }
}

function resolveAssistantModel(detail: AssistantDetail): string | undefined {
  if (detail.defaults.model.mode === 'fixed' && detail.defaults.model.value) {
    return detail.defaults.model.value;
  }

  if (detail.defaults.model.mode === 'auto' && detail.preferences.last_model_id) {
    return detail.preferences.last_model_id;
  }

  return undefined;
}

function resolveBackendDefaultModel(assistant_backend?: string): Promise<string> {
  if (assistant_backend === 'gemini') {
    return resolveGeminiDefaultModel();
  }

  if (assistant_backend === 'dream') {
    return resolveDreamEngineModel();
  }

  if (assistant_backend === 'antigravity') {
    return resolveAntigravityDefaultModel();
  }

  if (assistant_backend === 'antigravity') {
    return resolveAntigravityDefaultModel();
  }

  return resolveAcpDefaultModel(assistant_backend ?? 'acp');
}

async function resolveAcpDefaultModel(_assistant_backend: string): Promise<string> {
  return 'default';
}

async function resolveAntigravityDefaultModel(): Promise<string> {
  // An empty model means "no --model flag": team provisioning persists it
  // verbatim, the session layer filters empty ids to None, and agy runs on
  // its own default model — the exact path direct chat already uses. The
  // 'default' placeholder is not a real agy model id and fails every team
  // turn with UserLlmProviderModelNotFound while agy's discovery is empty.
  return '';
}

async function resolveGeminiDefaultModel(): Promise<string> {
  // The legacy 'gemini.defaultModel' config key has been removed after the
  // Gemini → ACP consolidation. Always fall back to the 'auto' alias.
  return 'auto';
}

// Unlike ACP, the dream backend resolves `model` against a real provider's
// model list server-side (`resolve_provider_for_model` in provisioning.rs).
// A placeholder like "default" doesn't match anything there and now fails
// team creation outright, so this must return an actual configured model.
//
// `preferred` is honoured only when an enabled provider actually offers it;
// otherwise the first usable model wins. Both the placeholder case and the
// stale-preference case therefore end up on a model the server can resolve.
async function resolveDreamEngineModel(preferred?: string): Promise<string> {
  const providers = await ipcBridge.mode.listProviders.invoke();
  const usable = (provider: (typeof providers)[number], model: string) =>
    provider.enabled !== false && provider.model_enabled?.[model] !== false;

  if (preferred && providers.some((provider) => provider.models.includes(preferred) && usable(provider, preferred))) {
    return preferred;
  }

  for (const provider of providers) {
    if (provider.enabled === false) continue;
    const model = provider.models.find((m) => usable(provider, m));
    if (model) return model;
  }

  throw new Error('No enabled model provider is configured. Please add one in Settings first.');
}
