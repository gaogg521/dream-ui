/**
 * Organizational hierarchy (P2-3): sub-team / department tree management
 * within a project group. Members are assigned to a department from the
 * Users tab; this tab manages the tree itself (create / rename / delete).
 *
 * Deletion is rejected (not cascaded) when a department still has
 * sub-departments or assigned members — the backend enforces this and
 * returns a clear error; the caller must reassign/move those first.
 *
 * T6 stage 3 adds mapping a company directory subtree in: `source ===
 * 'directory'` rows are tagged distinctly (their name gets overwritten on the
 * next sync, so it isn't quite the same thing as a department someone typed
 * in), and the "从通讯录映射" button re-runs the same mapping — safe to click
 * repeatedly, see `OrgService::map_directory_subtree`'s doc comment.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Message, Modal, Popconfirm, Select, Tag, Tree } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { Department, DirectoryDepartmentCandidate, DirectoryMapReport } from '@/common/types/org/orgTypes';

type TreeNode = {
  key: string;
  title: React.ReactNode;
  children?: TreeNode[];
};

/**
 * Assemble the flat department list into Arco `Tree`'s nested node shape. The
 * title embeds the rename/delete actions directly (rather than relying on
 * `Tree`'s `renderExtra` node-prop shape, which isn't reliably documented for
 * carrying the row's id) — unambiguous and simple to verify.
 */
const buildTree = (
  departments: Department[],
  renderActions: (dept: Department) => React.ReactNode,
  mappedTagLabel: string
): TreeNode[] => {
  const byParent = new Map<string, Department[]>();
  for (const d of departments) {
    const key = d.parentId ?? '';
    byParent.set(key, [...(byParent.get(key) ?? []), d]);
  }
  const build = (parentId: string): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((d) => ({
      key: d.id,
      title: (
        <div className='flex items-center justify-between gap-12px' style={{ minWidth: 240 }}>
          <span className='flex items-center gap-6px'>
            {d.name}
            {d.source === 'directory' && (
              <Tag size='small' color='arcoblue'>
                {mappedTagLabel}
              </Tag>
            )}
          </span>
          {renderActions(d)}
        </div>
      ),
      children: build(d.id),
    }));
  return build('');
};

