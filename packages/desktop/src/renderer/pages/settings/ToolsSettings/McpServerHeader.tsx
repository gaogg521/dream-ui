import type { IMcpServer } from '@/common/config/storage';
import { Button, Dropdown, Menu, Popover, Switch } from '@arco-design/web-react';
import { Check, CloseSmall, Info, LoadingOne, Write, DeleteFour, SettingOne, Login } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { McpOAuthStatus } from '@/renderer/hooks/mcp/useMcpOAuth';
import FeedbackButton from '@/renderer/components/base/FeedbackButton';
import { iconColors } from '@/renderer/styles/colors';
import { formatDateTime } from '@/renderer/services/i18n/format';
import CompanyBadge from '@/renderer/components/enterprise/CompanyBadge';
import { isCompanyMcpServer } from '@/renderer/utils/enterprise/companyMcp';

interface McpServerHeaderProps {
  server: IMcpServer;
  purpose?: React.ReactNode;
  isTestingConnection: boolean;
  oauthStatus?: McpOAuthStatus;
  isLoggingIn?: boolean;
  /** Extension-contributed servers are read-only */
  isReadOnly?: boolean;
  savingEnabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onTestConnection: (server: IMcpServer) => void;
  onEditServer: (server: IMcpServer) => void;
  onDeleteServer: (serverId: string) => void;
  onOAuthLogin?: (server: IMcpServer) => void;
}

const getStatusIcon = (
  last_test_status?: IMcpServer['last_test_status'],
  oauthStatus?: McpOAuthStatus,
  isTestingConnection?: boolean
) => {
  if (isTestingConnection || last_test_status === 'testing' || oauthStatus?.isChecking) {
    return <LoadingOne fill={iconColors.primary} className='h-[24px]' />;
  }

  if (last_test_status === 'error') {
    return <CloseSmall fill={iconColors.danger} className='h-[24px]' />;
  }

  if (oauthStatus?.needsLogin) {
    return <span className='text-orange-500 text-xl font-bold leading-none'>△</span>;
  }

  if (last_test_status === 'connected') {
    return <Check fill={iconColors.secondary} className='h-[24px] items-center' />;
  }

  if (oauthStatus?.isAuthenticated) {
    return <Check fill={iconColors.secondary} className='h-[24px] items-center' />;
  }

  return <Info theme='outline' fill={iconColors.secondary} className='h-[24px]' />;
};

const formatStatusTimestamp = (timestamp: number | undefined, locale: string): string | null => {
  if (!timestamp) {
    return null;
  }

  return formatDateTime(timestamp, locale);
};

const getStatusPopoverContent = (
  server: IMcpServer,
  locale: string,
  t?: (key: string, options?: Record<string, unknown>) => string
) => {
  if (server.last_test_status !== 'error' && server.last_test_status !== 'connected') {
    return null;
  }

  if (server.last_test_status === 'connected') {
    const checkedAt = formatStatusTimestamp(server.last_connected || server.updated_at, locale);
    return (
      <div className='max-w-300px space-y-2 text-13px leading-20px'>
        <div className='font-medium text-t-primary'>
          {t?.('settings.mcpCheckPassedSummary') || 'Manual check passed'}
        </div>
        {checkedAt ? (
          <div className='text-12px leading-18px text-t-secondary'>{`${t?.('settings.mcpCheckedAtLabel') || 'Checked at:'} ${checkedAt}`}</div>
        ) : null}
        <div className='text-12px leading-18px text-t-secondary opacity-80'>
          {t?.('settings.mcpCheckPurposeHint') ||
            'Used to verify whether the MCP configuration is available. It does not represent the real-time status in the current conversation.'}
        </div>
      </div>
    );
  }

  const checkedAt = formatStatusTimestamp(server.updated_at, locale);

  const reasonText =
    server.builtin && server.name === 'chrome-devtools' && server.transport.type === 'stdio'
      ? t?.('settings.mcpInlineCommandHint', {
          command: server.transport.command,
        }) || `Missing ${server.transport.command}. Install it and test again.`
      : t?.('settings.mcpInlineConfigHint') || 'Configuration may be incorrect. Review the MCP JSON and test again.';

  return (
    <div className='max-w-300px space-y-2 text-13px leading-20px'>
      <div className='font-medium text-t-primary'>{t?.('settings.mcpCheckFailedSummary') || 'Manual check failed'}</div>
      <div className='text-t-primary'>{reasonText}</div>
      {checkedAt ? (
        <div className='text-12px leading-18px text-t-secondary'>{`${t?.('settings.mcpCheckedAtLabel') || 'Checked at:'} ${checkedAt}`}</div>
      ) : null}
    </div>
  );
};

