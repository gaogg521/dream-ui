/**
 * Enterprise memory tab — the member-facing surface of the /api/one/memory
 * subsystem: recall opt-out, collection browsing, item deletion, search.
 *
 * Deliberately separate from the other three tabs of this page: those manage
 * the local Claude-Code file memory (~/.claude/...), this one talks to the
 * co-located dreamcore's enterprise memory subsystem, which only answers for
 * members of an enterprise — everyone else gets the NOT_IN_ENTERPRISE empty
 * state instead of an error.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Message, Spin, Switch, Table, Tag, Typography } from '@arco-design/web-react';
import { Delete, Refresh, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';

type Prefs = { recallEnabled: boolean };
type Collection = { id: string; scope: string; name: string; description?: string };
type Item = {
  id: string;
  collectionId: string;
  content: string;
  status: string;
  authorUserId?: string;
  createdAt: number;
};

const SCOPE_T_KEY: Record<string, string> = {
  global: 'memory.entScopeGlobal',
  department: 'memory.entScopeDepartment',
  personal: 'memory.entScopePersonal',
};

const isInEnterpriseError = (error: unknown): boolean =>
  isBackendHttpError(error) &&
  typeof error.body === 'object' &&
  error.body !== null &&
  (error.body as { code?: string }).code === 'NOT_IN_ENTERPRISE';

const EnterpriseMemoryTab: React.FC = () => {
  const { t } = useTranslation();
  const [unavailable, setUnavailable] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [recallEnabled, setRecallEnabled] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string>('');
  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<Item[] | null>(null);
  const [searching, setSearching] = useState(false);

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true);
    try {
      const prefs = await httpRequest<Prefs>('GET', '/api/one/memory/preferences');
      setRecallEnabled(prefs.recallEnabled);
    } catch (error) {
      if (isInEnterpriseError(error)) {
        setUnavailable(true);
        return;
      }
      Message.error(t('memory.entLoadFailed'));
    } finally {
      setPrefsLoading(false);
    }
  }, [t]);

  const loadCollections = useCallback(async () => {
    try {
      const list = (await httpRequest<Collection[]>('GET', '/api/one/memory/collections')) ?? [];
      setCollections(list);
      setActiveCollection((current) => (current && list.some((c) => c.id === current) ? current : (list[0]?.id ?? '')));
    } catch (error) {
      if (isInEnterpriseError(error)) {
        setUnavailable(true);
        return;
      }
      Message.error(t('memory.entLoadFailed'));
    }
  }, [t]);

  const loadItems = useCallback(
    async (collectionId: string) => {
      if (!collectionId) return;
      setItemsLoading(true);
      try {
        setItems(
          (await httpRequest<Item[]>(
            'GET',
            `/api/one/memory/collections/${encodeURIComponent(collectionId)}/items?limit=200`
          )) ?? []
        );
      } catch {
        Message.error(t('memory.entLoadFailed'));
      } finally {
        setItemsLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    void loadPrefs();
    void loadCollections();
  }, [loadPrefs, loadCollections]);

  useEffect(() => {
    if (activeCollection) void loadItems(activeCollection);
  }, [activeCollection, loadItems]);

  const handleToggleRecall = async (next: boolean) => {
    setPrefsSaving(true);
    try {
      const prefs = await httpRequest<Prefs>('PUT', '/api/one/memory/preferences', { recallEnabled: next });
      setRecallEnabled(prefs.recallEnabled);
    } catch {
      Message.error(t('memory.entSaveFailed'));
    } finally {
      setPrefsSaving(false);
    }
  };

  const handleDelete = async (item: Item) => {
    try {
      await httpRequest<undefined>('DELETE', `/api/one/memory/collections/${encodeURIComponent(item.collectionId)}/items/${encodeURIComponent(item.id)}`);
      setItems((current) => current.filter((i) => i.id !== item.id));
      setSearchResults((current) => current?.filter((i) => i.id !== item.id) ?? null);
      Message.success(t('memory.entDeleted'));
    } catch {
      Message.error(t('memory.entDeleteFailed'));
    }
  };

  const handleSearch = async () => {
    const query = searchText.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(
        (await httpRequest<Item[]>(
          'GET',
          `/api/one/memory/search?query=${encodeURIComponent(query)}&limit=50`
        )) ?? []
      );
    } catch {
      Message.error(t('memory.entLoadFailed'));
    } finally {
      setSearching(false);
    }
  };

  if (unavailable) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--color-text-4)', padding: '48px 0' }}>
        {t('memory.entNotInEnterprise')}
      </div>
    );
  }

  const scopeTag = (scope: string) => {
    const key = SCOPE_T_KEY[scope];
    return <Tag color={scope === 'personal' ? 'green' : scope === 'department' ? 'arcoblue' : 'orange'}>{key ? t(key) : scope}</Tag>;
  };

  const itemColumns = [
    {
      title: t('memory.entColContent'),
      dataIndex: 'content',
      ellipsis: true,
    },
    {
      title: t('memory.entColScope'),
      width: 110,
      render: (_: unknown, item: Item) => {
        const collection = collections.find((c) => c.id === item.collectionId);
        return collection ? scopeTag(collection.scope) : item.collectionId.slice(0, 8);
      },
    },
    {
      title: t('memory.colUpdated'),
      width: 160,
      render: (_: unknown, item: Item) => new Date(item.createdAt).toLocaleString(),
    },
    {
      title: t('memory.colActions'),
      width: 80,
      render: (_: unknown, item: Item) => (
        <Button
          size='mini'
          status='danger'
          icon={<Delete theme='outline' size={13} />}
          onClick={() => void handleDelete(item)}
        >
          {t('memory.remove')}
        </Button>
      ),
    },
  ];

  const showingSearch = searchResults !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Typography.Text style={{ fontSize: 12 }}>{t('memory.entRecallLabel')}</Typography.Text>
        {prefsLoading ? (
          <Spin size={14} />
        ) : (
          <Switch size='small' checked={recallEnabled} loading={prefsSaving} onChange={(v) => void handleToggleRecall(v)} />
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>{t('memory.entHint')}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Typography.Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{t('memory.entCollectionsLabel')}:</Typography.Text>
        {collections.length === 0 ? (
          <Typography.Text style={{ fontSize: 12, color: 'var(--color-text-4)' }}>{t('memory.entEmpty')}</Typography.Text>
        ) : (
          collections.map((c) => (
            <Button
              key={c.id}
              size='mini'
              type={c.id === activeCollection ? 'primary' : 'default'}
              onClick={() => {
                setSearchResults(null);
                setSearchText('');
                setActiveCollection(c.id);
              }}
            >
              {c.name}
            </Button>
          ))
        )}
        <Button
          size='mini'
          icon={<Refresh theme='outline' />}
          onClick={() => {
            void loadPrefs();
            void loadCollections();
            if (activeCollection) void loadItems(activeCollection);
          }}
        >
          {t('memory.refresh')}
        </Button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          size='small'
          allowClear
          style={{ maxWidth: 320 }}
          placeholder={t('memory.entSearchPlaceholder')}
          value={searchText}
          onChange={setSearchText}
          onPressEnter={() => void handleSearch()}
        />
        <Button
          size='small'
          type='primary'
          icon={<Search theme='outline' />}
          loading={searching}
          onClick={() => void handleSearch()}
        >
          {t('memory.entSearch')}
        </Button>
        {showingSearch && (
          <Button size='small' onClick={() => setSearchResults(null)}>
            {t('memory.entBackToList')}
          </Button>
        )}
      </div>

      {itemsLoading || searching ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin loading />
        </div>
      ) : (
        <Table
          columns={itemColumns}
          data={items}
          rowKey='id'
          size='small'
          pagination={{ pageSize: 10 }}
          noDataElement={
            <div style={{ textAlign: 'center', color: 'var(--color-text-3)', padding: '40px 0' }}>
              {t('memory.entEmpty')}
            </div>
          }
        />
      )}
    </div>
  );
};

export default EnterpriseMemoryTab;
