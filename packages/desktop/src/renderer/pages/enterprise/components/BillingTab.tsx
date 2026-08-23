/**
 * Billing tab: license activation + subscription tier + seat usage +
 * entitlements, plus the usage dashboard (turns / tokens / estimated cost, by
 * user / model / day).
 *
 * Authorization model: a vendor-signed license key is the ONLY way to raise a
 * tier. `setTier` is downgrade-only server-side, so the tier picker below only
 * offers tiers at or below the current one — offering a higher one would just
 * produce an `UPGRADE_REQUIRES_LICENSE` error and read as a bug.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Message, Progress, Select, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  BillingLicense,
  BillingPlan,
  BillingTier,
  DepartmentBudget,
  UsageBucket,
  UsageSummary,
} from '@/common/types/billing/billingTypes';
import type { Department } from '@/common/types/org/orgTypes';

const TIERS: BillingTier[] = ['free', 'team', 'enterprise'];

const TIER_COLOR: Record<string, string> = { free: 'gray', team: 'arcoblue', enterprise: 'gold' };

/** Ordering for "downgrade only": a tier may only be set to its own rank or lower. */
const TIER_RANK: Record<string, number> = { free: 0, team: 1, enterprise: 2 };

/** Highlight a license this many days before it lapses. */
const EXPIRY_WARNING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** micros (1e-6 USD) → "$0.00". */
const formatCost = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

const formatDate = (ms: number): string => new Date(ms).toLocaleDateString();

/**
 * Whole days until `expiresAt`, or null when perpetual. Display-only — whether
 * the license actually counts as expired is decided server-side (`expired`),
 * never from the client clock.
 */
const daysUntil = (expiresAt: number | null): number | null =>
  expiresAt == null ? null : Math.ceil((expiresAt - Date.now()) / DAY_MS);

