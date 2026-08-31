/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renders the assets a media-generation tool produced: images as a preview
 * grid, videos as inline players.
 *
 * Before this existed, a generated image only rendered on the Codex-specific
 * tool path and everything from the built-in media tool showed up as a bare
 * file path in the result text — including every video. Multi-image results in
 * particular had nowhere to go, even after the adapter layer started returning
 * all of them.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Image } from '@arco-design/web-react';
import type { ParsedMediaAsset } from '@/common/media/mediaResultText';
import { buildMediaUrl } from '@/common/media/mediaUrl';
import LocalVideoView from './LocalVideoView';
import styles from './GeneratedMediaView.module.css';

/**
 * Columns and a per-tile height cap that scale with the result size. A two-up
 * result should read big; a large one should stay a contact sheet rather than
 * take over the conversation (full size is one click away via the preview).
 * `4` is pulled back to two columns so it lays out as a clean 2×2.
 */
const gridShapeFor = (count: number): { columns: number; tileMaxH: number } => {
  if (count === 2 || count === 4) return { columns: 2, tileMaxH: count === 2 ? 520 : 340 };
  if (count <= 6) return { columns: 3, tileMaxH: 300 };
  return { columns: 4, tileMaxH: 220 };
};

const GeneratedMediaView: React.FC<{ assets: ParsedMediaAsset[] }> = ({ assets }) => {
  const { t } = useTranslation();
  if (!assets.length) return null;

  const images = assets.filter((asset) => asset.kind === 'image');
  const videos = assets.filter((asset) => asset.kind === 'video');
  const grid = gridShapeFor(images.length);

  return (
    <div className='mt-8px flex flex-col gap-8px'>
      {images.length > 0 && (
        // A single image gets the full width it used to get; several become a
        // grid whose column count and tile height adapt to the result size.
        <Image.PreviewGroup infinite={false}>
          <div
            className={images.length === 1 ? 'flex' : styles.grid}
            style={
              images.length === 1
                ? undefined
                : ({
                    '--media-grid-cols': grid.columns,
                    '--media-tile-max-h': `${grid.tileMaxH}px`,
                  } as React.CSSProperties)
            }
          >
            {images.map((asset) => (
              <div key={asset.filePath} className='overflow-hidden rd-8px border border-solid b-color-border-2'>
                {/* Arco's `Image` rather than a bare `<img>`: only `Image`
                    registers with the surrounding PreviewGroup, so a bare tag
                    left click-to-enlarge doing nothing — which is also what
                    made a tall inline render the only way to see any detail.
                    Served over `one-media://` rather than the base64 IPC route
                    that markdown images use: generated media lands wherever the
                    agent's workspace is, and `/api/fs/image-base64` refuses
                    those paths outright (400), so the thumbnail could never
                    load. The protocol also keeps the bytes off the message
                    channel, same as video. */}
                <Image
                  src={buildMediaUrl(asset.filePath)}
                  alt={asset.fileName}
                  className={images.length === 1 ? styles.singleImage : styles.gridImage}
                  /* A broken-image glyph says nothing about why. The file is the
                     likely answer — generated media can be moved or deleted
                     from disk long after the message that produced it, and a
                     browser client additionally cannot reach files the app no
                     longer vouches for. Name the path so the user can go look,
                     the same way the video player already does. */
                  error={
                    <div className='text-t-secondary text-12px break-all p-8px'>
                      {t('conversation.mediaImageUnavailable')}
                      <div className='mt-4px'>{asset.filePath}</div>
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
      )}

      {videos.map((asset) => (
        <div key={asset.filePath} className='overflow-hidden rd-8px border border-solid b-color-border-2 p-8px'>
          {/* No filename caption: images never had one, and the card above
              already carries the prompt while the actions below open the
              containing folder — which the file tree now shows too, since
              generated media lands in the workspace's `outputs/`. A line
              only videos showed read as an inconsistency, not information. */}
          <LocalVideoView src={asset.filePath} className='max-w-full max-h-[520px] rd-4px' />
        </div>
      ))}
    </div>
  );
};

export default GeneratedMediaView;
