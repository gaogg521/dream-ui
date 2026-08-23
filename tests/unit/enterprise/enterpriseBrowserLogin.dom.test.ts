import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEnterpriseRemotePointer } from '@/common/adapter/enterpriseMode';
import { openEnterpriseOAuthInBrowser } from '@/renderer/utils/enterprise/enterpriseBrowserLogin';

const openExternalUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

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

  it('falls back to the production scheme when preload never injected one', async () => {
    delete (window as { __deepLinkScheme?: string }).__deepLinkScheme;

    await openEnterpriseOAuthInBrowser('feishu', { remoteOrigin: 'http://192.168.11.159:25808' });

    const openedUrl = new URL(openExternalUrl.mock.calls[0][0] as string);
    expect(openedUrl.searchParams.get('scheme')).toBe('aionui');
  });
});
