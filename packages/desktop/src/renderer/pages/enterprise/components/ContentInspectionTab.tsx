/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Company content inspection — rules on one side, what they caught on the other.
 *
 * The two halves are deliberately on the same screen. A rule is only worth
 * having if someone looks at its hits, and an admin who has to go find a second
 * page to do that will write rules and never review them.
 *
 * ⚠️ What an admin should understand from this screen, and what the copy says
 * out loud:
 *
 * - The check runs on each member's own machine, so a new rule takes a few
 *   minutes to reach everyone, and a hit takes a few minutes to appear here.
 * - Recorded excerpts are masked. The matched value itself is never stored —
 *   a table that collected every ID number in the company would be the most
 *   valuable target in the deployment.
 * - New rules record rather than block, because a rule that blocks before
 *   anyone has seen its real hit rate produces false positives, and people who
 *   hit false positives paste into a browser instead.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { DlpEventEntry, DlpRuleEntry } from '@/common/adapter/ipcBridge';
import type { EnterpriseTenant } from '@/common/types/org/orgTypes';

/** Must match `aionui_common::dlp::BUILTIN_PATTERN_IDS`. */
const BUILTIN_PATTERNS = ['cn_id_card', 'bank_card', 'cn_mobile', 'api_key', 'private_key'] as const;

type FormState = {
  id?: string;
  name: string;
  matcher: 'keyword' | 'regex' | 'builtin';
  pattern: string;
  action: 'log' | 'block';
  enabled: boolean;
  scope: string;
  teamId?: string;
};

const emptyForm = (): FormState => ({
  name: '',
  matcher: 'keyword',
  pattern: '',
  // Recording is the safe default — see the module docs.
  action: 'log',
  enabled: true,
  scope: 'org',
});

const formatTime = (ms: number): string => (ms ? new Date(ms).toLocaleString() : '—');

