/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  bundle: vi.fn(),
  skills: vi.fn(),
  mcp: vi.fn(),
  bound: vi.fn(),
  sync: vi.fn(),
  syncMcp: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    personalAgent: { getTeamSyncBundle: { invoke: mocks.bundle }, syncTeamAgents: { invoke: mocks.sync } },
    oneDevops: {
      listRuntimeSkills: { invoke: mocks.skills },
      listActiveMcp: { invoke: mocks.mcp },
      listEmployeeBoundMcp: { invoke: mocks.bound },
    },
    fs: { syncTeamMcp: { invoke: mocks.syncMcp } },
  },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: () => 'https://qa-company.example',
  getEnterpriseSession: () => null,
}));
import { createTeamSyncBundleLoader, syncTeamAgents, syncTeamMcp } from '@/renderer/utils/enterprise/teamSkillSync';

describe('authorized employee dependency bundle', () => {
  it('shares a bundle within a cycle but fetches a fresh bundle for the next cycle', async () => {
    mocks.bundle.mockResolvedValue({ agents: [], assistants: [] });
    const load = createTeamSyncBundleLoader();
    await syncTeamMcp(() => true, load);
    await syncTeamAgents(() => true, load);
    expect(mocks.bundle).toHaveBeenCalledTimes(1);
    await syncTeamMcp(() => true, createTeamSyncBundleLoader());
    expect(mocks.bundle).toHaveBeenCalledTimes(2);
  });
  it('does not turn a failed bundle into an authoritative empty employee set', async () => {
    mocks.bundle.mockRejectedValue(new Error('offline'));
    const load = createTeamSyncBundleLoader();
    await syncTeamMcp(() => true, load);
    await syncTeamAgents(() => true, load);
    expect(mocks.bundle).toHaveBeenCalledTimes(1);
    expect(mocks.syncMcp).toHaveBeenCalledWith(expect.objectContaining({ authoritative: false }));
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.skills.mockResolvedValue([{ id: 'allowed-skill', enabled: true }]);
    mocks.mcp.mockResolvedValue([{ id: 'allowed-mcp', enabled: true }]);
    mocks.sync.mockResolvedValue({ written: ['employee'], removed: [], conflicts: [], kept: 1 });
    // The authorized catalog has nothing for an unauthorized id.
    mocks.bound.mockResolvedValue([]);
    mocks.syncMcp.mockResolvedValue({ written: [], removed: [], conflicts: [], kept: 0 });
  });
  it('keeps a connector the employee binds even though the member did not select it', async () => {
    mocks.bundle.mockResolvedValue({
      agents: [
        {
          id: 'employee',
          name: 'Employee',
          agentType: 'dream',
          automationConfig: { boundMcpIds: ['allowed-mcp', 'bound-only'] },
        },
      ],
      assistants: [],
    });
    mocks.bound.mockResolvedValue([
      { id: 'bound-only', name: 'Bound only', type: 'sse', endpoint: 'https://m/sse', enabled: true },
    ]);
    await syncTeamAgents();
    // Only the unselected id is asked for, so the member's own selection is not re-fetched.
    expect(mocks.bound).toHaveBeenCalledWith({ ids: ['bound-only'] });
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: [
          expect.objectContaining({
            automationConfig: expect.objectContaining({ boundMcpIds: ['allowed-mcp', 'bound-only'] }),
          }),
        ],
      })
    );
  });
  it('materializes employee-bound connectors flagged outside the quota, authoritatively', async () => {
    mocks.bundle.mockResolvedValue({
      agents: [
        { id: 'employee', name: 'Employee', agentType: 'dream', automationConfig: { boundMcpIds: ['bound-only'] } },
      ],
      assistants: [],
    });
    mocks.bound.mockResolvedValue([
      { id: 'bound-only', name: 'Bound only', type: 'sse', endpoint: 'https://m/sse', enabled: true },
    ]);
    await syncTeamMcp();
    expect(mocks.syncMcp).toHaveBeenCalledWith({
      servers: [
        expect.objectContaining({ id: 'allowed-mcp', employeeBound: false }),
        expect.objectContaining({ id: 'bound-only', employeeBound: true }),
      ],
      authoritative: true,
    });
  });
  it('does not wipe cached bound connectors when the employee list cannot be read', async () => {
    mocks.bundle.mockRejectedValue(new TypeError('network offline'));
    await syncTeamMcp();
    expect(mocks.syncMcp).toHaveBeenCalledWith(expect.objectContaining({ authoritative: false }));
  });
  it('hands expert rules and source scope to the local materializer with authorized bindings', async () => {
    const assistants = [{ key: 'owner/expert', rules: 'Unique expert instructions' }];
    mocks.bundle.mockResolvedValue({
      agents: [
        {
          id: 'employee',
          name: 'Employee',
          agentType: 'dream',
          assistantId: 'owner/expert',
          automationConfig: {
            boundSkillIds: ['allowed-skill', 'private-skill'],
            boundMcpIds: ['allowed-mcp', 'private-mcp'],
          },
        },
      ],
      assistants,
    });
    await expect(syncTeamAgents()).resolves.toEqual({ written: 1, removed: 0, kept: 1 });
    expect(mocks.sync).toHaveBeenCalledWith({
      agents: [
        expect.objectContaining({
          assistantId: 'owner/expert',
          automationConfig: expect.objectContaining({ boundSkillIds: ['allowed-skill'], boundMcpIds: ['allowed-mcp'] }),
        }),
      ],
      assistants,
      sourceScope: 'https://qa-company.example',
      authoritative: true,
    });
  });
  it('preserves cached employees if the bundle is unavailable or materialization fails', async () => {
    mocks.bundle.mockRejectedValueOnce(new TypeError('network offline'));
    await expect(syncTeamAgents()).resolves.toBeNull();
    expect(mocks.sync).not.toHaveBeenCalled();
    mocks.bundle.mockResolvedValue({ agents: [], assistants: [] });
    mocks.sync.mockRejectedValueOnce(new Error('expert conflict'));
    await expect(syncTeamAgents()).resolves.toBeNull();
  });
});
