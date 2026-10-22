/**
 * RAG management — embedding endpoint config, document registration with
 * inline content, chunk/embed processing, and semantic search, on top of the
 * one-devops rag endpoints. Embedding provider is any OpenAI-compatible
 * endpoint (D1 decision).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Table,
  Tabs,
  Tag,
  Select,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import libraryStyles from '../../knowledge/KnowledgeLibrary.module.css';
import CsvDocument from '../../knowledge/CsvDocument';
import { usesOriginalFile } from '../../knowledge/original/sourceKind';
import { ipcBridge } from '@/common';
import { httpDownloadBinary, httpUploadMultipart } from '@/common/adapter/httpBridge';
import { cacheOriginal, originalCacheKey } from '../../knowledge/original/originalCache';
import { isNativeDialogAvailable } from '@/common/adapter/ipcBridge';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import CompanyBadge from '@renderer/components/enterprise/CompanyBadge';
import { isOrgAdminRole, useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { RAG_DOCUMENT_EXTENSIONS } from '@/common/config/constants';
import type {
  RagConfig,
  RagLibraryEntry,
  RagDocumentEntry,
  RagSearchHit,
  ResourceScope,
  ResourceVisibility,
} from '@/common/types/devops/devopsTypes';
import LibraryDocument, { RichDocumentEditor } from '../../knowledge/LibraryDocument';
import AddToConversationModal from '../../knowledge/attach/AddToConversationModal';
import { aclInitialValues, aclPayload, ResourceAclCell, ResourceAclFields, useAllTenants } from './ResourceAcl';

/** Strip the extension for a sensible default document title. */
const titleFromFileName = (fileName: string): string => fileName;

const STATUS_COLORS: Record<string, string> = {
  ready: 'green',
  pending: 'gray',
  error: 'red',
};

/**
 * Documents a member makes themselves are stored with this scope: private to
 * them, and theirs to edit and delete. Everything else on a company server was
 * distributed by an administrator and only an administrator changes it.
 */
const PERSONAL_SCOPE = 'personal';

/**
 * A fixed 120 s cap made any larger original fail on an ordinary office uplink (an enterprise client sends it to
 * the remote server). Allow ~8 s per MiB (floor of ~128 KiB/s), never less than 120 s.
 */
const uploadTimeoutMs = (bytes: number) => Math.max(120_000, Math.ceil(bytes / (1024 * 1024)) * 8_000);

const RAG_SOURCE_LIMIT_BYTES = 100 * 1024 * 1024;
const RAG_SOURCE_CHUNK_BYTES = 8 * 1024 * 1024;
/** The content endpoint accepts at most 16 MiB; stay clear of it (CJK text is up to 3 bytes per character). */
const MAX_INDEXED_TEXT_BYTES = 12 * 1024 * 1024;

const abortError = () => new DOMException('Import cancelled', 'AbortError');

/** Settles with whichever comes first: the call, or the user cancelling. An IPC call itself cannot be interrupted. */
const raceAbort = <T,>(call: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return call;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    call.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
};

/** Text too large to be worth indexing is dropped; the original is still kept (source-only). */
const indexableText = (text: string): string =>
  text.length * 3 > MAX_INDEXED_TEXT_BYTES && new TextEncoder().encode(text).length > MAX_INDEXED_TEXT_BYTES
    ? ''
    : text;

export type RagLibraryProps = {
  documentView?: React.ReactNode;
  activeDocument?: RagDocumentEntry | null;
  isEnterprise?: boolean;
  rows: RagDocumentEntry[];
  libraries: RagLibraryEntry[];
  libraryId?: string;
  onLibraryChange: (id?: string) => void;
  onCreateLibrary?: () => void;
  onCreateFolder: (personal: boolean) => void;
  readOnlyLibrary: boolean;
  loading: boolean;
  importing: boolean;
  /** Which file the running import is on, so the library can show real progress. */
  importProgress?: { current: number; total: number; name: string } | null;
  onCancelImport?: () => void;
  onCreate: (kind?: 'markdown' | 'csv', personal?: boolean) => void;
  onImport: (personal?: boolean) => void;
  onLink: (personal?: boolean) => void;
  onOpen: (record: RagDocumentEntry) => void;
  /** Opens the "add to conversation" dialog for these documents. */
  onAddToConversation?: (records: RagDocumentEntry[]) => void;
  settings: React.ReactNode;
  search: React.ReactNode;
  columns: React.ComponentProps<typeof Table<RagDocumentEntry>>['columns'];
};

