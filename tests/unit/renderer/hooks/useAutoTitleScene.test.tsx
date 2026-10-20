/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  loadMessages: vi.fn(),
  update: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'conversation.welcome.newConversation' ? '新会话' : key) }),
}));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { update: { invoke: mocks.update } } } }));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: mocks.getConversation,
}));
vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  DEFAULT_MESSAGE_PAGE_LIMIT: 50,
  loadLatestConversationMessages: mocks.loadMessages,
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit } }));

import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';

describe('useAutoTitle for a conversation opened from a scene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadMessages.mockResolvedValue({ items: [] });
    mocks.update.mockResolvedValue(true);
  });

  it('retitles a conversation that still carries the scene name, so the history is not a column of identical rows', async () => {
    mocks.getConversation.mockResolvedValue({
      id: 'c1',
      name: '数据分析与报告',
      extra: { scene_greeting: { name: '数据分析与报告' } },
    });
    const { result } = renderHook(() => useAutoTitle());
    await result.current.checkAndUpdateTitle('c1', '帮我分析这份销售数据');
    expect(mocks.update).toHaveBeenCalledWith({
      id: 'c1',
      updates: { name: '帮我分析这份销售数据', name_source: 'auto' },
    });
    expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('leaves a title the person or the agent already chose alone', async () => {
    mocks.getConversation.mockResolvedValue({
      id: 'c1',
      name: '我改过的名字',
      extra: { scene_greeting: { name: '数据分析与报告' } },
    });
    const { result } = renderHook(() => useAutoTitle());
    await result.current.checkAndUpdateTitle('c1', '帮我分析这份销售数据');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not treat a plain conversation that happens to be named like a scene as a scene one', async () => {
    mocks.getConversation.mockResolvedValue({ id: 'c2', name: '数据分析与报告', extra: {} });
    const { result } = renderHook(() => useAutoTitle());
    await result.current.checkAndUpdateTitle('c2', '帮我分析这份销售数据');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('still retitles the ordinary default-named conversation', async () => {
    mocks.getConversation.mockResolvedValue({ id: 'c3', name: '新会话', extra: {} });
    const { result } = renderHook(() => useAutoTitle());
    await result.current.checkAndUpdateTitle('c3', '你好');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
