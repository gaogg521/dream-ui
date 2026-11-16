import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@arco-design/web-react', () => ({
  Spin: () => <span data-testid='spinner' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

import MessageRunningIndicator from '@/renderer/pages/conversation/Messages/components/MessageRunningIndicator';
import {
  beginConversationTurn,
  resetConversationTurnClockForTests,
} from '@/renderer/pages/conversation/utils/conversationTurnClock';

const FIXED_NOW = 1_700_000_000_000;

describe('MessageRunningIndicator', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetConversationTurnClockForTests();
  });

  it('shows a spinner, the working label and the elapsed time of the recorded turn', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    beginConversationTurn('c1', FIXED_NOW - 80_000);

    render(<MessageRunningIndicator conversationId='c1' rowWidthClass='w-full' />);

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByText('1m 20s')).toBeInTheDocument();
    expect(screen.getByText('conversation.process.working')).toBeInTheDocument();
  });

  it('advances every second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    beginConversationTurn('c1', FIXED_NOW - 2_000);

    render(<MessageRunningIndicator conversationId='c1' rowWidthClass='w-full' />);
    expect(screen.getByText('2s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByText('5s')).toBeInTheDocument();
  });

  it('falls back to its own mount time when the turn was never recorded', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    render(<MessageRunningIndicator conversationId='unrecorded' rowWidthClass='w-full' />);
    expect(screen.getByText('0s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    expect(screen.getByText('4s')).toBeInTheDocument();
  });
});
