/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * A 900px-wide centred dialog sits exactly on top of what the user is filling
 * it in from (the file tree, the conversation). `draggable` lets them push it
 * aside; these cover that it only moves when asked, and that it cannot be
 * pushed somewhere it can no longer be grabbed.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ConfigProvider } from '@arco-design/web-react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

// DreamModal reads ThemeContext only for font scaling; a full ThemeProvider
// would drag in IPC-backed theme loading for no benefit here.
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', fontScale: 1 }),
}));

import DreamModal from '@/renderer/components/base/DreamModal';

const TITLE = 'Draggable dialog';

const renderModal = (draggable: boolean) =>
  render(
    <ConfigProvider>
      <DreamModal visible variant='standard' draggable={draggable} header={{ title: TITLE, showClose: true }}>
        body
      </DreamModal>
    </ConfigProvider>
  );

const modalBox = () => document.querySelector('.arco-modal') as HTMLElement;
const handle = () => screen.getByText(TITLE).closest('.dream-modal-std-header') as HTMLElement;

const drag = (from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(handle(), { button: 0, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(window, { clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(window, { clientX: to[0], clientY: to[1] });
};

describe('DreamModal draggable', () => {
  afterEach(() => cleanup());

  it('does not move when draggable is off', () => {
    renderModal(false);
    drag([100, 100], [400, 300]);
    expect(modalBox().style.transform).toBe('');
  });

  it('follows the pointer from the header', () => {
    renderModal(true);
    drag([100, 100], [220, 180]);
    expect(modalBox().style.transform).toBe('translate(120px, 80px)');
  });

  it('ignores drags started on header controls', () => {
    // The close button lives in the header; pressing it must close the dialog,
    // not start a drag that swallows the click.
    renderModal(true);
    const close = screen.getByLabelText('Close');
    fireEvent.pointerDown(close, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300 });
    expect(modalBox().style.transform).toBe('');
  });

  it('clamps so the dialog can always be grabbed again', () => {
    // jsdom reports every rect as 0x0 at the origin, which makes the clamp
    // degenerate. Pin a realistic rect so the boundary is actually exercised
    // rather than trivially satisfied.
    const rect = { top: 100, left: 200, right: 1100, bottom: 700, width: 900, height: 600, x: 200, y: 100 };
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ ...rect, toJSON: () => rect } as DOMRect);
    try {
      renderModal(true);
      // Far past every edge in both directions at once.
      drag([500, 500], [-9000, -9000]);
      const [, dx, dy] = /translate\((-?\d+)px, (-?\d+)px\)/.exec(modalBox().style.transform) ?? [];

      // Dragged off the top the title bar is unreachable and nothing but Escape
      // closes the dialog, so the top edge stops at the viewport top exactly.
      expect(Number(dy)).toBe(-rect.top);
      // Leftwards it may leave all but a grabbable sliver on screen.
      expect(Number(dx)).toBe(80 - rect.left - rect.width);
    } finally {
      spy.mockRestore();
    }
  });
});
