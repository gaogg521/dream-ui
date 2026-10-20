import { describe, expect, it } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { splitBackendPills } from '@/renderer/pages/guid/utils/backendPills';

const cli = (n: number, status: Assistant['agent_status'] = 'online'): Assistant =>
  ({
    id: `bare:cli-${n}`,
    source: 'generated',
    name: `Cli ${n}`,
    enabled: true,
    sort_order: n,
    agent_id: `agent-${n}`,
    agent: { type: 'acp', source: 'builtin', acp_backend: `cli${n}` },
    agent_status: status,
  }) as unknown as Assistant;

const ids = (list: Assistant[]) => list.map((a) => a.agent_id);

describe('splitBackendPills', () => {
  it('shows at most five and puts the rest behind "more"', () => {
    const { visible, overflow } = splitBackendPills(
      [1, 2, 3, 4, 5, 6, 7].map((n) => cli(n)),
      [],
      null
    );
    expect(ids(visible)).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5']);
    expect(ids(overflow)).toEqual(['agent-6', 'agent-7']);
  });

  it('follows the order the person set, not the built-in order', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) => cli(n));
    const { visible } = splitBackendPills(list, ['bare:cli-7', 'bare:cli-6'], null);
    expect(ids(visible).slice(0, 2)).toEqual(['agent-7', 'agent-6']);
  });

  it('keeps backends that cannot run right now out of the visible pills', () => {
    const list = [cli(1, 'offline'), cli(2), cli(3, 'offline'), cli(4), cli(5), cli(6), cli(7)];
    const { visible, overflow } = splitBackendPills(list, [], null);
    expect(ids(visible)).toEqual(['agent-2', 'agent-4', 'agent-5', 'agent-6', 'agent-7']);
    expect(ids(overflow)).toEqual(['agent-1', 'agent-3']);
  });

  it('never hides the selected backend', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) => cli(n));
    const { visible, overflow } = splitBackendPills(list, [], 'agent-7');
    expect(ids(visible)).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-7']);
    expect(ids(overflow)).toEqual(['agent-5', 'agent-6']);
  });

  it('has no overflow when there are five or fewer', () => {
    const { visible, overflow } = splitBackendPills(
      [1, 2, 3].map((n) => cli(n)),
      [],
      null
    );
    expect(visible).toHaveLength(3);
    expect(overflow).toHaveLength(0);
  });
});
