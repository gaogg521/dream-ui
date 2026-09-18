/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Helpers for injecting user-selected background images into theme CSS.
 */

export const BACKGROUND_BLOCK_START = '/* Dream UI Theme Background Start */';
export const BACKGROUND_BLOCK_END = '/* Dream UI Theme Background End */';

/**
 * 改名前写下的同一对标记。**只认新标记是不够的**：带旧标记的主题（我们自己发的预设，
 * 以及用户在改名前存下的自定义主题）匹配不上，那个背景块就既删不掉也换不掉 —— 再设
 * 一次背景只会**追加第二个块**，两张图叠在一起。剥离时两种都认，写入只写新的。
 *
 * The pre-rebrand spelling of the same pair. Matching only the current one is not
 * enough: a theme carrying the old markers never matches, so its background block can
 * be neither removed nor replaced — setting a new background just APPENDS a second
 * block. Stripping accepts both; only the current pair is ever written.
 */
const LEGACY_BACKGROUND_BLOCK_START = '/* AionUi Theme Background Start */';
const LEGACY_BACKGROUND_BLOCK_END = '/* AionUi Theme Background End */';

// Precompiled regex for better performance / 预编译正则以提升性能
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockPattern = (start: string, end: string) => `${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}\n?`;
const BACKGROUND_BLOCK_PATTERN = new RegExp(
  `${blockPattern(BACKGROUND_BLOCK_START, BACKGROUND_BLOCK_END)}|${blockPattern(
    LEGACY_BACKGROUND_BLOCK_START,
    LEGACY_BACKGROUND_BLOCK_END
  )}`,
  'g'
);

/** True when the CSS already carries a background block in either spelling. */
export const hasBackgroundBlock = (css: string): boolean =>
  css.includes(BACKGROUND_BLOCK_START) || css.includes(LEGACY_BACKGROUND_BLOCK_START);

const buildBackgroundCss = (imageDataUrl: string): string => {
  if (!imageDataUrl) return '';
  return `${BACKGROUND_BLOCK_START}
/* 根容器设置背景图 / Root container background image */
body,
html,
.arco-layout,
.app-shell {
  background-image: url("${imageDataUrl}");
  background-size: cover;
  background-repeat: no-repeat;
  background-position: center center;
  background-attachment: fixed;
  background-color: transparent;
}

/* 内部容器透明化，让背景图穿透 / Make inner containers transparent */
.layout-content,
.layout-content.bg-1,
.arco-layout-content,
[class*="chat-layout"] .arco-layout-content,
[class*="conversation"] .arco-layout-content,
.bg-1,
.bg-2:not(.app-titlebar),
[class*="flex-col"][class*="h-full"],
[class*="flex-center"] {
  background-color: transparent;
  background-image: none;
}

/* 确保伪元素也透明 / Ensure pseudo elements are transparent */
.layout-content::before,
.layout-content.bg-1::before,
[class*="chat-layout"] .arco-layout-content::before,
[class*="conversation"] .arco-layout-content::before {
  background: transparent;
  opacity: 0;
}
${BACKGROUND_BLOCK_END}`;
};

/**
 * Inject (or replace) the standard background CSS block using the provided image.
 */
export const injectBackgroundCssBlock = (css: string, imageDataUrl: string): string => {
  if (!css) {
    return buildBackgroundCss(imageDataUrl);
  }
  // Reset lastIndex for global regex reuse / 重置 lastIndex 以重用全局正则
  BACKGROUND_BLOCK_PATTERN.lastIndex = 0;
  const cleanedCss = css.replace(BACKGROUND_BLOCK_PATTERN, '').trim();
  const block = buildBackgroundCss(imageDataUrl);
  return [cleanedCss, block].filter(Boolean).join('\n\n');
};
