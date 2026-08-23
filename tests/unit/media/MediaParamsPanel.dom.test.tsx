/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MediaModelSpec } from '@/common/media/catalog/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const MediaParamsPanel = (await import('@/renderer/components/media/MediaParamsPanel')).default;

const spec = (params: MediaModelSpec['params']): MediaModelSpec => ({
  id: 's',
  kind: 'video',
  form: 'C',
  match: { model: 'm' },
  params,
});

describe('MediaParamsPanel', () => {
  afterEach(cleanup);

  // The point of deriving the panel from the spec: a model that only does 5s
  // must not offer 10s, or the user picks a value the adapter will reject.
  it('offers only the durations the model declares', () => {
    // Durations render with their unit ("5s"): under a 时长 heading a bare "5"
    // reads as a count, and it collides with the generation-count row.
    render(<MediaParamsPanel spec={spec({ durations: [5] })} value={{}} onChange={() => {}} />);
    expect(screen.getByText('5s')).toBeTruthy();
    expect(screen.queryByText('10s')).toBeNull();
  });

  it('hides sections the model does not declare', () => {
    render(<MediaParamsPanel spec={spec({ durations: [5] })} value={{}} onChange={() => {}} />);
    expect(screen.queryByText('conversation.mediaParamCamera')).toBeNull();
    expect(screen.queryByText('conversation.mediaParamResolution')).toBeNull();
  });

  it('reports a pick through onChange', () => {
    const onChange = vi.fn();
    render(<MediaParamsPanel spec={spec({ resolutions: ['720p', '1080p'] })} value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByText('1080p'));
    expect(onChange).toHaveBeenCalledWith({ resolution: '1080p' });
  });

  // Clicking the active choice clears it, so the model's own default can be
  // restored without a separate reset control.
  it('clears a value when the active choice is clicked again', () => {
    const onChange = vi.fn();
    render(
      <MediaParamsPanel spec={spec({ resolutions: ['720p'] })} value={{ resolution: '720p' }} onChange={onChange} />
    );
    fireEvent.click(screen.getByText('720p'));
    expect(onChange).toHaveBeenCalledWith({ resolution: undefined });
  });

  it('only offers a count when the model can produce more than one', () => {
    const { rerender } = render(<MediaParamsPanel spec={spec({ maxN: 1 })} value={{}} onChange={() => {}} />);
    expect(screen.queryByText('conversation.mediaParamCount')).toBeNull();

    rerender(<MediaParamsPanel spec={spec({ maxN: 4 })} value={{}} onChange={() => {}} />);
    expect(screen.getByText('conversation.mediaParamCount')).toBeTruthy();
  });

  /**
   * An image model whose endpoint returns one at a time still gets the count:
   * several images come from several requests, so `maxN: 1` describes the
   * response, not the limit on what may be asked for. Ark's Seedream is exactly
   * this case, and the control used to be hidden for it.
   */
  it('still offers a count for an image model that returns one per request', () => {
    const oneAtATime: MediaModelSpec = {
      id: 's',
      kind: 'image',
      form: 'A',
      match: { model: 'm' },
      params: { maxN: 1 },
    };
    render(<MediaParamsPanel spec={oneAtATime} value={{}} onChange={() => {}} />);
    expect(screen.getByText('conversation.mediaParamCount')).toBeTruthy();
  });

  // Behaviour changed deliberately: with neither a spec nor a model there is no
  // model to describe, so the panel now says that instead of blaming an absent
  // model for having no parameters. The no-parameters wording still applies
  // when a model IS selected — see the empty-state suite below.
  it('points at the missing model when neither a spec nor a model is resolved', () => {
    render(<MediaParamsPanel spec={null} value={{}} onChange={() => {}} />);
    expect(screen.getByTestId('media-params-no-model')).toBeTruthy();
  });
});

/**
 * The two ways this panel can have nothing to show look identical from inside
 * (`spec` is null either way) but mean opposite things, and a new user only
 * ever lands in the first one.
 */
describe('MediaParamsPanel empty states', () => {
  afterEach(cleanup);

  it('tells a user with no media model what is missing, not that the model has no parameters', () => {
    render(<MediaParamsPanel spec={null} value={{}} onChange={() => {}} kind='image' />);

    expect(screen.getByTestId('media-params-no-model')).toBeTruthy();
    expect(screen.getByText('conversation.mediaNoImageModelTitle')).toBeTruthy();
    // The dead-end wording must NOT appear here — that is the whole point.
    expect(screen.queryByText('conversation.mediaParamsUnavailable')).toBeNull();
  });

  it('names the video model when the composer is in video mode', () => {
    render(<MediaParamsPanel spec={null} value={{}} onChange={() => {}} kind='video' />);

    expect(screen.getByText('conversation.mediaNoVideoModelTitle')).toBeTruthy();
    expect(screen.queryByText('conversation.mediaNoImageModelTitle')).toBeNull();
  });

  it('offers a way out of the empty state', () => {
    const onConfigureModel = vi.fn();
    render(
      <MediaParamsPanel spec={null} value={{}} onChange={() => {}} kind='image' onConfigureModel={onConfigureModel} />
    );

    fireEvent.click(screen.getByText('conversation.mediaNoModelAction'));
    expect(onConfigureModel).toHaveBeenCalledTimes(1);
  });

  // A model that genuinely exposes nothing adjustable is a different situation,
  // and the original message is the right one for it.
  it('keeps the no-parameters wording when a model is selected but uncatalogued', () => {
    render(<MediaParamsPanel spec={null} value={{}} onChange={() => {}} kind='image' model='some-model' />);

    expect(screen.getByText('conversation.mediaParamsUnavailable')).toBeTruthy();
    expect(screen.queryByTestId('media-params-no-model')).toBeNull();
  });
});
