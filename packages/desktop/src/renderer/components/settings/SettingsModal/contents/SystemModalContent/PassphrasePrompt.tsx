/**
 * Copyright 2026 One Work
 */

/**
 * Asks for the passphrase that seals — or opens — a backup archive.
 *
 * A component with its own state rather than an input dropped inside
 * `Modal.confirm`: that dialog's `onOk` cannot see a value it does not own, and
 * the confirmation field has to be able to refuse the dialog without closing
 * it. Both are much clearer as ordinary React state.
 *
 * Two modes, because the two directions need different things. Creating an
 * archive asks twice — a typo in a passphrase that is never recoverable would
 * otherwise turn the backup into a file nobody can open, and the person would
 * not find out until the day they needed it. Opening one asks once: the archive
 * itself is the check.
 */

import { Alert, Input, Modal, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Kept in step with `MIN_PASSPHRASE_LEN` in dream-core's `backup_crypto`. */
export const MIN_PASSPHRASE_LENGTH = 8;

type Props = {
  visible: boolean;
  /** `create` asks twice and warns; `open` asks once. */
  mode: 'create' | 'open';
  onCancel: () => void;
  onSubmit: (passphrase: string) => void;
  /** Shown under the field — e.g. the backend rejecting the passphrase. */
  error?: string;
  busy?: boolean;
};

const PassphrasePrompt: React.FC<Props> = ({ visible, mode, onCancel, onSubmit, error, busy }) => {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [touched, setTouched] = useState(false);

  // A closed dialog must not keep the passphrase: reopening it should not show
  // what was typed last time, and nothing should hold it longer than the one
  // request that needs it.
  useEffect(() => {
    if (!visible) {
      setPassphrase('');
      setConfirmation('');
      setTouched(false);
    }
  }, [visible]);

  const creating = mode === 'create';
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = creating && confirmation.length > 0 && confirmation !== passphrase;
  const ready = passphrase.length >= MIN_PASSPHRASE_LENGTH && (!creating || confirmation === passphrase);

  const submit = useCallback(() => {
    setTouched(true);
    if (!ready) return;
    onSubmit(passphrase);
  }, [onSubmit, passphrase, ready]);

  const hint = touched || tooShort || mismatch;

  return (
    <Modal
      visible={visible}
      title={t(creating ? 'settings.backup.passphraseSetTitle' : 'settings.backup.passphraseEnterTitle')}
      onCancel={onCancel}
      onOk={submit}
      okButtonProps={{ disabled: !ready, loading: busy }}
      confirmLoading={busy}
      autoFocus={false}
      focusLock
    >
      <div className='flex flex-col gap-12px'>
        <Typography.Text type='secondary' className='text-12px'>
          {t(creating ? 'settings.backup.passphraseSetHint' : 'settings.backup.passphraseEnterHint')}
        </Typography.Text>

        <Input.Password
          value={passphrase}
          onChange={setPassphrase}
          placeholder={t('settings.backup.passphrasePlaceholder')}
          autoComplete='new-password'
          onPressEnter={creating ? undefined : submit}
        />
        {creating ? (
          <Input.Password
            value={confirmation}
            onChange={setConfirmation}
            placeholder={t('settings.backup.passphraseConfirmPlaceholder')}
            autoComplete='new-password'
            onPressEnter={submit}
          />
        ) : null}

        {hint && tooShort ? (
          <Typography.Text type='error' className='text-12px'>
            {t('settings.backup.passphraseTooShort', { min: MIN_PASSPHRASE_LENGTH })}
          </Typography.Text>
        ) : null}
        {hint && mismatch ? (
          <Typography.Text type='error' className='text-12px'>
            {t('settings.backup.passphraseMismatch')}
          </Typography.Text>
        ) : null}
        {error ? (
          <Typography.Text type='error' className='text-12px'>
            {error}
          </Typography.Text>
        ) : null}

        {creating ? (
          // Said before the file is written, not after. There is no escrow and
          // no reset: this is the one warning that decides whether the backup
          // is usable a year from now.
          <Alert type='warning' content={t('settings.backup.passphraseNoRecovery')} />
        ) : null}
      </div>
    </Modal>
  );
};

export default PassphrasePrompt;
