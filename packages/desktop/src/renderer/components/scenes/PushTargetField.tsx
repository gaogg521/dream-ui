/**
 * Copyright 2026 One Work
 */

/**
 * Select one of the current user's connected bots and recipient sessions.
 *
 * An automation that runs while nobody is looking is only useful if its result
 * reaches someone. The person's own chat bot (the ones they have already
 * connected under the channel settings) is where they will actually see it, so
 * the form lets them pick one of those bots and the chat to message. Nothing is
 * entered by hand: bots and chats come from the backend, which only knows a chat
 * once somebody has talked to the bot from it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { Button, Select, Switch } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type { ICronPushTarget } from '@/common/adapter/ipcBridge';
import type { IChannelPushTarget } from '@/common/types/channel/channel';

type PushTargetFieldProps = {
  value: ICronPushTarget | null;
  onChange: (next: ICronPushTarget | null) => void;
  onValidityChange?: (valid: boolean) => void;
  supportedPlatforms?: readonly string[];
};

type PushOption = { key: string; label: string; target: ICronPushTarget };

const optionKey = (target: ICronPushTarget): string => `${target.plugin_id}::${target.chat_id}`;

/** One option per (bot, chat), labelled so two bots of the same kind stay distinguishable. */
export function buildPushOptions(targets: IChannelPushTarget[]): PushOption[] {
  return targets.flatMap((bot) =>
    bot.chats.map((chat) => {
      const target = { plugin_id: bot.pluginId, chat_id: chat.chatId };
      return { key: optionKey(target), label: `${bot.name} · ${chat.displayName || chat.chatId}`, target };
    })
  );
}

/** Opens the channel settings. Rendered only inside a router (the form is also mounted without one in isolation). */
const GoToSettingsButton: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Button size='mini' type='outline' onClick={() => void navigate('/settings/webui?tab=channels')}>
      {t('cron.page.form.push.goSettings')}
    </Button>
  );
};

const PushTargetField: React.FC<PushTargetFieldProps> = ({ value, onChange, onValidityChange, supportedPlatforms }) => {
  const { t } = useTranslation();
  const inRouter = useInRouterContext();
  const [targets, setTargets] = useState<IChannelPushTarget[] | null>(null);
  const [enabled, setEnabled] = useState(value !== null);

  useEffect(() => {
    let alive = true;
    ipcBridge.channel.getPushTargets
      .invoke()
      .then((list) => {
        if (alive)
          setTargets(
            (list ?? []).filter(
              (bot) => !supportedPlatforms || (bot.connected && supportedPlatforms.includes(bot.type))
            )
          );
      })
      .catch(() => {
        if (alive) setTargets([]);
      });
    return () => {
      alive = false;
    };
  }, [supportedPlatforms]);

  // The form seeds `value` after it opens (editing a task, or a template), so the
  // switch follows the value rather than only its first render.
  const hasValue = value !== null;
  useEffect(() => {
    setEnabled(hasValue);
  }, [hasValue]);

  const options = useMemo(() => buildPushOptions(targets ?? []), [targets]);
  // A saved target whose bot or chat is gone still shows, so it can be seen and replaced.
  const selected = value ? optionKey(value) : undefined;
  const missing = value !== null && !options.some((option) => option.key === selected);
  useEffect(() => {
    onValidityChange?.(!enabled || (value !== null && !missing && targets !== null));
  }, [enabled, value, missing, targets, onValidityChange]);

  const handleToggle = (on: boolean) => {
    setEnabled(on);
    if (!on) {
      onChange(null);
    } else if (options.length === 1) {
      onChange(options[0].target);
    }
  };

  return (
    <div
      className='mb-20px rounded-12px border border-solid border-[var(--color-border-2)] px-14px py-12px'
      data-testid='push-target-field'
    >
      <div className='flex items-start justify-between gap-16px'>
        <div className='min-w-0'>
          <p className='m-0 text-14px font-medium text-t-primary'>{t('cron.page.form.push.title')}</p>
          <p className='mb-0 mt-4px text-12px leading-18px text-t-secondary'>{t('cron.page.form.push.hint')}</p>
        </div>
        <Switch checked={enabled} onChange={handleToggle} data-testid='push-target-switch' />
      </div>

      {enabled && targets !== null && (
        <div className='mt-12px'>
          {options.length > 0 || missing ? (
            <Select
              value={selected}
              placeholder={t('cron.page.form.push.placeholder')}
              onChange={(key: string) => {
                const next = options.find((option) => option.key === key);
                if (next) onChange(next.target);
              }}
            >
              {missing && value ? (
                <Select.Option value={optionKey(value)} disabled>
                  {t('cron.page.form.push.gone')}
                </Select.Option>
              ) : null}
              {options.map((option) => (
                <Select.Option key={option.key} value={option.key}>
                  {option.label}
                </Select.Option>
              ))}
            </Select>
          ) : (
            <div className='flex items-center justify-between gap-12px rounded-8px bg-fill-2 px-12px py-10px text-12px leading-18px text-t-secondary'>
              <span>{t(targets.length === 0 ? 'cron.page.form.push.noBot' : 'cron.page.form.push.noChat')}</span>
              {inRouter ? <GoToSettingsButton /> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PushTargetField;
