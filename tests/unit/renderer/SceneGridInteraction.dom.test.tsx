/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({
  myScenes: vi.fn(),
  userId: 'member-1',
  company: true,
  personal: undefined as unknown,
}));

vi.mock('@/common', () => ({
  ipcBridge: { onePlatform: { myScenes: { invoke: hooks.myScenes } } },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  isEnterpriseRemoteActive: () => hooks.company,
  getEnterpriseServerUrl: () => (hooks.company ? 'https://enterprise.test' : null),
  getEnterpriseSession: () => (hooks.company ? { userId: hooks.userId } : null),
}));
vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: async () => hooks.personal,
    set: async (_key: string, value: unknown) => {
      hooks.personal = value;
      return value;
    },
  },
}));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: hooks.company ? { isEnterprise: true, tenantId: 'tenant-1' } : null }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count !== undefined ? `${key}:${options.count}` : key),
  }),
}));

import SceneGrid from '@/renderer/components/scenes/SceneGrid';
import type { SceneItem } from '@/renderer/utils/scenes/sceneItem';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import { newPersonalScene } from '@/renderer/utils/scenes/personalScenes';

const scene = (id: string, name: string): MyScene => ({
  id,
  name,
  description: null,
  jobFunctions: [],
  builtIn: false,
  resources: [{ resourceType: 'skill', count: 2, includesAll: false }],
  skillIds: [],
  mcpIds: [],
  createdAt: 0,
  updatedAt: 0,
});

const SCENES = [scene('s1', '办公'), scene('s2', 'IT运维'), scene('s3', '网络安全')];
const ORDER_KEY = 'one-enterprise:scene-order:https://enterprise.test|tenant-1|member-1';
const OFF_KEY = 'one-enterprise:scene-off:https://enterprise.test|tenant-1|member-1';

const renderGrid = (onOpenScene?: (item: SceneItem) => void | Promise<void>, onCreateScene?: () => void) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SceneGrid onOpenScene={onOpenScene} onCreateScene={onCreateScene} />
    </SWRConfig>
  );

const names = () => [...document.querySelectorAll<HTMLElement>('[data-scene-name]')].map((el) => el.dataset.sceneName);

const reset = () => {
  localStorage.clear();
  hooks.userId = 'member-1';
  hooks.company = true;
  hooks.personal = undefined;
  hooks.myScenes.mockReset().mockResolvedValue(SCENES);
};

