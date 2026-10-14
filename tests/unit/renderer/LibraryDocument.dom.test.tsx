import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryDocument from '@/renderer/pages/knowledge/LibraryDocument';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }) }));
const props = {
  title: 'Guide.md',
  location: 'Team',
  content: '# Welcome\n\nExisting document content.',
  reading: true,
  canEdit: true,
  onReading: vi.fn(),
  onChange: vi.fn(),
  onBack: vi.fn(),
  onSave: vi.fn(),
};
describe('inline knowledge document', () => {
  it('renders the document in a page region without opening a dialog', () => {
    render(<LibraryDocument {...props} />);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByText('Existing document content.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('knowledge-document')).toBeInTheDocument();
  });
  it('previews HTML in an isolated frame with no script or same-origin privileges', () => {
    render(
      <LibraryDocument
        {...props}
        title='Preview.html'
        mimeType='text/html'
        content='<h1>Preview</h1><script>window.parent.compromised=true</script>'
      />
    );
    const frame = screen.getByTestId('knowledge-document').querySelector('iframe')!;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Preview</h1>');
  });
});
