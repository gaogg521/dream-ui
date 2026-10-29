/**
 * Copyright 2026 One Work
 */

/**
 * Which project folder the agent memory pages are about.
 *
 * The project instruction file (CLAUDE.md, AGENTS.md, GEMINI.md) and Claude Code's per-project
 * auto memory both hang off one project root, so it is chosen once, here, for all of them.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Divider, Input, Message, Select, Space, Spin, Typography } from '@arco-design/web-react';
import { FileAddition } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { dialog, memory as memoryIpc, type MemoryScopeInfo } from '@/common/adapter/ipcBridge';
import styles from './index.module.css';

type Props = {
  /** Called after the project root or the extra roots changed, so the page can reload what depends on them. */
  onChanged: () => void;
  /** Whether the list of extra memory folders matters here (Claude Code's auto memory only). */
  showExtraRoots?: boolean;
};

const ProjectRootCard: React.FC<Props> = ({ onChanged, showExtraRoots = false }) => {
  const { t } = useTranslation();
  const [scope, setScope] = useState<MemoryScopeInfo | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadScope = useCallback(async () => {
    setLoading(true);
    try {
      const next = await memoryIpc.getScope.invoke();
      setScope(next);
      setPathInput(next.effectiveRoot);
    } catch {
      Message.error(t('memory.loadScopeFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadScope();
    void memoryIpc.suggestRoots
      .invoke()
      .then((roots) => setSuggestions(roots ?? []))
      .catch(() => setSuggestions([]));
  }, [loadScope]);

  const run = async (action: () => Promise<void>, doneKey: string) => {
    setSaving(true);
    try {
      await action();
      Message.success(t(doneKey));
      await loadScope();
      onChanged();
    } catch {
      Message.error(t('memory.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const applyRoot = (rootPath?: string) => {
    const trimmed = (rootPath ?? pathInput).trim();
    if (!trimmed) {
      Message.warning(t('memory.nameRequired'));
      return;
    }
    setPathInput(trimmed);
    void run(() => memoryIpc.setClaudeProjectRoot.invoke({ path: trimmed }), 'memory.scopeUpdated');
  };

  const setRoots = (rootPath: string | null, extraRoots: string[]) =>
    run(() => memoryIpc.setClaudeProjectRoots.invoke({ path: rootPath, extraRoots }), 'memory.scopeUpdated');

  const pick = async (properties: ('openFile' | 'openDirectory')[], onPicked: (picked: string) => void) => {
    try {
      const paths = await dialog.showOpen.invoke({ properties, defaultPath: pathInput || scope?.effectiveRoot });
      if (paths?.[0]) onPicked(paths[0]);
    } catch {
      Message.info(t('memory.pickFolderUnavailable'));
    }
  };

  if (loading && !scope) {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spin loading />
      </div>
    );
  }

  const baseRoot = scope?.configuredRoot ?? scope?.effectiveRoot ?? '';
  return (
    <Card
      style={{ marginBottom: 16 }}
      title={<span style={{ fontWeight: 600 }}>{t('memory.scopeTitle')}</span>}
      size='small'
    >
      <Space direction='vertical' size={10} style={{ width: '100%' }}>
        <Typography.Paragraph style={{ margin: 0, fontSize: 12, color: 'var(--color-text-2)' }}>
          {t('memory.scopeHint')}
        </Typography.Paragraph>

        <Space wrap size={8}>
          <Select
            className={styles.scopeSelect}
            placeholder={t('memory.suggested')}
            style={{ minWidth: 240, maxWidth: 420 }}
            allowClear
            options={suggestions.map((p) => ({ label: p, value: p }))}
            onChange={(value) => value && applyRoot(value)}
          />
          <Input
            style={{ width: 520, maxWidth: '100%' }}
            value={pathInput}
            onChange={setPathInput}
            placeholder={t('memory.pathPlaceholder')}
          />
          <Button
            size='small'
            icon={<FileAddition theme='outline' size={14} />}
            onClick={() => void pick(['openFile', 'openDirectory'], (picked) => applyRoot(picked))}
          >
            {t('memory.pickProject')}
          </Button>
          <Button type='primary' status='success' size='small' loading={saving} onClick={() => applyRoot()}>
            {t('memory.applyRoot')}
          </Button>
          {showExtraRoots && (
            <Button
              size='small'
              icon={<FileAddition theme='outline' size={14} />}
              onClick={() =>
                void pick(['openDirectory'], (picked) =>
                  setRoots(baseRoot, [...(scope?.additionalRoots ?? []), picked.trim()])
                )
              }
            >
              {t('memory.addAdditionalRoot')}
            </Button>
          )}
          {scope?.configuredRoot ? (
            <Button
              size='small'
              loading={saving}
              onClick={() =>
                void run(() => memoryIpc.setClaudeProjectRoot.invoke({ path: null }), 'memory.scopeCleared')
              }
            >
              {t('memory.clearOverride')}
            </Button>
          ) : null}
        </Space>

        <Divider style={{ margin: '6px 0' }} />

        <Space direction='vertical' size={4} style={{ fontSize: 12, color: 'var(--color-text-3)' }}>
          <div>
            <Typography.Text style={{ fontSize: 12 }}>{t('memory.effectiveRoot')}:</Typography.Text>{' '}
            <Typography.Text code style={{ fontSize: 11 }}>
              {scope?.effectiveRoot}
            </Typography.Text>
          </div>
          {showExtraRoots && (
            <div>
              <Typography.Text style={{ fontSize: 12 }}>{t('memory.memoryDir')}:</Typography.Text>{' '}
              <Typography.Text code style={{ fontSize: 11 }}>
                {scope?.absoluteMemoryDirs?.[0]}
              </Typography.Text>
            </div>
          )}
          {showExtraRoots && scope?.additionalRoots?.length ? (
            <div>
              <Typography.Text style={{ fontSize: 12 }}>{t('memory.additionalRootsTitle')}:</Typography.Text>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {scope.additionalRoots.map((root) => (
                  <div key={root} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Typography.Text code style={{ fontSize: 11, flex: 1 }}>
                      {root}
                    </Typography.Text>
                    <Button
                      size='mini'
                      status='danger'
                      onClick={() =>
                        void setRoots(
                          baseRoot,
                          (scope.additionalRoots ?? []).filter((r) => r !== root)
                        )
                      }
                    >
                      {t('memory.remove')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <Typography.Text style={{ fontSize: 12 }}>
              {scope?.configuredRoot ? t('memory.configuredOverride') : t('memory.usingWorkDir')}
            </Typography.Text>
            {scope?.configuredRoot ? (
              <>
                {' '}
                <Typography.Text code style={{ fontSize: 11 }}>
                  {scope.configuredRoot}
                </Typography.Text>
              </>
            ) : null}
          </div>
        </Space>
      </Space>
    </Card>
  );
};

export default ProjectRootCard;
