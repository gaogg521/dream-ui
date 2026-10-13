/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), dialogProps: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog', () => ({
  default: (props: { visible: boolean; seed: unknown; onCreated?: () => void }) => {
    mocks.dialogProps(props);
    return props.visible ? (
      <button type='button' data-testid='dialog-created' onClick={() => props.onCreated?.()} />
    ) : null;
  },
}));

import TemplatesPage from '@/renderer/pages/cron/TemplatesPage';
import { AUTOMATION_TEMPLATES } from '@/renderer/pages/cron/templates/automationTemplates';

describe('automation templates page', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.dialogProps.mockClear();
  });

  it('lists every template once, grouped by category', () => {
    render(<TemplatesPage />);
    expect(document.querySelectorAll('[data-template]')).toHaveLength(AUTOMATION_TEMPLATES.length);
    for (const category of ['work', 'learning', 'life']) {
      expect(screen.getByText(`cron.templates.category.${category}`)).toBeInTheDocument();
    }
  });

  it('opens the create form pre-filled from the chosen template, then returns to the list once created', () => {
    render(<TemplatesPage />);
    fireEvent.click(document.querySelector('[data-template="weekly-report"]')!);

    const last = mocks.dialogProps.mock.calls.at(-1)![0] as { visible: boolean; seed: Record<string, unknown> };
    expect(last.visible).toBe(true);
    expect(last.seed).toMatchObject({
      name: '每周工作周报',
      schedule: { frequency: 'weekly', time: '17:00', weekday: 'FRI' },
    });
    expect(String(last.seed.prompt)).toContain('周报');

    fireEvent.click(screen.getByTestId('dialog-created'));
    expect(mocks.navigate).toHaveBeenCalledWith('/scheduled');
  });
});
