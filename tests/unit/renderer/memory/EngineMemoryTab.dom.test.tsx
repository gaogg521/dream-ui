/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  engineList: vi.fn(),
  engineWrite: vi.fn(),
  engineDelete: vi.fn(),
  engineMoveToShared: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  memory: {
    engineList: { invoke: ipc.engineList },
    engineWrite: { invoke: ipc.engineWrite },
    engineDelete: { invoke: ipc.engineDelete },
    engineMoveToShared: { invoke: ipc.engineMoveToShared },
  },
}));

// A stable `t`, like react-i18next's: a fresh function each render would re-run the load effect.
const t = (key: string, vars?: Record<string, unknown>) =>
  vars && Object.keys(vars).length > 0 ? `${key} ${JSON.stringify(vars)}` : key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    // Arco's imperative toast renders through a React API that React 19 removed.
    Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    // Auto-confirm so the merge button's effect is observable without driving a modal.
    Modal: Object.assign(actual.Modal, { confirm: (config: { onOk?: () => void }) => config.onOk?.() }),
  };
});

import EngineMemoryTab from '@/renderer/pages/memory/EngineMemoryTab';

const file = (filename: string, name: string) => ({
  name,
  filename,
  path: `/mem/${filename}`,
  content: `---\nname: ${name}\ndescription: about ${name}\ntype: user\n---\n`,
  updatedAt: 1,
});

const overview = (withLegacy: boolean) => ({
  baseDir: '/mem',
  groups: [
    {
      id: '_shared',
      kind: 'shared',
      label: '_shared',
      dir: '/mem/projects/_shared/memory',
      files: [file('reply_language.md', 'Reply language')],
      updatedAt: 1,
    },
    ...(withLegacy
      ? [
          {
            id: 'C--old-dream-temp-4c69a9e9',
            kind: 'conversation',
            label: 'C--old-dream-temp-4c69a9e9',
            dir: '/mem/projects/C--old-dream-temp-4c69a9e9/memory',
            files: [file('tone.md', 'Tone'), file('role.md', 'Role')],
            updatedAt: 1,
          },
        ]
      : []),
  ],
});

describe('EngineMemoryTab', () => {
  beforeEach(() => {
    Object.values(ipc).forEach((fn) => fn.mockReset());
    ipc.engineMoveToShared.mockResolvedValue({ moved: 2, renamed: 0, duplicates: 0 });
  });

  it('shows the shared memory the assistant reads in every projectless conversation', async () => {
    ipc.engineList.mockResolvedValue(overview(false));
    render(<EngineMemoryTab />);
    expect(await screen.findByText('Reply language')).toBeTruthy();
    expect(screen.queryByTestId('engine-memory-legacy')).toBeNull();
  });

  it('offers to merge the old per-conversation memory and refreshes afterwards', async () => {
    ipc.engineList.mockResolvedValueOnce(overview(true)).mockResolvedValue(overview(false));
    render(<EngineMemoryTab />);
    const legacy = await screen.findByTestId('engine-memory-legacy');
    expect(legacy.textContent).toContain('"groups":1');
    expect(legacy.textContent).toContain('"files":2');

    fireEvent.click(screen.getByText('memory.engine.mergeAll'));

    await waitFor(() =>
      expect(ipc.engineMoveToShared).toHaveBeenCalledWith({ groupIds: ['C--old-dream-temp-4c69a9e9'] })
    );
    await waitFor(() => expect(screen.queryByTestId('engine-memory-legacy')).toBeNull());
  });
});
