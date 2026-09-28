/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechToTextConfig } from '@/common/types/provider/speech';

const configStore: { value?: SpeechToTextConfig } = {};
const speechSettingsMocks = vi.hoisted(() => ({
  getClientBusinessSetting: vi.fn(),
  listProviders: vi.fn(() => Promise.resolve([])),
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: {
      listProviders: { invoke: speechSettingsMocks.listProviders },
    },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: speechSettingsMocks.getClientBusinessSetting,
  setClientBusinessSetting: speechSettingsMocks.setClientBusinessSetting,
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

import VoiceInputSection from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection';

describe('VoiceInputSection', () => {
  beforeEach(() => {
    configStore.value = undefined;
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(undefined);
    speechSettingsMocks.listProviders.mockResolvedValue([]);
    speechSettingsMocks.setClientBusinessSetting.mockResolvedValue(undefined);
    // jsdom does not implement matchMedia; arco-design's responsive Grid needs it
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders only the enable switch when explicitly disabled', async () => {
    configStore.value = { enabled: false, provider: 'hosted' };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToText')).toBeTruthy());
    expect(screen.queryByText('settings.speechToTextSource')).toBeNull();
  });

  it('a user who has never touched this panel gets the hosted default, already enabled', async () => {
    // getClientBusinessSetting resolves undefined (nothing stored) — the beforeEach default.
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextSource')).toBeTruthy());
    expect(screen.getByText('settings.speechToTextSourceHosted')).toBeTruthy();
    // Hosted needs no fields: nothing to fill in for the mic to work.
    expect(screen.queryByText('settings.speechToTextBaseUrl')).toBeNull();
    expect(screen.queryByText('settings.speechToTextApiKey')).toBeNull();
  });

  it('a config with provider openai and no base_url (from a retired official preset) now shows as hosted', async () => {
    configStore.value = {
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', base_url: '', model: 'gpt-4o-transcribe', language: '' },
    };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextSource')).toBeTruthy());
    expect(screen.getByText('settings.speechToTextSourceHosted')).toBeTruthy();
    expect(screen.queryByText('settings.speechToTextBaseUrl')).toBeNull();
  });

  it('custom mode (openai + base_url) shows base_url field', async () => {
    configStore.value = {
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', base_url: 'https://my-host/v1', model: 'my-model', language: '' },
    };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextBaseUrl')).toBeTruthy());
  });

  it('selecting custom keeps the base_url field visible before a url is entered', async () => {
    configStore.value = {
      enabled: true,
      provider: 'openai',
      openai: { api_key: '', base_url: '', model: 'gpt-4o-transcribe', language: '' },
    };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextSource')).toBeTruthy());

    // Open the source select (first Arco select in the form) and pick "Custom".
    const trigger = document.querySelector('.arco-select');
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger as Element);
    const customOption = await screen.findByText('settings.speechToTextSourceCustom');
    fireEvent.click(customOption);

    // The base_url field must appear...
    await waitFor(() => expect(screen.getByText('settings.speechToTextBaseUrl')).toBeTruthy());
    // ...and stay, even though the stored config (empty base_url) derives to the hosted default.
    await waitFor(() => expect(screen.getByText('settings.speechToTextBaseUrl')).toBeTruthy());
  });

  it('can select an enabled audio model from Model Settings without copying its credentials', async () => {
    configStore.value = {
      enabled: true,
      provider: 'openai',
      openai: { api_key: '', base_url: '', model: 'gpt-4o-transcribe', language: '' },
    };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    speechSettingsMocks.listProviders.mockResolvedValue([
      {
        id: 'openrouter',
        name: 'OpenRouter',
        enabled: true,
        models: ['qwen/qwen3-asr-0.6b'],
        model_enabled: { 'qwen/qwen3-asr-0.6b': true },
        model_settings: { 'qwen/qwen3-asr-0.6b': { model_kind: 'audio' } },
      },
    ]);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextSource')).toBeTruthy());

    fireEvent.click(document.querySelector('.arco-select') as Element);
    fireEvent.click(await screen.findByText('settings.speechToTextSourceModelSettings'));

    await waitFor(() => expect(screen.getByText('settings.speechToTextModel')).toBeTruthy());
    const selects = document.querySelectorAll('.arco-select');
    fireEvent.click(selects[1] as Element);
    fireEvent.click(await screen.findByText('OpenRouter · qwen/qwen3-asr-0.6b'));

    await waitFor(() => {
      expect(speechSettingsMocks.setClientBusinessSetting).toHaveBeenLastCalledWith(
        'tools.speechToText',
        expect.objectContaining({
          modelProviderId: 'openrouter',
          openai: expect.objectContaining({ api_key: '', base_url: '', model: 'qwen/qwen3-asr-0.6b' }),
        })
      );
    });
  });

  it("custom mode never shows a streaming/batch badge, since a custom endpoint's capability is unknown", async () => {
    configStore.value = {
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', base_url: 'https://my-host/v1', model: 'gpt-4o-transcribe', language: '' },
    };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextSource')).toBeTruthy());

    // Open the model Select (second .arco-select on the page — first is the source select).
    const selects = document.querySelectorAll('.arco-select');
    expect(selects.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(selects[1] as Element);

    // Custom source is always 'unknown' capability (we can't statically know a
    // self-hosted endpoint's streaming support), so neither badge should render
    // for gpt-4o-transcribe or whisper-1, even though those model names carry
    // real supported/unsupported capability on the official OpenAI endpoint.
    await waitFor(() => expect(screen.getAllByText('gpt-4o-transcribe').length).toBeGreaterThan(0));
    expect(screen.queryByText('settings.speechToTextStreamingBadge')).toBeNull();
    expect(screen.queryByText('settings.speechToTextWholeBadge')).toBeNull();
  });

  it('migrates a stored ambiguous zh language to Simplified Chinese on load', async () => {
    configStore.value = {
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', base_url: 'https://my-host/v1', model: 'whisper-1', language: 'zh' },
    };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextLanguage')).toBeTruthy());
    // The language select displays the migrated zh-CN option label.
    await waitFor(() => expect(screen.getByText('中文（简体）')).toBeTruthy());
  });

  it('hosted mode hides the language selector (nothing to configure)', async () => {
    configStore.value = { enabled: true, provider: 'hosted' };
    speechSettingsMocks.getClientBusinessSetting.mockResolvedValue(configStore.value);
    render(<VoiceInputSection />);
    await waitFor(() => expect(screen.getByText('settings.speechToTextSource')).toBeTruthy());
    expect(screen.queryByText('settings.speechToTextLanguage')).toBeNull();
  });
});
