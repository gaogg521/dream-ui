/**
 * Onboarding settings (P2-4): domain-based auto-join + reserved SMTP config.
 *
 * Both are "底层适配" — the config store + entry points are real and wired,
 * but no SMTP client library ships in this crate (mirrors the payment-provider
 * seam in BillingTab). An operator with real SMTP credentials fills them in
 * here; sending stays "not configured" until a real `EmailSender` is dropped
 * in at the app layer.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, InputNumber, Message, Switch, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { SmtpConfig } from '@/common/types/org/orgTypes';

const OnboardingTab: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);

  // Domain auto-join. `savedDomains` mirrors the server's persisted value —
  // kept separate from `domainsInput` (the draft text field) so the status
  // tag reflects what's actually enforced, not whatever the admin is
  // mid-typing and hasn't saved yet.
  const [domainsInput, setDomainsInput] = useState('');
  const [savedDomains, setSavedDomains] = useState<string[]>([]);
  const [savingDomains, setSavingDomains] = useState(false);

  // Reserved SMTP config.
  const [smtp, setSmtp] = useState<SmtpConfig | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number | undefined>(587);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [domains, cfg] = await Promise.all([
        ipcBridge.oneAdmin.getAllowedDomains.invoke(),
        ipcBridge.oneAdmin.getSmtpConfig.invoke(),
      ]);
      setDomainsInput((domains ?? []).join(', '));
      setSavedDomains(domains ?? []);
      setSmtp(cfg ?? null);
      setHost(cfg?.host ?? '');
      setPort(cfg?.port ?? 587);
      setUsername(cfg?.username ?? '');
      setFromAddress(cfg?.fromAddress ?? '');
      setEnabled(cfg?.enabled ?? false);
    } catch (error) {
      Message.error(t('common.onboarding.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(error));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSaveDomains = async () => {
    setSavingDomains(true);
    try {
      const domains = domainsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await ipcBridge.oneAdmin.setAllowedDomains.invoke({ domains });
      setSavedDomains(domains);
      Message.success(t('common.onboarding.domainsSaved', { defaultValue: '已保存' }));
    } catch (error) {
      Message.error(t('common.onboarding.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSavingDomains(false);
    }
  };

  const handleSaveSmtp = async () => {
    setSavingSmtp(true);
    try {
      const next = await ipcBridge.oneAdmin.setSmtpConfig.invoke({
        host,
        port: port ?? 587,
        username: username || undefined,
        password: password || undefined,
        fromAddress,
        enabled,
      });
      setSmtp(next);
      setPassword('');
      Message.success(t('common.onboarding.smtpSaved', { defaultValue: '已保存' }));
    } catch (error) {
      Message.error(t('common.onboarding.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSavingSmtp(false);
    }
  };

  return (
    <div className='flex flex-col gap-16px'>
      <Card
        title={t('common.onboarding.domainsTitle', { defaultValue: '域名自动入伙' })}
        loading={loading}
        extra={
          <Tag size='small' color={savedDomains.length > 0 ? 'green' : 'gray'}>
            {savedDomains.length > 0
              ? t('common.onboarding.domainsOn', { defaultValue: '已启用' })
              : t('common.onboarding.domainsOff', { defaultValue: '未启用' })}
          </Tag>
        }
      >
        <div className='mb-8px text-12px text-t-tertiary'>
          {t('common.onboarding.domainsHint', {
            defaultValue: '邮箱域名匹配的新成员通过 SSO 登录时自动加入本项目组，无需邀请码。留空表示关闭。',
          })}
        </div>
        <div className='flex items-center gap-8px'>
          <Input
            value={domainsInput}
            onChange={setDomainsInput}
            placeholder='acme.com, acme.io'
            style={{ maxWidth: 420 }}
          />
          <Button type='primary' size='small' loading={savingDomains} onClick={() => void handleSaveDomains()}>
            {t('common.save', { defaultValue: '保存' })}
          </Button>
        </div>
      </Card>

      <Card
        title={t('common.onboarding.smtpTitle', { defaultValue: '邀请邮件（SMTP，预留）' })}
        loading={loading}
        extra={
          <Tag size='small' color={smtp?.enabled ? 'green' : 'gray'}>
            {smtp?.enabled
              ? t('common.onboarding.smtpEnabled', { defaultValue: '已启用' })
              : t('common.onboarding.smtpDisabled', { defaultValue: '未启用' })}
          </Tag>
        }
      >
        <div className='mb-12px text-12px text-t-tertiary'>
          {t('common.onboarding.smtpHint', {
            defaultValue:
              '保存配置本身不会真正发送邮件——尚未接入 SMTP 客户端。这里预留了配置项与入口，接入后即可直接使用。',
          })}
        </div>
        <div className='grid gap-12px' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <div className='text-t-secondary text-12px mb-4px'>
              {t('common.onboarding.smtpHost', { defaultValue: 'SMTP 服务器' })}
            </div>
            <Input value={host} onChange={setHost} placeholder='smtp.example.com' />
          </div>
          <div>
            <div className='text-t-secondary text-12px mb-4px'>
              {t('common.onboarding.smtpPort', { defaultValue: '端口' })}
            </div>
            <InputNumber min={1} max={65535} value={port} onChange={(v) => setPort(v ?? undefined)} />
          </div>
          <div>
            <div className='text-t-secondary text-12px mb-4px'>
              {t('common.onboarding.smtpUsername', { defaultValue: '用户名' })}
            </div>
            <Input value={username} onChange={setUsername} />
          </div>
          <div>
            <div className='text-t-secondary text-12px mb-4px'>
              {t('common.onboarding.smtpPassword', { defaultValue: '密码' })}
            </div>
            <Input.Password
              value={password}
              onChange={setPassword}
              placeholder={
                smtp?.hasPassword
                  ? t('common.onboarding.smtpPasswordKeep', { defaultValue: '留空保持不变' })
                  : undefined
              }
            />
          </div>
          <div>
            <div className='text-t-secondary text-12px mb-4px'>
              {t('common.onboarding.smtpFromAddress', { defaultValue: '发件地址' })}
            </div>
            <Input value={fromAddress} onChange={setFromAddress} placeholder='noreply@example.com' />
          </div>
          <div className='flex items-end gap-8px'>
            <Switch checked={enabled} onChange={setEnabled} />
            <span className='text-12px text-t-secondary'>
              {t('common.onboarding.smtpEnable', { defaultValue: '启用' })}
            </span>
          </div>
        </div>
        <Button
          type='primary'
          size='small'
          className='mt-12px'
          loading={savingSmtp}
          onClick={() => void handleSaveSmtp()}
        >
          {t('common.save', { defaultValue: '保存' })}
        </Button>
      </Card>
    </div>
  );
};

export default OnboardingTab;
