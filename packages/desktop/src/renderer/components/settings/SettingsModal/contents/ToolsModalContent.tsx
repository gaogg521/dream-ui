/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import { mcpService } from '@/common/adapter/ipcBridge';
import { type IMcpServer, BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME } from '@/common/config/storage';
import { applyCatalogOverridesJson } from '@/common/media/catalog';
import { type DeclaredMediaModel, hasDeclaredMediaModel, listMediaModels } from '@/common/media/declaredModel';
import { Divider, Dropdown, Form, Input, Menu, Message, Modal, Switch } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import DreamScrollArea from '@/renderer/components/base/DreamScrollArea';
import TalkToButlerButton from '@/renderer/components/base/TalkToButlerButton';
import AddMcpServerModal from '@/renderer/pages/settings/components/AddMcpServerModal';
import McpServerItem from '@/renderer/pages/settings/ToolsSettings/McpServerItem';
import {
  useMcpServers,
  useMcpConnection,
  useMcpModal,
  useMcpServerCRUD,
  useMcpOAuth,
  useMountedMessage,
} from '@/renderer/hooks/mcp';
import { RuntimeSelectorModelList } from '@/renderer/components/agent/runtimeSelectorOptions';
import { persistMediaModelSelection } from '@/renderer/hooks/media/mediaModelSettings';
import { iconColors } from '@/renderer/styles/colors';
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import { useSettingsTabNavigate, useSettingsViewMode } from '../settingsViewContext';
import '@/renderer/pages/settings/components/settings.css';

type MessageInstance = ReturnType<typeof Message.useMessage>[0];

const isBuiltinImageGenServer = (server: IMcpServer) =>
  server.builtin === true && (server.id === BUILTIN_IMAGE_GEN_ID || server.name === BUILTIN_IMAGE_GEN_NAME);

/** Composite id so the grouped model list can track selection across providers. */
const MODEL_ID_SEP = '::';

const GoToModelSettingsLink: React.FC<{ onClick: () => void; t: TFunction }> = ({ onClick, t }) => (
  <button
    type='button'
    className='appearance-none border-none bg-transparent p-0 text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] underline underline-offset-2 cursor-pointer'
    onClick={onClick}
  >
    {t('settings.goToModelSettings')}
  </button>
);

/**
 * The current image/video model — and, when more than one channel offers a
 * declared model of this kind, a way to pick which one is the default.
 *
 * A model's *kind* is still declared exactly one place: Settings > Models. What
 * lives here is narrower — which of the already-declared candidates the
 * assistant should use when it calls the built-in generation tool on its own.
 * That call carries no explicit model (unlike the send box's own media mode,
 * which always names one), so without this the tool silently fell back to
 * "whichever provider happens to be listed first" — invisible, and wrong the
 * moment that channel's key was stale or the model unsupported.
 *
 * Picking here writes the same `tools.{image,video}GenerationModel` setting
 * the send box's own picker writes (`persistMediaModelSelection`), so the two
 * surfaces share one value rather than becoming a second, conflicting truth.
 */
const MediaModelPicker: React.FC<{
  candidates: DeclaredMediaModel[];
  currentProviderId?: string;
  currentModel?: string;
  currentChannel?: string;
  onSelect: (providerId: string, model: string) => void;
  onGoToModelSettings: () => void;
  t: TFunction;
}> = ({ candidates, currentProviderId, currentModel, currentChannel, onSelect, onGoToModelSettings, t }) => {
  const groups = useMemo(() => {
    const byProvider = new Map<string, { key: string; title: string; models: { id: string; label: string }[] }>();
    for (const item of candidates) {
      const group = byProvider.get(item.providerId) ?? {
        key: item.providerId,
        title: item.providerName,
        models: [],
      };
      group.models.push({ id: `${item.providerId}${MODEL_ID_SEP}${item.model}`, label: item.model });
      byProvider.set(item.providerId, group);
    }
    return [...byProvider.values()];
  }, [candidates]);

  const currentModelId =
    currentProviderId && currentModel ? `${currentProviderId}${MODEL_ID_SEP}${currentModel}` : null;

  const handleSelect = useCallback(
    (id: string) => {
      const at = id.indexOf(MODEL_ID_SEP);
      if (at < 0) return;
      onSelect(id.slice(0, at), id.slice(at + MODEL_ID_SEP.length));
    },
    [onSelect]
  );

  if (!currentModel) {
    return (
      <div className='text-t-secondary flex items-center gap-8px flex-wrap'>
        <span>{t('settings.mediaModelUndeclared')}</span>
        <GoToModelSettingsLink onClick={onGoToModelSettings} t={t} />
      </div>
    );
  }

  const label = currentChannel ? `${currentModel} · ${currentChannel}` : currentModel;

  return (
    <div className='flex items-center gap-8px flex-wrap'>
      {candidates.length > 0 ? (
        <Dropdown
          trigger='click'
          droplist={
            <Menu>
              <RuntimeSelectorModelList groups={groups} currentModelId={currentModelId} onSelect={handleSelect} />
            </Menu>
          }
        >
          <button
            type='button'
            className='appearance-none inline-flex items-center gap-4px border border-solid b-color-border-2 rd-6px px-8px py-4px bg-transparent text-t-primary hover:b-color-border-3 cursor-pointer max-w-full'
          >
            <span className='truncate'>{label}</span>
            <Down theme='outline' size='12' fill={iconColors.secondary} className='shrink-0' />
          </button>
        </Dropdown>
      ) : (
        <span className='text-t-primary'>{label}</span>
      )}
      <GoToModelSettingsLink onClick={onGoToModelSettings} t={t} />
    </div>
  );
};

