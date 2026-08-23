/**
 * Billing plane (P0-3): subscription tier, seat usage, and usage dashboard.
 * Mirrors the Rust DTOs in one-billing.
 */

export type BillingTier = 'free' | 'team' | 'enterprise';

export type Entitlement = {
  feature: string;
  allowed: boolean;
};

/** The caller's company plan. `null` from the API for personal users. */
export type BillingPlan = {
  enterpriseId: string;
  tier: string;
  /** ACTIVE (governed, billable) seats only — what seatLimit caps. */
  seatUsed: number;
  /** null = unlimited */
  seatLimit: number | null;
  /**
   * Members who logged in while the plan was full (T6-4): they exist and are
   * blocked from every send, but hold no seat and are not counted in
   * seatUsed. Freeing a seat or upgrading the plan promotes them on their
   * next login — there is no manual "assign" action.
   */
  seatPending: number;
  expiresAt: number | null;
  entitlements: Entitlement[];
  /** P1-2 model control: rolling-30-day spend cap (USD-micros); null = no cap. */
  costCapMicros: number | null;
  /** Estimated spend this budget window (USD-micros). */
  costUsedMicros: number;
  /** Allowed model names; empty = all allowed. */
  allowedModels: string[];
};

/**
 * The vendor-signed license currently backing this company's plan.
 * Mirrors `LicenseInfoDto` in one-billing. `null` when none was ever activated.
 *
 * `expired` is computed server-side on purpose — the client must never decide
 * expiry from its own clock, which can be wrong or deliberately set back.
 */
export type BillingLicense = {
  licenseId: string;
  customer: string;
  tier: string;
  /** null = the tier's default seat cap. */
  seats: number | null;
  /** null = perpetual. */
  expiresAt: number | null;
  activatedAt: number;
  expired: boolean;
};

/** POST body for activating a vendor-signed license key. */
export type ActivateLicenseInput = {
  licenseKey: string;
};

/** PUT body for the model-control policy (P1-2). */
export type ModelControlInput = {
  /** Rolling-30-day spend cap in USD-micros; null = remove the cap. */
  costCapMicros?: number | null;
  /** Allowed model names; empty = allow all. */
  allowedModels: string[];
};

/** One aggregation bucket (by user, model, or day). */
export type UsageBucket = {
  key: string;
  turns: number;
  totalTokens: number;
  estimatedCostMicros: number;
};

export type UsageSummary = {
  since: number;
  totalTurns: number;
  totalTokens: number;
  estimatedCostMicros: number;
  byUser: UsageBucket[];
  byModel: UsageBucket[];
  byDay: UsageBucket[];
  /** 桶键 `"unassigned"` 表示未分配部门的成员（T7）。 */
  byDepartment: UsageBucket[];
  /**
   * 本周期内被按 0 计价的媒体生成笔数。
   *
   * 0 成本不消耗成本上限，所以上限对那个模型悄悄失效了。内置费率表按模型名匹配，
   * 自带命名的网关（很常见）一条都匹配不上——刻意不发明兜底费率，而是把它摆到
   * 管理员眼前，让他填一个单价。
   */
  unpricedMediaCalls?: number;
  /** 上面那些笔数对应的模型名，省得管理员自己去猜是哪个。 */
  unpricedMediaModels?: string[];
};

export type CheckoutResult = {
  /** 'manual' (no payment provider) or 'redirect'. */
  status: string;
  message: string;
  checkoutUrl: string | null;
};

export type SetTierInput = {
  tier: BillingTier;
  seatLimit?: number | null;
};

/**
 * 一个部门的支出上限与本周期用量（T7）。`departmentId` 在这里是不透明的——
 * 计费面不依赖组织架构面，展示时由已经拉取过部门树的调用方自行按 id 关联。
 */
export type DepartmentBudget = {
  departmentId: string;
  /** null = 没有部门级上限（只受公司级上限约束，如果有的话）。 */
  costCapMicros: number | null;
  /** 本周期估算支出（USD-micros），与公司级口径一致的滚动窗口。 */
  costUsedMicros: number;
};

/** PUT /api/one/billing/department-budgets 的请求体。 */
export type SetDepartmentBudgetInput = {
  departmentId: string;
  /** null = 清除该部门的上限。 */
  costCapMicros?: number | null;
};

/**
 * 一个生成的媒体文件，在集中账本里的一条记录（T8）。一个任务产出多张图会是
 * 多条记录——每个文件都能单独被找到，而不是任务粒度的聚合。
 */
export type MediaAssetLedgerEntry = {
  id: string;
  userId: string;
  /** 不透明，同 DepartmentBudget.departmentId——计费面不依赖组织架构面。 */
  departmentId: string | null;
  conversationId: string | null;
  /** 'image' | 'video' */
  kind: string;
  model: string | null;
  filePath: string;
  /** 公司未开启提示词留存时恒为 null。 */
  prompt: string | null;
  createdAt: number;
};

/** GET /api/one/billing/media-ledger 的查询参数。 */
export type MediaLedgerQuery = {
  kind?: string;
  model?: string;
  userId?: string;
  since?: number;
  promptContains?: string;
  limit?: number;
};

/** 公司是否已开启"保留生成提示词"（T8）；默认关闭。 */
export type MediaLedgerSettings = {
  retainPrompts: boolean;
};

/** POST /api/one/billing/media-ledger/report 的请求体——上报一个已生成的文件。 */
export type ReportMediaAssetInput = {
  kind: string;
  model?: string;
  filePath: string;
  /** 客户端总是可以传；后端会按公司当前设置决定是否真的落库。 */
  prompt?: string;
  conversationId?: string;
};