const BillingTab: React.FC = () => {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [license, setLicense] = useState<BillingLicense | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTier, setSavingTier] = useState(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  // P1-2 model control (spend cap in dollars, allowlist as comma-separated).
  const [capInput, setCapInput] = useState('');
  const [allowlistInput, setAllowlistInput] = useState('');
  const [savingControl, setSavingControl] = useState(false);
  // T7: department budgets. `departments` gives friendly names for the
  // opaque `departmentId` one-billing reports (it deliberately does not
  // depend on one-org); `deptCapInputs` is per-row draft state so editing
  // one department's cap doesn't disturb the others.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptBudgets, setDeptBudgets] = useState<DepartmentBudget[]>([]);
  const [deptCapInputs, setDeptCapInputs] = useState<Record<string, string>>({});
  const [savingDeptId, setSavingDeptId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, u, l, depts, deptBudgetList] = await Promise.all([
        ipcBridge.oneBilling.plan.invoke(),
        // Usage is admin-only; swallow a 403 for non-admins.
        ipcBridge.oneBilling.usage.invoke({}).catch((): null => null),
        // Same for the license — visible to admins, absent for plain members.
        ipcBridge.oneBilling.license.invoke().catch((): null => null),
        ipcBridge.oneAdmin.listDepartments.invoke().catch((): Department[] => []),
        ipcBridge.oneBilling.listDepartmentBudgets.invoke().catch((): DepartmentBudget[] => []),
      ]);
      setPlan(p ?? null);
      setUsage(u ?? null);
      setLicense(l ?? null);
      setDepartments(depts);
      setDeptBudgets(deptBudgetList);
      if (p) {
        setCapInput(p.costCapMicros != null ? String(p.costCapMicros / 1_000_000) : '');
        setAllowlistInput(p.allowedModels.join(', '));
      }
    } catch (error) {
      Message.error(t('common.billing.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(error));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleActivateLicense = async () => {
    const key = licenseKeyInput.trim();
    if (!key) return;
    setActivating(true);
    try {
      // The activate endpoint returns the refreshed plan, so the tier/seat
      // display updates without a second round-trip. Re-read the license
      // itself for the customer/expiry fields it does not carry.
      const nextPlan = await ipcBridge.oneBilling.activateLicense.invoke({ licenseKey: key });
      setPlan(nextPlan);
      setLicense(await ipcBridge.oneBilling.license.invoke().catch((): null => null));
      setLicenseKeyInput('');
      Message.success(t('common.billing.activateSuccess'));
    } catch (error) {
      Message.error(t('common.billing.activateFailed') + ': ' + String(error));
    } finally {
      setActivating(false);
    }
  };

  const handleSetTier = async (tier: BillingTier) => {
    setSavingTier(true);
    try {
      const next = await ipcBridge.oneBilling.setTier.invoke({ tier });
      setPlan(next);
      Message.success(t('common.billing.tierUpdated', { defaultValue: '已更新档位' }));
    } catch (error) {
      // The picker already hides higher tiers, but a stale plan in state could
      // still let one through — translate the backend code instead of leaking
      // `UPGRADE_REQUIRES_LICENSE` to the operator.
      const raw = String(error);
      Message.error(
        raw.includes('UPGRADE_REQUIRES_LICENSE')
          ? t('common.billing.upgradeRequiresLicense')
          : t('common.billing.tierUpdateFailed', { defaultValue: '更新档位失败' }) + ': ' + raw
      );
    } finally {
      setSavingTier(false);
    }
  };

  const handleUpgrade = async () => {
    try {
      const result = await ipcBridge.oneBilling.checkout.invoke({ targetTier: 'enterprise' });
      Message.info(result.message);
    } catch (error) {
      Message.error(String(error));
    }
  };

  const handleSaveControl = async () => {
    setSavingControl(true);
    try {
      const cap = capInput.trim();
      const costCapMicros = cap ? Math.round(Number.parseFloat(cap) * 1_000_000) : null;
      const allowedModels = allowlistInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const next = await ipcBridge.oneBilling.setModelControl.invoke({ costCapMicros, allowedModels });
      setPlan(next);
      Message.success(t('common.billing.controlSaved', { defaultValue: '已保存模型管控' }));
    } catch (error) {
      Message.error(t('common.billing.controlSaveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSavingControl(false);
    }
  };

  const handleSaveDeptBudget = async (departmentId: string) => {
    setSavingDeptId(departmentId);
    try {
      const raw = (deptCapInputs[departmentId] ?? '').trim();
      const costCapMicros = raw ? Math.round(Number.parseFloat(raw) * 1_000_000) : null;
      const next = await ipcBridge.oneBilling.setDepartmentBudget.invoke({ departmentId, costCapMicros });
      setDeptBudgets(next);
      Message.success(t('common.billing.deptBudgetSaved', { defaultValue: '已保存部门预算' }));
    } catch (error) {
      Message.error(t('common.billing.deptBudgetSaveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSavingDeptId(null);
    }
  };

  /** Every department the caller can see, joined with its budget row (if any)
   * so departments with no cap set yet still get a row to configure one. */
  const deptBudgetRows = useMemo(
    () =>
      departments.map((d) => {
        const budget = deptBudgets.find((b) => b.departmentId === d.id);
        return {
          departmentId: d.id,
          name: d.name,
          costCapMicros: budget?.costCapMicros ?? null,
          costUsedMicros: budget?.costUsedMicros ?? 0,
        };
      }),
    [departments, deptBudgets]
  );

  const budgetPercent = useMemo(() => {
    if (!plan || plan.costCapMicros == null || plan.costCapMicros === 0) return 0;
    return Math.min(100, Math.round((plan.costUsedMicros / plan.costCapMicros) * 100));
  }, [plan]);

  /**
   * `setTier` is downgrade-only server-side. Offering a higher tier here would
   * hand the operator a control that always fails, so the picker is capped at
   * the current tier — upgrading goes through license activation above.
   */
  const selectableTiers = useMemo(() => {
    const currentRank = plan ? (TIER_RANK[plan.tier] ?? 0) : 0;
    return TIERS.filter((tier) => (TIER_RANK[tier] ?? 0) <= currentRank);
  }, [plan]);

  const licenseDaysLeft = useMemo(() => daysUntil(license?.expiresAt ?? null), [license]);

  const seatPercent = useMemo(() => {
    if (!plan || plan.seatLimit == null || plan.seatLimit === 0) return 0;
    return Math.min(100, Math.round((plan.seatUsed / plan.seatLimit) * 100));
  }, [plan]);

  /** `usage.byDepartment` buckets by raw department id (plus the sentinel
   * "unassigned"); resolve to a name here rather than in the backend, which
   * deliberately stays ignorant of one-org (see `DepartmentBudgetDto`). */
  const departmentBucketLabel = useCallback(
    (key: string) => {
      if (key === 'unassigned') return t('common.billing.deptUnassigned', { defaultValue: '未分配部门' });
      return departments.find((d) => d.id === key)?.name ?? key;
    },
    [departments, t]
  );

  const bucketColumns = (keyTitle: string, formatKey?: (key: string) => string) => [
    { title: keyTitle, dataIndex: 'key', render: (key: string) => (formatKey ? formatKey(key) : key) },
    { title: t('common.billing.colTurns', { defaultValue: '轮次' }), dataIndex: 'turns' },
    {
      title: t('common.billing.colTokens', { defaultValue: 'Token（尽力）' }),
      render: (_: unknown, r: UsageBucket) => r.totalTokens || '—',
    },
    {
      title: t('common.billing.colCost', { defaultValue: '估算成本' }),
      render: (_: unknown, r: UsageBucket) => formatCost(r.estimatedCostMicros),
    },
  ];

  if (!loading && !plan) {
    // Personal / no-enterprise: billing does not apply.
    return (
      <div className='p-24px text-13px text-t-tertiary'>
        {t('common.billing.personalHint', { defaultValue: '当前账号不属于任何企业，无需订阅与用量管理。' })}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-16px'>
      {/* License: the only path that can raise a tier. */}
      <Card
        title={t('common.billing.licenseTitle')}
        loading={loading}
        extra={
          license && (
            <Tag size='small' color={license.expired ? 'red' : 'green'} bordered>
              {license.expired ? t('common.billing.licenseExpired') : t('common.billing.licenseActive')}
            </Tag>
          )
        }
      >
        <div className='flex flex-col gap-12px'>
          {license ? (
            <>
              <div
                className='grid gap-8px text-13px'
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
              >
                <div>
                  <div className='text-t-tertiary'>{t('common.billing.licenseCustomer')}</div>
                  <div className='font-600'>{license.customer}</div>
                </div>
                <div>
                  <div className='text-t-tertiary'>{t('common.billing.licenseTier')}</div>
                  <div className='font-600'>
                    {t(`common.billing.tier_${license.tier}`, { defaultValue: license.tier })}
                  </div>
                </div>
                <div>
                  <div className='text-t-tertiary'>{t('common.billing.licenseSeats')}</div>
                  <div className='font-600'>
                    {license.seats == null ? t('common.billing.licenseDefaultSeats') : license.seats}
                  </div>
                </div>
                <div>
                  <div className='text-t-tertiary'>{t('common.billing.licenseExpires')}</div>
                  <div className='font-600'>
                    {license.expiresAt == null ? t('common.billing.licensePerpetual') : formatDate(license.expiresAt)}
                  </div>
                </div>
                <div>
                  <div className='text-t-tertiary'>{t('common.billing.licenseActivatedAt')}</div>
                  <div className='font-600'>{formatDate(license.activatedAt)}</div>
                </div>
                <div>
                  <div className='text-t-tertiary'>{t('common.billing.licenseId')}</div>
                  <div className='font-600 break-all'>{license.licenseId}</div>
                </div>
              </div>

              {/* Expiry state comes from the server's `expired`; the day count
                  below it is display-only. */}
              {license.expired && (
                <div
                  className='rounded-4px px-10px py-6px text-12px'
                  style={{ background: 'var(--color-danger-light-1)' }}
                >
                  {t('common.billing.licenseExpiredHint')}
                </div>
              )}
              {!license.expired && licenseDaysLeft != null && licenseDaysLeft <= EXPIRY_WARNING_DAYS && (
                <div
                  className='rounded-4px px-10px py-6px text-12px'
                  style={{ background: 'var(--color-warning-light-1)' }}
                >
                  {t('common.billing.licenseExpiringSoon', { days: Math.max(0, licenseDaysLeft) })}
                </div>
              )}
            </>
          ) : (
            <div className='text-13px text-t-tertiary'>{t('common.billing.licenseNone')}</div>
          )}

          {/* Activation. Admin-only server-side; a member gets a clear 403. */}
          <div className='flex items-center gap-8px'>
            <Input
              value={licenseKeyInput}
              onChange={setLicenseKeyInput}
              allowClear
              placeholder={t('common.billing.licenseKeyPlaceholder')}
            />
            <Button
              type='primary'
              loading={activating}
              disabled={!licenseKeyInput.trim()}
              onClick={() => void handleActivateLicense()}
            >
              {t('common.billing.activate')}
            </Button>
          </div>
          <div className='text-11px text-t-tertiary'>{t('common.billing.licenseHint')}</div>
        </div>
      </Card>

      {/* Plan / seats */}
      <Card
        title={t('common.billing.planTitle', { defaultValue: '订阅与席位' })}
        loading={loading}
        extra={
          plan && (
            <Tag color={TIER_COLOR[plan.tier] ?? 'gray'} size='small'>
              {t(`common.billing.tier_${plan.tier}`, { defaultValue: plan.tier })}
            </Tag>
          )
        }
      >
        {plan && (
          <div className='flex flex-col gap-16px'>
            <div>
              <div className='mb-4px flex items-center justify-between text-13px'>
                <span className='text-t-secondary'>{t('common.billing.seats', { defaultValue: '席位' })}</span>
                <span className='font-600'>
                  {plan.seatUsed}
                  {' / '}
                  {plan.seatLimit == null ? t('common.billing.unlimited', { defaultValue: '无限' }) : plan.seatLimit}
                </span>
              </div>
              {plan.seatLimit != null && (
                <Progress percent={seatPercent} status={seatPercent >= 100 ? 'error' : 'normal'} />
              )}
            </div>

            {/* T6-4: members who logged in while full — blocked, not billed,
                waiting on a freed seat or a plan upgrade. Silence here would
                look like nobody is affected when someone actually cannot send
                a single message. */}
            {plan.seatPending > 0 && (
              <Alert
                type='warning'
                content={t('common.billing.seatPendingWarning', {
                  count: plan.seatPending,
                  defaultValue: '{{count}} 人因席位已满暂无法使用，需释放席位或升级套餐',
                })}
              />
            )}

            {/* Entitlements */}
            <div className='flex flex-wrap gap-6px'>
              {plan.entitlements.map((e) => (
                <Tag key={e.feature} size='small' color={e.allowed ? 'green' : 'gray'} bordered>
                  {t(`common.billing.feature_${e.feature}`, { defaultValue: e.feature })}
                  {e.allowed ? ' ✓' : ' ✕'}
                </Tag>
              ))}
            </div>

            {/* Admin: set tier directly (manual provisioning). */}
            <div className='flex items-center gap-8px'>
              <span className='text-13px text-t-secondary'>
                {t('common.billing.setTier', { defaultValue: '手动设置档位' })}
              </span>
              <Select
                style={{ width: 160 }}
                value={plan.tier as BillingTier}
                loading={savingTier}
                onChange={(v) => void handleSetTier(v as BillingTier)}
              >
                {selectableTiers.map((tier) => (
                  <Select.Option key={tier} value={tier}>
                    {t(`common.billing.tier_${tier}`, { defaultValue: tier })}
                  </Select.Option>
                ))}
              </Select>
              <Button size='small' onClick={() => void handleUpgrade()}>
                {t('common.billing.upgrade', { defaultValue: '升级' })}
              </Button>
            </div>
            <div className='text-11px text-t-tertiary'>{t('common.billing.downgradeOnlyHint')}</div>
          </div>
        )}
      </Card>

      {/* Model control (P1-2): spend cap + model allowlist. */}
      {plan && (
        <Card title={t('common.billing.controlTitle', { defaultValue: '模型管控' })}>
          <div className='flex flex-col gap-16px'>
            {/* Spend budget */}
            <div>
              <div className='mb-4px flex items-center justify-between text-13px'>
                <span className='text-t-secondary'>
                  {t('common.billing.budget', { defaultValue: '成本上限（近 30 天，美元）' })}
                </span>
                <span className='font-600'>
                  {formatCost(plan.costUsedMicros)}
                  {plan.costCapMicros != null ? ` / ${formatCost(plan.costCapMicros)}` : ''}
                </span>
              </div>
              {plan.costCapMicros != null && (
                <Progress percent={budgetPercent} status={budgetPercent >= 100 ? 'error' : 'normal'} />
              )}
              <div className='mt-8px flex items-center gap-8px'>
                <Input
                  style={{ width: 160 }}
                  value={capInput}
                  onChange={setCapInput}
                  placeholder={t('common.billing.budgetPlaceholder', { defaultValue: '上限（美元）；留空=无限' })}
                  prefix='$'
                />
                <span className='text-11px text-t-tertiary'>
                  {t('common.billing.budgetHint', { defaultValue: '超上限后成员无法再发起对话，直到管理员上调。' })}
                </span>
              </div>
            </div>

            {/* Model allowlist */}
            <div>
              <div className='mb-4px text-13px text-t-secondary'>
                {t('common.billing.allowlist', { defaultValue: '模型 allowlist（逗号分隔；留空=全部允许）' })}
              </div>
              <Input.TextArea
                value={allowlistInput}
                onChange={setAllowlistInput}
                autoSize={{ minRows: 1, maxRows: 3 }}
                placeholder='claude-opus-4-8, gpt-4, deepseek-v4, gpt-image-2, seedance-2-0-fast'
              />
              {/* The allowlist is deliberately one list for chat and media alike
                  (see `check_media_allowed`), which makes it very easy to fill in
                  chat models only and silently switch off every image and video
                  generation in the company. Saying so here is the difference
                  between a policy and a trap. */}
              <div className='mt-4px text-12px text-t-tertiary'>
                {t('common.billing.allowlistCoversMedia', {
                  defaultValue:
                    '这一份清单同时管聊天和图片/视频模型。填了清单就只有清单里的模型能用——漏掉图片或视频模型，对应的生成会被一并拦掉。',
                })}
              </div>
            </div>

            <div>
              <Button type='primary' size='small' loading={savingControl} onClick={() => void handleSaveControl()}>
                {t('common.billing.saveControl', { defaultValue: '保存模型管控' })}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* T7: per-department spend caps, layered under the company-wide one
          above. Only departments the caller can see (from the org tree) get
          a row — an admin sets these up after T6-3's directory mapping. */}
      {plan && deptBudgetRows.length > 0 && (
        <Card title={t('common.billing.deptBudgetTitle', { defaultValue: '部门预算' })}>
          <div className='mb-8px text-11px text-t-tertiary'>
            {t('common.billing.deptBudgetHint', {
              defaultValue: '在公司整体上限之下，为部门单独设一道更紧的上限；留空=不受部门级限制。',
            })}
          </div>
          <Table
            rowKey='departmentId'
            size='small'
            pagination={false}
            columns={[
              { title: t('common.billing.colDepartment', { defaultValue: '部门' }), dataIndex: 'name' },
              {
                title: t('common.billing.colCost', { defaultValue: '估算成本' }),
                render: (_: unknown, r: (typeof deptBudgetRows)[number]) => formatCost(r.costUsedMicros),
              },
              {
                title: t('common.billing.deptBudgetCap', { defaultValue: '上限（美元）' }),
                render: (_: unknown, r: (typeof deptBudgetRows)[number]) => (
                  <Input
                    size='small'
                    style={{ width: 140 }}
                    prefix='$'
                    value={
                      deptCapInputs[r.departmentId] ??
                      (r.costCapMicros != null ? String(r.costCapMicros / 1_000_000) : '')
                    }
                    onChange={(v) => setDeptCapInputs((prev) => ({ ...prev, [r.departmentId]: v }))}
                    placeholder={t('common.billing.unlimited', { defaultValue: '无限' })}
                  />
                ),
              },
              {
                title: '',
                render: (_: unknown, r: (typeof deptBudgetRows)[number]) => (
                  <Button
                    size='small'
                    loading={savingDeptId === r.departmentId}
                    onClick={() => void handleSaveDeptBudget(r.departmentId)}
                  >
                    {t('common.billing.save', { defaultValue: '保存' })}
                  </Button>
                ),
              },
            ]}
            data={deptBudgetRows}
          />
        </Card>
      )}

      {/* Usage dashboard (admin only; null when not permitted). */}
      {usage && (
        <Card title={t('common.billing.usageTitle', { defaultValue: '用量看板（近 30 天）' })}>
          <div className='mb-12px flex flex-wrap gap-24px text-13px'>
            <div>
              <div className='text-t-tertiary'>{t('common.billing.totalTurns', { defaultValue: '总轮次' })}</div>
              <div className='text-18px font-700'>{usage.totalTurns}</div>
            </div>
            <div>
              <div className='text-t-tertiary'>{t('common.billing.totalTokens', { defaultValue: '总 Token' })}</div>
              <div className='text-18px font-700'>{usage.totalTokens || '—'}</div>
            </div>
            <div>
              <div className='text-t-tertiary'>{t('common.billing.totalCost', { defaultValue: '估算成本' })}</div>
              <div className='text-18px font-700'>{formatCost(usage.estimatedCostMicros)}</div>
            </div>
          </div>

          {/* A media call metered at zero consumes none of the spend cap, so the
              cap quietly stops binding for that model. We deliberately do not
              invent a fallback rate — that would change what an admin's cap
              actually blocks — so the only honest move is to put it in front of
              them, name the models, and say what to do. Hidden entirely when
              everything is priced, so it never becomes noise. */}
          {(usage.unpricedMediaCalls ?? 0) > 0 && (
            <Alert
              type='warning'
              className='mb-12px'
              content={
                <div className='text-12px'>
                  <div>
                    {t('common.billing.unpricedMedia', {
                      defaultValue:
                        '有 {{count}} 笔图片/视频生成没有费率，按 0 计入——这部分不消耗成本上限，上限对它们不起作用。',
                      count: usage.unpricedMediaCalls,
                    })}
                  </div>
                  {(usage.unpricedMediaModels?.length ?? 0) > 0 && (
                    <div className='mt-2px text-t-secondary'>
                      {t('common.billing.unpricedMediaModels', { defaultValue: '涉及模型' })}:{' '}
                      {usage.unpricedMediaModels?.join('、')}
                    </div>
                  )}
                  <div className='mt-2px text-t-secondary'>
                    {t('common.billing.unpricedMediaFix', {
                      defaultValue: '去「设置 → 模型」给这些模型填上单价，之后的生成就会计入上限。',
                    })}
                  </div>
                </div>
              }
            />
          )}
          <div className='grid gap-16px' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div>
              <div className='mb-6px text-12px font-600 text-t-secondary'>
                {t('common.billing.byUser', { defaultValue: '按成员' })}
              </div>
              <Table
                rowKey='key'
                size='small'
                pagination={{ pageSize: 5, hideOnSinglePage: true }}
                columns={bucketColumns(t('common.billing.colUser', { defaultValue: '成员' }))}
                data={usage.byUser}
              />
            </div>
            <div>
              <div className='mb-6px text-12px font-600 text-t-secondary'>
                {t('common.billing.byModel', { defaultValue: '按模型' })}
              </div>
              <Table
                rowKey='key'
                size='small'
                pagination={{ pageSize: 5, hideOnSinglePage: true }}
                columns={bucketColumns(t('common.billing.colModel', { defaultValue: '模型' }))}
                data={usage.byModel}
              />
            </div>
            <div>
              <div className='mb-6px text-12px font-600 text-t-secondary'>
                {t('common.billing.byDay', { defaultValue: '按日期' })}
              </div>
              <Table
                rowKey='key'
                size='small'
                pagination={{ pageSize: 7, hideOnSinglePage: true }}
                columns={bucketColumns(t('common.billing.colDay', { defaultValue: '日期' }))}
                data={usage.byDay}
              />
            </div>
            <div>
              <div className='mb-6px text-12px font-600 text-t-secondary'>
                {t('common.billing.byDepartment', { defaultValue: '按部门' })}
              </div>
              <Table
                rowKey='key'
                size='small'
                pagination={{ pageSize: 5, hideOnSinglePage: true }}
                columns={bucketColumns(
                  t('common.billing.colDepartment', { defaultValue: '部门' }),
                  departmentBucketLabel
                )}
                data={usage.byDepartment}
              />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default BillingTab;
