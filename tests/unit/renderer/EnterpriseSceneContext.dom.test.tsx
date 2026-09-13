/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({ myScenes: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: { onePlatform: { myScenes: { invoke: hooks.myScenes } } },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({ isEnterpriseRemoteActive: () => true }));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: { isEnterprise: true, tenantId: 'tenant-1' } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (key === 'common.scenes.resourceType.skill') return '技能';
      return options?.defaultValue?.replace('{{count}}', String(options.count ?? '')) ?? key;
    },
  }),
}));

import EnterpriseSceneContext from '@/renderer/components/enterprise/EnterpriseSceneContext';

const renderSceneContext = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <EnterpriseSceneContext />
    </SWRConfig>
  );

describe('EnterpriseSceneContext', () => {
  beforeEach(() => {
    hooks.myScenes.mockReset().mockResolvedValue([
      {
        id: 'scene-office',
        name: '办公',
        description: '日常办公协作场景',
        jobFunctions: ['行政', '文秘'],
        builtIn: true,
        resources: [{ resourceType: 'skill', count: 1, includesAll: true }],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it('shows the cumulative scene count and explains the delivered package', async () => {
    renderSceneContext();
    const trigger = await screen.findByTestId('enterprise-scene-context');
    expect(trigger).toHaveTextContent('企业场景 · 1');

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText('办公')).toBeInTheDocument());
    expect(screen.getByText('日常办公协作场景')).toBeInTheDocument();
    expect(screen.getByText('行政')).toBeInTheDocument();
    expect(screen.getByText('技能 · 全部')).toBeInTheDocument();
    expect(screen.getByText(/所有会话中自动生效/)).toBeInTheDocument();
  });

  it('keeps an explicit entry when the member has not joined a scene', async () => {
    hooks.myScenes.mockResolvedValue([]);
    renderSceneContext();
    expect(await screen.findByTestId('enterprise-scene-context')).toHaveTextContent('企业场景 · 未加入');
  });
});
