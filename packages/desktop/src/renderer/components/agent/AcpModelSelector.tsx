/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { declaredModelKindByName } from '@/common/utils/modelCapabilities';
import { isMediaGenSupported } from '@/common/media/catalog';
import { requestMediaMode, useMediaModeSnapshot } from '@/renderer/hooks/media/mediaModeStore';
import { useAcpModelInfo } from '@/renderer/hooks/agent/useAcpModelInfo';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { classifyConfigSetError, type AcpConfigOptionsPort } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { useClaudeBridgeEnabled, useClaudeBridgeModel } from '@/renderer/hooks/agent/useClaudeBridgeStatus';
import { useCodexBridgeEnabled, useCodexBridgeModel } from '@/renderer/hooks/agent/useCodexBridgeStatus';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getModelDisplayLabel } from '@/renderer/utils/model/agentLogo';
import { iconColors } from '@/renderer/styles/colors';
import { Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { Brain, Down } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPolicyDenialMessage } from '@/renderer/pages/conversation/platforms/policyDenialError';
import RuntimeSelectorPill, { RuntimeSelectorLoadingIndicator } from './RuntimeSelectorPill';
import {
  composeRuntimeSelectorLabel,
  getCurrentThoughtLevelLabel,
  isConfigSetting,
  RUNTIME_SUBMENU_TRIGGER_PROPS,
  RuntimeSelectorCheckedItem,
  RuntimeSelectorModelList,
  type RuntimeSelectorModelGroup,
  RuntimeSelectorSubMenuTitle,
} from './runtimeSelectorOptions';

/**
 * Warmup status for a team teammate's runtime, defined locally so this shared
 * selector never imports team-domain types. Values intentionally mirror
 * TeamAgentRuntimeStatus so TeamPage can pass them through 1:1.
 */
export type AcpWarmupStatus = 'dormant' | 'pending' | 'ready' | 'failed';

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

/**
 * Model selector for ACP-based agents. Renders three states:
 * - null model info: disabled "Use CLI model" button (backward compatible)
 * - no available_models: read-only display of current model name
 * - has available_models: clickable dropdown selector
 *
 * Data fetching/syncing lives in `useAcpModelInfo` so the mobile action
 * sheet can read from the same source.
 */
