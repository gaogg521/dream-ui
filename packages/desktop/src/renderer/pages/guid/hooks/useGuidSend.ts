/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { type ChatFileRef, chatFileRefPath } from '@/common/types/chatFile';
import { baseName, splitReferenceInputs } from '@/common/media/referenceInputs';
import type { IMcpServer, TProviderWithModel } from '@/common/config/storage';
import { toSessionMcpServer, withBuiltinMediaMcp } from '@/renderer/hooks/mcp/catalog';
import { emitter } from '@/renderer/utils/emitter';
import { updateWorkspaceTime } from '@/renderer/utils/workspace/workspaceHistory';
import { Message } from '@arco-design/web-react';
import { useCallback, useRef } from 'react';
import { type TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';
import { mutate as swrMutate } from 'swr';
import { getConversationCreateErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import type { AcpModelInfo } from '../types';

/** Just the slice of `useMediaComposer` the welcome page needs. */
export type GuidMediaComposer = {
  mode: 'off' | 'image' | 'video';
  needsModel: boolean;
  changeMode: (mode: 'off' | 'image' | 'video') => void;
  submit: (
    prompt: string,
    workspaceDir?: string,
    inputUris?: string[],
    conversationIdOverride?: string
  ) => Promise<{ started: true } | { started: false; error?: string }>;
};

export type GuidSendDeps = {
  media?: GuidMediaComposer;
  // Input state
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  files: ChatFileRef[];
  setFiles: React.Dispatch<React.SetStateAction<ChatFileRef[]>>;
  dir: string;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;

  // Assistant state
  selectedAssistantId: string | null;
  selectedAssistantBackend: string;
  selectedBackendAvailable: boolean;
  /** agent_id the next conversation runs under — may differ from the
   * selected assistant's own default (see the Guid page backend switcher). */
  selectedBackendAgentId: string | null;
  selectedMode: string;
  selectedAcpModel: string | null;
  selectedThoughtLevelValue?: string;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  current_model: TProviderWithModel | undefined;

  guidDisabledBuiltinSkills: string[] | undefined;
  guidEnabledSkills: string[] | undefined;
  assistantDefaultSkillIds?: string[];
  assistantDefaultDisabledBuiltinSkillIds?: string[];
  availableMcpServers: IMcpServer[];
  selectedMcpServerIds: string[] | undefined;
  assistantDefaultMcpIds?: string[];
  isGoogleAuth: boolean;

  // Mention state reset
  setMentionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionQuery: React.Dispatch<React.SetStateAction<string | null>>;
  setMentionSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionActiveIndex: React.Dispatch<React.SetStateAction<number>>;

  // Navigation
  navigate: NavigateFunction;
  t: TFunction;
  localeKey: string;
};

export type GuidSendResult = {
  handleSend: () => Promise<void>;
  sendMessageHandler: () => void;
  isButtonDisabled: boolean;
};

/**
 * Hook that manages the send logic for ACP and Dream CLI conversations.
 */
export const useGuidSend = (deps: GuidSendDeps): GuidSendResult => {
  const {
    media,
    input,
    setInput,
    files,
    setFiles,
    dir,
    setDir,
    setLoading,
    loading,
    selectedAssistantId,
    selectedAssistantBackend,
    selectedBackendAvailable,
    selectedBackendAgentId,
    selectedMode,
    selectedAcpModel,
    selectedThoughtLevelValue,
    currentAcpCachedModelInfo,
    current_model,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    assistantDefaultSkillIds,
    assistantDefaultDisabledBuiltinSkillIds,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultMcpIds,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    navigate,
    t,
    localeKey,
  } = deps;
  const sendingRef = useRef(false);

  const handleSend = useCallback(async () => {
    if (!selectedAssistantId) {
      return;
    }
    if (!selectedBackendAvailable) {
      Message.warning(t('conversation.agentError.codes.USER_AGENT_NOT_INSTALLED.title'));
      return;
    }

    const isCustomWorkspace = !!dir;
    const finalWorkspace = dir || '';

    // Media generation short-circuits the assistant, exactly as it does inside a
    // conversation. The conversation is still created first: a job belongs to a
    // conversation, and starting one here without it would attach the result to
    // a workspace with nowhere to show it.
    if (media && media.mode !== 'off') {
      if (media.needsModel) {
        Message.warning(t('conversation.mediaModeNoModel'));
        return;
      }
      if (!current_model) {
        Message.warning(t('conversation.noModelConfigured'));
        return;
      }
      // `type` (or an assistant) is mandatory. dream is the right shell for a
      // generation-only conversation: it is the one type that takes a top-level
      // model, and the send box there carries the media mode the user is
      // already in, so the follow-up ("another take", "now animate it") works
      // without switching anything.
      const conversation = await ipcBridge.conversation.create.invoke({
        type: 'aionrs',
        name: input,
        model: current_model,
        extra: { workspace: finalWorkspace, custom_workspace: isCustomWorkspace },
      });
      if (!conversation?.id) {
        Message.error(t('conversation.createFailed'));
        return;
      }
      if (isCustomWorkspace) updateWorkspaceTime(finalWorkspace);
      emitter.emit('chat.history.refresh');

      const { images, rejected } = splitReferenceInputs(files.map(chatFileRefPath));
      if (rejected.length) {
        Message.warning(t('conversation.mediaModeNonImageIgnored', { files: rejected.map(baseName).join('、') }));
      }
      // Use the workspace the backend actually assigned, not the (possibly
      // empty) one the user picked: with no project selected `finalWorkspace`
      // is '' and the job would fall back to the app's own directory, putting
      // the result somewhere no one would look for it.
      const jobWorkspace = conversation.extra?.workspace || finalWorkspace || undefined;
      const started = await media.submit(input, jobWorkspace, images, conversation.id);
      if (started.started === false) {
        Message.error(t('conversation.mediaModeStartFailed', { reason: started.error ?? '' }));
      }
      // Leave the mode on: the next thing a user does after one image is
      // usually another one, and the conversation's own send box picks the
      // mode up from its own state anyway.
      await navigate(`/conversation/${conversation.id}`);
      return;
    }

    const assistantConversationId = selectedAssistantId;
    const assistantBackend = selectedAssistantBackend;
    const enabled_skills_to_send = guidEnabledSkills ?? assistantDefaultSkillIds;
    const excludeBuiltinSkills = guidDisabledBuiltinSkills ?? assistantDefaultDisabledBuiltinSkillIds;
    const selectedAllMcpServerIds = selectedMcpServerIds ?? [];
    const selectedMcpServerIdSet = new Set(selectedAllMcpServerIds);
    const selectedUserMcpServerIds = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin !== true)
      .map((server) => server.id);
    const selectedAllSessionMcpServers = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id))
      .map((server) => toSessionMcpServer(server));
    const selectedSessionMcpServers = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin === true)
      .map((server) => toSessionMcpServer(server));
    const defaultSelectedMcpServerIds = assistantDefaultMcpIds;
    const defaultSelectedUserMcpServerIds = availableMcpServers
      .filter((server) => (defaultSelectedMcpServerIds ?? []).includes(server.id) && server.builtin !== true)
      .map((server) => server.id);
    const assistantOverrideMcpIds =
      selectedMcpServerIds !== undefined ? selectedAllMcpServerIds : defaultSelectedMcpServerIds;
    const selectedUserMcpServerIdsToSend =
      selectedMcpServerIds !== undefined ? selectedUserMcpServerIds : defaultSelectedUserMcpServerIds;
    // The media MCP is appended on both branches: it is a built-in, and both
    // agent factories skip built-ins unless they arrive in this snapshot. See
    // `withBuiltinMediaMcp` for why it does not wait to be ticked per assistant.
    const selectedSessionMcpServersToSend = withBuiltinMediaMcp(
      selectedMcpServerIds !== undefined
        ? selectedAllSessionMcpServers
        : availableMcpServers
            .filter((server) => (defaultSelectedMcpServerIds ?? []).includes(server.id))
            .map((server) => toSessionMcpServer(server)),
      availableMcpServers
    );

    // `current_model` is the dream provider selection and means nothing to a
    // CLI agent, which owns its own model list. Used as a blanket fallback it
    // leaked into the FIRST turn of every CLI conversation: before the agent's
    // catalog has been probed the two preceding options are empty, so a brand
    // new Antigravity conversation started with e.g. `gemini-3.1-pro-preview`
    // — a provider model agy has never heard of — and the turn failed with
    // USER_LLM_PROVIDER_MODEL_NOT_FOUND. Once the catalog lands the second
    // option wins, which is why it only ever reproduced on first use.
    //
    // Omitting it lets the agent start on its own default, which is what a user
    // who has not picked a model means. The cron dialog already gates the same
    // value this way (`resolvedBackend !== 'dream' → undefined`).
    const assistantOverrideModel =
      selectedAcpModel ||
      currentAcpCachedModelInfo?.current_model_id ||
      (assistantBackend === 'aionrs' ? current_model?.use_model : undefined) ||
      undefined;
    const assistantOverrides = {
      model: assistantOverrideModel,
      permission: selectedMode || undefined,
      thought_level: selectedThoughtLevelValue || undefined,
      skill_ids: enabled_skills_to_send,
      disabled_builtin_skill_ids: excludeBuiltinSkills,
      mcp_ids: assistantOverrideMcpIds,
      // Lets a persona (e.g. an imported one) run under any installed
      // backend rather than being locked to its own default agent_id.
      agent_id: selectedBackendAgentId || undefined,
    };

    if (assistantBackend === 'aionrs') {
      if (!current_model) {
        Message.warning(t('conversation.noModelConfigured'));
        return;
      }
      try {
        const conversation = await ipcBridge.conversation.create.invoke({
          name: input,
          model: current_model,
          assistant: {
            id: assistantConversationId,
            locale: localeKey,
            conversation_overrides: assistantOverrides,
          },
          extra: {
            default_files: files.map(chatFileRefPath),
            workspace: finalWorkspace,
            custom_workspace: isCustomWorkspace,
            selected_mcp_server_ids: selectedUserMcpServerIdsToSend,
            selected_session_mcp_servers: selectedSessionMcpServersToSend,
          },
        });

        if (!conversation || !conversation.id) {
          Message.error(t('conversation.createFailed'));
          return;
        }

        if (isCustomWorkspace) {
          updateWorkspaceTime(finalWorkspace);
        }

        if (assistantConversationId) {
          await Promise.all([
            swrMutate(`guid.assistant.detail.${assistantConversationId}.${localeKey}`),
            swrMutate('assistants.list'),
          ]);
        }

        emitter.emit('chat.history.refresh');

        const initialMessage = {
          input,
          files: files.length > 0 ? files : undefined,
        };
        sessionStorage.setItem(`aionrs_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

        await navigate(`/conversation/${conversation.id}`);
      } catch (error: unknown) {
        console.error('Failed to create Aion CLI conversation:', error);
        throw error;
      }
      return;
    }

    try {
      const conversation = await ipcBridge.conversation.create.invoke({
        name: input,
        assistant: {
          id: assistantConversationId,
          locale: localeKey,
          conversation_overrides: assistantOverrides,
        },
        extra: {
          workspace: finalWorkspace,
          custom_workspace: isCustomWorkspace,
          default_files: files.map(chatFileRefPath),
          selected_mcp_server_ids: selectedUserMcpServerIdsToSend,
          selected_session_mcp_servers:
            selectedMcpServerIds !== undefined ? selectedSessionMcpServers : selectedSessionMcpServersToSend,
        },
      });
      if (!conversation || !conversation.id) {
        console.error('Failed to create ACP conversation - conversation object is null or missing id');
        return;
      }

      if (isCustomWorkspace) {
        updateWorkspaceTime(finalWorkspace);
      }

      if (assistantConversationId) {
        await Promise.all([
          swrMutate(`guid.assistant.detail.${assistantConversationId}.${localeKey}`),
          swrMutate('assistants.list'),
        ]);
      }

      emitter.emit('chat.history.refresh');

      const initialMessage = {
        input,
        files: files.length > 0 ? files : undefined,
      };
      sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

      await navigate(`/conversation/${conversation.id}`);
    } catch (error: unknown) {
      console.error('Failed to create ACP conversation:', error);
      throw error;
    }
  }, [
    // `media` carries the live mode; without it here the callback keeps the
    // first render's composer and every send looks like plain chat.
    media,
    input,
    files,
    dir,
    selectedAssistantId,
    selectedAssistantBackend,
    selectedBackendAvailable,
    selectedBackendAgentId,
    selectedMode,
    selectedAcpModel,
    selectedThoughtLevelValue,
    currentAcpCachedModelInfo,
    current_model,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    assistantDefaultSkillIds,
    assistantDefaultDisabledBuiltinSkillIds,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultMcpIds,
    navigate,
    t,
    localeKey,
  ]);

  const sendMessageHandler = useCallback(() => {
    if (loading || sendingRef.current) return;
    sendingRef.current = true;
    setLoading(true);
    handleSend()
      .then(() => {
        setInput('');
        setMentionOpen(false);
        setMentionQuery(null);
        setMentionSelectorOpen(false);
        setMentionActiveIndex(0);
        setFiles([]);
        setDir('');
      })
      .catch((error) => {
        console.error('Failed to send message:', error);
        Message.error(getConversationCreateErrorMessage(error, t));
      })
      .finally(() => {
        sendingRef.current = false;
        setLoading(false);
      });
  }, [
    loading,
    handleSend,
    setLoading,
    setInput,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    setFiles,
    setDir,
    t,
  ]);

  // Calculate button disabled state
  const isButtonDisabled =
    loading || (!input.trim() && files.length === 0) || !selectedAssistantId || !selectedBackendAvailable;

  return {
    handleSend,
    sendMessageHandler,
    isButtonDisabled,
  };
};
