import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ data: new Map<string, unknown>(), fail: false, writes: 0 }));
vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: async (key: string) => {
      if (state.fail) throw Error('unavailable');
      return state.data.get(key);
    },
    set: async (key: string, value: unknown) => {
      state.writes++;
      state.data.set(key, value);
    },
  },
}));
import { defaultScenes, loadScenesWithDefaults } from '@/renderer/utils/scenes/defaultScenes';
import { buildSceneConversationRequest } from '@/renderer/utils/scenes/sceneChat';
import { personalSceneItem } from '@/renderer/utils/scenes/sceneItem';
import { normalizePersonalScene } from '@/renderer/utils/scenes/personalScenes';

describe('bundled work and life scenes', () => {
  beforeEach(() => {
    state.data.clear();
    state.fail = false;
    state.writes = 0;
    state.data.set('language', 'zh-CN');
  });
  it('gives a new installation two usable focused setups with example requests', async () => {
    const scenes = await loadScenesWithDefaults();
    expect(scenes.map((s) => s.name)).toEqual(['工作助手', '生活助手']);
    expect(scenes.every((s) => s.skillNames.length === 1 && s.builtinMcpNames?.length === 3)).toBe(true);
    expect(scenes.every((s) => !s.intent.discovery && personalSceneItem(s).starters.length > 0)).toBe(true);
    expect((await Promise.all([loadScenesWithDefaults(), loadScenesWithDefaults()]))[0]).toHaveLength(2);
  });
  it('preserves existing scenes and edits, and never resurrects a deleted default', async () => {
    state.data.set('scenes.personal', [{ id: 'mine', name: 'My existing scene' }]);
    const seeded = await loadScenesWithDefaults();
    expect(seeded.map((s) => s.id)).toContain('mine');
    state.data.set(
      'scenes.personal',
      seeded.filter((s) => s.id !== 'builtin-life-v1').map((s) => ({ ...s, name: 'Edited' }))
    );
    const reloaded = await loadScenesWithDefaults();
    expect(reloaded).toHaveLength(2);
    expect(reloaded.every((s) => s.name === 'Edited')).toBe(true);
  });
  it('does not overwrite an unreadable or unknown store', async () => {
    state.fail = true;
    expect(await loadScenesWithDefaults()).toEqual([]);
    expect(state.writes).toBe(0);
    state.fail = false;
    state.data.set('scenes.personal', { unknown: true });
    expect(await loadScenesWithDefaults()).toEqual([]);
    expect(state.writes).toBe(0);
  });
  it('keeps portable builtin bindings through persistence and resolves only trusted enabled tools', () => {
    const scene = normalizePersonalScene(defaultScenes('en-US')[0])!;
    const request = buildSceneConversationRequest({
      item: personalSceneItem(scene),
      skills: [{ name: 'one-work-assistant', location: '/builtin/one-work-assistant' }],
      model: { id: 'test', use_model: 'test' } as never,
      mcpServers: [
        {
          id: 'browser',
          name: 'one-browser',
          builtin: true,
          enabled: true,
          transport: { type: 'stdio', command: 'node', args: ['bundled.js'] },
        },
        { id: 'spoof', name: 'one-export-pdf', builtin: false },
        { id: 'off', name: 'one-page-reader', builtin: true, enabled: false },
      ],
    });
    expect(request.extra.selected_mcp_server_ids).toEqual(['browser']);
    expect(request.extra.selected_session_mcp_servers).toEqual([
      { id: 'browser', name: 'one-browser', transport: { type: 'stdio', command: 'node', args: ['bundled.js'] } },
    ]);
    expect(request.extra.enabled_skills).toEqual(['one-work-assistant']);
    expect(request.extra.preset_rules).not.toContain('Step 2 - Requirements round');
  });
});
