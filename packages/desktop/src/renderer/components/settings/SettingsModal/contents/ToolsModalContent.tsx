/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import { removeImageGenerationEnvKeys, resolveImageGenerationMcpEnv } from '@/common/config/imageGenerationMcpEnv';
import { mcpService } from '@/common/adapter/ipcBridge';
import { type IMcpServer, BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME } from '@/common/config/storage';
import { isImageGenSupported } from '@/common/utils/imageModelAllowlist';
import { applyCatalogOverridesJson, isMediaGenSupported } from '@/common/media/catalog';
import { findDeclaredMediaModel } from '@/common/media/declaredModel';
import { Divider, Form, Input, Tooltip, Message, Modal, Switch } from '@arco-design/web-react';
import { Help } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useConfigModelListWithImage from '@/renderer/hooks/agent/useConfigModelListWithImage';
import DreamScrollArea from '@/renderer/components/base/DreamScrollArea';
import DreamSelect from '@/renderer/components/base/DreamSelect';
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
import {
  getClientBusinessSetting,
  removeClientBusinessSetting,
  setClientBusinessSetting,
} from '@/renderer/services/clientBusinessSettings';
import classNames from 'classnames';
import { useNavigate } from 'react-router-dom';
import { useSettingsTabNavigate, useSettingsViewMode } from '../settingsViewContext';
import '@/renderer/pages/settings/components/settings.css';

type MessageInstance = ReturnType<typeof Message.useMessage>[0];

const isBuiltinImageGenServer = (server: IMcpServer) =>
  server.builtin === true && (server.id === BUILTIN_IMAGE_GEN_ID || server.name === BUILTIN_IMAGE_GEN_NAME);
