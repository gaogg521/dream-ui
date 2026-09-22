/**
 * Copyright 2026 One Work
 */

/**
 * The API-key form for the built-in `one-web-search` MCP.
 *
 * Why this exists at all: the plumbing to configure a search provider was
 * already complete — MCP stdio transports carry `env`, and the JSON import
 * dialog passes it straight through — but the only way to reach it was to paste
 * a JSON blob, which means knowing the env variable names by heart. The
 * capability was there; a person could not get to it.
 *
 * Keys and endpoints are written to the MCP entry's own `transport.env`.
 * Nothing new is persisted, so there is no second copy to keep in sync and no
 * new secret store to secure.
 *
 * The endpoint is shown, not hidden behind a constant. A vendor moving or
 * regionalising its API is not hypothetical — Agnes serves the same product
 * from `.com` and `.cn`, and code here that hardcoded one answered `401` for
 * every account issued on the other. With the field visible, that costs the
 * user an edit instead of a release.
 */

import { Button, Input, Link, Message, Radio, Select, Tag, Typography } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer } from '@/common/config/storage';
import {
  WEB_SEARCH_CUSTOM_DEFAULTS,
  WEB_SEARCH_CUSTOM_ENV,
  WEB_SEARCH_DEFAULT_ENV,
  WEB_SEARCH_PROVIDERS,
  configuredWebSearchProviders,
  hostedWebSearchEndpoint,
  type WebSearchProvider,
} from '@/common/webSearch/catalog';

type Props = {
  server: IMcpServer;
  onServerUpdated?: (next: IMcpServer) => void;
};

type TestState = { testing?: boolean; ok?: boolean; message?: string };

const readEnv = (server: IMcpServer): Record<string, string> =>
  server.transport.type === 'stdio' ? { ...server.transport.env } : {};

