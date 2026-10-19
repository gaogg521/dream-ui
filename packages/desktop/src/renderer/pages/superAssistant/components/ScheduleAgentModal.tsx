/**
 * Schedule digital employee modal — set / disable a cron schedule.
 *
 * Backend: PUT /api/one/employee/agents/:id/schedule with a CronScheduleDto
 * body. The scanner in one-employee crate fires runs based on next_run_at.
 */

import React, { useEffect, useState } from 'react';
import { Form, Input, Message, Modal, Radio, Select, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ICronPushTarget } from '@/common/adapter/ipcBridge';
import PushTargetField from '@renderer/components/scenes/PushTargetField';
import type { CronScheduleDto, PersonalAgent } from '@/common/types/employee/employeeTypes';

type ScheduleAgentModalProps = {
  visible: boolean;
  agent: PersonalAgent | null;
  onClose: () => void;
  onSaved: () => void;
};

type ScheduleKind = 'none' | 'every' | 'cron';
const RESULT_NOTIFICATION_PLATFORMS = ['weixin', 'wecom', 'lark', 'dingtalk', 'telegram'] as const;

const TZ_OPTIONS = [
  { label: 'UTC', value: 'UTC' },
  { label: 'Asia/Shanghai', value: 'Asia/Shanghai' },
  { label: 'Asia/Tokyo', value: 'Asia/Tokyo' },
  { label: 'America/Los_Angeles', value: 'America/Los_Angeles' },
  { label: 'America/New_York', value: 'America/New_York' },
  { label: 'Europe/London', value: 'Europe/London' },
];

