/**
 * Copyright 2026 One Work
 */

/**
 * Whether a local MCP service is one the company handed down. The team sync
 * writes each connector as an ordinary local row and tags its JSON with the
 * registry id it came from (`teamRegistryId`); a person's own rows never carry
 * it.
 */

export function isCompanyMcpServer(server: { original_json?: string }): boolean {
  if (!server.original_json) return false;
  try {
    const parsed = JSON.parse(server.original_json) as { teamRegistryId?: unknown };
    return typeof parsed?.teamRegistryId === 'string' && parsed.teamRegistryId.length > 0;
  } catch {
    return false;
  }
}