const WebSearchProviderConfig: React.FC<Props> = ({ server, onServerUpdated }) => {
  const { t } = useTranslation();
  const [env, setEnv] = useState<Record<string, string>>(() => readEnv(server));
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const groups = useMemo(
    () =>
      (['cn', 'global', 'custom'] as const).map((region) => ({
        region,
        label:
          region === 'cn'
            ? t('mcp.webSearch.regionCn')
            : region === 'global'
              ? t('mcp.webSearch.regionGlobal')
              : t('mcp.webSearch.regionCustom'),
        providers: WEB_SEARCH_PROVIDERS.filter((provider) => provider.region === region),
      })),
    [t]
  );

  /**
   * Providers usable right now — drives the radio and the enable decision.
   * Uses the catalog's own rule so the form and the MCP process cannot disagree
   * about what "configured" means (the custom entry also needs an endpoint).
   */
  const configured = useMemo(() => configuredWebSearchProviders(env), [env]);

  /**
   * Whether search already works with nothing filled in.
   *
   * The company broker holds a key and runs the search, so most users never
   * need this form at all — it is there for a higher limit, or for a provider
   * they prefer. Set by the main process on this MCP entry, so the answer here
   * is the same one the MCP process will act on.
   *
   * Deliberately NOT offered as a radio option: a user key always wins over the
   * hosted path, so a radio pointing at "built-in" while a key sat above it
   * would be a control that does not control anything.
   */
  const hostedAvailable = useMemo(() => !!hostedWebSearchEndpoint(env), [env]);

  /**
   * Which radio is filled in.
   *
   * The radios are deliberately NOT disabled for unconfigured providers: a
   * column of greyed-out options reads as "broken" and gives the user nothing
   * to act on, even when they are holding the key they are about to paste.
   * Picking one that is not ready is allowed and simply labelled as needing a
   * key — and a default that never gets one is dropped on save, with
   * `resolveWebSearchProvider` falling through to a provider that works.
   */
  const selected = env[WEB_SEARCH_DEFAULT_ENV] || configured[0]?.id;

  const setField = (key: string, value: string) =>
    setEnv((prev) => {
      const next = { ...prev, [key]: value };
      if (!value.trim()) delete next[key];
      return next;
    });

  const setKey = (provider: WebSearchProvider, value: string) =>
    setEnv((prev) => {
      const next = { ...prev, [provider.envKey]: value };
      if (!value.trim()) delete next[provider.envKey];
      // Clearing the key of the current default would otherwise leave the radio
      // pointing at a provider that can no longer run.
      if (!value.trim() && next[WEB_SEARCH_DEFAULT_ENV] === provider.id) delete next[WEB_SEARCH_DEFAULT_ENV];
      return next;
    });

  const handleTest = async (provider: WebSearchProvider) => {
    setTests((prev) => ({ ...prev, [provider.id]: { testing: true } }));
    try {
      const result = await ipcBridge.webSearch.test.invoke({
        providerId: provider.id,
        apiKey: env[provider.envKey] || '',
        baseUrl: env[provider.baseUrlEnvKey] || provider.defaultBaseUrl,
        options: env,
      });
      setTests((prev) => ({ ...prev, [provider.id]: { ok: result.ok, message: result.message } }));
    } catch (error) {
      setTests((prev) => ({
        ...prev,
        [provider.id]: { ok: false, message: error instanceof Error ? error.message : String(error) },
      }));
    }
  };

  const handleSave = async () => {
    if (server.transport.type !== 'stdio') return;
    setSaving(true);
    try {
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(env)) {
        if (value?.trim()) cleaned[key] = value.trim();
      }
      // A default that no longer has a key is worse than none: the MCP process
      // falls back to the first configured provider, so a stale value would
      // silently point the UI at one provider and searches at another.
      if (cleaned[WEB_SEARCH_DEFAULT_ENV] && !configured.some((p) => p.id === cleaned[WEB_SEARCH_DEFAULT_ENV])) {
        delete cleaned[WEB_SEARCH_DEFAULT_ENV];
      }

      const data = { transport: { ...server.transport, env: cleaned } };
      await mcpService.updateServer.invoke({ id: server.id, data });

      /**
       * `enabled` is NOT part of `updateServer` — the backend ignores it there
       * and only `toggleServer` moves it. Sending it in the update payload
       * looked like it worked (the form said "enabled", the keys saved) while
       * the entry stayed off, so the tool never loaded and search silently did
       * nothing. Measured on a real run; a mocked IPC cannot show this.
       *
       * Toggle is a flip, not a set, so it is only called when the desired
       * state differs — the same guard `useMcpServerCRUD.persistEnabledState`
       * applies.
       */
      // Hosted search needs no key, so the entry must stay on even with the
      // form empty — otherwise saving an empty form would switch off search
      // that was working a moment earlier.
      const enabled = configured.length > 0 || hostedAvailable;
      if (server.enabled !== enabled) await mcpService.toggleServer.invoke({ id: server.id });

      onServerUpdated?.({ ...server, ...data, enabled } as IMcpServer);
      Message.success(t('mcp.webSearch.saved'));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('mcp.webSearch.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (server.transport.type !== 'stdio') return null;

  return (
    <div className='flex flex-col gap-12px pb-8px'>
      <Typography.Text type='secondary' className='text-12px'>
        {t('mcp.webSearch.description')}
      </Typography.Text>

      <div className='flex flex-col gap-4px'>
        <div className='flex items-center gap-8px'>
          <Typography.Text className='text-13px font-medium'>{t('mcp.webSearch.hostedTitle')}</Typography.Text>
          <Tag size='small' color={hostedAvailable ? 'green' : 'gray'}>
            {hostedAvailable ? t('mcp.webSearch.hostedReady') : t('mcp.webSearch.hostedUnavailable')}
          </Tag>
        </div>
        <Typography.Text type='secondary' className='text-12px'>
          {hostedAvailable
            ? configured.length > 0
              ? t('mcp.webSearch.hostedOverridden')
              : t('mcp.webSearch.hostedQuotaHint')
            : t('mcp.webSearch.hostedUnavailableHint')}
        </Typography.Text>
      </div>

      <Radio.Group
        value={selected}
        onChange={(value: string) => setEnv((prev) => ({ ...prev, [WEB_SEARCH_DEFAULT_ENV]: value }))}
        className='flex flex-col gap-16px'
      >
        {groups.map((group) => (
          <div key={group.region} className='flex flex-col gap-12px'>
            <Typography.Text type='secondary' className='text-12px'>
              {group.label}
            </Typography.Text>
            {group.providers.map((provider) => {
              const ready = configured.some((p) => p.id === provider.id);
              const test = tests[provider.id] || {};
              // Selected as default, but not usable yet — say so instead of
              // leaving the user to wonder why nothing happens.
              const needsSetup = selected === provider.id && !ready;
              return (
                <div key={provider.id} className='flex flex-col gap-4px'>
                  <div className='flex items-center gap-8px'>
                    <Radio value={provider.id} className='shrink-0 w-150px'>
                      {provider.label}
                    </Radio>
                    <Input.Password
                      value={env[provider.envKey] || ''}
                      onChange={(value: string) => setKey(provider, value)}
                      placeholder={t('mcp.webSearch.apiKeyPlaceholder')}
                      className='flex-1'
                      autoComplete='off'
                    />
                    <Button size='small' loading={test.testing} onClick={() => handleTest(provider)}>
                      {t('mcp.webSearch.test')}
                    </Button>
                    {provider.apiKeyUrl ? (
                      <Link href={provider.apiKeyUrl} target='_blank' className='shrink-0 text-12px'>
                        {t('mcp.webSearch.getKey')}
                      </Link>
                    ) : null}
                  </div>
                  <div className='flex items-center gap-8px pl-150px'>
                    <Input
                      value={env[provider.baseUrlEnvKey] || provider.defaultBaseUrl}
                      onChange={(value: string) =>
                        setField(provider.baseUrlEnvKey, value === provider.defaultBaseUrl ? '' : value)
                      }
                      placeholder={provider.requiresBaseUrl ? t('mcp.webSearch.endpointPlaceholder') : undefined}
                      size='small'
                      className='flex-1'
                      spellCheck={false}
                    />
                    {!test.testing && test.message ? (
                      <Tag size='small' color={test.ok ? 'green' : 'red'} className='shrink-0 max-w-320px truncate'>
                        {test.message}
                      </Tag>
                    ) : needsSetup ? (
                      <Tag size='small' color='orange' className='shrink-0'>
                        {t('mcp.webSearch.needsSetup')}
                      </Tag>
                    ) : null}
                  </div>
                  {provider.tiers ? (
                    <div className='flex items-center gap-8px pl-150px'>
                      <Typography.Text type='secondary' className='text-12px shrink-0'>
                        {t('mcp.webSearch.tier')}
                      </Typography.Text>
                      <Select
                        value={env[provider.tiers.envKey] || provider.tiers.defaultValue}
                        onChange={(value: string) =>
                          setField(provider.tiers.envKey, value === provider.tiers.defaultValue ? '' : value)
                        }
                        size='small'
                        className='w-220px'
                      >
                        {provider.tiers.options.map((option) => (
                          // Engine codes, untranslated: they are what the API
                          // takes and what the vendor's own console shows.
                          <Select.Option key={option} value={option}>
                            {option}
                          </Select.Option>
                        ))}
                      </Select>
                      <Typography.Text type='secondary' className='text-12px'>
                        {t('mcp.webSearch.tierHint')}
                      </Typography.Text>
                    </div>
                  ) : null}
                  {provider.custom ? (
                    <div className='flex items-center gap-8px pl-150px'>
                      {(
                        [
                          [WEB_SEARCH_CUSTOM_ENV.authHeader, WEB_SEARCH_CUSTOM_DEFAULTS.authHeader],
                          [WEB_SEARCH_CUSTOM_ENV.authPrefix, WEB_SEARCH_CUSTOM_DEFAULTS.authPrefix],
                          [WEB_SEARCH_CUSTOM_ENV.method, WEB_SEARCH_CUSTOM_DEFAULTS.method],
                          [WEB_SEARCH_CUSTOM_ENV.queryField, WEB_SEARCH_CUSTOM_DEFAULTS.queryField],
                        ] as const
                      ).map(([envKey, fallback]) => (
                        <Input
                          key={envKey}
                          value={env[envKey] ?? ''}
                          onChange={(value: string) => setField(envKey, value)}
                          placeholder={fallback || t('mcp.webSearch.noPrefix')}
                          size='small'
                          className='flex-1'
                          spellCheck={false}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </Radio.Group>

      <div className='flex items-center gap-12px'>
        <Button type='primary' size='small' loading={saving} onClick={handleSave}>
          {t('mcp.webSearch.save')}
        </Button>
        <Typography.Text type='secondary' className='text-12px'>
          {configured.length > 0
            ? t('mcp.webSearch.readyHint', { count: configured.length })
            : hostedAvailable
              ? t('mcp.webSearch.hostedEmptyHint')
              : t('mcp.webSearch.emptyHint')}
        </Typography.Text>
      </div>
    </div>
  );
};

export default WebSearchProviderConfig;
