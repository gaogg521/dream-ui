/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MarketplacePersona } from '@/common/types/agent/assistantTypes';
import { DreamSearchInput } from '@/renderer/components/base';
import { Avatar, Button, Message } from '@arco-design/web-react';
import { Check, Robot } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isEmoji, resolveAvatarImageSrc } from '../assistantUtils';

type ExpertMarketplaceGridProps = {
  personas: MarketplacePersona[];
  loading?: boolean;
  onInstall: (id: string) => Promise<unknown>;
  onStartChat: (id: string) => void;
};

/**
 * Browsable catalog of installable expert personas. Deliberately not the
 * assistant list — nothing here is a real owned assistant until the user
 * clicks "Add to my assistants" (`onInstall`), which materializes exactly
 * one real assistant on demand. `persona.category` is surfaced as a plain
 * chip for browsing context; category *filter* pills are a natural
 * follow-up, not built in this pass.
 */
const ExpertMarketplaceGrid: React.FC<ExpertMarketplaceGridProps> = ({ personas, loading, onInstall, onStartChat }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [installingId, setInstallingId] = useState<string | null>(null);

  const filteredPersonas = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return personas;
    return personas.filter((persona) => {
      const haystack = `${persona.display_name ?? ''} ${persona.name} ${persona.description ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [personas, search]);

  const handleInstall = async (persona: MarketplacePersona) => {
    if (installingId) return;
    setInstallingId(persona.id);
    try {
      await onInstall(persona.id);
    } catch (error) {
      console.error('Failed to install marketplace persona:', error);
      Message.error(t('settings.marketplaceInstallFailed'));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div data-testid='expert-marketplace-pane'>
      <div className='mb-14px flex items-center justify-between gap-12px'>
        <DreamSearchInput
          className='w-full max-w-320px'
          data-testid='input-search-marketplace'
          placeholder={t('settings.marketplaceSearchPlaceholder')}
          value={search}
          onChange={setSearch}
        />
      </div>

      <div className='grid grid-cols-1 gap-14px sm:grid-cols-2 lg:grid-cols-3'>
        {!loading && filteredPersonas.length === 0 ? (
          <div className='col-span-full rounded-14px border border-dashed border-border-2 bg-fill-1/40 px-20px py-28px text-center text-13px text-t-secondary'>
            {t('settings.marketplaceEmptyState')}
          </div>
        ) : null}
        {filteredPersonas.map((persona) => {
          const hasEmojiAvatar = Boolean(persona.avatar && isEmoji(persona.avatar));
          const avatarImage = resolveAvatarImageSrc(persona.avatar);
          const nickname = persona.role_name && persona.role_name !== persona.display_name ? persona.role_name : null;
          return (
            <div
              key={persona.id}
              data-testid={`marketplace-card-${persona.id}`}
              className='group flex flex-col rounded-14px border border-solid border-transparent bg-base p-16px transition-all duration-180 hover:border-border-2 hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]'
            >
              <div className='flex items-start justify-between gap-8px'>
                <span className='relative inline-flex shrink-0'>
                  <Avatar
                    className='border-none'
                    shape='square'
                    size={42}
                    style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}
                  >
                    {avatarImage ? (
                      <img
                        src={avatarImage}
                        alt=''
                        className='h-full w-full rounded-inherit object-cover'
                        style={{ display: 'block' }}
                      />
                    ) : hasEmojiAvatar ? (
                      <span style={{ fontSize: 21 }}>{persona.avatar}</span>
                    ) : (
                      <Robot theme='outline' size={21} />
                    )}
                  </Avatar>
                  {persona.installed ? (
                    <span
                      className='absolute -bottom-2px -right-2px inline-flex h-14px w-14px items-center justify-center rounded-999px bg-base'
                      title={t('settings.marketplaceInstalled')}
                    >
                      <Check theme='filled' size={14} fill={iconColors.success} />
                    </span>
                  ) : null}
                </span>
                {persona.category ? (
                  <span className='mt-2px max-w-120px shrink-0 truncate rounded-6px bg-fill-2 px-8px py-2px text-11px text-t-secondary'>
                    {persona.category}
                  </span>
                ) : null}
              </div>
              <div className='mt-12px flex items-baseline gap-6px'>
                <span className='truncate text-14px font-600 text-t-primary'>
                  {persona.display_name || persona.name}
                </span>
                {nickname ? <span className='shrink-0 truncate text-12px text-t-secondary'>· {nickname}</span> : null}
              </div>
              <div className='mt-6px line-clamp-2 text-12px leading-[1.5] text-t-secondary'>
                {persona.description || ''}
              </div>
              <div className='mt-14px flex items-center justify-end gap-8px'>
                {persona.installed ? (
                  <Button
                    type='text'
                    size='small'
                    data-testid={`btn-marketplace-chat-${persona.id}`}
                    className='!inline-flex !h-28px !items-center !justify-center !rounded-9px !bg-fill-2 !px-12px !leading-none !text-t-secondary hover:!bg-primary-6 hover:!text-white'
                    onClick={() => onStartChat(persona.id)}
                  >
                    {t('settings.assistantGoChat', { defaultValue: 'Chat' })}
                  </Button>
                ) : (
                  <Button
                    type='text'
                    size='small'
                    loading={installingId === persona.id}
                    disabled={installingId !== null && installingId !== persona.id}
                    data-testid={`btn-marketplace-install-${persona.id}`}
                    className='!inline-flex !h-28px !items-center !justify-center !rounded-9px !bg-fill-2 !px-12px !leading-none !text-t-secondary hover:!bg-primary-6 hover:!text-white'
                    aria-label={t('settings.marketplaceInstall', { defaultValue: 'Add to My Assistants' })}
                    onClick={() => void handleInstall(persona)}
                  >
                    {t('common.add')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ExpertMarketplaceGrid;
