/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { claudeBridge, codexBridge } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import { CLAUDE_BRIDGE_STATUS_SWR_KEY } from '@/renderer/hooks/agent/useClaudeBridgeStatus';
import { CODEX_BRIDGE_STATUS_SWR_KEY } from '@/renderer/hooks/agent/useCodexBridgeStatus';
import { Message, Modal } from '@arco-design/web-react';
import { type TFunction } from 'i18next';
import { useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { mutate } from 'swr';
import { type BridgeBackend, type BridgeCandidate, listBridgeCandidates } from './bridgeCandidates';

/**
 * `bridged`: a model was just set up, so a model picked for the agent before no
 * longer applies. `stop`: do not send; the draft stays where it is.
 */
export type BridgePromptOutcome = 'unchanged' | 'bridged' | 'stop';

const MAX_ATTEMPTS = 5;
const DISMISSED_KEY = 'agent.bridgePromptDismissed';

const BRIDGES = {
  claude: { name: 'Claude Code', api: claudeBridge, swrKey: CLAUDE_BRIDGE_STATUS_SWR_KEY },
  codex: { name: 'Codex', api: codexBridge, swrKey: CODEX_BRIDGE_STATUS_SWR_KEY },
} as const;

const isReachable = async ({ provider, model }: BridgeCandidate): Promise<boolean> => {
  try {
    const result = await ipcBridge.acpConversation.checkProviderHealth.invoke({ provider_id: provider.id, model });
    return result.status === 'healthy';
  } catch (error) {
    console.warn('[useBridgeModelPrompt] Health check failed:', error);
    return false;
  }
};

/**
 * Before the first message to Claude Code or Codex, offer to point its bridge at
 * one of the user's own models. Asked only while the bridge has never been set
 * up, and never again once the user chooses to use their own account.
 */
export const useBridgeModelPrompt = ({ navigate, t }: { navigate: NavigateFunction; t: TFunction }) =>
  useCallback(
    async (backend: string, preferred?: { providerId?: string; model?: string }): Promise<BridgePromptOutcome> => {
      if (backend !== 'claude' && backend !== 'codex') return 'unchanged';
      const key: BridgeBackend = backend;
      const { name, api, swrKey } = BRIDGES[key];
      if (configService.get(DISMISSED_KEY)?.[key]) return 'unchanged';

      let candidates: BridgeCandidate[];
      try {
        const config = await api.getConfig.invoke();
        // A saved provider with the switch off is a decision the user made.
        if (config.enabled || config.provider_id) return 'unchanged';
        candidates = listBridgeCandidates(key, (await ipcBridge.mode.listProviders.invoke()) ?? [], preferred);
      } catch (error) {
        // The offer is a convenience; it must never stand in the way of sending.
        console.warn('[useBridgeModelPrompt] Could not read the bridge setup:', error);
        return 'unchanged';
      }

      return new Promise<BridgePromptOutcome>((resolve) => {
        const useOwnAccount = () => {
          void configService
            .set(DISMISSED_KEY, { ...configService.get(DISMISSED_KEY), [key]: true })
            .catch((error: unknown) => console.warn('[useBridgeModelPrompt] Could not save the choice:', error));
          resolve('unchanged');
        };

        const enable = async () => {
          for (const candidate of candidates.slice(0, MAX_ATTEMPTS)) {
            if (!(await isReachable(candidate))) continue;
            try {
              const saved = await api.setConfig.invoke({
                enabled: true,
                provider_id: candidate.provider.id,
                model: candidate.model,
              });
              void mutate(swrKey, saved, false);
            } catch (error) {
              console.error('[useBridgeModelPrompt] Failed to save the bridge:', error);
              Message.error(t('agent.bridgePrompt.saveFailed'));
              resolve('stop');
              return;
            }
            Message.success(
              t('agent.bridgePrompt.done', {
                agent: name,
                provider: candidate.provider.name,
                model: candidate.model,
              })
            );
            resolve('bridged');
            return;
          }
          Message.error(t('agent.bridgePrompt.noneReachable', { agent: name }));
          resolve('stop');
        };

        const [first] = candidates;
        const missingKey = key === 'claude' ? 'agent.bridgePrompt.noModelClaude' : 'agent.bridgePrompt.noModelCodex';
        Modal.confirm({
          title: t('agent.bridgePrompt.title', { agent: name }),
          content: first
            ? t('agent.bridgePrompt.content', { agent: name, provider: first.provider.name, model: first.model })
            : t(missingKey),
          okText: first ? t('agent.bridgePrompt.agree') : t('agent.bridgePrompt.addModel'),
          cancelText: t('agent.bridgePrompt.useOwnAccount'),
          // Both buttons are real choices, so there is no way to merely close it.
          closable: false,
          maskClosable: false,
          escToExit: false,
          onOk: first
            ? enable
            : () => {
                resolve('stop');
                void navigate('/settings/model');
              },
          onCancel: useOwnAccount,
        });
      });
    },
    [navigate, t]
  );
