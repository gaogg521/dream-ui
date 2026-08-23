/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import EnterprisePage from '@/renderer/pages/enterprise';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const EnterpriseSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <EnterprisePage />
    </SettingsPageWrapper>
  );
};

export default EnterpriseSettings;
