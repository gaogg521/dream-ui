/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { refreshManagedAgentCatalogAndAssistants } from '@/renderer/hooks/agent/useManagedAgents';
import { isDeprecatedRuntimeAgentType } from '@/renderer/utils/model/agentTypeSupportPolicy';
import { fetchManagedAgents } from '@/renderer/utils/model/agentTypes';
import { Message } from '@arco-design/web-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type UseScanAllAgentsResult = {
  scanAll: () => Promise<void>;
  scanning: boolean;
};

/**
 * Probes every official managed agent (PATH + ACP handshake) and refreshes
 * assistant caches so newly detected CLIs appear under My Assistants.
 */
export function useScanAllAgents(): UseScanAllAgentsResult {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);

  const scanAll = useCallback(async () => {
    setScanning(true);
    try {
      const agents = await fetchManagedAgents();
      const targets = agents.filter(
        (agent) => agent.agent_source !== 'custom' && !isDeprecatedRuntimeAgentType(agent.agent_type)
      );

      let online = 0;
      for (const agent of targets) {
        try {
          const row = await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agent.id });
          if (row.status === 'online') {
            online += 1;
          }
        } catch {
          // One failed probe must not abort the batch.
        }
      }

      await refreshManagedAgentCatalogAndAssistants();
      Message.success(
        t('settings.agentManagement.scanAllDone', {
          online,
          total: targets.length,
          defaultValue: `Scan complete: ${online}/${targets.length} agents online.`,
        })
      );
    } catch {
      Message.error(
        t('settings.agentManagement.scanAllFailed', {
          defaultValue: 'Agent scan failed.',
        })
      );
    } finally {
      setScanning(false);
    }
  }, [t]);

  return { scanAll, scanning };
}
