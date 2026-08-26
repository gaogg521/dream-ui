/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which attachments may be used as a generation reference.
 *
 * In media mode the send box hands every attached path to the adapter as
 * `inputUris`, and the adapters treat those as images: the OpenAI images
 * adapter streams each one into a multipart `image` field, and the task-poll
 * adapter base64-encodes them as a first frame. Attaching a PDF or a Markdown
 * file therefore did not "not work" — it produced an opaque provider-side
 * parse error with nothing pointing at the file that caused it.
 *
 * The attach control is shared with chat, where documents are exactly the
 * point, so the filter lives here rather than on the picker: a file can also
 * arrive by drag, paste, or the project Explorer, and every one of those paths
 * has to be covered.
 */

import { IMAGE_EXTENSIONS } from '@/common/config/constants';

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** True when the path or URL looks like an image the adapters can read. */
export const isReferenceImage = (pathOrUrl: string): boolean => {
  if (!pathOrUrl) return false;
  // A URL's extension can be hidden behind a query string; strip it first.
  const withoutQuery = isHttpUrl(pathOrUrl) ? pathOrUrl.split(/[?#]/)[0] : pathOrUrl;
  const lower = withoutQuery.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

export type ReferenceSplit = {
  /** Paths that will be sent as reference images. */
  images: string[];
  /** Everything else, so the caller can say what it left out instead of failing silently. */
  rejected: string[];
};

/** Split attachments into usable references and the rest. */
export const splitReferenceInputs = (paths: readonly string[]): ReferenceSplit => {
  const images: string[] = [];
  const rejected: string[] = [];
  for (const path of paths) {
    if (isReferenceImage(path)) images.push(path);
    else rejected.push(path);
  }
  return { images, rejected };
};

/** Just the file name, for telling the user which attachment was skipped. */
export const baseName = (pathOrUrl: string): string => pathOrUrl.split(/[\\/]/).pop() || pathOrUrl;
