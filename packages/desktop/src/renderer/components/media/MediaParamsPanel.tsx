/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generation parameters, rendered from the selected model's declared
 * capabilities rather than a fixed form.
 *
 * The catalog already states what each model accepts (`MediaModelSpec.params`),
 * so the panel is derived from it: pick a model that only does 5s clips and 5s
 * is the only duration offered. A hand-written form would drift from the
 * adapters the moment a model's options changed, and offering a value the model
 * rejects is the same "selectable but not executable" failure the catalog layer
 * exists to prevent.
 *
 * Nothing is shown for a capability the model does not declare — an empty
 * section is more honest than a disabled control that hints at something the
 * model cannot do.
 *
 * Layout: one labelled section per capability, each a wrapped grid of equal
 * cells. The first version put every option on a single flex row, so a model
 * with eight sizes rendered as one long strip of tiny buttons that ran wider
 * than the send box.
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { MAX_IMAGE_FAN_OUT } from '@/common/media/executeMediaGeneration';
import type { MediaGenParams } from '@/common/media/types';
import type { MediaModelSpec } from '@/common/media/catalog/types';

type Props = {
  spec: MediaModelSpec | null;
  value: MediaGenParams;
  onChange: (next: MediaGenParams) => void;
  /**
   * Which mode the composer is in, so the empty state can name the thing the
   * user is missing ("image model" / "video model") instead of a generic one.
   */
  kind?: 'image' | 'video';
  /**
   * The model that will run, if any has been resolved.
   *
   * Distinguishing "no model at all" from "a model with nothing to adjust"
   * matters: they look identical here (`spec` is null either way) but mean
   * opposite things. A new user who has declared no media model lands in the
   * first case, and telling them "this model has no adjustable parameters"
   * is a dead end — there is no model. See the empty state below.
   */
  model?: string;
  /** Opens settings so the empty state can be acted on, not just read. */
  onConfigureModel?: () => void;
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className='flex flex-col gap-6px'>
    <span className='text-12px font-medium text-t-secondary'>{label}</span>
    {children}
  </div>
);

/**
 * One selectable value. Clicking the active one clears it, so a user can fall
 * back to the model's own default without hunting for a "reset".
 */
const Cell: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}> = ({ active, onClick, children, className = '' }) => (
  <div
    role='button'
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    }}
    className={`flex cursor-pointer select-none items-center justify-center rounded-6px border border-solid px-8px py-6px text-12px transition-colors ${
      active
        ? 'border-transparent bg-primary-light-1 text-primary font-medium'
        : 'b-color-border-2 bg-fill-1 text-t-primary hover:bg-fill-2'
    } ${className}`}
  >
    {children}
  </div>
);

/** `w:h` → a small proportional rectangle, so the shape is readable at a glance. */
const RatioGlyph: React.FC<{ ratio: string }> = ({ ratio }) => {
  const [w, h] = ratio.split(':').map((part) => Number(part.trim()));
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const box = 14;
  const width = w >= h ? box : Math.max(5, Math.round((box * w) / h));
  const height = w >= h ? Math.max(5, Math.round((box * h) / w)) : box;
  return (
    <span
      aria-hidden='true'
      className='inline-block shrink-0 rounded-2px border border-solid b-color-t-tertiary'
      style={{ width, height }}
    />
  );
};

const Grid: React.FC<{ cols: number; children: React.ReactNode }> = ({ cols, children }) => (
  <div className='grid gap-4px' style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
    {children}
  </div>
);

