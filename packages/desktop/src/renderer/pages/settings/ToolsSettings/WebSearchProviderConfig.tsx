/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
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
 * Keys are written to the MCP entry's own `transport.env`. Nothing new is
 * persisted, so there is no second copy to keep in sync and no new secret store
 * to secure.
 */

import { Button, Input, Link, Message, Radio, Typography } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer } from '@/common/config/storage';
import { WEB_SEARCH_DEFAULT_ENV, WEB_SEARCH_PROVIDERS, type WebSearchProvider } from '@/common/webSearch/catalog';

type Props = {
  server: IMcpServer;
  onServerUpdated?: (next: IMcpServer) => void;
};

const readEnv = (server: IMcpServer): Record<string, string> =>
  server.transport.type === 'stdio' ? { ...server.transport.env } : {};

const WebSearchProviderConfig: React.FC<Props> = ({ server, onServerUpdated }) => {
  const { t } = useTranslation();
  const [env, setEnv] = useState<Record<string, string>>(() => readEnv(server));
  const [saving, setSaving] = useState(false);

  const groups = useMemo(
    () =>
      (['cn', 'global'] as const).map((region) => ({
        region,
        label: region === 'cn' ? t('mcp.webSearch.regionCn') : t('mcp.webSearch.regionGlobal'),
        providers: WEB_SEARCH_PROVIDERS.filter((provider) => provider.region === region),
      })),
    [t]
  );

  /** Providers with a key typed in right now — drives both the radio and the enable decision. */
  const configured = useMemo(() => WEB_SEARCH_PROVIDERS.filter((provider) => !!env[provider.envKey]?.trim()), [env]);

  const setKey = (provider: WebSearchProvider, value: string) =>
    setEnv((prev) => {
      const next = { ...prev, [provider.envKey]: value };
      if (!value.trim()) delete next[provider.envKey];
      // Clearing the key of the current default would otherwise leave the radio
      // pointing at a provider that can no longer run.
      if (!value.trim() && next[WEB_SEARCH_DEFAULT_ENV] === provider.id) delete next[WEB_SEARCH_DEFAULT_ENV];
      return next;
    });

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

      // Enable as soon as there is something to search with. Leaving it off
      // after the user has pasted a key is a second, invisible step.
      const enabled = configured.length > 0;
      const data = { transport: { ...server.transport, env: cleaned }, enabled };
      await mcpService.updateServer.invoke({ id: server.id, data });
      onServerUpdated?.({ ...server, ...data } as IMcpServer);
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

      <Radio.Group
        value={env[WEB_SEARCH_DEFAULT_ENV] || configured[0]?.id}
        onChange={(value: string) => setEnv((prev) => ({ ...prev, [WEB_SEARCH_DEFAULT_ENV]: value }))}
        className='flex flex-col gap-12px'
      >
        {groups.map((group) => (
          <div key={group.region} className='flex flex-col gap-8px'>
            <Typography.Text type='secondary' className='text-12px'>
              {group.label}
            </Typography.Text>
            {group.providers.map((provider) => {
              const hasKey = !!env[provider.envKey]?.trim();
              return (
                <div key={provider.id} className='flex items-center gap-8px'>
                  <Radio value={provider.id} disabled={!hasKey} className='shrink-0 w-140px'>
                    {provider.label}
                  </Radio>
                  <Input.Password
                    value={env[provider.envKey] || ''}
                    onChange={(value: string) => setKey(provider, value)}
                    placeholder={t('mcp.webSearch.apiKeyPlaceholder')}
                    className='flex-1'
                    autoComplete='off'
                  />
                  <Link href={provider.apiKeyUrl} target='_blank' className='shrink-0 text-12px'>
                    {t('mcp.webSearch.getKey')}
                  </Link>
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
            : t('mcp.webSearch.emptyHint')}
        </Typography.Text>
      </div>
    </div>
  );
};

export default WebSearchProviderConfig;
