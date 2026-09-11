/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createInitStyle } from '@renderer/components/Markdown/ShadowView';

/**
 * Regression: inline markup inside a heading fell back to body sizing.
 *
 * The init style's universal flattener (`* { font-size; line-height }`) pins
 * every element to the chat body size, and the h1/h2-h6 rules style only the
 * heading element itself — a heading's <strong>/<em>/<a> child therefore
 * rendered at 14px in the middle of a 24px heading ("# a **b** c" showed b
 * small). The fix is a `:is(h1..h6) *` rule restoring inheritance.
 *
 * jsdom does not run the real cascade, so these tests pin the two things the
 * fix depends on: the rule exists with the right declarations, and it appears
 * AFTER both the universal flattener and the `strong` font-weight reset (same
 * specificity → source order decides the tie).
 */
const parsedRules = (): CSSRule[] => {
  const style = createInitStyle('light');
  document.head.appendChild(style);
  const rules = [...(style.sheet?.cssRules ?? [])];
  style.remove();
  return rules;
};

const selectorOf = (rule: CSSRule): string => (rule as CSSStyleRule).selectorText ?? '';

describe('createInitStyle heading inline-markup sizing', () => {
  it('restores inheritance for elements nested in headings', () => {
    const rule = parsedRules().find((r) => selectorOf(r).replace(/\s/g, '') === ':is(h1,h2,h3,h4,h5,h6)*') as
      | CSSStyleRule
      | undefined;

    expect(rule, 'the :is(h1..h6) * inheritance rule must exist').toBeDefined();
    expect(rule?.style.getPropertyValue('font-size')).toBe('inherit');
    expect(rule?.style.getPropertyValue('line-height')).toBe('inherit');
    expect(rule?.style.getPropertyValue('font-weight')).toBe('inherit');
  });

  it('orders the inheritance rule after the universal flattener and the strong reset', () => {
    const rules = parsedRules();
    const indexOf = (predicate: (sel: string) => boolean) => rules.findIndex((r) => predicate(selectorOf(r)));

    const flattener = indexOf((sel) => sel === '*');
    const strongReset = indexOf((sel) => sel === 'strong');
    const inheritance = indexOf((sel) => sel.replace(/\s/g, '') === ':is(h1,h2,h3,h4,h5,h6)*');

    expect(flattener).toBeGreaterThanOrEqual(0);
    expect(strongReset).toBeGreaterThanOrEqual(0);
    expect(inheritance).toBeGreaterThan(flattener);
    // Same (0,0,1) specificity as `strong` — source order is what lets
    // font-weight: inherit win inside a heading.
    expect(inheritance).toBeGreaterThan(strongReset);
  });
});

/**
 * `compact` is for markdown shown inside a panel rather than as a chat reply —
 * a skill's SKILL.md in a 420px-tall file browser. Reply-sized type swallowed
 * the panel around it, and the heading rules made it worse: a SKILL.md's own
 * frontmatter parses as a setext h2, so every skill opened on a 16px bold
 * banner above a 16px body.
 */
describe('createInitStyle compact mode', () => {
  const declarationsFor = (selector: string, compact: boolean) => {
    const style = createInitStyle('light', undefined, undefined, false, compact);
    document.head.appendChild(style);
    const rule = [...(style.sheet?.cssRules ?? [])].find(
      (r) => selectorOf(r).replace(/\s/g, '') === selector.replace(/\s/g, '')
    ) as CSSStyleRule | undefined;
    style.remove();
    return rule?.style;
  };

  it('pins a fixed body size instead of following the chat font-size preference', () => {
    // The chat preference is about reading replies. A document pane that grows
    // with it overflows the panel it sits in, so compact opts out of the var.
    expect(declarationsFor('*', false)?.getPropertyValue('font-size')).toContain('--chat-font-size');
    expect(declarationsFor('*', true)?.getPropertyValue('font-size')).toBe('13px');
  });

  it('scales the headings down with the body rather than leaving them at reply size', () => {
    const h1 = declarationsFor('h1', true);
    const rest = declarationsFor('h2,h3,h4,h5,h6', true);

    expect(h1?.getPropertyValue('font-size')).toBe('17px');
    expect(rest?.getPropertyValue('font-size')).toBe('14px');
    // Still a hierarchy, and still above the 13px body.
    expect(h1?.getPropertyValue('font-weight')).toBe('bold');
  });

  it('leaves the chat defaults untouched when compact is off', () => {
    expect(declarationsFor('h1', false)?.getPropertyValue('font-size')).toBe('24px');
    expect(declarationsFor('h2,h3,h4,h5,h6', false)?.getPropertyValue('font-size')).toBe('16px');
  });
});
