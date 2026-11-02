/**
 * Copyright 2026 One Work
 */

import type { UpdateInfo } from 'electron-updater';
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider';
import { resolveFiles as resolveProviderFiles } from 'electron-updater/out/providers/Provider';
import { getChannelFilename, newUrlFromBase } from 'electron-updater/out/util';
import log from 'electron-log';

type GenericProviderConfiguration = ConstructorParameters<typeof GenericProvider>[0];
type GenericProviderUpdater = ConstructorParameters<typeof GenericProvider>[1];
type GenericProviderRuntimeOptions = ConstructorParameters<typeof GenericProvider>[2];

export type CdnGenericProviderConfiguration = Omit<GenericProviderConfiguration, 'provider'> & {
  provider: 'custom';
  updateProvider?: unknown;
  /**
   * Fallback bases carrying the same layout as `url`, in order. `url` is tried
   * first; a later base is only used when every earlier one is unavailable
   * (unreachable, timed out, or without the channel manifest). The installers
   * are then resolved under the base that answered.
   */
  mirrors?: readonly string[];
};

/**
 * How long one source gets to answer before the next is tried. Without a cap, a
 * blackholed preferred host would hold the whole check until its socket times
 * out, long after the fallback could have answered.
 */
const SOURCE_TIMEOUT_MS = 8000;

const withTrailingSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

let lastSelectedBaseUrl: string | undefined;

/**
 * The base the most recent successful update check came from (no trailing
 * slash), or undefined before any check. Lets code outside the provider — the
 * manual-download links and the changelog fetch — follow the same source.
 */
export const getLastSelectedCdnBaseUrl = (): string | undefined => lastSelectedBaseUrl;

/** Rejects when `promise` has not settled within `ms`. */
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`update source timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

export class CdnGenericProvider extends GenericProvider {
  /** Every base, preferred first. */
  private readonly _bases: URL[];
  /** Providers for `_bases[1..]` (index 0 is this instance). */
  private readonly _peers: GenericProvider[];
  /** Index into `_bases` of the one the last successful check came from. */
  private _activeIndex = 0;
  // Parent stores `updater` privately; keep our own reference to rebuild the
  // channel-file URL for logging (the base `channel` getter is also private).
  private readonly _updater: GenericProviderUpdater;

  constructor(
    configuration: CdnGenericProviderConfiguration,
    updater: GenericProviderUpdater,
    runtimeOptions: GenericProviderRuntimeOptions
  ) {
    const { mirrors = [], updateProvider: _updateProvider, ...rest } = configuration;
    const genericConfiguration: GenericProviderConfiguration = {
      ...rest,
      provider: 'generic',
    };
    super(genericConfiguration, updater, runtimeOptions);
    this._updater = updater;
    this._bases = [configuration.url, ...mirrors].map((url) => new URL(withTrailingSlash(url)));
    this._peers = mirrors.map(
      (url) =>
        new GenericProvider({ ...genericConfiguration, url } as GenericProviderConfiguration, updater, runtimeOptions)
    );
    log.debug('[auto-update] CDN provider initialized', {
      baseUrls: this._bases.map((base) => base.href),
      platform: runtimeOptions.platform,
      isUseMultipleRangeRequest: runtimeOptions.isUseMultipleRangeRequest,
    });
  }

  /** The base the last successful check came from (preferred base before any check). */
  get activeBaseUrl(): string {
    return this._bases[this._activeIndex].href;
  }

  /**
   * Resolve the channel metadata file (e.g. `latest-mac.yml`) the updater fetches
   * to discover the newest version. Mirrors GenericProvider's private `channel`
   * getter, which is not accessible from a subclass.
   */
  private resolveLatestVersionUrl(base: URL): URL {
    const channelName = this._updater.channel ?? this.getDefaultChannelName();
    const channelFile = getChannelFilename(channelName);
    // `isAddNoCacheQuery` is a real getter on AppUpdater but absent from its public types.
    const addNoCacheQuery = Boolean((this._updater as unknown as { isAddNoCacheQuery?: boolean }).isAddNoCacheQuery);
    return newUrlFromBase(channelFile, base, addNoCacheQuery);
  }

  override async getLatestVersion(): Promise<UpdateInfo> {
    const probes: Array<() => Promise<UpdateInfo>> = [
      () => super.getLatestVersion(),
      ...this._peers.map((peer) => () => peer.getLatestVersion()),
    ];

    let firstError: unknown;
    for (let index = 0; index < probes.length; index += 1) {
      const url = this.resolveLatestVersionUrl(this._bases[index]).href;
      log.info('[auto-update] Checking latest version from URL:', url);
      try {
        // Sequential on purpose: the preferred base is used whenever it answers,
        // and only its failure sends the check to the next one.
        // eslint-disable-next-line no-await-in-loop
        const info = await withTimeout(probes[index](), SOURCE_TIMEOUT_MS);
        this._activeIndex = index;
        lastSelectedBaseUrl = this.activeBaseUrl.replace(/\/+$/, '');
        log.info('[auto-update] Update source selected:', this.activeBaseUrl, `(version ${info.version})`);
        return info;
      } catch (error) {
        firstError ??= error;
        log.warn('[auto-update] Update source unavailable:', url, error instanceof Error ? error.message : error);
      }
    }

    // Every source failed: surface the preferred base's error, which is the one
    // a user would expect to see.
    throw firstError ?? new Error('No update source configured');
  }

  override resolveFiles(updateInfo: UpdateInfo): ReturnType<GenericProvider['resolveFiles']> {
    const resolved = resolveProviderFiles(
      updateInfo,
      this._bases[this._activeIndex],
      (filePath) => `${updateInfo.version}/${filePath}`
    );
    log.info('[auto-update] Update download URL(s) resolved:', {
      version: updateInfo.version,
      files: resolved.map((file) => file.url.href),
      packages: resolved.map((file) => file.packageInfo?.path).filter(Boolean),
    });
    return resolved;
  }
}
