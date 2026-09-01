/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `one-media://` URL shape, shared by the main-process protocol handler and
 * the renderer components that consume it.
 *
 * Kept separate from `process/services/mediaProtocol.ts` because that module
 * imports `electron` and so cannot be pulled into the renderer bundle.
 */

import { isWebUiBrowserMode } from '@/common/adapter/httpBridge';

export const MEDIA_PROTOCOL_SCHEME = 'one-media';

/**
 * Build the URL the renderer should point a media element at.
 *
 * The path travels as a query parameter rather than in the URL path so Windows
 * drive letters and backslashes survive untouched — `one-media://D:\x\y.mp4`
 * would be parsed as a host, not a path.
 */
/**
 * Path the WebUI's static server serves generated media from, for browser
 * clients. Declared here rather than beside its handler because the renderer
 * must build the URL and cannot import from `@process/` — same reason
 * `MEDIA_PROTOCOL_SCHEME` lives here.
 */
export const MEDIA_HTTP_ROUTE = '/media/file';

/**
 * Job list and job-update stream for browser clients.
 *
 * The job store lives in the Electron main process and is exposed to the
 * renderer over the Electron IPC bridge. A browser has no such bridge — its
 * adapter is a WebSocket to dreamcore, which has no `media.jobs.*` channel at
 * all — so the WebUI received **no jobs**, rendered no cards, and therefore
 * never even reached the point of loading a media URL. Serving the bytes was
 * necessary but not sufficient.
 */
export const MEDIA_JOBS_ROUTE = '/media/jobs';
export const MEDIA_JOBS_STREAM_ROUTE = '/media/jobs/stream';
export const MEDIA_JOB_CANCEL_ROUTE = '/media/jobs/cancel';

/**
 * Build the URL the renderer should point a media element at.
 *
 * **The two hosts need different URLs.** `one-media://` is registered by the
 * Electron main process and does not exist in a browser, so the WebUI — which
 * runs this very same renderer bundle — rendered every generated image and
 * video as a broken element. Sharing the code did not share the capability.
 *
 * The browser URL is relative on purpose: it must resolve against whatever
 * origin served the page (localhost, a LAN address, or a remote server), and
 * hardcoding one would break the other two.
 */
export const buildMediaUrl = (absolutePath: string): string => {
  const encoded = encodeURIComponent(absolutePath);
  return isWebUiBrowserMode()
    ? `${MEDIA_HTTP_ROUTE}?path=${encoded}`
    : `${MEDIA_PROTOCOL_SCHEME}://local/?path=${encoded}`;
};
