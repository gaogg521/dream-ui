/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from 'electron-updater';
import type { AppUpdater } from 'electron-updater/out/AppUpdater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { CdnGenericProvider, getLastSelectedCdnBaseUrl } from '@/process/services/cdnGenericProvider';
import { buildCdnFeedOptions, CDN_UPDATE_BASE_URL, CDN_UPDATE_BASE_URLS } from '@/process/services/updateFeed';

const makeRuntimeOptions = (): ProviderRuntimeOptions => ({
  isUseMultipleRangeRequest: true,
  platform: 'darwin',
  executor: {
    request: vi.fn(),
  } as unknown as ProviderRuntimeOptions['executor'],
});

describe('CDN update feed options', () => {
  it('builds a custom electron-updater provider pointed at the release CDN', () => {
    const options = buildCdnFeedOptions();

    expect(options.provider).toBe('custom');
    expect(options.url).toBe(CDN_UPDATE_BASE_URL);
    expect(options.mirrors).toEqual(CDN_UPDATE_BASE_URLS.slice(1));
    expect(options.updateProvider).toBe(CdnGenericProvider);
  });

  it('lists the new bucket first and keeps the legacy bucket as a fallback', () => {
    expect(CDN_UPDATE_BASE_URLS).toEqual([
      'https://onework-1521070673.cos.ap-shanghai.myqcloud.com/releases',
      'https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases',
    ]);
  });
});

describe('CdnGenericProvider', () => {
  it('resolves relative update files under the version directory', () => {
    const provider = new CdnGenericProvider(
      {
        provider: 'custom',
        url: 'https://static.dream.com/releases',
      },
      {} as AppUpdater,
      makeRuntimeOptions()
    );

    const files = provider.resolveFiles({
      version: '2.1.14',
      files: [
        {
          url: 'OneWork-2.1.14-mac-arm64.dmg',
          sha512: 'sha512-value',
        },
      ],
      path: 'OneWork-2.1.14-mac-arm64.dmg',
      sha512: 'sha512-value',
      releaseDate: '2026-06-08T00:00:00.000Z',
    } satisfies UpdateInfo);

    expect(files[0]?.url.href).toBe('https://static.dream.com/releases/2.1.14/OneWork-2.1.14-mac-arm64.dmg');
  });
});

describe('CdnGenericProvider with several update sources', () => {
  const NEW_HOST = 'new.example.com';
  const OLD_HOST = 'old.example.com';

  const manifest = (version: string) =>
    [
      `version: ${version}`,
      'files:',
      `  - url: OneWork-${version}-mac-arm64.dmg`,
      '    sha512: sha512-value',
      '    size: 1',
      `path: OneWork-${version}-mac-arm64.dmg`,
      'sha512: sha512-value',
      "releaseDate: '2026-11-02T00:00:00.000Z'",
      '',
    ].join('\n');

  type Behaviour = string | Error | 'hang';

  /** `request` answers per host; the host comes from the request options the real provider builds. */
  const makeProvider = (behaviour: Record<string, Behaviour>) => {
    const request = vi.fn((options: { hostname: string }) => {
      const outcome = behaviour[options.hostname];
      if (outcome === 'hang') return new Promise<string>(() => {});
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome);
    });
    const runtimeOptions = {
      isUseMultipleRangeRequest: true,
      platform: 'darwin',
      executor: { request },
    } as unknown as ProviderRuntimeOptions;
    const provider = new CdnGenericProvider(
      { provider: 'custom', url: `https://${NEW_HOST}/releases`, mirrors: [`https://${OLD_HOST}/releases`] },
      {} as AppUpdater,
      runtimeOptions
    );
    return { provider, request };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the preferred source whenever it answers, even if the fallback carries a newer version', async () => {
    const { provider, request } = makeProvider({ [NEW_HOST]: manifest('3.0.17'), [OLD_HOST]: manifest('3.0.18') });

    const info = await provider.getLatestVersion();
    const files = provider.resolveFiles(info);

    expect(info.version).toBe('3.0.17');
    expect(files[0]?.url.href).toBe(`https://${NEW_HOST}/releases/3.0.17/OneWork-3.0.17-mac-arm64.dmg`);
    expect(provider.activeBaseUrl).toBe(`https://${NEW_HOST}/releases/`);
    expect(getLastSelectedCdnBaseUrl()).toBe(`https://${NEW_HOST}/releases`);
    // The fallback is not even contacted when the preferred source is healthy.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('falls back to the other source when the preferred one is unreachable', async () => {
    const { provider } = makeProvider({ [NEW_HOST]: new Error('connect ETIMEDOUT'), [OLD_HOST]: manifest('3.0.17') });

    const info = await provider.getLatestVersion();
    const files = provider.resolveFiles(info);

    expect(info.version).toBe('3.0.17');
    expect(files[0]?.url.href).toBe(`https://${OLD_HOST}/releases/3.0.17/OneWork-3.0.17-mac-arm64.dmg`);
    expect(getLastSelectedCdnBaseUrl()).toBe(`https://${OLD_HOST}/releases`);
  });

  it('falls back when the preferred source has no channel manifest (HTTP 404)', async () => {
    const notFound = Object.assign(new Error('Not Found'), { statusCode: 404 });
    const { provider } = makeProvider({ [NEW_HOST]: notFound, [OLD_HOST]: manifest('3.0.16') });

    const info = await provider.getLatestVersion();

    expect(info.version).toBe('3.0.16');
    expect(provider.activeBaseUrl).toBe(`https://${OLD_HOST}/releases/`);
  });

  it('returns to the preferred source on the next check once it is healthy again', async () => {
    const behaviour: Record<string, string | Error> = {
      [NEW_HOST]: new Error('connect ECONNREFUSED'),
      [OLD_HOST]: manifest('3.0.17'),
    };
    const { provider } = makeProvider(behaviour);

    await provider.getLatestVersion();
    expect(provider.activeBaseUrl).toBe(`https://${OLD_HOST}/releases/`);

    behaviour[NEW_HOST] = manifest('3.0.17');
    await provider.getLatestVersion();
    expect(provider.activeBaseUrl).toBe(`https://${NEW_HOST}/releases/`);
  });

  it('reports the preferred source error when every source fails', async () => {
    const { provider } = makeProvider({
      [NEW_HOST]: new Error('first failure'),
      [OLD_HOST]: new Error('second failure'),
    });

    await expect(provider.getLatestVersion()).rejects.toThrow('first failure');
  });

  it('gives up on a preferred source that never answers and uses the fallback', async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider({ [NEW_HOST]: 'hang', [OLD_HOST]: manifest('3.0.17') });

    const pending = provider.getLatestVersion();
    await vi.advanceTimersByTimeAsync(9000);
    const info = await pending;

    expect(info.version).toBe('3.0.17');
    expect(provider.activeBaseUrl).toBe(`https://${OLD_HOST}/releases/`);
  });
});
