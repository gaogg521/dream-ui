/**
 * Copyright 2026 One Work
 */

/**
 * Memory — what the assistants remember.
 *
 * Three places: the built-in assistant's own memory (shared across conversations), the instruction
 * files of the other coding agents that have been used on this computer (one page, pick an agent),
 * and the company's memory.
 */

import React, { useState } from 'react';
import { Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import AgentMemoryTab from './AgentMemoryTab';
import EngineMemoryTab from './EngineMemoryTab';
import EnterpriseMemoryTab from './EnterpriseMemoryTab';
import styles from './index.module.css';

const MemoryPage: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('engine');

  return (
    <div
      className={styles.page}
      style={{ padding: '20px 24px', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className={styles.pageTitle}>{t('memory.title')}</h2>
      </div>

      <Tabs activeTab={activeTab} onChange={setActiveTab} style={{ flex: 1 }} lazyload>
        <Tabs.TabPane key='engine' title={t('memory.tabEngine')}>
          <EngineMemoryTab />
        </Tabs.TabPane>

        <Tabs.TabPane key='agents' title={t('memory.tabAgents')}>
          <AgentMemoryTab />
        </Tabs.TabPane>

        <Tabs.TabPane key='enterprise' title={t('memory.tabEnterprise')}>
          <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-text-3)' }}>{t('memory.entHint')}</div>
          <EnterpriseMemoryTab />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default MemoryPage;
