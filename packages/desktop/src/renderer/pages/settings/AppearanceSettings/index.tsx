/**
 * Copyright 2026 One Work
 */

import React from 'react';
import AppearanceModalContent from '@/renderer/components/settings/SettingsModal/contents/AppearanceModalContent';
import SettingsPageWrapper from '../components/SettingsPageWrapper';

const AppearanceSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <AppearanceModalContent />
    </SettingsPageWrapper>
  );
};

export default AppearanceSettings;
