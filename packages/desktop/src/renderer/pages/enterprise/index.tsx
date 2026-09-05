/**
 * Project-group (项目组) page — the desktop app's own enterprise surface.
 *
 * This page used to carry the admin tabs too (members, invites, org tree,
 * audit, runtime, integrations, platform). Those moved to the standalone admin
 * console (the `dream-en` repo), for two reasons: shipping them here put the
 * full management UI in every personal-edition install, and the only thing
 * standing between a member and that UI was a client-side role check.
 *
 * What remains is what a *member* legitimately does from their own machine:
 * see which project group they belong to, join one, create one, or leave. The
 * console entry point below hands administration off to the browser.
 */

import React from 'react';
import { Button, Message, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { isOrgAdminRole, useOrgContext } from './hooks/useOrgContext';
import { openAdminConsole } from '@renderer/utils/enterprise/enterpriseBrowserLogin';
import OverviewTab from './components/OverviewTab';

const EnterprisePage: React.FC = () => {
  const { t } = useTranslation();
  const { loading, context, error, unauthorized, refresh } = useOrgContext();
  const isProjectGroupAdmin = Boolean(context?.isEnterprise && isOrgAdminRole(context?.role));

  const openConsole = async () => {
    const ok = await openAdminConsole();
    if (!ok) {
      Message.warning(
        t('common.enterprise.loginWebuiRequired', {
          defaultValue: '无法打开浏览器登录页，请先在设置 → 远程连接 中启动 WebUI。',
        })
      );
    }
  };

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-b border-border-2 px-16px py-12px'>
        <div className='text-16px font-600 text-t-primary'>
          {t('common.enterprise.title', { defaultValue: '企业' })}
        </div>
        {isProjectGroupAdmin && (
          <Button type='primary' size='small' onClick={() => void openConsole()}>
            {t('common.enterprise.openConsole', { defaultValue: '进入企业管理后台' })}
          </Button>
        )}
      </div>
      <div className='flex-1 overflow-auto p-16px'>
        {/* "Connect to a remote server" is an enterprise-IDENTITY concern
            (browser SSO login / logout), not a project-group one, so it lives
            on /settings/enterprise-identity. The deployment role card
            (server/client) is neither tenant- nor company-scoped — it decides
            which machine's data this whole app defers to — so it lives on
            /settings/webui ("远程连接"). */}
        <Spin loading={loading}>
          <OverviewTab
            context={context}
            error={error}
            unauthorized={unauthorized}
            onChanged={() => void refresh()}
          />
        </Spin>
      </div>
    </div>
  );
};

export default EnterprisePage;
