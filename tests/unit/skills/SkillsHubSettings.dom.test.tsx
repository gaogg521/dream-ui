import React from 'react';
/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for SkillsHubSettings component (SK3 in N4a).
 * Shallow verification: module import + basic structure.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  getSkillPaths: vi.fn(),
  getSkillImportLimits: vi.fn(),
  listSkillImportHistory: vi.fn(),
  importSkills: vi.fn(),
  deleteSkill: vi.fn(),
  listAssistants: vi.fn(),
  showOpen: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  modalConfirm: vi.fn(),
}));

const searchParamsMock = vi.hoisted(() => ({
  current: new URLSearchParams(),
  setSearchParams: vi.fn(),
  pathname: '/settings/skills',
  navigate: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: mocks.listAvailableSkills },
      getSkillPaths: { invoke: mocks.getSkillPaths },
      getSkillImportLimits: { invoke: mocks.getSkillImportLimits },
      listSkillImportHistory: { invoke: mocks.listSkillImportHistory },
      importSkills: { invoke: mocks.importSkills },
      deleteSkill: { invoke: mocks.deleteSkill },
    },
    assistants: {
      list: { invoke: mocks.listAssistants },
    },
    dialog: {
      showOpen: { invoke: mocks.showOpen },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      error: mocks.messageError,
      success: mocks.messageSuccess,
      warning: mocks.messageWarning,
    },
    Modal: {
      ...actual.Modal,
      confirm: mocks.modalConfirm,
    },
  };
});

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: searchParamsMock.pathname, state: searchParamsMock.state }),
  useNavigate: () => searchParamsMock.navigate,
  useSearchParams: () => [searchParamsMock.current, searchParamsMock.setSearchParams],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'settings.skillsHub.importError': 'Error importing skill',
        'settings.skillsHub.importPartialSuccess':
          'Imported {{successCount}} skill(s), {{failureCount}} failed: {{failures}}',
        'settings.skillsHub.importErrors.SKILL_IMPORT_FILE_TOO_LARGE':
          'A file in this skill is over the size limit. Remove the large file and try again.',
        'settings.skillsHub.builtinSkill.mermaid.title': 'Mermaid Diagrams',
        'settings.skillsHub.builtinSkill.mermaid.desc': 'Render flowcharts as SVG or ASCII.',
        // Negative control: an entry the overlay must never reach, because
        // my-own-skill is imported. If it renders, the overlay leaked past
        // `source === 'builtin'`.
        'settings.skillsHub.builtinSkill.my-own-skill.title': 'OVERLAY LEAKED ONTO AN IMPORTED SKILL',
      };
      const template = translations[k] ?? (typeof options?.defaultValue === 'string' ? options.defaultValue : k);
      return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(options?.[key] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

import SkillsHubSettings from '@/renderer/pages/settings/SkillsHubSettings';

describe('SkillsHubSettings', () => {
  // The import action is now a TalkToButlerButton: open the menu, then click
  // "Import Skills" (the manual item) to run the manual import.
  const triggerManualImport = async () => {
    fireEvent.click(screen.getByTestId('btn-add-skill'));
    const marker = await screen.findByTestId('btn-add-skill-manual');
    fireEvent.click((marker.closest('[role="menuitem"]') ?? marker) as HTMLElement);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.current = new URLSearchParams();
    searchParamsMock.pathname = '/settings/skills';
    mocks.listAvailableSkills.mockResolvedValue([]);
    mocks.getSkillPaths.mockResolvedValue({
      user_skills_dir: '/tmp/user-skills',
      builtin_skills_dir: '/tmp/builtin-skills',
    });
    mocks.getSkillImportLimits.mockResolvedValue({
      max_file_bytes: 12 * 1024 * 1024,
      max_total_bytes: 64 * 1024 * 1024,
    });
    mocks.listSkillImportHistory.mockResolvedValue([]);
    mocks.listAssistants.mockResolvedValue([]);
  });

  it('exports a component (smoke)', () => {
    expect(SkillsHubSettings).toBeDefined();
    expect(typeof SkillsHubSettings).toBe('function');
  });

  it('has display name or name property (structure check)', () => {
    expect(SkillsHubSettings.displayName || SkillsHubSettings.name).toBeTruthy();
  });

  it('can be instantiated as JSX element (shallow)', () => {
    const element = <SkillsHubSettings />;
    expect(element.type).toBe(SkillsHubSettings);
  });

  it('shows backend import failure detail for manual imports', async () => {
    mocks.showOpen.mockResolvedValue(['/tmp/huge-skill']);
    mocks.importSkills.mockRejectedValue(
      Object.assign(new Error('wrapped import failure'), {
        name: 'BackendHttpError',
        status: 400,
        code: 'SKILL_IMPORT_FILE_TOO_LARGE',
      })
    );

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.listAvailableSkills).toHaveBeenCalled());
    await triggerManualImport();

    await waitFor(() =>
      expect(mocks.messageError).toHaveBeenCalledWith(
        'A file in this skill is over the size limit. Remove the large file and try again.'
      )
    );
  });

  it('shows partial import warning and refreshes after batch import partial success', async () => {
    mocks.showOpen.mockResolvedValue(['/tmp/parent-pack']);
    mocks.importSkills.mockResolvedValue({
      skill_name: 'sample-alpha',
      skill_names: ['sample-alpha'],
      failed: [{ source_name: 'beta-skill', code: 'SKILL_IMPORT_FILE_TOO_LARGE' }],
    });

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.listAvailableSkills).toHaveBeenCalled());
    const initialFetchCount = mocks.listAvailableSkills.mock.calls.length;
    await triggerManualImport();

    await waitFor(() =>
      expect(mocks.messageWarning).toHaveBeenCalledWith(
        'Imported 1 skill(s), 1 failed: beta-skill: A file in this skill is over the size limit. Remove the large file and try again.'
      )
    );
    await waitFor(() => expect(mocks.listAvailableSkills.mock.calls.length).toBeGreaterThan(initialFetchCount));
  });

  it('renders import history failure detail in the secondary view', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.getByText('parent-pack')).toBeInTheDocument();
    expect(screen.getByText(/beta-skill/)).toBeInTheDocument();
    expect(screen.getAllByText(/movie\.bin/).length).toBeGreaterThan(0);
  });

  it('renders import history entry point when history is empty', async () => {
    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('btn-open-import-history')).toBeInTheDocument());
    expect(screen.queryByText('No import records yet.')).not.toBeInTheDocument();
  });

  it('renders import history as a secondary view without search or category filters', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.queryByTestId('my-skills-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-search-my-skills')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Failed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Success' })).not.toBeInTheDocument();
  });

  it('shows concise repair instructions for failed import history records', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.getByText('Repair: remove the oversized file and import again')).toBeInTheDocument();
    expect(screen.getAllByText(/movie\.bin/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/11 MB/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 MB/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Latest 5')).not.toBeInTheDocument();
  });

  it('does not expose technical error details in import history', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-1',
        operation_id: 'operation-1',
        source_label: 'parent-pack',
        source_name: 'beta-skill',
        status: 'failed',
        error_code: 'SKILL_IMPORT_FILE_TOO_LARGE',
        error_path: 'movie.bin',
        actual_bytes: 11 * 1024 * 1024,
        limit_bytes: 10 * 1024 * 1024,
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.queryByText('Technical info')).not.toBeInTheDocument();
    expect(screen.queryByText('SKILL_IMPORT_FILE_TOO_LARGE')).not.toBeInTheDocument();
  });

  it('shows specific repair instructions for known non-size import errors', async () => {
    searchParamsMock.pathname = '/settings/skills/import-history';
    mocks.listSkillImportHistory.mockResolvedValue([
      {
        id: 'record-zip',
        operation_id: 'operation-zip',
        source_label: 'broken.zip',
        source_name: 'broken.zip',
        status: 'failed',
        error_code: 'SKILL_IMPORT_INVALID_ZIP',
        created_at: 1_700_000_000_000,
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('skill-import-history-page')).toBeInTheDocument());
    expect(screen.getByText('Repair: create the zip again and import it')).toBeInTheDocument();
    expect(screen.queryByText('Repair: update the skill files and import again')).not.toBeInTheDocument();
  });

  it('does not render an available status tag for imported skills', async () => {
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'sample-single',
        description: 'Single folder import fixture.',
        location: '/tmp/user-skills/sample-single',
        is_custom: true,
        source: 'custom',
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('my-skill-card-sample-single')).toBeInTheDocument());
    // The chip beside the icon now carries a category, not a source. "Custom"
    // was never the user's word for these -- they are skills this product
    // ships and the user installed -- and an imported skill has no category to
    // show, so it carries no chip at all. Source remains a pill filter.
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
  });

  it('files built-in skills under a category pill and imports under custom', async () => {
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'officecli-pptx',
        description: 'Slides.',
        location: '/tmp/builtin-skills/officecli-pptx/SKILL.md',
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'mermaid',
        description: 'Diagrams.',
        location: '/tmp/builtin-skills/mermaid/SKILL.md',
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'my-own-skill',
        description: 'Mine.',
        location: '/tmp/user-skills/my-own-skill',
        is_custom: true,
        source: 'custom',
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);
    await waitFor(() => expect(screen.getByTestId('skill-source-pills')).toBeInTheDocument());

    // Two different built-in categories, not one lump labelled "built-in".
    expect(screen.getByTestId('pill-skill-source-cat-office')).toBeInTheDocument();
    expect(screen.getByTestId('pill-skill-source-cat-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('pill-skill-source-source-custom')).toBeInTheDocument();

    // Selecting one narrows to it and leaves the others out.
    fireEvent.click(screen.getByTestId('pill-skill-source-cat-diagram'));
    await waitFor(() => expect(screen.getByTestId('my-skill-card-mermaid')).toBeInTheDocument());
    expect(screen.queryByTestId('my-skill-card-officecli-pptx')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-skill-card-my-own-skill')).not.toBeInTheDocument();
  });

  it('puts skills that ship an icon ahead of the ones falling back to a letter tile', async () => {
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'no-icon-first-from-backend',
        description: 'Arrives first but has no icon.',
        location: '/tmp/user-skills/no-icon-first-from-backend',
        is_custom: true,
        source: 'custom',
      },
      {
        name: 'has-an-icon',
        description: 'Ships _icon.svg.',
        location: '/tmp/user-skills/has-an-icon',
        is_custom: true,
        source: 'custom',
        icon_file: '_icon.svg',
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('my-skill-card-has-an-icon')).toBeInTheDocument());

    const cards = screen.getAllByTestId(/^my-skill-card-/);
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'my-skill-card-has-an-icon',
      'my-skill-card-no-icon-first-from-backend',
    ]);
  });

  it('localizes built-in skill text without touching what an imported skill authored', async () => {
    // `description` is model-facing: build_skills_index_text renders it into
    // the system prompt, trigger wording included. The overlay is display-only
    // and built-in only -- an imported skill is the user's own content, so its
    // authored text has to survive untouched.
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'mermaid',
        description: 'Render Mermaid diagrams as SVG or ASCII art using beautiful-mermaid.',
        location: '/tmp/builtin-skills/mermaid/SKILL.md',
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'my-own-skill',
        display_name: '我自己的技能',
        description: 'Authored by the user, not ours to rewrite.',
        location: '/tmp/user-skills/my-own-skill',
        is_custom: true,
        source: 'custom',
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('my-skill-card-mermaid')).toBeInTheDocument());

    // The built-in one is looked up by name and shows the localized text.
    expect(screen.getByText('Mermaid Diagrams')).toBeInTheDocument();
    expect(screen.getByText('Render flowcharts as SVG or ASCII.')).toBeInTheDocument();
    expect(
      screen.queryByText('Render Mermaid diagrams as SVG or ASCII art using beautiful-mermaid.')
    ).not.toBeInTheDocument();

    // The imported one keeps exactly what its author wrote.
    expect(screen.getByText('我自己的技能')).toBeInTheDocument();
    expect(screen.getByText('Authored by the user, not ours to rewrite.')).toBeInTheDocument();
    expect(screen.queryByText('OVERLAY LEAKED ONTO AN IMPORTED SKILL')).not.toBeInTheDocument();
  });

  it('renders auto-injected skills from the main catalog and keeps cron-source skills out of my skills', async () => {
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'cron',
        description: 'Auto injected cron skill.',
        location: '/tmp/builtin-skills/auto-inject/cron/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
      {
        name: 'sample-single',
        description: 'Single folder import fixture.',
        location: '/tmp/user-skills/sample-single',
        is_custom: true,
        source: 'custom',
      },
      {
        name: 'job-generated',
        description: 'Generated for a scheduled task.',
        location: '/tmp/cron/skills/job-generated',
        is_custom: false,
        source: 'cron',
      },
    ]);

    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(screen.getByTestId('auto-skills-section')).toBeInTheDocument());
    expect(screen.getByText('cron')).toBeInTheDocument();
    expect(screen.queryByText('job-generated')).not.toBeInTheDocument();
    expect(screen.getByTestId('my-skill-card-sample-single')).toBeInTheDocument();
  });

  it('does not expose the local skills directory path on the skills page', async () => {
    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.listAvailableSkills).toHaveBeenCalled());
    expect(screen.queryByText('/tmp/user-skills')).not.toBeInTheDocument();
  });

  it('renders import rules with server-provided size limits', async () => {
    render(<SkillsHubSettings withWrapper={false} />);

    await waitFor(() => expect(mocks.getSkillImportLimits).toHaveBeenCalled());
    expect(screen.getByText(/12 MB per file, 64 MB per skill/)).toBeInTheDocument();
  });

  describe('batch delete (Custom tab)', () => {
    const customSkills = [
      {
        name: 'skill-alpha',
        description: 'First custom skill.',
        location: '/tmp/user-skills/skill-alpha',
        is_auto_inject: false,
        is_custom: true,
        source: 'custom',
      },
      {
        name: 'skill-beta',
        description: 'Second custom skill.',
        location: '/tmp/user-skills/skill-beta',
        is_auto_inject: false,
        is_custom: true,
        source: 'custom',
      },
      {
        name: 'skill-gamma',
        description: 'Third custom skill.',
        location: '/tmp/user-skills/skill-gamma',
        is_auto_inject: false,
        is_custom: true,
        source: 'custom',
      },
    ];

    const confirmBatchDelete = async () => {
      // Modal.confirm is mocked; invoke the onOk callback the component passed in.
      await waitFor(() => expect(mocks.modalConfirm).toHaveBeenCalled());
      const config = mocks.modalConfirm.mock.calls.at(-1)?.[0] as { onOk?: () => Promise<void> };
      await config.onOk?.();
    };

    beforeEach(() => {
      mocks.listAvailableSkills.mockResolvedValue(customSkills);
      mocks.deleteSkill.mockResolvedValue(undefined);
    });

    it('hides batch manage entry when there are no custom skills', async () => {
      mocks.listAvailableSkills.mockResolvedValue([]);
      render(<SkillsHubSettings withWrapper={false} />);

      await waitFor(() => expect(mocks.listAvailableSkills).toHaveBeenCalled());
      expect(screen.queryByTestId('btn-batch-manage')).not.toBeInTheDocument();
    });

    it('enters batch mode: shows checkboxes, hides per-card delete buttons', async () => {
      render(<SkillsHubSettings withWrapper={false} />);

      await screen.findByTestId('my-skill-card-skill-alpha');
      expect(screen.getByTestId('btn-delete-skill-alpha')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('btn-batch-manage'));

      expect(screen.getByTestId('checkbox-skill-skill-alpha')).toBeInTheDocument();
      expect(screen.getByTestId('checkbox-skill-skill-beta')).toBeInTheDocument();
      expect(screen.queryByTestId('btn-delete-skill-alpha')).not.toBeInTheDocument();
      expect(screen.getByTestId('btn-batch-delete')).toBeDisabled();
    });

    it('selects skills and deletes them after confirmation', async () => {
      render(<SkillsHubSettings withWrapper={false} />);

      await screen.findByTestId('my-skill-card-skill-alpha');
      fireEvent.click(screen.getByTestId('btn-batch-manage'));

      fireEvent.click(screen.getByTestId('my-skill-card-skill-alpha'));
      fireEvent.click(screen.getByTestId('my-skill-card-skill-beta'));
      expect(screen.getByText('2 selected')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('btn-batch-delete'));
      await confirmBatchDelete();

      await waitFor(() => expect(mocks.deleteSkill).toHaveBeenCalledTimes(2));
      expect(mocks.deleteSkill).toHaveBeenCalledWith({ skill_name: 'skill-alpha' });
      expect(mocks.deleteSkill).toHaveBeenCalledWith({ skill_name: 'skill-beta' });
      await waitFor(() => expect(mocks.messageSuccess).toHaveBeenCalledWith('Deleted 2 skill(s)'));
      // Batch mode exits after deletion.
      await waitFor(() => expect(screen.queryByTestId('btn-batch-delete')).not.toBeInTheDocument());
    });

    it('select all toggles every visible skill', async () => {
      render(<SkillsHubSettings withWrapper={false} />);

      await screen.findByTestId('my-skill-card-skill-alpha');
      fireEvent.click(screen.getByTestId('btn-batch-manage'));

      const selectAll = screen.getByTestId('checkbox-select-all-skills');
      fireEvent.click(selectAll.querySelector('input') ?? selectAll);
      expect(screen.getByText('3 selected')).toBeInTheDocument();

      fireEvent.click(selectAll.querySelector('input') ?? selectAll);
      expect(screen.getByText('0 selected')).toBeInTheDocument();
    });

    it('shows partial warning when some deletions fail', async () => {
      mocks.deleteSkill.mockImplementation(({ skill_name }: { skill_name: string }) =>
        skill_name === 'skill-beta' ? Promise.reject(new Error('boom')) : Promise.resolve(undefined)
      );

      render(<SkillsHubSettings withWrapper={false} />);

      await screen.findByTestId('my-skill-card-skill-alpha');
      fireEvent.click(screen.getByTestId('btn-batch-manage'));
      fireEvent.click(screen.getByTestId('my-skill-card-skill-alpha'));
      fireEvent.click(screen.getByTestId('my-skill-card-skill-beta'));
      fireEvent.click(screen.getByTestId('btn-batch-delete'));
      await confirmBatchDelete();

      await waitFor(() => expect(mocks.messageWarning).toHaveBeenCalledWith('Deleted 1 skill(s), 1 failed'));
    });

    it('cancel exits batch mode and clears selection', async () => {
      render(<SkillsHubSettings withWrapper={false} />);

      await screen.findByTestId('my-skill-card-skill-alpha');
      fireEvent.click(screen.getByTestId('btn-batch-manage'));
      fireEvent.click(screen.getByTestId('my-skill-card-skill-alpha'));
      fireEvent.click(screen.getByTestId('btn-batch-cancel'));

      expect(screen.queryByTestId('checkbox-skill-skill-alpha')).not.toBeInTheDocument();
      expect(screen.getByTestId('btn-delete-skill-alpha')).toBeInTheDocument();
      expect(mocks.deleteSkill).not.toHaveBeenCalled();

      // Re-entering batch mode starts with a clean selection.
      fireEvent.click(screen.getByTestId('btn-batch-manage'));
      expect(screen.getByText('0 selected')).toBeInTheDocument();
    });
  });
});
