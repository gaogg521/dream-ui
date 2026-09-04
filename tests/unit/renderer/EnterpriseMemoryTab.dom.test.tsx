/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Message } from '@arco-design/web-react';
import EnterpriseMemoryTab from '@/renderer/pages/memory/EnterpriseMemoryTab';
import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: vi.fn(),
  isBackendHttpError: (error: unknown): error is Error =>
    error instanceof Error && (error as Error & { __backend?: boolean }).__backend === true,
}));

// The i18next mock falls back to the key itself — assertions match on keys,
// which is how the existing DOM tests keep locale files out of scope. `t`
// must be a module-level stable reference: the tab's data loaders are
// useCallback'd with `t` in their dependency arrays, and an unstable `t`
// would re-run those effects on every render.
const stableT = (key: string) => key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

function backendError(status: number, code: string): Error {
  const error = new Error(code) as Error & { __backend?: boolean; status: number; body: unknown };
  error.__backend = true;
  error.status = status;
  error.body = { success: false, error: code, code };
  return error;
}

const mockedHttp = vi.mocked(httpRequest);

function mockHttpResponse(value: unknown) {
  mockedHttp.mockResolvedValueOnce(value);
}

beforeEach(() => {
  mockedHttp.mockReset();
  // preferences, collections — the tab's two mount calls.
  mockHttpResponse({ recallEnabled: true });
  mockHttpResponse([{ id: 'memc-1', scope: 'personal', name: 'my notes' }]);
  // Arco Message portals into document.body via a legacy ReactDOM.render that
  // jsdom + React 19 reject; the toasts carry no assertions here.
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
});

describe('EnterpriseMemoryTab', () => {
  it('lists collections and their items once mounted', async () => {
    // beforeEach already queued the preferences and collections responses;
    // only the items response needs a handler here.
    mockedHttp.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/items')) return [{ id: 'memi-1', collectionId: 'memc-1', content: 'a kept note', status: 'active', createdAt: 0 }];
      return [];
    });

    render(<EnterpriseMemoryTab />);

    await waitFor(() => expect(screen.getByText('a kept note')).toBeTruthy());
  });

  it('shows the join-empty state instead of an error when the backend answers NOT_IN_ENTERPRISE', async () => {
    mockedHttp.mockReset();
    mockedHttp.mockRejectedValueOnce(backendError(400, 'NOT_IN_ENTERPRISE'));

    render(<EnterpriseMemoryTab />);

    await waitFor(() => expect(screen.getByText('memory.entNotInEnterprise')).toBeTruthy());
  });

  it('the recall switch persists an opt-out through PUT preferences', async () => {
    render(<EnterpriseMemoryTab />);
    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());

    mockHttpResponse({ recallEnabled: false });
    await userEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mockedHttp).toHaveBeenCalledWith('PUT', '/api/one/memory/preferences', { recallEnabled: false })
    );
  });

  it('deleting an item issues DELETE against the item path and drops the row', async () => {
    mockedHttp.mockImplementation(async (method: string, path: string) => {
      if (method === 'DELETE') return undefined;
      if (method === 'GET' && path.includes('/items'))
        return [{ id: 'memi-1', collectionId: 'memc-1', content: 'a kept note', status: 'active', createdAt: 0 }];
      return [];
    });

    render(<EnterpriseMemoryTab />);
    await waitFor(() => expect(screen.getByText('a kept note')).toBeTruthy());

    const deleteButtons = screen.getAllByText('memory.remove');
    mockHttpResponse(undefined);
    await userEvent.click(deleteButtons[0]);

    await waitFor(() =>
      expect(mockedHttp).toHaveBeenCalledWith('DELETE', '/api/one/memory/collections/memc-1/items/memi-1')
    );
    await waitFor(() => expect(screen.queryByText('a kept note')).toBeNull());
  });
});
