/**
 * Platform infrastructure config (P1-3 container runtime + P2-2 realtime
 * collaboration).
 *
 * Same "底层适配" shape as OnboardingTab's SMTP card and IntegrationsTab: the
 * config store + entry points are real and wired, but no container client or
 * collaboration backend ships in this crate. An admin fills in the config here;
 * a "probe" reports `not_configured` until a real `ContainerRuntime` /
 * `CollaborationProvider` is dropped in at the backend app layer.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Message, Select, Switch, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  CollaborationConfig,
  ContainerConfig,
  IpAllowlistConfig,
  PlatformProbeResult,
  SiemConfig,
} from '@/common/types/org/orgTypes';

/** Route a probe result to the matching Arco message channel. */
const showProbe = (result: PlatformProbeResult) => {
  if (result.status === 'ok') Message.success(result.message);
  else if (result.status === 'error') Message.error(result.message);
  else Message.info(result.message); // not_configured — reserved-adapter default
};

const ContainerCard: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<ContainerConfig | null>(null);
  const [runtimeKind, setRuntimeKind] = useState('docker');
  const [endpoint, setEndpoint] = useState('');
  const [defaultImage, setDefaultImage] = useState('');
  const [registry, setRegistry] = useState('');
  const [registrySecret, setRegistrySecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await ipcBridge.oneAdmin.getContainerConfig.invoke();
      setSaved(cfg ?? null);
      setRuntimeKind(cfg?.runtimeKind ?? 'docker');
      setEndpoint(cfg?.endpoint ?? '');
      setDefaultImage(cfg?.defaultImage ?? '');
      setRegistry(cfg?.registry ?? '');
      setEnabled(cfg?.enabled ?? false);
    } catch (e) {
      Message.error(t('common.platform.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = await ipcBridge.oneAdmin.setContainerConfig.invoke({
        runtimeKind,
        endpoint: endpoint || undefined,
        defaultImage: defaultImage || undefined,
        registry: registry || undefined,
        registrySecret: registrySecret || undefined,
        enabled,
      });
      setSaved(next);
      setRegistrySecret('');
      Message.success(t('common.platform.saved', { defaultValue: '已保存' }));
    } catch (e) {
      Message.error(t('common.platform.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      showProbe(await ipcBridge.oneAdmin.probeContainer.invoke());
    } catch (e) {
      Message.error(t('common.platform.probeFailed', { defaultValue: '探测失败' }) + ': ' + String(e));
    } finally {
      setProbing(false);
    }
  };

  return (
    <Card
      title={t('common.platform.containerTitle', { defaultValue: '容器运行时（预留）' })}
      loading={loading}
      extra={
        <Tag size='small' color={saved?.enabled ? 'green' : 'gray'}>
          {saved?.enabled
            ? t('common.platform.enabled', { defaultValue: '已启用' })
            : t('common.platform.disabled', { defaultValue: '未启用' })}
        </Tag>
      }
    >
      <div className='mb-12px text-12px text-t-tertiary'>
        {t('common.platform.containerHint', {
          defaultValue: '保存配置本身不会真正在容器里运行——尚未接入容器客户端。预留配置项，接入后即可直接使用。',
        })}
      </div>
      <div className='grid gap-12px' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.runtimeKind', { defaultValue: '运行时类型' })}
          </div>
          <Select
            value={runtimeKind}
            onChange={(v) => setRuntimeKind(String(v))}
            options={[
              { label: 'Docker', value: 'docker' },
              { label: 'Kubernetes', value: 'kubernetes' },
              { label: t('common.platform.runtimeNone', { defaultValue: '不使用' }), value: 'none' },
            ]}
          />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.endpoint', { defaultValue: '服务端点' })}
          </div>
          <Input value={endpoint} onChange={setEndpoint} placeholder='unix:///var/run/docker.sock' />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.defaultImage', { defaultValue: '默认镜像' })}
          </div>
          <Input value={defaultImage} onChange={setDefaultImage} placeholder='ghcr.io/acme/agent:latest' />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.registry', { defaultValue: '镜像仓库' })}
          </div>
          <Input value={registry} onChange={setRegistry} placeholder='ghcr.io' />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.registrySecret', { defaultValue: '仓库凭据' })}
          </div>
          <Input.Password
            value={registrySecret}
            onChange={setRegistrySecret}
            placeholder={
              saved?.hasRegistrySecret
                ? t('common.platform.secretKeep', { defaultValue: '留空保持不变' })
                : t('common.platform.secretPlaceholder', { defaultValue: '输入凭据' })
            }
          />
        </div>
      </div>
      <div className='mt-12px flex items-center gap-8px'>
        <Switch checked={enabled} onChange={setEnabled} />
        <span className='text-12px text-t-secondary'>{t('common.platform.enable', { defaultValue: '启用' })}</span>
        <div className='flex-1' />
        <Button size='small' loading={probing} onClick={() => void handleProbe()}>
          {t('common.platform.probe', { defaultValue: '探测' })}
        </Button>
        <Button type='primary' size='small' loading={saving} onClick={() => void handleSave()}>
          {t('common.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </Card>
  );
};

const CollaborationCard: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<CollaborationConfig | null>(null);
  const [provider, setProvider] = useState('builtin');
  const [endpoint, setEndpoint] = useState('');
  const [secret, setSecret] = useState('');
  const [presence, setPresence] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await ipcBridge.oneAdmin.getCollaborationConfig.invoke();
      setSaved(cfg ?? null);
      setProvider(cfg?.provider ?? 'builtin');
      setEndpoint(cfg?.endpoint ?? '');
      setPresence(cfg?.presence ?? false);
      setEnabled(cfg?.enabled ?? false);
    } catch (e) {
      Message.error(t('common.platform.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = await ipcBridge.oneAdmin.setCollaborationConfig.invoke({
        provider,
        endpoint: endpoint || undefined,
        secret: secret || undefined,
        presence,
        enabled,
      });
      setSaved(next);
      setSecret('');
      Message.success(t('common.platform.saved', { defaultValue: '已保存' }));
    } catch (e) {
      Message.error(t('common.platform.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      showProbe(await ipcBridge.oneAdmin.probeCollaboration.invoke());
    } catch (e) {
      Message.error(t('common.platform.probeFailed', { defaultValue: '探测失败' }) + ': ' + String(e));
    } finally {
      setProbing(false);
    }
  };

  return (
    <Card
      title={t('common.platform.collabTitle', { defaultValue: '实时协作（预留）' })}
      loading={loading}
      extra={
        <Tag size='small' color={saved?.enabled ? 'green' : 'gray'}>
          {saved?.enabled
            ? t('common.platform.enabled', { defaultValue: '已启用' })
            : t('common.platform.disabled', { defaultValue: '未启用' })}
        </Tag>
      }
    >
      <div className='mb-12px text-12px text-t-tertiary'>
        {t('common.platform.collabHint', {
          defaultValue: '保存配置本身不会真正开启实时协作——尚未接入协作后端。预留配置项，接入后即可直接使用。',
        })}
      </div>
      <div className='grid gap-12px' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.collabProvider', { defaultValue: '协作后端' })}
          </div>
          <Select
            value={provider}
            onChange={(v) => setProvider(String(v))}
            options={[
              { label: t('common.platform.collabBuiltin', { defaultValue: '内置' }), value: 'builtin' },
              { label: t('common.platform.collabExternal', { defaultValue: '外部服务' }), value: 'external' },
              { label: t('common.platform.runtimeNone', { defaultValue: '不使用' }), value: 'none' },
            ]}
          />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.endpoint', { defaultValue: '服务端点' })}
          </div>
          <Input value={endpoint} onChange={setEndpoint} placeholder='wss://collab.example.com' />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.collabSecret', { defaultValue: '接入凭据' })}
          </div>
          <Input.Password
            value={secret}
            onChange={setSecret}
            placeholder={
              saved?.hasSecret
                ? t('common.platform.secretKeep', { defaultValue: '留空保持不变' })
                : t('common.platform.secretPlaceholder', { defaultValue: '输入凭据' })
            }
          />
        </div>
      </div>
      <div className='mt-12px flex items-center gap-8px'>
        <Switch checked={presence} onChange={setPresence} />
        <span className='text-12px text-t-secondary'>
          {t('common.platform.presence', { defaultValue: '在线状态/光标同步' })}
        </span>
        <Switch checked={enabled} onChange={setEnabled} className='ml-16px' />
        <span className='text-12px text-t-secondary'>{t('common.platform.enable', { defaultValue: '启用' })}</span>
        <div className='flex-1' />
        <Button size='small' loading={probing} onClick={() => void handleProbe()}>
          {t('common.platform.probe', { defaultValue: '探测' })}
        </Button>
        <Button type='primary' size='small' loading={saving} onClick={() => void handleSave()}>
          {t('common.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </Card>
  );
};

const IpAllowlistCard: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<IpAllowlistConfig | null>(null);
  const [cidrsText, setCidrsText] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkIp, setCheckIp] = useState('');
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await ipcBridge.oneAdmin.getIpAllowlist.invoke();
      setSaved(cfg ?? null);
      setCidrsText((cfg?.cidrs ?? []).join('\n'));
      setEnabled(cfg?.enabled ?? false);
    } catch (e) {
      Message.error(t('common.platform.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const parseCidrs = (): string[] =>
    cidrsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = await ipcBridge.oneAdmin.setIpAllowlist.invoke({ cidrs: parseCidrs(), enabled });
      setSaved(next);
      Message.success(t('common.platform.saved', { defaultValue: '已保存' }));
    } catch (e) {
      Message.error(t('common.platform.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCheck = async () => {
    if (!checkIp.trim()) return;
    setChecking(true);
    try {
      const { allowed } = await ipcBridge.oneAdmin.checkIpAllowlist.invoke({ ip: checkIp.trim() });
      if (allowed) Message.success(t('common.platform.ipAllowed', { defaultValue: '该 IP 允许访问' }));
      else Message.warning(t('common.platform.ipBlocked', { defaultValue: '该 IP 将被拒绝' }));
    } catch (e) {
      Message.error(t('common.platform.checkFailed', { defaultValue: '检查失败' }) + ': ' + String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card
      title={t('common.platform.ipTitle', { defaultValue: 'IP 白名单（预留）' })}
      loading={loading}
      extra={
        <Tag size='small' color={saved?.enabled ? 'green' : 'gray'}>
          {saved?.enabled
            ? t('common.platform.enabled', { defaultValue: '已启用' })
            : t('common.platform.disabled', { defaultValue: '未启用' })}
        </Tag>
      }
    >
      <div className='mb-12px text-12px text-t-tertiary'>
        {t('common.platform.ipHint', {
          defaultValue:
            '限制可访问本项目组服务的 IP 段。保存配置本身不会阻断请求——阻断中间件为预留 drop-in（避免误锁）。每行一个 CIDR 或 IP。',
        })}
      </div>
      <Input.TextArea
        value={cidrsText}
        onChange={setCidrsText}
        placeholder={'10.0.0.0/8\n192.168.1.5\n2001:db8::/32'}
        autoSize={{ minRows: 3, maxRows: 8 }}
      />
      <div className='mt-12px flex items-center gap-8px flex-wrap'>
        <Input
          value={checkIp}
          onChange={setCheckIp}
          placeholder={t('common.platform.ipCheckPlaceholder', { defaultValue: '输入 IP 测试是否放行' })}
          style={{ width: 220 }}
        />
        <Button size='small' loading={checking} onClick={() => void handleCheck()}>
          {t('common.platform.ipCheck', { defaultValue: '测试' })}
        </Button>
        <div className='flex-1' />
        <Switch checked={enabled} onChange={setEnabled} />
        <span className='text-12px text-t-secondary'>{t('common.platform.enable', { defaultValue: '启用' })}</span>
        <Button type='primary' size='small' loading={saving} onClick={() => void handleSave()}>
          {t('common.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </Card>
  );
};

const SiemCard: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<SiemConfig | null>(null);
  const [kind, setKind] = useState('splunk');
  const [endpoint, setEndpoint] = useState('');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await ipcBridge.oneAdmin.getSiemConfig.invoke();
      setSaved(cfg ?? null);
      setKind(cfg?.kind ?? 'splunk');
      setEndpoint(cfg?.endpoint ?? '');
      setEnabled(cfg?.enabled ?? false);
    } catch (e) {
      Message.error(t('common.platform.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = await ipcBridge.oneAdmin.setSiemConfig.invoke({
        kind,
        endpoint: endpoint || undefined,
        secret: secret || undefined,
        enabled,
      });
      setSaved(next);
      setSecret('');
      Message.success(t('common.platform.saved', { defaultValue: '已保存' }));
    } catch (e) {
      Message.error(t('common.platform.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      showProbe(await ipcBridge.oneAdmin.probeSiem.invoke());
    } catch (e) {
      Message.error(t('common.platform.probeFailed', { defaultValue: '探测失败' }) + ': ' + String(e));
    } finally {
      setProbing(false);
    }
  };

  return (
    <Card
      title={t('common.platform.siemTitle', { defaultValue: 'SIEM 日志导出（预留）' })}
      loading={loading}
      extra={
        <Tag size='small' color={saved?.enabled ? 'green' : 'gray'}>
          {saved?.enabled
            ? t('common.platform.enabled', { defaultValue: '已启用' })
            : t('common.platform.disabled', { defaultValue: '未启用' })}
        </Tag>
      }
    >
      <div className='mb-12px text-12px text-t-tertiary'>
        {t('common.platform.siemHint', {
          defaultValue:
            '把审计日志转发到外部 SIEM（Splunk / syslog / HTTP）。保存配置本身不会真正转发——尚未接入导出器，接入后即可直接使用。',
        })}
      </div>
      <div className='grid gap-12px' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.siemKind', { defaultValue: '类型' })}
          </div>
          <Select
            value={kind}
            onChange={(v) => setKind(String(v))}
            options={[
              { label: 'Splunk (HEC)', value: 'splunk' },
              { label: 'Syslog', value: 'syslog' },
              { label: 'HTTP', value: 'http' },
              { label: t('common.platform.runtimeNone', { defaultValue: '不使用' }), value: 'none' },
            ]}
          />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.endpoint', { defaultValue: '服务端点' })}
          </div>
          <Input value={endpoint} onChange={setEndpoint} placeholder='https://splunk.example.com:8088' />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.platform.siemSecret', { defaultValue: '接入令牌' })}
          </div>
          <Input.Password
            value={secret}
            onChange={setSecret}
            placeholder={
              saved?.hasSecret
                ? t('common.platform.secretKeep', { defaultValue: '留空保持不变' })
                : t('common.platform.secretPlaceholder', { defaultValue: '输入凭据' })
            }
          />
        </div>
      </div>
      <div className='mt-12px flex items-center gap-8px'>
        <Switch checked={enabled} onChange={setEnabled} />
        <span className='text-12px text-t-secondary'>{t('common.platform.enable', { defaultValue: '启用' })}</span>
        <div className='flex-1' />
        <Button size='small' loading={probing} onClick={() => void handleProbe()}>
          {t('common.platform.probe', { defaultValue: '探测' })}
        </Button>
        <Button type='primary' size='small' loading={saving} onClick={() => void handleSave()}>
          {t('common.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </Card>
  );
};

const PlatformTab: React.FC = () => {
  return (
    <div className='flex flex-col gap-16px'>
      <ContainerCard />
      <CollaborationCard />
      <IpAllowlistCard />
      <SiemCard />
    </div>
  );
};

export default PlatformTab;
