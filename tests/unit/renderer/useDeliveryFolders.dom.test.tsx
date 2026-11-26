import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messages: [] as any[],
  get: vi.fn(),
  project: vi.fn(),
  metadata: vi.fn(),
  attach: vi.fn(),
  mutate: vi.fn(),
  reveal: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { get: { invoke: mocks.get } },
    project: { get: { invoke: mocks.project }, attachFolder: { invoke: mocks.attach } },
    fs: { getFileMetadata: { invoke: mocks.metadata } },
  },
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({ useMessageList: () => mocks.messages }));
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }));
vi.mock('@/renderer/pages/conversation/explorer/currentProjectStore', () => ({ getCurrentProject: () => 'project-a' }));
vi.mock('@/renderer/pages/conversation/explorer/explorerStore', () => ({ reveal: mocks.reveal }));
import { useDeliveryFolders } from '@/renderer/pages/conversation/explorer/useDeliveryFolders';

it('attaches verified external output once to its owning project and refreshes and expands the tree', async () => {
  mocks.messages = [
    { type: 'tool_call', content: { name: 'Write', status: 'completed', args: { file_path: 'C:/deliver/report.md' } } },
  ];
  mocks.get.mockResolvedValue({ project_id: 'project-a' });
  mocks.project.mockResolvedValue({ explorer: { entries: [{ display_path: 'C:/session' }] } });
  mocks.metadata.mockResolvedValue({ isDirectory: false });
  mocks.attach.mockResolvedValue({ pe_id: 'delivery-root', display_path: 'C:/deliver' });
  const { rerender } = renderHook(() => useDeliveryFolders('chat-a'));
  await waitFor(
    () => expect(mocks.attach).toHaveBeenCalledWith({ project_id: 'project-a', uri: 'file:///C:/deliver' }),
    { timeout: 2500 }
  );
  expect(mocks.mutate).toHaveBeenCalledWith('explorer-project/project-a');
  expect(mocks.reveal).toHaveBeenCalledWith({ pe_id: 'delivery-root', relative_path: '' });
  mocks.messages = [...mocks.messages];
  rerender();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(mocks.attach).toHaveBeenCalledTimes(1);
});