const MediaParamsPanel: React.FC<Props> = ({ spec, value, onChange, kind, model, onConfigureModel }) => {
  const { t } = useTranslation();

  // No model resolved at all — the state a new user lands in. Saying "this
  // model has no adjustable parameters" here is worse than saying nothing: it
  // implies a model is in play and that the absence of controls is normal, so
  // the user goes looking for the parameters rather than for the missing
  // model. Name what is missing and give the way to fix it.
  //
  // Guarded on `spec` too: a resolved spec means a model exists regardless of
  // what the caller passed, so this branch can never swallow a real panel.
  if (!spec && !model) {
    return (
      <div className='flex w-260px flex-col gap-8px' data-testid='media-params-no-model'>
        <span className='text-13px font-medium text-t-primary'>
          {kind === 'video' ? t('conversation.mediaNoVideoModelTitle') : t('conversation.mediaNoImageModelTitle')}
        </span>
        <span className='text-12px leading-18px text-t-secondary'>
          {kind === 'video' ? t('conversation.mediaNoVideoModelHint') : t('conversation.mediaNoImageModelHint')}
        </span>
        {onConfigureModel && (
          <Button type='primary' size='mini' className='self-start' onClick={onConfigureModel}>
            {t('conversation.mediaNoModelAction')}
          </Button>
        )}
      </div>
    );
  }

  if (!spec) {
    return <div className='text-12px text-t-secondary'>{t('conversation.mediaParamsUnavailable')}</div>;
  }

  const params = spec.params;
  const set = (patch: Partial<MediaGenParams>) => onChange({ ...value, ...patch });
  const toggle = <T,>(current: T | undefined, next: T): T | undefined => (current === next ? undefined : next);
  /**
   * How many images the user may ask for.
   *
   * Not `maxN` — that says how many one request returns, and for models whose
   * endpoint ignores `n` (Ark's Seedream) it is 1, which used to hide this
   * control entirely. Several images are produced by issuing several requests,
   * so the offer is bounded by the executor's ceiling instead.
   */
  const maxN =
    spec.kind === 'image' && (spec.form === 'A' || spec.form === 'B') ? MAX_IMAGE_FAN_OUT : (params.maxN ?? 1);

  return (
    <div className='flex w-300px flex-col gap-10px'>
      {params.aspectRatios && params.aspectRatios.length > 0 && (
        <Section label={t('conversation.mediaParamAspectRatio')}>
          <Grid cols={4}>
            {params.aspectRatios.map((ratio) => (
              <Cell
                key={ratio}
                active={value.aspectRatio === ratio}
                onClick={() => set({ aspectRatio: toggle(value.aspectRatio, ratio) })}
                className='flex-col !gap-3px !py-5px'
              >
                <RatioGlyph ratio={ratio} />
                <span className='text-11px leading-none'>{ratio}</span>
              </Cell>
            ))}
          </Grid>
        </Section>
      )}

      {params.sizes && params.sizes.length > 0 && (
        <Section label={t('conversation.mediaParamSize')}>
          {/* Three columns, not two. Six sizes at two-per-row made this the
              tallest section in the panel, and the panel opens upward over the
              composer — every extra row is another line of the prompt hidden
              while the size is picked. `1024x1024` still fits at 12px. */}
          <Grid cols={3}>
            {params.sizes.map((size) => (
              <Cell key={size} active={value.size === size} onClick={() => set({ size: toggle(value.size, size) })}>
                {size}
              </Cell>
            ))}
          </Grid>
        </Section>
      )}

      {params.resolutions && params.resolutions.length > 0 && (
        <Section label={t('conversation.mediaParamResolution')}>
          <Grid cols={Math.min(params.resolutions.length, 4)}>
            {params.resolutions.map((resolution) => (
              <Cell
                key={resolution}
                active={value.resolution === resolution}
                onClick={() => set({ resolution: toggle(value.resolution, resolution) })}
              >
                {resolution}
              </Cell>
            ))}
          </Grid>
        </Section>
      )}

      {params.durations && params.durations.length > 0 && (
        <Section label={t('conversation.mediaParamDuration')}>
          <Grid cols={Math.min(params.durations.length, 5)}>
            {params.durations.map((duration) => (
              <Cell
                key={duration}
                active={value.durationSeconds === duration}
                onClick={() => set({ durationSeconds: toggle(value.durationSeconds, duration) })}
              >
                {duration}s
              </Cell>
            ))}
          </Grid>
        </Section>
      )}

      {params.qualities && params.qualities.length > 0 && (
        <Section label={t('conversation.mediaParamQuality')}>
          <Grid cols={Math.min(params.qualities.length, 3)}>
            {params.qualities.map((quality) => (
              <Cell
                key={quality}
                active={value.quality === quality}
                onClick={() => set({ quality: toggle(value.quality, quality) })}
              >
                {quality}
              </Cell>
            ))}
          </Grid>
        </Section>
      )}

      {params.cameras && params.cameras.length > 0 && (
        <Section label={t('conversation.mediaParamCamera')}>
          <Grid cols={3}>
            {params.cameras.map((camera) => (
              <Cell
                key={camera}
                active={value.camera === camera}
                onClick={() => set({ camera: toggle(value.camera, camera) })}
              >
                {camera}
              </Cell>
            ))}
          </Grid>
        </Section>
      )}

      {/* Audio is a real cost lever on some vendors, so it keeps the same
          three-state treatment as everything else: on, off, or untouched
          (click the active choice to clear) meaning "whatever the model does by
          default". Picking silently on the user's behalf would change the bill. */}
      {params.audio && (
        <Section label={t('conversation.mediaParamAudio')}>
          <Grid cols={2}>
            {[true, false].map((on) => (
              <Cell
                key={String(on)}
                active={value.generateAudio === on}
                onClick={() => set({ generateAudio: toggle(value.generateAudio, on) })}
              >
                {t(on ? 'conversation.mediaParamAudioOn' : 'conversation.mediaParamAudioOff')}
              </Cell>
            ))}
          </Grid>
        </Section>
      )}

      {maxN > 1 && (
        <Section label={t('conversation.mediaParamCount')}>
          {/* A row of numbers rather than a stepper: the range is small and
              bounded by the model, and one click beats two on a spinner. */}
          <Grid cols={Math.min(maxN, 6)}>
            {Array.from({ length: maxN }, (_, index) => index + 1).map((count) => (
              <Cell key={count} active={(value.n ?? 1) === count} onClick={() => set({ n: count })}>
                {count}
              </Cell>
            ))}
          </Grid>
        </Section>
      )}
    </div>
  );
};

export default MediaParamsPanel;
