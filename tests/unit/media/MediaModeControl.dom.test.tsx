/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The half of cost visibility that happens before the money is spent.
 *
 * A figure that only appears afterwards answers the wrong question. What
 * matters here is that the number tracks the parameters as they are chosen —
 * asking for four images costs four times as much, and that has to be visible
 * at the moment the four is picked.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MediaGenParams } from '@/common/media/types';

// The control navigates to model settings from its "no media model yet" empty
// state. Rendered standalone here, there is no Router above it, so navigation
// is stubbed rather than wrapping every case in a MemoryRouter.
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { amount?: string }) => (opts?.amount ? `${key}:${opts.amount}` : key),
  }),
}));

const providerList = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: providerList.value }),
}));

/**
 * Cost display is opt-in (`tools.showMediaCost`, default off), so every case
 * that asserts a figure has to turn it on. The default-off behaviour gets its
 * own case rather than being the implicit background of the others.
 */
const showCost = vi.hoisted(() => ({ value: true }));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: (key: string) =>
    Promise.resolve(key === 'tools.showMediaCost' ? showCost.value : undefined),
  setClientBusinessSetting: () => Promise.resolve(),
}));

// SWR would resolve the preference a tick later than the first render, which is
// enough to make these synchronous assertions flaky. Reading it directly keeps
// the component's own gate under test without a timing dance.
vi.mock('swr', () => ({
  default: (_key: string, fetcher: () => Promise<unknown>) => {
    void fetcher;
    return { data: showCost.value };
  },
  mutate: () => Promise.resolve(),
}));

const highlighted = vi.hoisted(() => ({ value: [] as string[] }));
vi.mock('@renderer/hooks/media/mediaSettingsHighlight', () => ({
  requestModelSettingsHighlight: (id: string) => highlighted.value.push(id),
}));

const MediaModeControl = (await import('@/renderer/components/media/MediaModeControl')).default;

type Mode = 'off' | 'image' | 'video';

const renderControl = (over: { mode?: Mode; model?: string; providerId?: string; params?: MediaGenParams } = {}) =>
  render(
    <MediaModeControl
      mode={over.mode ?? 'image'}
      onModeChange={vi.fn()}
      model={over.model ?? 'gpt-image-2'}
      providerId={over.providerId}
      spec={null}
      params={over.params ?? {}}
      onParamsChange={vi.fn()}
    />
  );

/**
 * The collapsed trigger is what the user reads to know which mode the send box
 * is in, and once the row fills up the icon is the fastest part of it to read.
 */
describe('MediaModeControl mode icon', () => {
  afterEach(() => {
    cleanup();
    providerList.value = [];
  });

  /**
   * The icon was picked by `video ? VideoTwo : Picture`, so `off` fell into the
   * `image` branch: chat mode sat there wearing the picture icon, identical to
   * the "image generation" entry it exists to contrast with.
   *
   * Compared as "all three differ" rather than against specific icon names —
   * the contract is that the modes are distinguishable, not which glyph each
   * one happens to use.
   */
  it('gives each of the three modes its own icon', () => {
    const iconOf = (mode: Mode) => {
      const { container, unmount } = renderControl({ mode });
      const svg = container.querySelector('[data-testid="media-mode-pill"] svg');
      const markup = svg?.innerHTML ?? '';
      unmount();
      return markup;
    };

    const icons = [iconOf('off'), iconOf('image'), iconOf('video')];
    expect(icons.every((markup) => markup !== '')).toBe(true);
    expect(new Set(icons).size).toBe(3);
  });
});

describe('MediaModeControl cost estimate', () => {
  afterEach(() => {
    cleanup();
    providerList.value = [];
    showCost.value = true;
    highlighted.value = [];
  });

  it('quotes the built-in rate as an estimate before sending', () => {
    renderControl();
    expect(screen.getByTestId('media-cost-estimate').textContent).toBe('conversation.mediaCostEstimate:≈$0.04');
  });

  it('tracks the requested count, so four images read as four times the price', () => {
    renderControl({ params: { n: 4 } });
    expect(screen.getByTestId('media-cost-estimate').textContent).toBe('conversation.mediaCostEstimate:≈$0.16');
  });

  it('tracks video duration, which is what actually drives that bill', () => {
    renderControl({ mode: 'video', model: 'sora-2', params: { durationSeconds: 10 } });
    expect(screen.getByTestId('media-cost-estimate').textContent).toBe('conversation.mediaCostEstimate:≈$5.00');
  });

  it('drops the estimate marker once the user has declared their own price', () => {
    providerList.value = [{ id: 'p-1', model_settings: { 'gpt-image-2': { media_unit_price_usd: 0.02 } } }];
    renderControl({ providerId: 'p-1', params: { n: 3 } });
    expect(screen.getByTestId('media-cost-estimate').textContent).toBe('conversation.mediaCostEstimate:$0.06');
  });

  it('says so rather than quoting zero for a model nothing prices', () => {
    renderControl({ model: 'mystery-model-1' });
    expect(screen.getByTestId('media-cost-estimate').textContent).toBe('conversation.mediaCostUnknown');
  });

  it('shows no cost while the send box is in conversation mode', () => {
    renderControl({ mode: 'off' });
    expect(screen.queryByTestId('media-cost-estimate')).toBeNull();
  });

  /**
   * Price is a minority interest: what most people want from a running
   * conversation is context left, tokens spent and cache hits — so the figure
   * is not shown until asked for.
   */
  it('shows nothing at all until the user opts in', () => {
    showCost.value = false;
    renderControl({ params: { n: 4 } });
    expect(screen.queryByTestId('media-cost-estimate')).toBeNull();
  });

  /**
   * The tooltip has always said "set a unit price in Settings > Models", but
   * that field is behind several clicks and only appears after the model is
   * declared as image/video. Naming a destination is not the same as offering
   * it, so the chip itself is the way there.
   */
  it('jumps to the model settings row when a price would sharpen the figure', () => {
    renderControl({ providerId: 'p-1' });
    const chip = screen.getByTestId('media-cost-estimate');
    expect(chip.getAttribute('role')).toBe('button');
    chip.click();
    expect(highlighted.value).toEqual(['p-1']);
  });

  it('is inert once the figure is already exact', () => {
    providerList.value = [{ id: 'p-1', model_settings: { 'gpt-image-2': { media_unit_price_usd: 0.02 } } }];
    renderControl({ providerId: 'p-1' });
    // Nothing to improve, so no affordance offering to improve it.
    expect(screen.getByTestId('media-cost-estimate').getAttribute('role')).toBeNull();
  });
});
