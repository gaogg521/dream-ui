/**
 * Enterprise org / admin types for the one-org and one-sso crates.
 *
 * Mirrors the Rust DTOs in `crates/one-org/src/models.rs` and
 * `crates/one-sso/src/models.rs` of the AionCore fork. Most DTOs serialize
 * with camelCase keys (serde rename_all = camelCase); `InviteDto` is the
 * exception — it serializes snake_case, so `OrgInvite` mirrors that.
 */

export type OrgRole = 'member' | 'org_admin' | 'system_admin';

export type OrgContext = {
  tenantId: string;
  tenantName?: string | null;
  role: OrgRole | string;
  isEnterprise: boolean;
  memberCount: number;
};

export type OrgPublicInfo = {
  tenantName?: string | null;
};

/**
 * The caller's own enterprise-org identity — the SSO company (Feishu / etc.)
 * dimension, **independent of any project-group membership**. Mirrors the
 * Rust `EnterpriseIdentityDto` (one-enterprise). `null` for a local/LDAP
 * account or a user who has never signed in via a company SSO login.
 * `companyId` is the raw IdP company id (e.g. Feishu `tenant_key`), not a
 * human-readable name; `companyName` is often `null` because Feishu SSO
 * doesn't surface it. `department` / `jobTitle` are only populated when the
 * IdP grant includes a directory scope (Feishu Contacts).
 */
export type EnterpriseIdentity = {
  provider: string;
  companyId: string;
  companyName?: string | null;
  displayName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  role: string;
};

/**
 * The deployment's company (真实企业 / one-enterprise) as seen by the caller —
 * the governance tier ABOVE project groups (Direction B). `viewerRole` is the
 * caller's own company role (`admin` | `member`) or `null` if not a member;
 * `origin` is `manual` (explicitly set up) or `sso` (bootstrapped from a login).
 */
export type CompanyOverview = {
  companyId: string;
  name?: string | null;
  origin: string;
  memberCount: number;
  viewerRole?: string | null;
};

/** A company member row for the company admin console. */
export type CompanyMember = {
  userId: string;
  username?: string | null;
  displayName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  role: string;
  /**
   * `'active'` (governed, billable) or `'pending'` (arrived after the plan's
   * seat cap was full — blocked from every send until a seat frees up or the
   * plan is upgraded, no manual "assign" action exists; see T6-4).
   */
  seatStatus: string;
};

/** Outcome of disbanding a company — irreversible, see `oneEnterprise.disbandCompany`. */
export type DisbandCompanyResult = {
  deletedProjectGroupIds: string[];
  removedMemberCount: number;
};

/**
 * A pending invite: an admin picked someone from the synced directory and
 * generated them a link, but they have not completed SSO login yet. Not an
 * access gate — SSO login still auto-joins the company regardless — this is
 * purely a "who have we reached out to" tracking card.
 */
export type CompanyInvite = {
  id: string;
  provider: string;
  externalId: string;
  displayName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  createdAt: number;
};

/**
 * Outcome of the last directory sync (T6), for the console's status line.
 *
 * `lastStatus === 'partial'` is not cosmetic: it means the pull did not finish,
 * so the mirror is stale AND no departures were derived from it. The UI has to
 * say that rather than show a reassuring empty list.
 */
export type DirectorySyncState = {
  provider: string;
  lastRunAt?: number | null;
  lastStatus?: 'ok' | 'partial' | string | null;
  lastError?: string | null;
  departmentCount: number;
  peopleCount: number;
};

/**
 * A project group a departed member is still in.
 *
 * Removing somebody is project-group scoped — the backend acts on the caller's
 * *active* group and refuses a user who is not in it — so the console needs
 * this to know whether it can offer the full offboarding flow or only the
 * company-level one.
 */
export type DepartedTenantRef = {
  tenantId: string;
  name?: string | null;
};

/** A company member the IdP directory no longer lists. A suggestion, not an action. */
export type DepartedMember = {
  userId: string;
  externalId: string;
  displayName?: string | null;
  department?: string | null;
  missingSince: number;
  /** Empty is a real answer: a company member who never joined a group. */
  tenants: DepartedTenantRef[];
};

/** One active person from the directory mirror — the roster itself. */
export type DirectoryPerson = {
  externalId: string;
  name?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  active: boolean;
};

/** What an admin-triggered directory sync did. */
export type DirectorySyncResult = {
  ran: boolean;
  skipped?: string | null;
  complete: boolean;
  departments: number;
  people: number;
  error?: string | null;
};

/** A project group owned by a company, for the company admin console listing. */
export type EnterpriseTenant = {
  tenantId: string;
  name: string;
  memberCount: number;
  createdAt: number;
};

export type OrgTenant = {
  tenantId: string;
  tenantName: string;
};

/**
 * One project group the caller belongs to, for the "my project groups"
 * switcher (Phase 2 multi-membership). Mirrors Rust `MyTenantDto`. `isActive`
 * marks the group currently in effect; switching activates a different one.
 */
