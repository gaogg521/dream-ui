/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
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
vi.mock('@/renderer/hooks/mcp/catalog', () => ({ ensureBackendMcpCatalog: vi.fn(async () => ({ allServers: [] })) }));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: mocks.getConversation,
}));
vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  loadLatestConversationMessages: mocks.loadMessages,
}));

import { startSceneConversation } from '@/renderer/utils/scenes/sceneChat';
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
