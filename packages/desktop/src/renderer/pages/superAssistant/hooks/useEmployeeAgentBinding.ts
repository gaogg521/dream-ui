/**
 * Persona × backend × model selection for a digital employee.
 *
 * Digital employees used to expose only a hardcoded three-entry "agent type"
 * dropdown, which meant an dream employee had no way to carry a provider and
 * failed every run with `Provider '' not found`. This hook supplies the same
 * triple the scheduled-task dialog already resolves (see
 * `pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx`), so the two creation
 * surfaces behave identically:
 *
 *  1. the user picks an expert (persona),
 *  2. the backend defaults to that persona's own agent and only decouples once
 *     the user overrides it explicitly (same one-way latch as the Guid page),
 *  3. a model selector appears only for backends that actually need one.
 *
 * Shared by CreateAgentModal and ManageAgentModal so the create and edit paths
 * cannot drift apart.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { assistantRuntimeKey } from '@/common/types/agent/assistantTypes';
import type { AcpModelInfo } from '@/common/types/platform/acpTypes';
import type { PersonalAgentBinding, PersonalAgentModel } from '@/common/types/employee/employeeTypes';
import { useAssistantList } from '@renderer/hooks/assistant/useAssistantList';
import { useMarketplacePersonas } from '@renderer/hooks/assistant/useMarketplacePersonas';
import {
  useManagedAgentRuntimeCatalog,
  refreshManagedAgentCatalogAndAssistants,
} from '@renderer/hooks/agent/useManagedAgents';
import { useModelProviderList } from '@renderer/hooks/agent/useModelProviderList';
import { buildAgentRuntimeModelInfo } from '@renderer/utils/model/agentRuntimeCatalog';
import { buildAssistantModelInfo } from '@renderer/pages/guid/hooks/useGuidAssistantSelection';

/** Backends whose model is chosen from the provider list rather than an ACP catalog. */
const AIONRS_BACKEND = 'dream';
const GEMINI_BACKEND = 'gemini';
/** dream cannot use Google-Auth providers. Same filter as the cron dialog. */
const GOOGLE_AUTH_PLATFORM = 'gemini-with-google-auth';

/**
 * Sentinel for the explicit "no expert" choice, which produces a backend-only
 * employee (just a CLI plus the run instructions).
 *
 * `source === 'generated'` assistants — the bare CLI rows like "Claude Code" and
 * "1ONE CLI" — are deliberately NOT offered as experts: they carry no persona, so
 * picking one *is* picking a backend, and that is what the separate backend field
 * is for. Listing them next to real experts is what made the first version of
 * this picker read as "the CLI assistant list" rather than the expert catalog.
 */
export const NO_EXPERT_ID = '__no_expert__';

export type EmployeeBindingInitial = {
  assistantId?: string | null;
  agentIdOverride?: string | null;
  modelId?: string | null;
  model?: PersonalAgentModel | null;
};

export type BackendOption = {
  /** `agent_metadata.id` — what gets stored as the override. */
  id: string;
  /** Already-branded name from the catalog (the dream row reads "1ONE CLI"). */
  label: string;
  backend: string;
};

export type UseEmployeeAgentBindingResult = {
  assistants: Assistant[];
  marketplacePersonas: ReturnType<typeof useMarketplacePersonas>['personas'];
  marketplaceLoading: boolean;
  selectedAssistantId?: string;
  selectedAssistant?: Assistant;
  selectAssistant: (assistantId: string) => void;
  installAndSelectAssistant: (assistantId: string) => Promise<void>;
  installingAssistantId?: string;

  backendOptions: BackendOption[];
  selectedBackendAgentId?: string;
  setBackendAgentId: (agentId: string) => void;
  resolvedBackend: string;
  isAionrsBackend: boolean;
  hasAionrsProvider: boolean;

  showModelSelector: boolean;
  /** Spread straight into `GuidModelSelector`. */
  modelSelectorProps: {
    isGeminiMode: boolean;
    modelList: IProvider[];
    current_model: TProviderWithModel | undefined;
    setCurrentModel: (model: TProviderWithModel) => Promise<void>;
    currentAcpCachedModelInfo: AcpModelInfo | null;
    selectedAcpModel: string | null;
    setSelectedAcpModel: React.Dispatch<React.SetStateAction<string | null>>;
    backend?: string;
  };

  /** `undefined` when the selection is not yet valid to submit. */
  buildBinding: () => (PersonalAgentBinding & { agentType: string }) | undefined;
  reset: (initial?: EmployeeBindingInitial) => void;
};

