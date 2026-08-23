/**
 * Shared read-ACL controls for the distributed registries (skills / MCP / RAG),
 * P0-4 fine-grained RBAC. A resource is scoped to the whole enterprise (`org`)
 * or a single project group (`team` + `teamId`), and is readable by every
 * member in scope (`all`) or only admins (`admin`). The one-devops read
 * endpoints enforce this server-side; these controls just let an admin set it
 * and surface it in the list.
 */

import React, { useEffect, useState } from 'react';
import { Form, Select, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ResourceScope, ResourceVisibility } from '@/common/types/devops/devopsTypes';
import type { TenantSummary } from '@/common/types/org/orgTypes';

/** ACL fields shared by every registry row + upsert body. */
export type ResourceAclValues = {
  scope: ResourceScope;
  teamId: string | null;
  visibility: ResourceVisibility;
};

/**
 * Loose ACL source — a registry row (whose `scope`/`visibility` are plain
 * `string` off the wire) or raw form values. Normalized via {@link aclPayload}
 * / {@link aclInitialValues} into the strict {@link ResourceAclValues}.
 */
type AclSource = { scope?: string | null; teamId?: string | null; visibility?: string | null };

/**
 * Load every project group on this server for the scope picker. Admin-only
 * endpoint: in personal/standalone mode (or for a non-admin) it 403s, which we
 * swallow to an empty list so the picker simply offers no team option.
 */
export const useAllTenants = (): { tenants: TenantSummary[]; hasTenants: boolean } => {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  useEffect(() => {
    let alive = true;
    void ipcBridge.oneOrg.allTenants
      .invoke()
      .then((list) => {
        if (alive) {
          setTenants(list ?? []);
        }
      })
      .catch(() => {
        // 403 in personal mode / for non-admins — treated as "no groups".
      });
    return () => {
      alive = false;
    };
  }, []);
  return { tenants, hasTenants: tenants.length > 0 };
};

/** Initial ACL form values derived from an editing row (or the create default). */
export const aclInitialValues = (row: AclSource | null): ResourceAclValues => aclPayload(row ?? {});

/** Normalize a registry row or raw form values into the strict ACL payload. */
export const aclPayload = (values: AclSource): ResourceAclValues => {
  const scope: ResourceScope = values.scope === 'team' ? 'team' : 'org';
  return {
    scope,
    teamId: scope === 'team' ? (values.teamId ?? null) : null,
    visibility: values.visibility === 'admin' ? 'admin' : 'all',
  };
};

/**
 * Form fields (scope + conditional project group + visibility). Must be
 * rendered inside an Arco `<Form>` whose `initialValues` include
 * `aclInitialValues(...)`.
 */
export const ResourceAclFields: React.FC<{ tenants: TenantSummary[] }> = ({ tenants }) => {
  const { t } = useTranslation();
  const hasTenants = tenants.length > 0;
  return (
    <>
      <Form.Item
        field='scope'
        label={t('common.superAssistant.registries.aclScope', { defaultValue: '可见范围' })}
        extra={t('common.superAssistant.registries.aclScopeHint', {
          defaultValue: '“全企业”对所有成员可见；“指定项目组”仅该组成员可见。',
        })}
      >
        <Select>
          <Select.Option value='org'>
            {t('common.superAssistant.registries.scopeOrg', { defaultValue: '全企业' })}
          </Select.Option>
          <Select.Option value='team' disabled={!hasTenants}>
            {t('common.superAssistant.registries.scopeTeam', { defaultValue: '指定项目组' })}
          </Select.Option>
        </Select>
      </Form.Item>
      <Form.Item noStyle shouldUpdate>
        {(values) =>
          values.scope === 'team' ? (
            <Form.Item
              field='teamId'
              label={t('common.superAssistant.registries.aclTeam', { defaultValue: '项目组' })}
              rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
            >
              <Select
                placeholder={t('common.superAssistant.registries.aclTeamPlaceholder', { defaultValue: '选择项目组' })}
                showSearch
                filterOption={(input, option) => {
                  const label = String(
                    (option as React.ReactElement<{ children?: React.ReactNode }>).props?.children ?? ''
                  );
                  return label.toLowerCase().includes(input.toLowerCase());
                }}
              >
                {tenants.map((tenant) => (
                  <Select.Option key={tenant.tenantId} value={tenant.tenantId}>
                    {tenant.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : null
        }
      </Form.Item>
      <Form.Item
        field='visibility'
        label={t('common.superAssistant.registries.aclVisibility', { defaultValue: '可见性' })}
      >
        <Select>
          <Select.Option value='all'>
            {t('common.superAssistant.registries.visibilityAll', { defaultValue: '所有成员' })}
          </Select.Option>
          <Select.Option value='admin'>
            {t('common.superAssistant.registries.visibilityAdmin', { defaultValue: '仅管理员' })}
          </Select.Option>
        </Select>
      </Form.Item>
    </>
  );
};

/**
 * List-cell badges summarizing a resource's ACL. Org + all (the default) shows
 * a subtle "全企业" tag; team scope shows the group name; admin-only shows a
 * warning tag.
 */
export const ResourceAclCell: React.FC<{
  scope: string;
  teamId: string | null;
  visibility: string;
  tenants: TenantSummary[];
}> = ({ scope, teamId, visibility, tenants }) => {
  const { t } = useTranslation();
  const teamName = teamId ? (tenants.find((x) => x.tenantId === teamId)?.name ?? teamId) : null;
  return (
    <div className='flex flex-wrap items-center gap-4px'>
      {scope === 'team' ? (
        <Tag size='small' color='arcoblue'>
          {teamName}
        </Tag>
      ) : (
        <Tag size='small' color='gray'>
          {t('common.superAssistant.registries.scopeOrg', { defaultValue: '全企业' })}
        </Tag>
      )}
      {visibility === 'admin' ? (
        <Tag size='small' color='orange'>
          {t('common.superAssistant.registries.visibilityAdmin', { defaultValue: '仅管理员' })}
        </Tag>
      ) : null}
    </div>
  );
};
