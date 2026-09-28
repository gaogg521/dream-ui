/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SpeechToTextConfig } from '@/common/types/provider/speech';

const speechSettingsMocks = vi.hoisted(() => ({
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: vi.fn(),
  setClientBusinessSetting: speechSettingsMocks.setClientBusinessSetting,
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

import SpeechTestPanel from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/SpeechTestPanel';

const makeConfig = (overrides?: Partial<SpeechToTextConfig>): SpeechToTextConfig => ({
  enabled: true,
  provider: 'hosted',
  ...overrides,
});

describe('SpeechTestPanel', () => {
  it('hosted mode needs no validation — saves and starts the test directly', async () => {
    const config = makeConfig();
    render(<SpeechTestPanel config={config} source='hosted' />);
    fireEvent.click(screen.getByText('settings.speechToTextTest'));
    await waitFor(() =>
      expect(speechSettingsMocks.setClientBusinessSetting).toHaveBeenCalledWith('tools.speechToText', config)
    );
    expect(screen.queryByText('settings.speechToTextBaseUrlInvalid')).toBeNull();
  });

  it('shows validation error for invalid custom base_url', async () => {
    const config = makeConfig({
      provider: 'openai',
      openai: { api_key: '', base_url: 'not-a-url', model: 'm', language: '' },
    });
    render(<SpeechTestPanel config={config} source='custom' />);
    fireEvent.click(screen.getByText('settings.speechToTextTest'));
    await waitFor(() => expect(screen.getByText('settings.speechToTextBaseUrlInvalid')).toBeTruthy());
  });

  it('shows validation error in custom mode when base_url is empty', async () => {
    const config = makeConfig({
      provider: 'openai',
      openai: { api_key: '', base_url: '', model: 'm', language: '' },
    });
    render(<SpeechTestPanel config={config} source='custom' />);
    fireEvent.click(screen.getByText('settings.speechToTextTest'));
    await waitFor(() => expect(screen.getByText('settings.speechToTextBaseUrlInvalid')).toBeTruthy());
  });

  it('custom mode with an empty API key but a valid base_url passes validation (key is optional)', async () => {
    const config = makeConfig({
      provider: 'openai',
      openai: { api_key: '', base_url: 'https://my-host/v1', model: 'gpt-4o-transcribe', language: '' },
    });
    render(<SpeechTestPanel config={config} source='custom' />);
    fireEvent.click(screen.getByText('settings.speechToTextTest'));
    await waitFor(() =>
      expect(speechSettingsMocks.setClientBusinessSetting).toHaveBeenCalledWith('tools.speechToText', config)
    );
  });

  it('saves config before starting a test when validation passes', async () => {
    const config = makeConfig({
      provider: 'openai',
      openai: { api_key: 'sk-test', base_url: 'https://my-host/v1', model: 'gpt-4o-transcribe', language: '' },
    });
    render(<SpeechTestPanel config={config} source='custom' />);
    fireEvent.click(screen.getByText('settings.speechToTextTest'));
    await waitFor(() =>
      expect(speechSettingsMocks.setClientBusinessSetting).toHaveBeenCalledWith('tools.speechToText', config)
    );
  });
});
