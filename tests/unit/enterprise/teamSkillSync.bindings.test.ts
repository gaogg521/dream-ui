import { describe, expect, it } from 'vitest';
import { filterTeamAgentBindings } from '@/renderer/utils/enterprise/teamSkillSync';

describe('filterTeamAgentBindings', () => {
  it('keeps only enabled registry resources and merges explicit skills', () => {
    expect(
      filterTeamAgentBindings(
        {
          skillIds: ['skill-enabled', 'skill-disabled'],
          boundSkillIds: ['skill-enabled', 'skill-missing', 42],
          boundMcpIds: ['mcp-enabled', 'mcp-disabled'],
        },
        new Set(['skill-enabled']),
        new Set(['mcp-enabled'])
      )
    ).toEqual({
      skillIds: ['skill-enabled'],
      boundSkillIds: ['skill-enabled'],
      boundMcpIds: ['mcp-enabled'],
    });
  });
});
