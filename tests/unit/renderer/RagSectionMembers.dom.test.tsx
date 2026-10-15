/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: null as unknown,
  docs: [] as unknown[],
  register: vi.fn(async () => ({ id: 'new-doc' })),
  upload: vi.fn(async () => ({})),
  setContent: vi.fn(async () => undefined),
  translate: (key: string) => key,
}));
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpUploadMultipart: mocks.upload,
}));
vi.mock('@/common/adapter/ipcBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/ipcBridge')>()),
  isNativeDialogAvailable: () => false,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
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
      setRagContent: { invoke: mocks.setContent },
      getRagContent: { invoke: vi.fn(async () => 'Previous original text') },
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
    mocks.upload.mockClear();
    mocks.setContent.mockClear();
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
  it('offers reading rather than a nonfunctional text edit action for an Office original', async () => {
    mocks.context = null;
    mocks.docs = [
      {
        ...doc('office', 'Office.docx', 'personal'),
        filePath: 'rag-source:fixture',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ];
    render(
      <RagSection
        renderLibrary={(props) => (
          <>
            {props.rows.map((row) => (
              <div key={row.id}>{props.columns.at(-1)?.render?.(null, row, 0) as React.ReactNode}</div>
            ))}
          </>
        )}
      />
    );
    await screen.findByRole('button', { name: 'common.knowledgeLibrary.read' });
    expect(screen.queryByRole('button', { name: 'common.edit' })).not.toBeInTheDocument();
  });
  it('uploads a browser-selected local file into personal scope without desktop file IPC', async () => {
    mocks.context = null;
    render(
      <RagSection
        renderLibrary={(props) => <button onClick={() => props.onImport(true)}>Import browser file</button>}
      />
    );
    fireEvent.click(screen.getByText('Import browser file'));
    const file = new File(['# Browser notes'], 'browser-notes.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: async () => '# Browser notes' });
    fireEvent.change(screen.getByTestId('knowledge-file-import'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.setContent).toHaveBeenCalledWith({ id: 'new-doc', content: '# Browser notes' }));
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'browser-notes.md', scope: 'personal' })
    );
    expect(mocks.upload).toHaveBeenCalledWith('/api/one/devops/rag/documents/new-doc/source', file, 'file', {
      timeoutMs: 120000,
    });
  });
  it('extracts replacement text and updates the existing document instead of keeping its old search body', async () => {
    mocks.context = null;
    const file = new File(['Replacement unique body'], 'replacement.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => 'Replacement unique body' });
    mocks.upload.mockResolvedValueOnce({ ...doc('d2', 'My notes', 'personal'), filePath: 'rag-source:new' });
    render(
      <RagSection
        renderLibrary={(props) => {
          const document = props.documentView as
            | React.ReactElement<{
                uploadOriginal: (file: File) => Promise<unknown>;
                content: string;
                onBack: () => void;
              }>
            | undefined;
          return (
            <>
              <button
                disabled={!props.rows.some((row) => row.id === 'd2')}
                onClick={() => props.onOpen(props.rows.find((row) => row.id === 'd2')!)}
              >
                Open document
              </button>
              {document && <button onClick={() => void document.props.uploadOriginal(file)}>Replace original</button>}
              {document && <button onClick={document.props.onBack}>Close document</button>}
              {document && <span>{document.props.content}</span>}
            </>
          );
        }}
      />
    );
    await waitFor(() => expect(screen.getByText('Open document')).toBeEnabled());
    fireEvent.click(screen.getByText('Open document'));
    fireEvent.click(await screen.findByText('Replace original'));
    await waitFor(() =>
      expect(mocks.setContent).toHaveBeenCalledWith({ id: 'd2', content: 'Replacement unique body' })
    );
    expect(mocks.register).not.toHaveBeenCalled();
    expect(screen.getByText('Replacement unique body')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close document'));
    expect(screen.queryByText('Replace original')).not.toBeInTheDocument();
  });
});
