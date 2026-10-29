/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({ myScenes: vi.fn(), userId: 'member-1' }));
const store = vi.hoisted(() => ({ personal: undefined as unknown }));

vi.mock('@/common', () => ({
  ipcBridge: { onePlatform: { myScenes: { invoke: hooks.myScenes } } },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  isEnterpriseRemoteActive: () => true,
  getEnterpriseServerUrl: () => 'https://enterprise.test',
  getEnterpriseSession: () => ({ userId: hooks.userId }),
}));
vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    // The built-in starter scenes are seeded once and then marked done; these tests are about the rest.
    get: async (key: string) => (key === 'scenes.defaultsInitialized' ? true : store.personal),
    set: async (_key: string, value: unknown) => {
      store.personal = value;
      return value;
    },
  },
}));
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
    store.personal = undefined;
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

import EnterpriseSceneGrid from '@/renderer/components/scenes/SceneGrid';

describe('EnterpriseSceneGrid refresh', () => {
  it('replaces the empty guidance with a newly granted scene on refresh', async () => {
    hooks.myScenes
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: 'new-scene', name: 'Newly granted scene', jobFunctions: [], resources: [], builtIn: false },
      ]);
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <EnterpriseSceneGrid />
      </SWRConfig>
    );
    expect(await screen.findByText('common.scenes.emptyCreate')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    expect(await screen.findByText('Newly granted scene')).toBeInTheDocument();
    expect(screen.queryByText('common.scenes.emptyCreate')).not.toBeInTheDocument();
  });
});

describe('EnterpriseSceneGrid density', () => {
  const scenes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `scene-${i + 1}`,
      name: `Scene ${i + 1}`,
      description: `Description ${i + 1}`,
      jobFunctions: ['Ops'],
      builtIn: false,
      resources: [{ resourceType: 'skill', count: i + 1, includesAll: false }],
    }));
  const renderGrid = () =>
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <EnterpriseSceneGrid />
      </SWRConfig>
    );

  it('shows four scenes, and the rest only after "show all"', async () => {
    hooks.myScenes.mockReset().mockResolvedValue(scenes(6));
    renderGrid();
    expect(await screen.findByText('Scene 1')).toBeInTheDocument();
    expect(screen.getByText('Scene 4')).toBeInTheDocument();
    expect(screen.queryByText('Scene 5')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'common.scenes.showAll' }));
    expect(await screen.findByText('Scene 6')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'common.collapse' }));
    await waitFor(() => expect(screen.queryByText('Scene 5')).not.toBeInTheDocument());
  });

  it('offers no "show all" when everything already fits', async () => {
    hooks.myScenes.mockReset().mockResolvedValue(scenes(4));
    renderGrid();
    expect(await screen.findByText('Scene 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.scenes.showAll' })).not.toBeInTheDocument();
  });

  it('shows the description on one line of the card; the job functions stay one hover away', async () => {
    hooks.myScenes.mockReset().mockResolvedValue(scenes(1));
    renderGrid();
    const card = (await screen.findByText('Scene 1')).closest('[data-scene-name]') as HTMLElement;
    // Full text and the job functions in the tooltip, the description itself on the card.
    expect(card.title).toContain('Description 1');
    expect(card.title).toContain('Ops');
    expect(card.querySelector('[data-testid="scene-card-description"]')).toHaveTextContent('Description 1');
    expect(screen.queryByText('Ops')).not.toBeInTheDocument();
  });
});

describe('EnterpriseSceneGrid authorization boundaries', () => {
  it('offers retry instead of claiming no grants when the request fails', async () => {
    hooks.myScenes.mockReset().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue([]);
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <EnterpriseSceneGrid />
      </SWRConfig>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'common.retry' }));
    expect(await screen.findByText('common.scenes.emptyCreate')).toBeInTheDocument();
  });

  it('does not reuse another member scene cache in the same project group', async () => {
    hooks.userId = 'member-a';
    hooks.myScenes
      .mockReset()
      .mockResolvedValueOnce([
        { id: 'private-scene', name: 'Member A scene', jobFunctions: [], resources: [], builtIn: false },
      ])
      .mockResolvedValue([]);
    const cache = new Map();
    const view = () => (
      <SWRConfig value={{ provider: () => cache }}>
        <EnterpriseSceneGrid />
      </SWRConfig>
    );
    const mounted = render(view());
    expect(await screen.findByText('Member A scene')).toBeInTheDocument();
    hooks.userId = 'member-b';
    mounted.rerender(view());
    expect(screen.queryByText('Member A scene')).not.toBeInTheDocument();
    expect(await screen.findByText('common.scenes.emptyCreate')).toBeInTheDocument();
    hooks.userId = 'member-1';
  });
});
