/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What you can do with a finished generation.
 *
 * Without these the feature stopped one step short of useful: the file was on
 * disk, but the card never said where, offered no way to get at it, and no way
 * to ask for another take. Clicking to enlarge was the only affordance.
 *
 * There is deliberately no "save as". The asset is already a real file in the
 * conversation's workspace — revealing it costs one click and no duplicate,
 * whereas a save dialog would copy a file the user already has.
 */

import React, { useState } from 'react';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Copy, Download, FolderOpen, Quote, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { MediaJobView } from '@/common/media/jobView';
import { isShellHostUnreachable } from '@/common/adapter/httpBridge';
import { buildMediaUrl } from '@/common/media/mediaUrl';
import { fileNameOf } from '@/common/media/mediaResultText';
import { startMediaJob } from '@/renderer/hooks/media/mediaJobsTransport';
import { iconColors } from '@/renderer/styles/colors';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { emitter } from '@/renderer/utils/emitter';

const MediaResultActions: React.FC<{ job: MediaJobView }> = ({ job }) => {
  const { t } = useTranslation();
  const [regenerating, setRegenerating] = useState(false);
  // Decides which send box to hand the file to; the event names are per platform.
  const conversationType = useConversationContextSafe()?.type;

  const asset = job.assets?.[0];
  // A failed job has no asset but is exactly where "run it again" matters most —
  // it used to be the one card with no action at all, so the only way to retry
  // was to retype the prompt.
  const canRunAgain = !!job.prompt;
  if (!asset && !canRunAgain) return null;

  const isImage = asset?.kind === 'image';

  const handleCopy = async () => {
    // Unreachable through the UI (the button needs an asset), but this project
    // compiles without strictNullChecks, so the compiler would not have caught
    // it if a caller ever changed that.
    if (!asset) return;
    try {
      // The protocol is registered with `supportFetchAPI`, so the bytes can be
      // read here without ever crossing the message channel (rule D6).
      const response = await fetch(buildMediaUrl(asset.filePath));
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      Message.success(t('conversation.mediaResultCopied'));
    } catch (error) {
      Message.error(t('conversation.mediaResultCopyFailed', { reason: String(error).slice(0, 120) }));
    }
  };

  /**
   * Hand the result to the agent — the one thing the send box's media mode
   * could not do, because it short-circuits the agent entirely and nothing
   * about the generation ever reaches it.
   *
   * Verified 2026-08-07: dream rebuilds its context from its own on-disk
   * session (`<data>/1one/dream-sessions/sessions/<id>/state.json`), and ACP
   * from the CLI process transcript — **not** from the conversation message
   * table. So writing a row into that table would show in the UI and stay
   * invisible to the agent. The attachment channel is the path that actually
   * reaches it: the backend turns pending files into an `[Attached files]`
   * block on the next turn.
   *
   * Attaching on click rather than automatically on completion: the chip is
   * visible and removable, so the user can see what the agent is about to be
   * given. Auto-attaching would silently add cost to the next message and pile
   * up chips during a batch of generations.
   */
  const handleAttach = () => {
    if (!asset || !conversationType) return;
    emitter.emit(`${conversationType}.selected.file.append`, [asset.filePath], job.origin?.conversationId);
  };

  /**
   * Revealing a folder runs on whichever machine answers `/api/shell/*`. From a
   * browser on another machine that is the server's desktop — a window opens
   * where nobody is looking. Downloading is the same intent ("give me the
   * file") expressed in terms the remote case can actually satisfy.
   */
  const shellIsElsewhere = isShellHostUnreachable();

  const handleDownload = () => {
    if (!asset) return;
    const link = document.createElement('a');
    link.href = buildMediaUrl(asset.filePath);
    link.download = fileNameOf(asset.filePath);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleReveal = () => {
    if (!asset) return;
    void ipcBridge.shell.showItemInFolder.invoke(asset.filePath).catch((error: unknown) => {
      Message.error(t('conversation.mediaResultRevealFailed', { reason: String(error).slice(0, 120) }));
    });
  };

  const handleRegenerate = async () => {
    if (regenerating || !job.prompt) return;
    setRegenerating(true);
    try {
      const result = await startMediaJob({
        kind: job.kind,
        prompt: job.prompt,
        // Reproduce the original request rather than a default-shaped guess —
        // "another take of this" is the point, not "something roughly similar".
        params: (job.params ?? {}) as Record<string, unknown>,
        inputUris: job.inputUris ?? [],
        workspaceDir: job.origin?.workspaceDir,
        model: job.model,
        conversationId: job.origin?.conversationId,
      });
      if (!result.job) {
        Message.error(t('conversation.mediaResultRegenerateFailed', { reason: result.error || '' }));
      }
    } catch (error) {
      Message.error(t('conversation.mediaResultRegenerateFailed', { reason: String(error).slice(0, 120) }));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className='flex items-center gap-4px' data-testid='media-result-actions'>
      {isImage && asset && (
        <Button size='mini' type='text' onClick={() => void handleCopy()} data-testid='media-action-copy'>
          <span className='flex items-center gap-4px'>
            <Copy theme='outline' size='13' fill={iconColors.secondary} />
            {t('conversation.mediaResultCopy')}
          </span>
        </Button>
      )}
      {asset && conversationType && (
        <Tooltip content={t('conversation.mediaResultAttachTip')}>
          <Button size='mini' type='text' onClick={handleAttach} data-testid='media-action-attach'>
            <span className='flex items-center gap-4px'>
              <Quote theme='outline' size='13' fill={iconColors.secondary} />
              {t('conversation.mediaResultAttach')}
            </span>
          </Button>
        </Tooltip>
      )}
      {asset && (
        <Button
          size='mini'
          type='text'
          onClick={shellIsElsewhere ? handleDownload : handleReveal}
          data-testid={shellIsElsewhere ? 'media-action-download' : 'media-action-reveal'}
        >
          <span className='flex items-center gap-4px'>
            {shellIsElsewhere ? (
              <Download theme='outline' size='13' fill={iconColors.secondary} />
            ) : (
              <FolderOpen theme='outline' size='13' fill={iconColors.secondary} />
            )}
            {t(shellIsElsewhere ? 'conversation.mediaResultDownload' : 'conversation.mediaResultReveal')}
          </span>
        </Button>
      )}
      {canRunAgain && (
        <Button
          size='mini'
          type='text'
          loading={regenerating}
          onClick={() => void handleRegenerate()}
          data-testid='media-action-regenerate'
        >
          <span className='flex items-center gap-4px'>
            {!regenerating && <Refresh theme='outline' size='13' fill={iconColors.secondary} />}
            {/* Same operation, different question: after a success the user
                wants another take, after a failure they want this one to work. */}
            {t(job.status === 'done' ? 'conversation.mediaResultRegenerate' : 'conversation.mediaResultRetry')}
          </span>
        </Button>
      )}
    </div>
  );
};

export default MediaResultActions;
