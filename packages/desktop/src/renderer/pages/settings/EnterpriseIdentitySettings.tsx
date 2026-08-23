/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import EnterpriseIdentityCard from '@/renderer/pages/enterprise/components/EnterpriseIdentityCard';
import RemoteServerSection from '@/renderer/pages/enterprise/components/RemoteServerSection';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import { isElectronDesktop } from '@renderer/utils/platform';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const EnterpriseIdentitySettings: React.FC = () => {
  const { t } = useTranslation();
  const { isClient: isDeploymentClient, loading: deploymentLoading } = useDeploymentRole();
  // The remote connection carries the enterprise SSO login, so it belongs to
  // the identity page rather than the project-group page. Client mode only —
  // a server hosts its own data and has nothing to connect to.
  const showRemoteSection = isElectronDesktop() && !deploymentLoading && isDeploymentClient;

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex h-full flex-col'>
        <div className='flex items-center border-b border-border-2 px-16px py-12px'>
          <div className='text-16px font-600 text-t-primary'>
            {t('common.enterprise.identityTabTitle', { defaultValue: '企业身份' })}
          </div>
        </div>
        <div className='flex-1 overflow-auto p-16px'>
          {showRemoteSection && <RemoteServerSection />}
          <EnterpriseIdentityCard />
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default EnterpriseIdentitySettings;
