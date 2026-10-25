/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { Alert, Button, Message, Switch } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import { notifyManualRestartRequired } from '@/renderer/utils/appRestart';
import { isElectronDesktop } from '@/renderer/utils/platform';
import PreferenceRow from './PreferenceRow';

/**
 * 智能体浏览器控制的总开关（生产可见）。
 *
 * 这项能力一直存在——应用内浏览器默认就能被智能体驱动——但唯一的开关藏在
 * dev-only 的 CDP 设置里，普通用户根本不知道它存在，更不知道怎么关。这里把
 * 同一个配置（cdp.config.json 的 enabled）以产品语言暴露出来：关掉立即生效
 * （桥拒绝所有命令，无需重启），重新打开时若桥没在运行才需要重启。
 *
 * The master switch for agent browser control, visible in production. The
 * capability has always existed — the in-app browser is drivable by default —
 * but its only toggle lived in the dev-only CDP section, so regular users never
 * learned it exists or how to turn it off. This surfaces the same config
 * (cdp.config.json `enabled`) in product language: turning it off applies
 * immediately (the bridge refuses commands, no restart), while turning it on
 * needs a restart only when the bridge is not running.
 */
const AgentBrowserControlSection: React.FC = () => {
  const { t } = useTranslation();
  const isDesktop = isElectronDesktop();
  const { data: cdpStatus } = useSWR(isDesktop ? 'cdp.status' : null, () =>
    ipcBridge.application.getCdpStatus.invoke()
  );
  const [switchLoading, setSwitchLoading] = useState(false);

  if (!isDesktop || !cdpStatus?.data) return null;

  const status = cdpStatus.data;
  const checked = status.agentControl;

  const handleToggle = async (next: boolean) => {
    setSwitchLoading(true);
    try {
      const result = await ipcBridge.application.updateCdpConfig.invoke({ enabled: next });
      if (result.success) {
        Message.success(t('settings.agentBrowser.saved'));
        await mutate('cdp.status');
      } else {
        Message.error(result.msg || t('settings.agentBrowser.saveFailed'));
      }
    } catch {
      Message.error(t('settings.agentBrowser.saveFailed'));
    } finally {
      setSwitchLoading(false);
    }
  };

  const handleRestart = async () => {
    try {
      const result = await ipcBridge.application.restart.invoke();
      notifyManualRestartRequired(result, t);
    } catch {
      Message.error(t('common.error'));
    }
  };

  // 桥没在运行而用户想打开：运行时闸已放行，但桥本身要重启才会起来。
  // The bridge is down while the user wants it on: the runtime gate is open, but
  // the bridge itself only comes up on restart.
  const needsRestart = !status.enabled && status.startupEnabled === false && checked === true;

  return (
    <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'>
      <div className='text-14px font-medium text-t-primary mb-8px'>{t('settings.agentBrowser.title')}</div>
      <PreferenceRow label={t('settings.agentBrowser.enable')} description={t('settings.agentBrowser.enableDesc')}>
        <Switch checked={checked} loading={switchLoading} onChange={handleToggle} />
      </PreferenceRow>
      {needsRestart && (
        <Alert
          type='warning'
          className='mt-8px'
          content={
            <div className='flex items-center justify-between gap-12px'>
              <span>{t('settings.agentBrowser.restartHint')}</span>
              <Button size='small' type='primary' onClick={handleRestart}>
                {t('settings.restartNow')}
              </Button>
            </div>
          }
        />
      )}
    </div>
  );
};

export default AgentBrowserControlSection;
