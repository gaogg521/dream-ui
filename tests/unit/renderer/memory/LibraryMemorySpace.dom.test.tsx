/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  engineList: vi.fn(),
  engineWrite: vi.fn(),
  registerRagDocument: vi.fn(),
  deleteRagDocument: vi.fn(),
  getRagContentState: vi.fn(),
  setRagContent: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  memory: { engineList: { invoke: ipc.engineList }, engineWrite: { invoke: ipc.engineWrite } },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    oneDevops: {
      registerRagDocument: { invoke: ipc.registerRagDocument },
      deleteRagDocument: { invoke: ipc.deleteRagDocument },
      getRagContentState: { invoke: ipc.getRagContentState },
      setRagContent: { invoke: ipc.setRagContent },
    },
  },
}));

const t = (key: string, vars?: Record<string, unknown>) =>
  vars && Object.keys(vars).length > 0 ? `${key} ${JSON.stringify(vars)}` : key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    Modal: Object.assign(actual.Modal, { confirm: (config: { onOk?: () => void }) => config.onOk?.() }),
  };
});

import LibraryMemorySpace from '@/renderer/pages/knowledge/LibraryMemorySpace';

const file = (filename: string, name: string, body: string) => ({
  name,
  filename,
  path: `/mem/${filename}`,
  content: `---\nname: ${name}\ndescription: about ${name}\ntype: user\n---\n\n${body}\n`,
  updatedAt: 1,
});

const group = (id: string, kind: string, files: ReturnType<typeof file>[]) => ({
  id,
  kind,
  label: id,
  dir: `/mem/projects/${id}/memory`,
  files,
  updatedAt: 1,
});

const renderIt = (props: { enterprise?: boolean; onLibraryChanged?: () => void; searchQuery?: string } = {}) =>
  render(
    <MemoryRouter>
      <LibraryMemorySpace
        enterprise={props.enterprise ?? false}
        onLibraryChanged={props.onLibraryChanged}
        searchQuery={props.searchQuery}
      />
    </MemoryRouter>
  );

describe('LibraryMemorySpace', () => {
  beforeEach(() => {
    Object.values(ipc).forEach((fn) => fn.mockReset());
    ipc.engineList.mockResolvedValue({
      baseDir: '/mem',
      groups: [
        group('_shared', 'shared', [
          { ...file('MEMORY.md', 'MEMORY.md', '- index'), name: 'MEMORY.md' },
          file('codename.md', 'Codename', 'Code name: Beichen 7'),
          file('deploy.md', 'Deploy keys', 'Rotate every Monday'),
        ]),
        group('D--proj', 'project', [file('proj.md', 'Project note', 'Led by Zhou')]),
        group('C--old-dream-temp-1', 'conversation', [file('legacy.md', 'Legacy note', 'old')]),
      ],
    });
    ipc.registerRagDocument.mockResolvedValue({ id: 'doc1' });
    ipc.deleteRagDocument.mockResolvedValue(undefined);
    ipc.getRagContentState.mockResolvedValue({ content: '', revision: 3 });
    ipc.setRagContent.mockResolvedValue(4);
  });

  it('lists the shared and project memories, not the index and not the old per-conversation ones', async () => {
    renderIt();
    expect(await screen.findByText('Codename')).toBeTruthy();
    expect(screen.getByText('Deploy keys')).toBeTruthy();
    expect(screen.getByText('Project note')).toBeTruthy();
    expect(screen.queryByText('MEMORY.md')).toBeNull();
    expect(screen.queryByText('Legacy note')).toBeNull();
  });

  it('searches the text of a memory, not only its name', async () => {
    renderIt();
    await screen.findByText('Codename');

    fireEvent.change(screen.getByPlaceholderText('memory.space.searchPlaceholder'), { target: { value: 'monday' } });

    await waitFor(() => expect(screen.queryByText('Codename')).toBeNull());
    expect(screen.getByText('Deploy keys')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('memory.space.searchPlaceholder'), {
      target: { value: 'nothing-here' },
    });
    expect(await screen.findByText('memory.space.noMatch')).toBeTruthy();
  });

  it('copies a memory into the library as a private document, leaving the memory alone', async () => {
    const onLibraryChanged = vi.fn();
    renderIt({ onLibraryChanged });
    await screen.findByText('Codename');

    fireEvent.click(screen.getAllByText('memory.space.toLibrary')[0]);

    await waitFor(() => expect(ipc.setRagContent).toHaveBeenCalled());
    expect(ipc.registerRagDocument).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'personal', mimeType: 'text/markdown', title: expect.stringMatching(/\.md$/) })
    );
    const call = ipc.setRagContent.mock.calls[0][0];
    expect(call).toMatchObject({ id: 'doc1', expectedRevision: 3 });
    // The text goes in; the memory's own front matter does not.
    expect(call.content).not.toContain('type: user');
    expect(ipc.engineWrite).not.toHaveBeenCalled();
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled());
  });

  it('does not report success when the library refuses the document', async () => {
    ipc.registerRagDocument.mockRejectedValue(new Error('quota'));
    const onLibraryChanged = vi.fn();
    renderIt({ onLibraryChanged });
    await screen.findByText('Codename');

    fireEvent.click(screen.getAllByText('memory.space.toLibrary')[0]);

    await waitFor(() => expect(ipc.registerRagDocument).toHaveBeenCalled());
    expect(ipc.setRagContent).not.toHaveBeenCalled();
    expect(onLibraryChanged).not.toHaveBeenCalled();
  });
});

it('shows only matching memories as a controlled global-search group', async () => {
  renderIt({ searchQuery: 'monday' });
  await waitFor(() => expect(screen.getByText('Deploy keys')).toBeTruthy());
  expect(screen.queryByText('Codename')).toBeNull();
  expect(screen.queryByPlaceholderText('memory.space.searchPlaceholder')).toBeNull();
});
