/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * A backslash in front of a character JavaScript does not recognise as an
 * escape is not an error — the backslash is silently dropped. `'HKLM\SOFTWARE'`
 * is the string `HKLMSOFTWARE`, and nothing anywhere says so.
 *
 * That shipped: `readPlatformMachineId` asked `reg query` for
 * `HKLM\SOFTWARE\Microsoft\Cryptography`, the literal collapsed to
 * `HKLMSOFTWAREMicrosoftCryptography`, the command threw, the surrounding
 * try/catch swallowed it, and every Windows install fell through to the
 * random-UUID branch — the per-install duplication that function exists to
 * remove. An id was always produced, so the failure was invisible.
 *
 * Windows paths, registry keys and regex source kept in strings are all written
 * this way, so the mistake is one keystroke away and never announces itself.
 *
 * The scan walks the TypeScript AST rather than matching quotes with a regex:
 * a regex literal like `/(["']?token["']?\s*[=:])/` is full of quotes and
 * backslashes and would light up every text-based scanner, and the first person
 * to hit that false positive deletes the check.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const projectRoot = resolve(__dirname, '../../..');
const sourceRoot = resolve(projectRoot, 'packages/desktop/src');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Escapes JavaScript actually assigns a meaning to. Anything else is a
 * backslash that evaluates to nothing.
 *
 * `\n` inside a literal is a line continuation, and the digits cover legacy
 * octal escapes, which are meaningful (if deprecated) rather than dropped.
 */
const MEANINGFUL_ESCAPES = new Set([
  'n',
  'r',
  't',
  'b',
  'f',
  'v',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'x',
  'u',
  '\\',
  "'",
  '"',
  '`',
  '\n',
  '\r',
]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(target, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    out.push(target);
  }
  return out;
}

/** Every `\<char>` in a string literal's raw text whose backslash JS discards. */
export function droppedEscapes(rawLiteralBody: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < rawLiteralBody.length; i += 1) {
    if (rawLiteralBody[i] !== '\\') continue;
    const next = rawLiteralBody[i + 1];
    if (next === undefined) break;
    if (!MEANINGFUL_ESCAPES.has(next)) found.push(`\\${next}`);
    i += 1; // The escaped character is consumed either way.
  }
  return found;
}

function scanFile(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) {
      // Raw text with the surrounding quotes stripped, so the AST decides what
      // is a string and what is a regex, an import path or a comment.
      const raw = source.slice(node.getStart(sourceFile) + 1, node.getEnd() - 1);
      const dropped = droppedEscapes(raw);
      if (dropped.length > 0) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        offenders.push(
          `${relative(projectRoot, file)}:${line + 1} ${dropped.join(' ')} in ${node.getText(sourceFile)}`
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return offenders;
}

describe('string literals with silently dropped backslashes', () => {
  it('do not appear anywhere under packages/desktop/src', () => {
    const offenders = collectSourceFiles(sourceRoot).flatMap(scanFile);
    expect(offenders).toEqual([]);
  });

  it('flags an unescaped Windows path but not the escapes that mean something', () => {
    // Guards the guard: a check that also fired on '\n' or '\\' would be turned
    // off by the next person who hit the false positive.
    expect(droppedEscapes('HKLM\\SOFTWARE\\Microsoft')).toEqual(['\\S', '\\M']);
    expect(droppedEscapes('HKLM\\\\SOFTWARE')).toEqual([]);
    expect(droppedEscapes('line\\nbreak\\ttab\\u0041\\x41')).toEqual([]);
  });
});