const AcpModelSelector: React.FC<{
  conversation_id: string;
  /** ACP backend name for loading cached models (e.g., 'claude', 'qwen') */
  backend?: string;
  /** Pre-selected model ID from Guid page */
  initialModelId?: string;
  prepareRuntime?: () => Promise<void>;
  prepareSetRuntime?: () => Promise<void>;
  configOptionsPort?: AcpConfigOptionsPort;
  onRuntimeReadyChange?: (ready: boolean) => void;
  /** Deprecated: runtime config loading now ensures the conversation runtime. */
  waitForWarmup?: boolean;
  /**
   * Optional manual-warmup control for team teammates. Omitted in single chat,
   * so single-chat behavior is unchanged. `trigger` is withheld (undefined)
   * while the whole team is still warming.
   */
  warmup?: {
    status: AcpWarmupStatus;
    trigger?: () => Promise<void>;
  };
}> = ({
  conversation_id,
  backend,
  initialModelId,
  prepareRuntime,
  prepareSetRuntime,
  configOptionsPort,
  onRuntimeReadyChange,
  warmup,
}) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobileHeaderCompact = Boolean(layout?.isMobile);
  const codexBridgeEnabled = useCodexBridgeEnabled();
  const claudeBridgeEnabled = useClaudeBridgeEnabled();
  const codexBridgeModel = useCodexBridgeModel();
  const claudeBridgeModel = useClaudeBridgeModel();
  const isCodexBridgeLocked = backend === 'codex' && codexBridgeEnabled;
  const isClaudeBridgeLocked = backend === 'claude' && claudeBridgeEnabled;
  const isBridgeLocked = isCodexBridgeLocked || isClaudeBridgeLocked;
  // The ACP session's own advertised model name is a snapshot from subprocess
  // spawn time — it doesn't refresh when the bridge config is saved again for
  // an already-running session, so it can show a stale model even though the
  // bridge is actually routing every new request through the currently saved
  // one. Prefer the bridge's own configured model for display when locked.
  const bridgeConfiguredModel = isCodexBridgeLocked
    ? codexBridgeModel
    : isClaudeBridgeLocked
      ? claudeBridgeModel
      : null;
  const bridgeLockedLabelKey = isCodexBridgeLocked ? 'agent.model.codexBridgeLocked' : 'agent.model.claudeBridgeLocked';
  const bridgeLockedTooltipKey = isCodexBridgeLocked
    ? 'agent.model.codexBridgeLockedTooltip'
    : 'agent.model.claudeBridgeLockedTooltip';
  const {
    model_info,
    isRuntimeReady,
    canSwitch,
    isLoading,
    isSetting,
    selectModel,
    thoughtLevel,
    setStatus,
    setConfigOption,
    isConfigOptionBlocked = () => false,
  } = useAcpModelInfo({
    conversation_id,
    backend,
    initialModelId,
    prepareRuntime,
    prepareSetRuntime,
    configOptionsPort,
    // Persistence is the backend's job: the same request that switches the
    // runtime also records the selection (team members get their roster entry
    // updated too). No follow-up call to chain here, so success means switched
    // AND persisted.
    onSelectModelSuccess: () => Message.success(t('agent.model.switchSuccess')),
    onSelectModelFailed: (_modelId, error) =>
      Message.error(getPolicyDenialMessage(error, t) ?? t(configErrorMessageKey(error))),
  });

  useEffect(() => {
    onRuntimeReadyChange?.(isRuntimeReady);
  }, [isRuntimeReady, onRuntimeReadyChange]);

  const defaultModelLabel = t('common.defaultModel');
  const rawDisplayLabel =
    (model_info?.current_model_id &&
      model_info.available_models.find((m) => m.id === model_info.current_model_id)?.label) ||
    model_info?.current_model_label ||
    model_info?.current_model_id ||
    '';
  const display_label = getModelDisplayLabel({
    selected_value: model_info?.current_model_id,
    selectedLabel: rawDisplayLabel,
    defaultModelLabel,
    fallbackLabel: t('conversation.welcome.useCliModel'),
  });
  const combinedLabel = composeRuntimeSelectorLabel({ modelLabel: display_label, thoughtLevel });
  // The ACP session's own advertised model name is a snapshot from subprocess
  // spawn time — it doesn't refresh when the bridge config is saved again for
  // an already-running session, so `display_label` can be stale even though
  // the bridge is actually routing every new request through the currently
  // saved model. Prefer the bridge's own configured model for the label when
  // locked, but keep composing it with the (still-live) thought level.
  const lockedCombinedLabel = bridgeConfiguredModel
    ? composeRuntimeSelectorLabel({ modelLabel: bridgeConfiguredModel, thoughtLevel })
    : combinedLabel;
  // The ACP list comes from the CLI session rather than a provider, so a kind
  // is only available by matching the model name against the user's own
  // declarations — and only when that match is unambiguous.
  const { data: providers } = useProvidersQuery();
  const availableModelsWithKind = useMemo(
    () =>
      (model_info?.available_models ?? []).map((model) => ({
        ...model,
        kind: declaredModelKindByName(providers, model.id),
      })),
    [model_info?.available_models, providers]
  );

  /**
   * Generation models, alongside the CLI's own models.
   *
   * ACP is the awkward case the dream selector did not have: its chat models
   * are advertised by the CLI subprocess, while generation models come from the
   * user's providers. Two sources in one list, so the CLI models get an
   * explicit group header — but only once there is something to disambiguate
   * them from. With no media models configured the list stays exactly the flat
   * list it has always been.
   */
  const mediaMode = useMediaModeSnapshot(conversation_id);
  const { mediaGroups, mediaLookup } = useMemo(() => {
    const groups: RuntimeSelectorModelGroup[] = [];
    const lookup = new Map<string, { kind: 'image' | 'video'; providerId: string; modelName: string }>();
    for (const kind of ['image', 'video'] as const) {
      const models: RuntimeSelectorModelGroup['models'] = [];
      for (const provider of providers ?? []) {
        for (const modelName of provider.models ?? []) {
          if (!isMediaGenSupported(kind, provider, modelName)) continue;
          const id = `media:${kind}:${provider.id}::${modelName}`;
          lookup.set(id, { kind, providerId: provider.id, modelName });
          models.push({ id, label: modelName, kind });
        }
      }
      if (models.length) {
        groups.push({
          key: `media-${kind}`,
          title: t(kind === 'image' ? 'conversation.mediaModeImage' : 'conversation.mediaModeVideo'),
          models,
        });
      }
    }
    return { mediaGroups: groups, mediaLookup: lookup };
  }, [providers, t]);

  // While a generation mode is active the checkmark belongs on the media model
  // that will actually run, not on the CLI model sitting behind it.
  const activeMediaId =
    mediaMode.mode !== 'off' && mediaMode.model
      ? [...mediaLookup.entries()].find(
          ([, entry]) => entry.kind === mediaMode.mode && entry.modelName === mediaMode.model
        )?.[0]
      : undefined;

  const handleModelSelect = useCallback(
    (id: string) => {
      const media = mediaLookup.get(id);
      if (media) {
        // Does not touch the CLI model: these have no chat endpoint. It puts
        // the send box into that generation mode instead.
        requestMediaMode(conversation_id, media.kind, { providerId: media.providerId, model: media.modelName });
        return;
      }
      // Picking a CLI model is also how you leave a generation mode — otherwise
      // the picker can enter one but not exit it.
      if (mediaMode.mode !== 'off') requestMediaMode(conversation_id, 'off');
      void selectModel(id);
    },
    [conversation_id, mediaLookup, mediaMode.mode, selectModel]
  );

  /** Flat while there is nothing to disambiguate; grouped once media exists. */
  const modelListProps = mediaGroups.length
    ? {
        groups: [
          { key: 'cli', title: t('conversation.modelGroupCli'), models: availableModelsWithKind },
          ...mediaGroups,
        ],
      }
    : { models: availableModelsWithKind };

  const isRuntimeSetting = isConfigSetting(setStatus);
  const handleThoughtLevelSelect = useCallback(
    async (value: string) => {
      if (
        !thoughtLevel ||
        value === thoughtLevel.currentValue ||
        isRuntimeSetting ||
        isConfigOptionBlocked(thoughtLevel.id)
      )
        return;
      try {
        await setConfigOption(thoughtLevel.id, value);
        Message.success(t('agent.thoughtLevel.switchSuccess'));
      } catch (error) {
        Message.error(t(configErrorMessageKey(error)));
      }
    },
    [isConfigOptionBlocked, isRuntimeSetting, setConfigOption, thoughtLevel, t]
  );
  const tooltipContent = combinedLabel;

  const renderLogo = () => <Brain theme='outline' size='14' fill={iconColors.secondary} className='shrink-0' />;

  const [triggering, setTriggering] = useState(false);

  // Optimistic spinner clears as soon as warmup leaves 'dormant' (a Pending/
  // Ready/Failed event took over the visual), handing back to event-driven state.
  useEffect(() => {
    if (warmup && warmup.status !== 'dormant') setTriggering(false);
  }, [warmup]);

  const canManualWarmup = Boolean(
    warmup && (warmup.status === 'dormant' || warmup.status === 'failed') && warmup.trigger
  );
  const showWarmupSpinner = triggering || warmup?.status === 'pending';

  const handleWarmupClick = useCallback(async () => {
    if (!warmup?.trigger || triggering) return;
    setTriggering(true);
    try {
      await warmup.trigger();
    } catch {
      // Failure surfaces via the runtime status stream ('failed'); clearing the
      // optimistic spinner here also covers attachAgent rejecting outright
      // (HTTP error, no Pending event) so the spinner never sticks.
    } finally {
      setTriggering(false);
    }
  }, [warmup, triggering]);

  // Read-only pill renderer shared by the `!model_info` and `!canSwitch`
  // branches. When a teammate is dormant/failed with a trigger, it becomes a
  // clickable wake pill; while (optimistically) triggering or pending it shows a
  // spinner; otherwise it stays the existing read-only pill.
  const renderReadonlyPill = (label: string, readonlyTooltip: React.ReactNode) => {
    const clickable = !showWarmupSpinner && canManualWarmup;
    const tooltip = clickable ? t('agent.warmup.clickToWake') : readonlyTooltip;
    return (
      <Tooltip content={tooltip} position='top'>
        <RuntimeSelectorPill
          testId='acp-model-selector-warmup'
          className='sendbox-model-btn header-model-btn agent-mode-compact-pill'
          label={label}
          leading={renderLogo()}
          loading={showWarmupSpinner}
          onClick={clickable ? () => void handleWarmupClick() : undefined}
          style={{ cursor: clickable ? 'pointer' : 'default' }}
        />
      </Tooltip>
    );
  };

  if (!model_info && isLoading) {
    return (
      <div
        data-testid='acp-model-selector-loading'
        className='header-model-loading-slot flex h-28px w-28px shrink-0 items-center justify-center leading-none text-t-secondary'
      >
        <RuntimeSelectorLoadingIndicator />
      </div>
    );
  }

  if (!model_info) {
    return renderReadonlyPill(t('conversation.welcome.useCliModel'), t('conversation.welcome.modelSwitchNotSupported'));
  }

  // Fork: a bridge lock is a *hard* lock — the model is dictated by the
  // Codex/Claude bridge config, so this pill must not offer the warmup
  // click-to-wake affordance that `renderReadonlyPill` attaches.
  if (isBridgeLocked) {
    const lockedPill = (
      <RuntimeSelectorPill
        testId={mediaGroups.length ? 'acp-model-selector-bridge-locked-media' : 'acp-model-selector-bridge-locked'}
        className='sendbox-model-btn header-model-btn agent-mode-compact-pill'
        label={`${lockedCombinedLabel} · ${t(bridgeLockedLabelKey)}`}
        leading={renderLogo()}
        trailing={
          mediaGroups.length ? (
            <Down theme='outline' size={12} fill={iconColors.secondary} className='shrink-0' />
          ) : undefined
        }
        style={{ cursor: mediaGroups.length ? 'pointer' : 'default' }}
      />
    );

    // The lock is on the *chat* model. Generation models are a different axis —
    // picking one never sets the chat model, it switches the send box into a
    // generation mode — so a locked conversation still gets that entry. Without
    // this branch the whole media grouping is unreachable for anyone running
    // the Claude or Codex bridge, which is every ACP conversation once the
    // bridge is on.
    if (!mediaGroups.length) {
      return (
        <Tooltip content={t(bridgeLockedTooltipKey)} position='top'>
          {lockedPill}
        </Tooltip>
      );
    }

    return (
      <Dropdown
        trigger='click'
        {...(isMobileHeaderCompact ? { getPopupContainer: () => document.body } : {})}
        droplist={
          <Menu>
            <Menu.ItemGroup key='locked-note' title={t(bridgeLockedTooltipKey)} />
            <RuntimeSelectorModelList
              groups={mediaGroups}
              currentModelId={activeMediaId ?? null}
              onSelect={handleModelSelect}
            />
          </Menu>
        }
      >
        {lockedPill}
      </Dropdown>
    );
  }

  if (!canSwitch) {
    return renderReadonlyPill(combinedLabel, tooltipContent);
  }

  return (
    <Dropdown
      trigger='click'
      // Mobile: portal the popup to <body> so it escapes the titlebar slot.
      // Desktop: leave default container so click events reach Menu.Item normally.
      {...(isMobileHeaderCompact ? { getPopupContainer: () => document.body } : {})}
      droplist={
        <Menu>
          {thoughtLevel ? (
            <>
              {/* Two-level layout: first level shows model + thought-level rows;
                  each expands into a left-side submenu with the full option list. */}
              <Menu.SubMenu
                key='model'
                triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
                title={
                  <RuntimeSelectorSubMenuTitle
                    label={t('common.model', { defaultValue: 'Model' })}
                    value={display_label}
                  />
                }
              >
                <RuntimeSelectorModelList
                  {...modelListProps}
                  currentModelId={activeMediaId ?? model_info.current_model_id}
                  disabled={isRuntimeSetting || isConfigOptionBlocked('model')}
                  onSelect={handleModelSelect}
                />
              </Menu.SubMenu>
              <Menu.SubMenu
                key='thought-level'
                triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
                title={
                  <RuntimeSelectorSubMenuTitle
                    label={t('agent.thoughtLevel.label')}
                    value={getCurrentThoughtLevelLabel(thoughtLevel)}
                  />
                }
              >
                {thoughtLevel.options.map((item) => (
                  <Menu.Item
                    key={item.value}
                    className={item.value === thoughtLevel.currentValue ? 'bg-2!' : ''}
                    onClick={() => {
                      if (!isRuntimeSetting && !isConfigOptionBlocked(thoughtLevel.id)) {
                        void handleThoughtLevelSelect(item.value);
                      }
                    }}
                  >
                    <RuntimeSelectorCheckedItem
                      selected={item.value === thoughtLevel.currentValue}
                      description={item.description}
                    >
                      {item.label}
                    </RuntimeSelectorCheckedItem>
                  </Menu.Item>
                ))}
              </Menu.SubMenu>
            </>
          ) : (
            /* No thought level: the dropdown is the model list directly. */
            <RuntimeSelectorModelList
              {...modelListProps}
              currentModelId={activeMediaId ?? model_info.current_model_id}
              disabled={isRuntimeSetting || isConfigOptionBlocked('model')}
              onSelect={handleModelSelect}
            />
          )}
        </Menu>
      }
    >
      <RuntimeSelectorPill
        testId='acp-model-selector'
        className='sendbox-model-btn header-model-btn agent-mode-compact-pill'
        label={combinedLabel}
        leading={renderLogo()}
        trailing={<Down theme='outline' size={12} fill={iconColors.secondary} className='shrink-0' />}
        loading={isSetting || isRuntimeSetting}
        disabled={isRuntimeSetting}
      />
    </Dropdown>
  );
};

export default AcpModelSelector;
