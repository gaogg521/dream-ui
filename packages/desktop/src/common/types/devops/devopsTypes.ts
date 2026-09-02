/**
 * one-devops DTOs — mirror crates/one-devops/src/models.rs (camelCase wire
 * shape, matching the other one-* domains).
 */

export type RequirementType = 'epic' | 'feature' | 'story' | 'bug' | 'task';
export type RequirementStatus = 'backlog' | 'planning' | 'developing' | 'testing' | 'completed';
export type RequirementPriority = 'low' | 'medium' | 'high' | 'urgent';

export type RequirementNode = {
  id: string;
  parentId: string | null;
  type: RequirementType;
  subject: string;
  description: string | null;
  status: RequirementStatus;
  priority: RequirementPriority;
  assignedTo: string | null;
  milestoneId: string | null;
  autopilot: boolean;
  creatorId: string;
  creatorName: string | null;
  createdAt: number;
  updatedAt: number;
  children: RequirementNode[];
};

export type RequirementComment = {
  id: string;
  requirementId: string;
  authorType: 'user' | 'agent' | 'autopilot';
  authorId: string | null;
  authorName: string;
  body: string;
  metadata: string | null;
  createdAt: number;
};

export type CreateRequirementInput = {
  subject: string;
  parentId?: string;
  type?: RequirementType;
  description?: string;
  priority?: RequirementPriority;
  milestoneId?: string;
  autopilot?: boolean;
};

export type UpdateRequirementInput = {
  subject?: string;
  description?: string | null;
  status?: RequirementStatus;
  priority?: RequirementPriority;
  assignedTo?: string | null;
  parentId?: string | null;
  milestoneId?: string | null;
  autopilot?: boolean;
};

/** POST body for skill upsert — omit `id` to create, pass it to update. */
/**
 * Read-ACL scope for a distributed resource (P0-4).
 * - `org`: visible to the whole enterprise.
 * - `team`: visible only to members of the bound project group (`teamId`).
 */
export type ResourceScope = 'org' | 'team';

/**
 * Read-ACL visibility for a distributed resource (P0-4).
 * - `all`: every member within the scope may read it.
 * - `admin`: only org/system admins may read it.
 */
export type ResourceVisibility = 'all' | 'admin';

/** Scope/visibility fields shared by every registry upsert body (P0-4). */
export type ResourceAclInput = {
  /** Defaults to `org` server-side when omitted. */
  scope?: ResourceScope;
  /** Required when `scope === 'team'`; a project-group tenant id. */
  teamId?: string | null;
  /** Defaults to `all` server-side when omitted. */
  visibility?: ResourceVisibility;
};

export type UpsertSkillInput = ResourceAclInput & {
  id?: string;
  name: string;
  description?: string;
  content?: string;
  enabled?: boolean;
  /** Mixed distribution: admin marks the skill auto-active on member agents. */
  autoActive?: boolean;
};

/** POST body for MCP registry upsert — omit `id` to create, pass it to update. */
export type UpsertMcpRegistryInput = ResourceAclInput & {
  id?: string;
  name: string;
  type?: 'stdio' | 'sse';
  endpoint?: string;
  enabled?: boolean;
  hasKeys?: boolean;
  /** JSON object of stdio env / sse headers to distribute (D5). */
  secretsJson?: string;
};

/** POST body registering a RAG document (metadata only; no update endpoint). */
export type RegisterRagDocumentInput = ResourceAclInput & {
  title: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
};

export type RagConfig = {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  dimensions: number | null;
  updatedAt: number;
};

/** apiKey omitted = keep stored key; provided = replace. */
export type SetRagConfigInput = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type RagSearchHit = {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  score: number;
};