const areEnvRecordsEqual = (a: Record<string, string>, b: Record<string, string>) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
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
  const [imageGenerationModel, setImageGenerationModel] = useState<ImageGenerationModelSetting | undefined>();
  const [videoGenerationModel, setVideoGenerationModel] = useState<ImageGenerationModelSetting | undefined>();
  const [catalogOverrides, setCatalogOverrides] = useState('');
  const [catalogOverrideErrors, setCatalogOverrideErrors] = useState<string[]>([]);
  const [isUpdatingImageGeneration, setIsUpdatingImageGeneration] = useState(false);
  const { modelListWithImage: data } = useConfigModelListWithImage();
  const { mcpServers, extensionMcpServers, saveMcpServers, setMcpServers, isMcpServersLoading } = useMcpServers();
  const builtinImageGenServer = useMemo(() => mcpServers.find(isBuiltinImageGenServer), [mcpServers]);
  const isImageGenerationServerLoading = isMcpServersLoading && !builtinImageGenServer;

  const imageGenerationModelList = useMemo(() => {
    if (!data) return [];
    return (data || [])
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((modelName) => isImageGenSupported(provider, modelName)),
      }))
      .filter((provider) => provider.models.length > 0);
  }, [data]);

  const videoGenerationModelList = useMemo(() => {
    if (!data) return [];
    return (data || [])
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((modelName) => isMediaGenSupported('video', provider, modelName)),
      }))
      .filter((provider) => provider.models.length > 0);
  }, [data]);

  /**
   * These two dropdowns are an explicit *override*, empty by default. When
   * nothing is picked the runtime still works — the send box and the media MCP
   * both fall back to the first declared media model (`findDeclaredMediaModel`).
   * Show that model here so an empty control does not read as "not configured".
   */
  const imageModelFallback = useMemo(
    () => (imageGenerationModel?.use_model ? undefined : findDeclaredMediaModel('image', data)),
    [imageGenerationModel?.use_model, data]
  );
  const videoModelFallback = useMemo(
    () => (videoGenerationModel?.use_model ? undefined : findDeclaredMediaModel('video', data)),
    [videoGenerationModel?.use_model, data]
  );

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const [storedModel, storedVideoModel, storedOverrides] = await Promise.all([
          getClientBusinessSetting('tools.imageGenerationModel'),
          getClientBusinessSetting('tools.videoGenerationModel'),
          getClientBusinessSetting('tools.mediaCatalogOverrides'),
        ]);
        // Install before the dropdowns compute their candidates: the picker and
        // the executor must agree on what is selectable.
        const applied = applyCatalogOverridesJson(storedOverrides || '');
        setCatalogOverrides(storedOverrides || '');
        setCatalogOverrideErrors(applied.errors);
        if (storedModel) {
          setImageGenerationModel(storedModel);
        }
        if (storedVideoModel) {
          setVideoGenerationModel(storedVideoModel);
        }
      } catch (error) {
        console.error('Failed to load tools config:', error);
      }
    };

    void loadConfigs();
  }, []);

  // Sync image generation model config to the built-in MCP server's transport.env
  const syncMcpServerEnv = useCallback(
    async (model: Partial<ImageGenerationModelSetting>) => {
      const builtinServer = mcpServers.find(isBuiltinImageGenServer);
      if (!builtinServer || builtinServer.transport.type !== 'stdio') return;

      const existingEnv = builtinServer.transport.env || {};
      let env: Record<string, string>;

      if (!model.id && !model.use_model) {
        env = removeImageGenerationEnvKeys(existingEnv);
        console.info('[ImageGen] Cleared built-in MCP image env because image generation model is unset');
      } else {
        const resolution = resolveImageGenerationMcpEnv(model, data || [], existingEnv);
        if (resolution.ok === false) {
          console.error('[ImageGen] Failed to resolve image MCP provider', {
            reason: resolution.reason,
            message: resolution.message,
            candidates: resolution.candidates,
          });
          throw new Error(resolution.message);
        }

        env = {
          ...removeImageGenerationEnvKeys(existingEnv),
          ...resolution.env,
        };
        console.info(
          '[ImageGen] Syncing built-in MCP image env via %s, provider id: %s, platform: %s, model: %s, api key present: %s',
          resolution.source,
          resolution.provider.id,
          resolution.provider.platform,
          resolution.model,
          resolution.provider.api_key ? 'yes' : 'no'
        );
      }

      if (areEnvRecordsEqual(existingEnv, env)) {
        return;
      }

      const updatedTransport = { ...builtinServer.transport, env };
      const original_json = JSON.stringify(
        {
          mcpServers: {
            [builtinServer.name]: {
              command: updatedTransport.command,
              args: updatedTransport.args || [],
              env,
            },
          },
        },
        null,
        2
      );

      const updatedServer = await mcpService.updateServer.invoke({
        id: builtinServer.id,
        data: {
          transport: updatedTransport,
          original_json,
        },
      });
      await saveMcpServers((prevServers) =>
        prevServers.map((server) => (server.id === updatedServer.id ? { ...server, ...updatedServer } : server))
      );
    },
    [data, mcpServers, saveMcpServers]
  );

  // Keep the saved image model as a provider/model reference. Secrets stay in providers.
  useEffect(() => {
    if (!imageGenerationModel || !data) return;

    const currentProvider = data.find((p) => p.id === imageGenerationModel.id);

    if (!currentProvider) {
      setImageGenerationModel(undefined);
      removeClientBusinessSetting('tools.imageGenerationModel').catch((error) => {
        console.error('Failed to remove image generation model config:', error);
      });
      void syncMcpServerEnv({}).catch((error) => {
        console.error('Failed to clear image generation MCP env after provider removal:', error);
      });
      return;
    }

    const sanitizedModel = {
      ...imageGenerationModel,
      name: currentProvider.name,
      platform: currentProvider.platform,
      base_url: '',
      api_key: '',
    };

    if (imageGenerationModel.api_key || imageGenerationModel.base_url) {
      setImageGenerationModel(sanitizedModel);
      setClientBusinessSetting('tools.imageGenerationModel', sanitizedModel).catch((error) => {
        console.error('Failed to sanitize image generation model config:', error);
      });
    }

    void syncMcpServerEnv(sanitizedModel).catch((error) => {
      console.error('Failed to sync image generation MCP env after provider change:', error);
    });
  }, [data, imageGenerationModel, syncMcpServerEnv]);

  const handleImageGenerationModelChange = useCallback(
    (value: Partial<ImageGenerationModelSetting>) => {
      setImageGenerationModel((prev) => {
        const newImageGenerationModel = {
          ...prev,
          id: value.id,
          name: value.name,
          platform: value.platform,
          base_url: '',
          api_key: '',
          use_model: value.use_model,
        } as ImageGenerationModelSetting;
        setClientBusinessSetting('tools.imageGenerationModel', newImageGenerationModel).catch((error) => {
          console.error('Failed to update image generation model config:', error);
        });
        // Sync env vars to the built-in MCP server
        void syncMcpServerEnv(newImageGenerationModel).catch((error) => {
          console.error('Failed to sync image generation MCP env:', error);
          mcpMessage.error(error instanceof Error ? error.message : t('settings.mcpSyncError'));
        });
        return newImageGenerationModel;
      });
    },
    [mcpMessage, syncMcpServerEnv, t]
  );

  // Video needs no MCP env sync: unlike the image path (whose env keys predate
  // the media job engine and are kept as an external contract), the job engine
  // reads `tools.videoGenerationModel` from client settings at execution time.
  // Writing the setting is the whole wiring.
  useEffect(() => {
    if (!videoGenerationModel || !data) return;

    const currentProvider = data.find((p) => p.id === videoGenerationModel.id);
    if (!currentProvider) {
      setVideoGenerationModel(undefined);
      removeClientBusinessSetting('tools.videoGenerationModel').catch((error) => {
        console.error('Failed to remove video generation model config:', error);
      });
      return;
    }

    // Secrets live in providers; the setting only carries a reference.
    if (videoGenerationModel.api_key || videoGenerationModel.base_url) {
      const sanitizedModel = {
        ...videoGenerationModel,
        name: currentProvider.name,
        platform: currentProvider.platform,
        base_url: '',
        api_key: '',
      };
      setVideoGenerationModel(sanitizedModel);
      setClientBusinessSetting('tools.videoGenerationModel', sanitizedModel).catch((error) => {
        console.error('Failed to sanitize video generation model config:', error);
      });
    }
  }, [data, videoGenerationModel]);

  const handleCatalogOverridesChange = useCallback((value: string) => {
    setCatalogOverrides(value);
    // Apply immediately so the model dropdowns above reflect the edit without a
    // save-and-reload round trip; errors surface inline instead of at call time.
    const applied = applyCatalogOverridesJson(value);
    setCatalogOverrideErrors(applied.errors);
    setClientBusinessSetting('tools.mediaCatalogOverrides', value).catch((error) => {
      console.error('Failed to persist media catalog overrides:', error);
    });
  }, []);

  const handleVideoGenerationModelChange = useCallback((value: Partial<ImageGenerationModelSetting>) => {
    setVideoGenerationModel((prev) => {
      const next = {
        ...prev,
        id: value.id,
        name: value.name,
        platform: value.platform,
        base_url: '',
        api_key: '',
        use_model: value.use_model,
      } as ImageGenerationModelSetting;
      setClientBusinessSetting('tools.videoGenerationModel', next).catch((error) => {
        console.error('Failed to update video generation model config:', error);
      });
      return next;
    });
  }, []);

  const handleImageGenerationToggle = useCallback(
    async (checked: boolean) => {
      if (!builtinImageGenServer) return;

      setIsUpdatingImageGeneration(true);
      try {
        if (checked) {
          if (!imageGenerationModel?.id || !imageGenerationModel.use_model) {
            mcpMessage.error(t('settings.mcpSyncError'));
            return;
          }
          await syncMcpServerEnv(imageGenerationModel);
        }
        const updatedServer = await mcpService.toggleServer.invoke({ id: builtinImageGenServer.id });
        await saveMcpServers((prevServers) =>
          prevServers.map((server) => (server.id === updatedServer.id ? { ...server, ...updatedServer } : server))
        );

        if (updatedServer.enabled !== checked) {
          mcpMessage.error(checked ? t('settings.mcpSyncError') : t('settings.mcpRemoveError'));
          return;
        }

        setImageGenerationModel((prev) => {
          if (!prev) return prev;
          const next = { ...prev, switch: checked };
          setClientBusinessSetting('tools.imageGenerationModel', next).catch((error) => {
            console.error('Failed to sync image generation switch state:', error);
          });
          return next;
        });
      } catch (error) {
        console.error('Failed to toggle image generation MCP server:', error);
        mcpMessage.error(error instanceof Error ? error.message : t('settings.mcpSyncError'));
      } finally {
        setIsUpdatingImageGeneration(false);
      }
    },
    [builtinImageGenServer, imageGenerationModel, mcpMessage, saveMcpServers, syncMcpServerEnv, t]
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
  const isImageGenerationModelUnavailable = !imageGenerationModelList.length || !imageGenerationModel?.use_model;

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
                  (!builtinImageGenServer.enabled && isImageGenerationModelUnavailable)
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
                {imageGenerationModelList.length > 0 ? (
                  <DreamSelect
                    value={
                      imageGenerationModel?.id && imageGenerationModel?.use_model
                        ? `${imageGenerationModel.id}|${imageGenerationModel.use_model}`
                        : undefined
                    }
                    placeholder={
                      imageModelFallback
                        ? t('settings.mediaModelAutoPlaceholder', { model: imageModelFallback.use_model })
                        : t('settings.selectModel')
                    }
                    onChange={(value) => {
                      const [platformId, modelName] = value.split('|');
                      const platform = imageGenerationModelList.find((p) => p.id === platformId);
                      if (platform) {
                        handleImageGenerationModelChange({
                          ...platform,
                          use_model: modelName,
                        });
                      }
                    }}
                  >
                    {imageGenerationModelList.map(({ models, ...platform }) => (
                      <DreamSelect.OptGroup label={platform.name} key={platform.id}>
                        {models.map((modelName) => (
                          <DreamSelect.Option key={platform.id + modelName} value={platform.id + '|' + modelName}>
                            {modelName}
                          </DreamSelect.Option>
                        ))}
                      </DreamSelect.OptGroup>
                    ))}
                  </DreamSelect>
                ) : (
                  <div className='text-t-secondary flex items-center'>
                    {t('settings.noAvailable')}
                    <button
                      type='button'
                      className='appearance-none border-none bg-transparent p-0 text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] underline underline-offset-2 cursor-pointer'
                      onClick={goToModelSettings}
                    >
                      {t('settings.goToModelSettings')}
                    </button>
                    <Tooltip
                      content={
                        <div>
                          {t('settings.needHelpTooltip')}
                          <a
                            href='https://1one.1oneclaw.com'
                            target='_blank'
                            rel='noopener noreferrer'
                            className='text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] underline ms-4px'
                            onClick={(e) => e.stopPropagation()}
                          >
                            {t('settings.configGuide')}
                          </a>
                        </div>
                      }
                    >
                      <a
                        href='https://1one.1oneclaw.com'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='ms-8px text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] cursor-pointer'
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Help theme='outline' size='14' />
                      </a>
                    </Tooltip>
                  </div>
                )}
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
                {videoGenerationModelList.length > 0 ? (
                  <DreamSelect
                    value={
                      videoGenerationModel?.id && videoGenerationModel?.use_model
                        ? `${videoGenerationModel.id}|${videoGenerationModel.use_model}`
                        : undefined
                    }
                    placeholder={
                      videoModelFallback
                        ? t('settings.mediaModelAutoPlaceholder', { model: videoModelFallback.use_model })
                        : t('settings.selectModel')
                    }
                    onChange={(value) => {
                      const [platformId, modelName] = value.split('|');
                      const platform = videoGenerationModelList.find((p) => p.id === platformId);
                      if (platform) {
                        handleVideoGenerationModelChange({
                          ...platform,
                          use_model: modelName,
                        });
                      }
                    }}
                  >
                    {videoGenerationModelList.map(({ models, ...platform }) => (
                      <DreamSelect.OptGroup label={platform.name} key={platform.id}>
                        {models.map((modelName) => (
                          <DreamSelect.Option key={platform.id + modelName} value={platform.id + '|' + modelName}>
                            {modelName}
                          </DreamSelect.Option>
                        ))}
                      </DreamSelect.OptGroup>
                    ))}
                  </DreamSelect>
                ) : (
                  <div className='text-t-secondary flex items-center'>
                    {t('settings.noAvailable')}
                    <button
                      type='button'
                      className='appearance-none border-none bg-transparent p-0 text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] underline underline-offset-2 cursor-pointer'
                      onClick={goToModelSettings}
                    >
                      {t('settings.goToModelSettings')}
                    </button>
                  </div>
                )}
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