export type MyTenant = {
  tenantId: string;
  name: string;
  role: OrgRole | string;
  memberCount: number;
  isActive: boolean;
};

/**
 * Lightweight (id, name) summary of a project group on this server, for admin
 * pickers such as the devops resource scope selector (P0-4). Mirrors Rust
 * `TenantSummaryDto`.
 */
export type TenantSummary = {
  tenantId: string;
  name: string;
};

/**
 * One agent tool-call, for the agent-run audit (P1-1). Which agent run touched
 * which file / ran which command / called which tool. Mirrors Rust
 * `AgentAuditEntry`.
 */
export type AgentAuditEntry = {
  id: string;
  conversationId: string;
  userId: string | null;
  toolName: string;
  detail: string | null;
  status: string | null;
  createdAt: number;
};

export type AgentAuditQuery = {
  userId?: string;
  tool?: string;
  since?: number;
  limit?: number;
};

/** P2-4 onboarding: bulk-generate `count` invite codes at once. */
export type BulkInviteInput = {
  count: number;
  maxUses?: number;
  expiresInDays?: number;
};

/** Result of sending an invite by email — reserved seam, see `SmtpConfig`. */
export type SendEmailResult = {
  /** `'not_configured'` (stub) or `'sent'`. */
  status: string;
  message: string;
};

/**
 * Reserved SMTP configuration (P2-4 onboarding). Saving this does not, by
 * itself, make email sending work — no SMTP client is wired in yet. It lets an
 * operator with real credentials fill them in ahead of time, the same "adapter
 * reserved" pattern as the billing payment provider.
 */
export type SmtpConfig = {
  host: string | null;
  port: number | null;
  username: string | null;
  hasPassword: boolean;
  fromAddress: string | null;
  enabled: boolean;
  updatedAt: number | null;
};

export type SetSmtpConfigInput = {
  host: string;
  port: number;
  username?: string;
  /** Omit to keep the stored password. */
  password?: string;
  fromAddress: string;
  enabled: boolean;
};

export type ResetLocalResult = {
  archivedTenantCount: number;
  archivedMemberCount: number;
  archivePath: string;
};

/** snake_case on purpose — the Rust InviteDto serializes snake_case. */
export type OrgInvite = {
  id: string;
  tenant_id: string;
  code: string;
  created_by: string;
  max_uses?: number | null;
  use_count: number;
  expires_at?: number | null;
  created_at: number;
  revoked: boolean;
};

export type CreatedInvite = {
  invite: OrgInvite;
  displayCode: string;
};

export type AdminUser = {
  userId: string;
  username: string;
  tenantId: string;
  role: OrgRole | string;
  displayName?: string | null;
  orgUnitPath?: string | null;
  jobTitle?: string | null;
  /** Structured department assignment (P2-3), distinct from `orgUnitPath`. */
  departmentId?: string | null;
  lastLogin?: number | null;
  createdAt: number;
};

/**
 * A department/sub-team node within a project group (P2-3 organizational
 * hierarchy). `parentId` is null for a top-level department. Mirrors Rust
 * `DepartmentDto`.
 */
export type Department = {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  /**
   * `null` for a manually-created department (the default). `'directory'`
   * means a T6 stage 3 mapping sync created/owns this row — its name gets
   * overwritten on the next sync, so the console marks it distinctly from
   * one someone typed in by hand.
   */
  source: string | null;
};

/** One department from the company directory mirror, for the T6 stage 3
 * "pick a subtree to map" picker. Flat; the picker groups by parent
 * client-side. */
export type DirectoryDepartmentCandidate = {
  externalId: string;
  parentExternalId: string | null;
  name: string;
};

/** What one directory-mapping run did, for the admin console's result toast. */
export type DirectoryMapReport = {
  created: string[];
  updated: string[];
  removed: string[];
  /** Dropped out of the mapped subtree but kept — real local structure
   * (a manually-added child or an assigned member) is still hanging off them. */
  keptWithLocalData: string[];
};

/**
 * A configured integration connector (P2-1 reserved framework), redacted for
 * the admin UI. Mirrors Rust `IntegrationDto`. `provider` is a free-text key
 * (github / gitlab / jira / feishu / ...); `config` holds non-secret
 * provider-specific fields; the credential is never returned — only
 * `hasSecret`. Saving a connector does NOT sync anything yet: no connector
 * client is wired in, so a "test" reports `not_configured` until a real
 * provider is dropped in at the app layer.
 */
export type Integration = {
  provider: string;
  baseUrl: string | null;
  config: Record<string, unknown>;
  hasSecret: boolean;
  enabled: boolean;
  updatedAt: number | null;
};

export type SetIntegrationInput = {
  provider: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
  /** Omit/empty to keep the stored secret. */
  secret?: string;
  enabled: boolean;
};

