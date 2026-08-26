/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

// Keep this constant local to avoid pulling in common/config/storage side effects
// when the built-in MCP server boots in a standalone stdio process.
export const BUILTIN_IMAGE_GEN_ID = 'builtin-image-gen';
export const BUILTIN_IMAGE_GEN_NAME = 'one-image-generation';
export const BUILTIN_IMAGE_GEN_LEGACY_NAMES = [
  'aionui-image-generation',
  'AionUi Image Generation',
  BUILTIN_IMAGE_GEN_ID,
] as const;

export function isBuiltinImageGenName(name?: string | null): boolean {
  if (!name) return false;
  return (
    name === BUILTIN_IMAGE_GEN_NAME ||
    BUILTIN_IMAGE_GEN_LEGACY_NAMES.includes(name as (typeof BUILTIN_IMAGE_GEN_LEGACY_NAMES)[number])
  );
}

export function isBuiltinImageGenTransport(transport?: {
  type?: string;
  command?: string;
  args?: string[] | null;
}): boolean {
  if (!transport || transport.type !== 'stdio' || transport.command !== 'node') {
    return false;
  }

  return (transport.args || []).some((arg) => typeof arg === 'string' && arg.includes('builtin-mcp-image-gen.js'));
}

export const BUILTIN_EXPORT_PDF_ID = 'builtin-export-pdf';
export const BUILTIN_EXPORT_PDF_NAME = 'one-export-pdf';
export const BUILTIN_EXPORT_PDF_LEGACY_NAMES = [BUILTIN_EXPORT_PDF_ID] as const;

export function isBuiltinExportPdfName(name?: string | null): boolean {
  if (!name) return false;
  return (
    name === BUILTIN_EXPORT_PDF_NAME ||
    BUILTIN_EXPORT_PDF_LEGACY_NAMES.includes(name as (typeof BUILTIN_EXPORT_PDF_LEGACY_NAMES)[number])
  );
}

export function isBuiltinExportPdfTransport(transport?: {
  type?: string;
  command?: string;
  args?: string[] | null;
}): boolean {
  if (!transport || transport.type !== 'stdio' || transport.command !== 'node') {
    return false;
  }

  return (transport.args || []).some((arg) => typeof arg === 'string' && arg.includes('builtin-mcp-export-pdf.js'));
}

export const BUILTIN_TEAM_KNOWLEDGE_ID = 'builtin-team-knowledge';
export const BUILTIN_TEAM_KNOWLEDGE_NAME = 'one-team-knowledge';
export const BUILTIN_TEAM_KNOWLEDGE_LEGACY_NAMES = [BUILTIN_TEAM_KNOWLEDGE_ID] as const;

export function isBuiltinTeamKnowledgeName(name?: string | null): boolean {
  if (!name) return false;
  return (
    name === BUILTIN_TEAM_KNOWLEDGE_NAME ||
    BUILTIN_TEAM_KNOWLEDGE_LEGACY_NAMES.includes(name as (typeof BUILTIN_TEAM_KNOWLEDGE_LEGACY_NAMES)[number])
  );
}

export function isBuiltinTeamKnowledgeTransport(transport?: {
  type?: string;
  command?: string;
  args?: string[] | null;
}): boolean {
  if (!transport || transport.type !== 'stdio' || transport.command !== 'node') {
    return false;
  }

  return (transport.args || []).some((arg) => typeof arg === 'string' && arg.includes('builtin-mcp-team-knowledge.js'));
}
