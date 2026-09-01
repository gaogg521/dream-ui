/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DreamEngineModelSelection } from './useDreamEngineModelSelection';
import type { AcpConfigSetStatus, AcpDerivedOption } from '@/renderer/hooks/agent/useAcpConfigOptions';
import {
  composeRuntimeSelectorLabel,
  getCurrentThoughtLevelLabel,
  RUNTIME_SUBMENU_TRIGGER_PROPS,
  RuntimeSelectorCheckedItem,
  RuntimeSelectorModelList,
  type RuntimeSelectorModelGroup,
  RuntimeSelectorSubMenuTitle,
} from '@/renderer/components/agent/runtimeSelectorOptions';
import { isChatCapableModel, modelKindLabelOf } from '@/common/utils/modelCapabilities';
import { isMediaGenSupported } from '@/common/media/catalog';
import { requestMediaMode, useMediaModeSnapshot } from '@/renderer/hooks/media/mediaModeStore';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getModelDisplayLabel } from '@/renderer/utils/model/agentLogo';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Brain, Down } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

/** Composite id for a provider+model pair, so the shared flat model list can track selection. */
const compositeId = (providerId: string, modelName: string) => `${providerId}::${modelName}`;

const DreamEngineModelSelector: React.FC<{
  selection?: DreamEngineModelSelection;
  disabled?: boolean;
  thoughtLevel?: AcpDerivedOption | null;
  /** Kept for call-site compatibility; the two-level submenu no longer gates on set status here. */
  setStatus?: AcpConfigSetStatus;
  onSetThoughtLevel?: (optionId: string, value: string) => Promise<unknown>;
  /** Lets the pill follow the send box into a generation mode. */
  conversation_id?: string;
}> = ({ selection, disabled = false, thoughtLevel = null, onSetThoughtLevel, conversation_id }) => {
  const { t } = useTranslation();
  const mediaMode = useMediaModeSnapshot(conversation_id);
  const { isOpen: isPreviewOpen } = usePreviewContext();
  const layout = useLayoutContext();
  const compact = isPreviewOpen || layout?.isMobile;
  const isMobileHeaderCompact = Boolean(layout?.isMobile);
  const defaultModelLabel = t('common.defaultModel');

  const current_model = selection?.current_model;

  const renderLogo = () => <Brain theme='outline' size='14' fill={iconColors.secondary} className='shrink-0' />;

  if (disabled || !selection) {
    return (
      <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
        <Button
          className={classNames(
            'sendbox-model-btn header-model-btn',
            compact && '!max-w-[120px]',
            isMobileHeaderCompact && '!max-w-[160px]'
          )}
          shape='round'
          size='small'
          style={{ cursor: 'default' }}
        >
          <span className='flex items-center gap-6px min-w-0'>
            {renderLogo()}
            <span className={compact ? 'block truncate' : undefined}>{t('conversation.welcome.useCliModel')}</span>
          </span>
        </Button>
      </Tooltip>
    );
  }

  const { providers, getAvailableModels, handleSelectModel } = selection;

  const label = getModelDisplayLabel({
    selected_value: current_model?.use_model,
    selectedLabel: current_model?.use_model || '',
    defaultModelLabel,
    fallbackLabel: t('conversation.welcome.selectModel'),
  });
  const combinedLabel = composeRuntimeSelectorLabel({ modelLabel: label, thoughtLevel });

  // While a generation mode is active the next Enter runs the *media* model, so
  // that is what the pill must name. Naming the chat model here is how the user
  // ends up reading two different answers to "which model is this".
  const mediaLabel =
    mediaMode.mode === 'off'
      ? null
      : `${mediaMode.mode === 'video' ? t('conversation.mediaModeVideo') : t('conversation.mediaModeImage')} · ${
          mediaMode.model || t('conversation.welcome.selectModel')
        }`;

  // A conversation pinned to a model that has no chat endpoint answers every
  // message with a bare `404 model not found`. The picker no longer offers such
  // models, but conversations created before that still carry one.
  const pinnedModel = current_model?.use_model;
  const pinnedProvider = pinnedModel ? providers.find((p) => p.id === current_model?.id) : undefined;
  const pinnedCannotChat = Boolean(
    mediaMode.mode === 'off' && pinnedModel && pinnedProvider && !isChatCapableModel(pinnedProvider, pinnedModel)
  );
  const handleThoughtLevelSelect = (value: string) => {
    if (!thoughtLevel || value === thoughtLevel.currentValue || !onSetThoughtLevel) return;
    void onSetThoughtLevel(thoughtLevel.id, value);
  };

  // dream models are grouped by provider. Use a composite id (see compositeId)
  // so the shared model list can track selection, and map it back on select.
  const modelGroups: RuntimeSelectorModelGroup[] = [];
  const modelLookup = new Map<string, { provider: (typeof providers)[number]; modelName: string }>();
  for (const provider of providers) {
    const models = getAvailableModels(provider);
    if (!models.length) continue;
    modelGroups.push({
      key: provider.id,
      title: provider.name,
      models: models.map((modelName) => {
        const id = compositeId(provider.id, modelName);
        modelLookup.set(id, { provider, modelName });
        return Object.assign({ id, label: modelName }, modelKindLabelOf(provider, modelName));
      }),
    });
  }
  /**
   * Generation models, in the same picker as the chat models.
   *
   * They used to live only in Settings → Tools, so declaring a model as video
   * made it disappear from the conversation entirely — the declaration looked
   * like it had done nothing, and the generation entry was a button labelled
   * "对话" that gave no hint of what was behind it. One picker answering one
   * question — "what runs my next message" — is the whole point.
   *
   * Selecting one does NOT set the chat model (a chat request to these returns
   * `404 model not found`); it puts the send box into that generation mode with
   * that model, via `requestMediaMode`.
   */
  const mediaLookup = new Map<string, { kind: 'image' | 'video'; providerId: string; modelName: string }>();
  for (const kind of ['image', 'video'] as const) {
    const models: RuntimeSelectorModelGroup['models'] = [];
    for (const provider of providers) {
      for (const modelName of provider.models ?? []) {
        if (!isMediaGenSupported(kind, provider, modelName)) continue;
        const id = `media:${kind}:${compositeId(provider.id, modelName)}`;
        mediaLookup.set(id, { kind, providerId: provider.id, modelName });
        models.push({ id, label: modelName, kind, inferred: false });
      }
    }
    if (models.length) {
      modelGroups.push({
        key: `media-${kind}`,
        title: t(kind === 'image' ? 'conversation.mediaModeImage' : 'conversation.mediaModeVideo'),
        models,
      });
    }
  }

  // While a generation mode is active the checkmark belongs on the media model
  // that will actually run, not on the chat model sitting behind it.
  const activeMediaId =
    mediaMode.mode !== 'off' && mediaMode.model
      ? [...mediaLookup.entries()].find(
          ([, entry]) => entry.kind === mediaMode.mode && entry.modelName === mediaMode.model
        )?.[0]
      : undefined;
  const currentCompositeId =
    activeMediaId ?? (current_model ? compositeId(current_model.id, current_model.use_model || '') : null);
  const handleModelSelect = (id: string) => {
    const media = mediaLookup.get(id);
    if (media) {
      requestMediaMode(conversation_id, media.kind, { providerId: media.providerId, model: media.modelName });
      return;
    }
    const entry = modelLookup.get(id);
    if (entry) {
      // Picking a chat model is also how you leave a generation mode — the
      // alternative is a picker that can enter a mode but not exit it.
      if (mediaMode.mode !== 'off') requestMediaMode(conversation_id, 'off');
      void handleSelectModel(entry.provider, entry.modelName);
    }
  };

  const modelListNode = (
    <RuntimeSelectorModelList groups={modelGroups} currentModelId={currentCompositeId} onSelect={handleModelSelect} />
  );

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
              <Menu.SubMenu
                key='model'
                triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
                title={
                  <RuntimeSelectorSubMenuTitle label={t('common.model', { defaultValue: 'Model' })} value={label} />
                }
              >
                {modelListNode}
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
                    className={item.value === thoughtLevel.currentValue ? '!bg-2' : ''}
                    onClick={() => handleThoughtLevelSelect(item.value)}
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
            modelListNode
          )}
        </Menu>
      }
    >
      <Button
        data-testid='dream-engine-model-selector'
        className={classNames(
          'sendbox-model-btn header-model-btn',
          compact && '!max-w-[120px]',
          isMobileHeaderCompact && '!max-w-[160px]'
        )}
        shape='round'
        size='small'
      >
        <span className='flex items-center gap-6px min-w-0'>
          {renderLogo()}
          <span className={compact ? 'block truncate' : undefined}>{mediaLabel ?? combinedLabel}</span>
          {pinnedCannotChat && (
            <Tooltip content={t('conversation.modelCannotChat', { model: pinnedModel })}>
              <span className='shrink-0 text-danger' data-testid='model-cannot-chat'>
                !
              </span>
            </Tooltip>
          )}
          <Down theme='outline' size={12} fill={iconColors.secondary} className='shrink-0' />
        </span>
      </Button>
    </Dropdown>
  );
};

export default DreamEngineModelSelector;
