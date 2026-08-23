import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
const layoutContextMock = {
  isMobile: false,
  siderCollapsed: false,
  setSiderCollapsed: vi.fn(),
};
const navigationHistoryMock = {
  canBack: true,
  canForward: true,
  back: vi.fn(),
  forward: vi.fn(),
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

// LanguageQuickSwitch (in the titlebar toolbar) imports changeLanguage from the
// i18n service, whose module-load init isn't wired in unit tests — mock it.
vi.mock('@/renderer/services/i18n', () => ({
  changeLanguage: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/guid', search: '', hash: '' }),
  useNavigate: () => navigateMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: { get: { invoke: vi.fn() } },
    conversation: { get: { invoke: vi.fn() } },
  },
}));

vi.mock('@/common/config/constants', () => ({
  TEAM_MODE_ENABLED: false,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => layoutContextMock,
}));

vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({
  useNavigationHistory: () => navigationHistoryMock,
}));

vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: vi.fn() }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
  isMacOS: () => false,
}));

vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({
  default: ({ renderTrigger }: { renderTrigger: (props: { onClick: () => void }) => React.ReactNode }) => (
    <>{renderTrigger({ onClick: vi.fn() })}</>
  ),
}));

// Language quick-switch pulls in Arco Dropdown/Menu; not relevant to titlebar
// behavior tests, so stub it (mirrors the ConversationSearchPopover mock above).
vi.mock('@renderer/components/layout/Titlebar/LanguageQuickSwitch', () => ({
  default: () => <button type='button' aria-label='switch-language-mock' />,
}));

vi.mock('./MobileConversationBrand', () => ({
  default: () => null,
}));

vi.mock('@/renderer/utils/workspace/workspaceEvents', () => ({
  WORKSPACE_STATE_EVENT: 'workspace-state',
  dispatchWorkspaceToggleEvent: vi.fn(),
}));

vi.mock('@icon-park/react', () => ({
  ArrowCircleLeft: () => <span>ArrowCircleLeft</span>,
  ArrowLeft: () => <span>ArrowLeft</span>,
  ArrowRight: () => <span>ArrowRight</span>,
  ExpandLeft: () => <span>ExpandLeft</span>,
  ExpandRight: () => <span>ExpandRight</span>,
  Peoples: () => <span>Peoples</span>,
  Search: () => <span>Search</span>,
}));

vi.mock('@/renderer/components/layout/WindowControls', () => ({
  default: () => null,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';

describe('Titlebar', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    layoutContextMock.isMobile = false;
    layoutContextMock.siderCollapsed = false;
    layoutContextMock.setSiderCollapsed.mockReset();
    navigationHistoryMock.back.mockReset();
    navigationHistoryMock.forward.mockReset();
  });

  it('renders the feedback action button in the toolbar', () => {
    render(<Titlebar workspaceAvailable={true} />);

    expect(screen.getByLabelText('Report Issue')).toBeInTheDocument();
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
  });
});
