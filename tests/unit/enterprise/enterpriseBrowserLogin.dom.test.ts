import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEnterpriseRemotePointer, setEnterpriseModeEnabled, setEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';
import { openEnterpriseOAuthInBrowser, openEnterprisePasswordLoginInBrowser } from '@/renderer/utils/enterprise/enterpriseBrowserLogin';

const openExternalUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

// The local-WebUI fallback calls ensureWebuiRunning → ipcBridge.webui; a
// running WebUI lets the fallback resolve without touching Electron.
vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: {
    getStatus: { invoke: vi.fn().mockResolvedValue({ running: true, localUrl: 'http://127.0.0.1:25810' }) },
    start: { invoke: vi.fn().mockResolvedValue({ running: true, localUrl: 'http://127.0.0.1:25810' }) },
  },
}));
vi.mock('@/common', async () => {
  const bridge = await import('@/common/adapter/ipcBridge');
  return { ipcBridge: bridge };
});

describe('openEnterpriseOAuthInBrowser deep-link scheme', () => {
  beforeEach(() => {
    localStorage.clear();
    openExternalUrl.mockClear();
  });

  afterEach(() => {
    clearEnterpriseRemotePointer();
    delete (window as { __deepLinkScheme?: string }).__deepLinkScheme;
  });

  it("tells the backend this build's deep-link scheme so the callback returns to the right process", async () => {
    window.__deepLinkScheme = 'aionui-dev';

    await openEnterpriseOAuthInBrowser('feishu', { remoteOrigin: 'http://192.168.11.159:25808' });

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    const openedUrl = new URL(openExternalUrl.mock.calls[0][0] as string);
    expect(openedUrl.searchParams.get('scheme')).toBe('aionui-dev');
    expect(openedUrl.searchParams.get('desktop')).toBe('1');
  });

  it('falls back to the current production scheme when preload never injected one', async () => {
    delete (window as { __deepLinkScheme?: string }).__deepLinkScheme;

    await openEnterpriseOAuthInBrowser('feishu', { remoteOrigin: 'http://192.168.11.159:25808' });

    const openedUrl = new URL(openExternalUrl.mock.calls[0][0] as string);
    expect(openedUrl.searchParams.get('scheme')).toBe('dream');
  });

  /**
   * An aioncore older than the scheme rename maps anything it does not know back
   * to `aionui`, so asking for `dream` against a pinned older backend returns an
   * `aionui://` callback. The app registers and accepts both names, so this is a
   * working combination rather than a broken one — but only as long as the value
   * sent here stays one the backend can recognise.
   */
  it("sends a scheme the backend's allowlist knows", async () => {
    window.__deepLinkScheme = 'dream';

    await openEnterpriseOAuthInBrowser('feishu', { remoteOrigin: 'http://192.168.11.159:25808' });

    const openedUrl = new URL(openExternalUrl.mock.calls[0][0] as string);
    expect(['dream', 'dream-dev', 'aionui', 'aionui-dev']).toContain(openedUrl.searchParams.get('scheme'));
  });
});

/**
 * The password-class remote branch must key on the CONNECT state (mode flag
 * on), never on a merely-saved address: with the toggle off this is the
 * disconnected/personal state and the login destination stays the LOCAL
 * WebUI (the red-line-3 fallback). A saved URL alone must not reroute it.
 */
describe('openEnterprisePasswordLoginInBrowser remote/local routing', () => {
  const REMOTE = 'http://192.168.11.159:25808';

  beforeEach(() => {
    localStorage.clear();
    openExternalUrl.mockClear();
  });

  afterEach(() => {
    clearEnterpriseRemotePointer();
    delete (window as { __deepLinkScheme?: string }).__deepLinkScheme;
  });

  it('opens the remote console login with the desktop handshake when connected', async () => {
    window.__deepLinkScheme = 'dream-dev';
    setEnterpriseServerUrl(REMOTE);
    setEnterpriseModeEnabled(true);

    await openEnterprisePasswordLoginInBrowser('/enterprise/login', { remoteOrigin: REMOTE });

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    const url = String(openExternalUrl.mock.calls[0][0]);
    expect(url).toBe(
      `${REMOTE}/admin/login?desktop=1&scheme=dream-dev&redirect=${encodeURIComponent('/enterprise/login')}`
    );
  });

  it('falls back to the local WebUI login when the connect toggle is off, even with a saved address', async () => {
    setEnterpriseServerUrl(REMOTE);
    setEnterpriseModeEnabled(false);

    await openEnterprisePasswordLoginInBrowser('/enterprise/login', { remoteOrigin: REMOTE });

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    const url = String(openExternalUrl.mock.calls[0][0]);
    expect(url).toContain('/#/login');
    expect(url).not.toContain('/admin/login');
  });

  it('falls back to the local WebUI login when no remote is configured', async () => {
    await openEnterprisePasswordLoginInBrowser('/enterprise/login');

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    const url = String(openExternalUrl.mock.calls[0][0]);
    expect(url).toContain('/#/login');
  });
});
