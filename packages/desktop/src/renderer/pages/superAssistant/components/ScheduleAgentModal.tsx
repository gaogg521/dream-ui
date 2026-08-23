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
import type { CronScheduleDto, PersonalAgent } from '@/common/types/employee/employeeTypes';

type ScheduleAgentModalProps = {
  visible: boolean;
  agent: PersonalAgent | null;
  onClose: () => void;
  onSaved: () => void;
};

type ScheduleKind = 'none' | 'every' | 'cron';

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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible || !agent) {
      return;
    }
    setSubmitting(false);
    setEnabled(agent.scheduleEnabled);
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
    if (!agent) {
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
        if (!expr) {
          Message.warning(t('common.superAssistant.cronExprRequired', { defaultValue: '请输入 cron 表达式' }));
          setSubmitting(false);
          return;
        }
        schedule = { kind: 'cron', expr, tz };
      }
      await ipcBridge.personalAgent.setSchedule.invoke({
        agentId: agent.id,
        schedule: { schedule, enabled: kind === 'none' ? false : enabled },
      });
      Message.success(t('common.superAssistant.scheduleSaved', { defaultValue: '调度已保存' }));
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
      maskClosable={false}
    >
      <Form layout='vertical'>
        <Form.Item label={t('common.superAssistant.scheduleKind', { defaultValue: '调度类型' })}>
          <Radio.Group value={kind} onChange={(val) => setKind(val as ScheduleKind)}>
            <Radio value='none'>{t('common.superAssistant.kindNone', { defaultValue: '不调度' })}</Radio>
            <Radio value='every'>{t('common.superAssistant.kindEvery', { defaultValue: '间隔' })}</Radio>
            <Radio value='cron'>{t('common.superAssistant.kindCron', { defaultValue: 'Cron 表达式' })}</Radio>
          </Radio.Group>
        </Form.Item>
        {kind === 'every' ? (
          <Form.Item label={t('common.superAssistant.fieldEveryMinutes', { defaultValue: '间隔（分钟）' })}>
            <Input value={everyMinutes} onChange={setEveryMinutes} placeholder='1' />
          </Form.Item>
        ) : null}
        {kind === 'cron' ? (
          <>
            <Form.Item label={t('common.superAssistant.fieldCronExpr', { defaultValue: 'Cron 表达式' })}>
              <Input value={cronExpr} onChange={setCronExpr} placeholder='0 9 * * *' />
            </Form.Item>
            <Form.Item label={t('common.superAssistant.fieldTz', { defaultValue: '时区' })}>
              <Select value={tz} onChange={setTz} options={TZ_OPTIONS} />
            </Form.Item>
            <div className='mb-12px rounded-6px bg-fill-1 p-8px text-12px text-t-secondary'>
              <div className='mb-4px font-500 text-t-primary'>
                {t('common.superAssistant.settingsScheduleTitle', { defaultValue: '定时调度说明' })}
              </div>
              <div>
                {t('common.superAssistant.settingsScheduleDesc', {
                  defaultValue:
                    '调度格式与上游 aionui-cron 一致：At（绝对时间戳）、Every（毫秒间隔）、Cron（标准 cron 表达式 + 可选时区）。扫描器每 30s 巡检一次。',
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
          <Form.Item label={t('common.superAssistant.fieldEnabled', { defaultValue: '启用' })}>
            <Switch checked={enabled} onChange={setEnabled} />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
};

export default ScheduleAgentModal;
