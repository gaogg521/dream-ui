/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ bundle: vi.fn(), skills: vi.fn(), mcp: vi.fn(), sync: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    personalAgent: { getTeamSyncBundle: { invoke: mocks.bundle }, syncTeamAgents: { invoke: mocks.sync } },
    oneDevops: { listSkills: { invoke: mocks.skills }, listMcpRegistry: { invoke: mocks.mcp } },
  },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: () => 'https://qa-company.example',
  getEnterpriseSession: () => null,
}));
import { syncTeamAgents } from '@/renderer/utils/enterprise/teamSkillSync';

describe('authorized employee dependency bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.skills.mockResolvedValue([{ id: 'allowed-skill', enabled: true }]);
    mocks.mcp.mockResolvedValue([{ id: 'allowed-mcp', enabled: true }]);
    mocks.sync.mockResolvedValue({ written: ['employee'], removed: [], conflicts: [], kept: 1 });
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
