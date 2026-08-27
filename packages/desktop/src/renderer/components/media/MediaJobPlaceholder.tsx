/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The media-shaped skeleton shown while a generation job is still running.
 *
 * The job card used to mark "in progress" with only a hairline progress bar and
 * a line of stage text — it read as a system notice, not as "your picture is
 * being made right here". This fills the space the result will occupy, at the
 * aspect ratio that was asked for, so the wait has a shape and a running clock.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Picture, VideoTwo } from '@icon-park/react';
import type { MediaGenParams, MediaKind } from '@/common/media/types';
import { iconColors } from '@/renderer/styles/colors';
import styles from './MediaJobPlaceholder.module.css';

/** `m:ss` — mirrors formatSpeechDuration in SpeechInputButton.tsx. */
const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Parse "16:9" or "1024x1024" into width/height numbers. `kind` picks the
 * fallback: a square for images, widescreen for video.
 */
const resolveRatio = (kind: MediaKind, params?: MediaGenParams): { w: number; h: number } => {
  const raw = params?.aspectRatio || params?.size;
  const m = raw?.match(/^\s*(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)\s*$/i);
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  if (m && w > 0 && h > 0) {
    // Reduce "1024x1024" to "1/1" so the ratio and the maxWidth calc stay small.
    const d = Number.isInteger(w) && Number.isInteger(h) ? gcd(w, h) : 1;
    return { w: w / d, h: h / d };
  }
  return kind === 'video' ? { w: 16, h: 9 } : { w: 1, h: 1 };
};

/** Re-render once a second so the elapsed clock ticks. */
const useElapsed = (startedAt: number): number => {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, now - startedAt);
};

const MediaJobPlaceholder: React.FC<{
  kind: MediaKind;
  params?: MediaGenParams;
  /** Localized stage text (e.g. "服务端排队中"), shown in place of the generic hint when present. */
  stageLabel?: string;
  startedAt: number;
}> = ({ kind, params, stageLabel, startedAt }) => {
  const { t } = useTranslation();
  const elapsedMs = useElapsed(startedAt);
  const { w, h } = resolveRatio(kind, params);

  const count = kind === 'image' && params?.n && params.n > 1 ? Math.min(params.n, 4) : 1;
  const single = count === 1;
  const Icon = kind === 'video' ? VideoTwo : Picture;
  const title =
    kind === 'video' ? t('conversation.mediaJobGeneratingVideo') : t('conversation.mediaJobGeneratingImage');

  const caption = (
    <div className={styles.caption}>
      <Icon theme='outline' size='22' fill={iconColors.secondary} />
      <span className='text-13px text-t-primary mt-6px'>{title}</span>
      <span className='text-12px text-t-secondary mt-2px'>
        {stageLabel || t('conversation.mediaJobGeneratingHint')}
      </span>
      <span className='text-12px text-t-tertiary mt-2px'>
        {t('conversation.mediaJobElapsed', { time: formatElapsed(elapsedMs) })}
      </span>
    </div>
  );

  return (
    <div data-testid='media-job-placeholder' className={single ? 'flex flex-col' : 'grid grid-cols-2 gap-8px'}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={styles.tile}
          data-ratio={`${w}/${h}`}
          style={{
            aspectRatio: `${w} / ${h}`,
            // Cap the single tile so a tall ratio never swallows the conversation;
            // the grid tiles are already column-bounded.
            ...(single ? { maxWidth: `calc(360px * ${w} / ${h})` } : {}),
          }}
        >
          {i === 0 && caption}
        </div>
      ))}
    </div>
  );
};

export default MediaJobPlaceholder;
