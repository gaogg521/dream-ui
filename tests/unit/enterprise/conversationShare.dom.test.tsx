import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { shareConversationToMySession } from '@renderer/utils/enterprise/conversationShare';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  getMessages: vi.fn(),
  importShared: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Modal: { confirm: mocks.confirm },
  Select: { Option: 'option' },
  Message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessages: { invoke: mocks.getMessages } },
    conversation: { importShared: { invoke: mocks.importShared }, sendMessage: { invoke: mocks.sendMessage } },
  },
}));

const source = { id: 'source', name: 'Original' };
const translate = ((key: string) => key) as TFunction;

describe('personal conversation sharing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getMessages.mockResolvedValue({
      items: [{ type: 'text', content: { content: 'Hello' }, position: 'right', created_at: 42 }],
    });
  });

  it('imports the history into a new session when there are no other sessions', async () => {
    mocks.confirm.mockImplementation(({ onOk }) => onOk());
    mocks.importShared.mockResolvedValue({ conversationId: 'new', importedMessages: 1 });
    const openNewSession = vi.fn();

    await expect(shareConversationToMySession(source, [source], translate, openNewSession)).resolves.toBe('shared');
    expect(mocks.importShared).toHaveBeenCalledWith({
      name: 'Original',
      messages: [{ type: 'text', content: '{"content":"Hello"}', position: 'right', createdAt: 42 }],
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(openNewSession).toHaveBeenCalledWith('new');
  });

  it('keeps sending a snapshot without a model reply to an existing session', async () => {
    mocks.confirm.mockImplementation(({ content, onOk }) => {
      content.props.onChange('target');
      onOk();
    });

    await expect(shareConversationToMySession(source, [source, { id: 'target' }], translate, vi.fn())).resolves.toBe(
      'shared'
    );
    expect(mocks.importShared).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      conversation_id: 'target',
      input: expect.stringContaining('[[SESSION_SHARE]]'),
      reply_requested: false,
    });
  });

  it('does not read or import history on cancel', async () => {
    mocks.confirm.mockImplementation(({ onCancel }) => onCancel());
    await expect(shareConversationToMySession(source, [source], translate, vi.fn())).resolves.toBe('cancelled');
    expect(mocks.getMessages).not.toHaveBeenCalled();
    expect(mocks.importShared).not.toHaveBeenCalled();
  });
});
