/**
 * Copyright 2026 One Work
 */

import { Button } from '@arco-design/web-react';
import { Lightning } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsCard from './SettingsCard';

/**
 * The second way in from outside the LAN, next to the fixed address: a temporary public link
 * through a Cloudflare tunnel. Unlike the fixed address it has no switch of its own — the address
 * has to be requested, so the butler sets it up on demand — and it changes every time it is made.
 */
const TempAccessCard: React.FC<{ onAskButler: () => void }> = ({ onAskButler }) => {
  const { t } = useTranslation();
  return (
    <SettingsCard
      data-testid='webui-temp-card'
      className='h-full'
      icon={<Lightning theme='outline' size='20' />}
      title={t('settings.webui.tempTitle')}
      badge={t('settings.webui.tempTag')}
      description={t('settings.webui.tempDesc')}
    >
      <Button long type='outline' className='rd-100px' data-testid='webui-butler-link' onClick={onAskButler}>
        {t('settings.webui.letButlerSetup', { defaultValue: 'Let the butler open a temporary public link' })} →
      </Button>
    </SettingsCard>
  );
};

export default TempAccessCard;
