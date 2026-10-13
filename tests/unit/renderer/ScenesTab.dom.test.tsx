/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({ myScenes: vi.fn(), userId: 'member-1', active: true }));

vi.mock('@/common', () => ({
  ipcBridge: { onePlatform: { myScenes: { invoke: hooks.myScenes } } },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  isEnterpriseRemoteActive: () => hooks.active,
  getEnterpriseServerUrl: () => 'https://enterprise.test',
  getEnterpriseSession: () => ({ userId: hooks.userId }),
}));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: { isEnterprise: true, tenantId: 'tenant-1' } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'enabled' in options ? `${key}:${options.enabled}/${options.total}` : key,
  }),
}));

import ScenesTab from '@/renderer/pages/superAssistant/components/ScenesTab';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';

const scene = (id: string, name: string): MyScene => ({
  id,
  name,
  description: null,
  jobFunctions: [],
  builtIn: false,
  resources: [{ resourceType: 'skill', count: 2, includesAll: false }],
  createdAt: 0,
  updatedAt: 0,
});
const OFF_KEY = 'one-enterprise:scene-off:https://enterprise.test|tenant-1|member-1';

const renderTab = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ScenesTab />
    </SWRConfig>
  );
const switchOf = (name: string) => screen.getByRole('switch', { name });

describe('ScenesTab', () => {
  beforeEach(() => {
    localStorage.clear();
    hooks.active = true;
    hooks.userId = 'member-1';
    hooks.myScenes.mockReset().mockResolvedValue([scene('s1', '办公'), scene('s2', 'IT运维'), scene('s3', '网络安全')]);
  });

  it('lists every scene, all on to begin with', async () => {
    renderTab();
    await screen.findByText('办公');
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(switchOf('办公')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('common.scenes.enabledCount:3/3')).toBeInTheDocument();
  });

  it('switching one off keeps it in the list, off, and remembers it for this member', async () => {
    renderTab();
    await screen.findByText('IT运维');
    fireEvent.click(switchOf('IT运维'));
    await waitFor(() => expect(switchOf('IT运维')).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByText('IT运维')).toBeInTheDocument();
    expect(screen.getByText('common.scenes.enabledCount:2/3')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(OFF_KEY) ?? '[]')).toEqual(['s2']);
  });

  it('shows a scene already switched off as off, and can switch it back on', async () => {
    localStorage.setItem(OFF_KEY, JSON.stringify(['s3']));
    renderTab();
    await screen.findByText('网络安全');
    expect(switchOf('网络安全')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(switchOf('网络安全'));
    await waitFor(() => expect(switchOf('网络安全')).toHaveAttribute('aria-checked', 'true'));
    expect(JSON.parse(localStorage.getItem(OFF_KEY) ?? '[]')).toEqual([]);
  });

  it('asks for a company connection instead of listing anything when none is active', async () => {
    hooks.active = false;
    renderTab();
    expect(await screen.findByText('common.scenes.tabNotEnterprise')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});
