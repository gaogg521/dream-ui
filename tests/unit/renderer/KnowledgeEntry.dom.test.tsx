/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ context: null as unknown, ragProps: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: hooks.context }),
  isOrgAdminRole: (role: string | null | undefined) => role === 'admin' || role === 'owner',
}));
vi.mock('@/renderer/pages/superAssistant/registries/RagSection', () => ({
  default: (props: { readOnly?: boolean }) => {
    hooks.ragProps(props);
    return <div data-testid='rag-section' />;
  },
}));

import SiderKnowledgeEntry from '@/renderer/components/layout/Sider/SiderNav/SiderKnowledgeEntry';
import KnowledgePage from '@/renderer/pages/knowledge';

describe('SiderKnowledgeEntry', () => {
  it('is a door labelled with the knowledge base that opens it on click', () => {
    const onClick = vi.fn();
    render(
      <SiderKnowledgeEntry
        isMobile={false}
        isActive={false}
        collapsed={false}
        siderTooltipProps={{}}
        onClick={onClick}
      />
    );
    expect(screen.getByText('common.superAssistant.tabKnowledge')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sider-knowledge'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is still there, as an icon, when the sidebar is collapsed', () => {
    const onClick = vi.fn();
    render(<SiderKnowledgeEntry isMobile={false} isActive collapsed siderTooltipProps={{}} onClick={onClick} />);
    expect(screen.queryByText('common.superAssistant.tabKnowledge')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sider-knowledge'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('KnowledgePage', () => {
  beforeEach(() => hooks.ragProps.mockClear());

  it('lets a person manage the knowledge base when there is no company', () => {
    hooks.context = null;
    render(<KnowledgePage />);
    expect(screen.getByTestId('rag-section')).toBeInTheDocument();
    expect(hooks.ragProps).toHaveBeenLastCalledWith({ readOnly: false });
  });

  it('is read-only for a company member, and writable for a company administrator', () => {
    hooks.context = { isEnterprise: true, role: 'member' };
    const { unmount } = render(<KnowledgePage />);
    expect(hooks.ragProps).toHaveBeenLastCalledWith({ readOnly: true });
    unmount();
    hooks.context = { isEnterprise: true, role: 'admin' };
    render(<KnowledgePage />);
    expect(hooks.ragProps).toHaveBeenLastCalledWith({ readOnly: false });
  });
});