const ScheduleAgentModal: React.FC<ScheduleAgentModalProps> = ({ visible, agent, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ScheduleKind>('none');
  const [everyMinutes, setEveryMinutes] = useState('1');
  const [cronExpr, setCronExpr] = useState('0 9 * * *');
  const [tz, setTz] = useState('Asia/Shanghai');
  const [enabled, setEnabled] = useState(true);
  const [task, setTask] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scheduleEdited, setScheduleEdited] = useState(false);
  const [pushTarget, setPushTarget] = useState<ICronPushTarget | null>(null);
  const [notificationReady, setNotificationReady] = useState(false);
  const [notificationValid, setNotificationValid] = useState(false);
  const editSchedule =
    <T,>(setValue: React.Dispatch<React.SetStateAction<T>>) =>
    (value: T) => {
      setScheduleEdited(true);
      setValue(value);
    };

  useEffect(() => {
    if (!visible || !agent) return;
    let current = true;
    setNotificationReady(false);
    setNotificationValid(false);
    setPushTarget(null);
    ipcBridge.personalAgent.getNotification
      .invoke({ agentId: agent.id })
      .then((settings) => {
        if (!current) return;
        setPushTarget(settings.target);
        setNotificationReady(true);
      })
      .catch((error: unknown) => {
        if (current) Message.error(t('common.superAssistant.scheduleSaveFailed') + ': ' + String(error));
      });
    return () => {
      current = false;
    };
  }, [visible, agent?.id, t]);
  // A company employee keeps its identity in `persona` and has no run
  // instructions, so for it the task is the only thing a scheduled run has.
  const taskRequired = agent?.origin === 'team';

  useEffect(() => {
    if (!visible || !agent) {
      return;
    }
    setSubmitting(false);
    setScheduleEdited(false);
    // A schedule being created is meant to run; only an existing one carries a
    // switch position worth keeping (a never-scheduled employee reads `false`).
    setEnabled(agent.schedule ? agent.scheduleEnabled : true);
    setTask(agent.scheduleTask ?? '');
    if (!agent.schedule) {
      setKind('none');
      setEveryMinutes('1');
      setCronExpr('0 9 * * *');
      setTz('Asia/Shanghai');
      return;
    }
    const sched = agent.schedule;
    if (sched.kind === 'every') {
      setKind('every');
      setEveryMinutes(String(Math.max(1, Math.round(sched.every_ms / 60_000))));
    } else if (sched.kind === 'cron') {
      setKind('cron');
      setCronExpr(sched.expr);
      setTz(sched.tz ?? 'Asia/Shanghai');
    } else {
      setKind('none');
    }
  }, [visible, agent]);

  const handleSubmit = async () => {
    if (!agent || !notificationReady || !notificationValid) {
      return;
    }
    if (scheduleEdited && kind !== 'none' && taskRequired && !task.trim()) {
      Message.warning(t('common.superAssistant.scheduleTaskRequired'));
      return;
    }
    setSubmitting(true);
    try {
      let schedule: CronScheduleDto | undefined;
      if (kind === 'every') {
        const minutes = Math.max(1, Number(everyMinutes) || 1);
        schedule = { kind: 'every', every_ms: minutes * 60_000 };
      } else if (kind === 'cron') {
        const expr = cronExpr.trim();
        if (scheduleEdited && !expr) {
          Message.warning(t('common.superAssistant.cronExprRequired', { defaultValue: '请输入 cron 表达式' }));
          setSubmitting(false);
          return;
        }
        schedule = { kind: 'cron', expr, tz };
      }
      await ipcBridge.personalAgent.setNotification.invoke({ agentId: agent.id, target: pushTarget });
      // A member may configure their own recipient without permission to edit
      // a shared employee's schedule. Preserve untouched schedules exactly.
      if (scheduleEdited) {
        await ipcBridge.personalAgent.setSchedule.invoke({
          agentId: agent.id,
          schedule: {
            schedule,
            enabled: kind === 'none' ? false : enabled,
            task: kind === 'none' ? undefined : task.trim() || undefined,
          },
        });
      }
      Message.success(t('common.saveSuccess'));
      onSaved();
      onClose();
    } catch (error) {
      Message.error(t('common.superAssistant.scheduleSaveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('common.superAssistant.scheduleTitle', { defaultValue: '定时调度' })}
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okButtonProps={{ disabled: !notificationReady || !notificationValid }}
      maskClosable={false}
    >
      <Form layout='vertical'>
        {notificationReady && (
          <PushTargetField
            value={pushTarget}
            onChange={setPushTarget}
            onValidityChange={setNotificationValid}
            supportedPlatforms={RESULT_NOTIFICATION_PLATFORMS}
          />
        )}
        <Form.Item label={t('common.superAssistant.scheduleKind', { defaultValue: '调度类型' })}>
          <Radio.Group value={kind} onChange={(val) => editSchedule(setKind)(val as ScheduleKind)}>
            <Radio value='none'>{t('common.superAssistant.kindNone', { defaultValue: '不调度' })}</Radio>
            <Radio value='every'>{t('common.superAssistant.kindEvery', { defaultValue: '间隔' })}</Radio>
            <Radio value='cron'>{t('common.superAssistant.kindCron', { defaultValue: 'Cron 表达式' })}</Radio>
          </Radio.Group>
        </Form.Item>
        {kind === 'every' ? (
          <Form.Item label={t('common.superAssistant.fieldEveryMinutes', { defaultValue: '间隔（分钟）' })}>
            <Input value={everyMinutes} onChange={editSchedule(setEveryMinutes)} placeholder='1' />
          </Form.Item>
        ) : null}
        {kind === 'cron' ? (
          <>
            <Form.Item label={t('common.superAssistant.fieldCronExpr', { defaultValue: 'Cron 表达式' })}>
              <Input value={cronExpr} onChange={editSchedule(setCronExpr)} placeholder='0 9 * * *' />
            </Form.Item>
            <Form.Item label={t('common.superAssistant.fieldTz', { defaultValue: '时区' })}>
              <Select value={tz} onChange={editSchedule(setTz)} options={TZ_OPTIONS} />
            </Form.Item>
            <div className='mb-12px rounded-6px bg-fill-1 p-8px text-12px text-t-secondary'>
              <div className='mb-4px font-500 text-t-primary'>
                {t('common.superAssistant.settingsScheduleTitle', { defaultValue: '定时调度说明' })}
              </div>
              <div>
                {t('common.superAssistant.settingsScheduleDesc', {
                  defaultValue:
                    '调度格式：At（绝对时间戳）、Every（毫秒间隔）、Cron（标准 cron 表达式 + 可选时区）。扫描器每 30s 巡检一次。',
                })}
              </div>
              <div className='mt-6px'>
                <code className='rd-2px bg-fill-3 px-4px text-t-primary'>{'{"kind":"every","every_ms":60000}'}</code>
                <span className='ml-4px'>— 每 60s</span>
              </div>
              <div className='mt-2px'>
                <code className='rd-2px bg-fill-3 px-4px text-t-primary'>
                  {'{"kind":"cron","expr":"0 9 * * *","tz":"Asia/Shanghai"}'}
                </code>
                <span className='ml-4px'>— 每天 9:00 上海时区</span>
              </div>
            </div>
          </>
        ) : null}
        {kind !== 'none' ? (
          <Form.Item
            label={t('common.superAssistant.fieldScheduleTask')}
            extra={taskRequired ? undefined : t('common.superAssistant.scheduleTaskOptionalHint')}
            required={taskRequired}
          >
            <Input.TextArea
              value={task}
              onChange={editSchedule(setTask)}
              rows={3}
              placeholder={t('common.superAssistant.scheduleTaskPlaceholder')}
            />
          </Form.Item>
        ) : null}
        {kind !== 'none' ? (
          <Form.Item label={t('common.superAssistant.fieldEnabled', { defaultValue: '启用' })}>
            <Switch checked={enabled} onChange={editSchedule(setEnabled)} />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
};

export default ScheduleAgentModal;
