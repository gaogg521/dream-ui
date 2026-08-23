/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type PreviewContentType =
  | 'markdown'
  | 'diff'
  | 'code'
  | 'html'
  | 'pdf'
  | 'ppt'
  | 'word'
  | 'excel'
  | 'image'
  // Plain text with a table shape. Split out of `excel` because officecli — the
  // renderer `excel` routes to — does not accept .csv at all, so every CSV opened
  // failed there while being perfectly readable as text.
  | 'csv'
  // Formats we can identify but genuinely cannot render: legacy Office binaries,
  // ODF, macro-enabled Office, and HEIC. Previously these were routed to a
  // renderer that could not open them, so they failed with a message telling the
  // user to install officecli — which would not have helped for any of them.
  | 'unsupported'
  | 'url'
  | 'browser';

export interface PreviewHistoryTarget {
  contentType: PreviewContentType;
  file_path?: string;
  workspace?: string;
  file_name?: string;
  title?: string;
  language?: string;
  conversation_id?: string;
}

export interface PreviewSnapshotInfo {
  id: string;
  label: string;
  created_at: number;
  size: number;
  contentType: PreviewContentType;
  file_name?: string;
  file_path?: string;
}

export interface RemoteImageFetchRequest {
  url: string;
}
