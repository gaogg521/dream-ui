import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { oneDevops: { getRagContent: { invoke: calls.read } } } }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  isNativeDialogAvailable: () => true,
  memory: { engineImportReference: { invoke: calls.save } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', async () => ({
  ...(await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react')),
  Message: { success: calls.success, warning: calls.warning, error: calls.error },
}));
import SaveAsMemoryButton from '@/renderer/pages/knowledge/attach/SaveAsMemoryButton';
beforeEach(() => {
  vi.clearAllMocks();
  calls.read.mockResolvedValue('正文与检索词');
  calls.save.mockResolvedValue({ filename: 'reference.md' });
});
it('copies only after explicit confirmation and passes saved body and editable keywords', async () => {
  render(<SaveAsMemoryButton document={{ id: 'doc', title: '会议纪要' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'memory.space.toMemory' }));
  const dialog = await screen.findByRole('dialog');
  expect(calls.save).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '会议 决策' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'memory.space.toMemory' }));
  await waitFor(() =>
    expect(calls.save).toHaveBeenCalledWith({ title: '会议纪要', content: '正文与检索词', description: '会议 决策' })
  );
  await waitFor(() => expect(calls.success).toHaveBeenCalled());
});
it('does not create a memory for empty extracted content', async () => {
  calls.read.mockResolvedValue('');
  render(<SaveAsMemoryButton document={{ id: 'image', title: 'Scan' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'memory.space.toMemory' }));
  await waitFor(() => expect(calls.warning).toHaveBeenCalledWith('memory.space.toMemoryEmpty'));
  expect(calls.save).not.toHaveBeenCalled();
});
it('keeps the confirmation open and does not claim success on a write failure', async () => {
  calls.save.mockRejectedValue(new Error('disk full'));
  render(<SaveAsMemoryButton document={{ id: 'doc', title: 'Reference' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'memory.space.toMemory' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'memory.space.toMemory' }));
  await waitFor(() => expect(calls.error).toHaveBeenCalled());
  expect(calls.success).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});
