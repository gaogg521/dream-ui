/**
 * Knowledge base page — opened from the main sidebar.
 *
 * The knowledge base used to live only as a tab on the digital employees page,
 * three clicks from the home page. It is something people come back to (add a
 * document, search it), so it gets its own door in the main sidebar; the tab
 * stays, since an employee's page is also where a person thinks about what it
 * can draw on. Both show the same section.
 *
 * On a company server a member adds, edits and deletes their own documents;
 * the ones an administrator distributed are read-only to them.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import RagSection from '../superAssistant/registries/RagSection';

const KnowledgePage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className='flex h-full flex-col' data-testid='knowledge-page'>
      <div className='border-b border-2 px-16px py-12px text-16px font-600'>
        {t('common.superAssistant.tabKnowledge')}
      </div>
      <div className='flex-1 overflow-auto p-16px'>
        <RagSection />
      </div>
    </div>
  );
};

export default KnowledgePage;
