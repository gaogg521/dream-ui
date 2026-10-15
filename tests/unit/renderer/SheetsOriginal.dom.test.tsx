/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx-republish';
import SheetsOriginal from '@/renderer/pages/knowledge/original/SheetsOriginal';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('reads workbook sheets, preserves merged values and formatted numbers, and blocks executable HTML', async () => {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([['Customer', 'Status'], ['Blue whale', 'Demo'], ['Merged note']]);
  sheet['!merges'] = [{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }];
  utils.book_append_sheet(book, sheet, 'Customers');
  const metrics = utils.aoa_to_sheet([['Rate'], [0.75]]);
  metrics.A2.z = '0%';
  utils.book_append_sheet(book, metrics, 'Metrics');
  const data = write(book, { type: 'array', bookType: 'xlsx' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => data }));
  render(<SheetsOriginal url='blob:workbook' title='QA.xlsx' />);
  await screen.findByRole('tab', { name: 'Customers' });
  const frame = screen.getByTitle('QA.xlsx');
  expect(frame.getAttribute('srcdoc')).toContain('colspan="2"');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
  fireEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
  await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('75%'));
});
