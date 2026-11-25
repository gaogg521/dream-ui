import { describe, expect, it, vi } from 'vitest';
import {
  collaborationLeaderInput,
  createCollaborationTeam,
} from '@/renderer/pages/conversation/platforms/dreamEngine/autoCollaboration';

const bridge = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: { assistants: { list: { invoke: bridge.list } }, team: { create: { invoke: bridge.create } } },
}));
vi.mock('@/common/types/agent/assistantTypes', () => ({
  assistantRuntimeKey: (assistant: { backend: string }) => assistant.backend,
}));

describe('auto collaboration', () => {
  it('starts a leader-only team using the selected assistant, model, and workspace', async () => {
    bridge.list.mockResolvedValue([
      { id: 'default', name: '1ONE CLI', source: 'generated', backend: 'dream' },
      { id: 'selected', name: 'Editor', source: 'user', backend: 'dream' },
    ]);
    bridge.create.mockResolvedValue({ id: 'team-1' });
    await expect(
      createCollaborationTeam({ name: 'Job', workspace: '/work', model: 'model', assistantId: 'selected' })
    ).resolves.toBe('team-1');
    expect(bridge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: '/work',
        agents: [{ role: 'leader', assistant_id: 'selected', assistant_name: 'Editor', model: 'model' }],
      })
    );
  });

  it('gives the leader permission to staff the team and asks for a verified final response', () => {
    const input = collaborationLeaderInput('Summarize the findings');
    expect(input).toMatch(/^Summarize the findings\n\n\[SYSTEM NOTE:/);
    expect(input).toContain('dispatch them in parallel before waiting');
    expect(input).toContain('wait for teammate results');
  });
});
