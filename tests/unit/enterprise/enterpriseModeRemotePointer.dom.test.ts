import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import {
  clearEnterpriseRemotePointer,
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseModeEnabled,
  setEnterpriseModeEnabled,
  setEnterpriseServerUrl,
  setEnterpriseSession,
  ENTERPRISE_CONNECTION_CHANGED_EVENT,
  recordEnterpriseReachability,
  ENTERPRISE_OFFLINE_GRACE_MS,
} from '@/common/adapter/enterpriseMode';

const contextRequest = vi.hoisted(() => vi.fn());
vi.mock('@/common', () => ({ ipcBridge: { oneOrg: { context: { invoke: contextRequest } } } }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('enterpriseMode remote pointer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clearEnterpriseRemotePointer removes remote URL, session, and disables mode', () => {
    setEnterpriseServerUrl('http://192.168.1.10:25809');
    setEnterpriseModeEnabled(true);
    setEnterpriseSession({ token: 't', userId: 'u', username: 'alice' });

    clearEnterpriseRemotePointer();

    expect(getEnterpriseServerUrl()).toBeNull();
    expect(getEnterpriseSession()).toBeNull();
    expect(isEnterpriseModeEnabled()).toBe(false);
  });
});

describe('live enterprise connection context', () => {
  const context = { tenantId: 't', tenantName: 'Company', role: 'member', isEnterprise: true, memberCount: 1 };
  beforeEach(() => {
    localStorage.clear();
    contextRequest.mockReset();
    contextRequest.mockResolvedValue(context);
  });
  it('shares the same connectivity result between the footer and enterprise page', async () => {
    const first = renderHook(() => useOrgContext());
    const second = renderHook(() => useOrgContext());
    await waitFor(() => expect(first.result.current.context).toEqual(context));
    expect(contextRequest).toHaveBeenCalledTimes(1);
    contextRequest.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await first.result.current.refresh();
    });
    expect(second.result.current.context).toBeNull();
    expect(second.result.current.error).toContain('offline');
  });
  it('recovers on focus after the server comes back', async () => {
    contextRequest.mockRejectedValueOnce(new Error('offline'));
    const hook = renderHook(() => useOrgContext());
    await waitFor(() => expect(hook.result.current.error).toContain('offline'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(hook.result.current.context).toEqual(context));
    expect(hook.result.current.error).toBeNull();
  });
  it('does not let an old company response replace the newly selected company', async () => {
    setEnterpriseServerUrl('https://old.example');
    setEnterpriseModeEnabled(true);
    let finish: ((value: typeof context) => void) | undefined;
    contextRequest.mockImplementationOnce(
      () =>
        new Promise<typeof context>((resolve) => {
          finish = resolve;
        })
    );
    const hook = renderHook(() => useOrgContext());
    act(() => {
      setEnterpriseServerUrl('https://new.example');
    });
    await waitFor(() => expect(hook.result.current.context).toEqual(context));
    await act(async () => {
      finish?.({ ...context, tenantName: 'Old Company' });
    });
    expect(hook.result.current.context?.tenantName).toBe('Company');
  });
  it('announces same-window configuration changes immediately', () => {
    const changed = vi.fn();
    window.addEventListener(ENTERPRISE_CONNECTION_CHANGED_EVENT, changed);
    setEnterpriseServerUrl('https://company.example');
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(ENTERPRISE_CONNECTION_CHANGED_EVENT, changed);
  });
  it('clears the previous company token before announcing a server change', () => {
    setEnterpriseServerUrl('https://old.example');
    setEnterpriseSession({ token: 'old-company-token', userId: 'u', username: 'member' });
    const observed: Array<ReturnType<typeof getEnterpriseSession>> = [];
    const changed = () => {
      observed.push(getEnterpriseSession());
    };
    window.addEventListener(ENTERPRISE_CONNECTION_CHANGED_EVENT, changed);
    setEnterpriseServerUrl('https://new.example');
    window.removeEventListener(ENTERPRISE_CONNECTION_CHANGED_EVENT, changed);
    expect(observed).toEqual([null]);
  });
  it('keeps enterprise mode through short outages and returns to personal only after fifteen minutes', () => {
    setEnterpriseServerUrl('https://company.example');
    setEnterpriseModeEnabled(true);
    setEnterpriseSession({ token: 'keep-for-reconnect', userId: 'u', username: 'member' });
    expect(recordEnterpriseReachability(false, 1000)).toBe(false);
    expect(recordEnterpriseReachability(false, 1000 + ENTERPRISE_OFFLINE_GRACE_MS - 1)).toBe(false);
    expect(isEnterpriseModeEnabled()).toBe(true);
    expect(recordEnterpriseReachability(false, 1000 + ENTERPRISE_OFFLINE_GRACE_MS)).toBe(true);
    expect(isEnterpriseModeEnabled()).toBe(false);
    expect(getEnterpriseSession()?.token).toBe('keep-for-reconnect');
  });
  it('resets the outage timer on recovery or a reachable authentication refusal', () => {
    setEnterpriseServerUrl('https://company.example');
    setEnterpriseModeEnabled(true);
    recordEnterpriseReachability(false, 1000);
    recordEnterpriseReachability(true, 800000);
    expect(recordEnterpriseReachability(false, 901000)).toBe(false);
    expect(isEnterpriseModeEnabled()).toBe(true);
  });
});
