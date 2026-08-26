/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The small coloured "what does this model produce" tag in the model list.
 *
 * A provider list mixes chat, vision, image, video and audio models under names
 * that rarely say which is which (`gemini-3-pro-image` is an image generator,
 * `qwen-audio-realtime-plus` is a text model that hears). Showing the kind is
 * what stops a user picking a video model for chat and wondering why nothing
 * works.
 *
 * The kind shown is what the user declared in model settings; when they have
 * not declared one, nothing is shown rather than a guess — an inferred label
 * that turns out wrong is worse than no label.
 */

import React from 'react';
import { Tag, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ModelKind } from '@/common/config/storage';

const KIND_COLOR: Record<ModelKind, string> = {
  text: 'gray',
  multimodal: 'purple',
  image: 'orange',
  video: 'magenta',
  audio: 'cyan',
};

/**
 * `inferred` marks a kind that came from the model's name rather than from the
 * user's declaration or the built-in catalog. It renders muted and says so on
 * hover, because "we know this" and "this is our best reading of the name" are
 * different claims and only the user can settle the second one.
 *
 * `showUndeclared` covers the remaining case — a name we cannot read at all —
 * in the model list, where an empty row looks like a missing feature. The
 * send-box pickers leave it off: a column of "unlabelled" chips is noise.
 */
const ModelKindTag: React.FC<{
  kind?: ModelKind;
  inferred?: boolean;
  showUndeclared?: boolean;
  /** Makes the tag a shortcut to editing the kind. Only the model list passes it. */
  onClick?: () => void;
}> = ({ kind, inferred, showUndeclared, onClick }) => {
  const { t } = useTranslation();

  if (!kind) {
    if (!showUndeclared) return null;
    return (
      <Tag size='small' bordered className={onClick ? 'cursor-pointer' : undefined} onClick={onClick}>
        {t('settings.modelKind_undeclared')}
      </Tag>
    );
  }

  const label = t(`settings.modelKind_${kind}` as never);

  if (inferred) {
    return (
      <Tooltip content={t('settings.modelKindInferredTip')}>
        {/* Muted, but no "?" suffix. The marker hedged in the one place the
            user could not act on it — every row in a picker. Being visibly
            unsure without offering a fix reads as the product not knowing what
            it is doing; the muted styling still separates a reading of the name
            from a declaration, and the model list makes the tag clickable so
            the answer is one click away instead of a caveat. */}
        <Tag size='small' bordered className={`opacity-60${onClick ? ' cursor-pointer' : ''}`} onClick={onClick}>
          {label}
        </Tag>
      </Tooltip>
    );
  }

  return (
    <Tag
      size='small'
      color={KIND_COLOR[kind]}
      bordered
      className={onClick ? 'cursor-pointer' : undefined}
      onClick={onClick}
    >
      {label}
    </Tag>
  );
};

export default ModelKindTag;
