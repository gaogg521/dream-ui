/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The conversation "+" menu's skills submenu. Imported skills carry a
 * display name (often CJK) and an icon, and the submenu is the place a
 * regular user actually browses them — so it renders the same presentation
 * the Skills Hub does: icon (backend icon route) in place of the letter
 * tile, display name as the primary label with the kebab identity as a
 * small secondary tag, and search matching BOTH names (a user who saw
 * "基金分析" in the Skills Hub types Chinese, not "fund-analysis").
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { MarketplacePersona } from '@/common/types/agent/assistantTypes';

const allSkills = [
  { name: 'fund-analysis', description: 'd', isAuto: false, display_name: '基金分析' },
  { name: '12306-train-assistant', description: 'd', isAuto: false, display_name: '12306 订票助手', icon_file: '_icon.svg' },
  { name: 'wacli', description: 'd', isAuto: false },
];

const onToggleSkill = vi.fn();
const onToggleMcp = vi.fn();

// Arco Menu/Checkbox/Dropdown are heavy; the submenu content under test is
// plain markup inside them. Stub the Arco parts with pass-throughs.
vi.mock('@arco-design/web-react', () => {
  const Checkbox = ({ children, checked }: { children: React.ReactNode; checked?: boolean }) => (
    <label data-testid={`checkbox-${checked ? 'on' : 'off'}`}>{children}</label>
  );
  const MenuItem = ({ children }: { children: React.ReactNode }) => <li role='menuitem'>{children}</li>;
  const MenuSubMenu = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  const Menu = Object.assign(
    ({ children }: { children?: React.ReactNode }) => <ul>{children as React.ReactNode}</ul>,
    { Item: MenuItem, SubMenu: MenuSubMenu }
  );
  return {
    Checkbox,
    Menu,
    Dropdown: ({ droplist }: { droplist?: React.ReactNode }) => (
      <div data-testid='droplist'>{droplist as React.ReactNode}</div>
    ),
    Button: ({ children, icon }: { children?: React.ReactNode; icon?: React.ReactNode }) => (
      <button>
        {icon as React.ReactNode}
        {children}
      </button>
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@icon-park/react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Plus: () => <span>+</span>,
  Lightning: () => <span>⚡</span>,
  Shield: () => <span>🛡</span>,
  Star: () => <span>★</span>,
  UploadOne: () => <span>↑</span>,
}));

vi.mock('@/renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveExtensionAssetUrl: (url: string) => `http://backend.test${url}`,
}));

vi.mock('@/renderer/components/base', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DreamInlineSearchInput: (props: Record<string, unknown>) => <input {...props} />,
  DreamSearchInput: (props: Record<string, unknown>) => <input {...props} />,
  TalkToButlerButton: () => <button>butler</button>,
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}));

import GuidActionRow from '@renderer/pages/guid/components/GuidActionRow';

const baseProps = {
  files: [],
  onFilesUploaded: vi.fn(),
  onFilesPicked: vi.fn(),
  modelSelectorNode: null,
  referenceOnly: true,
  isGeminiMode: false,
  modelList: [],
  current_model: undefined,
  setCurrentModel: vi.fn(),
  currentAcpCachedModelInfo: null,
  selectedAcpModel: null,
  modeBackend: 'dream',
  selectedMode: 'chat',
  dynamicModes: [],
  // skills
  allSkills,
  enabledSkills: [],
  disabledBuiltinSkills: [],
  onToggleSkill,
  // mcp
  mcpServers: [],
  selectedMcpServerIds: [],
  onToggleMcpServer: vi.fn(),
  onToggleMcp: vi.fn(),
  // experts
  personaAssistants: [],
  marketplacePersonas: [] as MarketplacePersona[],
  selectedAssistantId: undefined,
  localeKey: 'zh-CN',
  onSelectAssistant: vi.fn(),
  onInstallAndSelectPersona: vi.fn(),
  onBrowseMoreExperts: vi.fn(),
  onClearPersona: vi.fn(),
  onSend: vi.fn(),
} as unknown as React.ComponentProps<typeof GuidActionRow>;

describe('skills submenu presentation', () => {
  afterEach(cleanup);

  it('shows the display name as the primary label with the kebab identity beside it', () => {
    const { container } = render(<GuidActionRow {...baseProps} />);
    const text = container.textContent ?? '';
    expect(text).toContain('基金分析');
    expect(text).toContain('fund-analysis');
    expect(text).toContain('12306 订票助手');
    // A skill without a display name falls back to its kebab name alone.
    expect(text).toContain('wacli');
    // No duplicated identity when display name equals the kebab name.
    expect(text).not.toContain('wacli wacli');
  });

  it('renders the icon image only for skills that ship one', () => {
    const { container } = render(<GuidActionRow {...baseProps} />);
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('http://backend.test/api/skills/12306-train-assistant/icon');
    // letter tile fallback for the others
    const tiles = [...container.querySelectorAll('span')].filter((s) => /w-22px/.test(s.className ?? ''));
    expect(tiles.map((t) => t.textContent?.trim())).toContain('基');
    expect(tiles.map((t) => t.textContent?.trim())).toContain('W');
  });
});