const ModalMcpManagementSection: React.FC<{
  message: MessageInstance;
  mcpServers: IMcpServer[];
  extensionMcpServers: IMcpServer[];
  setMcpServers: React.Dispatch<React.SetStateAction<IMcpServer[]>>;
  saveMcpServers: (serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => Promise<void>;
  isPageMode?: boolean;
}> = ({ message, mcpServers, extensionMcpServers, setMcpServers, saveMcpServers, isPageMode }) => {
  const { t } = useTranslation();
  const { oauthStatus, loggingIn, checkOAuthStatus, markLoginRequired, clearLoginRequired, login } = useMcpOAuth();
  const visibleMcpServers = useMemo(
    () => mcpServers.filter((server) => !isBuiltinImageGenServer(server)),
    [mcpServers]
  );

  const handleAuthRequired = useCallback(
    (server: IMcpServer) => {
      markLoginRequired(server.id);
    },
    [markLoginRequired]
  );
  const handleAuthResolved = useCallback(
    (server: IMcpServer) => {
      clearLoginRequired(server.id);
    },
    [clearLoginRequired]
  );

  const { testingServers, handleTestMcpConnection, handleTestMcpConnections } = useMcpConnection(
    setMcpServers,
    message,
    handleAuthRequired,
    handleAuthResolved
  );
  const {
    showMcpModal,
    editingMcpServer,
    deleteConfirmVisible,
    serverToDelete,
    mcpCollapseKey,
    showAddMcpModal,
    showEditMcpModal,
    hideMcpModal,
    showDeleteConfirm,
    hideDeleteConfirm,
    toggleServerCollapse,
  } = useMcpModal();
  const { handleAddMcpServer, handleBatchImportMcpServers, handleEditMcpServer, handleDeleteMcpServer } =
    useMcpServerCRUD(saveMcpServers);

  const handleOAuthLogin = useCallback(
    async (server: IMcpServer) => {
      const result = await login(server);

      if (result.success) {
        message.success(`${server.name}: ${t('settings.mcpOAuthLoginSuccess') || 'Login successful'}`);
        void handleTestMcpConnection(server);
      } else {
        message.error(`${server.name}: ${result.error || t('settings.mcpOAuthLoginFailed') || 'Login failed'}`);
      }
    },
    [login, message, t, handleTestMcpConnection]
  );

  const wrappedHandleAddMcpServer = useCallback(
    async (serverData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>) => {
      const addedServer = await handleAddMcpServer(serverData);
      if (addedServer) {
        void handleTestMcpConnection(addedServer, { notify: false });
      }
    },
    [handleAddMcpServer, handleTestMcpConnection]
  );

  const wrappedHandleEditMcpServer = useCallback(
    async (serverToEdit: IMcpServer | undefined, serverData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>) => {
      const updatedServer = await handleEditMcpServer(serverToEdit, serverData);
      if (updatedServer) {
        void handleTestMcpConnection(updatedServer, { notify: false });
      }
    },
    [handleEditMcpServer, handleTestMcpConnection]
  );

  const wrappedHandleBatchImportMcpServers = useCallback(
    async (serversData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>[]) => {
      const addedServers = await handleBatchImportMcpServers(serversData);
      if (addedServers && addedServers.length > 0) {
        await handleTestMcpConnections(addedServers, { concurrency: 4, notify: false });
      }
      return addedServers;
    },
    [handleBatchImportMcpServers, handleTestMcpConnections]
  );

  const [importMode, setImportMode] = useState<'json' | 'oneclick'>('json');

  useEffect(() => {
    const httpServers = mcpServers.filter(
      (s) => s.transport.type === 'http' || s.transport.type === 'sse' || s.transport.type === 'streamable_http'
    );
    if (httpServers.length > 0) {
      httpServers.forEach((server) => {
        void checkOAuthStatus(server);
      });
    }
  }, [mcpServers, checkOAuthStatus]);

  const handleConfirmDelete = useCallback(async () => {
    if (!serverToDelete) return;
    hideDeleteConfirm();
    await handleDeleteMcpServer(serverToDelete);
  }, [serverToDelete, hideDeleteConfirm, handleDeleteMcpServer]);

  const renderAddButton = () => {
    return (
      <TalkToButlerButton
        label={t('settings.mcpAddServer')}
        chatLabel={t('settings.talkToButler.addViaChat', { defaultValue: 'Add via chat' })}
        prompt={t('settings.talkToButler.prompt.addMcp', { defaultValue: 'Help me set up an MCP server.' })}
        extraActions={[
          {
            key: 'json',
            label: t('settings.mcpImportFromJSON'),
            onClick: () => {
              setImportMode('json');
              showAddMcpModal();
            },
          },
          {
            key: 'oneclick',
            label: t('settings.mcpOneKeyImport'),
            onClick: () => {
              setImportMode('oneclick');
              showAddMcpModal();
            },
          },
        ]}
      />
    );
  };

  return (
    <div className='flex flex-col gap-16px min-h-0'>
      <div className='flex gap-8px items-center justify-between'>
        <div className='text-14px text-t-primary'>{t('settings.mcpSettings')}</div>
        <div>{renderAddButton()}</div>
      </div>

      <div className='flex-1 min-h-0'>
        {visibleMcpServers.length === 0 && extensionMcpServers.length === 0 ? (
          <div className='py-24px text-center text-t-secondary text-14px border border-dashed border-border-2 rd-12px'>
            {t('settings.mcpNoServersFound')}
          </div>
        ) : (
          <DreamScrollArea
            className={classNames('max-h-360px', isPageMode && 'max-h-none')}
            disableOverflow={isPageMode}
          >
            <div className='space-y-12px'>
              {visibleMcpServers.map((server) => (
                <McpServerItem
                  key={server.id}
                  server={server}
                  isCollapsed={mcpCollapseKey[server.id] || false}
                  isTestingConnection={testingServers[server.id] || false}
                  oauthStatus={oauthStatus[server.id]}
                  isLoggingIn={loggingIn[server.id]}
                  onToggleCollapse={() => toggleServerCollapse(server.id)}
                  onTestConnection={handleTestMcpConnection}
                  onEditServer={showEditMcpModal}
                  onDeleteServer={showDeleteConfirm}
                  onOAuthLogin={handleOAuthLogin}
                />
              ))}
              {extensionMcpServers.map((server) => (
                <McpServerItem
                  key={server.id}
                  server={server}
                  isCollapsed={mcpCollapseKey[server.id] || false}
                  isTestingConnection={false}
                  onToggleCollapse={() => toggleServerCollapse(server.id)}
                  onTestConnection={handleTestMcpConnection}
                  onEditServer={() => {}}
                  onDeleteServer={() => {}}
                  isReadOnly
                />
              ))}
            </div>
          </DreamScrollArea>
        )}
      </div>

      <AddMcpServerModal
        visible={showMcpModal}
        server={editingMcpServer}
        existingServerNames={mcpServers.map((server) => server.name)}
        onCancel={hideMcpModal}
        onSubmit={
          editingMcpServer
            ? (serverData) => wrappedHandleEditMcpServer(editingMcpServer, serverData)
            : wrappedHandleAddMcpServer
        }
        onBatchImport={wrappedHandleBatchImportMcpServers}
        importMode={importMode}
      />

      <Modal
        title={t('settings.mcpDeleteServer')}
        visible={deleteConfirmVisible}
        onCancel={hideDeleteConfirm}
        onOk={handleConfirmDelete}
        okButtonProps={{ status: 'danger' }}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <p>{t('settings.mcpDeleteConfirm')}</p>
      </Modal>
    </div>
  );
};

const ToolsModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [rawMcpMessage, mcpMessageContext] = Message.useMessage({ maxCount: 10 });
  // ELECTRON-1A1: guard message calls so async MCP callbacks that resolve after this
  // component unmounts don't hit a null Arco context holder (null.addInstance crash).
  const mcpMessage = useMountedMessage(rawMcpMessage);
  const [catalogOverrides, setCatalogOverrides] = useState('');
  const [catalogOverrideErrors, setCatalogOverrideErrors] = useState<string[]>([]);
  const [isUpdatingImageGeneration, setIsUpdatingImageGeneration] = useState(false);
  // The explicit default for the assistant's autonomous tool call — the same
  // `tools.{image,video}GenerationModel` setting the send box's own picker
  // writes to (`useMediaComposer`) and `resolveSelectedProvider`
  // (process/services/mediaJob) reads with priority over any declared model.
  // Undefined means no explicit default has been picked yet: the first
  // declared model is used, in provider order.
  const [imageSelection, setImageSelection] = useState<ImageGenerationModelSetting | undefined>();
  const [videoSelection, setVideoSelection] = useState<ImageGenerationModelSetting | undefined>();
  const { data: providers } = useProvidersQuery();
  const { mcpServers, extensionMcpServers, saveMcpServers, setMcpServers, isMcpServersLoading } = useMcpServers();
  const builtinImageGenServer = useMemo(() => mcpServers.find(isBuiltinImageGenServer), [mcpServers]);
  const isImageGenerationServerLoading = isMcpServersLoading && !builtinImageGenServer;

  // Every provider+model declared as this kind, grouped for the picker below —
  // the same list the send box's own media picker offers, so the two never
  // disagree about what is selectable.
  const imageCandidates = useMemo(() => listMediaModels('image', providers), [providers]);
  const videoCandidates = useMemo(() => listMediaModels('video', providers), [providers]);

  // What the next autonomous tool call would actually run on: the explicit
  // default first, falling back to the first declared candidate — matching the
  // priority `resolveSelectedProvider` and `useMediaComposer` already use. The
  // channel name travels with whichever one wins, so it is never a guess.
  const currentImageProviderId = imageSelection?.id ?? imageCandidates[0]?.providerId;
  const currentImageModel = imageSelection?.use_model ?? imageCandidates[0]?.model;
  const currentImageChannel = imageSelection?.name ?? imageCandidates[0]?.providerName;
  const currentVideoProviderId = videoSelection?.id ?? videoCandidates[0]?.providerId;
  const currentVideoModel = videoSelection?.use_model ?? videoCandidates[0]?.model;
  const currentVideoChannel = videoSelection?.name ?? videoCandidates[0]?.providerName;

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const [storedImage, storedVideo, storedOverrides] = await Promise.all([
          getClientBusinessSetting('tools.imageGenerationModel'),
          getClientBusinessSetting('tools.videoGenerationModel'),
          getClientBusinessSetting('tools.mediaCatalogOverrides'),
        ]);
        const applied = applyCatalogOverridesJson(storedOverrides || '');
        setCatalogOverrides(storedOverrides || '');
        setCatalogOverrideErrors(applied.errors);
        setImageSelection(storedImage || undefined);
        setVideoSelection(storedVideo || undefined);
      } catch (error) {
        console.error('Failed to load tools config:', error);
      }
    };

    void loadConfigs();
  }, []);

  const handleCatalogOverridesChange = useCallback((value: string) => {
    setCatalogOverrides(value);
    // Apply immediately so the current-model line above reflects the edit
    // without a save-and-reload round trip; errors surface inline.
    const applied = applyCatalogOverridesJson(value);
    setCatalogOverrideErrors(applied.errors);
    setClientBusinessSetting('tools.mediaCatalogOverrides', value).catch((error) => {
      console.error('Failed to persist media catalog overrides:', error);
    });
  }, []);

  // Sets the explicit default the assistant's autonomous tool call resolves to
  // for this kind — writing the same setting the send box's own picker uses, so
  // both stay in agreement about "the" current model. Optimistic: the local
  // selection updates immediately, same as the catalog-overrides field above.
  const handleImageModelSelect = useCallback(
    (providerId: string, model: string) => {
      const provider = providers?.find((item) => item.id === providerId);
      if (!provider) return;
      const ref = { id: provider.id, name: provider.name, platform: provider.platform, use_model: model };
      setImageSelection((prev) => ({ ...prev, ...ref, base_url: '', api_key: '' }) as ImageGenerationModelSetting);
      persistMediaModelSelection('image', ref).catch((error) => {
        console.error('Failed to persist image generation model selection:', error);
      });
    },
    [providers]
  );
  const handleVideoModelSelect = useCallback(
    (providerId: string, model: string) => {
      const provider = providers?.find((item) => item.id === providerId);
      if (!provider) return;
      const ref = { id: provider.id, name: provider.name, platform: provider.platform, use_model: model };
      setVideoSelection((prev) => ({ ...prev, ...ref, base_url: '', api_key: '' }) as ImageGenerationModelSetting);
      persistMediaModelSelection('video', ref).catch((error) => {
        console.error('Failed to persist video generation model selection:', error);
      });
    },
    [providers]
  );

  const handleImageGenerationToggle = useCallback(
    async (checked: boolean) => {
      if (!builtinImageGenServer) return;

      setIsUpdatingImageGeneration(true);
      try {
        // The toggle governs one thing: whether the assistant may call the media
        // MCP tool on its own. The model comes from Settings > Models (or a
        // conversation pick); there is nothing to configure here first.
        const updatedServer = await mcpService.toggleServer.invoke({ id: builtinImageGenServer.id });
        await saveMcpServers((prevServers) =>
          prevServers.map((server) => (server.id === updatedServer.id ? { ...server, ...updatedServer } : server))
        );

        if (updatedServer.enabled !== checked) {
          mcpMessage.error(checked ? t('settings.mcpSyncError') : t('settings.mcpRemoveError'));
        }
      } catch (error) {
        console.error('Failed to toggle image generation MCP server:', error);
        mcpMessage.error(error instanceof Error ? error.message : t('settings.mcpSyncError'));
      } finally {
        setIsUpdatingImageGeneration(false);
      }
    },
    [builtinImageGenServer, mcpMessage, saveMcpServers, t]
  );

  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const routerNavigate = useNavigate();
  const settingsTabNavigate = useSettingsTabNavigate();
  // Page hosts must inject SettingsTabNavigateProvider; fall back to the model
  // settings route so "go configure" never renders as dead plain text.
  const goToModelSettings = useCallback(() => {
    if (settingsTabNavigate) {
      settingsTabNavigate('model');
      return;
    }
    void routerNavigate('/settings/model');
  }, [routerNavigate, settingsTabNavigate]);
  // The toggle can turn on once the user has a media model at all — declared in
  // Settings > Models, or a legacy explicit pick. It never required a pick here.
  const canEnableImageGeneration = Boolean(
    hasDeclaredMediaModel(providers) || imageSelection?.use_model || videoSelection?.use_model
  );

  return (
    <div className='flex flex-col h-full w-full'>
      {mcpMessageContext}

      {/* Content Area */}
      <DreamScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          {/* MCP 工具配置 */}
          <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px flex flex-col min-h-0 border border-border-2'>
            <div className='flex-1 min-h-0'>
              <DreamScrollArea
                className={classNames('h-full', isPageMode && 'overflow-visible')}
                disableOverflow={isPageMode}
              >
                <ModalMcpManagementSection
                  message={mcpMessage}
                  mcpServers={mcpServers}
                  extensionMcpServers={extensionMcpServers}
                  setMcpServers={setMcpServers}
                  saveMcpServers={saveMcpServers}
                  isPageMode={isPageMode}
                />
              </DreamScrollArea>
            </div>
          </div>
          {/* 图像生成 */}
          <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-border-2'>
            <div className='flex items-center justify-between mb-16px'>
              {/* The switch governs the built-in MCP tool — whether the
                  assistant may generate images on its own during a turn. It has
                  never governed the send box's own image mode, which calls the
                  engine directly. A bare "Image generation" label over a master
                  switch reads as an on/off for the whole feature, so the scope
                  is spelled out rather than left to be discovered. */}
              <div className='flex flex-col gap-2px min-w-0 pr-12px'>
                <span className='text-14px text-t-primary'>{t('settings.imageGeneration')}</span>
                <span className='text-12px text-t-secondary'>{t('settings.imageGenerationSwitchHint')}</span>
              </div>
              <Switch
                // Green when on, matching every other settings toggle in the
                // app. Without it the checked track is only a darker grey than
                // the unchecked one — measured rgb(78,89,105) against
                // rgb(201,205,212) — so "on" and "off" read as the same state.
                className='settings-switch-on'
                disabled={
                  isUpdatingImageGeneration ||
                  isImageGenerationServerLoading ||
                  !builtinImageGenServer ||
                  (!builtinImageGenServer.enabled && !canEnableImageGeneration)
                }
                checked={Boolean(builtinImageGenServer?.enabled) && !isImageGenerationServerLoading}
                loading={isImageGenerationServerLoading}
                onChange={handleImageGenerationToggle}
              />
            </div>

            <Divider className='mt-0px mb-20px' />

            <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
              <Form.Item
                label={t('settings.imageGenerationModel')}
                tooltip={
                  <div className='space-y-4px'>
                    <div>{t('settings.imageGenSupportedTooltipTitle')}</div>
                    <ul className='list-disc ps-16px m-0'>
                      <li>{t('settings.imageGenSupportedTooltipGemini')}</li>
                      <li>{t('settings.imageGenSupportedTooltipOpenRouter')}</li>
                      <li>{t('settings.imageGenSupportedTooltipAntigravity')}</li>
                      <li>{t('settings.imageGenSupportedTooltipImagesApi')}</li>
                    </ul>
                    <div>{t('settings.imageGenUnsupportedTooltip')}</div>
                  </div>
                }
              >
                <div className='flex flex-col gap-4px'>
                  <MediaModelPicker
                    candidates={imageCandidates}
                    currentProviderId={currentImageProviderId}
                    currentModel={currentImageModel}
                    currentChannel={currentImageChannel}
                    onSelect={handleImageModelSelect}
                    onGoToModelSettings={goToModelSettings}
                    t={t}
                  />
                  <span className='text-12px text-t-tertiary'>{t('settings.mediaModelPickerHint')}</span>
                </div>
              </Form.Item>
            </Form>
          </div>
          {/* 视频生成 */}
          <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-border-2'>
            <div className='flex items-center justify-between mb-16px'>
              <span className='text-14px text-t-primary'>{t('settings.videoGeneration')}</span>
            </div>

            <Divider className='mt-0px mb-20px' />

            <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
              <Form.Item
                label={t('settings.videoGenerationModel')}
                tooltip={
                  <div className='space-y-4px'>
                    <div>{t('settings.videoGenSupportedTooltipTitle')}</div>
                    <ul className='list-disc pl-16px m-0'>
                      <li>{t('settings.videoGenSupportedTooltipSeedance')}</li>
                      <li>{t('settings.videoGenSupportedTooltipWanx')}</li>
                    </ul>
                    <div>{t('settings.videoGenUnsupportedTooltip')}</div>
                  </div>
                }
              >
                <div className='flex flex-col gap-4px'>
                  <MediaModelPicker
                    candidates={videoCandidates}
                    currentProviderId={currentVideoProviderId}
                    currentModel={currentVideoModel}
                    currentChannel={currentVideoChannel}
                    onSelect={handleVideoModelSelect}
                    onGoToModelSettings={goToModelSettings}
                    t={t}
                  />
                  <span className='text-12px text-t-tertiary'>{t('settings.mediaModelPickerHint')}</span>
                </div>
              </Form.Item>
              <Form.Item
                label={t('settings.mediaCatalogOverrides')}
                tooltip={t('settings.mediaCatalogOverridesTooltip')}
              >
                <div className='flex flex-col gap-4px'>
                  <Input.TextArea
                    value={catalogOverrides}
                    onChange={handleCatalogOverridesChange}
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    placeholder={
                      '[{"id":"my-model","kind":"image","form":"A","match":{"model":"/^my-/i"},"params":{"sizes":["1024x1024"]}}]'
                    }
                    spellCheck={false}
                  />
                  {catalogOverrideErrors.length > 0 && (
                    <div className='text-12px text-danger flex flex-col gap-2px'>
                      {catalogOverrideErrors.map((error) => (
                        <span key={error}>{error}</span>
                      ))}
                    </div>
                  )}
                </div>
              </Form.Item>
            </Form>
          </div>
        </div>
      </DreamScrollArea>
    </div>
  );
};

export default ToolsModalContent;
