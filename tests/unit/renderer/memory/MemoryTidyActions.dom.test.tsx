import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  status: vi.fn(),
  compact: vi.fn(),
  undo: vi.fn(),
  claudeStatus: vi.fn(),
  claudeCompact: vi.fn(),
  claudeUndo: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  memory: {
    engineCompactionStatus: { invoke: api.status },
    engineCompact: { invoke: api.compact },
    engineUndoCompaction: { invoke: api.undo },
    claudeCompactionStatus: { invoke: api.claudeStatus },
    claudeCompact: { invoke: api.claudeCompact },
    claudeUndoCompaction: { invoke: api.claudeUndo },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Message: { success: api.success, error: api.error },
  Modal: { confirm: api.confirm },
}));
import MemoryTidyActions from '@/renderer/pages/memory/MemoryTidyActions';
beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue({ total: 3, mergeable: 2, suggested: false, backup: null });
  api.compact.mockResolvedValue({ merged: 2, mergedInto: 1, kept: 1 });
});
it('waits for explicit consent and operates on the selected project group', async () => {
  const changed = vi.fn();
  render(<MemoryTidyActions groupId='qa-project' label='QA Project' onChanged={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'memory.tidy.button' }));
  expect(api.compact).not.toHaveBeenCalled();
  const config = api.confirm.mock.calls[0][0];
  expect(config.title).toContain('QA Project');
  await act(async () => {
    await config.onOk();
  });
  expect(api.compact).toHaveBeenCalledWith({ groupId: 'qa-project' });
  expect(changed).toHaveBeenCalled();
});
it('binds Claude consent to the project returned by the status request', async () => {
  api.claudeStatus.mockResolvedValue({
    total: 3,
    mergeable: 2,
    backup: null,
    groupId: 'D--中文验收',
    label: 'D:/中文验收',
  });
  api.claudeCompact.mockResolvedValue({ merged: 2, mergedInto: 1, kept: 1 });
  render(<MemoryTidyActions claude label='Claude Code' onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'memory.tidy.button' }));
  const config = api.confirm.mock.calls[0][0];
  expect(config.title).toContain('D:/中文验收');
  await act(async () => {
    await config.onOk();
  });
  expect(api.claudeCompact).toHaveBeenCalledWith({ groupId: 'D--中文验收' });
});
it('does not report success when the project changed or the backup is unavailable', async () => {
  api.status.mockResolvedValue({ total: 3, mergeable: 0, backup: { id: 'backup' } });
  api.undo.mockResolvedValue({ restored: false });
  render(<MemoryTidyActions groupId='qa' label='QA' onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'memory.tidy.undo' }));
  await act(async () => {
    await api.confirm.mock.calls[0][0].onOk();
  });
  expect(api.error).toHaveBeenCalled();
  expect(api.success).not.toHaveBeenCalled();
});
