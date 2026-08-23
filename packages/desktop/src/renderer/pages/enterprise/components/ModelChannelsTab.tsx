/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Company model channels — the admin half of "employees never hold an API key".
 *
 * An admin configures a chat / image / video channel once here. Members receive
 * it automatically as a read-only provider whose requests go through the
 * company's model proxy; the credential entered on this screen stays on the
 * server and is never sent to anyone's machine.
 *
 * ⚠️ The key is write-only in both directions. No endpoint returns it, so the
 * form cannot pre-fill it, and leaving the field blank on an edit means "keep
 * the stored one" — that is what lets an admin rename a channel or re-scope it
 * without having to dig the credential out again.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Message, Modal, Popconfirm, Select, Switch, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ModelChannelEntry } from '@/common/types/devops/devopsTypes';
import type { EnterpriseTenant } from '@/common/types/org/orgTypes';

type FormState = {
  id?: string;
  name: string;
  platform: string;
  upstreamBaseUrl: string;
  apiKey: string;
  models: string;
  enabled: boolean;
  scope: string;
  teamId?: string;
  visibility: string;
};

const emptyForm = (): FormState => ({
  name: '',
  platform: 'openai',
  upstreamBaseUrl: '',
  apiKey: '',
  models: '',
  enabled: true,
  scope: 'org',
  visibility: 'all',
});

/** Models are stored as a JSON array; admins type them one per line. */
const modelsToText = (json: string): string => {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.join('\n') : '';
  } catch {
    return '';
  }
};

const textToModels = (text: string): string =>
  JSON.stringify(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );

