/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { IconMoonFill, IconSunFill } from '@arco-design/web-react/icon';
import { ArrowCircleLeft, CloseOne, SettingTwo } from '@icon-park/react';
import classNames from 'classnames';
import { iconColors } from '@renderer/styles/colors';
import type { ThemeAppearance } from '@/common/theme/types';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import {
  applyOneThemePreset,
  findOneThemePresetById,
  readStoredOneThemePresetId,
  resolvePresetForLightDarkToggle,
  type OneThemePreset,
} from '@renderer/utils/theme/applyOneThemePreset';

interface SiderFooterProps {
  isMobile: boolean;
  isSettings: boolean;
  collapsed?: boolean;
  theme: string;
  siderTooltipProps: SiderTooltipProps;
  onSettingsClick: () => void;
  onThemeToggle: () => void;
  onThemePresetApplied?: (preset: OneThemePreset) => void;
  showLogout?: boolean;
  onLogoutClick?: () => void;
}

type ThemeSwatch = OneThemePreset & {
  label: string;
  gradient: string;
};

const THEME_SWATCHES: ThemeSwatch[] = [
  {
    ...findOneThemePresetById('default-dark'),
    label: '暗夜默认',
    gradient: 'linear-gradient(135deg, #2a2a2a 0%, #4d9fff 50%, #1a1a1a 100%)',
  },
  {
    ...findOneThemePresetById('cyber-blue'),
    label: '赛博蓝',
    gradient: 'radial-gradient(circle at 30% 30%, #22d3ee 0%, #0b1d3a 55%, #061126 100%)',
  },
  {
    ...findOneThemePresetById('volcanic'),
    label: '熔岩橙',
    gradient: 'radial-gradient(circle at 30% 30%, #fb923c 0%, #2a1810 55%, #140c06 100%)',
  },
  {
    ...findOneThemePresetById('deep-forest'),
    label: '深林绿',
    gradient: 'radial-gradient(circle at 30% 30%, #34d399 0%, #112c22 55%, #071a10 100%)',
  },
  {
    ...findOneThemePresetById('aurora'),
    label: '极光紫',
    gradient: 'radial-gradient(circle at 30% 30%, #a78bfa 0%, #160f30 45%, #e879f9 80%, #080616 100%)',
  },
  {
    ...findOneThemePresetById('moonlight'),
    label: '月光银',
    gradient: 'linear-gradient(135deg, #f3f6fb 0%, #bbc7e0 40%, #0369a1 100%)',
  },
];

