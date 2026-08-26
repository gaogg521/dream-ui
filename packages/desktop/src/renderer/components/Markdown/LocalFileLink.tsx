/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo } from 'react';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { useTranslation } from 'react-i18next';
import { fileNameOf, isImagePath, isVideoPath } from '@/common/media/mediaResultText';
import type { ParsedMediaAsset } from '@/common/media/mediaResultText';
import GeneratedMediaView from '@renderer/components/media/GeneratedMediaView';
import type { LocalFileLinkReference } from './markdownUtils';

type LocalFileLinkProps = {
  reference: LocalFileLinkReference;
  children?: React.ReactNode;
  onOpen?: (path: string, reference?: LocalFileLinkReference) => void | Promise<void>;
};

const LocalFileLink: React.FC<LocalFileLinkProps> = ({ reference, children, onOpen }) => {
  const { t } = useTranslation();
  const { filePath, line, rawReference } = reference;
  const fallbackLabel = filePath.split(/[\\/]/).pop() || filePath;
  const label = children || fallbackLabel;
  const textLabel =
    React.Children.toArray(children)
      .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
      .join('') || fallbackLabel;
  /**
   * Image and video links preview inline instead of staying a bare file name.
   *
   * An agent that generates media routinely announces it in prose ("saved to
   * `…/img-1.png`") rather than through the tool-result contract line that
   * `MessageToolGroup` keys off, and a chat-mode turn collapses its tool group
   * anyway — so the one thing the user wanted to look at arrived as a file name
   * they had to go hunt down on disk. A `line` reference means the writer meant
   * a source location, not a picture, so those keep the plain chip.
   */
  const previewAsset = useMemo<ParsedMediaAsset | null>(() => {
    if (line != null) return null;
    const kind = isVideoPath(filePath) ? 'video' : isImagePath(filePath) ? 'image' : null;
    return kind ? { kind, filePath, fileName: fileNameOf(filePath) } : null;
  }, [filePath, line]);

  const locationLabel =
    line == null
      ? null
      : `L${line}${reference.endLine == null ? (reference.column == null ? '' : `:${reference.column}`) : `-L${reference.endLine}`}`;
  const canOpen = Boolean(onOpen);

  const handleOpen = useCallback(
    (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (onOpen) {
        void onOpen(filePath, reference);
      }
    },
    [filePath, onOpen, reference]
  );

  const handleCopy = useCallback(
    (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      copyText(rawReference).catch(() => {
        Message.error(t('common.copyFailed'));
      });
    },
    [rawReference, t]
  );

  const content = (
    <span className='inline-flex items-center gap-4px max-w-full'>
      <span className='truncate'>{label}</span>
      {locationLabel && (
        <span className='flex-shrink-0 rd-4px bg-fill-2 px-4px text-11px font-mono text-t-secondary'>
          {locationLabel}
        </span>
      )}
    </span>
  );

  const chip = (
    <span
      className='inline-flex items-center gap-2px max-w-full align-baseline'
      data-local-file-path={filePath}
      data-local-file-line={line}
      title={rawReference}
    >
      {canOpen ? (
        <Button
          type='text'
          size='mini'
          aria-label={locationLabel ? `${textLabel} ${locationLabel}` : textLabel}
          className='markdown-local-file-link !px-6px !py-2px !h-auto !leading-normal !align-baseline max-w-full !rd-6px'
          onClick={handleOpen}
        >
          {content}
        </Button>
      ) : (
        <span className='markdown-local-file-link inline-flex items-center gap-4px max-w-full'>{content}</span>
      )}
      <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
        <Button
          aria-label={t('common.copy', { defaultValue: 'Copy' })}
          type='text'
          size='mini'
          className='markdown-local-file-copy !p-1px !w-20px !h-20px flex-shrink-0'
          icon={<Copy theme='outline' size='14' fill={iconColors.secondary} />}
          onClick={handleCopy}
        />
      </Tooltip>
    </span>
  );

  if (!previewAsset) return chip;

  // `span` rather than `div`: react-markdown renders this anchor inside a `<p>`,
  // and the preview is styled to `display: block` by `markdown-local-file-preview`
  // in ShadowView's stylesheet.
  return (
    <span className='markdown-local-file-preview'>
      {chip}
      <GeneratedMediaView assets={[previewAsset]} />
    </span>
  );
};

export default LocalFileLink;
