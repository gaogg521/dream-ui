/**
 * Manual pairing-code fallback — shared by all channel config forms.
 *
 * The pending-pairings list depends on the backend pushing (or the poll
 * returning) the request; when the event is missed or the list is empty
 * the admin still needs a way to authorize a user who already has a code
 * on their end. This input calls the same approve/reject bridge endpoints
 * with a manually typed 6-digit code.
 */

import React, { useState } from 'react';
import { Button, Input, Message } from '@arco-design/web-react';
import { CheckOne, CloseOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';

type ManualPairingInputProps = {
  onApprove: (code: string) => Promise<void> | void;
  onReject: (code: string) => Promise<void> | void;
};

const CODE_LENGTH = 6;

const ManualPairingInput: React.FC<ManualPairingInputProps> = ({ onApprove, onReject }) => {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const normalized = code.trim();
  const isValid = new RegExp(`^\\d{${CODE_LENGTH}}$`).test(normalized);

  const submit = async (action: (code: string) => Promise<void> | void) => {
    if (!isValid) {
      Message.warning(t('settings.assistant.manualPairingInvalid', 'Enter the 6-digit pairing code shown to the user'));
      return;
    }
    setSubmitting(true);
    try {
      await action(normalized);
      setCode('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='mt-12px pt-12px border-t border-border-2'>
      <div className='text-12px text-t-tertiary mb-8px'>
        {t(
          'settings.assistant.manualPairingHint',
          'Request not listed? Enter the pairing code from the user to approve or reject it manually.'
        )}
      </div>
      <div className='flex items-center gap-8px'>
        <Input
          style={{ maxWidth: 160 }}
          value={code}
          maxLength={CODE_LENGTH}
          placeholder={t('settings.assistant.manualPairingPlaceholder', '6-digit code')}
          onChange={(value) => setCode(value.replace(/\D/g, ''))}
        />
        <Button
          type='primary'
          size='small'
          icon={<CheckOne size={14} />}
          disabled={!isValid}
          loading={submitting}
          onClick={() => void submit(onApprove)}
        >
          {t('settings.assistant.approve', 'Approve')}
        </Button>
        <Button
          type='secondary'
          size='small'
          status='danger'
          icon={<CloseOne size={14} />}
          disabled={!isValid || submitting}
          onClick={() => void submit(onReject)}
        >
          {t('settings.assistant.reject', 'Reject')}
        </Button>
      </div>
    </div>
  );
};

export default ManualPairingInput;
