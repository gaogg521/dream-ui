/**
 * Copyright 2026 One Work
 */

import { configService } from '@/common/config/configService';
import type { ICronPushTarget } from '@/common/adapter/ipcBridge';
import PushTargetField from '@/renderer/components/scenes/PushTargetField';
import { Message, Select } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const KEY = 'notify.turnCompleted';
const DEFAULT_MIN_SECONDS = 60;
// The backend (turn_push) only ever pushes to platforms it can address directly.
const SUPPORTED_PLATFORMS = ['weixin', 'wecom', 'lark', 'dingtalk', 'telegram'] as const;
const MIN_SECONDS_CHOICES = [0, 60, 300, 900] as const;

type Stored = { enabled: boolean; plugin_id: string; chat_id: string; min_seconds: number };

const readStored = (): Stored | null => {
  const stored = configService.get(KEY);
  return stored && typeof stored === 'object' ? stored : null;
};

/**
 * "Tell my chat bot when a long task finishes" — the notification that still
 * arrives when a phone is locked and its browser tab is frozen. The backend
 * reads the same preference, so saving it here is all it takes.
 */
const TurnPushSection: React.FC = () => {
  const { t } = useTranslation();
  const [stored, setStored] = useState<Stored | null>(readStored);
  const minSeconds = stored?.min_seconds ?? DEFAULT_MIN_SECONDS;
  const value: ICronPushTarget | null =
    stored?.enabled && stored.plugin_id && stored.chat_id
      ? { plugin_id: stored.plugin_id, chat_id: stored.chat_id }
      : null;

  const save = useCallback(
    async (next: Stored) => {
      const previous = stored;
      setStored(next);
      try {
        await configService.set(KEY, next);
      } catch (error) {
        console.error('[TurnPush] save failed:', error);
        setStored(previous);
        Message.error(t('settings.webui.operationFailed'));
      }
    },
    [stored, t]
  );

  const handleTarget = (target: ICronPushTarget | null): void => {
    void save({
      enabled: target !== null,
      plugin_id: target?.plugin_id ?? '',
      chat_id: target?.chat_id ?? '',
      min_seconds: minSeconds,
    });
  };

  const minLabels: Record<number, string> = {
    0: t('settings.webui.turnPush.minAny'),
    60: t('settings.webui.turnPush.min1'),
    300: t('settings.webui.turnPush.min5'),
    900: t('settings.webui.turnPush.min15'),
  };

  return (
    <div className='mt-12px'>
      <PushTargetField
        value={value}
        onChange={handleTarget}
        supportedPlatforms={SUPPORTED_PLATFORMS}
        title={t('settings.webui.turnPush.title')}
        hint={t('settings.webui.turnPush.hint')}
      />
      {value && (
        <div className='-mt-8px mb-12px flex items-center justify-between gap-12px'>
          <span className='text-12px text-t-secondary'>{t('settings.webui.turnPush.minDuration')}</span>
          <Select
            size='small'
            style={{ width: 140 }}
            value={minSeconds}
            onChange={(seconds: number) => void save({ ...(stored as Stored), min_seconds: seconds })}
          >
            {MIN_SECONDS_CHOICES.map((seconds) => (
              <Select.Option key={seconds} value={seconds}>
                {minLabels[seconds]}
              </Select.Option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
};

export default TurnPushSection;