export type SkillRegistryEntry = {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  /** Mixed distribution: member agents load this skill without opt-in. */
  autoActive: boolean;
  scope: string;
  teamId: string | null;
  visibility: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type McpRegistryEntry = {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  endpoint: string;
  enabled: boolean;
  hasKeys: boolean;
  /** stdio env / sse headers JSON object, distributed to members (D5). */
  secretsJson?: string | null;
  scope: string;
  teamId: string | null;
  visibility: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * A model channel the company provisioned.
 *
 * ⚠️ There is deliberately no field for the API key. The credential lives
 * encrypted on the company server and is only ever used there, inside the model
 * proxy — members reach the vendor through that proxy with a revocable channel
 * token instead. `hasKey` is all an admin UI needs.
 */
export type ModelChannelEntry = {
  id: string;
  name: string;
  platform: string;
  /** Where the proxy forwards to. Shown to admins; members never need it. */
  upstreamBaseUrl: string;
  hasKey: boolean;
  /** JSON array of model names offered on this channel. */
  models: string;
  /** JSON object of per-model settings, same shape as a provider's. */
  modelSettings?: string | null;
  /** JSON object mapping model name -> wire protocol; only for new-api channels. */
  modelProtocols?: string | null;
  enabled: boolean;
  scope: string;
  teamId: string | null;
  visibility: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type UpsertModelChannelInput = {
  id?: string;
  name: string;
  platform?: string;
  upstreamBaseUrl: string;
  /** Write-only. Omit on an edit to keep the stored credential. */
  apiKey?: string;
  models?: string;
  modelSettings?: string | null;
  modelProtocols?: string | null;
  enabled?: boolean;
  scope?: string;
  teamId?: string | null;
  visibility?: string;
};

/** The one time a channel token is ever transmitted; the server keeps a hash. */
export type IssuedChannelToken = {
  channelId: string;
  token: string;
};

export type MilestoneStatus = 'active' | 'completed' | 'archived';

export type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  dueAt: number | null;
  creatorId: string;
  creatorName: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateMilestoneInput = {
  title: string;
  description?: string;
  dueAt?: number;
};

export type UpdateMilestoneInput = {
  title?: string;
  description?: string | null;
  status?: MilestoneStatus;
  dueAt?: number | null;
};

export type RagDocumentEntry = {
  id: string;
  title: string;
  filePath: string | null;
  fileSize: number | null;
  mimeType: string | null;
  status: string;
  lastError: string | null;
  chunkCount: number;
  scope: string;
  teamId: string | null;
  visibility: string;
  createdBy: string;
  createdAt: number;
};

// -- test plans / test cases (A4) ----------------------------------------

export type TestPlanStatus = 'draft' | 'active' | 'completed' | 'archived';
export type TestCaseStatus = 'pending' | 'passed' | 'failed' | 'blocked' | 'skipped';

export type TestPlan = {
  id: string;
  title: string;
  description: string | null;
  status: TestPlanStatus;
  requirementId: string | null;
  creatorId: string;
  creatorName: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TestCase = {
  id: string;
  planId: string;
  title: string;
  description: string | null;
  steps: string | null;
  expected: string | null;
  status: TestCaseStatus;
  creatorId: string;
  creatorName: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateTestPlanInput = {
  title: string;
  description?: string;
  requirementId?: string;
};

export type UpdateTestPlanInput = {
  title?: string;
  description?: string | null;
  status?: TestPlanStatus;
  requirementId?: string | null;
};

export type CreateTestCaseInput = {
  title: string;
  description?: string;
  steps?: string;
  expected?: string;
};

export type UpdateTestCaseInput = {
  title?: string;
  status?: TestCaseStatus;
  description?: string | null;
  steps?: string | null;
  expected?: string | null;
};

// -- pipelines / pipeline runs (A4) --------------------------------------

export type PipelineStatus = 'active' | 'disabled';
export type PipelineTrigger = 'manual' | 'push' | 'schedule';
export type PipelineRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export type Pipeline = {
  id: string;
  name: string;
  description: string | null;
  status: PipelineStatus;
  trigger: PipelineTrigger;
  creatorId: string;
  creatorName: string | null;
  createdAt: number;
  updatedAt: number;
};

export type PipelineRun = {
  id: string;
  pipelineId: string;
  status: PipelineRunStatus;
  triggeredBy: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  log: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreatePipelineInput = {
  name: string;
  description?: string;
  trigger?: PipelineTrigger;
};

export type UpdatePipelineInput = {
  name?: string;
  description?: string | null;
  status?: PipelineStatus;
  trigger?: PipelineTrigger;
};

export type UpdatePipelineRunInput = {
  status?: PipelineRunStatus;
  startedAt?: number | null;
  finishedAt?: number | null;
  log?: string | null;
};
