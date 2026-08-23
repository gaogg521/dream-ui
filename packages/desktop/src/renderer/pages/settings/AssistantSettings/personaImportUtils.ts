/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal parser for Claude Code sub-agent `.md` files: a YAML frontmatter
 * block (`name` / `description` / `tools`) followed by a Markdown body that
 * is the system prompt. Deliberately not a general YAML parser — frontmatter
 * in this format is flat scalar `key: value` pairs, at most a folded (`>`)
 * or literal (`|`) block scalar for long fields. `tools:` (a CLI-specific
 * allow-list) is intentionally never extracted — One Work has no equivalent
 * concept for imported personas.
 */

export interface ParsedPersonaFile {
  filePath: string;
  fileName: string;
  /** Stable id/source_ref for the assistant — the filename stem. */
  id: string;
  name: string;
  description: string;
  ruleContent: string;
  /** True when `description` was recovered from the body fallback because
   * the frontmatter value was missing or a broken empty folded scalar
   * (a known artifact of some source extraction pipelines). */
  descriptionFallback: boolean;
}

export interface PersonaParseFailure {
  filePath: string;
  fileName: string;
  error: string;
}

const MAX_FALLBACK_DESCRIPTION_LENGTH = 120;

const BLOCK_SCALAR_INDICATORS = new Set(['>', '>-', '>+', '|', '|-', '|+']);

function idFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, '').trim();
}

function nameFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Split `---\n<frontmatter>\n---\n<body>` into its two parts. Returns
 * `null` if the content has no valid frontmatter block, in which case the
 * whole file is treated as the rule body with no metadata.
 */
function splitFrontmatter(content: string): { frontmatter: string[]; body: string } | null {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return null;
  }
  const lines = normalized.split('\n');
  if (lines[0] !== '---') return null;

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) return null;

  return {
    frontmatter: lines.slice(1, closingIndex),
    body: lines.slice(closingIndex + 1).join('\n'),
  };
}

/**
 * Extract a scalar `key: value` field from a frontmatter line block,
 * including a following folded/literal block scalar's continuation lines.
 * Returns `''` when the field is absent, or present but empty (e.g. a
 * folded-scalar indicator with no indented continuation — the broken
 * pattern this importer specifically guards against).
 */
function extractScalarField(lines: string[], key: string): string {
  const prefix = `${key}:`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) return '';

  const rest = lines[index].slice(prefix.length).trim();

  if (BLOCK_SCALAR_INDICATORS.has(rest)) {
    const isFolded = rest.startsWith('>');
    const continuationLines: string[] = [];
    for (let i = index + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0) {
        continuationLines.push('');
        continue;
      }
      if (!/^\s/.test(line)) break;
      continuationLines.push(line.replace(/^\s{1,4}/, ''));
    }
    // Trim trailing blank continuation lines.
    while (continuationLines.length > 0 && continuationLines[continuationLines.length - 1] === '') {
      continuationLines.pop();
    }
    if (continuationLines.length === 0) return '';
    return isFolded ? continuationLines.join(' ').trim() : continuationLines.join('\n').trim();
  }

  return stripWrappingQuotes(rest);
}

/** First non-empty, non-heading line of the body, used as a description
 * fallback when the frontmatter didn't carry a usable one. */
function firstBodyParagraph(body: string): string {
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    return line.length > MAX_FALLBACK_DESCRIPTION_LENGTH
      ? `${line.slice(0, MAX_FALLBACK_DESCRIPTION_LENGTH).trimEnd()}…`
      : line;
  }
  return '';
}

export function parsePersonaMarkdownFile(
  filePath: string,
  fileName: string,
  content: string
): ParsedPersonaFile | PersonaParseFailure {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return { filePath, fileName, error: 'File is empty' };
  }

  const id = idFromFileName(fileName);
  if (!id) {
    return { filePath, fileName, error: 'Could not derive an id from the file name' };
  }

  const split = splitFrontmatter(trimmedContent);
  const frontmatterName = split ? extractScalarField(split.frontmatter, 'name') : '';
  const frontmatterDescription = split ? extractScalarField(split.frontmatter, 'description') : '';
  const body = (split ? split.body : trimmedContent).trim();

  if (!body) {
    return { filePath, fileName, error: 'File has no prompt body after its frontmatter' };
  }

  const name = frontmatterName || nameFromId(id);
  const descriptionFallback = !frontmatterDescription;
  const description = frontmatterDescription || firstBodyParagraph(body);

  return {
    filePath,
    fileName,
    id,
    name,
    description,
    ruleContent: body,
    descriptionFallback,
  };
}

export function isPersonaParseFailure(value: ParsedPersonaFile | PersonaParseFailure): value is PersonaParseFailure {
  return 'error' in value;
}
