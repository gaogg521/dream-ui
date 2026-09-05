/**
 * Desktop enterprise onboarding — connect → sign in → join, ONE page.
 *
 * Reached from the sidebar identity pill (「登录 / 加入项目组」), from the
 * settings pages' login buttons, and back from the sso-callback deep link.
 * This used to be a bare login-channel picker while connecting lived on one
 * settings page and the invite-code form on another, each page pointing at
 * the other two — three entrances narrating one task (E6). The settings pages
 * keep status views and single-item edits; the narrative lives here and
 * nowhere else.
 *
 * Auth still happens in the system browser (credentials never enter the
 * Electron renderer — see enterpriseBrowserLogin.ts). A completed browser
 * login hands the token back via the deep link, which lands the app back on
 * this page with a session present, i.e. at step 3.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, AutoComplete, Button, Input, Message } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseModeEnabled,
  setEnterpriseModeEnabled,
} from '@/common/adapter/enterpriseMode';
import { DEPLOYMENT_ROLE_CHANGED_EVENT, normalizeEnterpriseServerUrl } from '@/common/config/webuiEnterpriseConfig';
import { ORG_CONTEXT_CHANGED_EVENT, useOrgContext } from './hooks/useOrgContext';
import { persistDeploymentServerUrl, useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import { probeRemoteEnterpriseServer } from '@renderer/pages/settings/components/EnterpriseDeploymentModeCard';
import EnterpriseLoginChannelPanel from './components/EnterpriseLoginChannelPanel';
import '@renderer/pages/login/LoginPage.css';

type Step = 1 | 2 | 3;

const STEPS: ReadonlyArray<{ step: Step; labelKey: string; labelDefault: string }> = [
  { step: 1, labelKey: 'common.enterprise.wizardStepConnect', labelDefault: '连接服务器' },
  { step: 2, labelKey: 'common.enterprise.wizardStepLogin', labelDefault: '登录' },
  { step: 3, labelKey: 'common.enterprise.wizardStepJoin', labelDefault: '加入项目组' },
];

const EnterpriseLoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { serverUrl: savedUrl, serverUrlHistory } = useDeploymentRole();
  // Org context decides what step 3 shows: joined (SSO auto-placed, or invite
  // accepted) vs still outside. Before a session exists the remote answers
  // 401 and `context` stays null — that is exactly the pre-step-3 state, and
  // the hook's error branch is never rendered here.
  const { context } = useOrgContext();

  const [connected, setConnected] = useState(isEnterpriseModeEnabled());
  // getEnterpriseSession() parses localStorage fresh every render and returns
  // a new object each time — depend on the boolean, never the object.
  const [hasSession, setHasSession] = useState(() => Boolean(getEnterpriseSession()));
  const [step, setStep] = useState<Step>(() => {
    if (!isEnterpriseModeEnabled()) return 1;
    if (!getEnterpriseSession()) return 2;
    return 3;
  });
  /**
   * Live reachability of the saved address, probed whenever step 1 shows the
   * connected summary. The mode flag alone lies: it stays `true` after the
   * server dies or the stored address goes stale (e.g. a history entry from
   * another environment), and step 1 then claimed 「已连接」 for a server that
   * answers nothing (N1). The channel panel's copy depends on the same truth.
   */
  const [probe, setProbe] = useState<'probing' | 'ok' | 'unreachable' | 'no-enterprise' | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);

  // Step 1 — address entry. A `?remote=` query (from the settings pages'
  // login buttons) prefills the field; the saved address is the next fallback.
  const [url, setUrl] = useState(() => searchParams.get('remote')?.trim() || '');
  const [connecting, setConnecting] = useState(false);

  // Step 3 — invite code.
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => document.body.classList.remove('login-page-active');
  }, []);

  // savedUrl arrives asynchronously (config service) — prefill once.
  useEffect(() => {
    setUrl((prev) => prev || savedUrl || '');
  }, [savedUrl]);

  // A browser login completed → the deep link reloads this page with a
  // session present. Advance to the join step when a session APPEARS — but
  // only on the false→true transition. A user who already has a session and
  // deliberately walked back to step 2 to re-login as someone else must not
  // be bounced forward again (the mount-time initial step covers the
  // reload-based deep-link arrival, so this is for in-place appearances).
  const prevHasSession = useRef(hasSession);
  useEffect(() => {
    if (hasSession && !prevHasSession.current && step === 2) setStep(3);
    prevHasSession.current = hasSession;
  }, [hasSession, step]);

  // Mirror a session arriving without a reload (defensive; the deep-link path
  // reloads the whole renderer).
  useEffect(() => {
    setHasSession(Boolean(getEnterpriseSession()));
  }, [step]);

  // Probe the saved address whenever step 1 shows the connected summary (and
  // again after edits), so 「已连接」 reflects a server that actually answers.
  useEffect(() => {
    if (step !== 1 || !connected || editingAddress) {
      setProbe(null);
      return;
    }
    const url = getEnterpriseServerUrl();
    if (!url) {
      setProbe(null);
      return;
    }
    let cancelled = false;
    setProbe('probing');
    void probeRemoteEnterpriseServer(url).then((result) => {
      if (cancelled) return;
      setProbe(result === 'ok' ? 'ok' : result === 'no-enterprise' ? 'no-enterprise' : 'unreachable');
    });
    return () => {
      cancelled = true;
    };
  }, [connected, editingAddress, step]);

  const stepLabel = (s: (typeof STEPS)[number]) => t(s.labelKey, { defaultValue: s.labelDefault });

  /** Step 1 = connect. Reuses the deployment card's probe so "type address →
   * connect" behaves identically in both places (single source of truth). */
  const handleConnect = async () => {
    const normalized = normalizeEnterpriseServerUrl(url);
    if (!normalized) {
      Message.warning(
        t('settings.webui.deployServerUrlInvalid', {
          defaultValue: '请输入有效的服务器地址，例如 192.168.1.10:25809',
        })
      );
      return;
    }
    setConnecting(true);
    try {
      await persistDeploymentServerUrl(normalized);
      const probe = await probeRemoteEnterpriseServer(normalized);
      if (probe === 'no-enterprise') {
        Message.error(
          t('common.enterprise.remoteEnterpriseNoModule', {
            defaultValue:
              '远端服务器未提供企业 API（/api/one/*）。请确认对方运行的是带企业模块的 One Work，而不是旧版或仅静态 WebUI。',
          })
        );
        return;
      }
      if (probe === 'unreachable') {
        Message.error(
          t('common.enterprise.remoteEnterpriseUnreachable', {
            defaultValue: '无法连接远端服务器，请检查地址、端口与防火墙后重试。',
          })
        );
        return;
      }
      setEnterpriseModeEnabled(true);
      window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
      setConnected(true);
      setEditingAddress(false);
      setProbe('ok');
      setStep(2);
    } finally {
      setConnecting(false);
    }
  };

  const handleJoin = async () => {
    const code = inviteCode.trim();
    if (!code) {
      Message.warning(t('common.enterprise.inviteCodeRequired', { defaultValue: '请输入邀请码' }));
      return;
    }
    setJoining(true);
    try {
      const tenant = await ipcBridge.oneOrg.join.invoke({ code });
      Message.success(
        t('common.enterprise.joinSuccess', {
          name: tenant?.tenantName ?? '',
          defaultValue: '已加入企业 {{name}}',
        })
      );
      setInviteCode('');
      window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
    } catch (e) {
      // The join may have succeeded even though the call threw (SSO already
      // provisioned the membership, or a racing duplicate consumed the code).
      // Re-check before showing an error — same reconciliation as the
      // project-group page's join form.
      const maybeJoined = isBackendHttpError(e) && (e.code === 'ALREADY_IN_ENTERPRISE' || e.code === 'INVALID_CODE');
      if (maybeJoined) {
        try {
          const ctx = await ipcBridge.oneOrg.context.invoke();
          if (ctx?.isEnterprise) {
            Message.info(t('common.enterprise.joinAlready', { defaultValue: '您已加入该企业' }));
            setInviteCode('');
            window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
            return;
          }
        } catch {
          // Context re-check failed — fall through to the error path.
        }
      }
      const detail = isBackendHttpError(e) && e.backendMessage ? `: ${e.backendMessage}` : '';
      Message.error(t('common.enterprise.joinFailed', { defaultValue: '加入失败' }) + detail);
    } finally {
      setJoining(false);
    }
  };

  const remoteOrigin = getEnterpriseServerUrl() || searchParams.get('remote')?.replace(/\/+$/, '') || null;

  /** The address-entry form: used for the not-connected state AND for the
   * N1 flows (unreachable / no-enterprise / user pressed 修改地址). */
  const renderAddressInput = () => (
    <>
      <div className='text-13px text-t-secondary mb-8px'>
        {t('settings.webui.deployServerUrlLabel', { defaultValue: '项目组服务器地址' })}
      </div>
      <div className='flex gap-8px'>
        <AutoComplete
          value={url}
          onChange={setUrl}
          data={serverUrlHistory}
          placeholder={t('settings.webui.deployServerUrlPlaceholder', {
            defaultValue: '例如 192.168.1.10:25809',
          })}
          style={{ flex: 1 }}
        />
        <Button type='primary' loading={connecting} onClick={() => void handleConnect()}>
          {t('common.enterprise.wizardConnectButton', { defaultValue: '连接' })}
        </Button>
      </div>
      <div className='text-11px text-t-tertiary mt-8px'>
        {t('settings.webui.deployServerUrlHint', {
          defaultValue: '请填写含端口的完整地址（服务端端口可在服务器 WebUI 设置中查看）',
        })}
      </div>
      <Alert
        type='info'
        className='mt-12px'
        content={t('common.enterprise.wizardConnectHint', {
          defaultValue: '连接后，本机的会话、助手与个人数据仍留在本地，仅企业协作能力来自该服务器。',
        })}
      />
    </>
  );

  const renderStepIndicator = () => (
    <div className='flex items-center justify-center gap-8px mb-20px'>
      {STEPS.map((s, index) => {
        // Forward navigation unlocks when the prerequisite holds; going back
        // is always allowed. Step 2 stays reachable even when disconnected:
        // that is the fallback where「本地账户」opens the LOCAL WebUI login
        // (personal / server mode must keep that path, see red line 3), and
        // the channel panel explains the not-connected state itself.
        const reachable = s.step === 1 || s.step === 2 || (s.step === 3 && connected && hasSession);
        const active = step === s.step;
        return (
          <React.Fragment key={s.step}>
            {index > 0 && <span className='text-t-tertiary'>—</span>}
            <button
              type='button'
              onClick={() => reachable && setStep(s.step)}
              className='flex items-center gap-4px px-8px py-2px rd-6px'
              style={{
                border: '1px solid var(--color-border-2)',
                background: active ? 'var(--color-fill-2)' : 'transparent',
                cursor: reachable ? 'pointer' : 'default',
                opacity: reachable ? 1 : 0.45,
              }}
            >
              <span className='text-12px text-t-secondary'>{s.step}</span>
              <span className={`text-13px ${active ? 'font-600 text-t-primary' : 'text-t-secondary'}`}>
                {stepLabel(s)}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div className='login-page'>
      <div className='login-page__card' style={{ maxWidth: 560 }}>
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
            {t('common.enterprise.wizardSubtitle', { defaultValue: '连接企业服务器 → 登录 → 加入项目组' })}
          </p>
        </div>
        {renderStepIndicator()}

        {step === 1 && (
          <div>
            {connected && !editingAddress ? (
              <>
                {probe === 'probing' && (
                  <Alert
                    type='info'
                    className='mb-12px'
                    title={t('common.enterprise.wizardProbingTitle', { defaultValue: '正在检查与服务器的连接…' })}
                  />
                )}
                {probe === 'ok' && (
                  <>
                    <Alert
                      type='success'
                      className='mb-12px'
                      title={t('common.enterprise.wizardConnectedTitle', { defaultValue: '已连接企业服务器' })}
                      content={getEnterpriseServerUrl() ?? ''}
                    />
                    <div className='flex justify-center gap-8px'>
                      <Button type='primary' onClick={() => setStep(2)}>
                        {t('common.enterprise.wizardNextLogin', { defaultValue: '下一步：登录' })}
                      </Button>
                      <Button onClick={() => setEditingAddress(true)}>
                        {t('common.enterprise.wizardEditAddress', { defaultValue: '修改地址' })}
                      </Button>
                    </div>
                  </>
                )}
                {(probe === 'unreachable' || probe === 'no-enterprise') && (
                  <>
                    {/* The mode flag said connected but the address does not
                        answer (or answers without the enterprise API) — say
                        THAT, not 「已连接」, and drop the user straight into
                        the address editor (N1). */}
                    <Alert
                      type='warning'
                      className='mb-12px'
                      title={
                        probe === 'unreachable'
                          ? t('common.enterprise.wizardAddressUnreachableTitle', {
                              defaultValue: '保存的服务器地址连不上',
                            })
                          : t('common.enterprise.wizardAddressNoEnterpriseTitle', {
                              defaultValue: '该地址没有提供企业 API',
                            })
                      }
                      content={
                        (getEnterpriseServerUrl() ?? '') +
                        ' — ' +
                        (probe === 'unreachable'
                          ? t('common.enterprise.wizardAddressUnreachableHint', {
                              defaultValue: '请检查服务器是否在线、地址与端口是否正确，修改后重新连接。',
                            })
                          : t('common.enterprise.wizardAddressNoEnterpriseHint', {
                              defaultValue: '对方可能运行的是不带企业模块的版本，请确认地址或联系管理员。',
                            }))
                      }
                    />
                    {renderAddressInput()}
                  </>
                )}
              </>
            ) : (
              renderAddressInput()
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            {!connected && (
              <Alert
                type='warning'
                className='mb-12px'
                content={t('common.enterprise.wizardLoginNeedsConnect', {
                  defaultValue: '请先完成第一步，连接项目组服务器。',
                })}
              />
            )}
            <EnterpriseLoginChannelPanel remoteOrigin={remoteOrigin} oauthRedirect='/enterprise/login' />
            {hasSession && (
              <div className='flex justify-center mt-12px'>
                <Button type='primary' onClick={() => setStep(3)}>
                  {t('common.enterprise.wizardNextJoin', { defaultValue: '下一步：加入项目组' })}
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            {context?.isEnterprise ? (
              <>
                <Alert
                  type='success'
                  className='mb-12px'
                  title={t('common.enterprise.wizardJoinedTitle', { defaultValue: '已加入项目组' })}
                  content={context.tenantName ?? context.tenantId ?? ''}
                />
                <div className='flex justify-center'>
                  <Button type='primary' onClick={() => navigate('/guid')}>
                    {t('common.enterprise.wizardFinish', { defaultValue: '完成' })}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className='text-13px text-t-secondary mb-8px'>
                  {t('common.enterprise.joinHint', { defaultValue: '输入管理员提供的邀请码加入企业。' })}
                </div>
                <div className='flex gap-8px'>
                  <Input
                    value={inviteCode}
                    onChange={setInviteCode}
                    placeholder={t('common.enterprise.inviteCodePlaceholder', { defaultValue: '邀请码' })}
                    style={{ flex: 1 }}
                  />
                  <Button type='primary' loading={joining} onClick={() => void handleJoin()}>
                    {t('common.enterprise.joinButton', { defaultValue: '加入' })}
                  </Button>
                </div>
                {!hasSession && (
                  <Alert
                    type='warning'
                    className='mt-12px'
                    content={t('common.enterprise.joinNeedsLoginOnlyHint', {
                      defaultValue: '已连接项目组服务器，还需先登录企业账号再加入。',
                    })}
                  />
                )}
              </>
            )}
          </div>
        )}

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
