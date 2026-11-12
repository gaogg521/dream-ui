/**
 * Copyright 2026 One Work
 */

import { Button, Message, Popconfirm, Switch, Tooltip } from '@arco-design/web-react';
import { Copy, Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WebuiTunnelController } from './useWebuiTunnel';

const STATE_COLOR: Record<string, string> = {
  connected: 'text-success',
  connecting: 'text-warning',
  error: 'text-danger',
};

/**
 * "Access from outside your network": one switch, the address, and what is
 * going on. Sits under the LAN switch in Settings → Remote connection.
 */
const WebuiTunnelSection: React.FC<{ tunnel: WebuiTunnelController; webuiRunning: boolean }> = ({
  tunnel,
  webuiRunning,
}) => {
  const { t } = useTranslation();
  const { status, enabled } = tunnel;

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!(await tunnel.setEnabled(checked))) Message.error(t('settings.webui.operationFailed'));
  };

  const handleReset = async (): Promise<void> => {
    if (!(await tunnel.resetAddress())) Message.error(t('settings.webui.operationFailed'));
  };

  const handleCopy = (text: string): void => {
    void navigator.clipboard.writeText(text);
    Message.success(t('common.copySuccess'));
  };

  const stateLabel = (): string | null => {
    if (!enabled) return null;
    if (!webuiRunning && status.state === 'off') return t('settings.webui.tunnelWaitingWebui');
    if (status.state === 'error') return t(`settings.webui.tunnelError.${status.error ?? 'register_failed'}`);
    if (status.state === 'connected') return t('settings.webui.tunnelConnected');
    if (status.state === 'connecting') return t('settings.webui.tunnelConnecting');
    return null;
  };

  const label = stateLabel();

  return (
    <div className='py-12px'>
      <div className='flex items-center justify-between gap-12px'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-8px'>
            <span className='text-14px text-t-primary'>{t('settings.webui.tunnelTitle')}</span>
            {label && <span className={`text-12px ${STATE_COLOR[status.state] ?? 'text-t-tertiary'}`}>{label}</span>}
          </div>
          <div className='text-12px text-t-tertiary mt-2px'>{t('settings.webui.tunnelDesc')}</div>
        </div>
        <Switch
          className='settings-switch-on'
          checked={enabled}
          loading={tunnel.busy}
          onChange={(checked) => void handleToggle(checked)}
        />
      </div>

      {enabled && status.url && (
        <div className='mt-8px flex items-center justify-between gap-8px rd-10px border border-line bg-fill-1 px-10px py-6px'>
          <span className='text-12px text-t-tertiary shrink-0'>{t('settings.webui.tunnelAddress')}</span>
          <div className='flex items-center gap-4px min-w-0'>
            <span className='text-13px text-t-primary font-mono truncate'>{status.url}</span>
            <Tooltip content={t('common.copy')}>
              <Button
                type='text'
                size='mini'
                className='rd-100px !px-6px inline-flex items-center !h-24px'
                onClick={() => handleCopy(status.url as string)}
              >
                <Copy size={14} />
              </Button>
            </Tooltip>
            <Popconfirm
              title={t('settings.webui.tunnelResetConfirm')}
              onOk={() => void handleReset()}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <Tooltip content={t('settings.webui.tunnelResetAddress')}>
                <Button type='text' size='mini' className='rd-100px !px-6px inline-flex items-center !h-24px'>
                  <Refresh size={14} />
                </Button>
              </Tooltip>
            </Popconfirm>
          </div>
        </div>
      )}

      {enabled && <div className='text-12px text-t-tertiary mt-8px'>{t('settings.webui.tunnelSecurityHint')}</div>}
    </div>
  );
};

export default WebuiTunnelSection;
