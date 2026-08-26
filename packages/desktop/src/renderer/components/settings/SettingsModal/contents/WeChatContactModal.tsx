/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import DreamModal from '@renderer/components/base/DreamModal';
import { Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import wechatQrCode from '@/renderer/assets/contact/wechat-qrcode.png';

interface WeChatContactModalProps {
  visible: boolean;
  onCancel: () => void;
}

const WeChatContactModal: React.FC<WeChatContactModalProps> = ({ visible, onCancel }) => {
  const { t } = useTranslation();

  return (
    <DreamModal
      variant='standard'
      header={{ title: t('settings.contactMe'), showClose: true }}
      visible={visible}
      onCancel={onCancel}
      footer={null}
      alignCenter
      className='w-[min(360px,calc(100vw-32px))]'
    >
      <div className='flex flex-col items-center gap-12px py-8px'>
        <img src={wechatQrCode} alt={t('settings.contactMe')} className='w-220px h-220px object-contain rd-8px' />
        <Typography.Text className='text-13px text-t-secondary'>{t('settings.wechatScanHint')}</Typography.Text>
      </div>
    </DreamModal>
  );
};

export default WeChatContactModal;
