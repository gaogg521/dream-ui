/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * Arco's Tooltip / Popover / Popconfirm / Dropdown / Trigger locate their
 * child's DOM node through a ref. An IconPark icon is a plain function
 * component that doesn't forward refs, so Arco falls back to
 * `ReactDOM.findDOMNode` — which React 19 removed. It gets null, and the
 * first hover throws (`reading 'offsetParent'`) inside a layout effect,
 * which unmounts the entire app: a blank window with no error UI.
 *
 * This happened twice (the trial balance search icon, and the scheduled
 * task error icon). Wrap the icon in a `<span>`, or use an Arco `Button`
 * with `icon=` — both forward a real DOM node.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RENDERER_ROOT = path.resolve(__dirname, '../../../packages/desktop/src/renderer');
const TRIGGER_COMPONENTS = ['Tooltip', 'Popover', 'Popconfirm', 'Dropdown', 'Trigger'];

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function iconParkNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@icon-park\/react'/g)) {
    for (const spec of match[1].split(',')) {
      const local = spec
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (local) names.add(local);
    }
  }
  return names;
}

function findBareIconTriggers(file: string, source: string): string[] {
  const icons = iconParkNames(source);
  if (icons.size === 0) return [];
  const pattern = new RegExp(`<(${TRIGGER_COMPONENTS.join('|')})\\b[^>]*>\\s*<([A-Z][A-Za-z0-9]*)\\b`, 'g');
  const hits: string[] = [];
  for (const match of source.matchAll(pattern)) {
    if (icons.has(match[2])) {
      const line = source.slice(0, match.index).split('\n').length;
      hits.push(`${path.relative(RENDERER_ROOT, file)}:${line} <${match[1]}><${match[2]}>`);
    }
  }
  return hits;
}

describe('Arco trigger components never wrap a bare IconPark icon', () => {
  it('flags the pattern that crashed the app', () => {
    const crashing = [
      "import { Search } from '@icon-park/react';",
      '<Tooltip content={tip}>',
      '  <Search size={14} />',
      '</Tooltip>',
    ].join('\n');
    expect(findBareIconTriggers(path.join(RENDERER_ROOT, 'x.tsx'), crashing)).toHaveLength(1);
  });

  it('accepts an icon wrapped in a DOM element', () => {
    const safe = [
      "import { Search } from '@icon-park/react';",
      '<Tooltip content={tip}>',
      '  <span><Search size={14} /></span>',
      '</Tooltip>',
    ].join('\n');
    expect(findBareIconTriggers(path.join(RENDERER_ROOT, 'x.tsx'), safe)).toEqual([]);
  });

  it('holds across the renderer', () => {
    const hits = listTsxFiles(RENDERER_ROOT).flatMap((file) =>
      findBareIconTriggers(file, fs.readFileSync(file, 'utf8'))
    );
    expect(hits).toEqual([]);
  });
});