describe('SceneGrid opening a scene', () => {
  beforeEach(reset);

  it('opens the clicked scene', async () => {
    const open = vi.fn();
    renderGrid(open);
    fireEvent.click(await screen.findByText('IT运维'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatchObject({ key: 's2', name: 'IT运维', source: 'company' });
    expect(open.mock.calls[0][0].company).toMatchObject({ id: 's2' });
  });

  it('opens from the keyboard too', async () => {
    const open = vi.fn();
    renderGrid(open);
    const card = (await screen.findByText('办公')).closest('[data-scene-name]') as HTMLElement;
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => expect(card).toHaveAttribute('aria-busy', 'false'));
    fireEvent.keyDown(card, { key: ' ' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('ignores a second click while the first is still opening, then accepts clicks again', async () => {
    let finish: () => void = () => undefined;
    const open = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderGrid(open);
    const first = (await screen.findByText('办公')).closest('[data-scene-name]') as HTMLElement;
    const other = screen.getByText('IT运维').closest('[data-scene-name]') as HTMLElement;

    fireEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(other);
    fireEvent.click(first);
    expect(open).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(first).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(other);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does nothing, and does not throw, when the page gave it no way to open a scene', async () => {
    renderGrid();
    const card = (await screen.findByText('办公')).closest('[data-scene-name]') as HTMLElement;
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(() => fireEvent.click(card)).not.toThrow();
  });
});

describe('SceneGrid order', () => {
  beforeEach(reset);

  it('follows the order the member saved', async () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(['s3', 's1']));
    renderGrid(vi.fn());
    await screen.findByText('办公');
    expect(names()).toEqual(['网络安全', '办公', 'IT运维']);
  });

  it('keeps the server order for a member who never reordered', async () => {
    renderGrid(vi.fn());
    await screen.findByText('办公');
    expect(names()).toEqual(['办公', 'IT运维', '网络安全']);
  });

  it("never applies another member's saved order", async () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(['s3', 's1']));
    hooks.userId = 'member-2';
    renderGrid(vi.fn());
    await screen.findByText('办公');
    expect(names()).toEqual(['办公', 'IT运维', '网络安全']);
  });
});

describe('SceneGrid scenes the member switched off', () => {
  beforeEach(reset);

  it('leaves them out of the home page and keeps the rest in order', async () => {
    localStorage.setItem(OFF_KEY, JSON.stringify(['s2']));
    renderGrid(vi.fn());
    await screen.findByText('办公');
    expect(names()).toEqual(['办公', '网络安全']);
  });

  it('says so, rather than claiming there are no scenes, when every scene is off', async () => {
    localStorage.setItem(OFF_KEY, JSON.stringify(['s1', 's2', 's3']));
    renderGrid(vi.fn());
    expect(await screen.findByText('common.scenes.allOff')).toBeInTheDocument();
    expect(names()).toEqual([]);
  });

  it('never applies another member switches', async () => {
    localStorage.setItem(OFF_KEY, JSON.stringify(['s2']));
    hooks.userId = 'member-2';
    renderGrid(vi.fn());
    await screen.findByText('办公');
    expect(names()).toEqual(['办公', 'IT运维', '网络安全']);
  });
});

describe('SceneGrid with the person own scenes', () => {
  beforeEach(reset);

  it('shows company scenes and personal scenes together, personal ones marked as the person own', async () => {
    hooks.personal = [newPersonalScene({ name: '我的官网' })];
    renderGrid(vi.fn());
    await screen.findByText('我的官网');
    expect(names()).toEqual(['办公', 'IT运维', '网络安全', '我的官网']);
    const mine = screen.getByText('我的官网').closest('[data-scene-name]') as HTMLElement;
    expect(mine.dataset.sceneSource).toBe('mine');
    // Only company scenes carry the company badge.
    expect(screen.getAllByText('common.scenes.sourceCompany')).toHaveLength(3);
  });

  it('opens a personal scene with the scene as it was made', async () => {
    const mine = newPersonalScene({ name: '我的官网', prompt: 'p' });
    hooks.personal = [mine];
    const open = vi.fn();
    renderGrid(open);
    fireEvent.click(await screen.findByText('我的官网'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatchObject({ key: `mine:${mine.id}`, source: 'mine' });
    expect(open.mock.calls[0][0].mine).toMatchObject({ id: mine.id, prompt: 'p' });
  });

  it('puts a personal scene where the member dragged it, among company scenes', async () => {
    const mine = newPersonalScene({ name: '我的官网' });
    hooks.personal = [mine];
    localStorage.setItem(ORDER_KEY, JSON.stringify([`mine:${mine.id}`, 's2']));
    renderGrid(vi.fn());
    await screen.findByText('我的官网');
    expect(names()).toEqual(['我的官网', 'IT运维', '办公', '网络安全']);
  });

  it('works with no company at all: a stand-alone install sees its own scenes and can make more', async () => {
    hooks.company = false;
    hooks.personal = [newPersonalScene({ name: '周报' })];
    const create = vi.fn();
    renderGrid(vi.fn(), create);
    await screen.findByText('周报');
    expect(names()).toEqual(['周报']);
    expect(hooks.myScenes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('scene-create'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('invites a person with no scenes to make one, instead of staying silent', async () => {
    hooks.company = false;
    const create = vi.fn();
    renderGrid(vi.fn(), create);
    expect(await screen.findByText('common.scenes.emptyCreate')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('scene-create'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('offers no way to make a scene when the page did not give it one', async () => {
    renderGrid(vi.fn());
    await screen.findByText('办公');
    expect(screen.queryByTestId('scene-create')).not.toBeInTheDocument();
  });

  it('still shows the person own scenes when the company cannot be reached', async () => {
    hooks.personal = [newPersonalScene({ name: '我的官网' })];
    hooks.myScenes.mockReset().mockRejectedValue(new Error('unreachable'));
    renderGrid(vi.fn());
    expect(await screen.findByText('我的官网')).toBeInTheDocument();
    expect(names()).toEqual(['我的官网']);
  });
});
