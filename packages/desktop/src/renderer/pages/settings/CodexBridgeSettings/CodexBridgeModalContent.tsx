/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { codexBridge } from '@/common/adapter/ipcBridge';
import { CODEX_BRIDGE_STATUS_SWR_KEY } from '@/renderer/hooks/agent/useCodexBridgeStatus';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import DreamScrollArea from '@/renderer/components/base/DreamScrollArea';
import { Button, Message, Select, Switch } from '@arco-design/web-react';
import { LinkCloud } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate } from 'swr';

const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, description, extra, children }) => (
  <div className='flex items-center justify-between gap-12px py-12px'>
    <div className='min-w-0 flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>{label}</span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center shrink-0'>{children}</div>
  </div>
);

const CodexBridgeModalContent: React.FC = () => {
  const { t } = useTranslation();
  const { providers, getAvailableModels } = useModelProviderList();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const config = await codexBridge.getConfig.invoke();
        if (cancelled) return;
        setEnabled(config.enabled);
        setProviderId(config.provider_id);
        setModel(config.model);
        setConfigured(config.configured);
      } catch (error) {
        console.error('[CodexBridgeModalContent] Failed to load config:', error);
        Message.error(t('settings.codexBridge.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const selectedProvider = providers.find((p) => p.id === providerId) ?? null;
  const availableModels = selectedProvider ? getAvailableModels(selectedProvider) : [];

  const handleProviderChange = useCallback(
    (value: string) => {
      setProviderId(value);
      const provider = providers.find((p) => p.id === value);
      const models = provider ? getAvailableModels(provider) : [];
      setModel(models.includes(model ?? '') ? model : (models[0] ?? null));
    },
    [providers, getAvailableModels, model]
  );

  const handleSave = useCallback(async () => {
    if (enabled && (!providerId || !model)) {
      Message.error(t('settings.codexBridge.providerModelRequired'));
      return;
    }
    setSaving(true);
    try {
      const result = await codexBridge.setConfig.invoke({
        enabled,
        provider_id: providerId,
        model,
      });
      setConfigured(result.configured);
      // Revalidate any already-mounted model selector's bridge-lock check and
      // displayed model name — its SWR cache was fetched before this save and
      // won't otherwise learn the bridge just turned on/off (or switched
      // models) until a full app reload.
      void mutate(CODEX_BRIDGE_STATUS_SWR_KEY, result, false);
      Message.success(t('settings.codexBridge.saveSuccess'));
    } catch (error) {
      console.error('[CodexBridgeModalContent] Failed to save config:', error);
      Message.error(t('settings.codexBridge.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [enabled, providerId, model, t]);

  return (
    <DreamScrollArea className='flex-1 min-h-0 pb-16px'>
      <div className='space-y-12px px-[12px] md:px-[28px]'>
        <h2 className='text-20px font-500 text-t-primary m-0'>{t('settings.codexBridge.title')}</h2>
        <p className='m-0 text-13px text-t-secondary leading-relaxed'>{t('settings.codexBridge.description')}</p>

        <div className='px-[12px] md:px-[28px] py-14px bg-2 rd-16px'>
          <div className='mb-8px rd-10px border border-line bg-fill-1 px-10px py-8px flex items-start gap-6px'>
            <LinkCloud theme='outline' size='16' className='mt-1px text-[rgb(var(--primary-6))]' />
            <div className='text-12px text-t-secondary leading-relaxed'>{t('settings.codexBridge.hint')}</div>
          </div>

          <PreferenceRow
            label={t('settings.codexBridge.enable')}
            extra={
              configured && enabled ? (
                <span className='text-12px text-success'>✓ {t('settings.codexBridge.active')}</span>
              ) : null
            }
          >
            <Switch
              checked={enabled}
              disabled={loading}
              onChange={setEnabled}
              data-testid='codex-bridge-enable-switch'
            />
          </PreferenceRow>

          <PreferenceRow label={t('settings.codexBridge.provider')}>
            <Select
              style={{ width: 220 }}
              value={providerId ?? undefined}
              placeholder={t('settings.codexBridge.selectProvider')}
              disabled={loading}
              onChange={handleProviderChange}
              data-testid='codex-bridge-provider-select'
            >
              {providers.map((provider) => (
                <Select.Option key={provider.id} value={provider.id}>
                  {provider.name}
                </Select.Option>
              ))}
            </Select>
          </PreferenceRow>

          <PreferenceRow label={t('settings.codexBridge.model')}>
            <Select
              style={{ width: 220 }}
              value={model ?? undefined}
              placeholder={t('settings.codexBridge.selectModel')}
              disabled={loading || !selectedProvider}
              onChange={(value: string) => setModel(value)}
              data-testid='codex-bridge-model-select'
            >
              {availableModels.map((m) => (
                <Select.Option key={m} value={m}>
                  {m}
                </Select.Option>
              ))}
            </Select>
          </PreferenceRow>

          <div className='flex justify-end pt-8px'>
            <Button
              type='primary'
              loading={saving}
              disabled={loading}
              onClick={() => void handleSave()}
              data-testid='codex-bridge-save-button'
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </DreamScrollArea>
  );
};

export default CodexBridgeModalContent;
