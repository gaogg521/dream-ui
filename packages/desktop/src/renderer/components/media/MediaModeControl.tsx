/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The media-generation controls that sit in the send box's tool row.
 *
 * Deliberately a mode on the existing input rather than a separate page: it
 * shares one conversation, one history and one input box, so switching back is
 * just talking again. A dedicated generation surface would become a second
 * product line inside the app, with its own history the chat cannot see.
 *
 * Two controls, mirroring what people expect from generation tools: a mode
 * switch (off / image / video) and a chip that opens the model's own parameters
 * (`MediaParamsPanel` derives those from the catalog, so the chip never offers
 * something the selected model would reject).
 */

import React, { useMemo } from 'react';
import { Dropdown, Menu, Tooltip, Trigger } from '@arco-design/web-react';
import { Caution, Close, Down, Message, Picture, VideoTwo } from '@icon-park/react';
import styles from './MediaModeControl.module.css';
import { useTranslation } from 'react-i18next';
import type { MediaGenParams } from '@/common/media/types';
import type { MediaModelSpec } from '@/common/media/catalog/types';
import type { DeclaredMediaModel } from '@/common/media/declaredModel';
import { useMediaCost } from '@renderer/hooks/media/useMediaCost';
import { useAutoEndpointWarning } from '@renderer/hooks/media/useAutoEndpointWarning';
import { requestModelSettingsHighlight } from '@renderer/hooks/media/mediaSettingsHighlight';
import MediaParamsPanel from './MediaParamsPanel';
import RuntimeSelectorPill from '@/renderer/components/agent/RuntimeSelectorPill';
import { RuntimeSelectorModelList } from '@/renderer/components/agent/runtimeSelectorOptions';
import { useNavigate } from 'react-router-dom';
import { iconColors } from '@/renderer/styles/colors';

/** Composite id so the shared grouped list can track selection across providers. */
const MODEL_ID_SEP = '::';

export type MediaMode = 'off' | 'image' | 'video';

type Props = {
  mode: MediaMode;
  onModeChange: (mode: MediaMode) => void;
  /** Model that will run, once resolved; shown so the choice is never implicit. */
  model?: string;
  /** Provider the model belongs to, so the cost uses that provider's price. */
  providerId?: string;
  /**
   * Models the user can pick for the active kind. Empty means none is declared
   * as this kind yet — the pill then points at Settings > Models instead.
   */
  models?: DeclaredMediaModel[];
  /** Pick a model for the active kind. */
  onModelChange?: (providerId: string, model: string) => void;
  spec: MediaModelSpec | null;
  params: MediaGenParams;
  onParamsChange: (next: MediaGenParams) => void;
  disabled?: boolean;
};

/** Compact summary of the active parameters, so the chip says what it will do. */
const summarize = (params: MediaGenParams, defaultAudio?: boolean): string[] => {
  const parts: string[] = [];
  if (params.aspectRatio) parts.push(params.aspectRatio);
  if (params.size) parts.push(params.size);
  if (params.resolution) parts.push(params.resolution);
  if (params.durationSeconds) parts.push(`${params.durationSeconds}s`);
  if (params.quality) parts.push(params.quality);
  if (params.n && params.n > 1) parts.push(`×${params.n}`);
  // Audio belongs here for the same reason as the rest: it changes what gets
  // produced and, on some vendors, what it costs. An untouched setting resolves
  // to the model's own default (`spec.defaults.generateAudio`) — shown too, so
  // the chip reflects what will actually be sent.
  const effectiveAudio = params.generateAudio ?? defaultAudio;
  if (effectiveAudio !== undefined) parts.push(effectiveAudio ? '♪' : '♪✕');
  return parts;
};

