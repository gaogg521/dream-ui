/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MediaJobView } from '@/common/media/jobView';

// Interpolated values are echoed so a cost assertion can check the amount and
// not merely that some cost key rendered.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { amount?: string }) => (opts?.amount ? `${key}:${opts.amount}` : key),
  }),
}));

const providerList = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: providerList.value }),
}));

const MediaJobCard = (await import('@/renderer/components/media/MediaJobCard')).default;

const videoAsset = {
  kind: 'video' as const,
  filePath: 'D:\\ws\\out.mp4',
  relativePath: 'out.mp4',
  mimeType: 'video/mp4',
  durationSeconds: 5,
};

// The card now calls useNavigate() (for the "open model settings" deep link
// on a notRouted failure), which throws outside a Router context.
const renderCard = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const job = (over: Partial<MediaJobView> = {}): MediaJobView => ({
  jobId: 'mj-1',
  kind: 'video',
  status: 'failed',
  model: 'seedance-2-0-fast',
  origin: { workspaceDir: 'D:\\ws' },
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

describe('MediaJobCard', () => {
  afterEach(cleanup);

  // Two attempts on the same model used to render as identical cards, because
  // the only thing distinguishing them — what was asked for — was never shown.
  it('shows the prompt that produced the job', () => {
    renderCard(<MediaJobCard job={job({ prompt: 'a red bicycle at dusk' })} />);
    expect(screen.getByText('a red bicycle at dusk')).toBeTruthy();
  });

  it('renders without a prompt on jobs that predate the field', () => {
    const { container } = renderCard(<MediaJobCard job={job({ prompt: undefined })} />);
    expect(container.textContent).toContain('seedance-2-0-fast');
  });

  // The upstream text arrives in whatever language the provider speaks.
  // Labelling it as theirs is honest; showing it bare reads as untranslated
  // interface copy, which is how it looked to the user who reported it.
  it('attributes an upstream error instead of presenting it as our own copy', () => {
    renderCard(<MediaJobCard job={job({ error: 'Ark task submission failed: empty body' })} />);
    expect(screen.getByText('conversation.mediaJobErrorFromProvider')).toBeTruthy();
    expect(screen.getByText('Ark task submission failed: empty body')).toBeTruthy();
  });

  // Spend was invisible from both ends. The company ledger recorded what each
  // generation cost; the person spending the money was never shown a figure.
  describe('cost', () => {
    afterEach(() => {
      providerList.value = [];
    });

    it('marks a figure derived from the built-in table as an estimate', () => {
      renderCard(<MediaJobCard job={job({ status: 'done', assets: [videoAsset] })} />);
      // seedance: $0.20/s × 5s. The ≈ is the whole point — it is our coarse
      // table talking, not the user's contract.
      expect(screen.getByTestId('media-cost').textContent).toBe('conversation.mediaCostActual:≈$1.00');
    });

    it("uses the user's declared price for that provider, with no estimate marker", () => {
      providerList.value = [{ id: 'p-1', model_settings: { 'seedance-2-0-fast': { media_unit_price_usd: 0.5 } } }];
      renderCard(<MediaJobCard job={job({ status: 'done', providerId: 'p-1', assets: [videoAsset] })} />);
      expect(screen.getByTestId('media-cost').textContent).toBe('conversation.mediaCostActual:$2.50');
    });

    // A price declared on a different provider must not be borrowed: the same
    // model name can sit on two providers at two prices.
    it('does not borrow a price from another provider', () => {
      providerList.value = [{ id: 'other', model_settings: { 'seedance-2-0-fast': { media_unit_price_usd: 0.5 } } }];
      renderCard(<MediaJobCard job={job({ status: 'done', providerId: 'p-1', assets: [videoAsset] })} />);
      expect(screen.getByTestId('media-cost').textContent).toBe('conversation.mediaCostActual:≈$1.00');
    });

    // Saying a paid generation cost $0.00 is the one wrong answer to avoid.
    it('says the cost is unknown when nothing prices the model', () => {
      renderCard(<MediaJobCard job={job({ status: 'done', model: 'mystery-model-1', assets: [{ ...videoAsset }] })} />);
      expect(screen.getByTestId('media-cost').textContent).toBe('conversation.mediaCostUnknown');
    });

    it('shows no cost until the job has actually produced something', () => {
      renderCard(<MediaJobCard job={job({ status: 'polling' })} />);
      expect(screen.queryByTestId('media-cost')).toBeNull();
    });
  });

  // A failed card used to be the one card with no action at all: the only way
  // to retry was to retype the prompt into the send box.
  describe('failure', () => {
    it('offers a retry on a failed job, worded as a retry rather than another take', () => {
      renderCard(<MediaJobCard job={job({ status: 'failed', prompt: 'a red bicycle', error: 'timeout' })} />);
      expect(screen.getByTestId('media-action-regenerate').textContent).toContain('conversation.mediaResultRetry');
    });

    it('still words it as another take once the job succeeded', () => {
      renderCard(<MediaJobCard job={job({ status: 'done', prompt: 'a red bicycle', assets: [videoAsset] })} />);
      expect(screen.getByTestId('media-action-regenerate').textContent).toContain('conversation.mediaResultRegenerate');
    });

    it('says what to do about a failure it recognizes', () => {
      renderCard(
        <MediaJobCard job={job({ status: 'failed', prompt: 'x', error: 'HTTP 429 — rate limit exceeded' })} />
      );
      expect(screen.getByTestId('media-failure-advice').textContent).toBe('conversation.mediaFailureAdvice_rateLimit');
    });

    it('offers no advice at all for a failure it does not recognize', () => {
      renderCard(<MediaJobCard job={job({ status: 'failed', prompt: 'x', error: 'ECONNRESET' })} />);
      expect(screen.queryByTestId('media-failure-advice')).toBeNull();
    });

    // A job that produced nothing has nothing to price; "cost unknown" there
    // would be noise on a card that already says it failed.
    it('prices nothing on a job that produced nothing', () => {
      renderCard(<MediaJobCard job={job({ status: 'failed', prompt: 'x', error: 'timeout' })} />);
      expect(screen.queryByTestId('media-cost')).toBeNull();
    });

    // Retrying a `notRouted` failure fails again identically — the model's
    // `media_endpoint` is what needs to change, and only Settings can change
    // it, so this is the one failure class that earns a direct jump there.
    it('offers to open model settings only for a notRouted failure with a known provider', () => {
      renderCard(
        <MediaJobCard
          job={job({ status: 'failed', prompt: 'x', error: '404 status code (no body)', providerId: 'p-1' })}
        />
      );
      expect(screen.getByTestId('media-open-model-settings')).toBeTruthy();
    });

    it('does not offer to open model settings for an unrelated failure', () => {
      renderCard(<MediaJobCard job={job({ status: 'failed', prompt: 'x', error: 'timeout', providerId: 'p-1' })} />);
      expect(screen.queryByTestId('media-open-model-settings')).toBeNull();
    });

    it('does not offer to open model settings when the job has no providerId to target', () => {
      renderCard(<MediaJobCard job={job({ status: 'failed', prompt: 'x', error: '404 status code (no body)' })} />);
      expect(screen.queryByTestId('media-open-model-settings')).toBeNull();
    });
  });

  it('offers cancel only while the job can still be stopped', () => {
    const onCancel = vi.fn();
    const { rerender } = renderCard(<MediaJobCard job={job({ status: 'polling' })} onCancel={onCancel} />);
    expect(screen.queryByText('common.cancel')).toBeTruthy();

    rerender(
      <MemoryRouter>
        <MediaJobCard job={job({ status: 'done' })} onCancel={onCancel} />
      </MemoryRouter>
    );
    expect(screen.queryByText('common.cancel')).toBeNull();
  });
});
