/**
 * Desktop enterprise login — channel picker only; auth happens in the browser.
 */

import React, { useEffect, useMemo } from 'react';
import { Button } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import EnterpriseLoginChannelPanel from './components/EnterpriseLoginChannelPanel';
import '@renderer/pages/login/LoginPage.css';

const EnterpriseLoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => document.body.classList.remove('login-page-active');
  }, []);

  const { normalizedServerUrl } = useDeploymentRole();

  const remoteOrigin = useMemo(() => {
    const fromQuery = searchParams.get('remote')?.trim();
    if (fromQuery) return fromQuery.replace(/\/+$/, '');
    return getEnterpriseServerUrl() ?? normalizedServerUrl;
  }, [normalizedServerUrl, searchParams]);

  return (
    <div className='login-page'>
      <div className='login-page__card' style={{ maxWidth: 480 }}>
        <div className='mb-12px'>
          <Button type='text' icon={<Left theme='outline' size='16' />} onClick={() => navigate('/guid')}>
            {t('common.back', { defaultValue: '返回' })}
          </Button>
        </div>
        <div className='login-page__header'>
          <h1 className='login-page__title'>
            {t('common.enterprise.loginPageTitle', { defaultValue: '登录您的账户' })}
          </h1>
          <p className='login-page__subtitle'>
            {t('common.enterprise.loginPageSubtitle', { defaultValue: '管理您的会话与任务' })}
          </p>
        </div>
        <EnterpriseLoginChannelPanel remoteOrigin={remoteOrigin} oauthRedirect='/settings/enterprise' />
        <div className='login-page__footer'>
          <div className='login-page__footer-content'>
            <span>{t('login.footerPrimary', { defaultValue: '命令行 AI 的现代化体验' })}</span>
            <span className='login-page__footer-divider'>•</span>
            <span>{t('login.footerSecondary', { defaultValue: '高效且优雅' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnterpriseLoginPage;
