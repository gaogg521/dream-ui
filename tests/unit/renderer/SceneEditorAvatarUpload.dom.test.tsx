/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const encode = vi.hoisted(() => vi.fn());
const messageError = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/common', () => ({ ipcBridge: { fs: { listAvailableSkills: { invoke: async () => [] } } } }));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  // The static Message API renders through ReactDOM.render, which React 19 no longer has.
  return { ...actual, Message: { ...actual.Message, error: messageError } };
});
vi.mock('@/renderer/hooks/mcp', () => ({ useMcpServers: () => ({ mcpServers: [] }) }));
vi.mock('swr', () => ({ default: () => ({ data: [] }) }));
vi.mock('@/renderer/utils/scenes/avatarImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/scenes/avatarImage')>()),
  encodeSceneAvatarImage: encode,
}));

import SceneEditor from '@/renderer/components/scenes/SceneEditor';
import { newPersonalScene } from '@/renderer/utils/scenes/personalScenes';

const UPLOADED = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

const open = (onSave = vi.fn()) => {
  render(
    <SceneEditor
      visible
      mode='new'
      scene={newPersonalScene({ name: 'Mine', icon: '🌐' })}
      onCancel={() => undefined}
      onSave={onSave}
    />
  );
  return onSave;
};

const upload = (file: File) => {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

describe('SceneEditor avatar upload', () => {
  beforeEach(() => {
    encode.mockReset();
    messageError.mockReset();
    encode.mockResolvedValue(UPLOADED);
  });

  it('offers an upload next to the built-in portraits', () => {
    open();
    expect(screen.getByTestId('scene-avatar-upload')).toBeInTheDocument();
    expect(screen.getByTestId('scene-avatar-reset')).toBeDisabled();
  });

  it('previews the uploaded picture and saves it with the scene', async () => {
    const onSave = open();
    upload(new File(['x'], 'me.png', { type: 'image/png' }));

    await waitFor(() => expect(screen.getByTestId('scene-avatar-preview').getAttribute('src')).toBe(UPLOADED));
    expect(screen.getByTestId('scene-avatar-reset')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('scene-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].avatarUrl).toBe(UPLOADED);
  });

  it('choosing a built-in portrait afterwards replaces the uploaded one', async () => {
    const onSave = open();
    upload(new File(['x'], 'me.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByTestId('scene-avatar-preview').getAttribute('src')).toBe(UPLOADED));

    fireEvent.click(screen.getByRole('button', { name: '🧭' }));
    await waitFor(() => expect(screen.getByTestId('scene-avatar-preview').getAttribute('src')).not.toBe(UPLOADED));

    fireEvent.click(screen.getByTestId('scene-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].avatarUrl).toBeUndefined();
  });

  it('the default button drops the uploaded picture', async () => {
    open();
    upload(new File(['x'], 'me.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByTestId('scene-avatar-preview').getAttribute('src')).toBe(UPLOADED));

    fireEvent.click(screen.getByTestId('scene-avatar-reset'));
    await waitFor(() => expect(screen.getByTestId('scene-avatar-preview').getAttribute('src')).not.toBe(UPLOADED));
    expect(screen.getByTestId('scene-avatar-reset')).toBeDisabled();
  });

  it('keeps the previous picture when the file cannot be read', async () => {
    encode.mockRejectedValueOnce(new Error('Unsupported avatar format'));
    open();
    upload(new File(['x'], 'broken.bin', { type: 'image/png' }));

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('common.failed'));
    expect(screen.getByTestId('scene-avatar-preview').getAttribute('src')).not.toBe(UPLOADED);
  });
});
