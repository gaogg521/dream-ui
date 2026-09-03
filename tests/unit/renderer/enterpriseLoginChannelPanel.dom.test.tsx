/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * The SSO tiles used to render as `disabled` when unconfigured, which
 * swallowed the click that would have explained why — leaving a row of dead
 * grey tiles and no way to find out whether the fix was "connect a server"
 * or "ask your admin". These lock the two distinct reasons and the fact that
 * the tiles stay clickable.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ warning: vi.fn(), info: vi.fn() }));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, warning: hooks.warning, info: hooks.info } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, opts?: { defaultValue?: string; method?: string }) =>
      (opts?.defaultValue ?? _k).replace('{{method}}', opts?.method ?? ''),
  }),
}));

vi.mock('@/common/adapter/httpBridge', () => ({ getLocalBaseUrl: () => 'http://127.0.0.1:13400' }));

vi.mock('@renderer/utils/enterprise/enterpriseBrowserLogin', () => ({
  openEnterpriseOAuthInBrowser: vi.fn().mockResolvedValue(true),
  openEnterprisePasswordLoginInBrowser: vi.fn().mockResolvedValue(true),
}));

const EnterpriseLoginChannelPanel = (await import(
  '@renderer/pages/enterprise/components/EnterpriseLoginChannelPanel'
)).default;

const mockProviders = (rows: unknown[]) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) } as unknown as Response)
  );
};

describe('EnterpriseLoginChannelPanel unavailable reasons', () => {
  beforeEach(() => {
    hooks.warning.mockReset();
    hooks.info.mockReset();
  });

  it('explains that no enterprise server is connected, rather than showing dead tiles', async () => {
    mockProviders([]);
    render(<EnterpriseLoginChannelPanel />);

    expect(await screen.findByText(/尚未连接，因此下方仅「本地账户」可用/)).toBeInTheDocument();

    // The tile is still clickable — that click is the only way the reason
    // reaches a user who didn't read the panel text.
    const feishu = screen.getByText('飞书账号').closest('button') as HTMLButtonElement;
    expect(feishu.disabled).toBe(false);
    fireEvent.click(feishu);
    await waitFor(() => expect(hooks.warning).toHaveBeenCalled());
    expect(String(hooks.warning.mock.calls[0][0])).toContain('尚未连接企业服务器');
  });

  it('distinguishes "connected but the admin configured nothing" from "not connected"', async () => {
    mockProviders([{ provider: 'feishu', enabled: false, configured: false }]);
    render(<EnterpriseLoginChannelPanel remoteOrigin='http://10.0.0.5:25808' />);

    expect(await screen.findByText(/管理员尚未在企业管理后台启用任何 SSO 登录方式/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('飞书账号').closest('button') as HTMLButtonElement);
    await waitFor(() => expect(hooks.warning).toHaveBeenCalled());
    expect(String(hooks.warning.mock.calls[0][0])).toContain('尚未开通');
  });

  it('shows no reason banner once a channel is actually usable', async () => {
    mockProviders([{ provider: 'feishu', enabled: true, configured: true }]);
    render(<EnterpriseLoginChannelPanel remoteOrigin='http://10.0.0.5:25808' />);

    await waitFor(() => expect(screen.getByText('飞书账号')).toBeInTheDocument());
    expect(screen.queryByText(/尚未连接/)).toBeNull();
    expect(screen.queryByText(/管理员尚未/)).toBeNull();
  });
});
