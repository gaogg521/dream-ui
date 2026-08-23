/**
 * Sider nav entry for the Enterprise (org / admin console) page.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { BuildingOne } from '@icon-park/react';
import classNames from 'classnames';
import { isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

interface SiderEnterpriseEntryProps {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
}

const SiderEnterpriseEntry: React.FC<SiderEnterpriseEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  const label = t('common.enterprise.title', { defaultValue: '企业' });
  // Deployment-mode badge, always visible so the user knows at a glance whether
  // this instance is a client (connected to a remote enterprise server), the
  // server (this machine hosts the enterprise), or standalone (personal).
  const { context } = useOrgContext();
  const { role: deploymentRole } = useDeploymentRole();
  const mode: 'client' | 'server' | 'standalone' = isEnterpriseModeEnabled()
    ? 'client'
    : deploymentRole === 'client'
      ? 'client'
      : context?.isEnterprise
        ? 'server'
        : 'standalone';
  const modeLabel = {
    client: t('common.enterprise.modeClient', { defaultValue: '客户端' }),
    server: t('common.enterprise.modeServer', { defaultValue: '服务端' }),
    standalone: t('common.enterprise.modeStandalone', { defaultValue: '单机版' }),
  }[mode];
  const modeColor = {
    client: 'rgb(var(--primary-6))',
    server: 'rgb(var(--success-6))',
    standalone: 'var(--color-text-3)',
  }[mode];
  const tooltipContent = `${label} · ${modeLabel}`;

  if (collapsed) {
    return (
      <Tooltip {...siderTooltipProps} content={tooltipContent} position='right'>
        <div
          className={classNames(
            'relative w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary',
            isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
          )}
          onClick={onClick}
        >
          <BuildingOne
            theme='outline'
            size='20'
            fill='currentColor'
            className='block leading-none shrink-0'
            style={{ lineHeight: 0 }}
          />
          <span
            className='absolute top-6px right-6px w-6px h-6px rounded-999px'
            style={{ backgroundColor: modeColor }}
            aria-hidden='true'
          />
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip {...siderTooltipProps} content={tooltipContent} position='right'>
      <div
        className={classNames(
          'box-border group h-34px w-full flex items-center justify-start gap-8px pl-10px pr-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
          isMobile && 'sider-action-btn-mobile',
          isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
        )}
        onClick={onClick}
      >
        <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
          <BuildingOne
            theme='outline'
            size='16'
            fill='currentColor'
            className='block leading-none shrink-0'
            style={{ lineHeight: 0 }}
          />
        </span>
        <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>{label}</span>
        <span
          className='collapsed-hidden ml-auto shrink-0 text-10px font-500 leading-none px-6px py-2px rounded-999px'
          style={{ color: modeColor, backgroundColor: 'var(--color-fill-2)' }}
        >
          {modeLabel}
        </span>
      </div>
    </Tooltip>
  );
};

export default SiderEnterpriseEntry;
