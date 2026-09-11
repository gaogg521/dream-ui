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
 * The catalog stores one category string per persona, with no locale fields,
 * so those strings arrive Chinese whatever language the UI is in. Mapping the
 * literal to an i18n key translates them without a schema change on both
 * sides of the IPC boundary.
 *
 * A lookup with a fallback rather than an exhaustive union on purpose: this
 * grid is built so a new category in the seed data shows up without a code
 * change, and that has to survive translation. An unknown category renders
 * its raw string, exactly as it did before.
 */
const CATEGORY_I18N_KEYS: Record<string, string> = {
  营销增长: 'marketingGrowth',
  技术工程: 'engineering',
  内容创作: 'contentCreation',
  金融投资: 'finance',
  游戏空间: 'gaming',
  项目质量: 'projectQuality',
  腾讯专区: 'tencentZone',
  数据智能: 'dataIntelligence',
  产品设计: 'productDesign',
  法务安全: 'legalSecurity',
  销售商务: 'sales',
  行业顾问: 'industryAdvisory',
  运营人力: 'operationsHr',
};

const categoryPillClass = (active: boolean) =>
  `inline-flex cursor-pointer select-none items-center rounded-999px border border-solid px-12px py-6px text-13px leading-none transition-colors ${
    active
      ? 'border-transparent bg-primary-light-1 font-600 text-primary'
      : 'border-border-2 bg-fill-1 text-t-secondary hover:bg-fill-2 hover:text-t-primary'
  }`;

/**
 * Browsable catalog of installable expert personas. Deliberately not the
 * assistant list — nothing here is a real owned assistant until the user
 * clicks "Add to my assistants" (`onInstall`), which materializes exactly
 * one real assistant on demand.
 *
 * Filtering is category pills + search, combined (a pill narrows, search
 * narrows further). The pills are built from `persona.category` counts in
 * the catalog itself, so a new category in the seed data appears here
 * without a code change — the persona corpus is repackaged far more often
 * than this UI.
 */
const ExpertMarketplaceGrid: React.FC<ExpertMarketplaceGridProps> = ({ personas, loading, onInstall, onStartChat }) => {
  const { t } = useTranslation();
  const translateCategory = (category: string) => {
    const key = CATEGORY_I18N_KEYS[category];
    return key ? t(`settings.marketplaceCategory.${key}`, { defaultValue: category }) : category;
  };
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  /** Categories ordered by headcount (ties alphabetical), each with its count. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const persona of personas) {
      const category = persona.category?.trim();
      if (!category) continue;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [personas]);

  const filteredPersonas = useMemo(() => {
    const query = search.trim().toLowerCase();
    return personas.filter((persona) => {
      if (activeCategory && persona.category?.trim() !== activeCategory) return false;
      if (!query) return true;
      const haystack = `${persona.display_name ?? ''} ${persona.name} ${persona.description ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [personas, search, activeCategory]);

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

      {categories.length > 0 ? (
        <div className='mb-14px flex flex-wrap gap-8px' data-testid='marketplace-category-pills'>
          <div
            role='button'
            tabIndex={0}
            data-testid='pill-marketplace-category-all'
            className={categoryPillClass(!activeCategory)}
            onClick={() => setActiveCategory(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActiveCategory(null);
              }
            }}
          >
            {t('settings.marketplaceAllCategories')}
            <span className='ml-6px text-12px opacity-60'>{personas.length}</span>
          </div>
          {categories.map(([category, count]) => (
            <div
              key={category}
              role='button'
              tabIndex={0}
              data-testid={`pill-marketplace-category-${category}`}
              className={categoryPillClass(activeCategory === category)}
              onClick={() => setActiveCategory(activeCategory === category ? null : category)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActiveCategory(activeCategory === category ? null : category);
                }
              }}
            >
              {translateCategory(category)}
              <span className='ml-6px text-12px opacity-60'>{count}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Four across from `lg`, not from `xl`. The settings window sits around
          1200px wide, which is below the 1280px `xl` breakpoint, so the old
          `lg:grid-cols-3 xl:grid-cols-4` only ever showed three. The card
          below is scaled down to stay legible at the ~250px this leaves it. */}
      <div className='grid grid-cols-1 gap-12px sm:grid-cols-2 lg:grid-cols-4'>
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
              className='group flex flex-col rounded-16px border border-solid border-transparent bg-base p-14px transition-all duration-180 hover:-translate-y-1px hover:border-primary-2 hover:shadow-[0_8px_24px_rgba(0,0,0,0.09)]'
            >
              <div className='flex items-start justify-between gap-8px'>
                <span className='relative inline-flex shrink-0'>
                  <Avatar
                    className='rounded-10px border-none'
                    shape='square'
                    size={40}
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
                      <span style={{ fontSize: 20 }}>{persona.avatar}</span>
                    ) : (
                      <Robot theme='outline' size={20} />
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
                  <span className='mt-1px max-w-88px shrink-0 truncate rounded-6px bg-fill-2 px-8px py-2px text-11px text-t-secondary'>
                    {translateCategory(persona.category)}
                  </span>
                ) : null}
              </div>
              <div className='mt-10px flex items-baseline gap-4px'>
                <span className='truncate text-14px font-600 text-t-primary'>
                  {persona.display_name || persona.name}
                </span>
                {nickname ? <span className='shrink-0 truncate text-12px text-t-tertiary'>· {nickname}</span> : null}
              </div>
              <div className='mt-6px line-clamp-2 min-h-36px text-12px leading-[1.55] text-t-secondary'>
                {persona.description || ''}
              </div>
              <div className='mt-12px'>
                {persona.installed ? (
                  <Button
                    type='text'
                    size='small'
                    data-testid={`btn-marketplace-chat-${persona.id}`}
                    className='!inline-flex !h-30px !w-full !items-center !justify-center !rounded-8px !bg-fill-2 !px-10px !text-12px !leading-none !text-t-secondary hover:!bg-primary-6 hover:!text-white'
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
                    className='!inline-flex !h-30px !w-full !items-center !justify-center !rounded-8px !bg-fill-2 !px-10px !text-12px !leading-none !text-t-secondary hover:!bg-primary-6 hover:!text-white'
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
