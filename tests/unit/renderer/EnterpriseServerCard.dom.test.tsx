/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * The enterprise connect card that replaced the "本机作为服务器 / 客户端" role
 * picker, plus the address resolution behind it. The resolver cases come from
 * a 2026-10-09 field report: the user typed `<lan-ip>:25808` — this machine's
 * own client — and was told the server "has no enterprise module".
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOwnClientAddress,
  resolveEnterpriseServer,
  type EnterpriseProbeResult,
} from '@/renderer/utils/enterprise/probeEnterpriseServer';

vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: { getStatus: { invoke: vi.fn().mockResolvedValue({ lanIP: '192.168.11.137', port: 25808 }) } },
}));

const mockPersistUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@renderer/hooks/enterprise/useDeploymentRole', () => ({
  useDeploymentRole: () => ({
    loading: false,
    role: 'client',
    serverUrl: '',
    normalizedServerUrl: null,
    serverUrlHistory: [],
    isClient: true,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
  persistDeploymentServerUrl: (...args: unknown[]) => mockPersistUrl(...args),
  clearDeploymentServerUrlHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let text = typeof opts?.defaultValue === 'string' ? opts.defaultValue : key;
      for (const [k, v] of Object.entries(opts ?? {})) text = text.replace(`{{${k}}}`, String(v));
      return text;
    },
  }),
}));

const local = { lanIP: '192.168.11.137', ports: [25808] };

describe('resolveEnterpriseServer', () => {
  it('recognises this machine’s own client address without probing it', async () => {
    const probe = vi.fn<(url: string) => Promise<EnterpriseProbeResult>>();
    const result = await resolveEnterpriseServer('http://192.168.11.137:25808', local, probe);

    expect(result).toMatchObject({ ok: false, reason: 'self' });
    // The gateway on :80 of the same host is still worth a try — it may run
    // the enterprise stack next to this client, as in the report.
    expect(probe).toHaveBeenCalledWith('http://192.168.11.137');
    expect(isOwnClientAddress('http://localhost:25808', local)).toBe(true);
    expect(isOwnClientAddress('http://localhost:26808', local)).toBe(false);
  });

  it('falls back to the gateway when the typed port is an internal one', async () => {
    const probe = vi.fn(
      async (url: string): Promise<EnterpriseProbeResult> => (url === 'http://10.0.0.5' ? 'ok' : 'unreachable')
    );
    const result = await resolveEnterpriseServer('http://10.0.0.5:25809', local, probe);

    expect(result).toEqual({ ok: true, url: 'http://10.0.0.5', adjustedFrom: 'http://10.0.0.5:25809' });
  });

  it('keeps the typed address when it works, and reports why when nothing does', async () => {
    expect(await resolveEnterpriseServer('https://ai.example.com', local, async () => 'ok')).toEqual({
      ok: true,
      url: 'https://ai.example.com',
    });
    expect(await resolveEnterpriseServer('http://10.0.0.5:8080', local, async () => 'no-enterprise')).toMatchObject({
      ok: false,
      reason: 'no-enterprise',
      url: 'http://10.0.0.5:8080',
    });
  });
});

describe('EnterpriseServerCard', () => {
  beforeEach(() => {
    localStorage.removeItem('one-enterprise:enabled');
    mockPersistUrl.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has no server/client role picker any more', async () => {
    const { default: EnterpriseServerCard } = await import('@/renderer/pages/settings/components/EnterpriseServerCard');
    render(<EnterpriseServerCard />);

    expect(screen.getByText('企业服务器')).toBeInTheDocument();
    expect(screen.getByText('未连接')).toBeInTheDocument();
    expect(screen.queryByText('本机作为服务器')).toBeNull();
    expect(screen.queryByText('本机作为客户端')).toBeNull();
  });

  it('explains a failed connect inline, naming the address it tried', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { default: EnterpriseServerCard } = await import('@/renderer/pages/settings/components/EnterpriseServerCard');
    render(<EnterpriseServerCard />);

    await userEvent.type(screen.getByPlaceholderText(/192.168.1.10/), '10.0.0.9');
    await userEvent.click(screen.getByRole('button', { name: '连接' }));

    expect(await screen.findByText(/连接不上 http:\/\/10\.0\.0\.9/)).toBeInTheDocument();
    expect(mockPersistUrl).not.toHaveBeenCalled();
    expect(localStorage.getItem('one-enterprise:enabled')).not.toBe('true');
  });

  it('connects, saving the gateway address it actually reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.startsWith('http://10.0.0.5/'))
          return new Response('{}', { status: input.endsWith('/health') ? 200 : 401 });
        throw new TypeError('Failed to fetch');
      })
    );
    const { default: EnterpriseServerCard } = await import('@/renderer/pages/settings/components/EnterpriseServerCard');
    render(<EnterpriseServerCard />);

    await userEvent.type(screen.getByPlaceholderText(/192.168.1.10/), '10.0.0.5:25809');
    await userEvent.click(screen.getByRole('button', { name: '连接' }));

    await waitFor(() => expect(mockPersistUrl).toHaveBeenCalledWith('http://10.0.0.5'));
    expect(localStorage.getItem('one-enterprise:enabled')).toBe('true');
    expect(await screen.findByText(/已自动改用 http:\/\/10\.0\.0\.5/)).toBeInTheDocument();
  });
});
