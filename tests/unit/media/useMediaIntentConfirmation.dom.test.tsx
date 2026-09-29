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

vi.mock('@icon-park/react', () => ({
  Message: 'svg',
  Picture: 'svg',
  VideoTwo: 'svg',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { useMediaIntentConfirmation } = await import('@/renderer/hooks/media/useMediaIntentConfirmation');

type ConfirmationOptions = {
  title: string;
  content: ReactNode;
  footer: ReactElement<{ children: ReactNode }>;
  onCancel: () => void;
};

const contentMessage = (content: ReactNode): string => {
  const contentNode = content as ReactElement<{ children: ReactNode }>;
  const blocks = Children.toArray(contentNode.props.children) as ReactElement[];
  return (blocks[1] as ReactElement<{ children: string }>).props.children;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMediaIntentConfirmation', () => {
  it('sends through the text model when the user keeps chatting', async () => {
    const { result } = renderHook(() => useMediaIntentConfirmation());
    let selection: Promise<string> = Promise.resolve('');

    act(() => {
      selection = result.current('image', () => true);
    });

    expect(modalConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'conversation.mediaIntentConfirmTitle',
      })
    );
    const options = modalConfirm.mock.calls[0]?.[0] as ConfirmationOptions;
    expect(contentMessage(options.content)).toBe('conversation.mediaIntentConfirmImage');
    const buttons = Children.toArray(options.footer.props.children) as ReactElement[];
    expect(buttons).toHaveLength(3);

    const keepChat = buttons[0]?.props.onClick;
    expect(keepChat).toBeTypeOf('function');
    act(() => (keepChat as () => void)());
    await expect(selection).resolves.toBe('chat');
    expect(modalClose).toHaveBeenCalledOnce();
  });

  it('returns video only from the explicit video choice', async () => {
    const { result } = renderHook(() => useMediaIntentConfirmation());
    let selection: Promise<string> = Promise.resolve('');

    act(() => {
      selection = result.current('video', (mode) => mode === 'video');
    });
    const options = modalConfirm.mock.calls[0]?.[0] as ConfirmationOptions;
    const buttons = Children.toArray(options.footer.props.children) as ReactElement[];

    expect(contentMessage(options.content)).toBe('conversation.mediaIntentConfirmVideo');
    expect(buttons).toHaveLength(2);
    const generateVideo = buttons[1]?.props.onClick;
    expect(generateVideo).toBeTypeOf('function');
    act(() => (generateVideo as () => void)());

    await expect(selection).resolves.toBe('video');
    expect(messageInfo).toHaveBeenCalledWith('conversation.mediaIntentSwitchedVideo');
  });

  it('allows an image-looking prompt to be deliberately routed to video', async () => {
    const { result } = renderHook(() => useMediaIntentConfirmation());
    let selection: Promise<string> = Promise.resolve('');

    act(() => {
      selection = result.current('image', () => true);
    });
    const options = modalConfirm.mock.calls[0]?.[0] as ConfirmationOptions;
    const buttons = Children.toArray(options.footer.props.children) as ReactElement[];
    const generateVideo = buttons[2]?.props.onClick;

    expect(generateVideo).toBeTypeOf('function');
    act(() => (generateVideo as () => void)());

    await expect(selection).resolves.toBe('video');
  });

  it('treats closing the dialog as continuing the text conversation', async () => {
    const { result } = renderHook(() => useMediaIntentConfirmation());
    let selection: Promise<string> = Promise.resolve('');

    act(() => {
      selection = result.current('image', () => true);
    });
    const options = modalConfirm.mock.calls[0]?.[0] as ConfirmationOptions;

    act(() => options.onCancel());

    await expect(selection).resolves.toBe('chat');
  });
});
