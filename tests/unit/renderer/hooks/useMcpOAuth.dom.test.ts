import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMcpOAuth } from '@/renderer/hooks/mcp/useMcpOAuth';
import { mcpService } from '@/common/adapter/ipcBridge';
import { openExternalUrl } from '@/renderer/utils/platform';
import type { IMcpServer } from '@/common/config/storage';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    checkOAuthStatus: { invoke: vi.fn() },
    loginMcpOAuth: { invoke: vi.fn() },
    logoutMcpOAuth: { invoke: vi.fn() },
  },
}));
const server = {
  id: 'remote',
  name: 'Remote',
  transport: { type: 'http', url: 'https://fixture.example/mcp' },
} as IMcpServer;
describe('MCP OAuth browser side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('status discovery never starts authorization or opens a browser', async () => {
    vi.mocked(mcpService.checkOAuthStatus.invoke).mockResolvedValue({ authenticated: false });
    const { result, unmount } = renderHook(() => useMcpOAuth());
    await act(async () => {
      await result.current.checkMultipleServers(
        Array.from({ length: 200 }, (_, index) => ({ ...server, id: String(index) }))
      );
    });
    expect(mcpService.loginMcpOAuth.invoke).not.toHaveBeenCalled();
    expect(openExternalUrl).not.toHaveBeenCalled();
    unmount();
  });
  it('deduplicates repeated login clicks and opens exactly the returned URL once', async () => {
    vi.mocked(mcpService.loginMcpOAuth.invoke).mockResolvedValue({
      success: false,
      pending: true,
      authorization_url: 'https://fixture.example/authorize',
    });
    vi.mocked(mcpService.checkOAuthStatus.invoke).mockResolvedValue({ authenticated: true });
    const { result, unmount } = renderHook(() => useMcpOAuth());
    let login!: Promise<{ success: boolean; error?: string }>;
    await act(async () => {
      login = result.current.login(server);
      await result.current.login(server);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      expect((await login).success).toBe(true);
    });
    expect(mcpService.loginMcpOAuth.invoke).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith('https://fixture.example/authorize');
    unmount();
  });
  it('stops polling after the settings component is closed', async () => {
    vi.mocked(mcpService.loginMcpOAuth.invoke).mockResolvedValue({
      success: false,
      pending: true,
      authorization_url: 'https://fixture.example/authorize',
    });
    const { result, unmount } = renderHook(() => useMcpOAuth());
    let login!: Promise<{ success: boolean; error?: string }>;
    await act(async () => {
      login = result.current.login(server);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await login;
    });
    expect(mcpService.checkOAuthStatus.invoke).not.toHaveBeenCalled();
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
  });
});
