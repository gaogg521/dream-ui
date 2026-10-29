/**
 * Copyright 2026 One Work
 */

/**
 * Memory of the other coding agents (Claude Code, Codex, Gemini CLI, OpenCode): pick one of the
 * agents that has been used on this computer, then edit and save the instruction files it reads.
 *
 * One page for all of them instead of a tab per agent: every agent has the same two files (a global
 * one and one per project), and Claude Code additionally has an auto-memory folder.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Message, Spin, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import {
  memory as memoryIpc,
  type AgentMemoryFile,
  type AgentMemoryInfo,
  type AgentMemoryKey,
  type AgentMemoryScope,
} from '@/common/adapter/ipcBridge';
import { AgentLogoIcon } from '@renderer/components/agent/AgentBadge';
import ClaudeAutoMemory from './ClaudeAutoMemory';
import ProjectRootCard from './ProjectRootCard';
import styles from './AgentMemoryTab.module.css';

type FileEditorProps = {
  agent: AgentMemoryInfo;
  scope: AgentMemoryScope;
  /** Changes when the project root does, so a project file is read again. */
  version: number;
};

const FileEditor: React.FC<FileEditorProps> = ({ agent, scope, version }) => {
  const { t } = useTranslation();
  const [file, setFile] = useState<AgentMemoryFile | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await memoryIpc.agentRead.invoke({ agent: agent.key, scope });
      setFile(next);
      setContent(next.content);
    } catch {
      Message.error(t('memory.readFailed'));
    } finally {
      setLoading(false);
    }
  }, [agent.key, scope, t]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const save = async () => {
    setSaving(true);
    try {
      await memoryIpc.agentWrite.invoke({ agent: agent.key, scope, content });
      Message.success(t('memory.agents.saved'));
      await load();
    } catch {
      Message.error(t('memory.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const hint = scope === 'global' ? 'memory.agents.globalHint' : 'memory.agents.projectHint';
  return (
    <div className={styles.editor}>
      <p className={styles.hint}>{t(hint, { agent: agent.label })}</p>
      {file && (
        <span className={styles.path} title={file.path}>
          {file.path}
          {!file.exists && ` · ${t('memory.agents.willCreate')}`}
        </span>
      )}
      {loading && !file ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin loading />
        </div>
      ) : (
        <Input.TextArea
          value={content}
          onChange={setContent}
          rows={16}
          style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
        />
      )}
      <div className={styles.buttons}>
        <Button
          type='primary'
          status='success'
          size='small'
          loading={saving}
          disabled={content === (file?.content ?? '')}
          onClick={() => void save()}
        >
          {t('memory.save')}
        </Button>
        <Button size='small' onClick={() => void memoryIpc.agentOpen.invoke({ agent: agent.key, scope })}>
          {t('memory.openInEditor')}
        </Button>
      </div>
    </div>
  );
};

const AgentMemoryTab: React.FC = () => {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentMemoryInfo[] | null>(null);
  const [selected, setSelected] = useState<AgentMemoryKey | null>(null);
  const [subTab, setSubTab] = useState('global');
  const [rootVersion, setRootVersion] = useState(0);

  useEffect(() => {
    void memoryIpc.agentList
      .invoke()
      .then((list) => {
        // Agents that have been used here come first; the rest stay reachable, since a file can be
        // written before the agent is first run.
        const ordered = list.toSorted((a, b) => Number(b.used) - Number(a.used));
        setAgents(ordered);
        setSelected((current) => current ?? ordered[0]?.key ?? null);
      })
      .catch(() => setAgents([]));
  }, []);

  if (agents === null) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin loading />
      </div>
    );
  }

  const current = agents.find((a) => a.key === selected) ?? null;
  const needsRoot = subTab === 'project' || subTab === 'auto';
  return (
    <div data-testid='agent-memory-tab' className={styles.root}>
      <p className={styles.lead}>{t('memory.agents.hint')}</p>

      <div className={styles.cards} role='tablist'>
        {agents.map((agent) => (
          <Button
            key={agent.key}
            type='text'
            role='tab'
            aria-selected={agent.key === selected}
            data-agent={agent.key}
            className={`${styles.card} ${agent.key === selected ? styles.cardActive : ''}`}
            onClick={() => {
              setSelected(agent.key);
              setSubTab('global');
            }}
          >
            <AgentLogoIcon backend={agent.key} agent_name={agent.label} />
            <span className={styles.cardName}>{agent.label}</span>
            <span className={agent.used ? styles.badgeUsed : styles.badgeUnused}>
              {agent.used ? t('memory.agents.used') : t('memory.agents.notUsed')}
            </span>
          </Button>
        ))}
      </div>

      {current && (
        <div className={styles.panel}>
          <Tabs activeTab={subTab} onChange={setSubTab} type='capsule' size='small' lazyload>
            <Tabs.TabPane key='global' title={t('memory.agents.global')} />
            <Tabs.TabPane key='project' title={t('memory.agents.project')} />
            {current.key === 'claude' && <Tabs.TabPane key='auto' title={t('memory.agents.auto')} />}
          </Tabs>

          {needsRoot && (
            <ProjectRootCard showExtraRoots={subTab === 'auto'} onChanged={() => setRootVersion((v) => v + 1)} />
          )}

          {subTab === 'global' && (
            <FileEditor key={`${current.key}-global`} agent={current} scope='global' version={0} />
          )}
          {subTab === 'project' && (
            <FileEditor key={`${current.key}-project`} agent={current} scope='project' version={rootVersion} />
          )}
          {subTab === 'auto' && current.key === 'claude' && <ClaudeAutoMemory version={rootVersion} />}
        </div>
      )}
    </div>
  );
};

export default AgentMemoryTab;
