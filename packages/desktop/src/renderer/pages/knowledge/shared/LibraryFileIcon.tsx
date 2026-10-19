/**
 * Copyright 2026 One Work
 */

import React from 'react';
import { sourceKind } from '../original/sourceKind';

export type LibraryFileKind =
  | 'markdown'
  | 'csv'
  | 'text'
  | 'pdf'
  | 'word'
  | 'slides'
  | 'sheets'
  | 'html'
  | 'image'
  | 'video'
  | 'audio'
  | 'other';

type FileLike = { title: string; mimeType?: string | null; filePath?: string | null };

/**
 * Classifies a library entry for display. Entries registered in-app (Markdown
 * documents) carry neither a MIME type nor an extension, so "no signal and no
 * stored original" means Markdown rather than "unknown".
 */
export function libraryFileKind({ title, mimeType, filePath }: FileLike): LibraryFileKind {
  const mime = mimeType ?? '';
  if (mime === 'text/markdown' || /\.(md|markdown)$/i.test(title)) return 'markdown';
  if (mime === 'text/csv' || /\.csv$/i.test(title)) return 'csv';
  if (mime === 'text/plain' || /\.txt$/i.test(title)) return 'text';
  const kind = sourceKind(mime, title);
  if (kind !== 'unsupported') return kind;
  return !mime && !filePath?.startsWith('rag-source:') && !/\.[a-z0-9]{1,5}$/i.test(title) ? 'markdown' : 'other';
}

/** Badge colour per kind; Arco palette channels so dark mode follows the theme. */
const COLORS: Record<LibraryFileKind, string> = {
  markdown: 'cyan-6',
  csv: 'green-6',
  sheets: 'green-6',
  text: 'gray-6',
  pdf: 'red-6',
  word: 'blue-6',
  slides: 'orange-6',
  html: 'purple-6',
  image: 'lime-6',
  video: 'magenta-6',
  audio: 'gold-6',
  other: 'gray-6',
};

const GLYPHS: Record<LibraryFileKind, React.ReactNode> = {
  markdown: (
    <path
      d='M5.2 12.8V7.2l2.3 3 2.3-3v5.6M12.4 7.2v4.4m0 0-1.4-1.4m1.4 1.4 1.4-1.4'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  ),
  csv: (
    <path
      d='M5 6.5h10M5 10h10M5 13.5h10M8.5 6.5v7M12 6.5v7'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinecap='round'
    />
  ),
  text: (
    <path d='M5.5 7h9M5.5 10h9M5.5 13h5.5' fill='none' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' />
  ),
  pdf: (
    <text
      x='10'
      y='12.6'
      textAnchor='middle'
      fontSize='6.4'
      fontWeight='700'
      fill='currentColor'
      fontFamily='sans-serif'
    >
      PDF
    </text>
  ),
  word: (
    <path
      d='M5.5 6.8h9M5.5 10h9M5.5 13.2h6'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
    />
  ),
  slides: (
    <path
      d='M5 6.5h10v6H5zM10 12.5v2M7.5 14.5h5'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  ),
  html: (
    <path
      d='m8.2 7.2-3 2.8 3 2.8m3.6-5.6 3 2.8-3 2.8'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  ),
  image: (
    <path
      d='m5 13.5 3.2-4 2.4 2.8 1.6-1.8 2.8 3zM13 7.4h.01'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  ),
  video: <path d='M8 6.6v6.8l5.4-3.4z' fill='currentColor' />,
  audio: (
    <path
      d='M6.5 8.5v3M9 6.8v6.4M11.5 8v4M14 9.3v1.4'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
    />
  ),
  sheets: (
    <path
      d='M5 6.5h10M5 10h10M5 13.5h10M8.5 6.5v7M12 6.5v7'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinecap='round'
    />
  ),
  other: (
    <path d='M5.5 7h9M5.5 10h9M5.5 13h5.5' fill='none' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' />
  ),
};

type LibraryFileIconProps = FileLike & {
  size?: number;
  className?: string;
};

/** Small rounded badge whose colour and glyph follow the file type. */
const LibraryFileIcon: React.FC<LibraryFileIconProps> = ({ size = 18, className, ...file }) => {
  const kind = libraryFileKind(file);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox='0 0 20 20'
      aria-hidden='true'
      data-kind={kind}
      style={{ flexShrink: 0, color: 'var(--color-white)' }}
    >
      <rect width='20' height='20' rx='4.5' style={{ fill: `rgb(var(--${COLORS[kind]}))` }} />
      {GLYPHS[kind]}
    </svg>
  );
};

export default LibraryFileIcon;
