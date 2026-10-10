/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationCommandQueueItem } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const Button = ({
    children,
    ...props
  }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { status?: string }>) => (
    <button type='button' {...props}>
      {children}
    </button>
  );
  const Dropdown = ({ children, droplist }: React.PropsWithChildren<{ droplist: React.ReactNode }>) => (
    <div>
      {children}
      {droplist}
    </div>
  );
  const Menu = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  Menu.Item = ({
    children,
    onClick,
  }: React.PropsWithChildren<{
    onClick?: () => void;
  }>) => (
    <button type='button' onClick={onClick}>
      {children}
    </button>
  );
  const Typography = {
    Ellipsis: ({ children, ...props }: React.PropsWithChildren) => <span {...props}>{children}</span>,
  };
  const Tooltip = ({ children }: React.PropsWithChildren) => <>{children}</>;
  return { Button, Dropdown, Menu, Tooltip, Typography };
});

vi.mock('@icon-park/react', () => ({
  ArrowUp: () => <span data-testid='arrow-up-icon' />,
  CornerDownRight: () => <span data-testid='corner-down-right-icon' />,
  Delete: () => <span data-testid='delete-icon' />,
  Drag: () => <span data-testid='drag-icon' />,
  Edit: () => <span data-testid='edit-icon' />,
  Inbox: () => <span data-testid='inbox-icon' />,
  SortTwo: () => <span data-testid='sort-two-icon' />,
  MoreOne: () => <span data-testid='more-icon' />,
  SendOne: () => <span data-testid='send-icon' />,
}));

const item: ConversationCommandQueueItem = {
  id: 'queued-1',
  input: 'queued follow-up',
  files: [],
  created_at: 1,
};

const renderPanel = (overrides: Partial<React.ComponentProps<typeof CommandQueuePanel>> = {}) => {
  const props: React.ComponentProps<typeof CommandQueuePanel> = {
    items: [item],
    interactionLocked: false,
    onInteractionLock: vi.fn(),
    onInteractionUnlock: vi.fn(),
    onEdit: vi.fn(),
    onSendNow: vi.fn(),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };

  render(<CommandQueuePanel {...props} />);
  return props;
};

describe('CommandQueuePanel', () => {
  it('renders the three per-item actions: send now, edit, remove', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('wires send now, edit and remove callbacks per item', () => {
    const onSendNow = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    renderPanel({ onSendNow, onEdit, onRemove });

    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onSendNow).toHaveBeenCalledExactlyOnceWith(item);
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(item);
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('queued-1');
  });

  // Queued messages sit directly above the composer, one row each, the way
  // other agents show them: no title, counter, send-mode toggle or menu.
  it('renders only the queued rows, without a draft-box header or mode toggle', () => {
    renderPanel();

    expect(screen.getByText('queued follow-up')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Toggle send mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Draft box')).not.toBeInTheDocument();
  });

  it('labels send-now in the row instead of hiding it behind an icon', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'Send now' })).toHaveTextContent('Send now');
  });

  it('renders nothing when the queue is empty', () => {
    renderPanel({ items: [] });
    expect(document.querySelector('[data-command-queue="true"]')).toBeNull();
  });

  it('keeps long draft boxes internally scrollable instead of growing forever', () => {
    const manyItems = Array.from({ length: 24 }, (_, index) => ({
      ...item,
      id: `queued-${index}`,
      input: `queued follow-up ${index}`,
      created_at: index,
    }));

    renderPanel({ items: manyItems });

    const list = document.querySelector('[data-command-queue-list="true"]') as HTMLElement | null;
    expect(list).not.toBeNull();
    expect(list).toHaveStyle({ maxHeight: 'min(36vh, 320px)' });
    expect(list).toHaveClass('overflow-y-auto');
  });
});
