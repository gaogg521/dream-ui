import React from 'react';
/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * The trial balance on a provider row is a menu button (top up / check
 * usage). Its first version wrapped a bare IconPark icon in an Arco Tooltip;
 * hovering it blanked the whole app, because under React 19 Arco's Trigger
 * cannot find a DOM node for a child that doesn't forward its ref and throws
 * inside a layout effect. These tests pin that interacting with the control
 * leaves the tree mounted, and that each menu item does what it says.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { amount?: string }) => (opts?.amount ? `${k}:${opts.amount}` : k),
    i18n: { language: 'en' },
  }),
}));

const quota = vi.hoisted(() => ({
  data: {
    kind: 'issued' as const,
    vendor: 'baoyun' as const,
    data: { remaining_usd: 16, exhausted: false, currency: 'CNY' },
  } as unknown,
}));

vi.mock('@renderer/hooks/agent/useTrialQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/hooks/agent/useTrialQuota')>();
  return { ...actual, useTrialQuota: () => ({ data: quota.data }) };
});

const openExternalUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl }));

vi.mock('@/renderer/pages/settings/components/TrialTopUpModal', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid='top-up-modal-open' /> : null),
}));

import TrialQuotaBadge from '@/renderer/pages/settings/components/TrialQuotaBadge';

// The crash never reaches the test body on its own. React 19 reports a
// layout-effect error as a window `error` event, and Arco positions its popup
// from a requestAnimationFrame callback (the shared DOM setup runs rAF on a
// timer) — which fires after the test has already passed and shows up only
// as an "unhandled error". So timers are faked and drained inside the test:
// fake timers rethrow a callback's exception to whoever ran them.
let uncaught: unknown[] = [];
const onWindowError = (e: ErrorEvent) => {
  uncaught.push(e.error ?? e.message);
  e.preventDefault();
};

beforeEach(() => {
  uncaught = [];
  window.addEventListener('error', onWindowError);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.removeEventListener('error', onWindowError);
  cleanup();
  openExternalUrl.mockClear();
  expect(uncaught.map(String)).toEqual([]);
});

/** Runs pending frames (Arco's popup positioning) here, so a crash in them fails the test. */
const flushFrames = () =>
  act(() => {
    vi.runOnlyPendingTimers();
  });

function openMenu() {
  const trigger = screen.getByTestId('trial-quota-menu-trigger');
  act(() => {
    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);
  });
  flushFrames();
  flushFrames();
  expect(screen.getByTestId('trial-quota-menu-query-usage')).toBeTruthy();
  // The blank-screen bug unmounted the whole tree, trigger included.
  expect(screen.getByTestId('trial-quota-menu-trigger')).toBeTruthy();
}

describe('TrialQuotaBadge', () => {
  it('shows the remaining balance on a single menu button', () => {
    render(<TrialQuotaBadge vendor='baoyun' />);
    expect(screen.getByTestId('trial-quota-menu-trigger').textContent).toContain(
      'settings.meteredQuota.remaining:¥16.00'
    );
  });

  it('opens the menu without unmounting the app', () => {
    render(<TrialQuotaBadge vendor='baoyun' />);
    openMenu();
    expect(screen.getByTestId('trial-quota-menu-top-up')).toBeTruthy();
  });

  it('"check usage" opens the broker usage page in the browser', () => {
    render(<TrialQuotaBadge vendor='baoyun' />);
    openMenu();
    act(() => {
      fireEvent.click(screen.getByTestId('trial-quota-menu-query-usage'));
    });
    flushFrames();
    expect(openExternalUrl).toHaveBeenCalledWith('https://work.1oneclaw.com/trial-broker/usage');
  });

  it('"top up" opens the top-up modal', () => {
    render(<TrialQuotaBadge vendor='baoyun' />);
    openMenu();
    act(() => {
      fireEvent.click(screen.getByTestId('trial-quota-menu-top-up'));
    });
    flushFrames();
    expect(screen.getByTestId('top-up-modal-open')).toBeTruthy();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('keeps clicks inside the control from reaching the row header', () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <TrialQuotaBadge vendor='baoyun' />
      </div>
    );
    openMenu();
    act(() => {
      fireEvent.click(screen.getByTestId('trial-quota-menu-query-usage'));
    });
    flushFrames();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a vendor without top-up support gets a plain tag, no menu', () => {
    render(<TrialQuotaBadge vendor='openrouter' />);
    expect(screen.queryByTestId('trial-quota-menu-trigger')).toBeNull();
    expect(screen.getByText('settings.meteredQuota.remaining:¥16.00')).toBeTruthy();
  });
});
