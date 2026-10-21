/**
 * Copyright 2026 One Work
 */

import { Spin } from '@arco-design/web-react';
import { Checklist, Right } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import type { ProcessRunItem } from '../processRuns';
import MessageThinking from './MessageThinking';
import MessageToolGroupSummary from './MessageToolGroupSummary';
import './MessageProcessRun.css';

/** The step the agent is on right now: the running tool, else the open thought, else nothing. */
const liveStepLabel = (run: ProcessRunItem): string => {
  for (let i = run.steps.length - 1; i >= 0; i--) {
    const step = run.steps[i];
    if (step.type === 'tool_summary') {
      const running = normalizeToolMessages(step.messages)
        .toReversed()
        .find((tool) => tool.status === 'running');
      if (running) {
        return running.description && running.description !== running.name
          ? `${running.name} · ${running.description}`
          : running.name;
      }
    } else if (step.content.status !== 'done') {
      return step.content.subject?.trim() ?? '';
    }
  }
  return '';
};

const countSteps = (run: ProcessRunItem): number =>
  run.steps.reduce(
    (total, step) => total + (step.type === 'tool_summary' ? normalizeToolMessages(step.messages).length : 1),
    0
  );

const formatElapsed = (seconds: number, secondUnit: string, minuteUnit: string): string =>
  seconds < 60 ? `${seconds}${secondUnit}` : `${Math.floor(seconds / 60)}${minuteUnit} ${seconds % 60}${secondUnit}`;

/**
 * A run of thoughts and tool calls between two pieces of the agent's text, folded into
 * one line. While the agent is working it names the step it is on and how long the run
 * has been going; once done it says how many steps there were. Click to see the steps.
 */
const MessageProcessRun: React.FC<{ run: ProcessRunItem; active: boolean }> = ({ run, active }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const startedAt = run.created_at || Date.now();
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));

  useEffect(() => {
    if (!active) return;
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const timer = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  const label = useMemo(() => (active ? liveStepLabel(run) : ''), [active, run]);
  const stepCount = useMemo(() => countSteps(run), [run]);
  const secondUnit = t('common.unit.second_short', { defaultValue: 's' });
  const minuteUnit = t('common.unit.minute_short', { defaultValue: 'm' });

  const summary = active
    ? `${label || t('conversation.process.working')} · ${formatElapsed(elapsed, secondUnit, minuteUnit)}`
    : t('conversation.process.done', { count: stepCount });

  return (
    <div className='process-run' data-testid='process-run' data-active={active ? 'true' : 'false'}>
      <div className='process-run__header' onClick={() => setExpanded((open) => !open)}>
        <span className='process-run__icon'>
          {active ? <Spin size={12} /> : <Checklist theme='outline' size='14' />}
        </span>
        <span className='process-run__label' title={summary}>
          {summary}
        </span>
        {active && <span className='process-run__count'>{t('conversation.process.steps', { count: stepCount })}</span>}
        <span className={`process-run__arrow${expanded ? ' process-run__arrow--open' : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      </div>
      {expanded && (
        <div className='process-run__body'>
          {run.steps.map((step) =>
            step.type === 'tool_summary' ? (
              <MessageToolGroupSummary key={step.id} messages={step.messages} />
            ) : (
              <MessageThinking key={step.id} message={step} />
            )
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageProcessRun);
