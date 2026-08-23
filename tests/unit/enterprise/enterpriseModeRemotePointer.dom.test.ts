import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearEnterpriseRemotePointer,
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseModeEnabled,
  setEnterpriseModeEnabled,
  setEnterpriseServerUrl,
  setEnterpriseSession,
} from '@/common/adapter/enterpriseMode';

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
