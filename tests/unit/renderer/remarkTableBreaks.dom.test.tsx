/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkTableBreaks from '@/renderer/pages/knowledge/remarkTableBreaks';
afterEach(cleanup);
it('renders editor table line breaks while keeping arbitrary HTML inert', () => {
  const view = render(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkTableBreaks]}>
      {'| Note |\n| --- |\n| First<br>Second |\n\n<script>alert(1)</script>'}
    </ReactMarkdown>
  );
  const cell = screen.getByRole('cell');
  expect(cell.querySelector('br')).not.toBeNull();
  expect(cell.textContent).toBe('First\nSecond');
  expect(view.container.querySelector('script')).toBeNull();
});