const OrgTreeTab: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [creating, setCreating] = useState(false);

  const [renameTarget, setRenameTarget] = useState<Department | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // T6 stage 3: map a company directory subtree in.
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [candidates, setCandidates] = useState<DirectoryDepartmentCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [mapRootExternalId, setMapRootExternalId] = useState('');
  const [mapping, setMapping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcBridge.oneAdmin.listDepartments.invoke();
      setDepartments(data ?? []);
    } catch (e) {
      Message.error(t('common.orgTree.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await ipcBridge.oneAdmin.createDepartment.invoke({ name: newName.trim(), parentId: newParentId || null });
      Message.success(t('common.orgTree.created', { defaultValue: '已创建' }));
      setCreateModalVisible(false);
      setNewName('');
      setNewParentId('');
      await load();
    } catch (e) {
      Message.error(t('common.orgTree.createFailed', { defaultValue: '创建失败' }) + ': ' + String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setRenaming(true);
    try {
      await ipcBridge.oneAdmin.renameDepartment.invoke({ departmentId: renameTarget.id, name: renameValue.trim() });
      Message.success(t('common.orgTree.renamed', { defaultValue: '已重命名' }));
      setRenameTarget(null);
      await load();
    } catch (e) {
      Message.error(t('common.orgTree.renameFailed', { defaultValue: '重命名失败' }) + ': ' + String(e));
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (departmentId: string) => {
    try {
      await ipcBridge.oneAdmin.deleteDepartment.invoke({ departmentId });
      Message.success(t('common.orgTree.deleted', { defaultValue: '已删除' }));
      await load();
    } catch (e) {
      if (isBackendHttpError(e) && e.code === 'BAD_REQUEST') {
        Message.error(
          t('common.orgTree.deleteBlocked', {
            defaultValue: '该部门下还有子部门或成员，请先移动/重新分配后再删除。',
          })
        );
        return;
      }
      Message.error(t('common.orgTree.deleteFailed', { defaultValue: '删除失败' }) + ': ' + String(e));
    }
  };

  const openMapModal = async () => {
    setMapModalVisible(true);
    setMapRootExternalId('');
    setCandidatesLoading(true);
    try {
      setCandidates((await ipcBridge.oneAdmin.listDirectoryCandidates.invoke()) ?? []);
    } catch (e) {
      Message.error(t('common.orgTree.directoryLoadFailed', { defaultValue: '通讯录数据加载失败' }) + ': ' + String(e));
    } finally {
      setCandidatesLoading(false);
    }
  };

  const describeReport = (report: DirectoryMapReport): string => {
    const parts: string[] = [];
    if (report.created.length > 0) {
      parts.push(t('common.orgTree.mapCreated', { count: report.created.length, defaultValue: '新增 {{count}} 个' }));
    }
    if (report.updated.length > 0) {
      parts.push(t('common.orgTree.mapUpdated', { count: report.updated.length, defaultValue: '更新 {{count}} 个' }));
    }
    if (report.removed.length > 0) {
      parts.push(t('common.orgTree.mapRemoved', { count: report.removed.length, defaultValue: '移除 {{count}} 个' }));
    }
    if (parts.length === 0) {
      parts.push(t('common.orgTree.mapNoChange', { defaultValue: '无变化' }));
    }
    return parts.join('，');
  };

  const handleMap = async () => {
    if (!mapRootExternalId) return;
    setMapping(true);
    try {
      const report = await ipcBridge.oneAdmin.mapFromDirectory.invoke({ rootExternalId: mapRootExternalId });
      Message.success(describeReport(report));
      if (report.keptWithLocalData.length > 0) {
        Message.warning(
          t('common.orgTree.mapKept', {
            names: report.keptWithLocalData.join('、'),
            defaultValue: '以下部门在通讯录中已不存在，但因仍有本地成员/子部门未清理，保留未动：{{names}}',
          })
        );
      }
      setMapModalVisible(false);
      await load();
    } catch (e) {
      Message.error(t('common.orgTree.mapFailed', { defaultValue: '映射失败' }) + ': ' + String(e));
    } finally {
      setMapping(false);
    }
  };

  /** Indent picker options by directory depth so the hierarchy reads at a glance. */
  const candidateOptions = (() => {
    const byParent = new Map<string, DirectoryDepartmentCandidate[]>();
    for (const c of candidates) {
      const key = c.parentExternalId ?? '';
      byParent.set(key, [...(byParent.get(key) ?? []), c]);
    }
    const out: { label: string; value: string }[] = [];
    // Depth-capped: this is externally-sourced IdP data the frontend does not
    // control, so a malformed cyclic reference must not hang the render.
    const walk = (parentKey: string, depth: number) => {
      if (depth > 50) return;
      for (const c of byParent.get(parentKey) ?? []) {
        out.push({ label: `${'　'.repeat(depth)}${c.name}`, value: c.externalId });
        walk(c.externalId, depth + 1);
      }
    };
    walk('', 0);
    return out;
  })();

  const renderActions = (dept: Department) => (
    <div className='flex gap-6px'>
      <Button
        size='mini'
        onClick={() => {
          setRenameTarget(dept);
          setRenameValue(dept.name);
        }}
      >
        {t('common.rename', { defaultValue: '重命名' })}
      </Button>
      <Popconfirm
        title={t('common.orgTree.deleteConfirm', { defaultValue: '确认删除该部门？' })}
        onOk={() => void handleDelete(dept.id)}
      >
        <Button size='mini' status='danger'>
          {t('common.delete', { defaultValue: '删除' })}
        </Button>
      </Popconfirm>
    </div>
  );

  // Built after `renderActions` is initialized — the factory calls it
  // synchronously, so it must be in scope (no TDZ). `renderActions` closes over
  // the latest handlers/state, so `departments` is a sufficient dep.
  const tree = buildTree(departments, renderActions, t('common.orgTree.mappedTag', { defaultValue: '通讯录映射' }));

  return (
    <div>
      <div className='mb-12px flex items-center justify-between'>
        <div className='text-12px text-t-tertiary'>
          {t('common.orgTree.hint', {
            defaultValue: '管理本项目组内的子团队/部门结构；成员在"成员"页分配到具体部门。',
          })}
        </div>
        <div className='flex gap-8px'>
          <Button size='small' onClick={() => void openMapModal()}>
            {t('common.orgTree.mapButton', { defaultValue: '从通讯录映射' })}
          </Button>
          <Button type='primary' icon={<Plus />} size='small' onClick={() => setCreateModalVisible(true)}>
            {t('common.orgTree.addButton', { defaultValue: '新增部门' })}
          </Button>
        </div>
      </div>

      {!loading && tree.length === 0 && (
        <div className='text-12px text-t-tertiary py-24px text-center'>
          {t('common.orgTree.empty', { defaultValue: '还没有部门，点击右上角新增。' })}
        </div>
      )}

      {tree.length > 0 && <Tree treeData={tree} showLine blockNode />}

      <Modal
        title={t('common.orgTree.addButton', { defaultValue: '新增部门' })}
        visible={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        onOk={() => void handleCreate()}
        confirmLoading={creating}
      >
        <div className='mb-12px'>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.orgTree.name', { defaultValue: '部门名称' })}
          </div>
          <Input value={newName} onChange={setNewName} />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.orgTree.parent', { defaultValue: '上级部门（留空为顶级）' })}
          </div>
          <Select
            allowClear
            value={newParentId}
            onChange={(v) => setNewParentId(String(v ?? ''))}
            options={departments.map((d) => ({ label: d.name, value: d.id }))}
          />
        </div>
      </Modal>

      <Modal
        title={t('common.rename', { defaultValue: '重命名' })}
        visible={renameTarget != null}
        onCancel={() => setRenameTarget(null)}
        onOk={() => void handleRename()}
        confirmLoading={renaming}
      >
        <Input value={renameValue} onChange={setRenameValue} />
      </Modal>

      <Modal
        title={t('common.orgTree.mapButton', { defaultValue: '从通讯录映射' })}
        visible={mapModalVisible}
        onCancel={() => setMapModalVisible(false)}
        onOk={() => void handleMap()}
        confirmLoading={mapping}
        okButtonProps={{ disabled: !mapRootExternalId }}
      >
        <div className='flex flex-col gap-12px'>
          <Alert
            type='info'
            content={t('common.orgTree.mapHint', {
              defaultValue:
                '选择通讯录中的一个部门作为根节点，它和它下面的所有子部门会映射进本项目组的部门树。可重复执行——会更新已映射的部门、移除已从通讯录消失且本地已清空的部门，从不影响手工创建的部门。',
            })}
          />
          {candidates.length === 0 && !candidatesLoading && (
            <Alert
              type='warning'
              content={t('common.orgTree.mapEmpty', {
                defaultValue: '还没有通讯录数据可映射——请先在「通讯录」页完成一次同步。',
              })}
            />
          )}
          <Select
            loading={candidatesLoading}
            value={mapRootExternalId || undefined}
            placeholder={t('common.orgTree.mapRootPlaceholder', { defaultValue: '选择根部门' })}
            onChange={(v) => setMapRootExternalId(String(v ?? ''))}
            options={candidateOptions}
            disabled={candidates.length === 0}
          />
        </div>
      </Modal>
    </div>
  );
};

export default OrgTreeTab;