const ContentInspectionTab: React.FC<{ enterpriseId: string }> = ({ enterpriseId }) => {
  const { t } = useTranslation();
  const [rules, setRules] = useState<DlpRuleEntry[]>([]);
  const [events, setEvents] = useState<DlpEventEntry[]>([]);
  const [groups, setGroups] = useState<EnterpriseTenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ruleRows, eventRows] = await Promise.all([
        ipcBridge.oneDevops.listDlpRules.invoke(),
        ipcBridge.oneDevops.listDlpEvents.invoke({ limit: 200 }),
      ]);
      setRules(ruleRows ?? []);
      setEvents(eventRows ?? []);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    ipcBridge.oneOrg.listEnterpriseTenants
      .invoke({ enterpriseId })
      .then((rows) => setGroups(rows ?? []))
      .catch(() => setGroups([]));
  }, [load, enterpriseId]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.pattern.trim()) {
      Message.error(t('common.company.dlpNameAndPatternRequired'));
      return;
    }
    setSaving(true);
    try {
      await ipcBridge.oneDevops.upsertDlpRule.invoke({
        id: editing.id,
        name: editing.name.trim(),
        matcher: editing.matcher,
        pattern: editing.pattern.trim(),
        action: editing.action,
        enabled: editing.enabled,
        scope: editing.scope,
        teamId: editing.scope === 'team' ? editing.teamId : null,
      });
      Message.success(t('common.company.dlpRuleSaved'));
      setEditing(null);
      await load();
    } catch (error) {
      // The server refuses uncompilable patterns, and its message names the
      // reason (look-around especially). Show it verbatim rather than a
      // generic failure — the admin is the only one who can fix it.
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await ipcBridge.oneDevops.deleteDlpRule.invoke({ id });
      Message.success(t('common.company.dlpRuleDeleted'));
      await load();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const scopeLabel = (scope: string, teamId?: string | null): string =>
    scope === 'team'
      ? (groups.find((g) => g.tenantId === teamId)?.name ?? teamId ?? '—')
      : t('common.company.dlpScopeOrg');

  return (
    <div className='flex flex-col gap-12px'>
      <Alert type='info' content={t('common.company.dlpIntro')} />

      <Tabs defaultActiveTab='rules' type='line'>
        <Tabs.TabPane key='rules' title={t('common.company.dlpRulesTab')}>
          <div className='flex flex-col gap-12px pt-8px'>
            <div className='flex items-center justify-end'>
              <Button type='primary' size='small' onClick={() => setEditing(emptyForm())}>
                {t('common.company.dlpAddRule')}
              </Button>
            </div>
            <Table
              rowKey='id'
              loading={loading}
              data={rules}
              pagination={false}
              noDataElement={t('common.company.dlpNoRules')}
              columns={[
                { title: t('common.company.dlpRuleName'), dataIndex: 'name' },
                {
                  title: t('common.company.dlpMatcher'),
                  render: (_: unknown, row: DlpRuleEntry) => (
                    <Tag size='small'>{t(`common.company.dlpMatcher_${row.matcher}`)}</Tag>
                  ),
                },
                { title: t('common.company.dlpPattern'), dataIndex: 'pattern', ellipsis: true },
                {
                  title: t('common.company.dlpAction'),
                  render: (_: unknown, row: DlpRuleEntry) => (
                    <Tag color={row.action === 'block' ? 'red' : 'gray'} size='small'>
                      {row.action === 'block' ? t('common.company.dlpActionBlock') : t('common.company.dlpActionLog')}
                    </Tag>
                  ),
                },
                {
                  title: t('common.company.dlpScope'),
                  render: (_: unknown, row: DlpRuleEntry) => scopeLabel(row.scope, row.teamId),
                },
                {
                  title: t('common.company.dlpEnabled'),
                  render: (_: unknown, row: DlpRuleEntry) => (
                    <Tag color={row.enabled ? 'arcoblue' : 'gray'} size='small'>
                      {row.enabled ? t('common.company.dlpOn') : t('common.company.dlpOff')}
                    </Tag>
                  ),
                },
                {
                  title: t('common.company.dlpActions'),
                  render: (_: unknown, row: DlpRuleEntry) => (
                    <div className='flex items-center gap-8px'>
                      <Button
                        size='mini'
                        onClick={() =>
                          setEditing({
                            id: row.id,
                            name: row.name,
                            matcher: row.matcher,
                            pattern: row.pattern,
                            action: row.action,
                            enabled: row.enabled,
                            scope: row.scope,
                            teamId: row.teamId ?? undefined,
                          })
                        }
                      >
                        {t('common.company.dlpEdit')}
                      </Button>
                      <Popconfirm title={t('common.company.dlpDeleteConfirm')} onOk={() => remove(row.id)}>
                        <Button size='mini' status='danger'>
                          {t('common.company.dlpDelete')}
                        </Button>
                      </Popconfirm>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </Tabs.TabPane>

        <Tabs.TabPane key='events' title={`${t('common.company.dlpEventsTab')} (${events.length})`}>
          <div className='flex flex-col gap-12px pt-8px'>
            <span className='text-12px text-t-secondary'>{t('common.company.dlpEventsIntro')}</span>
            <Table
              rowKey='id'
              loading={loading}
              data={events}
              pagination={{ pageSize: 20, showTotal: true }}
              noDataElement={t('common.company.dlpNoEvents')}
              columns={[
                {
                  title: t('common.company.dlpEventTime'),
                  render: (_: unknown, row: DlpEventEntry) => formatTime(row.createdAt),
                },
                { title: t('common.company.dlpEventRule'), dataIndex: 'ruleName' },
                {
                  title: t('common.company.dlpAction'),
                  render: (_: unknown, row: DlpEventEntry) => (
                    <Tag color={row.action === 'block' ? 'red' : 'gray'} size='small'>
                      {row.action === 'block' ? t('common.company.dlpActionBlock') : t('common.company.dlpActionLog')}
                    </Tag>
                  ),
                },
                { title: t('common.company.dlpEventUser'), dataIndex: 'userId', ellipsis: true },
                { title: t('common.company.dlpEventHits'), dataIndex: 'hits' },
                { title: t('common.company.dlpEventExcerpt'), dataIndex: 'excerpt', ellipsis: true },
              ]}
            />
          </div>
        </Tabs.TabPane>
      </Tabs>

      <Modal
        visible={editing !== null}
        title={editing?.id ? t('common.company.dlpEditTitle') : t('common.company.dlpAddTitle')}
        onCancel={() => setEditing(null)}
        onOk={save}
        confirmLoading={saving}
        unmountOnExit
      >
        {editing && (
          <Form layout='vertical'>
            <Form.Item label={t('common.company.dlpRuleName')} required>
              <Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
            </Form.Item>
            <Form.Item label={t('common.company.dlpMatcher')}>
              <Select
                value={editing.matcher}
                onChange={(v: FormState['matcher']) => setEditing({ ...editing, matcher: v, pattern: '' })}
              >
                <Select.Option value='keyword'>{t('common.company.dlpMatcher_keyword')}</Select.Option>
                <Select.Option value='builtin'>{t('common.company.dlpMatcher_builtin')}</Select.Option>
                <Select.Option value='regex'>{t('common.company.dlpMatcher_regex')}</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              label={t('common.company.dlpPattern')}
              required
              extra={t(`common.company.dlpPatternTip_${editing.matcher}`)}
            >
              {editing.matcher === 'builtin' ? (
                <Select value={editing.pattern} onChange={(v) => setEditing({ ...editing, pattern: v })}>
                  {BUILTIN_PATTERNS.map((id) => (
                    <Select.Option key={id} value={id}>
                      {t(`common.company.dlpBuiltin_${id}`)}
                    </Select.Option>
                  ))}
                </Select>
              ) : (
                <Input value={editing.pattern} onChange={(v) => setEditing({ ...editing, pattern: v })} />
              )}
            </Form.Item>
            <Form.Item label={t('common.company.dlpAction')} extra={t('common.company.dlpActionTip')}>
              <Select
                value={editing.action}
                onChange={(v: FormState['action']) => setEditing({ ...editing, action: v })}
              >
                <Select.Option value='log'>{t('common.company.dlpActionLog')}</Select.Option>
                <Select.Option value='block'>{t('common.company.dlpActionBlock')}</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label={t('common.company.dlpScope')}>
              <Select value={editing.scope} onChange={(v) => setEditing({ ...editing, scope: v })}>
                <Select.Option value='org'>{t('common.company.dlpScopeOrg')}</Select.Option>
                <Select.Option value='team'>{t('common.company.dlpScopeTeam')}</Select.Option>
              </Select>
            </Form.Item>
            {editing.scope === 'team' && (
              <Form.Item label={t('common.company.dlpGroup')}>
                <Select value={editing.teamId} onChange={(v) => setEditing({ ...editing, teamId: v })}>
                  {groups.map((group) => (
                    <Select.Option key={group.tenantId} value={group.tenantId}>
                      {group.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}
            <Form.Item label={t('common.company.dlpEnabled')}>
              <Switch checked={editing.enabled} onChange={(v) => setEditing({ ...editing, enabled: v })} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default ContentInspectionTab;
