/**
 * Copyright 2026 One Work
 */

import { useDraggable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React from 'react';

import ConversationRow from './ConversationRow';
import type { ConversationRowProps } from './types';

export const DraggableHistoryRow: React.FC<ConversationRowProps> = (props) => {
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `history:${props.rowId ?? props.conversation.id}`,
    data: { type: 'history', conversation: props.conversation },
  });

  return (
    <div
      ref={setNodeRef}
      className={
        isDragging
          ? 'select-none opacity-40 [&_.conversation-item]:cursor-grabbing'
          : 'select-none [&_.conversation-item]:cursor-grab'
      }
      onDragStart={(event) => event.preventDefault()}
      {...listeners}
    >
      <ConversationRow {...props} />
    </div>
  );
};

const SortableConversationRow: React.FC<ConversationRowProps> = (props) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.conversation.id,
    disabled: props.batchMode,
    data: {
      type: 'conversation',
      conversation: props.conversation,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ConversationRow {...props} />
    </div>
  );
};

export default SortableConversationRow;
