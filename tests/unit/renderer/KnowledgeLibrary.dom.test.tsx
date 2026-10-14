/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KnowledgeLibrary from '@/renderer/pages/knowledge/KnowledgeLibrary';
import type { RagDocumentEntry } from '@/common/types/devops/devopsTypes';
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
const setup = (isEnterprise = true) => {
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
    />
  );
  return { onOpen };
};
describe('Knowledge library browsing', () => {
  beforeEach(() => localStorage.clear());
  it('filters the document list to personal documents', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'personal' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Private notes')).toBeInTheDocument();
    expect(within(table).queryByText('Team handbook')).not.toBeInTheDocument();
  });
  it('keeps standalone documents in my documents even with legacy org scope', () => {
    setup(false);
    fireEvent.click(screen.getByRole('tab', { name: 'personal' }));
    expect(within(screen.getByRole('table')).getByText('Team handbook')).toBeInTheDocument();
  });
  it('recovers when stored visits are malformed', () => {
    localStorage.setItem('knowledge-library-visits', 'invalid json');
    setup();
    expect(within(screen.getByRole('table')).getAllByText('notOpened')).toHaveLength(2);
  });
  it('shows an empty state when no document name matches', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('filterPlaceholder'), { target: { value: 'missing document' } });
    expect(screen.getByText('empty')).toBeInTheDocument();
  });
  it('opens the selected document and records a visit', () => {
    const { onOpen } = setup();
    fireEvent.click(within(screen.getByRole('table')).getByText('Private notes'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'Private notes' }));
    expect(within(screen.getByRole('table')).getAllByText('notOpened')).toHaveLength(1);
  });
});