const getStatusText = (
  server: IMcpServer,
  last_test_status?: IMcpServer['last_test_status'],
  oauthStatus?: McpOAuthStatus,
  isTestingConnection?: boolean,
  t?: (key: string, options?: Record<string, unknown>) => string
) => {
  if (isTestingConnection || last_test_status === 'testing' || oauthStatus?.isChecking) {
    return t?.('settings.mcpTesting') || 'testing';
  }

  if (last_test_status === 'error') {
    if (server.builtin && server.name === 'chrome-devtools' && server.transport.type === 'stdio') {
      return (
        t?.('settings.mcpLocalCommandUnavailable', {
          command: server.transport.command,
        }) || `Requires ${server.transport.command} on this machine`
      );
    }
    return t?.('settings.mcpCheckFailedSimple') || 'Failed';
  }

  if (oauthStatus?.needsLogin) {
    return t?.('settings.mcpNeedsLogin') || 'Login required';
  }

  if (last_test_status === 'connected') {
    return t?.('settings.mcpCheckPassedSimple') || 'Manual check passed';
  }

  if (oauthStatus?.isAuthenticated) {
    return t?.('settings.mcpAuthenticated') || 'Authenticated';
  }

  return t?.('settings.mcpDisconnected') || 'Not tested';
};

const supportsOAuth = (server: IMcpServer) =>
  server.transport.type === 'http' || server.transport.type === 'sse' || server.transport.type === 'streamable_http';

const McpServerHeader: React.FC<McpServerHeaderProps> = ({
  server,
  purpose,
  isTestingConnection,
  oauthStatus,
  isLoggingIn,
  isReadOnly,
  savingEnabled,
  onEnabledChange,
  onTestConnection,
  onEditServer,
  onDeleteServer,
  onOAuthLogin,
}) => {
  const { t, i18n } = useTranslation();

  const oauthCapable = supportsOAuth(server);
  const needsLogin = oauthCapable && oauthStatus?.needsLogin;
  const statusText = getStatusText(server, server.last_test_status, oauthStatus, isTestingConnection, t);
  const statusIcon = getStatusIcon(server.last_test_status, oauthStatus, isTestingConnection);
  const statusPopoverContent = getStatusPopoverContent(server, i18n.language, t);

  const isError = server.last_test_status === 'error';

  const status = (
    <span className='inline-flex shrink-0 items-center text-t-secondary' title={statusText} aria-live='polite'>
      {statusIcon}
      <span className='sr-only'>{statusText}</span>
    </span>
  );

  return (
    <div className='flex flex-col gap-6px min-w-0'>
      <div className='flex items-center gap-6px min-w-0'>
        <span className='min-w-0 truncate font-600 text-t-primary' title={server.name}>
          {server.name}
        </span>
        {isCompanyMcpServer(server) ? <CompanyBadge /> : null}
        <div className='ms-auto flex shrink-0 items-center gap-5px' onClick={(event) => event.stopPropagation()}>
          <span className='text-12px text-t-secondary'>
            {t(server.enabled ? 'settings.mcpEnabledLabel' : 'settings.mcpDisabledLabel')}
          </span>
          <Switch
            size='small'
            aria-label={server.name}
            checked={server.enabled}
            disabled={!onEnabledChange || isTestingConnection}
            loading={savingEnabled}
            onChange={(checked) => onEnabledChange?.(checked)}
            style={{ backgroundColor: server.enabled ? 'var(--success)' : 'rgb(var(--gray-6))' }}
          />
        </div>
      </div>

      <div className='flex items-center gap-4px min-w-0'>
        <div className='min-w-0 flex-1'>{purpose}</div>
        <div className='flex items-center gap-2px shrink-0' onClick={(event) => event.stopPropagation()}>
          {statusPopoverContent ? (
            <Popover content={statusPopoverContent} trigger='hover' position='top'>
              {status}
            </Popover>
          ) : (
            status
          )}
          {isError && <FeedbackButton module='mcp-tools' className='!px-4px [&>span:last-child]:sr-only' />}
          {!isReadOnly && needsLogin && onOAuthLogin && (
            <Button
              size='small'
              icon={<Login size={14} />}
              title={t('settings.mcpLogin')}
              loading={isLoggingIn}
              onClick={() => onOAuthLogin(server)}
            >
              {t('settings.mcpLogin')}
            </Button>
          )}
          {!isReadOnly && !needsLogin && (
            <Button
              size='small'
              type='text'
              aria-label={t('settings.mcpTestConnection')}
              title={t('settings.mcpTestConnection')}
              loading={isTestingConnection}
              disabled={savingEnabled}
              onClick={() => onTestConnection(server)}
            >
              {t('settings.mcpDetect')}
            </Button>
          )}
          {!isReadOnly && !server.builtin && (
            <Dropdown
              trigger='click'
              droplist={
                <Menu>
                  <Menu.Item key='edit' onClick={() => onEditServer(server)}>
                    <div className='flex items-center gap-2'>
                      <Write size={14} />
                      {t('settings.mcpEditServer')}
                    </div>
                  </Menu.Item>
                  <Menu.Item key='delete' onClick={() => onDeleteServer(server.id)}>
                    <div className='flex items-center gap-2 text-red-500'>
                      <DeleteFour size={14} />
                      {t('settings.mcpDeleteServer')}
                    </div>
                  </Menu.Item>
                </Menu>
              }
            >
              <Button size='small' type='text' icon={<SettingOne size={16} />} aria-label={t('settings.mcpSettings')} />
            </Dropdown>
          )}
        </div>
      </div>
    </div>
  );
};

export default McpServerHeader;
