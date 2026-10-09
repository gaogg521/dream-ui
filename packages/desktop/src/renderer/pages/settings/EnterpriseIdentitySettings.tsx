/**
 * Copyright 2026 One Work
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EnterpriseIdentityCard from '@/renderer/pages/enterprise/components/EnterpriseIdentityCard';
import RemoteServerSection from '@/renderer/pages/enterprise/components/RemoteServerSection';
import { getEnterpriseSession, isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import { DEPLOYMENT_ROLE_CHANGED_EVENT } from '@/common/config/webuiEnterpriseConfig';
import { isElectronDesktop } from '@renderer/utils/platform';
import EnterpriseServerCard from './components/EnterpriseServerCard';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const EnterpriseIdentitySettings: React.FC = () => {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(isEnterpriseModeEnabled());
  const [hasSession, setHasSession] = useState(() => Boolean(getEnterpriseSession()));
  useEffect(() => {
    const sync = (): void => {
      setConnected(isEnterpriseModeEnabled());
      setHasSession(Boolean(getEnterpriseSession()));
    };
    window.addEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, sync);
  }, []);
  // Login and identity only mean something once a server is connected; before
  // that the page is just the connect card, not three cards of "未启用".
  const showRemoteSection = isElectronDesktop() && connected;

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex h-full flex-col'>
        <div className='flex items-center border-b border-2 px-16px py-12px'>
          <div className='text-16px font-600 text-t-primary'>
            {t('common.enterprise.identityTabTitle', { defaultValue: '企业身份' })}
          </div>
        </div>
        <div className='flex-1 overflow-auto p-16px'>
          {/* Ordered as the user actually proceeds: pick the server and
              connect to it, then log in against it. These used to sit on two
              different settings pages — the address on 远程连接, the login
              here — so someone who filled in an address had no visible next
              step and the SSO buttons stayed grey with no explanation. */}
          <EnterpriseServerCard />
          {showRemoteSection && <RemoteServerSection />}
          {/* Identity comes from a sign-in; before one there is only an error
              ("无法获取企业身份信息") to show. */}
          {connected && hasSession && <EnterpriseIdentityCard />}
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default EnterpriseIdentitySettings;