export const useEmployeeAgentBinding = (initial?: EmployeeBindingInitial): UseEmployeeAgentBindingResult => {
  // The *full* assistant list, not `selectableAssistants` — that filters to
  // `enabled !== false`, which hid all 21 not-yet-enabled official experts and
  // left the picker showing only the bare CLI rows.
  const { assistants: allAssistants } = useAssistantList();
  const { personas: marketplacePersonas, loading: marketplaceLoading, install } = useMarketplacePersonas();
  const managedAgentRuntimeCatalog = useManagedAgentRuntimeCatalog();
  const { providers, getAvailableModels } = useModelProviderList();

  /** Real experts: official templates, user-authored and imported personas. */
  const presetAssistants = useMemo(
    () => allAssistants.filter((assistant) => assistant.source !== 'generated'),
    [allAssistants]
  );

  const [selectedAssistantId, setSelectedAssistantId] = useState<string | undefined>(initial?.assistantId ?? undefined);
  const [backendAgentIdState, setBackendAgentIdState] = useState<string | undefined>(
    initial?.agentIdOverride ?? undefined
  );
  const [modelId, setModelId] = useState<string | undefined>(initial?.modelId ?? initial?.model?.model ?? undefined);
  const [installingAssistantId, setInstallingAssistantId] = useState<string | undefined>(undefined);

  // One-way latch: while false the backend tracks the persona; the first manual
  // pick decouples it so later persona switches no longer reset it. Mirrors
  // `backendOverriddenRef` in useGuidAssistantSelection.
  const backendOverriddenRef = useRef<boolean>(Boolean(initial?.agentIdOverride));
  // Remembers the provider the model came from, so an edit-mode round trip
  // cannot silently re-bind the same model name to a different provider.
  const initialProviderIdRef = useRef<string | undefined>(initial?.model?.provider_id ?? undefined);

  const selectedAssistant = useMemo(
    () => (selectedAssistantId ? presetAssistants.find((item) => item.id === selectedAssistantId) : undefined),
    [presetAssistants, selectedAssistantId]
  );

  const selectedBackendAgentId = backendAgentIdState ?? selectedAssistant?.agent_id ?? undefined;

  // Follow the persona until the user overrides the backend once.
  useEffect(() => {
    if (backendOverriddenRef.current) return;
    setBackendAgentIdState(selectedAssistant?.agent_id ?? undefined);
  }, [selectedAssistant?.agent_id]);

  const selectedCatalogAgent = useMemo(
    () =>
      selectedBackendAgentId
        ? managedAgentRuntimeCatalog.find((agent) => agent.id === selectedBackendAgentId)
        : undefined,
    [managedAgentRuntimeCatalog, selectedBackendAgentId]
  );

  const resolvedBackend =
    selectedCatalogAgent?.backend || selectedCatalogAgent?.agent_type || assistantRuntimeKey(selectedAssistant);
  const isAionrsBackend = resolvedBackend === AIONRS_BACKEND;
  const isGeminiMode = isAionrsBackend || resolvedBackend === GEMINI_BACKEND;

  const backendOptions = useMemo<BackendOption[]>(
    () =>
      managedAgentRuntimeCatalog
        .filter((agent) => agent.enabled !== false && agent.installed !== false)
        .map((agent) => ({
          id: agent.id,
          // The catalog name is already the product name — the dream row is
          // literally "1ONE CLI" (migration 019). Never hardcode a label here.
          label: agent.name,
          backend: agent.backend || agent.agent_type || '',
        })),
    [managedAgentRuntimeCatalog]
  );

  const aionrsProviders = useMemo(
    () => providers.filter((p) => !p.platform?.toLowerCase().includes(GOOGLE_AUTH_PLATFORM)),
    [providers]
  );
  const hasAionrsProvider = aionrsProviders.length > 0;
  const filteredProviders = useMemo(
    () => (isAionrsBackend ? aionrsProviders : providers),
    [isAionrsBackend, providers, aionrsProviders]
  );

  const currentProviderModel = useMemo<TProviderWithModel | undefined>(() => {
    if (!isAionrsBackend || !modelId) return undefined;
    const preferredProviderId = initialProviderIdRef.current;
    if (preferredProviderId) {
      const byId = filteredProviders.find((p) => p.id === preferredProviderId);
      if (byId && getAvailableModels(byId).includes(modelId)) {
        return { ...byId, use_model: modelId } as TProviderWithModel;
      }
    }
    for (const provider of filteredProviders) {
      if (getAvailableModels(provider).includes(modelId)) {
        return { ...provider, use_model: modelId } as TProviderWithModel;
      }
    }
    return undefined;
  }, [isAionrsBackend, modelId, filteredProviders, getAvailableModels]);

  // Prefer the selected backend's own runtime catalog entry: with a manual
  // backend override the persona's model list would describe the wrong agent.
  const acpCachedModelInfo = useMemo<AcpModelInfo | null>(() => {
    if (!resolvedBackend || isGeminiMode) return null;
    return buildAgentRuntimeModelInfo(selectedCatalogAgent) ?? buildAssistantModelInfo(selectedAssistant?.models ?? []);
  }, [resolvedBackend, isGeminiMode, selectedCatalogAgent, selectedAssistant?.models]);

  // Auto-pick the first enabled provider model when dream has none yet. Source
  // of truth is the provider list, not any cached frontend default.
  useEffect(() => {
    if (!isAionrsBackend || modelId) return;
    for (const provider of aionrsProviders) {
      const models = getAvailableModels(provider);
      if (models.length > 0) {
        initialProviderIdRef.current = provider.id;
        setModelId(models[0]);
        return;
      }
    }
  }, [isAionrsBackend, modelId, aionrsProviders, getAvailableModels]);

  const selectAssistant = useCallback((assistantId: string) => {
    // The explicit "no expert" choice clears the persona; the backend field then
    // carries the whole decision.
    setSelectedAssistantId(assistantId === NO_EXPERT_ID ? undefined : assistantId);
  }, []);

  /**
   * Adopt an expert the user has not made usable yet, then select it. Two cases
   * behind one affordance:
   *  - an official template that exists but is disabled → flip `enabled`
   *    (same move as `useTalkToButler`),
   *  - a marketplace persona that is not installed at all → install it.
   */
  const installAndSelectAssistant = useCallback(
    async (assistantId: string) => {
      setInstallingAssistantId(assistantId);
      try {
        const existing = allAssistants.find((assistant) => assistant.id === assistantId);
        if (existing) {
          if (existing.enabled === false) {
            await ipcBridge.assistants.setState.invoke({ id: assistantId, enabled: true });
          }
        } else {
          await install(assistantId);
        }
        await refreshManagedAgentCatalogAndAssistants();
        setSelectedAssistantId(assistantId);
      } finally {
        setInstallingAssistantId(undefined);
      }
    },
    [install, allAssistants]
  );

  const setBackendAgentId = useCallback((agentId: string) => {
    backendOverriddenRef.current = true;
    setBackendAgentIdState(agentId);
  }, []);

  const setCurrentModel = useCallback(async (model: TProviderWithModel) => {
    initialProviderIdRef.current = model.id as string | undefined;
    setModelId(model.use_model);
  }, []);

  const setSelectedAcpModel = useCallback<React.Dispatch<React.SetStateAction<string | null>>>((action) => {
    setModelId((prev) => {
      const next = typeof action === 'function' ? action(prev ?? null) : action;
      return next ?? undefined;
    });
  }, []);

  const buildBinding = useCallback(() => {
    // A backend is always required; an expert is optional (picking "no expert"
    // yields a backend-only employee driven purely by the run instructions).
    if (!resolvedBackend) return undefined;
    // Only report an override when it actually differs from what the expert
    // implies — otherwise a plain expert pick would look like a manual choice.
    // With no expert there is nothing to diverge from, so the chosen backend is
    // the binding itself and needs no override.
    const agentIdOverride =
      selectedAssistant && selectedBackendAgentId && selectedBackendAgentId !== selectedAssistant.agent_id
        ? selectedBackendAgentId
        : undefined;

    const base = {
      agentType: resolvedBackend,
      assistantId: selectedAssistant?.id,
      agentIdOverride,
      modelId,
    };

    if (isAionrsBackend) {
      if (!currentProviderModel?.id || !modelId) return undefined;
      return {
        ...base,
        model: { provider_id: currentProviderModel.id as string, model: modelId, use_model: modelId },
      };
    }
    return base;
  }, [selectedAssistant, resolvedBackend, selectedBackendAgentId, isAionrsBackend, currentProviderModel, modelId]);

  const reset = useCallback((next?: EmployeeBindingInitial) => {
    backendOverriddenRef.current = Boolean(next?.agentIdOverride);
    initialProviderIdRef.current = next?.model?.provider_id ?? undefined;
    setSelectedAssistantId(next?.assistantId ?? undefined);
    setBackendAgentIdState(next?.agentIdOverride ?? undefined);
    setModelId(next?.modelId ?? next?.model?.model ?? undefined);
    setInstallingAssistantId(undefined);
  }, []);

  return {
    assistants: presetAssistants,
    marketplacePersonas,
    marketplaceLoading,
    selectedAssistantId,
    selectedAssistant,
    selectAssistant,
    installAndSelectAssistant,
    installingAssistantId,

    backendOptions,
    selectedBackendAgentId,
    setBackendAgentId,
    resolvedBackend,
    isAionrsBackend,
    hasAionrsProvider,

    showModelSelector: Boolean(resolvedBackend && (isGeminiMode || acpCachedModelInfo)),
    modelSelectorProps: {
      isGeminiMode,
      modelList: filteredProviders,
      current_model: currentProviderModel,
      setCurrentModel,
      currentAcpCachedModelInfo: acpCachedModelInfo,
      selectedAcpModel: modelId ?? null,
      setSelectedAcpModel,
      backend: resolvedBackend || undefined,
    },

    buildBinding,
    reset,
  };
};
