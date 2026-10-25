/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  browserToolDisplayName,
  browserToolLabelKey,
  isBrowserToolName,
  normalizeBrowserToolName,
} from '@/renderer/pages/conversation/Messages/components/browserToolLabels';

const t = (key: string) => `«${key}»`;

describe('normalizeBrowserToolName', () => {
  it('strips the built-in server prefixes', () => {
    expect(normalizeBrowserToolName('one-browser__navigate_page')).toBe('navigate_page');
    expect(normalizeBrowserToolName('mcp__one-browser__click')).toBe('click');
  });

  it('keeps only the trailing token for other engines and strips annotations', () => {
    expect(normalizeBrowserToolName('chrome-devtools__navigate_page (chrome-devtools MCP Server)')).toBe(
      'navigate_page'
    );
  });
});

describe('isBrowserToolName', () => {
  it('accepts the built-in server namespace only', () => {
    expect(isBrowserToolName('one-browser__click')).toBe(true);
    expect(isBrowserToolName('mcp__one-browser__click')).toBe(true);
    expect(isBrowserToolName('other-server__click')).toBe(false);
    expect(isBrowserToolName('WriteFile')).toBe(false);
  });
});

describe('browserToolLabelKey', () => {
  it('maps known browser tools to label keys', () => {
    expect(browserToolLabelKey('one-browser__navigate_page')).toBe('preview.browser.tool.navigatePage');
    expect(browserToolLabelKey('mcp__one-browser__take_screenshot')).toBe('preview.browser.tool.takeScreenshot');
  });

  it('returns null for unknown tools inside the server namespace', () => {
    expect(browserToolLabelKey('one-browser__performance_start_trace')).toBeNull();
  });

  it('returns null for same-named tools from other servers', () => {
    expect(browserToolLabelKey('other-mcp__click')).toBeNull();
    expect(browserToolLabelKey('WriteFile')).toBeNull();
  });
});

describe('browserToolDisplayName', () => {
  it('translates browser tools and keeps everything else raw', () => {
    expect(browserToolDisplayName('one-browser__navigate_page', t)).toBe('«preview.browser.tool.navigatePage»');
    expect(browserToolDisplayName('WriteFile', t)).toBe('WriteFile');
  });
});
