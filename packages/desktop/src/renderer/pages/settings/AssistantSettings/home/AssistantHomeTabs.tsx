/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isInstalledGeneratedCliAssistant } from '@/renderer/utils/model/assistantSelection';
import type { MarketplacePersona } from '@/common/types/agent/assistantTypes';
import type { AssistantListItem } from '../types';
import EnabledAssistantsList from './EnabledAssistantsList';
import ExpertMarketplaceGrid from './ExpertMarketplaceGrid';
import MyAssistantsList from './MyAssistantsList';
import OfficialAssistantsGrid from './OfficialAssistantsGrid';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import TalkToButlerButton from '@/renderer/components/base/TalkToButlerButton';
import { useScanAllAgents } from '@/renderer/hooks/agent/useScanAllAgents';
import { Button, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { DreamSearchInput } from '@/renderer/components/base';
import SettingsPageHeader from '../../components/SettingsPageHeader';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AssistantHomeTabsProps = {
  assistants: AssistantListItem[];
  loading?: boolean;
  assistantOrder: readonly string[];
  localeKey: string;
  onOpenDetail: (assistant: AssistantListItem) => void;
  onOpenSettings: (assistant: AssistantListItem) => void;
  onDuplicate: (assistant: AssistantListItem) => void;
  onDelete: (assistant: AssistantListItem) => void;
  onCreate: () => void;
  onImportPersonas: () => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
  onReorderEnabled: (activeId: string, overId: string) => void | Promise<void>;
  onStartChat: (assistant: AssistantListItem) => void;
  /** Expert marketplace catalog — a browsable, installable persona list
   * entirely separate from `assistants` (see `useMarketplacePersonas`). */
  marketplacePersonas: MarketplacePersona[];
  marketplaceLoading?: boolean;
  onInstallMarketplacePersona: (id: string) => Promise<unknown>;
  onStartMarketplaceChat: (id: string) => void;
  /** Tab to show on mount (e.g. return to Official after editing a builtin). */
  initialTab?: HomeTab;
  /** Notified whenever the active tab changes, so the parent can remember it. */
  onTabChange?: (tab: HomeTab) => void;
};

/** Upstream's `enabled`/`mine`/`official` plus the fork-only `marketplace` tab. */
type HomeTab = 'enabled' | 'mine' | 'official' | 'marketplace';

const AssistantHomeTabs: React.FC<AssistantHomeTabsProps> = ({
  assistants,
  loading = false,
  assistantOrder,
  localeKey,
  onOpenDetail,
  onOpenSettings,
  onDuplicate,
  onDelete,
  onCreate,
  onImportPersonas,
  onToggleEnabled,
  onReorderEnabled,
  onStartChat,
  marketplacePersonas,
  marketplaceLoading = false,
  onInstallMarketplacePersona,
  onStartMarketplaceChat,
  initialTab = 'enabled',
  onTabChange,
}) => {
  const { t, i18n } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [tab, setTab] = useState<HomeTab>(initialTab);
  const { scanAll, scanning } = useScanAllAgents();
  const [searchQuery, setSearchQuery] = useState('');

  const selectTab = (next: HomeTab) => {
    setTab(next);
    onTabChange?.(next);
  };

  // Only show auto-generated CLI assistants whose backing agent is installed
  // and online on this machine. Catalog rows exist for every known CLI;
  // surfacing un-runnable ones is noise. Installing a CLI and scanning
  // agents flips status to online and the assistant reappears.
  const visibleAssistants = useMemo(() => assistants.filter(isInstalledGeneratedCliAssistant), [assistants]);

  const counts = useMemo(() => {
    let enabled = 0;
    let mine = 0;
    let official = 0;
    // Fork counts over `visibleAssistants`, not `assistants`: auto-generated CLI
    // rows whose agent isn't installed are filtered out of the lists, so
    // counting them here would show tab badges that don't match what's rendered.
    for (const assistant of visibleAssistants) {
      if (assistant.enabled !== false) enabled += 1;
      if (assistant.source === 'builtin') official += 1;
      else mine += 1;
    }
    return { enabled, mine, official };
  }, [visibleAssistants]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredAssistants = useMemo(() => {
    if (!normalizedSearchQuery) return visibleAssistants;
    return visibleAssistants.filter((assistant) => {
      const searchableText = [
        assistant.name,
        assistant.name_i18n?.[i18n.language],
        assistant.description,
        assistant.description_i18n?.[i18n.language],
        assistant.agent?.type,
        assistant.agent?.acp_backend,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchableText.includes(normalizedSearchQuery);
    });
  }, [visibleAssistants, i18n.language, normalizedSearchQuery]);

  return (
    <div data-testid='assistant-home-shell' className='flex h-full min-h-0 flex-col overflow-hidden bg-transparent'>
      <div
        className={`border-b border-border-2 bg-bg-0 ${isMobile ? 'px-16px pt-14px' : 'px-12px pt-24px md:px-40px md:pt-32px'}`}
      >
        <div className='mx-auto w-full max-w-800px'>
          <SettingsPageHeader
            data-testid='assistants-header'
            title={t('settings.assistants', { defaultValue: 'Assistants' })}
            description={t('settings.assistantHomeLeadShort', {
              defaultValue:
                'Ready-to-work AI experts, preloaded with skills. Enable one and it shows up wherever you pick an assistant.',
            })}
            actions={
              <>
                {!isMobile && tab !== 'marketplace' && (
                  <DreamSearchInput
                    className='shrink-0 w-[200px] hidden md:flex'
                    data-testid='input-search-assistants'
                    placeholder={t('settings.searchAssistants', {
                      defaultValue: 'Search assistants by name or description',
                    })}
                    value={searchQuery}
                    onChange={setSearchQuery}
                  />
                )}
                <Button
                  type='outline'
                  size='small'
                  className='rd-100px shrink-0'
                  loading={scanning}
                  icon={<Refresh theme='outline' size='14' />}
                  onClick={() => void scanAll()}
                  data-testid='btn-scan-all-agents'
                >
                  {t('settings.agentManagement.scanAll', { defaultValue: 'Scan All' })}
                </Button>
                <Button
                  type='outline'
                  size='small'
                  className='rd-100px shrink-0'
                  onClick={onImportPersonas}
                  data-testid='btn-import-personas'
                >
                  {t('settings.personaImportButton')}
                </Button>
                <TalkToButlerButton
                  className='shrink-0'
                  label={t('settings.createAssistant', { defaultValue: 'Create Assistant' })}
                  chatLabel={t('settings.talkToButler.createViaChat', { defaultValue: 'Create via chat' })}
                  onManual={onCreate}
                  manualLabel={t('settings.talkToButler.createManually', { defaultValue: 'Create manually' })}
                  prompt={t('settings.talkToButler.prompt.createAssistant', {
                    defaultValue: 'Help me create a new assistant and walk me through setting it up.',
                  })}
                  data-testid='btn-create-assistant'
                />
              </>
            }
            tabs={[
              {
                key: 'enabled',
                label: t('settings.assistantSectionEnabled', { defaultValue: 'Enabled' }),
                count: counts.enabled,
              },
              {
                key: 'mine',
                label: t('settings.assistantTabMine', { defaultValue: 'My Assistants' }),
                count: counts.mine,
              },
              {
                key: 'official',
                label: t('settings.assistantTabOfficial', { defaultValue: 'Official' }),
                count: counts.official,
              },
              {
                key: 'marketplace',
                label: t('settings.assistantTabMarketplace'),
                count: marketplacePersonas.length,
              },
            ]}
            activeTab={tab}
            onTabChange={(key) => selectTab(key as HomeTab)}
          />
        </div>
      </div>

      <div
        data-testid='assistant-home-body'
        className={`min-h-0 flex-1 overflow-auto ${isMobile ? 'px-16px pb-14px pt-14px' : 'px-12px pb-24px pt-18px md:px-40px'}`}
      >
        <div className='mx-auto w-full max-w-800px'>
          {loading ? (
            <div
              className='flex min-h-200px flex-col items-center justify-center gap-10px py-40px text-center'
              data-testid='assistant-home-loading'
            >
              <Spin />
              <span className='text-13px text-t-secondary'>
                {t('settings.assistantListLoading', { defaultValue: '正在加载助手…' })}
              </span>
            </div>
          ) : tab === 'enabled' ? (
            <EnabledAssistantsList
              assistants={filteredAssistants}
              assistantOrder={assistantOrder}
              localeKey={localeKey}
              searchActive={Boolean(normalizedSearchQuery)}
              onOpenDetail={onOpenDetail}
              onToggleEnabled={onToggleEnabled}
              onReorder={onReorderEnabled}
              onStartChat={onStartChat}
            />
          ) : tab === 'mine' ? (
            <MyAssistantsList
              assistants={filteredAssistants}
              localeKey={localeKey}
              onOpenDetail={onOpenDetail}
              onDelete={onDelete}
              onToggleEnabled={onToggleEnabled}
              onStartChat={onStartChat}
              onGoOfficial={() => selectTab('official')}
              searchActive={Boolean(normalizedSearchQuery)}
            />
          ) : tab === 'official' ? (
            <OfficialAssistantsGrid
              assistants={filteredAssistants}
              localeKey={localeKey}
              onOpenSettings={onOpenSettings}
              onDuplicate={onDuplicate}
              onToggleEnabled={onToggleEnabled}
              onStartChat={onStartChat}
              searchActive={Boolean(normalizedSearchQuery)}
            />
          ) : (
            <ExpertMarketplaceGrid
              personas={marketplacePersonas}
              loading={marketplaceLoading}
              onInstall={onInstallMarketplacePersona}
              onStartChat={onStartMarketplaceChat}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AssistantHomeTabs;
