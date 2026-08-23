import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import PreviewToolbar from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewToolbar';

/**
 * 工具栏保存按钮的行为回归。
 *
 * 这个按钮是「上游 b678d839e 的等价手写实现」——上游那条 cherry-pick 依赖本仓
 * 没有的 preview-v2 刷新链，所以这里接的是本仓自己的 saveContent/isDirty。
 * 这几条断言就是那份等价性的约束：可见性由 showSave 决定、可点性由
 * saveActionable 决定、且它必须待在动作栏最右。
 *
 * Behaviour regression for the toolbar save control. It is a hand-written
 * equivalent of upstream b678d839e (whose cherry-pick depends on a preview-v2
 * refresh chain this fork lacks), wired to this fork's own saveContent/isDirty.
 */
const baseProps = {
  content_type: 'markdown',
  isMarkdown: true,
  isHTML: false,
  viewMode: 'source' as const,
  isSplitScreenEnabled: false,
  file_name: 'note.md',
  showOpenInSystemButton: false,
  historyTarget: null,
  snapshotSaving: false,
  onViewModeChange: () => {},
  onSplitScreenToggle: () => {},
  onSaveSnapshot: () => {},
  onRefreshHistory: () => {},
  renderHistoryDropdown: () => null,
  onOpenInSystem: () => {},
  onDownload: () => {},
  onClose: () => {},
};

afterEach(() => vi.clearAllMocks());

describe('PreviewToolbar save control', () => {
  it('is hidden when showSave is false', () => {
    const { queryByTestId } = render(<PreviewToolbar {...baseProps} />);
    expect(queryByTestId('preview-save')).toBeNull();
  });

  it('is rendered and clickable when the tab has unsaved edits', () => {
    const onSave = vi.fn();
    const { getByTestId } = render(<PreviewToolbar {...baseProps} showSave saveActionable onSave={onSave} />);

    const save = getByTestId('preview-save');
    expect(save.className).not.toContain('cursor-not-allowed');

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('is inert and greyed out when there is nothing unsaved', () => {
    const onSave = vi.fn();
    const { getByTestId } = render(<PreviewToolbar {...baseProps} showSave saveActionable={false} onSave={onSave} />);

    const save = getByTestId('preview-save');
    expect(save.className).toContain('cursor-not-allowed');
    expect(save.className).toContain('opacity-50');

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sits last in the action row so it never displaces the existing controls', () => {
    const { getByTestId } = render(
      <PreviewToolbar
        {...baseProps}
        isHTML
        content_type='html'
        onInspectModeToggle={() => {}}
        showOpenInSystemButton
        showSave
        saveActionable
        onSave={() => {}}
      />
    );

    const save = getByTestId('preview-save');
    // Tooltip 包了一层，所以动作栏是按钮的祖父节点 / Tooltip wraps it, so the row is the grandparent
    const row = save.parentElement?.parentElement;
    expect(row).not.toBeNull();
    expect(row!.lastElementChild?.contains(save)).toBe(true);
  });
});
