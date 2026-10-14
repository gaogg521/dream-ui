import React from 'react';
import RagSection from '../superAssistant/registries/RagSection';
import KnowledgeLibrary from './KnowledgeLibrary';

const KnowledgePage: React.FC = () => (
  <div className='h-full min-h-0' data-testid='knowledge-page'>
    <RagSection renderLibrary={(props) => <KnowledgeLibrary {...props} />} />
  </div>
);

export default KnowledgePage;
