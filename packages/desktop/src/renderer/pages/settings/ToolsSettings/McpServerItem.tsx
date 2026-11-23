import { Button, Input, Message } from '@arco-design/web-react';
import { Down, Edit, Right } from '@icon-park/react';
import useSWR from 'swr';
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMcpSettingsScope, useMcpSettingsScope } from '@/renderer/hooks/mcp/useMcpServers';
import { setMcpServersEnabled } from '@/renderer/hooks/mcp/catalog';
import { isCompanyMcpServer } from '@/renderer/utils/enterprise/companyMcp';
import type { IMcpServer } from '@/common/config/storage';
import { WEB_SEARCH_MCP_NAME } from '@/common/webSearch/catalog';
import McpServerHeader from './McpServerHeader';
import McpServerToolsList from './McpServerToolsList';
import WebSearchProviderConfig from './WebSearchProviderConfig';
import type { McpOAuthStatus } from '@/renderer/hooks/mcp/useMcpOAuth';

const NOTE_LIMIT = 160;
const NOTES_KEY = 'mcp.notes';
const BUILTIN_PURPOSES = {
  'chrome-devtools': 'settings.mcpPurposeBrowser',
  'one-browser': 'settings.mcpPurposeBrowser',
  ftshare: 'settings.mcpPurposeMarket',
  'stock-sdk': 'settings.mcpPurposeMarket',
  'one-page-reader': 'settings.mcpPurposePage',
  'one-export-pdf': 'settings.mcpPurposePdf',
  'one-html-render': 'settings.mcpPurposeImage',
  'one-web-search': 'settings.mcpPurposeSearch',
  'one-team-knowledge': 'settings.mcpPurposeKnowledge',
} as const;

let noteWrites = Promise.resolve();

function saveMcpNote(id: string, text: string, scope: string): Promise<Record<string, string>> {
  const write = noteWrites.then(async () => {
    if (getMcpSettingsScope() !== scope) throw new Error('MCP_SCOPE_CHANGED');
    const notes = { ...(await getClientBusinessSetting(NOTES_KEY)), [id]: text };
    if (!text) delete notes[id];
    if (getMcpSettingsScope() !== scope) throw new Error('MCP_SCOPE_CHANGED');
    await setClientBusinessSetting(NOTES_KEY, notes);
    return notes;
  });
  noteWrites = write.then(
    () => {},
    () => {}
  );
  return write;
}

const GRID_GAP = 12;
const MIN_CARD_WIDTH = 280;
const cardStyle = {
  backgroundColor: 'color-mix(in srgb, var(--bg-2) 66%, var(--bg-3))',
  border: '1px solid color-mix(in srgb, var(--border-base) 64%, transparent)',
};

