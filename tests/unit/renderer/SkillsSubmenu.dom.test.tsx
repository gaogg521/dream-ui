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
    Tooltip: ({ children, content }: { children: React.ReactNode; content?: React.ReactNode }) => (
      <span data-testid="skill-tooltip">
        {content as React.ReactNode}
        {children}
      </span>
    ),
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

  it('lays the catalog out as a grid: one card per skill, display name primary, intro on hover', () => {
    const { container } = render(<GuidActionRow {...baseProps} />);
    const grid = container.querySelector('[data-testid="guid-skills-grid"]');
    expect(grid).toBeTruthy();

    const cells = [...container.querySelectorAll('[data-testid^="guid-skill-cell-"]')];
    expect(cells).toHaveLength(3);

    const fund = container.querySelector('[data-testid="guid-skill-cell-fund-analysis"]');
    expect(fund?.textContent).toContain('基金分析');
    // The visible label stays the human name alone; identity + intro travel
    // via aria-label and the hover tooltip content.
    expect(fund?.textContent).not.toContain('fund-analysis');
    const ariaLabel = fund?.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('基金分析');
    expect(ariaLabel).toContain('d');
    // Tooltip mock renders the intro content right before the button.
    const tooltip = fund?.parentElement;
    expect(tooltip?.getAttribute('data-testid')).toBe('skill-tooltip');
    expect(tooltip?.textContent).toContain('d');

    // No display name → the kebab name is the label, no duplicate.
    const wacli = container.querySelector('[data-testid="guid-skill-cell-wacli"]');
    expect(wacli?.textContent).toContain('wacli');
  });

  it('renders the icon image only for skills that ship one, letter tile otherwise', () => {
    const { container } = render(<GuidActionRow {...baseProps} />);
    const imgs = [...container.querySelectorAll('[data-testid="guid-skills-grid"] img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe('http://backend.test/api/skills/12306-train-assistant/icon');
    const tiles = [
      ...container.querySelectorAll('[data-testid="guid-skills-grid"] span'),
    ].filter((s) => /w-28px/.test(s.className ?? ''));
    expect(tiles.map((t) => t.textContent?.trim())).toContain('基');
    expect(tiles.map((t) => t.textContent?.trim())).toContain('W');
  });

  it('marks checked cells and surfaces manually selected skills as removable chips', () => {
    const { container } = render(<GuidActionRow {...baseProps} enabledSkills={['fund-analysis']} />);
    const fund = container.querySelector('[data-testid="guid-skill-cell-fund-analysis"]');
    expect(fund?.getAttribute('aria-selected')).toBe('true');
    expect(fund?.textContent).toContain('✓');

    const chip = container.querySelector('[data-testid="guid-selected-skill-chip-fund-analysis"]');
    expect(chip?.textContent).toContain('基金分析');
    // The chip's remove control is wired to the same toggle (clears the pick).
    expect(container.querySelector('[data-testid="guid-remove-skill-fund-analysis"]')).toBeTruthy();

    // Unselected skills get no chip.
    expect(container.querySelector('[data-testid="guid-selected-skill-chip-wacli"]')).toBeNull();
  });
});
