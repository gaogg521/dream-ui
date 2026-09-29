/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { Children, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const modalClose = vi.hoisted(() => vi.fn());
const modalConfirm = vi.hoisted(() => vi.fn(() => ({ close: modalClose })));
const messageInfo = vi.hoisted(() => vi.fn());

vi.mock('@arco-design/web-react', () => ({
  Button: 'button',
  Modal: { confirm: modalConfirm },
  Message: { info: messageInfo },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { useMediaIntentConfirmation } = await import('@/renderer/hooks/media/useMediaIntentConfirmation');

type ConfirmationOptions = {
  title: string;
  content: string;
  footer: ReactElement<{ children: ReactNode }>;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMediaIntentConfirmation', () => {
  it('keeps the text model unchanged until the user confirms an image switch', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useMediaIntentConfirmation());

    act(() => result.current('image', () => true, onConfirm));

    expect(modalConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'conversation.mediaIntentConfirmTitle',
        content: 'conversation.mediaIntentConfirmImage',
      })
    );
    const options = modalConfirm.mock.calls[0]?.[0] as ConfirmationOptions;
    const buttons = Children.toArray(options.footer.props.children) as ReactElement[];
    expect(buttons).toHaveLength(3);

    const keepChat = buttons[0]?.props.onClick;
    expect(keepChat).toBeTypeOf('function');
    act(() => (keepChat as () => void)());
    // Opening, dismissing, or choosing to keep chatting has no mode change.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(modalClose).toHaveBeenCalledOnce();
  });

  it('switches to the requested video mode only from the explicit confirmation', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useMediaIntentConfirmation());

    act(() => result.current('video', (mode) => mode === 'video', onConfirm));
    const options = modalConfirm.mock.calls[0]?.[0] as ConfirmationOptions;
    const buttons = Children.toArray(options.footer.props.children) as ReactElement[];

    expect(options.content).toBe('conversation.mediaIntentConfirmVideo');
    expect(buttons).toHaveLength(2);
    const generateVideo = buttons[1]?.props.onClick;
    expect(generateVideo).toBeTypeOf('function');
    act(() => (generateVideo as () => void)());

    expect(onConfirm).toHaveBeenCalledWith('video');
    expect(messageInfo).toHaveBeenCalledWith('conversation.mediaIntentSwitchedVideo');
  });

  it('allows an image-looking prompt to be deliberately routed to video', () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useMediaIntentConfirmation());

    act(() => result.current('image', () => true, onConfirm));
    const options = modalConfirm.mock.calls[0]?.[0] as ConfirmationOptions;
    const buttons = Children.toArray(options.footer.props.children) as ReactElement[];
    const generateVideo = buttons[2]?.props.onClick;

    expect(generateVideo).toBeTypeOf('function');
    act(() => (generateVideo as () => void)());

    expect(onConfirm).toHaveBeenCalledWith('video');
  });
});
