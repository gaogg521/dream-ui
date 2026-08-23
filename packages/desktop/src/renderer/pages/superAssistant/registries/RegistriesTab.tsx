/**
 * Collaboration resources tab — management UI for the three one-devops
 * registries (skills / MCP connectors / RAG documents). The Issues board's
 * CollaborationContextPanel links here.
 */

import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isOrgAdminRole, useOrgContext } from '../../enterprise/hooks/useOrgContext';
import SkillsSection from './SkillsSection';
import McpSection from './McpSection';
import RagSection from './RagSection';
import MilestonesSection from './MilestonesSection';
import TestPlansSection from './TestPlansSection';
import PipelinesSection from './PipelinesSection';

const SECTION_IDS = new Set(['milestones', 'testplans', 'pipelines', 'skills', 'mcp', 'rag']);

// Deep-link support: /settings/super-assistant?tab=registries&section=<id>
// scrolls the matching section into view. Enterprise-console grid cards rely on this.
const RegistriesTab: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { context } = useOrgContext();

  // Every section here mutates shared, org-scoped state (skills/MCP/RAG/
  // milestones/test plans/pipelines all sit under one project group). Unlike
  // the project-group settings page, this route has no separate read-only
  // variant — one URL serves every member — so any non-admin who navigates
  // here previously saw fully live create/edit/delete controls that the
  // backend would reject with a bare 403. Personal edition (no enterprise
  // context at all) has nothing to gate: a solo user manages their own
  // resources outright.
  const readOnly = Boolean(context?.isEnterprise) && !isOrgAdminRole(context?.role);

  useEffect(() => {
    const section = searchParams.get('section');
    if (!section || !SECTION_IDS.has(section)) return;
    // Sections load their data async; defer the scroll so heights settle.
    const timer = window.setTimeout(() => {
      document.getElementById(`registry-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [searchParams]);

  return (
    <div className='flex flex-col gap-16px'>
      <div id='registry-section-milestones'>
        <MilestonesSection readOnly={readOnly} />
      </div>
      <div id='registry-section-testplans'>
        <TestPlansSection readOnly={readOnly} />
      </div>
      <div id='registry-section-pipelines'>
        <PipelinesSection readOnly={readOnly} />
      </div>
      <div id='registry-section-skills'>
        <SkillsSection readOnly={readOnly} />
      </div>
      <div id='registry-section-mcp'>
        <McpSection readOnly={readOnly} />
      </div>
      <div id='registry-section-rag'>
        <RagSection readOnly={readOnly} />
      </div>
    </div>
  );
};

export default RegistriesTab;
