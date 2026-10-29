/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({
  myScenes: vi.fn(),
  listAvailableSkills: vi.fn(),
  userId: 'member-1',
  company: true,
  personal: undefined as unknown,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    onePlatform: { myScenes: { invoke: hooks.myScenes } },
    fs: { listAvailableSkills: { invoke: hooks.listAvailableSkills } },
  },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  isEnterpriseRemoteActive: () => hooks.company,
  getEnterpriseServerUrl: () => (hooks.company ? 'https://enterprise.test' : null),
  getEnterpriseSession: () => (hooks.company ? { userId: hooks.userId } : null),
}));
vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    // The built-in starter scenes are seeded once and then marked done; these tests are about the rest.
    get: async (key: string) => (key === 'scenes.defaultsInitialized' ? true : hooks.personal),
    set: async (_key: string, value: unknown) => {
      hooks.personal = value;
      return value;
    },
  },
}));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: hooks.company ? { isEnterprise: true, tenantId: 'tenant-1' } : null }),
}));
vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({ mcpServers: [{ id: 'mcp_1', name: 'Docs server', builtin: false }] }),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  // Arco's toast renders through an API React 19 removed; the toast is not what is tested.
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'enabled' in options
        ? `${key}:${options.enabled}/${options.total}`
        : options && 'name' in options
          ? `${key}:${options.name}`
          : key,
    i18n: { language: 'en-US' },
  }),
}));

import ScenesTab from '@/renderer/pages/superAssistant/components/ScenesTab';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import { newPersonalScene } from '@/renderer/utils/scenes/personalScenes';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';

const scene = (id: string, name: string, patch: Partial<MyScene> = {}): MyScene => ({
  id,
  name,
  description: null,
  jobFunctions: [],
  builtIn: false,
  resources: [{ resourceType: 'skill', count: 2, includesAll: false }],
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});
const OFF_KEY = 'one-enterprise:scene-off:https://enterprise.test|tenant-1|member-1';

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <span data-testid='location'>{`${location.pathname}|${JSON.stringify(location.state)}`}</span>;
};

const renderTab = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ScenesTab />
        <LocationProbe />
      </SWRConfig>
    </MemoryRouter>
  );
const switchOf = (name: string) => screen.getByRole('switch', { name });
const saved = () => hooks.personal as PersonalScene[];

