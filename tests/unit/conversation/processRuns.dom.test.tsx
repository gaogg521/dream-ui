/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) =>
      options?.count !== undefined ? `${key}:${options.count}` : (options?.defaultValue ?? key),
  }),
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageThinking', () => ({
  default: ({ message }: { message: { id: string } }) => <div data-testid={`thinking-${message.id}`} />,
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  default: () => <div data-testid='tool-summary' />,
}));

import MessageProcessRun from '@/renderer/pages/conversation/Messages/components/MessageProcessRun';
import { foldProcessRuns, type ProcessRunItem } from '@/renderer/pages/conversation/Messages/processRuns';

const thinking = (id: string, status: 'thinking' | 'done' = 'done', subject?: string) =>
  ({ type: 'thinking', id, msg_id: id, created_at: 1000, content: { content: 'x', status, subject } }) as never;
const tools = (id: string, status: string, name = 'Write') =>
  ({
    type: 'tool_summary',
    id,
    sourceMessageIds: [id],
    created_at: 1000,
    messages: [{ type: 'tool_call', id, msg_id: id, content: { call_id: id, name, status, description: 'a.txt' } }],
  }) as never;
const text = (id: string) => ({ type: 'text', id, position: 'left', content: { content: 'hi' } }) as never;

describe('foldProcessRuns', () => {
  it('folds consecutive thoughts and tool groups into one run and leaves the texts alone', () => {
    const out = foldProcessRuns([text('a'), thinking('t1'), tools('s1', 'success'), thinking('t2'), text('b')]);
    expect(out.map((item: { type: string }) => item.type)).toEqual(['text', 'process_run', 'text']);
    const run = out[1] as ProcessRunItem;
    expect(run.steps).toHaveLength(3);
    expect(run.sourceMessageIds).toEqual(['t1', 's1', 't2']);
  });

  it('keeps a lone step as it was, and splits runs at anything that is not a step', () => {
    const out = foldProcessRuns([thinking('t1'), text('a'), thinking('t2'), tools('s1', 'success')]);
    expect(out.map((item: { type: string }) => item.type)).toEqual(['thinking', 'text', 'process_run']);
  });
});

describe('MessageProcessRun', () => {
  const run = (steps: unknown[]): ProcessRunItem => ({
    type: 'process_run',
    id: 'process-run-x',
    steps: steps as never,
    sourceMessageIds: [],
    created_at: Date.now(),
  });

  it('says how many steps it took once finished, and shows the steps only when opened', () => {
    render(<MessageProcessRun run={run([thinking('t1'), tools('s1', 'success'), thinking('t2')])} active={false} />);
    expect(screen.getByText('conversation.process.done:3')).toBeTruthy();
    expect(screen.queryByTestId('tool-summary')).toBeNull();
    fireEvent.click(screen.getByText('conversation.process.done:3'));
    expect(screen.getByTestId('tool-summary')).toBeTruthy();
    expect(screen.getByTestId('thinking-t1')).toBeTruthy();
  });

  it('names the tool that is running while the agent works', () => {
    render(<MessageProcessRun run={run([thinking('t1'), tools('s1', 'running', 'Write')])} active />);
    expect(screen.getByTestId('process-run').getAttribute('data-active')).toBe('true');
    expect(screen.getByText(/Write · a\.txt/)).toBeTruthy();
  });

  it('falls back to the open thought, then to a plain "working" line', () => {
    const { unmount } = render(
      <MessageProcessRun run={run([tools('s1', 'success'), thinking('t1', 'thinking', '读取需求')])} active />
    );
    expect(screen.getByText(/读取需求/)).toBeTruthy();
    unmount();
    render(<MessageProcessRun run={run([tools('s1', 'success'), thinking('t1')])} active />);
    expect(screen.getByText(/conversation\.process\.working/)).toBeTruthy();
  });
});
