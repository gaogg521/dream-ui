/**
 * Copyright 2026 One Work
 */

import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import type { IProvider } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import DreamSelect from '@/renderer/components/base/DreamSelect';
import { SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT } from '@/renderer/services/SpeechToTextService';
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import { sortModelsForTranscription } from '@/renderer/services/speech/speechModels';
import { Button, Divider, Form, Input, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SpeechTestPanel from './SpeechTestPanel';
import {
  DEFAULT_SPEECH_TO_TEXT_CONFIG,
  OPENAI_SPEECH_MODEL_PRESETS,
  SPEECH_LANGUAGE_OPTIONS,
  applySpeechSource,
  buildModelOptions,
  deriveSpeechSource,
  getAutoTranscriptionPrompt,
  isValidHttpUrl,
  migrateLegacySpeechSource,
  migrateSpeechLanguage,
  normalizeSpeechToTextConfig,
  type SpeechSource,
} from './speechSettingsUtils';

type OpenAIField = keyof NonNullable<SpeechToTextConfig['openai']>;

const FieldLabel: React.FC<{ labelKey: string; requirement: 'required' | 'optional' }> = ({
  labelKey,
  requirement,
}) => {
  const { t } = useTranslation();
  return (
    <span className='inline-flex items-center gap-6px'>
      <span>{t(labelKey)}</span>
      <span aria-hidden='true' className='text-12px text-t-tertiary'>
        ({t(requirement === 'required' ? 'settings.speechToTextRequired' : 'settings.speechToTextOptional')})
      </span>
    </span>
  );
};

const VoiceInputSection: React.FC = () => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SpeechToTextConfig>(DEFAULT_SPEECH_TO_TEXT_CONFIG);
  // Source is UI state, only initialized from the stored config. A purely
  // derived source would snap "custom" back to "hosted" while base_url is
  // still empty, making custom mode unreachable for fresh users.
  const [source, setSource] = useState<SpeechSource>('hosted');
  const [configuredProviders, setConfiguredProviders] = useState<IProvider[]>([]);
  const lastCustomBaseUrlRef = useRef('');
  // `null` = never fetched. An empty array is a real answer (the endpoint
  // listed nothing) and must render differently from "not asked yet".
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSpeechConfig = async () => {
      try {
        const stored = await getClientBusinessSetting('tools.speechToText');
        if (cancelled) {
          return;
        }
        const normalized = migrateLegacySpeechSource(migrateSpeechLanguage(normalizeSpeechToTextConfig(stored)));
        setConfig(normalized);
        setSource(deriveSpeechSource(normalized));
        if (deriveSpeechSource(normalized) === 'custom') {
          lastCustomBaseUrlRef.current = normalized.openai?.base_url ?? '';
        }
      } catch (error) {
        console.error('Failed to load speech-to-text config:', error);
      }
    };

    void loadSpeechConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ipcBridge.mode.listProviders
      .invoke()
      .then((providers) => {
        if (!cancelled) setConfiguredProviders(providers ?? []);
      })
      .catch((error) => console.warn('Failed to load configured speech models:', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const updateConfig = useCallback((updater: (current: SpeechToTextConfig) => SpeechToTextConfig) => {
    setConfig((current) => {
      const next = normalizeSpeechToTextConfig(updater(current));
      void setClientBusinessSetting('tools.speechToText', next).catch((error) => {
        console.error('Failed to save speech-to-text config:', error);
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT));
      }
      return next;
    });
  }, []);

  const handleSourceChange = useCallback(
    (value: string) => {
      setSource(value as SpeechSource);
      updateConfig((current) => {
        if (deriveSpeechSource(current) === 'custom') {
          lastCustomBaseUrlRef.current = current.openai?.base_url ?? '';
        }
        if (value === 'modelSettings') {
          return { ...current, provider: 'openai' };
        }
        return applySpeechSource(current, value as SpeechSource, lastCustomBaseUrlRef.current);
      });
    },
    [updateConfig]
  );

  const handleOpenAIChange = useCallback(
    (field: OpenAIField, value: string) => {
      updateConfig(
        (current) =>
          ({
            ...current,
            openai: { ...DEFAULT_SPEECH_TO_TEXT_CONFIG.openai, ...current.openai, [field]: value },
          }) as SpeechToTextConfig
      );
    },
    [updateConfig]
  );

  const isCustom = source === 'custom';
  const isModelSettings = source === 'modelSettings';
  const isHosted = source === 'hosted';
  const activeLanguage = config.openai?.language ?? '';
  const activeModel = config.openai?.model ?? '';
  const activeApiKey = config.openai?.api_key ?? '';
  const modelPresets = OPENAI_SPEECH_MODEL_PRESETS;
  const customBaseUrl = config.openai?.base_url ?? '';
  const isBaseUrlInvalid = isCustom && customBaseUrl.trim() !== '' && !isValidHttpUrl(customBaseUrl);
  const configuredSpeechModels = configuredProviders.flatMap((provider) =>
    provider.enabled === false
      ? []
      : provider.models
          .filter(
            (model) =>
              provider.model_enabled?.[model] !== false && provider.model_settings?.[model]?.model_kind === 'audio'
          )
          .map((model) => ({ model, providerId: provider.id, providerName: provider.name }))
  );

  const handleModelChange = useCallback(
    (value: string) => {
      handleOpenAIChange('model', value);
    },
    [handleOpenAIChange]
  );

  const handleConfiguredModelChange = useCallback(
    (value: string) => {
      const selected = configuredSpeechModels.find(({ providerId, model }) => `${providerId}:${model}` === value);
      if (!selected) return;
      updateConfig((current) => ({
        ...current,
        modelProviderId: selected.providerId,
        provider: 'openai',
        openai: {
          ...DEFAULT_SPEECH_TO_TEXT_CONFIG.openai,
          ...current.openai,
          // Credentials are resolved from Model Settings only by dreamcore.
          api_key: '',
          base_url: '',
          model: selected.model,
        },
      }));
    },
    [configuredSpeechModels, updateConfig]
  );

  const handleLanguageChange = useCallback(
    (value: string) => {
      // Whisper-family `zh` is script-ambiguous: pair the language with a
      // same-script prompt (undefined clears it for non-Chinese languages).
      updateConfig(
        (current) =>
          ({
            ...current,
            openai: {
              ...DEFAULT_SPEECH_TO_TEXT_CONFIG.openai,
              ...current.openai,
              language: value,
              prompt: getAutoTranscriptionPrompt(value),
            },
          }) as SpeechToTextConfig
      );
    },
    [updateConfig]
  );

  const handleApiKeyChange = useCallback(
    (value: string) => {
      handleOpenAIChange('api_key', value);
    },
    [handleOpenAIChange]
  );

  /**
   * Ask the endpoint the user typed what models it serves.
   *
   * Reuses the provider form's anonymous `fetch-models` (no provider row
   * needed); `platform: 'openai'` selects dreamcore's OpenAI-compatible
   * fetcher, which appends `/models` to the base URL as written — the same
   * `https://host/v1` shape this field already asks for.
   *
   * The list is a convenience, never a promise: `/v1/models` returns bare ids
   * with no modality, so a served model may not be a transcription model, and
   * an endpoint can list ASR models while not implementing
   * `/audio/transcriptions` at all (Aliyun's compatible-mode does exactly
   * that — it answers 404). Hence "保存并测试" stays the only real proof.
   */
  const handleFetchModels = useCallback(async () => {
    const baseUrl = customBaseUrl.trim();
    if (!isValidHttpUrl(baseUrl)) {
      setFetchModelsError(t('settings.speechToTextBaseUrlInvalid'));
      return;
    }
    setIsFetchingModels(true);
    setFetchModelsError(null);
    try {
      const response = await ipcBridge.mode.fetchModelList.invoke({
        platform: 'openai',
        base_url: baseUrl,
        api_key: activeApiKey,
      });
      const ids = (response?.models ?? []).map((model) => (typeof model === 'string' ? model : model.id));
      setFetchedModels(sortModelsForTranscription(ids));
    } catch (error) {
      setFetchedModels(null);
      setFetchModelsError(
        `${t('settings.speechToTextFetchModelsFailed')}: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsFetchingModels(false);
    }
  }, [activeApiKey, customBaseUrl, t]);

  // A fetched list belongs to the endpoint it came from; once the user edits
  // the URL or the key it is stale, so drop it rather than offer models the
  // new endpoint may not serve.
  useEffect(() => {
    setFetchedModels(null);
    setFetchModelsError(null);
  }, [customBaseUrl, activeApiKey]);

  const modelOptions = fetchedModels ?? modelPresets;

  return (
    <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-2'>
      <div className='flex items-center justify-between gap-12px mb-8px'>
        <div className='flex flex-col gap-4px'>
          <span className='text-14px text-t-primary'>{t('settings.speechToText')}</span>
          <span className='text-13px text-t-secondary'>{t('settings.speechToTextDescription')}</span>
        </div>
        <Switch
          checked={config.enabled}
          onChange={(checked) => updateConfig((current) => ({ ...current, enabled: checked }))}
        />
      </div>

      {config.enabled && (
        <>
          <Divider className='mt-0px mb-20px' />

          <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
            <Form.Item label={t('settings.speechToTextSource')}>
              <DreamSelect value={source} onChange={handleSourceChange}>
                <DreamSelect.Option value='hosted'>{t('settings.speechToTextSourceHosted')}</DreamSelect.Option>
                <DreamSelect.Option value='custom'>{t('settings.speechToTextSourceCustom')}</DreamSelect.Option>
                <DreamSelect.Option value='modelSettings'>
                  {t('settings.speechToTextSourceModelSettings')}
                </DreamSelect.Option>
              </DreamSelect>
            </Form.Item>

            {isHosted && (
              <div className='text-13px text-t-secondary'>{t('settings.speechToTextSourceHostedDescription')}</div>
            )}

            {isModelSettings && (
              <Form.Item label={t('settings.speechToTextModel')}>
                <DreamSelect
                  value={config.modelProviderId ? `${config.modelProviderId}:${activeModel}` : undefined}
                  onChange={handleConfiguredModelChange}
                  placeholder={t('settings.speechToTextModelPlaceholder')}
                >
                  {configuredSpeechModels.map(({ model, providerId, providerName }) => (
                    <DreamSelect.Option key={`${providerId}:${model}`} value={`${providerId}:${model}`}>
                      {providerName} · {model}
                    </DreamSelect.Option>
                  ))}
                </DreamSelect>
                {configuredSpeechModels.length === 0 && (
                  <div className='mt-6px text-12px text-t-secondary'>{t('settings.speechToTextNoConfiguredModel')}</div>
                )}
              </Form.Item>
            )}

            {isCustom && (
              <Form.Item
                label={<FieldLabel labelKey='settings.speechToTextBaseUrl' requirement='required' />}
                validateStatus={isBaseUrlInvalid ? 'error' : undefined}
                help={isBaseUrlInvalid ? t('settings.speechToTextBaseUrlInvalid') : undefined}
              >
                <Input
                  value={customBaseUrl}
                  placeholder={t('settings.speechToTextBaseUrlPlaceholder')}
                  onChange={(value) => handleOpenAIChange('base_url', value)}
                />
              </Form.Item>
            )}

            {isCustom && (
              <Form.Item label={<FieldLabel labelKey='settings.speechToTextApiKey' requirement='optional' />}>
                <Input.Password value={activeApiKey} visibilityToggle onChange={handleApiKeyChange} />
              </Form.Item>
            )}

            {isCustom && (
              <Form.Item label={t('settings.speechToTextModel')}>
                <div className='flex items-center gap-8px'>
                  <DreamSelect
                    className='flex-1'
                    value={activeModel || undefined}
                    onChange={handleModelChange}
                    // Presets are convenience defaults, not an allowlist. Providers
                    // add and retire transcription models independently, so every
                    // source must let the user enter its current model identifier.
                    allowCreate
                    showSearch
                    placeholder={t('settings.speechToTextModelPlaceholder')}
                  >
                    {buildModelOptions(modelOptions, activeModel).map((model) => (
                      <DreamSelect.Option key={model} value={model}>
                        {model}
                      </DreamSelect.Option>
                    ))}
                  </DreamSelect>
                  <Button
                    size='small'
                    loading={isFetchingModels}
                    disabled={!isValidHttpUrl(customBaseUrl)}
                    onClick={() => void handleFetchModels()}
                  >
                    {t('settings.speechToTextFetchModels')}
                  </Button>
                </div>
                {fetchModelsError !== null && <div className='mt-6px text-12px text-danger-6'>{fetchModelsError}</div>}
                {fetchedModels !== null && fetchModelsError === null && (
                  <div className='mt-6px text-12px text-t-tertiary'>
                    {t('settings.speechToTextFetchModelsHint', { count: fetchedModels.length })}
                  </div>
                )}
              </Form.Item>
            )}

            {!isHosted && (
              <Form.Item label={t('settings.speechToTextLanguage')}>
                <DreamSelect value={activeLanguage} onChange={handleLanguageChange}>
                  {SPEECH_LANGUAGE_OPTIONS.map((option) => (
                    <DreamSelect.Option key={option.value || 'auto'} value={option.value}>
                      {option.label ?? t('settings.speechToTextLanguageAuto')}
                    </DreamSelect.Option>
                  ))}
                </DreamSelect>
              </Form.Item>
            )}
          </Form>
          <SpeechTestPanel config={config} source={source} />
        </>
      )}
    </div>
  );
};

export default VoiceInputSection;