const ModelChannelsTab: React.FC<{ enterpriseId: string }> = ({ enterpriseId }) => {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<ModelChannelEntry[]>([]);
  const [groups, setGroups] = useState<EnterpriseTenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels((await ipcBridge.oneDevops.listModelChannels.invoke()) ?? []);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Project groups populate the scope selector. Failing to load them only
    // costs the per-group option, so it must not block the channel list.
    ipcBridge.oneOrg.listEnterpriseTenants
      .invoke({ enterpriseId })
      .then((rows) => setGroups(rows ?? []))
      .catch(() => setGroups([]));
  }, [load, enterpriseId]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.upstreamBaseUrl.trim()) {
      Message.error(t('common.company.channelNameAndUrlRequired'));
      return;
    }
    // Creating without a credential produces a channel that authenticates as
    // nobody and fails only when a member first uses it.
    if (!editing.id && !editing.apiKey.trim()) {
      Message.error(t('common.company.channelKeyRequiredOnCreate'));
      return;
    }
    setSaving(true);
    try {
      await ipcBridge.oneDevops.upsertModelChannel.invoke({
        id: editing.id,
        name: editing.name.trim(),
        platform: editing.platform,
        upstreamBaseUrl: editing.upstreamBaseUrl.trim(),
        // Absent means "keep what is stored"; sending an empty string would
        // read as "clear it".
        apiKey: editing.apiKey.trim() || undefined,
        models: textToModels(editing.models),
        enabled: editing.enabled,
        scope: editing.scope,
        teamId: editing.scope === 'team' ? editing.teamId : null,
        visibility: editing.visibility,
      });
      Message.success(t('common.company.channelSaved'));
      setEditing(null);
      await load();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await ipcBridge.oneDevops.deleteModelChannel.invoke({ id });
      Message.success(t('common.company.channelDeleted'));
      await load();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className='flex flex-col gap-12px'>
      <div className='flex items-center justify-between'>
        <span className='text-12px text-t-secondary'>{t('common.company.channelIntro')}</span>
        <Button type='primary' size='small' onClick={() => setEditing(emptyForm())}>
          {t('common.company.channelAdd')}
        </Button>
      </div>

      <Table
        rowKey='id'
        loading={loading}
        data={channels}
        pagination={false}
        columns={[
          { title: t('common.company.channelName'), dataIndex: 'name' },
          { title: t('common.company.channelUpstream'), dataIndex: 'upstreamBaseUrl', ellipsis: true },
          {
            title: t('common.company.channelKey'),
            render: (_: unknown, row: ModelChannelEntry) => (
              <Tag color={row.hasKey ? 'green' : 'red'} size='small'>
                {row.hasKey ? t('common.company.channelKeySet') : t('common.company.channelKeyMissing')}
              </Tag>
            ),
          },
          {
            title: t('common.company.channelScope'),
            render: (_: unknown, row: ModelChannelEntry) =>
              row.scope === 'team'
                ? (groups.find((g) => g.tenantId === row.teamId)?.name ?? row.teamId ?? '—')
                : t('common.company.channelScopeOrg'),
          },
          {
            title: t('common.company.channelEnabled'),
            render: (_: unknown, row: ModelChannelEntry) => (
              <Tag color={row.enabled ? 'arcoblue' : 'gray'} size='small'>
                {row.enabled ? t('common.company.channelOn') : t('common.company.channelOff')}
              </Tag>
            ),
          },
          {
            title: t('common.company.channelActions'),
            render: (_: unknown, row: ModelChannelEntry) => (
              <div className='flex items-center gap-8px'>
                <Button
                  size='mini'
                  onClick={() =>
                    setEditing({
                      id: row.id,
                      name: row.name,
                      platform: row.platform,
                      upstreamBaseUrl: row.upstreamBaseUrl,
                      // Never pre-filled: the server does not return it.
                      apiKey: '',
                      models: modelsToText(row.models),
                      enabled: row.enabled,
                      scope: row.scope,
                      teamId: row.teamId ?? undefined,
                      visibility: row.visibility,
                    })
                  }
                >
                  {t('common.company.channelEdit')}
                </Button>
                <Popconfirm title={t('common.company.channelDeleteConfirm')} onOk={() => remove(row.id)}>
                  <Button size='mini' status='danger'>
                    {t('common.company.channelDelete')}
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]}
      />

      <Modal
        visible={editing !== null}
        title={editing?.id ? t('common.company.channelEditTitle') : t('common.company.channelAddTitle')}
        onCancel={() => setEditing(null)}
        onOk={save}
        confirmLoading={saving}
        unmountOnExit
      >
        {editing && (
          <Form layout='vertical'>
            <Form.Item label={t('common.company.channelName')} required>
              <Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
            </Form.Item>
            <Form.Item
              label={t('common.company.channelUpstream')}
              required
              extra={t('common.company.channelUpstreamTip')}
            >
              <Input
                value={editing.upstreamBaseUrl}
                placeholder='https://api.openai.com'
                onChange={(v) => setEditing({ ...editing, upstreamBaseUrl: v })}
              />
            </Form.Item>
            <Form.Item label={t('common.company.channelKey')} extra={t('common.company.channelKeyTip')}>
              <Input.Password
                value={editing.apiKey}
                placeholder={editing.id ? t('common.company.channelKeyKeep') : ''}
                onChange={(v) => setEditing({ ...editing, apiKey: v })}
              />
            </Form.Item>
            <Form.Item label={t('common.company.channelModels')} extra={t('common.company.channelModelsTip')}>
              <Input.TextArea value={editing.models} rows={4} onChange={(v) => setEditing({ ...editing, models: v })} />
            </Form.Item>
            <Form.Item label={t('common.company.channelScope')}>
              <Select value={editing.scope} onChange={(v) => setEditing({ ...editing, scope: v })}>
                <Select.Option value='org'>{t('common.company.channelScopeOrg')}</Select.Option>
                <Select.Option value='team'>{t('common.company.channelScopeTeam')}</Select.Option>
              </Select>
            </Form.Item>
            {editing.scope === 'team' && (
              <Form.Item label={t('common.company.channelGroup')}>
                <Select value={editing.teamId} onChange={(v) => setEditing({ ...editing, teamId: v })}>
                  {groups.map((group) => (
                    <Select.Option key={group.tenantId} value={group.tenantId}>
                      {group.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}
            <Form.Item label={t('common.company.channelEnabled')}>
              <Switch checked={editing.enabled} onChange={(v) => setEditing({ ...editing, enabled: v })} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default ModelChannelsTab;
