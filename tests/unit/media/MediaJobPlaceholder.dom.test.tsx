/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MediaGenParams } from '@/common/media/types';

// Echo the interpolated `time` so the elapsed assertion can check the value,
// not merely that the key rendered.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { time?: string }) => (opts?.time ? `${key}:${opts.time}` : key),
  }),
}));

const MediaJobPlaceholder = (await import('@/renderer/components/media/MediaJobPlaceholder')).default;

const tiles = (container: HTMLElement) => container.querySelectorAll('[data-ratio]');

describe('MediaJobPlaceholder', () => {
  afterEach(cleanup);

  it('falls back to a widescreen box for a video with no ratio params', () => {
    const { container } = render(<MediaJobPlaceholder kind='video' startedAt={0} />);
    expect(tiles(container)[0].getAttribute('data-ratio')).toBe('16/9');
  });

  it('falls back to a square for an image with no ratio params', () => {
    const { container } = render(<MediaJobPlaceholder kind='image' startedAt={0} />);
    expect(tiles(container)[0].getAttribute('data-ratio')).toBe('1/1');
  });

  it('honors an explicit aspect ratio', () => {
    const { container } = render(
      <MediaJobPlaceholder kind='image' params={{ aspectRatio: '3:2' } as MediaGenParams} startedAt={0} />
    );
    expect(tiles(container)[0].getAttribute('data-ratio')).toBe('3/2');
  });

  it('derives and reduces the ratio from an explicit size', () => {
    const { container } = render(
      <MediaJobPlaceholder kind='image' params={{ size: '1024x1024' } as MediaGenParams} startedAt={0} />
    );
    expect(tiles(container)[0].getAttribute('data-ratio')).toBe('1/1');
  });

  it('renders one tile per requested image, capped at four', () => {
    const { container } = render(
      <MediaJobPlaceholder kind='image' params={{ n: 6 } as MediaGenParams} startedAt={0} />
    );
    expect(tiles(container)).toHaveLength(4);
  });

  it('shows the stage label instead of the generic hint when one is given', () => {
    render(<MediaJobPlaceholder kind='video' stageLabel='服务端排队中' startedAt={0} />);
    expect(screen.getByText('服务端排队中')).toBeTruthy();
    expect(screen.queryByText('conversation.mediaJobGeneratingHint')).toBeNull();
  });

  it('shows a running elapsed clock', () => {
    render(<MediaJobPlaceholder kind='video' startedAt={Date.now() - 45_000} />);
    // formatElapsed(45s) -> "0:45"
    expect(screen.getByText('conversation.mediaJobElapsed:0:45')).toBeTruthy();
  });
});