/** Result of probing a connector — reserved seam, see {@link Integration}. */
export type IntegrationTestResult = {
  /** `'not_configured'` (stub), `'ok'`, or `'error'`. */
  status: string;
  message: string;
};

/**
 * Container-runtime config (P1-3 reserved framework), redacted for the admin
 * UI. Mirrors Rust `ContainerConfigDto`. Saving does NOT run anything — no
 * container client is wired in; a probe reports `not_configured` until a real
 * `ContainerRuntime` is dropped in at the app layer. The registry credential is
 * never returned — only `hasRegistrySecret`.
 */
export type ContainerConfig = {
  runtimeKind: string | null;
  endpoint: string | null;
  defaultImage: string | null;
  registry: string | null;
  hasRegistrySecret: boolean;
  enabled: boolean;
  updatedAt: number | null;
};

export type SetContainerConfigInput = {
  runtimeKind?: string;
  endpoint?: string;
  defaultImage?: string;
  registry?: string;
  /** Omit/empty to keep the stored registry secret. */
  registrySecret?: string;
  enabled: boolean;
};

/**
 * Realtime-collaboration config (P2-2 reserved framework), redacted. Mirrors
 * Rust `CollaborationConfigDto`. Distinct from the WebSocket transport
 * (`aionui-realtime`): this is the admin-configured collaboration backend. A
 * probe reports `not_configured` until a real `CollaborationProvider` is wired.
 */
export type CollaborationConfig = {
  provider: string | null;
  endpoint: string | null;
  hasSecret: boolean;
  presence: boolean;
  enabled: boolean;
  updatedAt: number | null;
};

export type SetCollaborationConfigInput = {
  provider?: string;
  endpoint?: string;
  /** Omit/empty to keep the stored secret. */
  secret?: string;
  presence: boolean;
  enabled: boolean;
};

/** Result of probing a platform config — reserved seam (container / collab). */
export type PlatformProbeResult = {
  /** `'not_configured'` (stub), `'ok'`, or `'error'`. */
  status: string;
  message: string;
};

/**
 * IP allowlist config (P1-4). `cidrs` is the list of allowed CIDR/IP strings.
 * Request blocking is a reserved drop-in — saving this does not by itself block
 * anyone. Mirrors Rust `IpAllowlistConfigDto`.
 */
export type IpAllowlistConfig = {
  cidrs: string[];
  enabled: boolean;
  updatedAt: number | null;
};

export type SetIpAllowlistInput = {
  cidrs: string[];
  enabled: boolean;
};

/**
 * SIEM audit-log export config (P1-4), redacted. A real export requires a
 * `SiemExporter` wired at the app layer; until then a probe reports
 * `not_configured`. The token is never returned — only `hasSecret`. Mirrors
 * Rust `SiemConfigDto`.
 */
export type SiemConfig = {
  kind: string | null;
  endpoint: string | null;
  hasSecret: boolean;
  enabled: boolean;
  updatedAt: number | null;
};

export type SetSiemConfigInput = {
  kind?: string;
  endpoint?: string;
  /** Omit/empty to keep the stored token. */
  secret?: string;
  enabled: boolean;
};

export type AuditLogEntry = {
  id: string;
  tenantId: string;
  userId?: string | null;
  username?: string | null;
  action: string;
  resource?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: number;
};

export type RuntimeNode = {
  id: string;
  tenantId: string;
  userId: string;
  machineId: string;
  displayName: string;
  hostnames: string[];
  ipAddresses: string[];
  installedAgents: string[];
  lastSeenAt: number;
  updatedAt: number;
};

export type SsoProviderStatus = {
  provider: string;
  enabled: boolean;
  configured: boolean;
};

/** Admin-only variant of {@link SsoProviderStatus} — `config` holds the
 * stored non-secret field values (secrets are still stripped) so the
 * settings form can pre-fill instead of always starting blank. */
export type SsoProviderConfig = SsoProviderStatus & {
  config: Record<string, unknown>;
};

export type UpdateSsoProviderInput = {
  enabled?: boolean;
  /** Replaces the stored provider config JSON when present. */
  config?: Record<string, unknown>;
};

/**
 * P1-1 enterprise configuration backup. Mirrors `BackupBundle` in one-org.
 *
 * Contains project groups, memberships, departments, invites, companies, the
 * licence, SSO wiring and the shared registries — but deliberately NOT user
 * conversations/messages, and NOT any credential: secrets are replaced with a
 * marker server-side and must be re-entered after a restore.
 */
export type BackupBundle = {
  version: number;
  exportedAt: number;
  exportedByTenant: string;
  /** Always true in practice — surfaced so the UI can warn about credentials. */
  containsRedactions: boolean;
  tables: Record<string, Array<Record<string, unknown>>>;
};

export type BackupImportReport = {
  tablesApplied: number;
  rowsApplied: number;
  /** Tables in the bundle this deployment has no schema for. */
  tablesSkipped: string[];
};