const SiderFooter: React.FC<SiderFooterProps> = ({
  isMobile,
  isSettings,
  collapsed = false,
  theme,
  siderTooltipProps,
  onSettingsClick,
  onThemeToggle,
  onThemePresetApplied,
  showLogout = false,
  onLogoutClick,
}) => {
  const { t } = useTranslation();

  const [currentTheme, setCurrentTheme] = useState<ThemeSwatch>(() => {
    const saved = readStoredOneThemePresetId();
    const preset = findOneThemePresetById(saved ?? 'cyber-blue');
    return THEME_SWATCHES.find((item) => item.id === preset.id) ?? THEME_SWATCHES[1];
  });

  const applySwatch = useCallback(
    (swatch: ThemeSwatch, options?: { notifyParent?: boolean }) => {
      applyOneThemePreset(swatch);
      setCurrentTheme(swatch);
      if (options?.notifyParent !== false) {
        onThemePresetApplied?.(swatch);
      }
    },
    [onThemePresetApplied]
  );

  const handleSelectTheme = useCallback(
    (swatch: ThemeSwatch) => {
      applySwatch(swatch);
      if (swatch.theme === 'light' && theme === 'dark') {
        onThemeToggle();
      } else if (swatch.theme === 'dark' && theme === 'light') {
        onThemeToggle();
      }
    },
    [applySwatch, onThemeToggle, theme]
  );

  useEffect(() => {
    applySwatch(currentTheme, { notifyParent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLightDarkClick = useCallback(() => {
    const nextTheme: ThemeAppearance = theme === 'dark' ? 'light' : 'dark';
    const nextPreset = resolvePresetForLightDarkToggle(currentTheme, nextTheme);
    const swatch = THEME_SWATCHES.find((item) => item.id === nextPreset.id) ?? THEME_SWATCHES[1];
    applySwatch(swatch);
    onThemeToggle();
  }, [applySwatch, currentTheme, onThemeToggle, theme]);

  const settingsIcon = isSettings ? (
    <ArrowCircleLeft
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  ) : (
    <SettingTwo
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  );

  return (
    <div className='shrink-0 sider-footer mt-auto pt-8px pb-8px border-t border-solid border-[var(--color-border-2)] border-l-0 border-r-0 border-b-0'>
      <div className='flex flex-col gap-2px'>
        <div className={classNames('flex', collapsed ? 'flex-col gap-2px' : 'items-center gap-2px')}>
          <Tooltip
            {...siderTooltipProps}
            content={isSettings ? t('common.back') : t('common.settings')}
            position='right'
          >
            <div
              onClick={onSettingsClick}
              className={classNames(
                'group h-34px flex items-center rd-0.5rem cursor-pointer transition-colors',
                collapsed ? 'w-full justify-center' : 'flex-1 min-w-0 justify-start gap-8px pl-10px pr-8px',
                isMobile && 'sider-footer-btn-mobile',
                {
                  'bg-fill-3': isSettings,
                  'hover:bg-fill-3 active:bg-fill-4': !isSettings,
                }
              )}
            >
              <span className='size-22px flex items-center justify-center shrink-0 text-t-secondary'>
                {settingsIcon}
              </span>
              <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
                {isSettings ? t('common.back') : t('common.settings')}
              </span>
            </div>
          </Tooltip>
          {showLogout && onLogoutClick && (
            <Tooltip {...siderTooltipProps} content={t('settings.googleLogout')} position='right'>
              <div
                onClick={onLogoutClick}
                className={classNames(
                  'h-32px flex items-center rd-0.5rem cursor-pointer transition-colors hover:bg-[rgba(var(--primary-6),0.14)] active:bg-fill-2',
                  collapsed ? 'w-full justify-center' : 'flex-1 min-w-0 justify-start gap-10px px-14px',
                  isMobile && 'sider-footer-btn-mobile'
                )}
              >
                <span className='size-20px flex items-center justify-center shrink-0'>
                  <CloseOne
                    theme='outline'
                    size='16'
                    fill={iconColors.primary}
                    className='block leading-none'
                    style={{ lineHeight: 0 }}
                  />
                </span>
                <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
                  {t('settings.googleLogout')}
                </span>
              </div>
            </Tooltip>
          )}
        </div>

        <div
          className={classNames(
            'flex items-center justify-between py-6px rd-0.5rem',
            collapsed ? 'justify-center px-0' : 'px-10px',
            isMobile && 'sider-footer-btn-mobile'
          )}
        >
          <Tooltip
            {...siderTooltipProps}
            content={theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode')}
            position='right'
          >
            <div
              onClick={handleLightDarkClick}
              className='flex items-center gap-6px cursor-pointer hover:opacity-80 transition-opacity'
              aria-label={theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode')}
            >
              {theme === 'dark' ? (
                <IconSunFill style={{ fontSize: 16, color: 'rgb(var(--primary-6))' }} />
              ) : (
                <IconMoonFill style={{ fontSize: 16, color: 'rgb(var(--primary-6))' }} />
              )}
              <span className='collapsed-hidden text-12px text-t-secondary'>
                {theme === 'dark' ? t('settings.darkMode') : t('settings.lightMode')}
              </span>
            </div>
          </Tooltip>

          {!collapsed ? (
            <div className='collapsed-hidden flex items-center gap-4px'>
              {THEME_SWATCHES.map((th) => (
                <Tooltip key={th.id} content={th.label} position='top' mini>
                  <div
                    onClick={() => handleSelectTheme(th)}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: th.gradient,
                      cursor: 'pointer',
                      border:
                        currentTheme.id === th.id
                          ? `2px solid ${th.theme === 'light' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)'}`
                          : `2px solid rgba(128,128,128,0.2)`,
                      boxShadow:
                        currentTheme.id === th.id
                          ? `0 0 0 1px rgba(255,255,255,0.2), 0 0 6px rgba(255,255,255,0.2)`
                          : 'none',
                      transition: 'all 0.15s ease',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1.25)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    }}
                  />
                </Tooltip>
              ))}
            </div>
          ) : (
            <Tooltip content={currentTheme.label} position='right' mini>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: currentTheme.gradient,
                  border:
                    currentTheme.theme === 'light' ? '2px solid rgba(0,0,0,0.6)' : '2px solid rgba(255,255,255,0.9)',
                  boxShadow: '0 0 0 1px rgba(255,255,255,0.2), 0 0 6px rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};

export default SiderFooter;
