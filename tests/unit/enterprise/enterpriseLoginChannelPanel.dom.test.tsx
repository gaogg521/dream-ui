import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from "react";
import { render, screen, waitFor } from '@testing-library/react';
import EnterpriseLoginChannelPanel from '@/renderer/pages/enterprise/components/EnterpriseLoginChannelPanel';

// The panel reads the co-located backend origin for its no-remote fetch.
const localBase = 'http://127.0.0.1:59999';
vi.mock('@/common/adapter/httpBridge', () => ({
  getLocalBaseUrl: () => localBase,
}));

const openOAuth = vi.fn().mockResolvedValue(true);
const openPassword = vi.fn().mockResolvedValue(true);
vi.mock('@/renderer/utils/enterprise/enterpriseBrowserLogin', () => ({
  openEnterpriseOAuthInBrowser: (...args: unknown[]) => openOAuth(...(args as [])),
  openEnterprisePasswordLoginInBrowser: (...args: unknown[]) => openPassword(...(args as [])),
}));

type FetchHandler = (url: string) => { status: number; body: unknown };

/**
 * Regression: the channel grid's first fetch happens against the LOCAL
 * personal backend (which has no governance plane → 404) and must not stick.
 * Once `remoteOrigin` points at the enterprise server and the refetch answers,
 * every derived state — badges, hint, click routing — must reflect the remote
 * list, not the failed first frame.
 */
describe('EnterpriseLoginChannelPanel first-frame recovery', () => {
  let fetchHandler: FetchHandler;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const handler = fetchHandler;
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status });
  });

  beforeEach(() => {
    localStorage.clear();
    openOAuth.mockClear();
    openPassword.mockClear();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    // Non-local origins must be reachable from the jsdom fetch mock.
    fetchHandler = () => ({ status: 404, body: { success: false } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the failed first frame once the remote origin answers', async () => {
    // Frame 1: no remote origin — the local personal backend answers 404.
    fetchHandler = (url) =>
      url.startsWith(localBase)
        ? { status: 404, body: { success: false, code: 'NOT_FOUND' } }
        : {
            status: 200,
            body: {
              success: true,
              data: [
                { provider: 'feishu', enabled: true, configured: true },
                { provider: 'ldap', enabled: true, configured: true },
              ],
            },
          };

    const { rerender } = render(<EnterpriseLoginChannelPanel remoteOrigin={null} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`${localBase}/api/one/sso/providers`),
        expect.anything()
      );
    });

    rerender(<EnterpriseLoginChannelPanel remoteOrigin="http://172.29.128.120:25810" />);

    // Frame 2: the remote list names feishu + ldap ready — no tile may keep a
    // 未配置/不可用 badge, and the failure hint must be gone.
    await waitFor(() => {
      expect(screen.queryByText('未配置')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('不可用')).not.toBeInTheDocument();
    expect(screen.queryByText(/无法连接项目组服务器|尚未连接企业服务器/)).not.toBeInTheDocument();
  });

  it('keeps badge and click routing consistent when a channel is genuinely unconfigured', async () => {
    fetchHandler = () => ({
      status: 200,
      body: {
        success: true,
        data: [{ provider: 'ldap', enabled: true, configured: true }],
      },
    });

    render(<EnterpriseLoginChannelPanel remoteOrigin="http://172.29.128.120:25810" />);

    // feishu/dingtalk/wecom/oidc have no row: badge up front, click explains
    // instead of opening.
    await waitFor(() => {
      expect(screen.getAllByText('未配置')).toHaveLength(4);
    });
    screen.getByText('飞书账号').click();
    await waitFor(() => {
      expect(openOAuth).not.toHaveBeenCalled();
    });

    // ldap is ready: clicking it must route to the remote console login.
    screen.getByText('LDAP 域控').click();
    await waitFor(() => {
      expect(openPassword).toHaveBeenCalledWith(
        '/settings/enterprise',
        expect.objectContaining({ remoteOrigin: 'http://172.29.128.120:25810', channel: 'ldap' })
      );
    });
  });
});