const RagSection: React.FC<{ renderLibrary?: (props: RagLibraryProps) => React.ReactNode }> = ({ renderLibrary }) => {
  const { t } = useTranslation();
  const { context } = useOrgContext();
  const isEnterprise = Boolean(context?.isEnterprise);
  // A company member manages their own documents but not the company's: no
  // embedding-endpoint settings, no visibility choices, no changes to what an
  // administrator distributed.
  const memberMode = isEnterprise && !isOrgAdminRole(context?.role);
  const canChange = (record: RagDocumentEntry): boolean => !memberMode || record.scope === PERSONAL_SCOPE;
  const [libraries, setLibraries] = useState<RagLibraryEntry[]>([]);
  const [libraryId, setLibraryId] = useState<string>();
  const [libraryModal, setLibraryModal] = useState(false);
  const [folderScope, setFolderScope] = useState<'personal' | 'org' | null>(null);
  const [libraryName, setLibraryName] = useState('');
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RagDocumentEntry[]>([]);
  const [config, setConfig] = useState<RagConfig | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { tenants } = useAllTenants();

  const [docModalVisible, setDocModalVisible] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const draftId = useRef<string | undefined>(undefined);
  const originalDraft = useRef('');
  const [documentPersonal, setDocumentPersonal] = useState(false);
  const [urlPersonal, setUrlPersonal] = useState(false);
  const [documentKind, setDocumentKind] = useState<'markdown' | 'csv'>('markdown');
  const [savingDoc, setSavingDoc] = useState(false);
  const [docForm] = Form.useForm();

  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configForm] = Form.useForm();

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<RagSearchHit[] | null>(null);

  const [metadataTarget, setMetadataTarget] = useState<RagDocumentEntry | null>(null);
  const [attachDocs, setAttachDocs] = useState<RagDocumentEntry[] | null>(null);
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataLibrary, setMetadataLibrary] = useState('oraglib_default');
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [editTarget, setEditTarget] = useState<RagDocumentEntry | null>(null);
  const [reading, setReading] = useState(true);
  const [editContent, setEditContent] = useState('');
  const originalContent = useRef('');
  const editRevision = useRef<number | null>(null);
  const draftRevision = useRef<number | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const pendingNavigation = useRef<() => void>(() => {});
  const editRequest = useRef(0);
  const documentLeaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const navigateDocument = async (action: () => void) => {
    if (documentLeaveGuard.current && !(await documentLeaveGuard.current())) return;
    if (savingEdit || savingDoc) return;
    const run = () => {
      editRequest.current += 1;
      setEditLoading(false);
      setDocModalVisible(false);
      action();
    };
    if (
      (editTarget &&
        !usesOriginalFile(editTarget.filePath, editTarget.mimeType) &&
        editContent !== originalContent.current) ||
      (docModalVisible && JSON.stringify([draftTitle, draftContent]) !== originalDraft.current)
    ) {
      pendingNavigation.current = run;
      setDiscardConfirm(true);
    } else run();
  };
  const closeDocument = () => navigateDocument(() => setEditTarget(null));
  const [editLoading, setEditLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const [importingFiles, setImportingFiles] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const importAbort = useRef<AbortController | null>(null);
  const cancelImport = () => importAbort.current?.abort();
  const webImportInput = useRef<HTMLInputElement>(null);
  const webImportPersonal = useRef(false);
  const [urlModalVisible, setUrlModalVisible] = useState(false);
  const [importingUrl, setImportingUrl] = useState(false);
  const [urlForm] = Form.useForm();

  const refresh = useCallback(async () => {
    try {
      const [docs, cfg, libs] = await Promise.all([
        ipcBridge.oneDevops.listRagDocuments.invoke(),
        ipcBridge.oneDevops.getRagConfig.invoke().catch((): null => null),
        ipcBridge.oneDevops.listRagLibraries?.invoke().catch((): RagLibraryEntry[] => []) ?? Promise.resolve([]),
      ]);
      setRows(docs ?? []);
      setLibraries(libs ?? []);
      setConfig(cfg ?? null);
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.loadFailed', { defaultValue: '加载失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!rows.some((document) => document.status === 'pending')) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [rows, refresh]);

  const openConfig = () => {
    configForm.setFieldsValue({ baseUrl: config?.baseUrl ?? '', model: config?.model ?? '', apiKey: '' });
    setConfigModalVisible(true);
  };

  const handleSaveConfig = async () => {
    const values = (await configForm.validate().catch((): null => null)) as {
      baseUrl: string;
      model: string;
      apiKey?: string;
    } | null;
    if (!values) {
      return;
    }
    setSavingConfig(true);
    try {
      await ipcBridge.oneDevops.setRagConfig.invoke({
        baseUrl: values.baseUrl,
        model: values.model,
        // Empty = keep stored key.
        apiKey: values.apiKey ? values.apiKey : undefined,
      });
      Message.success(t('common.superAssistant.registries.saved', { defaultValue: '已保存' }));
      setConfigModalVisible(false);
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.saveFailed', { defaultValue: '保存失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const openRegister = (kind: 'markdown' | 'csv' = 'markdown', personal = false) => {
    setDocumentPersonal(
      personal || libraries.find((item) => item.id === libraryId)?.scope === 'personal' || memberMode
    );
    setDocumentKind(kind);
    setEditTarget(null);
    draftId.current = undefined;
    draftRevision.current = null;
    originalDraft.current = JSON.stringify([
      '',
      kind === 'csv'
        ? `${t('common.knowledgeLibrary.columnLabel', { index: 1 })},${t('common.knowledgeLibrary.columnLabel', { index: 2 })}\n,\n`
        : '',
    ]);
    setDraftTitle('');
    setDraftContent(
      kind === 'csv'
        ? `${t('common.knowledgeLibrary.columnLabel', { index: 1 })},${t('common.knowledgeLibrary.columnLabel', { index: 2 })}\n,\n`
        : ''
    );
    docForm.resetFields();
    if (kind === 'csv')
      docForm.setFieldsValue({
        content: `${t('common.knowledgeLibrary.columnLabel', { index: 1 })},${t('common.knowledgeLibrary.columnLabel', { index: 2 })}\n,\n`,
      });
    setDocModalVisible(true);
  };

  const handleRegister = async (automatic = false) => {
    const values = (
      renderLibrary ? { title: draftTitle, content: draftContent } : await docForm.validate().catch((): null => null)
    ) as {
      title: string;
      content?: string;
      scope?: ResourceScope;
      teamId?: string | null;
      visibility?: ResourceVisibility;
    } | null;
    if (!values) {
      return;
    }
    if (!values.title.trim()) values.title = t('common.knowledgeLibrary.untitled');
    setSavingDoc(true);
    try {
      const target = libraries.find((library) => library.id === libraryId);
      const privateDocument =
        (Boolean(renderLibrary) && !isEnterprise) || documentPersonal || memberMode || target?.scope === 'personal';
      const destination = target && (target.scope === 'personal') === privateDocument ? target.id : undefined;
      const doc =
        draftId.current && renderLibrary
          ? { id: draftId.current }
          : await ipcBridge.oneDevops.registerRagDocument.invoke({
              title: documentKind === 'csv' && !/\.csv$/i.test(values.title) ? `${values.title}.csv` : values.title,
              ...(documentKind === 'csv' ? { mimeType: 'text/csv' } : {}),
              ...(destination ? { libraryId: destination } : {}),
              // A member's document is always private; the server decides, so no ACL is sent.
              ...(privateDocument ? { scope: 'personal' as const } : memberMode ? {} : aclPayload(values)),
            });
      if (renderLibrary && doc?.id) {
        if (draftId.current)
          await ipcBridge.oneDevops.updateRagDocumentLocation.invoke({
            id: doc.id,
            title: values.title,
            ...(destination ? { libraryId: destination } : {}),
          });
        draftId.current = doc.id;
      }
      if (doc?.id) {
        if (draftRevision.current === null)
          draftRevision.current = (await ipcBridge.oneDevops.getRagContentState.invoke({ id: doc.id })).revision;
        draftRevision.current = await ipcBridge.oneDevops.setRagContent.invoke({
          id: doc.id,
          content: values.content ?? '',
          expectedRevision: draftRevision.current,
        });
      }
      originalDraft.current = JSON.stringify([draftTitle, draftContent]);
      if (!automatic) {
        Message.success(t('common.superAssistant.registries.saved'));
        setDocModalVisible(false);
      }
      await refresh();
      if (!automatic && renderLibrary && doc?.id) {
        const saved = (await ipcBridge.oneDevops.listRagDocuments.invoke()).find((item) => item.id === doc.id);
        if (saved) await openEdit(saved);
      }
    } catch (error) {
      if (automatic) throw error;
      Message.error(
        t('common.superAssistant.registries.saveFailed', { defaultValue: '保存失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setSavingDoc(false);
    }
  };

  /**
   * Register extracted content. Saving queues background indexing on the server.
   */
  const registerAndProcess = useCallback(
    async (
      title: string,
      content: string,
      personal = false,
      sourcePath?: string | File,
      signal?: AbortSignal
    ): Promise<void> => {
      let originalFile: File | undefined;
      if (typeof sourcePath === 'string') {
        // Slice by slice: one message carrying a big file is silently dropped by the bridge (50 MiB cap), which
        // left every import above ~37 MB waiting forever.
        const parts: Blob[] = [];
        let name = '';
        for (let offset = 0, size = 1; offset < size; ) {
          const slice = await raceAbort(
            ipcBridge.application.readRagSourceChunk.invoke({
              filePath: sourcePath,
              offset,
              length: RAG_SOURCE_CHUNK_BYTES,
            }),
            signal
          );
          if ('error' in slice) throw new Error(slice.error);
          name = slice.name;
          size = slice.size;
          if (slice.base64.length === 0) break;
          // Decoding through a data: URL keeps the byte-by-byte loop off the UI thread.
          const piece = await (await fetch(`data:application/octet-stream;base64,${slice.base64}`)).blob();
          parts.push(piece);
          offset += piece.size;
        }
        originalFile = new File(parts, name);
      } else originalFile = sourcePath;
      if (signal?.aborted) throw abortError();
      const target = libraries.find((library) => library.id === libraryId);
      const privateDocument = !isEnterprise || personal || target?.scope === 'personal';
      const doc = await ipcBridge.oneDevops.registerRagDocument.invoke({
        title,
        ...(target && (target.scope === 'personal') === privateDocument ? { libraryId: target.id } : {}),
        ...(privateDocument ? { scope: 'personal' as const } : {}),
        ...(originalFile?.type ? { mimeType: originalFile.type } : {}),
      });
      if (!doc?.id) {
        throw new Error('registerRagDocument returned no id');
      }
      if (originalFile) {
        try {
          const stored = await httpUploadMultipart<RagDocumentEntry>(
            `/api/one/devops/rag/documents/${doc.id}/source`,
            originalFile,
            'file',
            { timeoutMs: uploadTimeoutMs(originalFile.size), signal }
          );
          // Opening the document right after importing it should not download the same bytes back.
          if (stored?.filePath) cacheOriginal(originalCacheKey(doc.id, stored.filePath), originalFile);
        } catch (error) {
          // A document whose original never arrived is an empty shell in the library; do not leave it behind.
          await ipcBridge.oneDevops.deleteRagDocument.invoke({ id: doc.id }).catch((): void => {});
          throw error;
        }
      }
      if (content.trim()) {
        await ipcBridge.oneDevops.setRagContent.invoke({
          id: doc.id,
          content,
          expectedRevision: (await ipcBridge.oneDevops.getRagContentState.invoke({ id: doc.id })).revision,
        });
      }
    },
    [libraryId, libraries, isEnterprise]
  );

  const isCancelled = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError';

  /** Runs one file at a time so progress is real and Cancel takes effect between (and during) uploads. */
  const runImport = async (
    items: { name: string; run: (signal: AbortSignal) => Promise<{ sourceOnly: boolean }> }[]
  ): Promise<void> => {
    const controller = new AbortController();
    importAbort.current = controller;
    setImportingFiles(true);
    let succeeded = 0;
    let cancelled = false;
    const failures: string[] = [];
    const sourceOnly: string[] = [];
    try {
      for (const [index, item] of items.entries()) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        setImportProgress({ current: index + 1, total: items.length, name: item.name });
        try {
          const result = await item.run(controller.signal);
          if (result.sourceOnly) sourceOnly.push(item.name);
          succeeded += 1;
        } catch (error) {
          if (isCancelled(error) || controller.signal.aborted) {
            cancelled = true;
            break;
          }
          failures.push(`${item.name}: ${friendlyEnterpriseError(error, t)}`);
        }
      }
      if (succeeded > 0) {
        Message.success(
          t('common.superAssistant.rag.importFilesSucceeded', {
            defaultValue: '已导入 {{count}} 个文档',
            count: succeeded,
          })
        );
      }
      if (cancelled) Message.info(t('common.superAssistant.rag.importCancelled'));
      if (failures.length > 0) {
        Message.error(
          t('common.superAssistant.rag.importFilesFailed', {
            defaultValue: '{{count}} 个文档导入失败：{{reasons}}',
            count: failures.length,
            reasons: failures.join('; '),
          })
        );
      }
      if (sourceOnly.length) Message.info(`${t('common.knowledgeLibrary.importSourceOnly')} ${sourceOnly.join(', ')}`);
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.rag.importFailed', { defaultValue: '导入失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      importAbort.current = null;
      setImportProgress(null);
      setImportingFiles(false);
    }
  };

  const handleWebImport = async (files: File[]) => {
    const { extractLibraryText } = await import('../../knowledge/original/extractLibraryText');
    await runImport(
      files.map((file) => ({
        name: file.name,
        run: async (signal) => {
          if (file.size > 100 * 1024 * 1024) throw new Error(t('common.knowledgeLibrary.originalTooLarge'));
          let content: string | null = null;
          try {
            content = await extractLibraryText(file);
          } catch {
            /* Keep an unreadable original available. */
          }
          if (signal.aborted) throw abortError();
          const indexed = indexableText(content ?? '');
          await registerAndProcess(file.name, indexed, webImportPersonal.current, file, signal);
          return { sourceOnly: !indexed.trim() };
        },
      }))
    );
  };

  /** Import: pick one or more local files, extract text, register + auto-process each. */
  const handleImportFiles = async (personal = false) => {
    if (!isNativeDialogAvailable()) {
      webImportPersonal.current = personal;
      webImportInput.current?.click();
      return;
    }
    const filePaths = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Documents and media',
          extensions: [
            ...RAG_DOCUMENT_EXTENSIONS,
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'svg',
            'mp4',
            'webm',
            'mp3',
            'wav',
            'fig',
            'psd',
            'ai',
            'sketch',
          ],
        },
      ],
    });
    if (!filePaths?.length) {
      return;
    }
    await runImport(
      filePaths.map((filePath) => ({
        name: titleFromFileName(filePath.split(/[\\/]/).pop() ?? filePath),
        run: async (signal) => {
          // One file per call: a huge PDF no longer holds every other file's result (and the progress) hostage.
          // The job id lets Cancel stop the extraction itself, not just the wait for it.
          const jobId = crypto.randomUUID();
          const stopExtraction = (): void => {
            void ipcBridge.application.cancelRagExtraction.invoke({ jobId });
          };
          signal.addEventListener('abort', stopExtraction, { once: true });
          let result: Awaited<ReturnType<typeof ipcBridge.application.extractRagDocumentFiles.invoke>>[number];
          try {
            [result] = await raceAbort(
              ipcBridge.application.extractRagDocumentFiles.invoke({ filePaths: [filePath], jobId }),
              signal
            );
          } finally {
            signal.removeEventListener('abort', stopExtraction);
          }
          if (signal.aborted) throw abortError();
          if (result.fileSize > RAG_SOURCE_LIMIT_BYTES) throw new Error(t('common.knowledgeLibrary.originalTooLarge'));
          const indexed = 'error' in result ? '' : indexableText(result.text);
          await registerAndProcess(titleFromFileName(result.fileName), indexed, personal, result.filePath, signal);
          return { sourceOnly: !indexed.trim() };
        },
      }))
    );
  };

  const openUrlImport = (personal = false) => {
    setUrlPersonal(personal);
    urlForm.resetFields();
    setUrlModalVisible(true);
  };

  /** Import: fetch a URL (webpage or a directly-linked office/PDF file), extract text, register + auto-process. */
  const handleImportUrl = async () => {
    const values = (await urlForm.validate().catch((): null => null)) as { url: string } | null;
    if (!values) {
      return;
    }
    setImportingUrl(true);
    try {
      const extracted = await ipcBridge.application.extractRagDocumentUrl.invoke({ url: values.url });
      await registerAndProcess(extracted.suggestedTitle ?? values.url, extracted.text, urlPersonal);
      Message.success(t('common.superAssistant.registries.saved', { defaultValue: '已保存' }));
      setUrlModalVisible(false);
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.rag.importFailed', { defaultValue: '导入失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setImportingUrl(false);
    }
  };

  const openEdit = async (record: RagDocumentEntry, edit = false) => {
    const request = ++editRequest.current;
    setReading(Boolean(renderLibrary) && !edit);
    setEditTarget(record);
    setEditContent('');
    originalContent.current = '';
    setEditLoading(true);
    try {
      const state = await ipcBridge.oneDevops.getRagContentState.invoke({ id: record.id });
      const content = state.content;
      if (request !== editRequest.current) return;
      editRevision.current = state.revision;
      originalContent.current = content;
      setEditContent(content);
    } catch (error) {
      if (request !== editRequest.current) return;
      Message.error(
        t('common.superAssistant.registries.loadFailed', { defaultValue: '加载失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
      setEditTarget(null);
    } finally {
      if (request === editRequest.current) setEditLoading(false);
    }
  };

  /** Save the new text, then re-embed it so retrieval sees the edit. */
  const handleSaveEdit = async (automatic = false) => {
    if (!editTarget) {
      return;
    }
    setSavingEdit(true);
    try {
      if (editRevision.current === null) throw new Error('Document version has not loaded');
      editRevision.current = await ipcBridge.oneDevops.setRagContent.invoke({
        id: editTarget.id,
        content: editContent,
        expectedRevision: editRevision.current,
      });

      if (!automatic) Message.success(t('common.superAssistant.registries.saved'));
      originalContent.current = editContent;
      if (!automatic) {
        if (renderLibrary) setReading(true);
        else setEditTarget(null);
      }
      await refresh();
    } catch (error) {
      if (automatic) throw error;
      Message.error(
        t('common.superAssistant.registries.saveFailed', { defaultValue: '保存失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const handleProcess = async (id: string) => {
    setProcessingId(id);
    try {
      const res = await ipcBridge.oneDevops.processRagDocument.invoke({ id });
      Message.success(
        t('common.superAssistant.rag.processed', {
          defaultValue: '已处理，生成 {{count}} 个片段',
          count: res?.chunkCount ?? 0,
        })
      );
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.rag.processFailed', { defaultValue: '处理失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
      await refresh();
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await ipcBridge.oneDevops.deleteRagDocument.invoke({ id });
      Message.success(t('common.superAssistant.registries.deleted', { defaultValue: '已删除' }));
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.deleteFailed', { defaultValue: '删除失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      return;
    }
    setSearching(true);
    try {
      const result = await ipcBridge.oneDevops.searchRag.invoke({ query: searchQuery.trim(), topK: 5 });
      setHits(result ?? []);
    } catch (error) {
      Message.error(
        t('common.superAssistant.rag.searchFailed', { defaultValue: '检索失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setSearching(false);
    }
  };

  const columns = [
    {
      title: t('common.superAssistant.registries.colTitle', { defaultValue: '标题' }),
      render: (_: unknown, record: RagDocumentEntry) => (
        <span className='inline-flex items-center gap-6px'>
          {record.title}
          {isEnterprise && record.scope !== PERSONAL_SCOPE ? <CompanyBadge /> : null}
        </span>
      ),
    },
    {
      title: t('common.superAssistant.registries.colStatus', { defaultValue: '状态' }),
      render: (_: unknown, record: RagDocumentEntry) => (
        <Tag size='small' color={STATUS_COLORS[record.status] ?? 'gray'}>
          {record.status}
        </Tag>
      ),
    },
    {
      title: t('common.superAssistant.rag.chunks', { defaultValue: '片段' }),
      render: (_: unknown, record: RagDocumentEntry) => record.chunkCount,
    },
    {
      title: t('common.superAssistant.registries.colVisibility', { defaultValue: '可见范围' }),
      render: (_: unknown, record: RagDocumentEntry) =>
        record.scope === PERSONAL_SCOPE ? (
          <Tag size='small'>{t('common.superAssistant.rag.onlyMe')}</Tag>
        ) : (
          <ResourceAclCell
            scope={record.scope}
            teamId={record.teamId}
            visibility={record.visibility}
            tenants={tenants}
          />
        ),
    },
    {
      title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
      render: (_: unknown, record: RagDocumentEntry) =>
        canChange(record) ? (
          <div className='flex gap-6px'>
            <Button
              size='small'
              onClick={() => void openEdit(record, !usesOriginalFile(record.filePath, record.mimeType))}
            >
              {renderLibrary && usesOriginalFile(record.filePath, record.mimeType)
                ? t('common.knowledgeLibrary.read')
                : t('common.edit', { defaultValue: '编辑' })}
            </Button>
            {renderLibrary && (
              <Button
                size='small'
                onClick={() => {
                  setMetadataTarget(record);
                  setMetadataTitle(record.title);
                  setMetadataLibrary(record.libraryId ?? 'oraglib_default');
                }}
              >
                {t('common.knowledgeLibrary.organize')}
              </Button>
            )}
            <Button
              size='small'
              type='primary'
              loading={processingId === record.id}
              onClick={() => void handleProcess(record.id)}
            >
              {t('common.superAssistant.rag.process', { defaultValue: '处理' })}
            </Button>
            <Popconfirm
              title={t('common.superAssistant.registries.deleteConfirm', { defaultValue: '确认删除？' })}
              onOk={() => void handleDelete(record.id)}
            >
              <Button size='small' status='danger'>
                {t('common.delete', { defaultValue: '删除' })}
              </Button>
            </Popconfirm>
          </div>
        ) : (
          <span className='text-12px text-t-tertiary'>{t('common.superAssistant.rag.managedByCompany')}</span>
        ),
    },
  ];

  const configured = Boolean(config?.baseUrl && config?.model);

  const search = (
    <>
      {' '}
      <div className='mt-12px flex gap-6px'>
        <Input
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('common.superAssistant.rag.searchPlaceholderHybrid')}
          onPressEnter={() => void handleSearch()}
          disabled={!configured}
        />
        <Button type='primary' loading={searching} disabled={!configured} onClick={() => void handleSearch()}>
          {t('common.superAssistant.rag.search', { defaultValue: '检索' })}
        </Button>
      </div>
      {hits ? (
        <div className='mt-8px flex flex-col gap-6px'>
          {hits.length === 0 ? (
            <div className='text-12px text-t-tertiary'>
              {t('common.superAssistant.rag.noHits', { defaultValue: '没有匹配的片段' })}
            </div>
          ) : (
            hits.map((hit) => (
              <div key={`${hit.documentId}-${hit.chunkIndex}`} className='rounded-6px bg-fill-1 p-8px'>
                <div className='mb-2px flex items-center gap-6px text-11px text-t-tertiary'>
                  {/* Results are ORDERED by the fused (semantic + keyword) rank,
                      while this number is the semantic similarity alone. The two
                      legitimately disagree — a keyword-only match ranks high with
                      a modest similarity — so the badge is labelled rather than
                      shown bare, which would read as a sorting bug. */}
                  {!renderLibrary && (
                    <Tag size='small' color='arcoblue' title={t('common.superAssistant.rag.similarityTooltip')}>
                      {t('common.superAssistant.rag.similarityBadge', { value: hit.score.toFixed(3) })}
                    </Tag>
                  )}
                  {renderLibrary && rows.some((row) => row.id === hit.documentId) ? (
                    <button
                      type='button'
                      className='cursor-pointer border-0 bg-transparent p-0 text-left text-16px font-500 text-t-primary hover:underline'
                      onClick={() => {
                        const document = rows.find((row) => row.id === hit.documentId);
                        if (document) void openEdit(document);
                      }}
                    >
                      {hit.documentTitle}
                    </button>
                  ) : (
                    <span>{hit.documentTitle}</span>
                  )}
                </div>
                <div className={renderLibrary ? 'line-clamp-3 whitespace-pre-wrap text-14px' : 'text-12px'}>
                  {hit.content}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <input
        ref={webImportInput}
        data-testid='knowledge-file-import'
        type='file'
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void handleWebImport(files);
        }}
      />
      {attachDocs && <AddToConversationModal documents={attachDocs} onClose={() => setAttachDocs(null)} />}
      {renderLibrary ? (
        renderLibrary({
          isEnterprise,
          activeDocument: editTarget,
          documentView: docModalVisible ? (
            <LibraryDocument
              key='new-document'
              title={draftTitle}
              onTitleChange={setDraftTitle}
              content={draftContent}
              mimeType={documentKind === 'csv' ? 'text/csv' : 'text/markdown'}
              reading={false}
              canEdit
              saving={savingDoc}
              onReading={() => {}}
              onChange={setDraftContent}
              onBack={closeDocument}
              onSave={(automatic) => handleRegister(automatic)}
            />
          ) : editTarget ? (
            <LibraryDocument
              key={editTarget.id}
              onAddToConversation={() => setAttachDocs([editTarget])}
              registerBeforeLeave={(guard) => {
                documentLeaveGuard.current = guard;
              }}
              onOfficeSaved={async () => {
                const [content, documents] = await Promise.all([
                  ipcBridge.oneDevops.getRagContentState.invoke({ id: editTarget.id }),
                  ipcBridge.oneDevops.listRagDocuments.invoke(),
                ]);
                editRevision.current = content.revision;
                originalContent.current = content.content;
                setEditContent(content.content);
                setRows(documents ?? []);
                const metadata = documents?.find((item) => item.id === editTarget.id);
                if (metadata) setEditTarget(metadata);
              }}
              documentId={editTarget.id}
              sourcePath={editTarget.filePath}
              loadOriginal={async () =>
                (await httpDownloadBinary(`/api/one/devops/rag/documents/${editTarget.id}/source`)).blob
              }
              uploadOriginal={async (file) => {
                let content: string | null = null;
                try {
                  const { extractLibraryText } = await import('../../knowledge/original/extractLibraryText');
                  content = await extractLibraryText(file);
                } catch {
                  // Preserve the original even when its text cannot be extracted.
                }
                const metadata = await httpUploadMultipart<RagDocumentEntry>(
                  `/api/one/devops/rag/documents/${editTarget.id}/source`,
                  file,
                  'file',
                  { timeoutMs: uploadTimeoutMs(file.size) }
                );
                if (metadata.filePath) cacheOriginal(originalCacheKey(metadata.id, metadata.filePath), file);
                setEditTarget(metadata);
                editRevision.current = (
                  await ipcBridge.oneDevops.getRagContentState.invoke({ id: metadata.id })
                ).revision;
                let savedContent = '';
                if (content?.trim()) {
                  try {
                    editRevision.current = await ipcBridge.oneDevops.setRagContent.invoke({
                      id: metadata.id,
                      content,
                      expectedRevision: editRevision.current!,
                    });
                    savedContent = content;
                  } catch {
                    Message.error(t('common.knowledgeLibrary.saveFailed'));
                  }
                } else {
                  Message.info(`${t('common.knowledgeLibrary.importSourceOnly')} ${file.name}`);
                }
                originalContent.current = savedContent;
                setEditContent(savedContent);
                void refresh();
                return metadata;
              }}
              title={editTarget.title}
              location={
                libraries.find(
                  (item) =>
                    item.id === editTarget.libraryId &&
                    (item.scope === 'personal') === (editTarget.scope === 'personal')
                )?.name ?? (editTarget.scope === 'personal' ? t('common.knowledgeLibrary.personal') : undefined)
              }
              content={editContent}
              mimeType={editTarget.mimeType}
              reading={reading}
              canEdit={canChange(editTarget)}
              loading={editLoading}
              saving={savingEdit}
              onReading={setReading}
              onChange={setEditContent}
              onBack={closeDocument}
              onSave={(automatic) => handleSaveEdit(automatic)}
            />
          ) : undefined,
          libraries,
          libraryId,
          onLibraryChange: (id) =>
            navigateDocument(() => {
              setEditTarget(null);
              setLibraryId(id);
            }),
          onCreateFolder: (personal) => {
            setFolderScope(personal ? 'personal' : 'org');
            setLibraryName('');
            setLibraryModal(true);
          },
          onCreateLibrary:
            !memberMode && isEnterprise
              ? () => {
                  setFolderScope(null);
                  setLibraryName('');
                  setLibraryModal(true);
                }
              : undefined,
          rows,
          readOnlyLibrary:
            memberMode && Boolean(libraryId) && libraries.find((item) => item.id === libraryId)?.scope !== 'personal',
          loading,
          importing: importingFiles,
          importProgress,
          onCancelImport: cancelImport,
          onCreate: (kind, personal) => navigateDocument(() => openRegister(kind, personal)),
          onImport: (personal) => void handleImportFiles(personal),
          onLink: openUrlImport,
          onAddToConversation: setAttachDocs,
          onOpen: (record) =>
            navigateDocument(() => {
              void openEdit(record);
            }),
          settings: !memberMode ? (
            <Button size='small' onClick={openConfig}>
              {t('common.superAssistant.rag.configButton')}
            </Button>
          ) : null,
          search,
          columns,
        })
      ) : (
        <Card
          title={t('common.superAssistant.registries.ragTitle', { defaultValue: '知识库文档' })}
          extra={
            <div className='flex gap-6px'>
              {!memberMode && (
                <Button size='small' onClick={openConfig}>
                  {t('common.superAssistant.rag.configButton', { defaultValue: '嵌入配置' })}
                </Button>
              )}
              <Button size='small' loading={importingFiles} onClick={() => void handleImportFiles()}>
                {importProgress
                  ? t('common.superAssistant.rag.importProgress', {
                      current: importProgress.current,
                      total: importProgress.total,
                      name: importProgress.name,
                    })
                  : t('common.superAssistant.rag.importFilesButton', { defaultValue: '从文件导入' })}
              </Button>
              {importingFiles && (
                <Button size='small' status='danger' onClick={cancelImport}>
                  {t('common.cancel')}
                </Button>
              )}
              <Button size='small' onClick={() => openUrlImport()}>
                {t('common.superAssistant.rag.importUrlButton', { defaultValue: '从网页导入' })}
              </Button>
              <Button type='primary' size='small' onClick={() => openRegister()}>
                {t('common.superAssistant.registries.addRag', { defaultValue: '注册文档' })}
              </Button>
            </div>
          }
        >
          <div className='mb-8px flex flex-wrap items-center gap-8px text-12px'>
            <Tag size='small' color={configured ? 'green' : 'gray'}>
              {configured
                ? t('common.superAssistant.rag.endpointReady', {
                    defaultValue: '嵌入端点：{{model}}',
                    model: config?.model,
                  })
                : t('common.superAssistant.rag.endpointUnset', { defaultValue: '未配置嵌入端点' })}
            </Tag>
            {config?.dimensions ? (
              <span className='text-t-tertiary'>
                {t('common.superAssistant.rag.dims', { defaultValue: '维度 {{n}}', n: config.dimensions })}
              </span>
            ) : null}
            {/* Retrieval is hybrid now (dense + BM25, RRF-fused). Worth surfacing:
            it changes what a useful query looks like — exact identifiers work. */}
            <Tag size='small' color='arcoblue' bordered>
              {t('common.superAssistant.rag.hybridBadge')}
            </Tag>
          </div>

          {/* The headline change of this release: agents can search this knowledge
          base themselves during ordinary conversation, not only when a task is
          dispatched to a digital employee. Say so — nobody would guess. */}
          <div className='mb-12px rounded-4px px-10px py-8px text-12px' style={{ background: 'var(--color-fill-2)' }}>
            {t('common.superAssistant.rag.agentToolHint')}
          </div>

          <Table
            rowKey='id'
            loading={loading}
            columns={columns}
            data={rows}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
          />

          {search}
        </Card>
      )}

      <Modal
        title={t('common.knowledgeLibrary.organize')}
        visible={Boolean(metadataTarget)}
        confirmLoading={savingMetadata}
        onCancel={() => setMetadataTarget(null)}
        onOk={async () => {
          if (!metadataTarget || !metadataTitle.trim()) {
            Message.warning(t('common.required'));
            return;
          }
          setSavingMetadata(true);
          try {
            await ipcBridge.oneDevops.updateRagDocumentLocation.invoke({
              id: metadataTarget.id,
              title: metadataTitle.trim(),
              libraryId: metadataLibrary,
            });
            setMetadataTarget(null);
            await refresh();
          } catch (error) {
            Message.error(friendlyEnterpriseError(error, t));
          } finally {
            setSavingMetadata(false);
          }
        }}
      >
        <div className='mb-8px text-t-secondary'>{t('common.knowledgeLibrary.name')}</div>
        <Input value={metadataTitle} onChange={setMetadataTitle} />
        <div className='mb-8px mt-16px text-t-secondary'>{t('common.knowledgeLibrary.moveTo')}</div>
        <Select
          value={metadataLibrary}
          onChange={setMetadataLibrary}
          options={libraries
            .filter(
              (item) =>
                item.id === 'oraglib_default' ||
                (!isEnterprise || metadataTarget?.scope === 'personal'
                  ? item.scope === 'personal'
                  : item.scope !== 'personal')
            )
            .map((item) => ({
              value: item.id,
              label:
                item.id === 'oraglib_default' && metadataTarget?.scope === 'personal'
                  ? t('common.knowledgeLibrary.personal')
                  : item.name,
            }))}
        />
      </Modal>
      <Modal
        title={t(folderScope ? 'common.knowledgeLibrary.newFolder' : 'common.knowledgeLibrary.newSpace')}
        visible={libraryModal}
        confirmLoading={savingLibrary}
        onCancel={() => setLibraryModal(false)}
        onOk={async () => {
          if (!libraryName.trim()) {
            Message.warning(t('common.required'));
            return;
          }
          setSavingLibrary(true);
          try {
            const library = await ipcBridge.oneDevops.upsertRagLibrary.invoke({
              name: libraryName.trim(),
              ...(folderScope
                ? {
                    kind: 'folder' as const,
                    scope: folderScope,
                    ...(libraryId && (libraries.find((item) => item.id === libraryId)?.scope ?? 'org') === folderScope
                      ? { parentId: libraryId }
                      : {}),
                  }
                : {}),
            });
            setLibraryId(library.id);
            setLibraryModal(false);
            await refresh();
          } catch (error) {
            Message.error(friendlyEnterpriseError(error, t));
          } finally {
            setSavingLibrary(false);
          }
        }}
      >
        <Input value={libraryName} onChange={setLibraryName} placeholder={t('common.knowledgeLibrary.spaceName')} />
      </Modal>
      <Modal
        title={t('common.superAssistant.rag.configTitle', { defaultValue: '嵌入端点配置' })}
        visible={configModalVisible}
        onCancel={() => setConfigModalVisible(false)}
        onOk={() => void handleSaveConfig()}
        confirmLoading={savingConfig}
      >
        <div className='mb-8px text-12px text-t-tertiary'>
          {t('common.superAssistant.rag.configHint', {
            defaultValue: '任意 OpenAI 兼容的 /embeddings 端点（OpenAI / vLLM / Ollama / 智谱 等）。',
          })}
        </div>
        <Form form={configForm} layout='vertical'>
          <Form.Item
            field='baseUrl'
            label={t('common.superAssistant.rag.baseUrl', { defaultValue: 'Base URL' })}
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input placeholder='https://api.openai.com/v1' />
          </Form.Item>
          <Form.Item
            field='model'
            label={t('common.superAssistant.rag.model', { defaultValue: '模型' })}
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input placeholder='text-embedding-3-small' />
          </Form.Item>
          <Form.Item field='apiKey' label={t('common.superAssistant.rag.apiKey', { defaultValue: 'API Key' })}>
            <Input.Password
              placeholder={t('common.superAssistant.rag.apiKeyPlaceholder', { defaultValue: '留空保持不变' })}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          renderLibrary
            ? t('common.knowledgeLibrary.newDocument')
            : t('common.superAssistant.registries.addRag', { defaultValue: '注册文档' })
        }
        visible={!renderLibrary && docModalVisible}
        onCancel={() => setDocModalVisible(false)}
        onOk={() => void handleRegister()}
        confirmLoading={savingDoc}
      >
        <Form form={docForm} layout='vertical' initialValues={aclInitialValues(null)}>
          <Form.Item
            field='title'
            label={t('common.superAssistant.registries.colTitle', { defaultValue: '标题' })}
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            field='content'
            label={t('common.superAssistant.rag.content', { defaultValue: '内容（用于切分嵌入）' })}
          >
            {documentKind === 'csv' ? <CsvDocument value='' /> : <RichDocumentEditor value='' onChange={() => {}} />}
          </Form.Item>
          {!memberMode && !documentPersonal && <ResourceAclFields tenants={tenants} />}
        </Form>
      </Modal>

      <Modal
        title={
          renderLibrary && reading
            ? editTarget?.title
            : t('common.superAssistant.rag.editTitle', { title: editTarget?.title ?? '' })
        }
        visible={!renderLibrary && editTarget !== null}
        unmountOnExit
        className={renderLibrary ? libraryStyles.documentModal : undefined}
        wrapClassName={renderLibrary ? libraryStyles.documentWrap : undefined}
        alignCenter={renderLibrary ? false : undefined}
        onCancel={closeDocument}
        okText={t('common.save')}
        onOk={() => void handleSaveEdit()}
        confirmLoading={savingEdit}
        okButtonProps={{ disabled: reading || editLoading || !editTarget || !canChange(editTarget) }}
        footer={renderLibrary && reading ? <Button onClick={closeDocument}>{t('common.close')}</Button> : undefined}
      >
        {renderLibrary ? (
          <div className='mx-auto max-w-960px px-24px py-12px'>
            <div className='mb-12px text-12px text-t-tertiary'>
              {libraries.find((library) => library.id === editTarget?.libraryId)?.name ??
                t('common.knowledgeLibrary.personal')}
            </div>
            <h1 className='mb-24px text-28px font-600'>{editTarget?.title}</h1>
            <Tabs activeTab={reading ? 'read' : 'edit'} onChange={(key) => setReading(key === 'read')}>
              <Tabs.TabPane key='read' title={t('common.knowledgeLibrary.read')}>
                <article className='markdown-body min-h-400px break-words leading-1.9'>
                  {editLoading ? (
                    t('common.loading')
                  ) : editTarget?.mimeType === 'text/csv' || /\.csv$/i.test(editTarget?.title ?? '') ? (
                    <CsvDocument value={editContent} readOnly />
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{editContent}</ReactMarkdown>
                  )}
                </article>
              </Tabs.TabPane>
              {editTarget && canChange(editTarget) && (
                <Tabs.TabPane key='edit' title={t('common.edit')}>
                  {editTarget?.mimeType === 'text/csv' || /\.csv$/i.test(editTarget?.title ?? '') ? (
                    <CsvDocument value={editContent} onChange={setEditContent} />
                  ) : (
                    <Input.TextArea
                      rows={20}
                      value={editContent}
                      disabled={editLoading}
                      onChange={setEditContent}
                      data-testid='rag-edit-content'
                    />
                  )}
                </Tabs.TabPane>
              )}
            </Tabs>
          </div>
        ) : (
          <>
            {
              <Input.TextArea
                rows={10}
                value={editContent}
                disabled={editLoading}
                readOnly={Boolean(editTarget && !canChange(editTarget))}
                onChange={setEditContent}
                data-testid='rag-edit-content'
              />
            }
          </>
        )}
      </Modal>

      <Modal
        title={t('common.superAssistant.rag.importUrlTitle', { defaultValue: '从网页导入' })}
        visible={urlModalVisible}
        onCancel={() => setUrlModalVisible(false)}
        onOk={() => void handleImportUrl()}
        confirmLoading={importingUrl}
      >
        <div className='mb-8px text-12px text-t-tertiary'>
          {t('common.superAssistant.rag.importUrlHint', {
            defaultValue: '支持网页（自动转纯文本）以及直接指向 PDF / Word / PPT / Excel 等文件的链接。',
          })}
        </div>
        <Form form={urlForm} layout='vertical'>
          <Form.Item
            field='url'
            label='URL'
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input placeholder='https://…' />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        visible={discardConfirm}
        unmountOnExit
        title={t('common.knowledgeLibrary.unsavedTitle')}
        okText={t('common.knowledgeLibrary.discard')}
        cancelText={t('common.knowledgeLibrary.continueEditing')}
        onCancel={() => setDiscardConfirm(false)}
        onOk={() => {
          setDiscardConfirm(false);
          pendingNavigation.current();
        }}
      >
        {t('common.knowledgeLibrary.unsavedDescription')}
      </Modal>
    </>
  );
};

export default RagSection;
