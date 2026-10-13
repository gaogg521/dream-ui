/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({ myScenes: vi.fn(), userId: 'member-1' }));

vi.mock('@/common', () => ({
  ipcBridge: { onePlatform: { myScenes: { invoke: hooks.myScenes } } },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  isEnterpriseRemoteActive: () => true,
  getEnterpriseServerUrl: () => 'https://enterprise.test',
  getEnterpriseSession: () => ({ userId: hooks.userId }),
}));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: { isEnterprise: true, tenantId: 'tenant-1' } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count !== undefined ? `${key}:${options.count}` : key),
  }),
}));

import EnterpriseSceneGrid from '@/renderer/components/enterprise/EnterpriseSceneGrid';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';

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

const renderGrid = (onOpenScene?: (s: MyScene) => void | Promise<void>) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EnterpriseSceneGrid onOpenScene={onOpenScene} />
    </SWRConfig>
  );

const names = () => [...document.querySelectorAll<HTMLElement>('[data-scene-name]')].map((el) => el.dataset.sceneName);

describe('EnterpriseSceneGrid opening a scene', () => {
  beforeEach(() => {
    localStorage.clear();
    hooks.userId = 'member-1';
    hooks.myScenes.mockReset().mockResolvedValue(SCENES);
  });

  it('opens the clicked scene', async () => {
    const open = vi.fn();
    renderGrid(open);
    fireEvent.click(await screen.findByText('IT运维'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toMatchObject({ id: 's2', name: 'IT运维' });
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

describe('EnterpriseSceneGrid order', () => {
  beforeEach(() => {
    localStorage.clear();
    hooks.userId = 'member-1';
    hooks.myScenes.mockReset().mockResolvedValue(SCENES);
  });

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

describe('EnterpriseSceneGrid scenes the member switched off', () => {
  beforeEach(() => {
    localStorage.clear();
    hooks.userId = 'member-1';
    hooks.myScenes.mockReset().mockResolvedValue(SCENES);
  });

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
