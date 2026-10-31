import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTeam } from '@/common/types/team/teamTypes';

const mocks = vi.hoisted(() => ({
  directory: vi.fn(),
  save: vi.fn(),
  write: vi.fn(),
  report: vi.fn(),
  prepare: vi.fn(),
  collect: vi.fn(),
  native: vi.fn(),
  download: vi.fn(),
  encrypted: vi.fn(),
  reveal: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    application: { getPath: { invoke: mocks.directory } },
    dialog: { showSave: { invoke: mocks.save } },
    fs: { writeFile: { invoke: mocks.write } },
    shell: { showItemInFolder: { invoke: mocks.reveal } },
  },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({ isNativeDialogAvailable: mocks.native }));
vi.mock('@/renderer/utils/enterprise/secureExport/gateway', () => ({
  prepareExport: mocks.prepare,
  downloadDecision: mocks.download,
  writeEncryptedPackage: mocks.encrypted,
}));
vi.mock('@/renderer/pages/team/hooks/TeamTabsContext', () => ({
  useTeamTabs: () => ({ assistants: [], colorOf: () => '#123456' }),
}));
vi.mock('@/renderer/pages/team/export/collectTeamTranscript', () => ({ collectTeamTranscript: mocks.collect }));
vi.mock('@/renderer/pages/team/export/renderTeamTranscriptHtml', () => ({
  renderTeamTranscriptHtml: () => '<html>raw</html>',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; reason?: string }) =>
      options?.reason ?? options?.defaultValue ?? key,
  }),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arco-design/web-react')>()),
  Message: { success: mocks.success, error: mocks.error, warning: mocks.warning },
}));
import TeamExportButton from '@/renderer/pages/team/components/TeamExportButton';

const start = () => {
  render(<TeamExportButton team={{ id: 'team', name: 'Team' } as TTeam} />);
  fireEvent.click(screen.getByTestId('team-export-button'));
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.directory.mockResolvedValue('C:/Downloads');
  mocks.native.mockReturnValue(true);
  mocks.collect.mockResolvedValue({ members: [{ messageCount: 2 }], notes: [] });
  mocks.prepare.mockResolvedValue({ mode: 'plain', files: [{ text: '<html>protected</html>' }], report: mocks.report });
  mocks.save.mockResolvedValue('C:/Downloads/team.html');
  mocks.write.mockResolvedValue(true);
});
afterEach(cleanup);

describe('team transcript saving', () => {
  it('waits for the actual write before reporting success and offers the saved location', async () => {
    let complete!: (saved: boolean) => void;
    mocks.write.mockReturnValue(
      new Promise<boolean>((resolve) => {
        complete = resolve;
      })
    );
    start();
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith({
        path: 'C:/Downloads/team.html',
        data: '<html>protected</html>',
        workspace: 'C:/Downloads',
      })
    );
    expect(mocks.success).not.toHaveBeenCalled();
    complete(true);
    await waitFor(() => expect(mocks.report).toHaveBeenCalledOnce());
    cleanup();
    render(mocks.success.mock.calls[0][0].content);
    fireEvent.click(screen.getByText('messages.export.showInFolder'));
    expect(mocks.reveal).toHaveBeenCalledWith('C:/Downloads/team.html');
  });
  it('does not write or announce success when saving is cancelled', async () => {
    mocks.save.mockResolvedValue(undefined);
    start();
    await waitFor(() => expect(screen.getByTestId('team-export-button')).not.toHaveClass('arco-btn-loading'));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it.each([false, 'reject'])('shows an error when the file cannot be written (%s)', async (result) => {
    if (result === 'reject') mocks.write.mockRejectedValue(new Error('disk full'));
    else mocks.write.mockResolvedValue(false);
    start();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it('saves an encrypted package with its gateway filename', async () => {
    const bytes = new Uint8Array([1, 2]);
    mocks.prepare.mockResolvedValue({ mode: 'encrypted', fileName: 'team.owenc', bytes, report: mocks.report });
    mocks.encrypted.mockResolvedValue(true);
    start();
    await waitFor(() => expect(mocks.encrypted).toHaveBeenCalledWith('C:/Downloads/team.html', bytes));
    expect(mocks.save.mock.calls[0][0].defaultPath).toBe('C:/Downloads/team.owenc');
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('honors enterprise export restrictions before opening a save dialog', async () => {
    mocks.prepare.mockResolvedValue({ mode: 'blocked', message: 'blocked by policy' });
    start();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith({ content: 'blocked by policy', duration: 6000 }));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('keeps the browser download flow for WebUI', async () => {
    mocks.native.mockReturnValue(false);
    start();
    await waitFor(() => expect(mocks.download).toHaveBeenCalled());
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('distinguishes unreadable member history from a genuinely empty team', async () => {
    mocks.collect.mockResolvedValue({
      members: [],
      notes: [{ kind: 'member_failed', name: 'Leader', reason: 'database offline' }],
    });
    start();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Leader: database offline'));
    expect(mocks.warning).not.toHaveBeenCalled();
  });
  it('explains that a new team has no messages to export', async () => {
    mocks.collect.mockResolvedValue({ members: [], notes: [] });
    start();
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
