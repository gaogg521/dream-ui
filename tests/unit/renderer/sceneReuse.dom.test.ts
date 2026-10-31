/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  catalog: vi.fn(),
  create: vi.fn(),
  getConversation: vi.fn(),
  loadMessages: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: mocks.listAvailableSkills } },
    conversation: { create: { invoke: mocks.create } },
  },
}));
vi.mock('@/renderer/hooks/mcp/catalog', () => ({ ensureBackendMcpCatalog: mocks.catalog }));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: mocks.getConversation,
}));
vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  loadLatestConversationMessages: mocks.loadMessages,
}));

import { SceneDependencyUnavailableError, startSceneConversation } from '@/renderer/utils/scenes/sceneChat';
import { personalSceneItem } from '@/renderer/utils/scenes/sceneItem';
import { newPersonalScene } from '@/renderer/utils/scenes/personalScenes';
import type { TProviderWithModel } from '@/common/config/storage';

const model = { id: 'prov_1', use_model: 'm1' } as unknown as TProviderWithModel;
const item = personalSceneItem(newPersonalScene({ name: '数据分析', prompt: '你是分析师。' }));

describe('startSceneConversation reuses an untouched conversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.listAvailableSkills.mockResolvedValue([]);
    mocks.catalog.mockResolvedValue({ allServers: [] });
    let next = 0;
    mocks.create.mockImplementation(async () => ({ id: `conv_${++next}` }));
    mocks.getConversation.mockImplementation(async (id: string) => ({ id, name: '数据分析' }));
    mocks.loadMessages.mockResolvedValue({ items: [] });
  });

  it('creates the first time, then opens the same empty conversation again', async () => {
    expect(await startSceneConversation(item, model)).toBe('conv_1');
    expect(await startSceneConversation(item, model)).toBe('conv_1');
    expect(await startSceneConversation(item, model)).toBe('conv_1');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('starts a new one once something has been said in the old one', async () => {
    await startSceneConversation(item, model);
    mocks.loadMessages.mockResolvedValue({ items: [{ id: 'm1' }] });
    expect(await startSceneConversation(item, model)).toBe('conv_2');
    // The new one is the reusable one from now on.
    mocks.loadMessages.mockResolvedValue({ items: [] });
    expect(await startSceneConversation(item, model)).toBe('conv_2');
  });

  it('starts a new one when the old one was renamed or deleted', async () => {
    await startSceneConversation(item, model);
    mocks.getConversation.mockResolvedValueOnce({ id: 'conv_1', name: '帮我分析销售数据' });
    expect(await startSceneConversation(item, model)).toBe('conv_2');
    mocks.getConversation.mockResolvedValueOnce(null);
    expect(await startSceneConversation(item, model)).toBe('conv_3');
  });

  it('does not reuse across a different folder, a different model or an edited scene', async () => {
    await startSceneConversation(item, model, 'D:/work/a');
    expect(await startSceneConversation(item, model, 'D:/work/b')).toBe('conv_2');
    expect(
      await startSceneConversation(
        item,
        { id: 'prov_1', use_model: 'm2' } as unknown as TProviderWithModel,
        'D:/work/b'
      )
    ).toBe('conv_3');
    const edited = personalSceneItem({ ...item.mine!, prompt: '你是另一个角色。' });
    expect(
      await startSceneConversation(
        edited,
        { id: 'prov_1', use_model: 'm2' } as unknown as TProviderWithModel,
        'D:/work/b'
      )
    ).toBe('conv_4');
  });

  it('keeps each scene to its own conversation', async () => {
    const other = personalSceneItem(newPersonalScene({ name: '周报', prompt: '你是秘书。' }));
    expect(await startSceneConversation(item, model)).toBe('conv_1');
    expect(await startSceneConversation(other, model)).toBe('conv_2');
    expect(await startSceneConversation(item, model)).toBe('conv_1');
  });

  it('falls back to a new conversation when the lookup itself fails', async () => {
    await startSceneConversation(item, model);
    mocks.loadMessages.mockRejectedValueOnce(new Error('backend busy'));
    expect(await startSceneConversation(item, model)).toBe('conv_2');
  });
});

describe('bundled scene dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.create.mockResolvedValue({ id: 'scene-ready' });
  });

  it.each([
    ['one-work-assistant', 'one-export-pdf'],
    ['one-life-assistant', 'one-html-render'],
  ])('opens %s after its disabled bundled tool is restored', async (skill, outputTool) => {
    const tools = ['one-browser', 'one-page-reader', outputTool];
    const servers = tools.map((name) => ({
      id: name,
      name,
      builtin: true,
      enabled: name !== outputTool,
      transport: { type: 'stdio', command: 'node' },
    }));
    mocks.listAvailableSkills.mockResolvedValue([{ name: skill, location: `/builtin/${skill}` }]);
    mocks.catalog.mockResolvedValue({ allServers: servers });
    const scene = personalSceneItem(newPersonalScene({ name: skill, skillNames: [skill], builtinMcpNames: tools }));
    await expect(startSceneConversation(scene, model)).rejects.toMatchObject({ dependencies: [outputTool] });
    servers[2].enabled = true;
    expect(await startSceneConversation(scene, model)).toBe('scene-ready');
    expect(
      mocks.create.mock.calls[0][0].extra.selected_session_mcp_servers.map((entry: { name: string }) => entry.name)
    ).toEqual(tools);
  });

  it('names disabled tools and missing skills without creating a partial chat', async () => {
    mocks.create.mockClear();
    mocks.listAvailableSkills.mockResolvedValue([]);
    mocks.catalog.mockResolvedValue({
      allServers: [
        {
          id: 'off',
          name: 'one-browser',
          builtin: true,
          enabled: false,
          transport: { type: 'stdio', command: 'node' },
        },
      ],
    });
    const scene = personalSceneItem(
      newPersonalScene({
        name: 'Work',
        skillNames: ['one-work-assistant'],
        builtinMcpNames: ['one-browser'],
      })
    );
    const error = await startSceneConversation(scene, model).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SceneDependencyUnavailableError);
    expect(error).toMatchObject({
      disabledTools: ['one-browser'],
      missingTools: [],
      missingSkills: ['one-work-assistant'],
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
