/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The marketplace grid's category pills. The corpus ships 13 categories over
 * 252 personas; without the pills the only way into that list is a flat
 * scroll or knowing what to search. These cases pin the contract the pills
 * add: they are derived from the catalog (a category that exists in the data
 * appears with its count), they filter, they combine with search, and the
 * "All" pill — or clicking the active pill again — restores the full list.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MarketplacePersona } from '@/common/types/agent/assistantTypes';
import ExpertMarketplaceGrid from '@renderer/pages/settings/AssistantSettings/home/ExpertMarketplaceGrid';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// The real input is an Arco wrapper with styling this test has no stake in;
// swapping it for a plain controlled input lets the cases drive search
// without depending on Arco internals.
vi.mock('@/renderer/components/base', () => ({
  DreamSearchInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange?: (next: string) => void;
    placeholder?: string;
  }) => <input data-testid='mock-search' placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} />,
}));

const persona = (id: string, displayName: string, category?: string): MarketplacePersona => ({
  id,
  name: id,
  display_name: displayName,
  description: `${displayName} 的简介`,
  category,
  installed: false,
});

// Two personas in one category, one in another, one uncategorized — enough to
// pin pill counts, filtering, and the uncategorized fallthrough without
// replicating the real 252-entry corpus.
const personas = [
  persona('ppt-expert', 'PPT制作专家', '内容创作'),
  persona('writer-expert', '写作专家', '内容创作'),
  persona('stock-expert', '股票专家', '金融投资'),
  persona('code-expert', '代码专家', '技术工程'),
  persona('loose-expert', '无类目专家'),
];

const renderGrid = () =>
  render(
    <ExpertMarketplaceGrid personas={personas} onInstall={vi.fn()} onStartChat={vi.fn()} />
  );

const visibleCards = () => screen.queryAllByTestId(/^marketplace-card-/);

describe('ExpertMarketplaceGrid category pills', () => {
  afterEach(cleanup);

  it('derives the pills from the catalog, each with its count', () => {
    renderGrid();

    expect(screen.getByTestId('pill-marketplace-category-all').textContent).toContain('5');
    // 内容创作 is the only multi-member category, so it must lead the row.
    const pills = ['内容创作', '金融投资', '技术工程'].map((c) =>
      screen.getByTestId(`pill-marketplace-category-${c}`)
    );
    expect(pills[0]?.textContent).toContain('2');
    expect(pills[1]?.textContent).toContain('1');
    expect(pills[2]?.textContent).toContain('1');
    // All personas render unfiltered, including the uncategorized one.
    expect(visibleCards()).toHaveLength(5);
  });

  it('filters to one category on click, and the uncategorized drop out', () => {
    renderGrid();

    fireEvent.click(screen.getByTestId('pill-marketplace-category-内容创作'));

    const cards = visibleCards().map((el) => el.getAttribute('data-testid'));
    expect(cards).toEqual(['marketplace-card-ppt-expert', 'marketplace-card-writer-expert']);
  });

  it('combines with search — search narrows within the active category', () => {
    renderGrid();

    fireEvent.click(screen.getByTestId('pill-marketplace-category-内容创作'));
    fireEvent.change(screen.getByTestId('mock-search'), { target: { value: 'PPT' } });

    expect(visibleCards().map((el) => el.getAttribute('data-testid'))).toEqual([
      'marketplace-card-ppt-expert',
    ]);

    // Clearing the search keeps the category pill active.
    fireEvent.change(screen.getByTestId('mock-search'), { target: { value: '' } });
    expect(visibleCards()).toHaveLength(2);
  });

  it('clicking the active pill again, or All, restores the full list', () => {
    renderGrid();

    fireEvent.click(screen.getByTestId('pill-marketplace-category-金融投资'));
    expect(visibleCards()).toHaveLength(1);

    // Toggle the same pill off…
    fireEvent.click(screen.getByTestId('pill-marketplace-category-金融投资'));
    expect(visibleCards()).toHaveLength(5);

    // …and All resets even when another pill is active.
    fireEvent.click(screen.getByTestId('pill-marketplace-category-技术工程'));
    fireEvent.click(screen.getByTestId('pill-marketplace-category-all'));
    expect(visibleCards()).toHaveLength(5);
  });
});
