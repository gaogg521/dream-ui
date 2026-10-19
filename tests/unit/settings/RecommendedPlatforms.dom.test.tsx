/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => (vars?.name ? `${key}:${vars.name}` : key),
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock('@renderer/components/base/DreamModal', () => ({
  default: ({
    visible,
    children,
    header,
  }: {
    visible: boolean;
    children: React.ReactNode;
    header?: { title?: React.ReactNode };
  }) =>
    visible ? (
      <div role='dialog'>
        <h2>{header?.title}</h2>
        {children}
      </div>
    ) : null,
}));

vi.mock('@icon-park/react', () => ({
  Link: () => <span aria-hidden='true'>link</span>,
  Right: () => <span aria-hidden='true'>right</span>,
}));

import RecommendedPlatforms from '@/renderer/pages/settings/components/recommendedPlatforms/RecommendedPlatforms';
import { RECOMMENDED_PLATFORMS } from '@/renderer/pages/settings/components/recommendedPlatforms/constants';

describe('RecommendedPlatforms', () => {
  beforeEach(() => {
    mocks.openExternalUrl.mockReset();
    mocks.openExternalUrl.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('lists Zhipu, DeepSeek, Xiaomi MiMo and Baoyun, in that order', () => {
    expect(RECOMMENDED_PLATFORMS.map((platform) => platform.id)).toEqual(['zhipu', 'deepseek', 'mimo', 'baoyun']);

    render(<RecommendedPlatforms />);

    for (const platform of RECOMMENDED_PLATFORMS) {
      expect(screen.getByText(`settings.recommendedPlatforms.${platform.id}.name`)).toBeTruthy();
    }
  });

  it('opens the vendor official site when a logo tile is clicked', () => {
    render(<RecommendedPlatforms />);

    for (const platform of RECOMMENDED_PLATFORMS) {
      fireEvent.click(
        screen.getByRole('button', {
          name: `settings.recommendedPlatforms.openSite:settings.recommendedPlatforms.${platform.id}.name`,
        })
      );
      expect(mocks.openExternalUrl).toHaveBeenLastCalledWith(platform.url);
    }
    expect(mocks.openExternalUrl).toHaveBeenCalledTimes(RECOMMENDED_PLATFORMS.length);
  });

  it('only sends users to https official sites', () => {
    for (const platform of RECOMMENDED_PLATFORMS) {
      expect(new URL(platform.url).protocol).toBe('https:');
    }
  });

  it('keeps the setup guide closed until its link is clicked, then shows every platform', () => {
    render(<RecommendedPlatforms />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /settings\.recommendedPlatforms\.guideLink/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('settings.recommendedPlatforms.guideTitle');
    for (const platform of RECOMMENDED_PLATFORMS) {
      expect(dialog.textContent).toContain(`settings.recommendedPlatforms.${platform.id}.price`);
    }
    // Baoyun is the one vendor whose endpoint is shown for copy-paste.
    expect(dialog.textContent).toContain('https://ai-api.baoyun.com/v1');
  });
});
