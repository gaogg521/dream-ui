import React, { useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Input, Menu, Select, Table, Tabs } from '@arco-design/web-react';
import {
  Add,
  BookOpen,
  FileText,
  FolderOpen,
  FolderClose,
  History,
  LinkOne,
  Search,
  Upload,
  People,
  ArrowRight,
  More,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { RagLibraryProps } from '../superAssistant/registries/RagSection';
import type { RagDocumentEntry } from '@/common/types/devops/devopsTypes';
import styles from './KnowledgeLibrary.module.css';
import { useLibrarySidebar } from './useLibrarySidebar';

type View = 'recent' | 'search' | 'personal' | 'team';

const readVisits = (): Record<string, number> => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('knowledge-library-visits') ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    );
  } catch {
    return {};
  }
};

const KnowledgeLibrary: React.FC<RagLibraryProps> = ({
  isEnterprise = true,
  documentView,
  activeDocument,
  libraries,
  libraryId,
  onLibraryChange,
  onCreateLibrary,
  onCreateFolder,
  rows,
  readOnlyLibrary,
  loading,
  importing,
  onCreate,
  onImport,
  onLink,
  onOpen,
  settings,
  search,
  columns,
}) => {
  const { t, i18n } = useTranslation();
  const label = (key: string) => t(`common.knowledgeLibrary.${key}`);
  const sidebar = useLibrarySidebar(libraries.map((item) => item.name));
  const [view, setView] = useState<View>('recent');
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [guides, setGuides] = useState(true);
  const [visits, setVisits] = useState<Record<string, number>>(readVisits);
  useEffect(() => {
    try {
      localStorage.setItem('knowledge-library-visits', JSON.stringify(visits));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [visits]);
  const libraryPersonal = (id?: string) => libraries.find((item) => item.id === id)?.scope === 'personal';
  const personal = (row: RagDocumentEntry) => !isEnterprise || row.scope === 'personal';
  const open = (row: RagDocumentEntry) => {
    sidebar.navigate();
    setVisits((previous) => ({ ...previous, [row.id]: Date.now() }));
    onOpen(row);
  };
  const data = useMemo(
    () =>
      rows
        .filter((row) => {
          if (libraryId && (row.libraryId ?? 'oraglib_default') !== libraryId) return false;
          const scope =
            view === 'personal' || (view === 'recent' && tab === 'personal')
              ? personal(row)
              : view === 'team' || (view === 'recent' && tab === 'team')
                ? !personal(row)
                : true;
          return (
            scope &&
            row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
            (kind === 'all' || row.status === kind)
          );
        })
        .toSorted((a, b) => (visits[b.id] ?? b.createdAt) - (visits[a.id] ?? a.createdAt)),
    [rows, view, tab, query, kind, visits, isEnterprise, libraryId]
  );
  const menu = (
    <Menu
      onClickMenuItem={(key) => {
        if (key === 'create') onCreate('markdown', view === 'personal' || libraryPersonal(libraryId) || !isEnterprise);
        if (key === 'table') onCreate('csv', view === 'personal' || libraryPersonal(libraryId) || !isEnterprise);
        if (key === 'import') onImport(view === 'personal' || libraryPersonal(libraryId) || !isEnterprise);
        if (key === 'link') onLink(view === 'personal' || libraryPersonal(libraryId) || !isEnterprise);
      }}
    >
      <Menu.Item key='create' disabled={readOnlyLibrary}>
        <FileText /> {label('newDocument')}
      </Menu.Item>
      <Menu.Item key='table' disabled={readOnlyLibrary}>
        <FileText /> {label('newTable')}
      </Menu.Item>
      <Menu.Item
        key='folder'
        onClick={() => onCreateFolder(view === 'personal' || libraryPersonal(libraryId) || !isEnterprise)}
      >
        <FolderClose /> {label('newFolder')}
      </Menu.Item>
      <Menu.Item key='import' disabled={readOnlyLibrary}>
        <Upload /> {label('import')}
      </Menu.Item>
      <Menu.Item key='link' disabled={readOnlyLibrary}>
        <LinkOne /> {label('addLink')}
      </Menu.Item>
    </Menu>
  );
  const nav = (id: View, icon: React.ReactNode) => (
    <Button
      type='text'
      className={view === id ? styles.active : ''}
      icon={icon}
      onClick={() => {
        onLibraryChange(undefined);
        setView(id);
        setQuery('');
      }}
    >
      {label(id)}
    </Button>
  );
  const tree = (isPersonal: boolean) =>
    rows
      .filter((row) => personal(row) === isPersonal)
      .map((row) => (
        <Button
          key={row.id}
          aria-current={activeDocument?.id === row.id ? 'page' : undefined}
          type='text'
          icon={<FileText className={styles.fileIcon} />}
          onClick={() => open(row)}
          title={row.title}
        >
          {row.title}
        </Button>
      ));
  const pathIds = new Set<string>();
  let cursor = activeDocument?.libraryId ?? libraryId;
  while (cursor && !pathIds.has(cursor)) {
    pathIds.add(cursor);
    cursor = libraries.find((item) => item.id === cursor)?.parentId ?? undefined;
  }
  const folders = (parentId: string | null, personalScope: boolean, depth = 0): React.ReactNode =>
    depth > 16
      ? null
      : libraries
          .filter((item) => (item.parentId ?? null) === parentId && (item.scope === 'personal') === personalScope)
          .map((library) => (
            <React.Fragment key={library.id}>
              <Button
                type='text'
                className={libraryId === library.id ? styles.active : ''}
                icon={library.kind === 'folder' ? <FolderClose /> : <BookOpen />}
                onClick={() => {
                  sidebar.navigate();
                  onLibraryChange(library.id);
                  setView(personalScope ? 'personal' : 'team');
                }}
                title={library.name}
              >
                {library.name}
              </Button>
              {pathIds.has(library.id) && (
                <div className={styles.nested}>
                  {folders(library.id, personalScope, depth + 1)}
                  {rows
                    .filter(
                      (row) => (row.libraryId ?? 'oraglib_default') === library.id && personal(row) === personalScope
                    )
                    .map((row) => (
                      <Button
                        key={row.id}
                        aria-current={activeDocument?.id === row.id ? 'page' : undefined}
                        type='text'
                        icon={<FileText className={styles.fileIcon} />}
                        onClick={() => open(row)}
                        title={row.title}
                      >
                        {row.title}
                      </Button>
                    ))}
                </div>
              )}
            </React.Fragment>
          ));
  const tableColumns = [
    {
      title: label('name'),
      width: 240,
      render: (_: unknown, row: RagDocumentEntry) => (
        <Button
          type='text'
          className={styles.document}
          title={row.title}
          icon={<FileText className={styles.fileIcon} />}
          onClick={() => open(row)}
        >
          {row.title}
        </Button>
      ),
    },
    { title: label('owner'), dataIndex: 'createdBy', ellipsis: true, width: 110 },
    {
      title: label('location'),
      width: 100,
      ellipsis: true,
      render: (_: unknown, row: RagDocumentEntry) =>
        libraries.find((library) => library.id === row.libraryId)?.name ??
        (personal(row) ? label('personal') : label('team')),
    },
    {
      title: label('lastOpened'),
      width: 180,
      ellipsis: true,
      render: (_: unknown, row: RagDocumentEntry) =>
        visits[row.id] ? new Date(visits[row.id]).toLocaleString(i18n.language) : label('notOpened'),
    },
    {
      title: t('common.superAssistant.registries.colActions'),
      width: 65,
      fixed: 'right' as const,
      render: (_: unknown, row: RagDocumentEntry) => (
        <Dropdown
          trigger='click'
          position='br'
          droplist={<div className={styles.actions}>{columns?.at(-1)?.render?.(undefined, row, 0)}</div>}
        >
          <Button type='text' icon={<More />} aria-label={t('common.superAssistant.registries.colActions')} />
        </Dropdown>
      ),
    },
  ];
  return (
    <div className={styles.library} ref={sidebar.ref} {...sidebar.layout}>
      <aside className={styles.sidebar}>
        <Button className={styles.drawerClose} type='text' onClick={sidebar.toggle}>
          {label('collapseSidebar')}
        </Button>
        <h2>{label('title')}</h2>
        <nav>
          {nav('search', <Search />)}
          {nav('recent', <History />)}
        </nav>
        <div className={styles.sectionTitle}>
          <Button
            type='text'
            onClick={() => {
              onLibraryChange(undefined);
              setView('personal');
            }}
          >
            {label('personal')}
          </Button>
          <Dropdown
            droplist={menu}
            trigger='click'
            position='br'
            onVisibleChange={(visible) => {
              if (visible) {
                onLibraryChange(undefined);
                setView('personal');
              }
            }}
          >
            <Button type='text' icon={<Add />} aria-label={label('new')} loading={importing} />
          </Dropdown>
        </div>
        <div className={styles.tree}>
          {folders(null, true)}
          {rows
            .filter((row) => personal(row) && !libraryPersonal(row.libraryId))
            .map((row) => (
              <Button
                key={row.id}
                aria-current={activeDocument?.id === row.id ? 'page' : undefined}
                type='text'
                icon={<FileText className={styles.fileIcon} />}
                onClick={() => open(row)}
                title={row.title}
              >
                {row.title}
              </Button>
            ))}
        </div>
        <div className={styles.sectionTitle}>
          <Button
            type='text'
            onClick={() => {
              onLibraryChange(undefined);
              setView('team');
            }}
          >
            {label('team')}
          </Button>
          {onCreateLibrary ? (
            <Button
              type='text'
              icon={<Add />}
              aria-label={label('newSpace')}
              onClick={() => {
                setView('team');
                onCreateLibrary?.();
              }}
            />
          ) : (
            <People />
          )}
        </div>
        <div className={styles.tree}>
          {isEnterprise && folders(null, false)}
          {libraries.length === 0 && tree(false)}
        </div>
        <div className={styles.sidebarFooter}>
          <BookOpen />
          <span>{t('common.knowledgeLibrary.documentCount', { count: rows.length })}</span>
        </div>
      </aside>
      <div
        className={styles.resizeHandle}
        {...sidebar.separator}
        aria-label={label('resizeSidebar')}
        title={label('resizeSidebar')}
      />
      <main className={`${styles.main} ${documentView ? styles.documentMain : ''}`}>
        {documentView ? (
          <>
            <Button
              type='text'
              className={styles.documentSidebarToggle}
              onClick={sidebar.toggle}
              aria-label={label(sidebar.collapsed ? 'expandSidebar' : 'collapseSidebar')}
              aria-expanded={!sidebar.collapsed}
            >
              <BookOpen />
            </Button>
            {documentView}
          </>
        ) : (
          <>
            <Button
              type='text'
              className={styles.sidebarToggle}
              onClick={sidebar.toggle}
              aria-expanded={!sidebar.collapsed}
            >
              <BookOpen /> {label(sidebar.collapsed ? 'expandSidebar' : 'collapseSidebar')}
            </Button>
            <header className={styles.header}>
              <div>
                <BookOpen className={styles.headerIcon} />
                <h1>{libraries.find((library) => library.id === libraryId)?.name ?? label(view)}</h1>
              </div>
              <Dropdown droplist={menu} trigger='click'>
                <Button icon={<Add />} loading={importing}>
                  {label('new')}
                </Button>
              </Dropdown>
            </header>
            <div className={styles.toolbar}>
              {view === 'recent' ? (
                <Tabs activeTab={tab} onChange={setTab} type='rounded'>
                  <Tabs.TabPane key='all' title={label('recentVisits')} />
                  <Tabs.TabPane key='personal' title={label('personal')} />
                  <Tabs.TabPane key='team' title={label('team')} />
                </Tabs>
              ) : (
                <span className={styles.subtitle}>{label('browseHint')}</span>
              )}
              <Select
                value={kind}
                onChange={setKind}
                className={styles.filter}
                options={['all', 'ready', 'pending', 'error'].map((value) => ({ value, label: label(value) }))}
              />
            </div>
            <Input
              allowClear
              prefix={<Search />}
              value={query}
              onChange={setQuery}
              placeholder={label('filterPlaceholder')}
              className={styles.titleSearch}
            />
            {view === 'search' && <section className={styles.searchPanel}>{search}</section>}
            {libraryId && (
              <nav className={styles.breadcrumbs} aria-label={label('location')}>
                {[...pathIds].reverse().map((id) => (
                  <Button key={id} type='text' onClick={() => onLibraryChange(id)}>
                    {libraries.find((item) => item.id === id)?.name}
                  </Button>
                ))}
              </nav>
            )}
            <div className={styles.folderCards}>
              {libraries
                .filter((item) => item.parentId === libraryId && Boolean(libraryId))
                .map((item) => (
                  <Button key={item.id} type='text' title={item.name} onClick={() => onLibraryChange(item.id)}>
                    <FolderClose /> {item.name}
                  </Button>
                ))}
            </div>
            {(data.length > 0 ||
              loading ||
              query ||
              !libraries.some((item) => Boolean(libraryId) && item.parentId === libraryId)) && (
              <Table
                rowKey='id'
                loading={loading}
                columns={tableColumns}
                data={data}
                border={false}
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                scroll={{ x: 700 }}
                noDataElement={
                  <div className={styles.empty}>
                    <FolderOpen size={36} />
                    <p>{label('empty')}</p>
                    <Button
                      onClick={() => onImport(view === 'personal' || libraryPersonal(libraryId) || !isEnterprise)}
                      loading={importing}
                      disabled={readOnlyLibrary}
                    >
                      {label('import')}
                    </Button>
                  </div>
                }
              />
            )}
            {guides && (
              <section className={styles.guides}>
                <div className={styles.guideHeading}>
                  <span>
                    <BookOpen /> {label('learn')}
                  </span>
                  <Button type='text' onClick={() => setGuides(false)}>
                    {label('dismiss')}
                  </Button>
                </div>
                <div className={styles.featureCards}>
                  <Button
                    type='text'
                    onClick={() =>
                      onCreate('markdown', view === 'personal' || libraryPersonal(libraryId) || !isEnterprise)
                    }
                    disabled={readOnlyLibrary}
                  >
                    <div>
                      <h3>{label('startTitle')}</h3>
                      <p>{label('startDescription')}</p>
                    </div>
                    <FileText size={44} />
                  </Button>
                  <Button type='text' onClick={() => setView('search')}>
                    <div>
                      <h3>{label('searchTitle')}</h3>
                      <p>{label('searchDescription')}</p>
                    </div>
                    <Search size={44} />
                  </Button>
                </div>
                <div className={styles.guideHeading}>
                  <span>{label('possibilities')}</span>
                </div>
                <div className={styles.smallCards}>
                  {[
                    {
                      title: 'import',
                      description: 'importDescription',
                      icon: <Upload />,
                      action: () => onImport(view === 'personal' || libraryPersonal(libraryId) || !isEnterprise),
                    },
                    {
                      title: 'addLink',
                      description: 'linkDescription',
                      icon: <LinkOne />,
                      action: () => onLink(view === 'personal' || libraryPersonal(libraryId) || !isEnterprise),
                    },
                    { title: 'team', description: 'teamDescription', icon: <People />, action: () => setView('team') },
                  ].map((card) => (
                    <Button
                      key={card.title}
                      type='text'
                      onClick={card.action}
                      disabled={readOnlyLibrary && card.title !== 'team'}
                    >
                      <span className={styles.cardIcon}>{card.icon}</span>
                      <h3>{label(card.title)}</h3>
                      <p>{label(card.description)}</p>
                      <ArrowRight />
                    </Button>
                  ))}
                </div>
              </section>
            )}
            <footer className={styles.footer}>
              {settings}
              <span>{t('common.superAssistant.rag.agentToolHint')}</span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
};

export default KnowledgeLibrary;
