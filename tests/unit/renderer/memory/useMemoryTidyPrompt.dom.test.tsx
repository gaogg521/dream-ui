/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  engineCompactionStatus: vi.fn(),
  engineCompact: vi.fn(),
  native: true,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  isNativeDialogAvailable: () => ipc.native,
  memory: {
    engineCompactionStatus: { invoke: ipc.engineCompactionStatus },
    engineCompact: { invoke: ipc.engineCompact },
  },
}));

const t = (key: string, vars?: Record<string, unknown>) =>
  vars && Object.keys(vars).length > 0 ? `${key} ${JSON.stringify(vars)}` : key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));

const arco = vi.hoisted(() => ({ confirm: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@arco-design/web-react', () => ({
  Modal: { confirm: arco.confirm },
  Message: { success: arco.success, error: arco.error },
}));

import { useMemoryTidyPrompt } from '@/renderer/hooks/system/useMemoryTidyPrompt';

const SNOOZE_KEY = 'memory.tidy.snoozeUntil';

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(21_000);
  });
};

describe('useMemoryTidyPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    ipc.native = true;
    ipc.engineCompactionStatus
      .mockReset()
      .mockResolvedValue({ total: 90, mergeable: 40, suggested: true, backup: null });
    ipc.engineCompact.mockReset().mockResolvedValue({ merged: 40, mergedInto: 6, kept: 50, backupId: 'b' });
    arco.confirm.mockReset();
    arco.success.mockReset();
    arco.error.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks first, with the numbers, and does not touch the memory until the person agrees', async () => {
    renderHook(() => useMemoryTidyPrompt());
    await flush();

    expect(arco.confirm).toHaveBeenCalledTimes(1);
    const dialog = arco.confirm.mock.calls[0][0];
    expect(dialog.content).toContain('"total":90');
    expect(dialog.content).toContain('"mergeable":40');
    expect(ipc.engineCompact).not.toHaveBeenCalled();

    await act(async () => {
      await dialog.onOk();
    });
    expect(ipc.engineCompact).toHaveBeenCalledWith({ groupId: '_shared' });
    expect(arco.success).toHaveBeenCalled();
  });

  it('says so when the tidy fails, instead of reporting success', async () => {
    ipc.engineCompact.mockRejectedValue(new Error('disk full'));
    renderHook(() => useMemoryTidyPrompt());
    await flush();

    await act(async () => {
      await arco.confirm.mock.calls[0][0].onOk();
    });
    expect(arco.error).toHaveBeenCalled();
    expect(arco.success).not.toHaveBeenCalled();
  });

  it('respects "later" for a week', async () => {
    renderHook(() => useMemoryTidyPrompt());
    await flush();
    act(() => arco.confirm.mock.calls[0][0].onCancel());

    const until = Number(localStorage.getItem(SNOOZE_KEY));
    expect(until - Date.now()).toBeGreaterThan(6 * 24 * 3600 * 1000);

    arco.confirm.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 3600 * 1000);
    });
    expect(arco.confirm).not.toHaveBeenCalled();
  });

  it('stays quiet when the memory is not long enough to bother with', async () => {
    ipc.engineCompactionStatus.mockResolvedValue({ total: 12, mergeable: 3, suggested: false, backup: null });
    renderHook(() => useMemoryTidyPrompt());
    await flush();
    expect(arco.confirm).not.toHaveBeenCalled();
  });

  it('does nothing outside the desktop app, where there is no main process to ask', async () => {
    ipc.native = false;
    renderHook(() => useMemoryTidyPrompt());
    await flush();
    expect(ipc.engineCompactionStatus).not.toHaveBeenCalled();
  });
});
