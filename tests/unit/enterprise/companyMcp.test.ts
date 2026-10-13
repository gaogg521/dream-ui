/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isCompanyMcpServer } from '@/renderer/utils/enterprise/companyMcp';

describe('isCompanyMcpServer', () => {
  it('recognises a row the team sync wrote, by the registry id it carries', () => {
    expect(isCompanyMcpServer({ original_json: '{"teamRegistryId":"omcp_1","mcpServers":{}}' })).toBe(true);
  });

  it('is false for a person own server, whatever else its JSON holds', () => {
    expect(isCompanyMcpServer({ original_json: '{"mcpServers":{"a":{"command":"x"}}}' })).toBe(false);
    expect(isCompanyMcpServer({ original_json: '{}' })).toBe(false);
  });

  it('is false for missing, empty or unreadable JSON, and for a registry id that is not a string', () => {
    expect(isCompanyMcpServer({})).toBe(false);
    expect(isCompanyMcpServer({ original_json: '' })).toBe(false);
    expect(isCompanyMcpServer({ original_json: 'not json' })).toBe(false);
    expect(isCompanyMcpServer({ original_json: '{"teamRegistryId":7}' })).toBe(false);
    expect(isCompanyMcpServer({ original_json: '{"teamRegistryId":""}' })).toBe(false);
    expect(isCompanyMcpServer({ original_json: 'null' })).toBe(false);
  });
});
