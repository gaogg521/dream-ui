import { describe, expect, it } from 'vitest';
import { skillRowKey } from '@/renderer/pages/settings/skillsHub/skillRowKey';

describe('skillRowKey', () => {
  it('keeps a personal skill and a company skill with the same name apart', () => {
    const mine = { name: 'skill-creator', source: 'custom', location: 'D:/users/u1/skill-creator' };
    const company = { name: 'skill-creator', source: 'team', location: 'D:/1one/team-skills/oskill_1' };
    expect(skillRowKey(mine)).not.toBe(skillRowKey(company));
  });

  it('falls back to source and name when a row has no location', () => {
    expect(skillRowKey({ name: 'a', source: 'builtin' })).toBe('builtin:a');
    expect(skillRowKey({ name: 'a' })).toBe('unknown:a');
  });
});
