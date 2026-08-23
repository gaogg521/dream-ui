/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import DreamInlineSearchInput from '@/renderer/components/base/DreamInlineSearchInput';
import type { Assistant, MarketplacePersona } from '@/common/types/agent/assistantTypes';
import { resolveAssistantAvatar } from '@/renderer/utils/model/assistantAvatar';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';
import { ArrowRight, CheckOne, Plus, Robot } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type GuidExpertPickerGridProps = {
  /** Already-installed assistants (mine + official) — shown by default, no search needed. */
  assistants: Assistant[];
  /** Full marketplace catalog (all ~250+ entries, each with its own `installed` flag) —
   * only consulted once the user types a search query, so a match here can surface an
   * expert the user hasn't installed yet. */
  marketplacePersonas: MarketplacePersona[];
  selectedAssistantId?: string | null;
  localeKey: string;
  onSelect: (assistantId: string) => void;
  /** Marketplace-only match (not yet installed) was clicked — install it, then select it. */
  onInstallAndSelect: (assistantId: string) => void;
  onBrowseMore: () => void;
};

type PickerEntry = {
  id: string;
  label: string;
  avatarSrc?: string;
  avatarIsEmoji: boolean;
  installed: boolean;
};

function toEntryFromAssistant(assistant: Assistant, localeKey: string): PickerEntry {
  const avatar = resolveAssistantAvatar(assistant.avatar);
  return {
    id: assistant.id,
    label: resolveAssistantName(assistant, localeKey),
    avatarSrc: avatar.kind === 'image' ? avatar.value : avatar.kind === 'emoji' ? avatar.value : undefined,
    avatarIsEmoji: avatar.kind === 'emoji',
    installed: true,
  };
}

function toEntryFromMarketplace(persona: MarketplacePersona): PickerEntry {
  const avatar = resolveAssistantAvatar(persona.avatar);
  return {
    id: persona.id,
    label: persona.display_name || persona.name,
    avatarSrc: avatar.kind === 'image' ? avatar.value : avatar.kind === 'emoji' ? avatar.value : undefined,
    avatarIsEmoji: avatar.kind === 'emoji',
    installed: persona.installed,
  };
}

/**
 * Compact avatar-grid persona picker for the "+" input menu — the Guid
 * page's persona-selection entry point (the old always-visible pill row
 * was removed in favor of this). Visual language borrowed from
 * `ExpertMarketplaceGrid` but stripped down: no description/chat buttons,
 * just click-to-select (or click-to-install-then-select).
 *
 * Default view (no search) is just the already-installed list — fast, no
 * extra data needed. Searching also matches against the full marketplace
 * catalog, since this tab is literally labeled "专家市场" (expert
 * *marketplace*) — limiting search to only what's already installed would
 * silently contradict that label.
 */
const GuidExpertPickerGrid: React.FC<GuidExpertPickerGridProps> = ({
  assistants,
  marketplacePersonas,
  selectedAssistantId,
  localeKey,
  onSelect,
  onInstallAndSelect,
  onBrowseMore,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const filtered = useMemo<PickerEntry[]>(() => {
    const query = search.trim().toLowerCase();
    if (!query) return assistants.map((assistant) => toEntryFromAssistant(assistant, localeKey));

    const byId = new Map<string, PickerEntry>();
    for (const assistant of assistants) {
      const entry = toEntryFromAssistant(assistant, localeKey);
      if (entry.label.toLowerCase().includes(query)) byId.set(entry.id, entry);
    }
    for (const persona of marketplacePersonas) {
      if (byId.has(persona.id)) continue; // already-installed version takes precedence
      const label = (persona.display_name || persona.name).toLowerCase();
      const description = persona.description?.toLowerCase() ?? '';
      if (label.includes(query) || description.includes(query)) {
        byId.set(persona.id, toEntryFromMarketplace(persona));
      }
    }
    return [...byId.values()];
  }, [assistants, marketplacePersonas, localeKey, search]);

  return (
    <div className='w-320px'>
      <div className='px-6px pt-4px pb-6px' style={{ background: 'var(--color-bg-popup)' }}>
        <DreamInlineSearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('settings.marketplaceSearchPlaceholder', { defaultValue: 'Search experts...' })}
          data-testid='guid-expert-search'
          // See SubmenuSearchList in GuidActionRow for why this matters:
          // without it, IME composition (Chinese/Japanese/Korean input)
          // keystrokes leak into Arco Menu's own keyboard handling and the
          // whole "+" dropdown closes mid-composition.
          inputProps={{ onKeyDown: (event) => event.stopPropagation() }}
        />
      </div>
      <div className='dropdown-search-scroll max-h-320px overflow-y-auto px-6px pb-6px'>
        {filtered.length === 0 ? (
          <div className='px-12px py-10px text-12px text-t-tertiary text-center'>
            {t('settings.marketplaceEmptyState', { defaultValue: 'No experts found.' })}
          </div>
        ) : (
          <div className='grid grid-cols-3 gap-6px'>
            {filtered.map((entry) => {
              const isSelected = entry.id === selectedAssistantId;
              return (
                <button
                  key={entry.id}
                  type='button'
                  data-testid={`guid-expert-pick-${entry.id}`}
                  data-selected={isSelected ? 'true' : 'false'}
                  data-installed={entry.installed ? 'true' : 'false'}
                  className={`flex flex-col items-center gap-4px rounded-10px border-none p-6px text-center transition-colors hover:bg-fill-2 ${isSelected ? 'bg-fill-2' : 'bg-transparent'}`}
                  onClick={() => (entry.installed ? onSelect(entry.id) : onInstallAndSelect(entry.id))}
                >
                  <span className='relative inline-flex h-32px w-32px items-center justify-center overflow-hidden rounded-999px bg-fill-2'>
                    {entry.avatarSrc ? (
                      entry.avatarIsEmoji ? (
                        <span style={{ fontSize: 16 }}>{entry.avatarSrc}</span>
                      ) : (
                        <img src={entry.avatarSrc} alt='' className='h-full w-full object-cover' />
                      )
                    ) : (
                      <Robot theme='outline' size={16} />
                    )}
                    {isSelected && (
                      <span className='absolute -bottom-2px -right-2px inline-flex h-14px w-14px items-center justify-center rounded-999px bg-base'>
                        <CheckOne theme='filled' size={14} fill={iconColors.success} />
                      </span>
                    )}
                    {!entry.installed && (
                      <span
                        className='absolute -bottom-2px -right-2px inline-flex h-14px w-14px items-center justify-center rounded-999px bg-base'
                        title={t('settings.marketplaceInstall', { defaultValue: 'Add to My Assistants' })}
                      >
                        <Plus theme='filled' size={14} fill={iconColors.secondary} />
                      </span>
                    )}
                  </span>
                  <span className='w-full truncate text-12px text-t-primary'>{entry.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div
        className='flex cursor-pointer items-center justify-center gap-4px border-t border-border-2 px-12px py-10px text-12px text-t-secondary hover:text-t-primary'
        onClick={onBrowseMore}
      >
        <span>{t('settings.marketplaceBrowseMore', { defaultValue: 'Summon more experts' })}</span>
        <ArrowRight theme='outline' size={12} fill={iconColors.secondary} />
      </div>
    </div>
  );
};

export default GuidExpertPickerGrid;
