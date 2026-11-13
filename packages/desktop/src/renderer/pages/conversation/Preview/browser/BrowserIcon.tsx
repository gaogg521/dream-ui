/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// Four-colour ring: the colours people associate with "a browser" at a glance.
const SEGMENT_COLORS = ['#EA4335', '#FBBC05', '#34A853', '#4285F4'];
const RING_RADIUS = 8.4;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const SEGMENT_LENGTH = RING_LENGTH / SEGMENT_COLORS.length;
const SEGMENT_GAP = 1.6;

/**
 * 彩色「浏览器」图标：四色分段圆环 + 蓝色圆心。大家一眼认得出「这是浏览器」，
 * 但只是通用造型，不是任何品牌的 logo。固定配色，不随 currentColor 变化，深浅色主题下都清晰。
 *
 * A colourful "browser" glyph: a four-colour segmented ring with a blue centre. Instantly
 * readable as a browser, but a generic shape — not any brand's logo. Fixed colours (it does
 * not follow currentColor) so it stays legible in both light and dark themes.
 */
const BrowserIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    aria-hidden='true'
    focusable='false'
    className={className}
  >
    {SEGMENT_COLORS.map((color, index) => (
      <circle
        key={color}
        cx='12'
        cy='12'
        r={RING_RADIUS}
        stroke={color}
        strokeWidth='4.2'
        strokeDasharray={`${SEGMENT_LENGTH - SEGMENT_GAP} ${RING_LENGTH - SEGMENT_LENGTH + SEGMENT_GAP}`}
        strokeDashoffset={-(index * SEGMENT_LENGTH + SEGMENT_GAP / 2)}
        transform='rotate(-90 12 12)'
      />
    ))}
    <circle cx='12' cy='12' r='3.4' fill='#4285F4' stroke='#FFFFFF' strokeWidth='1.4' />
  </svg>
);

export default BrowserIcon;
