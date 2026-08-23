import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
const locationMock = {
  pathname: '/settings/system',
  search: '',
};

// Drives whether the conditional 企业管理后台 (company console) row renders.
const companyIdentityMock = { company: null as { viewerRole?: string } | null, isCompanyAdmin: false };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => locationMock,
  useNavigate: () => navigateMock,
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
  resolveExtensionAssetUrl: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({
  useExtensionSettingsTabs: () => [],
}));

vi.mock('@/renderer/hooks/system/useExtI18n', () => ({
  useExtI18n: () => ({
    resolveExtTabName: (tab: { id: string }) => tab.id,
  }),
}));

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  getSiderTooltipProps: () => ({}),
}));

// The company console row is gated on these three. They are mocked so the
// "header survives a hidden group member" case can control that gate; without
// mocks they hit real network-backed hooks.
vi.mock('@/renderer/pages/enterprise/hooks/useCompanyIdentity', () => ({
  useCompanyIdentity: () => companyIdentityMock,
}));

vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: null }),
  isSystemAdminRole: (role: string | null | undefined) => role === 'system_admin',
}));

vi.mock('@renderer/hooks/enterprise/useDeploymentRole', () => ({
  useDeploymentRole: () => ({ isServer: false }),
}));

// configService fetches `/api/settings/client` on first access. jsdom's fetch
// rejects relative URLs, so without this stub the sider's transitive import of
// it surfaces as an unhandled rejection even though the assertions pass.
vi.mock('@/common/config/configService', () => ({
  configService: {
    whenReady: () => Promise.resolve(),
    get: () => undefined,
    set: () => Promise.resolve(),
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  // Fork-only: the enterprise-identity entry in the settings sider.
  BuildingOne: () => <span>BuildingOne</span>,
  Brain: () => <span>Brain</span>,
  Communication: () => <span>Communication</span>,
  Computer: () => <span>Computer</span>,
  Earth: () => <span>Earth</span>,
  IdCard: () => <span>IdCard</span>,
  Info: () => <span>Info</span>,
  Lightning: () => <span>Lightning</span>,
  LinkCloud: () => <span>LinkCloud</span>,
  Peoples: () => <span>Peoples</span>,
  Puzzle: () => <span>Puzzle</span>,
  Robot: () => <span>Robot</span>,
  Speed: () => <span>Speed</span>,
  System: () => <span>System</span>,
}));

import SettingsSider from '@/renderer/pages/settings/components/SettingsSider';

/** Labels/headers in the order they appear in the rendered sider. */
const renderedOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('.settings-sider__group-header, .settings-sider__item-label')).map(
    (node) => node.textContent ?? ''
  );

describe('SettingsSider', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    locationMock.pathname = '/settings/system';
    locationMock.search = '';
    companyIdentityMock.company = { viewerRole: 'admin' };
    companyIdentityMock.isCompanyAdmin = true;
  });

  it('renders the four groups with their members in order', () => {
    const { container } = render(<SettingsSider />);

    expect(renderedOrder(container)).toEqual([
      'settings.groupAiCore',
      'Agents',
      'settings.model',
      '我的技能',
      '记忆管理',
      'settings.groupApp',
      '超级助手',
      'settings.webui',
      'settings.codexBridge.title',
      'settings.claudeBridge.title',
      'settings.groupEnterprise',
      '企业管理后台',
      '项目组',
      '企业身份',
      'settings.groupAbout',
      'settings.system',
      'settings.about',
    ]);
  });

  it('no longer offers the merged Capabilities entry', () => {
    render(<SettingsSider />);

    expect(screen.queryByText('Capabilities')).not.toBeInTheDocument();
    // Its two halves each keep their own entry.
    expect(screen.getByText('我的技能')).toBeInTheDocument();
  });

  it('keeps AI core entries visible on every settings route', () => {
    // A previous revision hid this group while on /settings/capabilities. That
    // page is gone; no route may make the group vanish.
    locationMock.pathname = '/settings/skills';

    render(<SettingsSider />);

    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('settings.model')).toBeInTheDocument();
  });

  it('keeps the Enterprise header when its first member is hidden', () => {
    // Non-admins do not get the company console row. The header must slide down
    // to 项目组 rather than disappear — otherwise the remaining enterprise rows
    // silently read as part of the previous group.
    companyIdentityMock.company = null;
    companyIdentityMock.isCompanyAdmin = false;

    const { container } = render(<SettingsSider />);
    const order = renderedOrder(container);

    expect(order).not.toContain('企业管理后台');
    expect(order).toContain('settings.groupEnterprise');
    expect(order.indexOf('settings.groupEnterprise')).toBe(order.indexOf('项目组') - 1);
  });
});