export function McpServerGrid({ children }: React.PropsWithChildren) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const width = grid.getBoundingClientRect().width;
      setColumns(Math.max(1, Math.min(3, Math.floor((width + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP)))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const items = React.Children.toArray(children);
  let row = 1;
  let detailRow = 2;
  const positionedItems = items.map((item, index) => {
    if (!React.isValidElement<McpServerItemProps>(item) || item.type !== McpServerItem) return item;
    const column = (index % columns) + 1;
    const positioned = React.cloneElement(item, {
      cardPosition: { gridRow: row, gridColumn: column },
      detailRow: item.props.isCollapsed ? detailRow++ : undefined,
    });
    if (column === columns) {
      row = detailRow;
      detailRow = row + 1;
    }
    return positioned;
  });
  return (
    <div
      ref={gridRef}
      className='grid items-start'
      data-testid='mcp-server-grid'
      style={{ gap: GRID_GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {positionedItems}
    </div>
  );
}

interface McpServerItemProps {
  cardPosition?: React.CSSProperties;
  detailRow?: number;
  server: IMcpServer;
  isCollapsed: boolean;
  isTestingConnection: boolean;
  oauthStatus?: McpOAuthStatus;
  isLoggingIn?: boolean;
  /** Extension-contributed servers are read-only (no edit/delete) */
  isReadOnly?: boolean;
  onToggleCollapse: () => void;
  onTestConnection: (server: IMcpServer) => void;
  onEditServer: (server: IMcpServer) => void;
  onDeleteServer: (serverId: string) => void;
  onOAuthLogin?: (server: IMcpServer) => void;
  /** Called after the built-in web-search entry saves its provider keys. */
  onServerUpdated?: (next: IMcpServer) => void;
}

const McpServerItem: React.FC<McpServerItemProps> = ({
  cardPosition,
  detailRow,
  server,
  isCollapsed,
  isTestingConnection,
  oauthStatus,
  isLoggingIn,
  isReadOnly,
  onToggleCollapse,
  onTestConnection,
  onEditServer,
  onDeleteServer,
  onOAuthLogin,
  onServerUpdated,
}) => {
  const detailsId = useId();
  const { t, i18n } = useTranslation();
  const [savingEnabled, setSavingEnabled] = useState(false);
  const savingRef = useRef(false);
  const scope = useMcpSettingsScope();
  const { data: notes, mutate: refreshNotes } = useSWR([NOTES_KEY, scope], () => getClientBusinessSetting(NOTES_KEY));
  const note = Object.hasOwn(notes ?? {}, server.id) ? notes?.[server.id] : undefined;
  const [draft, setDraft] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const savingNoteRef = useRef(false);
  const description = server.description?.trim().replace(/\s+/g, ' ');
  const language = (i18n.resolvedLanguage || i18n.language || 'zh-CN').split('-')[0];
  const hasHan = /\p{Script=Han}/u.test(description ?? '');
  const matchesLanguage = language === 'zh' ? hasHan : language === 'en' && !hasHan;
  const builtinPurpose =
    server.builtin && Object.hasOwn(BUILTIN_PURPOSES, server.name)
      ? BUILTIN_PURPOSES[server.name as keyof typeof BUILTIN_PURPOSES]
      : undefined;
  const toolNames = server.tools
    ?.slice(0, 3)
    .map(({ name }) => name)
    .join(', ');
  const summary = builtinPurpose
    ? t(builtinPurpose)
    : description && matchesLanguage && !/^Default MCP server:/i.test(description)
      ? (description.match(/^.*?[。！？]|^.*?[.!?](?=\s|$)/)?.[0] ?? description).slice(0, NOTE_LIMIT)
      : toolNames
        ? t('settings.mcpPurposeFromTools', { tools: toolNames })
        : t('settings.mcpNoDescription');
  const saveNote = async () => {
    if (draft === null || savingNoteRef.current) return;
    savingNoteRef.current = true;
    setSavingNote(true);
    try {
      const next = await saveMcpNote(server.id, draft.trim(), scope);
      await refreshNotes(next, { revalidate: false });
      setDraft(null);
    } catch {
      Message.error(t('common.saveFailed'));
    } finally {
      savingNoteRef.current = false;
      setSavingNote(false);
    }
  };
  const purpose = (
    <div className='flex items-center gap-4px min-w-0' onClick={(event) => event.stopPropagation()}>
      {draft === null ? (
        <>
          <span className='text-12px text-t-secondary truncate min-w-0 flex-1' title={note || summary}>
            {note || summary}
          </span>
          <Button
            size='mini'
            type='text'
            icon={<Edit size={14} />}
            aria-label={t('settings.mcpEditPurpose', { name: server.name })}
            title={t('settings.mcpEditPurpose', { name: server.name })}
            onClick={() => setDraft(note ?? '')}
          />
        </>
      ) : (
        <div className='w-full min-w-0' onKeyDown={(event) => event.stopPropagation()}>
          <Input
            autoFocus
            size='small'
            maxLength={NOTE_LIMIT}
            aria-label={t('settings.mcpEditPurpose', { name: server.name })}
            placeholder={summary}
            value={draft}
            disabled={savingNote}
            onChange={setDraft}
            onPressEnter={() => void saveNote()}
          />
          <div className='mt-4px flex justify-end gap-4px'>
            <Button size='mini' type='text' disabled={savingNote} onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button size='mini' type='primary' loading={savingNote} onClick={() => void saveNote()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
  const canToggle = !isReadOnly && !isCompanyMcpServer(server);

  const handleEnabledChange = async (enabled: boolean) => {
    if (!canToggle || savingRef.current) return;
    savingRef.current = true;
    setSavingEnabled(true);
    try {
      await setMcpServersEnabled([server.id], enabled);
    } catch {
      Message.error(t('common.saveFailed'));
    } finally {
      savingRef.current = false;
      setSavingEnabled(false);
    }
  };

  return (
    <>
      <div
        className='flex min-w-0 cursor-pointer items-center gap-4px rd-12px px-12px py-10px'
        style={{ ...cardStyle, ...cardPosition }}
        onClick={onToggleCollapse}
      >
        <Button
          size='mini'
          type='text'
          icon={isCollapsed ? <Down size={12} /> : <Right size={12} />}
          aria-label={server.name}
          aria-expanded={isCollapsed}
          aria-controls={isCollapsed ? detailsId : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse();
          }}
        />
        <div className='min-w-0 flex-1'>
          <McpServerHeader
            server={server}
            purpose={purpose}
            isTestingConnection={isTestingConnection}
            oauthStatus={oauthStatus}
            isLoggingIn={isLoggingIn}
            isReadOnly={isReadOnly}
            savingEnabled={savingEnabled}
            onEnabledChange={canToggle ? handleEnabledChange : undefined}
            onTestConnection={onTestConnection}
            onEditServer={onEditServer}
            onDeleteServer={onDeleteServer}
            onOAuthLogin={onOAuthLogin}
          />
        </div>
      </div>
      {isCollapsed && (
        <section
          id={detailsId}
          aria-label={server.name}
          className='col-span-full min-w-0 rd-12px px-16px py-12px'
          style={{ ...cardStyle, gridRow: detailRow }}
        >
          <div className='mb-8px font-medium text-t-primary'>{server.name}</div>
          {server.name === WEB_SEARCH_MCP_NAME && (
            <WebSearchProviderConfig server={server} onServerUpdated={onServerUpdated} />
          )}
          <McpServerToolsList server={server} />
        </section>
      )}
    </>
  );
};

export default McpServerItem;
