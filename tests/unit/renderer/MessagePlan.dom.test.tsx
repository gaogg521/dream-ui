import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TaskChecklist } from '@/renderer/pages/conversation/Messages/components/MessagePlan';
import { backgroundTaskTitle } from '@/common/chat/backgroundCollaboration';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('recovers readable titles from older background tasks', () => {
  expect(backgroundTaskTitle('desktop-startup', '核对桌面端启动流程。\n只检查启动入口。')).toBe('核对桌面端启动流程');
  expect(backgroundTaskTitle('核对记忆召回逻辑', '其他内容')).toBe('核对记忆召回逻辑');
  expect(backgroundTaskTitle('memory-recall', undefined)).toBeUndefined();
  expect(backgroundTaskTitle('Read desktop files', 'Read ONLY these two files.', 'zh-CN')).toBeUndefined();
  expect(backgroundTaskTitle('desktop-startup', '核对桌面端启动流程\nRead these files.', 'zh-CN')).toBe(
    '核对桌面端启动流程'
  );
});

it('prioritizes active tasks and caps the expanded checklist at ten while counting the full list', () => {
  render(
    <TaskChecklist
      entries={[
        { content: 'Completed task', status: 'completed' },
        ...Array.from({ length: 10 }, (_, i) => ({ content: `Pending task ${i + 1}`, status: 'pending' as const })),
        { content: 'Active task', status: 'in_progress' },
      ]}
    />
  );
  const toggle = screen.getByRole('button', { name: /messages.taskPlan/ });
  expect(toggle).toHaveTextContent('1 / 12');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Active task');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
  expect(toggle).toHaveTextContent('1 / 12');
});

it('keeps team tasks behind the composer progress button until opened', async () => {
  render(<TaskChecklist compact entries={[{ content: 'Draft summary', status: 'in_progress' }]} />);
  const trigger = screen.getByRole('button', { name: /messages.taskPlan/ });
  expect(trigger).toHaveTextContent('0 / 1');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Draft summary')).not.toBeInTheDocument();
  fireEvent.click(trigger);
  expect(await screen.findByText('Draft summary')).toBeVisible();
  expect(screen.getByRole('listitem')).toHaveTextContent('1.');
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
});
