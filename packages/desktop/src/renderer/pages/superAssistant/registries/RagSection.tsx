/**
 * RAG management — embedding endpoint config, document registration with
 * inline content, chunk/embed processing, and semantic search, on top of the
 * one-devops rag endpoints. Embedding provider is any OpenAI-compatible
 * endpoint (D1 decision).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Message, Modal, Popconfirm, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import { RAG_DOCUMENT_EXTENSIONS } from '@/common/config/constants';
import type {
  RagConfig,
  RagDocumentEntry,
  RagSearchHit,
  ResourceScope,
  ResourceVisibility,
} from '@/common/types/devops/devopsTypes';
import { aclInitialValues, aclPayload, ResourceAclCell, ResourceAclFields, useAllTenants } from './ResourceAcl';

/** Strip the extension for a sensible default document title. */
const titleFromFileName = (fileName: string): string => fileName.replace(/\.[^./\\]+$/, '');

const STATUS_COLORS: Record<string, string> = {
  ready: 'green',
  pending: 'gray',
  error: 'red',
};

type RagSectionProps = { readOnly?: boolean };

const RagSection: React.FC<RagSectionProps> = ({ readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RagDocumentEntry[]>([]);
  const [config, setConfig] = useState<RagConfig | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { tenants } = useAllTenants();

  const [docModalVisible, setDocModalVisible] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [docForm] = Form.useForm();

  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configForm] = Form.useForm();

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<RagSearchHit[] | null>(null);

  const [importingFiles, setImportingFiles] = useState(false);
  const [urlModalVisible, setUrlModalVisible] = useState(false);
  const [importingUrl, setImportingUrl] = useState(false);
  const [urlForm] = Form.useForm();

  const refresh = useCallback(async () => {
    try {
      const [docs, cfg] = await Promise.all([
        ipcBridge.oneDevops.listRagDocuments.invoke(),
        ipcBridge.oneDevops.getRagConfig.invoke().catch((): null => null),
      ]);
      setRows(docs ?? []);
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

  const openRegister = () => {
    docForm.resetFields();
    setDocModalVisible(true);
  };

  const handleRegister = async () => {
    const values = (await docForm.validate().catch((): null => null)) as {
      title: string;
      content?: string;
      scope?: ResourceScope;
      teamId?: string | null;
      visibility?: ResourceVisibility;
    } | null;
    if (!values) {
      return;
    }
    setSavingDoc(true);
    try {
      const doc = await ipcBridge.oneDevops.registerRagDocument.invoke({ title: values.title, ...aclPayload(values) });
      if (doc?.id && values.content?.trim()) {
        await ipcBridge.oneDevops.setRagContent.invoke({ id: doc.id, content: values.content });
      }
      Message.success(t('common.superAssistant.registries.saved', { defaultValue: '已保存' }));
      setDocModalVisible(false);
      await refresh();
    } catch (error) {
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
   * Register one document with extracted content, then auto-process (chunk +
   * embed) it right away if the embedding endpoint is configured — importing
   * ten files shouldn't mean ten manual "处理" clicks afterward. Left as
   * 'pending' when unconfigured; the existing manual flow still applies.
   */
  const registerAndProcess = useCallback(
    async (title: string, content: string): Promise<void> => {
      const doc = await ipcBridge.oneDevops.registerRagDocument.invoke({ title });
      if (!doc?.id) {
        throw new Error('registerRagDocument returned no id');
      }
      if (content.trim()) {
        await ipcBridge.oneDevops.setRagContent.invoke({ id: doc.id, content });
      }
      if (config?.baseUrl && config?.model && content.trim()) {
        await ipcBridge.oneDevops.processRagDocument.invoke({ id: doc.id });
      }
    },
    [config]
  );

  /** Import: pick one or more local files, extract text, register + auto-process each. */
  const handleImportFiles = async () => {
    const filePaths = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: [...RAG_DOCUMENT_EXTENSIONS] }],
    });
    if (!filePaths?.length) {
      return;
    }
    setImportingFiles(true);
    try {
      const extracted = await ipcBridge.application.extractRagDocumentFiles.invoke({ filePaths });
      let succeeded = 0;
      const failures: string[] = [];
      for (const result of extracted) {
        if ('error' in result) {
          failures.push(`${result.fileName}: ${result.error}`);
          continue;
        }
        try {
          await registerAndProcess(titleFromFileName(result.fileName), result.text);
          succeeded += 1;
        } catch (error) {
          failures.push(`${result.fileName}: ${friendlyEnterpriseError(error, t)}`);
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
      if (failures.length > 0) {
        Message.error(
          t('common.superAssistant.rag.importFilesFailed', {
            defaultValue: '{{count}} 个文档导入失败：{{reasons}}',
            count: failures.length,
            reasons: failures.join('; '),
          })
        );
      }
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.rag.importFailed', { defaultValue: '导入失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setImportingFiles(false);
    }
  };

  const openUrlImport = () => {
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
      await registerAndProcess(extracted.suggestedTitle ?? values.url, extracted.text);
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
      render: (_: unknown, record: RagDocumentEntry) => record.title,
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
      render: (_: unknown, record: RagDocumentEntry) => (
        <ResourceAclCell scope={record.scope} teamId={record.teamId} visibility={record.visibility} tenants={tenants} />
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, record: RagDocumentEntry) => (
              <div className='flex gap-6px'>
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
            ),
          },
        ]),
  ];

  const configured = Boolean(config?.baseUrl && config?.model);

  return (
    <Card
      title={t('common.superAssistant.registries.ragTitle', { defaultValue: '知识库文档' })}
      extra={
        !readOnly && (
          <div className='flex gap-6px'>
            <Button size='small' onClick={openConfig}>
              {t('common.superAssistant.rag.configButton', { defaultValue: '嵌入配置' })}
            </Button>
            <Button size='small' loading={importingFiles} onClick={() => void handleImportFiles()}>
              {t('common.superAssistant.rag.importFilesButton', { defaultValue: '从文件导入' })}
            </Button>
            <Button size='small' onClick={openUrlImport}>
              {t('common.superAssistant.rag.importUrlButton', { defaultValue: '从网页导入' })}
            </Button>
            <Button type='primary' size='small' onClick={openRegister}>
              {t('common.superAssistant.registries.addRag', { defaultValue: '注册文档' })}
            </Button>
          </div>
        )
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
                  <Tag size='small' color='arcoblue' title={t('common.superAssistant.rag.similarityTooltip')}>
                    {t('common.superAssistant.rag.similarityBadge', { value: hit.score.toFixed(3) })}
                  </Tag>
                  <span>{hit.documentTitle}</span>
                </div>
                <div className='text-12px'>{hit.content}</div>
              </div>
            ))
          )}
        </div>
      ) : null}

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
        title={t('common.superAssistant.registries.addRag', { defaultValue: '注册文档' })}
        visible={docModalVisible}
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
            <Input.TextArea rows={6} />
          </Form.Item>
          <ResourceAclFields tenants={tenants} />
        </Form>
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
    </Card>
  );
};

export default RagSection;
