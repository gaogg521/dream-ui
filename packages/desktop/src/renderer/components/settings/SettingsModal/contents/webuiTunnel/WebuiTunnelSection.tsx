/**
 * Copyright 2026 One Work
 */

import { Button, Message, Modal, Popconfirm, Switch, Tooltip } from '@arco-design/web-react';
import { Copy, Earth, Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsCard, { type CardStatus } from './SettingsCard';
import type { WebuiTunnelController } from './useWebuiTunnel';

/**
 * The fixed way in from outside the LAN: its own card with the switch, what is going on, and the
 * address that stays the same. The temporary link is the card next to it (`TempAccessCard`).
 */
const WebuiTunnelSection: React.FC<{
  tunnel: WebuiTunnelController;
  webuiRunning: boolean;
}> = ({ tunnel, webuiRunning }) => {
  const { t } = useTranslation();
  const { status, enabled } = tunnel;
  const [modal, modalContextHolder] = Modal.useModal();

  const enable = async (installConsent: boolean): Promise<void> => {
    if (!(await tunnel.setEnabled(true, installConsent))) Message.error(t('settings.webui.operationFailed'));
  };

  // The frpc component is not in the installer (antivirus flags it), so the first switch-on has to
  // say what is about to be downloaded and why a scanner may complain about it.
  const askInstallConsent = (): void => {
    modal.confirm({
      title: t('settings.webui.tunnelInstallTitle'),
      content: t('settings.webui.tunnelInstallContent'),
      okText: t('settings.webui.tunnelInstallOk'),
      cancelText: t('common.cancel'),
      // Closes at once: the download can take a while and its progress shows on the card itself.
      onOk: () => {
        void enable(true);
      },
    });
  };

  const handleToggle = async (checked: boolean): Promise<void> => {
    if (!checked) {
      if (!(await tunnel.setEnabled(false))) Message.error(t('settings.webui.operationFailed'));
      return;
    }
    if (status.componentReady === false) {
      askInstallConsent();
      return;
    }
    await enable(false);
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
      case 'installing':
        return { tone: 'warning', text: t('settings.webui.tunnelInstalling') };
      case 'connected':
        return { tone: 'success', text: t('settings.webui.tunnelConnected').replace(/^✓\s*/, '') };
      case 'connecting':
        return { tone: 'warning', text: t('settings.webui.tunnelConnecting') };
      case 'error': {
        const reasons = {
          needs_install: t('settings.webui.tunnelError.needs_install'),
          download_failed: t('settings.webui.tunnelError.download_failed'),
          blocked: t('settings.webui.tunnelError.blocked'),
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

  const showDetails = enabled && Boolean(status.url);
  const needsComponent =
    enabled &&
    status.state === 'error' &&
    (status.error === 'needs_install' || status.error === 'download_failed' || status.error === 'blocked');

  return (
    <>
      {modalContextHolder}
      <SettingsCard
        data-testid='webui-tunnel-card'
        className='h-full'
        icon={<Earth theme='outline' size='20' />}
        title={t('settings.webui.tunnelTitle')}
        badge={t('settings.webui.fixedTag')}
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
        {needsComponent && (
          <div className='mb-10px'>
            <Button
              size='small'
              type='primary'
              loading={tunnel.busy}
              // First ask (no component yet) needs consent; a retry after a failed download already has it.
              onClick={() => (status.error === 'needs_install' ? askInstallConsent() : void enable(true))}
            >
              {status.error === 'needs_install'
                ? t('settings.webui.tunnelInstallOk')
                : t('settings.webui.tunnelInstallRetry')}
            </Button>
          </div>
        )}
        {showDetails && (
          <div className='space-y-10px'>
            {status.url && (
              <div className='flex flex-wrap items-center justify-between gap-8px rd-10px border border-line bg-fill-1 px-12px py-8px'>
                <span className='text-12px text-t-tertiary shrink-0'>{t('settings.webui.tunnelAddress')}</span>
                <div className='flex items-center gap-4px min-w-0 flex-1 justify-end'>
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
          </div>
        )}
      </SettingsCard>
    </>
  );
};

export default WebuiTunnelSection;
