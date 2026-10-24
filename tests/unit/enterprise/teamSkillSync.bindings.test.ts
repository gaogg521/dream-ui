import { describe, expect, it } from 'vitest';
import { filterTeamAgentBindings, resolveTeamMediaSettings } from '@/renderer/utils/enterprise/teamSkillSync';

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

describe('enterprise media catalog handoff', () => {
  it('uses the standalone Agnes catalog before changing the URL to a proxy', () => {
    const settings = resolveTeamMediaSettings({
      name: 'Agnes',
      platform: 'openai',
      upstreamBaseUrl: 'https://apihub.agnes-ai.com/v1',
      models: JSON.stringify(['agnes-3.0-flash', 'agnes-video-2.5-flash', 'agnes-image-2.5-flash']),
    });
    expect(settings?.['agnes-video-2.5-flash']).toMatchObject({ model_kind: 'video', media_endpoint: 'agnes-task' });
    expect(settings?.['agnes-image-2.5-flash']).toMatchObject({ model_kind: 'image', media_endpoint: 'agnes-image' });
    expect(settings?.['agnes-3.0-flash']).toBeUndefined();
  });
  it('preserves an explicit text declaration and custom settings', () => {
    const settings = resolveTeamMediaSettings({
      name: 'Agnes',
      platform: 'openai',
      upstreamBaseUrl: 'https://api.agnes-ai.cn/v1',
      models: '["agnes-video-2.5-flash"]',
      modelSettings: JSON.stringify({ 'agnes-video-2.5-flash': { model_kind: 'text', image_input: 'enabled' } }),
    });
    expect(settings?.['agnes-video-2.5-flash']).toEqual({ model_kind: 'text', image_input: 'enabled' });
  });
});