describe('ScenesTab', () => {
  beforeEach(() => {
    localStorage.clear();
    hooks.company = true;
    hooks.userId = 'member-1';
    hooks.personal = undefined;
    hooks.listAvailableSkills.mockReset().mockResolvedValue([
      { name: 'weekly-report', is_auto_inject: false },
      { name: 'cron', is_auto_inject: true },
    ]);
    hooks.myScenes.mockReset().mockResolvedValue([scene('s1', '办公'), scene('s2', 'IT运维'), scene('s3', '网络安全')]);
  });

  describe('company scenes', () => {
    it('lists every scene under the company heading, all on to begin with', async () => {
      renderTab();
      await screen.findByText('办公');
      expect(screen.getByText('common.scenes.companyTitle')).toBeInTheDocument();
      expect(screen.getAllByRole('switch')).toHaveLength(3);
      expect(switchOf('办公')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('common.scenes.enabledCount:3/3')).toBeInTheDocument();
    });

    it('switching one off keeps it in the list, off, and remembers it for this member', async () => {
      renderTab();
      await screen.findByText('IT运维');
      fireEvent.click(switchOf('IT运维'));
      await waitFor(() => expect(switchOf('IT运维')).toHaveAttribute('aria-checked', 'false'));
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

    it('cannot be edited or deleted by the member: the company owns them', async () => {
      renderTab();
      await screen.findByText('办公');
      const row = screen.getByText('办公').closest('[data-scene-row]') as HTMLElement;
      // Starting a conversation is open to everyone; changing the scene is not.
      expect(within(row).getAllByRole('button')).toHaveLength(1);
      expect(within(row).getByTestId('scene-start')).toBeInTheDocument();
    });

    it('starts a conversation from a row by sending the person to the home page with that scene to open', async () => {
      renderTab('/settings/super-assistant');
      await screen.findByText('IT运维');
      const row = screen.getByText('IT运维').closest('[data-scene-row]') as HTMLElement;
      fireEvent.click(within(row).getByTestId('scene-start'));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/guid|{"openSceneKey":"s2"}'));
    });

    it('marks a company scene that asks questions first', async () => {
      hooks.myScenes.mockResolvedValue([
        scene('s1', '官网', {
          intent: { discovery: true, starters: [], questions: [], constraints: '', deliverables: '' },
        }),
        scene('s2', '办公'),
      ]);
      renderTab();
      await screen.findByText('官网');
      const asking = screen.getByText('官网').closest('[data-scene-row]') as HTMLElement;
      const quiet = screen.getByText('办公').closest('[data-scene-row]') as HTMLElement;
      expect(within(asking).getByText('common.scenes.askFirst')).toBeInTheDocument();
      expect(within(quiet).queryByText('common.scenes.askFirst')).not.toBeInTheDocument();
    });
  });

  describe('the person own scenes', () => {
    it('are listed under their own heading, with the way to change them', async () => {
      hooks.personal = [newPersonalScene({ name: '我的官网' })];
      renderTab();
      const row = (await screen.findByText('我的官网')).closest('[data-scene-row]') as HTMLElement;
      expect(row.dataset.sceneSource).toBe('mine');
      expect(screen.getByText('common.scenes.mine')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'common.edit' })).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'common.scenes.duplicate' })).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'common.delete' })).toBeInTheDocument();
    });

    it('can be switched off like any other', async () => {
      const mine = newPersonalScene({ name: '我的官网' });
      hooks.personal = [mine];
      renderTab();
      await screen.findByText('我的官网');
      fireEvent.click(switchOf('我的官网'));
      await waitFor(() => expect(switchOf('我的官网')).toHaveAttribute('aria-checked', 'false'));
      expect(JSON.parse(localStorage.getItem(OFF_KEY) ?? '[]')).toEqual([`mine:${mine.id}`]);
    });

    it('invites a person with none to make one', async () => {
      renderTab();
      expect(await screen.findByText('common.scenes.emptyMine')).toBeInTheDocument();
    });

    it('can be copied', async () => {
      hooks.personal = [newPersonalScene({ name: '我的官网', prompt: 'p' })];
      renderTab();
      const row = (await screen.findByText('我的官网')).closest('[data-scene-row]') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'common.scenes.duplicate' }));
      await waitFor(() => expect(saved()).toHaveLength(2));
      expect(saved()[1].name).toBe('我的官网 common.scenes.copySuffix');
      expect(saved()[1].prompt).toBe('p');
      expect(saved()[1].id).not.toBe(saved()[0].id);
    });

    it('can be deleted, after asking', async () => {
      hooks.personal = [newPersonalScene({ name: '我的官网' }), newPersonalScene({ name: '周报' })];
      renderTab();
      const row = (await screen.findByText('我的官网')).closest('[data-scene-row]') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'common.delete' }));
      expect(await screen.findByText('common.scenes.deleteConfirm:我的官网')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^(OK|确定)$/ }));
      await waitFor(() => expect(saved().map((item) => item.name)).toEqual(['周报']));
      await waitFor(() => expect(screen.queryByText('我的官网')).not.toBeInTheDocument());
    });
  });

  describe('making a scene', () => {
    it('starts from a template: the editor opens filled in, and saving keeps it', async () => {
      renderTab();
      await screen.findByText('办公');
      fireEvent.click(screen.getByTestId('scene-new'));
      fireEvent.click(await screen.findByText('Website with an AI assistant'));
      const name = (await screen.findByTestId('scene-name')) as HTMLInputElement;
      expect(name.value).toBe('Website with an AI assistant');
      // The template's questions are there to be changed.
      const questions = within(screen.getByTestId('scene-questions')).getAllByRole('textbox');
      expect(questions.length).toBeGreaterThanOrEqual(5);
      fireEvent.click(screen.getByTestId('scene-save'));
      await waitFor(() => expect(saved()).toHaveLength(1));
      expect(saved()[0]).toMatchObject({ name: 'Website with an AI assistant', templateId: 'website' });
      expect(saved()[0].intent.discovery).toBe(true);
      expect(saved()[0].intent.questions.length).toBeGreaterThanOrEqual(5);
      expect(await screen.findByText('common.scenes.mine')).toBeInTheDocument();
    });

    it('starts from blank, and will not save without a name', async () => {
      renderTab();
      await screen.findByText('办公');
      fireEvent.click(screen.getByTestId('scene-new'));
      fireEvent.click(await screen.findByText('common.scenes.blank'));
      await screen.findByTestId('scene-editor');
      fireEvent.click(screen.getByTestId('scene-save'));
      expect(await screen.findByText('common.scenes.editor.nameRequired')).toBeInTheDocument();
      expect(hooks.personal).toBeUndefined();

      fireEvent.change(screen.getByTestId('scene-name'), { target: { value: '周报' } });
      fireEvent.click(screen.getByTestId('scene-save'));
      await waitFor(() => expect(saved()).toHaveLength(1));
      expect(saved()[0].name).toBe('周报');
      // A new scene asks questions first unless told otherwise.
      expect(saved()[0].intent.discovery).toBe(true);
    });

    it('shows exactly what the conversation will be told, built from the settings', async () => {
      renderTab();
      await screen.findByText('办公');
      fireEvent.click(screen.getByTestId('scene-new'));
      fireEvent.click(await screen.findByText('Website with an AI assistant'));
      await screen.findByTestId('scene-editor');
      fireEvent.click(screen.getByText('common.scenes.editor.preview'));
      const preview = await screen.findByTestId('scene-rules-preview');
      expect(preview.textContent).toContain('understand first, then build');
      expect(preview.textContent).toContain('Who is the site for?');
    });

    it('drops the blank lines a person added but never filled in', async () => {
      renderTab();
      await screen.findByText('办公');
      fireEvent.click(screen.getByTestId('scene-new'));
      fireEvent.click(await screen.findByText('common.scenes.blank'));
      await screen.findByTestId('scene-editor');
      fireEvent.change(screen.getByTestId('scene-name'), { target: { value: '周报' } });
      fireEvent.click(within(screen.getByTestId('scene-questions')).getByRole('button'));
      fireEvent.click(within(screen.getByTestId('scene-starters')).getByRole('button'));
      fireEvent.click(screen.getByTestId('scene-save'));
      await waitFor(() => expect(saved()).toHaveLength(1));
      expect(saved()[0].intent.questions).toEqual([]);
      expect(saved()[0].intent.starters).toEqual([]);
    });

    it('opens straight on the choice of a start when the home page sent the person here to make one', async () => {
      renderTab('/?new=1');
      expect(await screen.findByTestId('scene-templates')).toBeInTheDocument();
    });
  });

  describe('the ask-first options', () => {
    const openBlank = async () => {
      renderTab();
      await screen.findByText('办公');
      fireEvent.click(screen.getByTestId('scene-new'));
      fireEvent.click(await screen.findByText('common.scenes.blank'));
      await screen.findByTestId('scene-editor');
    };

    it('show only while the switch is on: questions, example openers, hard rules and hand-over', async () => {
      await openBlank();
      expect(screen.getByTestId('scene-discovery-fields')).toBeInTheDocument();
      expect(screen.getByTestId('scene-questions')).toBeInTheDocument();
      expect(screen.getByTestId('scene-starters')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('switch', { name: 'common.scenes.editor.discovery' }));
      await waitFor(() => expect(screen.queryByTestId('scene-discovery-fields')).not.toBeInTheDocument());
      expect(screen.queryByTestId('scene-questions')).not.toBeInTheDocument();
      expect(screen.queryByTestId('scene-starters')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('common.scenes.editor.constraintsPlaceholder')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('switch', { name: 'common.scenes.editor.discovery' }));
      expect(await screen.findByTestId('scene-discovery-fields')).toBeInTheDocument();
    });

    it('keep what was typed when the switch is flipped off and on again', async () => {
      await openBlank();
      fireEvent.click(within(screen.getByTestId('scene-questions')).getByRole('button'));
      fireEvent.change(within(screen.getByTestId('scene-questions')).getByRole('textbox'), {
        target: { value: 'Who maintains it?' },
      });
      const toggle = screen.getByRole('switch', { name: 'common.scenes.editor.discovery' });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      const box = within(await screen.findByTestId('scene-questions')).getByRole('textbox') as HTMLInputElement;
      expect(box.value).toBe('Who maintains it?');
    });
  });

  describe('moving scenes between machines', () => {
    beforeEach(() => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    });

    it('exports only the person own scenes, and only when there are some', async () => {
      renderTab();
      await screen.findByText('办公');
      expect(screen.getByTestId('scene-export')).toBeDisabled();
    });

    it('exports them as a file', async () => {
      hooks.personal = [newPersonalScene({ name: '我的官网' })];
      renderTab();
      await screen.findByText('我的官网');
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      fireEvent.click(screen.getByTestId('scene-export'));
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      const blob = (URL.createObjectURL as unknown as { mock: { calls: Blob[][] } }).mock.calls[0][0];
      expect(blob.type).toBe('application/json');
      expect(click).toHaveBeenCalledTimes(1);
      click.mockRestore();
    });

    it('imports the scenes in a file as new ones, all of them, next to the ones already there', async () => {
      hooks.personal = [newPersonalScene({ name: '已有' })];
      renderTab();
      await screen.findByText('已有');
      const content = JSON.stringify({
        format: 'one-work-scenes',
        version: 1,
        scenes: [newPersonalScene({ name: '导入一' }), newPersonalScene({ name: '导入二' })],
      });
      const file = new File([content], 'scenes.json', { type: 'application/json' });
      // jsdom's File has no `text()`; the browser's does.
      Object.defineProperty(file, 'text', { value: async () => content });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => expect(saved().map((item) => item.name)).toEqual(['已有', '导入一', '导入二']));
    });
  });

  describe('without a company', () => {
    beforeEach(() => {
      hooks.company = false;
    });

    it('is the person own scenes only, and never asks the company for anything', async () => {
      hooks.personal = [newPersonalScene({ name: '周报' })];
      renderTab();
      await screen.findByText('周报');
      expect(screen.queryByText('common.scenes.companyTitle')).not.toBeInTheDocument();
      expect(hooks.myScenes).not.toHaveBeenCalled();
    });

    it('still lets a person make a scene', async () => {
      renderTab();
      await screen.findByText('common.scenes.emptyMine');
      fireEvent.click(screen.getByTestId('scene-new'));
      expect(await screen.findByTestId('scene-templates')).toBeInTheDocument();
    });
  });
});
