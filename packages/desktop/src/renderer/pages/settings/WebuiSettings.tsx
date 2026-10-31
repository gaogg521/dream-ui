/**
 * Copyright 2026 One Work
 */

import React from 'react';
import { useSearchParams } from 'react-router-dom';
import WebuiModalContent from '@/renderer/components/settings/SettingsModal/contents/WebuiModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const WebuiSettings: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'channels' ? 'channels' : 'webui';
  return (
    <SettingsPageWrapper>
      <WebuiModalContent initialTab={initialTab} />
    </SettingsPageWrapper>
  );
};

export default WebuiSettings;
