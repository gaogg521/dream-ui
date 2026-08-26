/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One media job: progress while it runs, the media itself once it lands.
 *
 * This is the safety net the design calls for — it is driven by the job engine,
 * not by the agent, so it keeps working when the CLI cuts the tool call off
 * mid-generation and the conversation never receives a result.
 */

import React from 'react';
import { Button, Progress, Tag, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { isActiveStatus, type MediaJobView } from '@/common/media/jobView';
import { buildMediaUrl } from '@/common/media/mediaUrl';
import { fileNameOf } from '@/common/media/mediaResultText';
import { meterMediaJob } from '@/common/media/pricing';
import { useMediaCost } from '@renderer/hooks/media/useMediaCost';
import { classifyMediaFailure, useMediaFailureAdvice } from '@renderer/hooks/media/useMediaFailureAdvice';
import { requestModelSettingsHighlight } from '@renderer/hooks/media/mediaSettingsHighlight';
import GeneratedMediaView from './GeneratedMediaView';
import MediaResultActions from './MediaResultActions';

const STATUS_COLOR: Record<string, string> = {
  done: 'green',
  failed: 'red',
  timeout: 'red',
  cancelled: 'gray',
};

const MediaJobCard: React.FC<{
  job: MediaJobView;
  onCancel?: (jobId: string) => void;
}> = ({ job, onCancel }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const active = isActiveStatus(job.status);

  // Metered exactly as the usage report meters it, so this figure and the one
  // in the company ledger are the same number by construction.
  const units = meterMediaJob(job);
  const cost = useMediaCost({
    kind: job.kind,
    model: job.model,
    providerId: job.providerId,
    count: units.count,
    durationSeconds: units.durationSeconds,
    variant: 'actual',
  });
  const advice = useMediaFailureAdvice(job.error);
  // Only `notRouted` has an actual fix ("go change the setting") rather than
  // "try again" or "wait" — that is the one worth a direct jump to Settings.
  const canOpenModelSettings = classifyMediaFailure(job.error) === 'notRouted' && !!job.providerId;

  const assets = (job.assets || []).map((asset) => ({
    kind: asset.kind,
    filePath: asset.filePath,
    fileName: fileNameOf(asset.filePath),
  }));

  return (
    <div className='rd-8px border border-solid b-color-border-2 bg-2 p-12px flex flex-col gap-8px'>
      <div className='flex items-center gap-8px'>
        <span className='text-13px text-t-primary'>
          {job.kind === 'video' ? t('conversation.mediaJobVideo') : t('conversation.mediaJobImage')}
        </span>
        <Tag size='small' color={STATUS_COLOR[job.status]}>
          {t(`conversation.mediaJobStatus_${job.status}` as never)}
        </Tag>
        <span className='text-12px text-t-secondary truncate'>{job.model}</span>
        {active && onCancel && (
          <Button size='mini' type='text' className='ml-auto' onClick={() => onCancel(job.jobId)}>
            {t('common.cancel')}
          </Button>
        )}
      </div>

      {active && (
        // Percent is optional — most task APIs report a stage, not a number —
        // so fall back to an indeterminate bar rather than faking progress.
        <Progress
          size='small'
          status='normal'
          percent={job.progress?.percent ?? 0}
          animation={job.progress?.percent === undefined}
          showText={job.progress?.percent !== undefined}
        />
      )}

      {active && job.progress?.stage && (
        <span className='text-12px text-t-secondary'>
          {t(`conversation.mediaJobStage_${job.progress.stage}` as never)}
        </span>
      )}

      {/* What was asked for. A media request never becomes a conversation
          message, so without this the card can only name its model and two
          attempts on the same model read as duplicates of each other. */}
      {job.prompt && (
        <span className='text-13px text-t-primary line-clamp-2 break-words' title={job.prompt}>
          {job.prompt}
        </span>
      )}

      {/* The upstream text is whatever the provider said, in whatever language
          it says it — labelling it as theirs is honest, where showing it raw
          reads as untranslated UI copy. */}
      {job.error && (
        <div className='flex flex-col gap-2px'>
          <span className='text-12px text-t-secondary'>{t('conversation.mediaJobErrorFromProvider')}</span>
          <span className='text-12px text-danger break-all'>{job.error}</span>
          {/* An attributed error still says only what went wrong. This is the
              only line on the card that says what to do about it — and it is
              absent rather than generic when the failure is unrecognized. */}
          {advice && (
            <span className='text-12px text-t-secondary' data-testid='media-failure-advice'>
              {advice}
            </span>
          )}
          {/* Blind retry on a `notRouted` failure fails again identically —
              this is the one case where "go fix the setting" beats "retry". */}
          {canOpenModelSettings && (
            <Button
              size='mini'
              type='text'
              className='self-start !px-0 !h-auto'
              data-testid='media-open-model-settings'
              onClick={() => {
                requestModelSettingsHighlight(job.providerId!);
                navigate('/settings/model');
              }}
            >
              {t('conversation.mediaJobOpenModelSettings')}
            </Button>
          )}
        </div>
      )}

      {/* The images this run started from. Without them an image-to-image or
          image-to-video result is just an image with no visible relationship to
          whatever the user handed in — the prompt alone ("根据这张图…") refers to
          something the card never shows. The job has carried `inputUris` all
          along; only the display was missing. */}
      {job.inputUris && job.inputUris.length > 0 && (
        <div className='flex flex-col gap-4px' data-testid='media-input-refs'>
          <span className='text-12px text-t-tertiary'>{t('conversation.mediaJobSourceImages')}</span>
          <div className='flex items-center gap-6px flex-wrap'>
            {job.inputUris.map((uri) => (
              <img
                key={uri}
                src={buildMediaUrl(uri)}
                alt=''
                title={uri}
                className='w-56px h-56px object-cover rd-4px b-1px b-solid b-line-2'
              />
            ))}
          </div>
        </div>
      )}

      <GeneratedMediaView assets={assets} />

      {/* Actions belong on any settled job, not only a successful one: a failed
          card offered nothing at all, so retrying meant retyping the prompt.
          The cost stays gated on a real result — a job that produced nothing
          has nothing to price, and "cost unknown" there would be noise. */}
      {!active && (assets.length > 0 || !!job.prompt) && (
        <div className='flex items-center gap-8px flex-wrap'>
          <MediaResultActions job={job} />
          {/* What it cost, next to what you can do with it — the two questions
              people have once an image lands. */}
          {job.status === 'done' && assets.length > 0 && cost && (
            <Tooltip content={cost.tooltip}>
              <span
                className={`text-12px ${cost.known ? 'text-t-secondary' : 'text-t-tertiary'}`}
                data-testid='media-cost'
              >
                {cost.text}
              </span>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
};

export default MediaJobCard;
