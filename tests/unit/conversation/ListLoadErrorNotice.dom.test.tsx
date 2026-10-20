/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import ListLoadErrorNotice from '@/renderer/pages/conversation/GroupedHistory/ListLoadErrorNotice';

describe('ListLoadErrorNotice', () => {
  it('offers a retry for an ordinary failure', () => {
    const onRetry = vi.fn();
    render(<ListLoadErrorNotice error={{ code: null, message: 'Failed to fetch' }} onRetry={onRetry} />);
    expect(screen.getByText('conversation.history.loadFailed')).toBeTruthy();
    fireEvent.click(screen.getByText('common.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says the data file is damaged, and does not invite a pointless retry', () => {
    render(<ListLoadErrorNotice error={{ code: 'DATABASE_CORRUPT', message: 'x' }} onRetry={vi.fn()} />);
    expect(screen.getByText('conversation.history.databaseCorrupt')).toBeTruthy();
    expect(screen.getByText('conversation.history.databaseCorruptHint')).toBeTruthy();
    expect(screen.queryByText('common.retry')).toBeNull();
  });
});
