import { Button, Modal } from '@arco-design/web-react';
import { ArrowRightUp, Copy, ShareOne } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import oneWorkLogo from '@renderer/assets/icons/onework-logo.png';
import { openExternalUrl } from '@/renderer/utils/platform';
import './quick-share.css';

const WEBSITE_URL = 'https://1work.vip/';

export default function QuickShare({ iconSize, strokeWidth }: { iconSize: number; strokeWidth: number }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'copySuccess' | 'copyFailed' | 'failed' | null>(null);
  const title = t('common.quickShare.title');
  const description = t('common.quickShare.description');
  const [headline, details] = description.split('\n');

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(`${description}\n${WEBSITE_URL}`);
      setStatus('copySuccess');
    } catch {
      setStatus('copyFailed');
    }
  };

  return (
    <>
      <button
        type='button'
        className='app-titlebar__button'
        aria-label={title}
        aria-haspopup='dialog'
        title={title}
        onClick={() => {
          setStatus(null);
          setVisible(true);
        }}
      >
        <ShareOne theme='outline' size={iconSize} fill='currentColor' strokeWidth={strokeWidth} aria-hidden='true' />
      </button>
      <Modal
        className='quick-share-dialog'
        visible={visible}
        title={
          <span className='quick-share-dialog__title'>
            <img src={oneWorkLogo} alt='' width={28} height={28} />
            {title}
          </span>
        }
        onCancel={() => setVisible(false)}
        style={{ width: 528, maxWidth: 'calc(100vw - 32px)' }}
        footer={null}
      >
        <div className='quick-share-dialog__intro'>
          <p className='quick-share-dialog__headline'>{headline}</p>
          {details && <p className='quick-share-dialog__details'>{details}</p>}
        </div>
        <div className='quick-share-dialog__actions'>
          <a
            className='quick-share-dialog__website'
            href={WEBSITE_URL}
            target='_blank'
            rel='noopener noreferrer'
            onClick={(event) => {
              event.preventDefault();
              void openExternalUrl(WEBSITE_URL).catch(() => setStatus('failed'));
            }}
          >
            <span>{t('common.website')}</span>
            <bdi>1work.vip</bdi>
            <ArrowRightUp aria-hidden='true' size={14} fill='currentColor' />
          </a>
          <Button
            type='primary'
            size='large'
            icon={<Copy aria-hidden='true' size={16} fill='currentColor' />}
            onClick={copyShare}
          >
            {t('common.copy')}
          </Button>
        </div>
        <p className='quick-share-dialog__status' role='status'>
          {status && t(`common.${status}`)}
        </p>
      </Modal>
    </>
  );
}
