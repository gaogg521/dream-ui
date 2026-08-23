/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * State and send behaviour for the send box's media mode.
 *
 * Kept in a hook rather than inside a platform component because every
 * conversation type (acp, dream, …) renders its own send box and they must all
 * behave identically here — a mode that worked in one and not another would be
 * indistinguishable from a bug.
 *
 * The selected model and its parameters live per conversation: the model
 * decides what the parameter panel can even offer, so carrying one global set
 * across conversations would silently apply a video model's resolution list to
 * an image request.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { resolveMediaModelSpec } from '@/common/media/catalog';
import { findDeclaredMediaModel } from '@/common/media/declaredModel';
import type { MediaGenParams } from '@/common/media/types';
import { startMediaJob } from './mediaJobsTransport';
import type { IProvider } from '@/common/config/storage';
import type { MediaMode } from '@renderer/components/media/MediaModeControl';
import { getClientBusinessSetting } from '@renderer/services/clientBusinessSettings';
import {
  clearMediaModeSnapshot,
  consumeMediaModeRequest,
  setMediaModeSnapshot,
  useMediaModeRequest,
} from './mediaModeStore';

type Selection = { providerId?: string; model?: string };

export const useMediaComposer = (conversationId: string | undefined, providers: IProvider[] | undefined) => {
  const [mode, setMode] = useState<MediaMode>('off');
  const [params, setParams] = useState<MediaGenParams>({});
  const [selection, setSelection] = useState<Record<'image' | 'video', Selection>>({ image: {}, video: {} });

  // The globally configured model is the starting point; a per-conversation
  // override would layer on top of this.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [image, video] = await Promise.all([
          getClientBusinessSetting('tools.imageGenerationModel'),
          getClientBusinessSetting('tools.videoGenerationModel'),
        ]);
        if (cancelled) return;
        // The Tools/MCP selection is an explicit override. If it has not been
        // made yet, use the first model the user already declared as image or
        // video in Settings > Models. Otherwise the conversation incorrectly
        // reports that no media model exists even though the provider is ready.
        const declaredImage = findDeclaredMediaModel('image', providers);
        const declaredVideo = findDeclaredMediaModel('video', providers);
        setSelection({
          image: {
            providerId: image?.id ?? declaredImage?.id,
            model: image?.use_model ?? declaredImage?.use_model,
          },
          video: {
            providerId: video?.id ?? declaredVideo?.id,
            model: video?.use_model ?? declaredVideo?.use_model,
          },
        });
      } catch (error) {
        console.error('[useMediaComposer] Failed to read media model settings:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providers]);

  // The model selector lives in the conversation header and can ask to switch
  // modes — see `requestMediaMode`. Applied once per request (`seq`), so a
  // later manual switch is never overridden by a stale one.
  const request = useMediaModeRequest(conversationId);
  const appliedRequestSeq = useRef(0);
  useEffect(() => {
    if (!request || request.seq === appliedRequestSeq.current) return;
    appliedRequestSeq.current = request.seq;
    setMode(request.mode);
    // Switching kind must not carry the previous kind's parameters over, same
    // reason as `changeMode` below.
    setParams({});
    if (request.mode !== 'off' && request.providerId && request.model) {
      const kind = request.mode;
      setSelection((prev) => ({ ...prev, [kind]: { providerId: request.providerId, model: request.model } }));
    }
    // The ref above only guards this component instance. Remounting the send
    // box (switching conversations and back, HMR) resets it to 0, and a request
    // left in the store would then be applied a second time — pulling the user
    // back into a mode they had already exited. A request is one-shot: drop it.
    consumeMediaModeRequest(conversationId, request.seq);
  }, [request, conversationId]);

  const active = mode === 'off' ? undefined : selection[mode];

  // Publish for the conversation header, which otherwise keeps naming the chat
  // model while a generation mode is active. Cleared on unmount so a closed
  // conversation never leaves a stale mode behind.
  useEffect(() => {
    setMediaModeSnapshot(conversationId, { mode, model: active?.model });
  }, [conversationId, mode, active?.model]);

  useEffect(() => () => clearMediaModeSnapshot(conversationId), [conversationId]);

  const spec = useMemo(() => {
    if (!active?.model || mode === 'off') return null;
    const provider = providers?.find((item) => item.id === active.providerId);
    if (!provider) return null;
    return resolveMediaModelSpec(mode, provider, active.model);
  }, [active?.model, active?.providerId, mode, providers]);

  // Switching kind must not carry the previous kind's parameters over: a
  // duration means nothing to an image model and a size list rarely matches.
  const changeMode = useCallback((next: MediaMode) => {
    setMode(next);
    setParams({});
  }, []);

  const submit = useCallback(
    async (
      prompt: string,
      workspaceDir?: string,
      inputUris?: string[],
      /**
       * The welcome page has no conversation until the moment it sends, so it
       * creates one and passes the id here. Everywhere else the hook's own
       * conversation is correct.
       */
      conversationIdOverride?: string
    ) => {
      if (mode === 'off') return { started: false as const, error: 'media mode is off' };
      if (!active?.model) {
        return { started: false as const, error: 'no-model' };
      }
      const result = await startMediaJob({
        kind: mode,
        prompt,
        params: params as Record<string, unknown>,
        inputUris: inputUris ?? [],
        workspaceDir,
        model: active.model,
        conversationId: conversationIdOverride ?? conversationId,
      });
      return result.job ? { started: true as const } : { started: false as const, error: result.error };
    },
    [active?.model, conversationId, mode, params]
  );

  return {
    mode,
    changeMode,
    params,
    setParams,
    model: active?.model,
    /** Exposed so the cost estimate resolves the price on this exact provider. */
    providerId: active?.providerId,
    spec,
    submit,
    /** True when the mode is on but nothing can run — the caller should say why. */
    needsModel: mode !== 'off' && !active?.model,
    /**
     * Whether attached images are used as reference input for this model.
     *
     * The plumbing has always been there — every send box already passes the
     * attached paths to `submit` as `inputUris`, and all three adapters consume
     * them — but nothing in the UI said so, so image-to-image and
     * image-to-video were invisible features. Read off the spec rather than
     * assumed: a model that does not declare it would just ignore the input.
     */
    supportsReference: mode === 'image' ? Boolean(spec?.params.imageInput) : Boolean(spec?.params.imageToVideo),
  };
};