const MediaModeControl: React.FC<Props> = ({
  mode,
  onModeChange,
  model,
  providerId,
  models = [],
  onModelChange,
  spec,
  params,
  onParamsChange,
  disabled,
}) => {
  const { t } = useTranslation();
  // Routing, not the settings modal. Mounting `SettingsModal` from this control
  // pulled the whole settings surface — theme bootstrap and a client-settings
  // fetch — into the send box's tool row, which took this component's own test
  // suite down with it. `FileAttachButton`, two files over, already navigates
  // for the same purpose.
  const navigate = useNavigate();
  const summary = useMemo(() => summarize(params, spec?.defaults?.generateAudio), [params, spec]);

  // Provider-grouped model list for the picker, in the same shape the
  // conversation header dropdown feeds `RuntimeSelectorModelList`.
  const modelGroups = useMemo(() => {
    const byProvider = new Map<string, { key: string; title: string; models: { id: string; label: string }[] }>();
    for (const item of models) {
      const group = byProvider.get(item.providerId) ?? {
        key: item.providerId,
        title: item.providerName,
        models: [],
      };
      group.models.push({ id: `${item.providerId}${MODEL_ID_SEP}${item.model}`, label: item.model });
      byProvider.set(item.providerId, group);
    }
    return [...byProvider.values()];
  }, [models]);
  const currentModelId = providerId && model ? `${providerId}${MODEL_ID_SEP}${model}` : null;
  const handleModelSelect = (id: string) => {
    const at = id.indexOf(MODEL_ID_SEP);
    if (at < 0 || !onModelChange) return;
    onModelChange(id.slice(0, at), id.slice(at + MODEL_ID_SEP.length));
  };

  // Priced off the parameters actually staged, so changing the count or the
  // duration moves the number before the money is spent rather than after.
  const cost = useMediaCost({
    kind: mode === 'video' ? 'video' : 'image',
    model,
    providerId,
    count: params.n ?? 1,
    durationSeconds: params.durationSeconds ?? spec?.defaults?.durationSeconds,
    // Carries the chosen resolution, so a per-resolution price is used the
    // moment the user changes the tier in the parameter panel.
    params,
    variant: 'estimate',
  });

  // Second line of defence for a protocol the catalog guessed: the executor
  // retries the sibling style on a failed submission, but saying so up front
  // is cheaper than a failed generation the user has to interpret.
  const endpointWarning = useAutoEndpointWarning(mode === 'video' ? 'video' : 'image', providerId, model);

  const modeLabel =
    mode === 'image'
      ? t('conversation.mediaModeImage')
      : mode === 'video'
        ? t('conversation.mediaModeVideo')
        : t('conversation.mediaModeOff');

  // One icon per mode. This used to be a single `video ? VideoTwo : Picture`
  // ternary, which quietly lumped `off` in with `image` — so the collapsed
  // trigger sat there in chat mode wearing the picture icon, identical to the
  // "image generation" entry it was supposed to contrast with. Three modes
  // need three icons; once the row is crowded the icon is the fastest thing to
  // read, and two modes sharing one made it useless.
  //
  // Declared above `modeMenu` on purpose: the menu calls it while building its
  // children, so defining it below would hit the temporal dead zone.
  const renderModeIcon = (value: MediaMode) => {
    const Icon = value === 'image' ? Picture : value === 'video' ? VideoTwo : Message;
    return <Icon theme='outline' size='14' fill={iconColors.secondary} />;
  };
  const modeIcon = renderModeIcon(mode);

  // The same icons repeat in the menu, so the row the user picks and the pill
  // they end up looking at are recognisably the same thing.
  const modeMenu = (
    <Menu onClickMenuItem={(key) => onModeChange(key as MediaMode)}>
      <Menu.Item key='off'>
        <span className='inline-flex items-center gap-8px'>
          {renderModeIcon('off')}
          {t('conversation.mediaModeOff')}
        </span>
      </Menu.Item>
      <Menu.Item key='image'>
        <span className='inline-flex items-center gap-8px'>
          {renderModeIcon('image')}
          {t('conversation.mediaModeImage')}
        </span>
      </Menu.Item>
      <Menu.Item key='video'>
        <span className='inline-flex items-center gap-8px'>
          {renderModeIcon('video')}
          {t('conversation.mediaModeVideo')}
        </span>
      </Menu.Item>
    </Menu>
  );

  // Every other control in this tool row is a `RuntimeSelectorPill` — a round
  // `sendbox-model-btn`. These were bare Arco buttons, so they rendered as
  // square boxes wedged between the round model and permission pills.

  return (
    <div className='flex items-center gap-6px min-w-0'>
      <Dropdown droplist={modeMenu} trigger='click' position='tl' disabled={disabled}>
        <RuntimeSelectorPill
          testId='media-mode-pill'
          className='sendbox-model-btn agent-mode-compact-pill'
          label={modeLabel}
          leading={modeIcon}
          trailing={<Down theme='outline' size='12' fill={iconColors.secondary} className='shrink-0' />}
          disabled={disabled}
          // Filled only while a generation mode is on: the next Enter spends
          // money, so the state has to read differently at a glance. Green
          // rather than the primary blue — blue is what every other pill in
          // this row uses, so it read as "selected", not as "armed".
          type={mode === 'off' ? 'secondary' : 'primary'}
          status={mode === 'off' ? undefined : 'success'}
        />
      </Dropdown>

      {/* Model picker. The kind is declared in Settings > Models; this is where
          the user says which of those declared models the next generation runs
          on. Empty list → the pill links to Settings > Models rather than
          opening an empty dropdown. */}
      {mode !== 'off' &&
        (modelGroups.length > 0 ? (
          <Dropdown
            trigger='click'
            position='bl'
            droplist={
              <Menu>
                <RuntimeSelectorModelList
                  groups={modelGroups}
                  currentModelId={currentModelId}
                  onSelect={handleModelSelect}
                />
              </Menu>
            }
            disabled={disabled}
          >
            <RuntimeSelectorPill
              testId='media-model-pill'
              className='sendbox-model-btn agent-mode-compact-pill'
              label={model || t('conversation.welcome.selectModel')}
              trailing={<Down theme='outline' size='12' fill={iconColors.secondary} className='shrink-0' />}
              disabled={disabled}
            />
          </Dropdown>
        ) : (
          <Tooltip
            content={t(mode === 'video' ? 'conversation.mediaNoVideoModelHint' : 'conversation.mediaNoImageModelHint')}
          >
            <RuntimeSelectorPill
              testId='media-model-none'
              className='sendbox-model-btn agent-mode-compact-pill'
              label={t(
                mode === 'video' ? 'conversation.mediaNoVideoModelTitle' : 'conversation.mediaNoImageModelTitle'
              )}
              onClick={() => void navigate('/settings/model')}
              disabled={disabled}
            />
          </Tooltip>
        ))}

      {mode !== 'off' && (
        <Trigger
          popup={() => (
            <div className='bg-2 border border-solid b-color-border-2 rd-8px p-12px shadow-md'>
              <MediaParamsPanel
                spec={spec}
                value={params}
                onChange={onParamsChange}
                kind={mode === 'video' ? 'video' : 'image'}
                model={model}
                onConfigureModel={() => void navigate('/settings/model')}
              />
            </div>
          )}
          trigger='click'
          // Opens downward by default, like the reference-image picker on the
          // "+" button: on the Guid welcome page there is open space below the
          // pill row, and popping upward there covered the welcome copy above
          // it instead. `autoFitPosition` (Arco default) still flips this to
          // open upward when the composer sits at the bottom of the viewport
          // (the normal conversation page), so this is a preference, not a
          // fixed direction.
          position='bl'
          // A gap, so the panel does not sit flush on the pill row it came
          // from — keeping that row visible is what tells the user where the
          // panel is anchored. Height is the other half of this — see the
          // grid columns in MediaParamsPanel.
          popupAlign={{ bottom: 8 }}
        >
          <RuntimeSelectorPill
            testId='media-params-pill'
            className={`sendbox-model-btn agent-mode-compact-pill ${styles.paramsPill}`}
            /* Parameters only — the model now has its own pill to the left. */
            label={summary.filter(Boolean).join(' · ') || t('conversation.mediaParamsOpen')}
          />
        </Trigger>
      )}

      {/* What this is about to cost. Placed next to the parameters because they
          are what changes it — a count of four is four times the price, and
          that ought to be visible at the moment it is chosen.

          Clickable exactly when declaring a price would replace the figure with
          an exact one. The tooltip has always ended with "go to Settings >
          Models and fill in the unit price", but that field sits behind
          Settings > Models > expand the provider > edit the model > declare it
          as image/video first — deep enough that naming it in a sentence is not
          the same as offering it. Same one-shot highlight intent the failed-job
          card uses, so the target row is scrolled to and marked on arrival. */}
      {mode !== 'off' && cost && (
        <Tooltip content={cost.tooltip}>
          {cost.actionable && providerId ? (
            <span
              role='button'
              tabIndex={0}
              className={`text-12px whitespace-nowrap cursor-pointer underline decoration-dotted underline-offset-2 ${
                cost.known ? 'text-t-secondary' : 'text-t-tertiary'
              }`}
              data-testid='media-cost-estimate'
              onClick={() => {
                requestModelSettingsHighlight(providerId);
                navigate('/settings/model');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                requestModelSettingsHighlight(providerId);
                navigate('/settings/model');
              }}
            >
              {cost.text}
            </span>
          ) : (
            <span
              className={`text-12px whitespace-nowrap ${cost.known ? 'text-t-secondary' : 'text-t-tertiary'}`}
              data-testid='media-cost-estimate'
            >
              {cost.text}
            </span>
          )}
        </Tooltip>
      )}

      {/* The guessed-protocol hint. An icon rather than a line of text: this row
          already overflows onto the model selector when it grows (the reason
          MediaModeControl.module.css constrains it), and the explanation is
          long enough that it belongs in a tooltip either way. */}
      {mode !== 'off' && endpointWarning && (
        <Tooltip content={endpointWarning}>
          <span className='inline-flex items-center' data-testid='media-endpoint-warning'>
            <Caution theme='outline' size='12' fill={iconColors.warning} />
          </span>
        </Tooltip>
      )}

      {/* An explicit way out. The mode is sticky on purpose — iterating on a
          prompt is the normal loop — but that makes the next message a
          generation too, and generations cost money. One click back to talking
          has to be visible, not buried in the mode dropdown. */}
      {mode !== 'off' && (
        <Tooltip content={t('conversation.mediaModeExit')}>
          <RuntimeSelectorPill
            testId='media-mode-exit'
            className='sendbox-model-btn agent-mode-compact-pill !px-8px'
            aria-label={t('conversation.mediaModeExit')}
            leading={<Close theme='outline' size='12' fill={iconColors.secondary} />}
            onClick={() => onModeChange('off')}
            disabled={disabled}
          />
        </Tooltip>
      )}
    </div>
  );
};

export default MediaModeControl;
