/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Both agent factories drop built-in MCP servers on sight
 * (`if !selected || row.builtin { continue; }`), so a built-in tool only ever
 * reaches an agent by riding in the session snapshot — which in turn required
 * the user to tick it per assistant. Nobody does: every conversation in a real
 * install carries `mcp_server_ids: null`. Configuring a video model therefore
 * lit the server up in settings and still left every agent unable to make one.
 *
 * These pin the append that closes that last gap.
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type ISessionMcpServer } from '@/common/config/storage';
import { withBuiltinMediaMcp } from '@/renderer/hooks/mcp/catalog';

const server = (over: Partial<IMcpServer> & { id: string; name: string }): IMcpServer =>
  ({
    enabled: true,
    builtin: true,
    transport: { type: 'stdio', command: 'node', args: ['x.js'] },
    ...over,
  }) as IMcpServer;

const MEDIA = server({ id: 'media-1', name: BUILTIN_IMAGE_GEN_NAME });
const MEDIA_OFF = server({ id: 'media-1', name: BUILTIN_IMAGE_GEN_NAME, enabled: false });
const LEGACY = server({ id: 'media-legacy', name: 'AionUi Image Generation' });
const OTHER = server({ id: 'pdf', name: 'one-export-pdf' });

const snapshotOf = (servers: ISessionMcpServer[]) => servers.map((s) => s.id);

describe('withBuiltinMediaMcp', () => {
  it('adds the media server to an empty snapshot', () => {
    expect(snapshotOf(withBuiltinMediaMcp([], [MEDIA, OTHER]))).toEqual(['media-1']);
  });

  /**
   * Its own enabled state already tracks whether the user has a media model —
   * that is the signal this rides on, so a disabled one must stay out.
   */
  it('leaves it out when it is disabled', () => {
    expect(withBuiltinMediaMcp([], [MEDIA_OFF, OTHER])).toEqual([]);
  });

  it('recognises the legacy server name', () => {
    expect(snapshotOf(withBuiltinMediaMcp([], [LEGACY]))).toEqual(['media-legacy']);
  });

  // Ticking it explicitly still works; it must not then appear twice.
  it('does not duplicate one already in the snapshot', () => {
    const existing = [{ id: 'media-1', name: BUILTIN_IMAGE_GEN_NAME, transport: MEDIA.transport }];
    expect(snapshotOf(withBuiltinMediaMcp(existing, [MEDIA]))).toEqual(['media-1']);
  });

  it('keeps whatever the user already selected', () => {
    const existing = [{ id: 'pdf', name: 'one-export-pdf', transport: OTHER.transport }];
    expect(snapshotOf(withBuiltinMediaMcp(existing, [MEDIA, OTHER]))).toEqual(['pdf', 'media-1']);
  });

  /**
   * Only this one server is auto-enabled. Handing every agent the PDF exporter
   * and the team knowledge base is a much larger decision than "the user
   * configured a media model", and is not what this does.
   */
  it('never adds any other built-in', () => {
    expect(withBuiltinMediaMcp([], [OTHER])).toEqual([]);
  });

  it('survives a missing provider list', () => {
    expect(withBuiltinMediaMcp([], undefined)).toEqual([]);
    expect(withBuiltinMediaMcp([], [])).toEqual([]);
  });
});
