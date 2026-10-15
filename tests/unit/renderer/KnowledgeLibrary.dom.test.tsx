/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeLibrary from '@/renderer/pages/knowledge/KnowledgeLibrary';
import type { RagDocumentEntry, RagLibraryEntry } from '@/common/types/devops/devopsTypes';
import type { RagLibraryProps } from '@/renderer/pages/superAssistant/registries/RagSection';
const filterDocuments = vi.hoisted(() => vi.fn());
vi.mock('@/common', () => ({ ipcBridge: { oneDevops: { filterRagDocuments: { invoke: filterDocuments } } } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').at(-1), i18n: { language: 'en-US' } }),
}));
const row = (id: string, scope: string, status = 'ready'): RagDocumentEntry => ({
  id,
  title: id,
  scope,
  status,
  filePath: null,
  fileSize: null,
  mimeType: null,
  lastError: null,
  chunkCount: 1,
  teamId: null,
  visibility: 'all',
  createdBy: 'owner',
  createdAt: 1,
});
const setup = (isEnterprise = true, overrides: Partial<RagLibraryProps> = {}) => {
  const onOpen = vi.fn();
  render(
    <KnowledgeLibrary
      libraries={[]}
      onLibraryChange={vi.fn()}
      onCreateFolder={vi.fn()}
      isEnterprise={isEnterprise}
      rows={[row('Private notes', 'personal'), row('Team handbook', 'org')]}
      readOnlyLibrary={false}
      loading={false}
      importing={false}
      onOpen={onOpen}
      onCreate={vi.fn()}
      onImport={vi.fn()}
      onLink={vi.fn()}
      settings={null}
      search={<div>semantic search</div>}
      columns={[]}
      {...overrides}
    />
  );
  return { onOpen };
};
describe('Knowledge library browsing', () => {
  it('gives semantic search a focused page without a second search field or document list', () => {
    setup(false);
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    expect(screen.getByText('semantic search')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('filterPlaceholder')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /quickstartGuide.*quickstartGuideDescription/ })
    ).not.toBeInTheDocument();
  });
  it('does not label a private document as belonging to an organization space', () => {
    setup(true, {
      rows: [{ ...row('Private notes', 'personal'), libraryId: 'oraglib_default' }],
      libraries: [
        {
          id: 'oraglib_default',
          name: 'Organization space',
          scope: 'org',
          kind: 'space',
          description: '',
          createdBy: 'owner',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const documentRow = within(screen.getByRole('table')).getByRole('button', { name: 'Private notes' }).closest('tr')!;
    expect(documentRow).toHaveTextContent('personal');
    expect(documentRow).not.toHaveTextContent('Organization space');
  });
  it('opens built-in guides inline without creating user documents and keeps navigation available', () => {
    const onCreate = vi.fn();
    setup(false, { onCreate });
    fireEvent.click(screen.getAllByRole('button', { name: /quickstartGuide/ })[0]);
    expect(screen.getByRole('heading', { name: 'Get started with your library' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'usageGuide' }));
    expect(screen.getByRole('heading', { name: 'Library user guide' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'backToLibrary' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    localStorage.clear();
    filterDocuments.mockReset().mockResolvedValue([]);
  });
  it('keeps the directory navigation beside the inline document instead of the list', () => {
    setup(true, { documentView: <section>Inline reader</section>, activeDocument: row('Team handbook', 'org') });
    expect(screen.getByText('Inline reader')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'recent' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows child folders instead of an empty document table in a parent directory', () => {
    const parent: RagLibraryEntry = {
      id: 'parent',
      name: 'Team space',
      description: '',
      createdBy: 'owner',
      createdAt: 1,
      updatedAt: 1,
      scope: 'org',
      kind: 'space',
    };
    const onLibraryChange = vi.fn();
    setup(true, {
      rows: [],
      libraryId: parent.id,
      onLibraryChange,
      libraries: [parent, { ...parent, id: 'child', name: 'Runbooks', parentId: parent.id, kind: 'folder' }],
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Runbooks' }).at(-1)!);
    expect(onLibraryChange).toHaveBeenCalledWith('child');
  });
  it('filters the document list to personal documents', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'personal' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Private notes')).toBeInTheDocument();
    expect(within(table).queryByText('Team handbook')).not.toBeInTheDocument();
  });
  it('keeps standalone documents in my documents even with legacy org scope', () => {
    setup(false);
    expect(screen.queryByRole('tab', { name: 'team' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText('owner')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'personal' }));
    expect(within(screen.getByRole('table')).getByText('Team handbook')).toBeInTheDocument();
  });
  it('recovers when stored visits are malformed', () => {
    localStorage.setItem('knowledge-library-visits', 'invalid json');
    setup();
    expect(within(screen.getByRole('table')).getAllByText('notOpened')).toHaveLength(2);
  });
  it.each([true, false])('finds body-only matches in enterprise=%s', async (enterprise) => {
    filterDocuments.mockResolvedValue([row('Team handbook', 'org')]);
    setup(enterprise);
    fireEvent.change(screen.getByPlaceholderText('filterPlaceholder'), { target: { value: 'body-only-needle' } });
    await waitFor(() => expect(filterDocuments).toHaveBeenCalledWith({ query: 'body-only-needle' }));
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Team handbook')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).queryByText('Private notes')).not.toBeInTheDocument();
  });
  it('shows an empty state when neither name nor body matches', async () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('filterPlaceholder'), { target: { value: 'missing document' } });
    await waitFor(() => expect(screen.getByText('noMatches')).toBeInTheDocument());
  });
  it('ignores a late result from an earlier search', async () => {
    let resolveFirst!: (rows: RagDocumentEntry[]) => void;
    filterDocuments
      .mockImplementationOnce(
        () =>
          new Promise<RagDocumentEntry[]>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce([]);
    setup();
    fireEvent.change(screen.getByPlaceholderText('filterPlaceholder'), { target: { value: 'first' } });
    await waitFor(() => expect(filterDocuments).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText('filterPlaceholder'), { target: { value: 'second' } });
    await waitFor(() => expect(filterDocuments).toHaveBeenCalledTimes(2));
    resolveFirst([row('Team handbook', 'org')]);
    await waitFor(() => expect(screen.getByText('noMatches')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).queryByText('Team handbook')).not.toBeInTheDocument();
  });
  it('opens the selected document and records a visit', () => {
    const { onOpen } = setup();
    fireEvent.click(within(screen.getByRole('table')).getByText('Private notes'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'Private notes' }));
    expect(within(screen.getByRole('table')).getAllByText('notOpened')).toHaveLength(1);
  });
});
