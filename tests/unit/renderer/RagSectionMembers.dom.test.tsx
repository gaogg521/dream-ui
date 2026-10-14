/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: null as unknown,
  docs: [] as unknown[],
  register: vi.fn(async () => ({ id: 'new-doc' })),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: mocks.context }),
  isOrgAdminRole: (role: string | null | undefined) => role === 'org_admin' || role === 'system_admin',
}));
vi.mock('@renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: mocks.context }),
  isOrgAdminRole: (role: string | null | undefined) => role === 'org_admin' || role === 'system_admin',
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    oneDevops: {
      listRagLibraries: { invoke: vi.fn(async () => [{ id: 'shared-lib', name: 'Shared library' }]) },
      registerRagDocument: { invoke: mocks.register },
      setRagContent: { invoke: vi.fn(async () => undefined) },
      listRagDocuments: { invoke: vi.fn(async () => mocks.docs) },
      getRagConfig: { invoke: vi.fn(async () => ({ baseUrl: '', model: '' })) },
    },
    oneOrg: { allTenants: { invoke: vi.fn(async () => []) } },
  },
}));
vi.mock('@renderer/utils/enterprise/friendlyEnterpriseError', () => ({ friendlyEnterpriseError: () => 'err' }));

import RagSection from '@/renderer/pages/superAssistant/registries/RagSection';

const doc = (id: string, title: string, scope: string) => ({
  id,
  title,
  filePath: null,
  fileSize: null,
  mimeType: null,
  status: 'ready',
  lastError: null,
  chunkCount: 3,
  scope,
  teamId: null,
  visibility: 'all',
  createdBy: 'someone',
  createdAt: 1,
});

describe('RagSection for company members', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    mocks.register.mockClear();
    mocks.docs = [doc('d1', 'Company handbook', 'org'), doc('d2', 'My notes', 'personal')];
  });

  it('lets a member add and manage their own documents but not the ones the company distributed', async () => {
    mocks.context = { isEnterprise: true, role: 'member' };
    render(<RagSection />);
    await waitFor(() => expect(screen.getByText('My notes')).toBeInTheDocument());

    // Adding and importing are open to them; the embedding endpoint is not.
    expect(screen.getByText('common.superAssistant.registries.addRag')).toBeInTheDocument();
    expect(screen.queryByText('common.superAssistant.rag.configButton')).not.toBeInTheDocument();

    // The company's document carries the badge and no actions; theirs is the opposite.
    expect(screen.getAllByTestId('company-badge')).toHaveLength(1);
    expect(screen.getAllByText('common.edit')).toHaveLength(1);
    expect(screen.getAllByText('common.delete')).toHaveLength(1);
    expect(screen.getByText('common.superAssistant.rag.managedByCompany')).toBeInTheDocument();
    expect(screen.getByText('common.superAssistant.rag.onlyMe')).toBeInTheDocument();
  });

  it('gives an administrator every action, and the badge on what they distributed', async () => {
    mocks.context = { isEnterprise: true, role: 'org_admin' };
    render(<RagSection />);
    await waitFor(() => expect(screen.getByText('Company handbook')).toBeInTheDocument());

    expect(screen.getByText('common.superAssistant.rag.configButton')).toBeInTheDocument();
    expect(screen.getAllByText('common.edit')).toHaveLength(2);
    expect(screen.queryByText('common.superAssistant.rag.managedByCompany')).not.toBeInTheDocument();
  });

  it('shows no company badge and every action when there is no company', async () => {
    mocks.context = null;
    render(<RagSection />);
    await waitFor(() => expect(screen.getByText('Company handbook')).toBeInTheDocument());

    expect(screen.queryByTestId('company-badge')).not.toBeInTheDocument();
    expect(screen.getAllByText('common.edit')).toHaveLength(2);
  });
  it('registers desktop documents in the selected enterprise library', async () => {
    mocks.context = { isEnterprise: true, role: 'org_admin' };
    render(
      <RagSection
        renderLibrary={(props) => (
          <>
            <button onClick={() => props.onLibraryChange('shared-lib')}>Select library</button>
            <button onClick={props.onCreate}>Create document</button>
            {props.documentView}
          </>
        )}
      />
    );
    fireEvent.click(screen.getByText('Select library'));
    fireEvent.click(screen.getByText('Create document'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('common.superAssistant.registries.colTitle'), {
      target: { value: 'Shared runbook' },
    });
    await waitFor(
      () =>
        expect(mocks.register).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Shared runbook', libraryId: 'shared-lib' })
        ),
      { timeout: 3000 }
    );
  });
});
