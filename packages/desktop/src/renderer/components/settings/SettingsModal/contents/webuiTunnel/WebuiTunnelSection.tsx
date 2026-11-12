/**
 * Copyright 2026 One Work
 */

import { Button, Message, Popconfirm, Switch, Tooltip } from '@arco-design/web-react';
import { Copy, Earth, Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsCard, { type CardStatus } from './SettingsCard';
import type { WebuiTunnelController } from './useWebuiTunnel';

/**
 * "Access from outside your network": its own card with the switch, what is going on, and the
 * address. `footer` carries the secondary way in (the butler's temporary public link).
 */
const WebuiTunnelSection: React.FC<{
  tunnel: WebuiTunnelController;
  webuiRunning: boolean;
  footer?: React.ReactNode;
}> = ({ tunnel, webuiRunning, footer }) => {
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

  const cardStatus = (): CardStatus => {
    if (!enabled) return { tone: 'neutral', text: t('settings.webui.statusOff') };
    if (!webuiRunning && status.state === 'off') {
      return { tone: 'warning', text: t('settings.webui.tunnelWaitingWebui') };
    }
    switch (status.state) {
      case 'connected':
        return { tone: 'success', text: t('settings.webui.tunnelConnected').replace(/^✓\s*/, '') };
      case 'connecting':
        return { tone: 'warning', text: t('settings.webui.tunnelConnecting') };
      case 'error': {
        const reasons = {
          no_binary: t('settings.webui.tunnelError.no_binary'),
          register_failed: t('settings.webui.tunnelError.register_failed'),
          rejected: t('settings.webui.tunnelError.rejected'),
          spawn_failed: t('settings.webui.tunnelError.spawn_failed'),
        };
        return { tone: 'danger', text: reasons[status.error ?? 'register_failed'] };
      }
      default:
        return { tone: 'neutral', text: t('settings.webui.statusOff') };
    }
  };

  const showDetails = enabled && (Boolean(status.url) || Boolean(footer));

  return (
    <SettingsCard
      data-testid='webui-tunnel-card'
      icon={<Earth theme='outline' size='20' />}
      title={t('settings.webui.tunnelTitle')}
      description={t('settings.webui.tunnelDesc')}
      status={cardStatus()}
      action={
        <Switch
          className='settings-switch-on'
          checked={enabled}
          loading={tunnel.busy}
          onChange={(checked) => void handleToggle(checked)}
        />
      }
    >
      {showDetails && (
        <div className='space-y-10px'>
          {status.url && (
            <div className='flex items-center justify-between gap-8px rd-10px border border-line bg-fill-1 px-12px py-8px'>
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
          {enabled && (
            <div className='text-12px leading-18px text-t-tertiary'>{t('settings.webui.tunnelSecurityHint')}</div>
          )}
          {footer}
        </div>
      )}
      {!showDetails && footer}
    </SettingsCard>
  );
};

export default WebuiTunnelSection;
