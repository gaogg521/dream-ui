/**
 * @license
 * Copyright 2025 One Work (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, Menu } from '@arco-design/web-react';
import { Earth } from '@icon-park/react';
import { changeLanguage } from '@/renderer/services/i18n';

/** Language options mirror the settings LanguageSwitcher list. */
const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'es-ES', label: 'Español' },
  { value: 'pt-BR', label: 'Português (BR)' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'uk-UA', label: 'Українська' },
  { value: 'tr-TR', label: 'Türkçe' },
  { value: 'fa-IR', label: 'فارسی' },
];

/**
 * Compact language switcher for the titlebar toolbar: a globe icon that opens a
 * dropdown of all supported languages, so users can switch without opening
 * Settings. Applies the change on the next frame to avoid the dropdown close
 * animation fighting the re-render (same guard the settings switcher uses).
 */
const LanguageQuickSwitch: React.FC<{ iconSize: number; strokeWidth: number }> = ({ iconSize, strokeWidth }) => {
  const { t, i18n } = useTranslation();
  const current = i18n.language;
  const label = t('common.language.switchTooltip', { defaultValue: 'Switch language' });

  const handleSelect = useCallback((value: string) => {
    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          changeLanguage(value).catch((error: Error) => console.error('Failed to change language:', error));
        })
      );
    } else {
      changeLanguage(value).catch((error: Error) => console.error('Failed to change language:', error));
    }
  }, []);

  const droplist = (
    <Menu selectedKeys={[current]} onClickMenuItem={handleSelect} style={{ maxHeight: 360, overflowY: 'auto' }}>
      {LANGUAGES.map((lang) => (
        <Menu.Item key={lang.value}>{lang.label}</Menu.Item>
      ))}
    </Menu>
  );

  return (
    <Dropdown droplist={droplist} trigger='click' position='br'>
      <button type='button' className='app-titlebar__button' aria-label={label} title={label}>
        <Earth
          theme='outline'
          size={iconSize}
          fill='currentColor'
          strokeWidth={strokeWidth}
          className='block leading-none'
        />
      </button>
    </Dropdown>
  );
};

export default LanguageQuickSwitch;
