/**
 * Copyright 2026 One Work
 */

import React from 'react';
import type { ChatFileRef } from '@/common/types/chatFile';
import OfficeWatchViewer from './OfficeWatchViewer';

interface PptViewerProps {
  fileRef?: ChatFileRef;
  file_path?: string;
  content?: string;
  workspace?: string;
}

const PptViewer: React.FC<PptViewerProps> = (props) => <OfficeWatchViewer docType='ppt' {...props} />;

export default PptViewer;
