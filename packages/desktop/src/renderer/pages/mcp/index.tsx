/**
 * Top-level MCP / Tools page — opened from the main sider ("MCP Services").
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SettingsTabNavigateProvider,
  SettingsViewModeProvider,
} from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

const McpPage: React.FC = () => {
  const navigate = useNavigate();
  const navigateToSettingsTab = useCallback(
    (tabId: string) => {
      void navigate(`/settings/${tabId}`);
    },
    [navigate]
  );

  return (
    <SettingsViewModeProvider value='page'>
      <SettingsTabNavigateProvider value={navigateToSettingsTab}>
        <div className='h-full overflow-auto px-12px md:px-40px py-32px'>
          <div className='mx-auto w-full max-w-1200px'>
            <ToolsModalContent />
          </div>
        </div>
      </SettingsTabNavigateProvider>
    </SettingsViewModeProvider>
  );
};

export default McpPage;
