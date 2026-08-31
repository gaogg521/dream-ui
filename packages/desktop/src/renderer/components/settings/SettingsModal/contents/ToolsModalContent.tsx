/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import { mcpService } from '@/common/adapter/ipcBridge';
import { type IMcpServer, BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME } from '@/common/config/storage';
import { applyCatalogOverridesJson } from '@/common/media/catalog';
import { findDeclaredMediaModel, hasDeclaredMediaModel } from '@/common/media/declaredModel';
import { Divider, Form, Input, Message, Modal, Switch } from '@arco-design/web-react';
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
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import { useSettingsTabNavigate, useSettingsViewMode } from '../settingsViewContext';
import '@/renderer/pages/settings/components/settings.css';

type MessageInstance = ReturnType<typeof Message.useMessage>[0];

const isBuiltinImageGenServer = (server: IMcpServer) =>
  server.builtin === true && (server.id === BUILTIN_IMAGE_GEN_ID || server.name === BUILTIN_IMAGE_GEN_NAME);

/**
 * The current image/video model, read-only.
 *
 * The model is chosen where it is used — the send box's media picker in a
 * conversation, or by declaring a model's kind in Settings > Models. This line
 * only reports the result and points at that page; it is not a second place to
 * configure one (which is exactly the redundancy this section used to have).
 */
const MediaModelSummary: React.FC<{ model?: string; onGoToModelSettings: () => void; t: TFunction }> = ({
  model,
  onGoToModelSettings,
  t,
}) => (
  <div className='text-t-secondary flex items-center gap-8px flex-wrap'>
    <span className={model ? 'text-t-primary' : undefined}>{model || t('settings.mediaModelUndeclared')}</span>
    <button
      type='button'
      className='appearance-none border-none bg-transparent p-0 text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] underline underline-offset-2 cursor-pointer'
      onClick={onGoToModelSettings}
    >
      {t('settings.goToModelSettings')}
    </button>
  </div>
);

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
  // Legacy explicit picks, kept only to display and to keep the toggle enabled
  // for setups that predate `model_kind`. New choices are made in a conversation
  // (the send box's media picker) or by declaring a model's kind in Settings >
  // Models — never here.
  const [imageSelection, setImageSelection] = useState<ImageGenerationModelSetting | undefined>();
  const [videoSelection, setVideoSelection] = useState<ImageGenerationModelSetting | undefined>();
  const { data: providers } = useProvidersQuery();
  const { mcpServers, extensionMcpServers, saveMcpServers, setMcpServers, isMcpServersLoading } = useMcpServers();
  const builtinImageGenServer = useMemo(() => mcpServers.find(isBuiltinImageGenServer), [mcpServers]);
  const isImageGenerationServerLoading = isMcpServersLoading && !builtinImageGenServer;

  // What the next generation would run on: a model declared as image/video in
  // Settings > Models, falling back to a legacy explicit pick. Display only.
  const currentImageModel =
    findDeclaredMediaModel('image', providers)?.use_model ?? imageSelection?.use_model ?? undefined;
  const currentVideoModel =
    findDeclaredMediaModel('video', providers)?.use_model ?? videoSelection?.use_model ?? undefined;

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
                <MediaModelSummary model={currentImageModel} onGoToModelSettings={goToModelSettings} t={t} />
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
                <MediaModelSummary model={currentVideoModel} onGoToModelSettings={goToModelSettings} t={t} />
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
