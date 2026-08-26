/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plays a generated video straight off disk via the `one-media://` protocol.
 *
 * Deliberately NOT the base64-through-IPC route that images use: a clip is tens
 * of megabytes and serializing it through the message channel is the exact
 * failure the media design's D6 rule exists to prevent. The protocol handler
 * streams with `Range` support, which is also what makes seeking work.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildMediaUrl } from '@/common/media/mediaUrl';

const LocalVideoView: React.FC<{
  src: string;
  className?: string;
  /** Shown under the player; usually the file name. */
  caption?: string;
}> = ({ src, className, caption }) => {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className='text-t-secondary text-12px break-all'>
        {t('conversation.mediaVideoUnavailable')}
        <div className='mt-4px'>{src}</div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4px'>
      <video
        className={className}
        src={buildMediaUrl(src)}
        controls
        preload='metadata'
        onError={() => setFailed(true)}
      />
      {caption && <span className='text-12px text-t-secondary break-all'>{caption}</span>}
    </div>
  );
};

export default LocalVideoView;
