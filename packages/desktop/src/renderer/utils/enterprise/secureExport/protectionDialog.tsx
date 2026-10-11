/**
 * Copyright 2026 One Work
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Message, Modal, Radio, Select } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type { EncryptionMode } from './policy';

export type RecipientScope = 'tenant' | 'enterprise' | 'users';

export type ProtectionChoice = {
  encrypt: boolean;
  recipientScope: RecipientScope;
  recipientUserIds: string[];
  /** Days until the package stops opening; `null` = never. */
  expiresInDays: number | null;
};

type ChoiceState = ProtectionChoice;

const EXPIRY_OPTIONS: Array<number | null> = [null, 7, 30];

function ProtectionForm(props: {
  mode: EncryptionMode;
  watermark: boolean;
  fileCount: number;
  initial: ChoiceState;
  onChange: (next: ChoiceState) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = React.useState<ChoiceState>(props.initial);
  const [members, setMembers] = React.useState<
    Array<{ userId: string; displayName?: string | null; username: string }>
  >([]);
  const update = (patch: Partial<ChoiceState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      props.onChange(next);
      return next;
    });
  };
  React.useEffect(() => {
    if (state.recipientScope !== 'users' || members.length > 0) return;
    void ipcBridge.onePlatform.orgMembers
      .invoke()
      .then((list) => setMembers(list ?? []))
      .catch(() => setMembers([]));
  }, [state.recipientScope, members.length]);

  return (
    <div className='flex flex-col gap-12px' data-testid='secure-export-dialog'>
      {props.mode === 'required' ? (
        <Alert type='info' content={t('messages.secureExport.requiredNotice')} />
      ) : (
        <Radio.Group
          direction='vertical'
          value={state.encrypt ? 'encrypted' : 'plain'}
          onChange={(v) => update({ encrypt: v === 'encrypted' })}
        >
          <Radio value='plain' data-testid='secure-export-plain'>
            {t('messages.secureExport.plainOption')}
          </Radio>
          <Radio value='encrypted' data-testid='secure-export-encrypted'>
            {t('messages.secureExport.encryptedOption')}
          </Radio>
        </Radio.Group>
      )}
      {state.encrypt && (
        <>
          <div>
            <div className='mb-6px text-13px font-medium'>{t('messages.secureExport.recipientsLabel')}</div>
            <Radio.Group
              value={state.recipientScope}
              onChange={(v) => update({ recipientScope: v as RecipientScope, recipientUserIds: [] })}
            >
              <Radio value='tenant'>{t('messages.secureExport.scopeTenant')}</Radio>
              <Radio value='enterprise'>{t('messages.secureExport.scopeEnterprise')}</Radio>
              <Radio value='users'>{t('messages.secureExport.scopeUsers')}</Radio>
            </Radio.Group>
            {state.recipientScope === 'users' && (
              <Select
                mode='multiple'
                className='mt-8px w-full'
                placeholder={t('messages.secureExport.pickMembers')}
                value={state.recipientUserIds}
                onChange={(v: string[]) => update({ recipientUserIds: v })}
                showSearch
                filterOption={(input, option) =>
                  String((option as { props?: { children?: unknown } })?.props?.children ?? '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              >
                {members.map((member) => (
                  <Select.Option key={member.userId} value={member.userId}>
                    {member.displayName || member.username}
                  </Select.Option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <div className='mb-6px text-13px font-medium'>{t('messages.secureExport.expiryLabel')}</div>
            <Select
              className='w-full'
              value={state.expiresInDays === null ? 'never' : String(state.expiresInDays)}
              onChange={(v: string) => update({ expiresInDays: v === 'never' ? null : Number(v) })}
            >
              {EXPIRY_OPTIONS.map((days) => (
                <Select.Option key={String(days)} value={days === null ? 'never' : String(days)}>
                  {days === null
                    ? t('messages.secureExport.expiryNever')
                    : t('messages.secureExport.expiryDays', { count: days })}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className='text-12px text-t-secondary'>{t('messages.secureExport.encryptedHint')}</div>
        </>
      )}
      {props.watermark && <div className='text-12px text-t-secondary'>{t('messages.secureExport.watermarkHint')}</div>}
    </div>
  );
}

/**
 * Ask how this export should leave the machine. Resolves `null` when the
 * member cancels. In `required` mode there is no plaintext option to pick.
 */
export function askExportProtection(options: {
  mode: EncryptionMode;
  watermark: boolean;
  fileCount: number;
  t: (key: string, values?: Record<string, unknown>) => string;
}): Promise<ProtectionChoice | null> {
  let current: ChoiceState = {
    encrypt: options.mode !== 'optional',
    recipientScope: 'tenant',
    recipientUserIds: [],
    expiresInDays: null,
  };
  return new Promise((resolve) => {
    Modal.confirm({
      title: options.t('messages.secureExport.dialogTitle'),
      content: (
        <ProtectionForm
          mode={options.mode}
          watermark={options.watermark}
          fileCount={options.fileCount}
          initial={current}
          onChange={(next) => {
            current = next;
          }}
        />
      ),
      okText: options.t('messages.secureExport.confirm'),
      onOk: () => {
        if (current.encrypt && current.recipientScope === 'users' && current.recipientUserIds.length === 0) {
          // Keep the dialog open: an empty named-recipient list opens for nobody but the sender.
          Message.warning(options.t('messages.secureExport.pickMembersRequired'));
          return Promise.reject(new Error('no recipients'));
        }
        resolve({ ...current, encrypt: options.mode === 'required' ? true : current.encrypt });
        return Promise.resolve();
      },
      onCancel: () => resolve(null),
    });
  });
}
