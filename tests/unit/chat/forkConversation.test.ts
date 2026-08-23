/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isForkEnabled } from '@/common/chat/forkConversation';
import { getForkErrorMessage } from '@/renderer/hooks/chat/useForkConversation';

describe('isForkEnabled', () => {
  it('is disabled without a declared capability', () => {
    expect(isForkEnabled(undefined, { isLastMessage: true, hasTurnAnchor: true })).toBe(false);
    expect(isForkEnabled(undefined, { isLastMessage: false, hasTurnAnchor: false })).toBe(false);
  });

  it('the last message is always forkable (HEAD fork needs no anchor)', () => {
    expect(isForkEnabled({ at_turn: true }, { isLastMessage: true, hasTurnAnchor: false })).toBe(true);
    expect(isForkEnabled({ at_turn: false }, { isLastMessage: true, hasTurnAnchor: false })).toBe(true);
  });

  it('at_turn backends (codex) fork mid-history only where a turn anchor resolves', () => {
    expect(isForkEnabled({ at_turn: true }, { isLastMessage: false, hasTurnAnchor: true })).toBe(true);
    // Legacy/copied rows before the first anchor: hidden instead of a 422 on click.
    expect(isForkEnabled({ at_turn: true }, { isLastMessage: false, hasTurnAnchor: false })).toBe(false);
  });

  it('head-only backends (claude/ACP) never fork mid-history, anchored or not', () => {
    expect(isForkEnabled({ at_turn: false }, { isLastMessage: false, hasTurnAnchor: true })).toBe(false);
    expect(isForkEnabled({ at_turn: false }, { isLastMessage: false, hasTurnAnchor: false })).toBe(false);
  });
});

/**
 * 后端把失败原因编码成 `FORK_*` 前缀塞在 reason 串里，前端靠子串匹配翻成人话。
 * 这种跨层字符串约定**不会自己报错**：后端换个措辞，用户从此永远只看到一句通用
 * 「分叉失败」，而没有任何东西会变红。所以这几条断言就是那个约定本身。
 *
 * 四个码在后端的出处（`crates/aionui-conversation/src/service.rs`，本轮核对过）：
 * 409 FORK_TURN_IN_FLIGHT / FORK_PARENT_UNBOUND、422 FORK_UNSUPPORTED /
 * FORK_POINT_UNSUPPORTED。
 *
 * The backend encodes failure reasons as `FORK_*` prefixes inside the reason
 * string and the renderer substring-matches them into copy. Nothing enforces
 * that contract at compile time: reword it on the backend and every user gets a
 * generic "fork failed" forever, with no test going red. These assertions are
 * the contract.
 */
describe('getForkErrorMessage', () => {
  // Identity translator: asserting on the key is what makes a wrong mapping
  // visible. A real translation would let two branches return the same string.
  const t = ((key: string) => key) as unknown as Parameters<typeof getForkErrorMessage>[1];

  it.each([
    ['FORK_TURN_IN_FLIGHT: wait for the current reply to finish before forking', 'messages.fork.errorTurnInFlight'],
    ['FORK_PARENT_UNBOUND: the conversation has no backend session to fork yet', 'messages.fork.errorParentUnbound'],
    ['FORK_POINT_UNSUPPORTED: this message predates turn tracking', 'messages.fork.errorPointUnsupported'],
    ['FORK_UNSUPPORTED: this agent does not support session forking', 'messages.fork.errorUnsupported'],
  ])('maps the backend reason %j to its own message', (reason, expected) => {
    expect(getForkErrorMessage(new Error(reason), t)).toBe(expected);
  });

  /**
   * FORK_POINT_UNSUPPORTED 里含有 FORK_UNSUPPORTED 这个子串的风险：两者共享
   * `_UNSUPPORTED` 结尾，一旦匹配顺序写反，「仅支持从最新消息分叉」就会被误报成
   * 「该智能体不支持分叉」——两句话给用户的下一步动作完全相反。
   *
   * FORK_POINT_UNSUPPORTED and FORK_UNSUPPORTED share a suffix; get the match
   * order wrong and "only forkable from the latest message" is reported as
   * "this agent cannot fork at all", which tells the user the opposite thing.
   */
  it('does not let the point-specific code collapse into the generic one', () => {
    expect(getForkErrorMessage(new Error('FORK_POINT_UNSUPPORTED: ...'), t)).not.toBe('messages.fork.errorUnsupported');
  });

  it('falls back to the raw message for an unrecognised failure', () => {
    expect(getForkErrorMessage(new Error('database is locked'), t)).toBe('messages.fork.errorGeneric');
  });
});
