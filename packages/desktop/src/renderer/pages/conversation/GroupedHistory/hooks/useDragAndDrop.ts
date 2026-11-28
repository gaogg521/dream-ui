/**
 * Copyright 2026 One Work
 */

import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { closestCenter, pointerWithin, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { emitter } from '@/renderer/utils/emitter';
import { useCallback, useRef, useState } from 'react';

import {
  assignInitialSortOrders,
  computeSortOrder,
  getConversationSortOrder,
  needsReindex,
  reindexSortOrders,
} from '../utils/sortOrderHelpers';

type UseDragAndDropParams = {
  pinnedConversations: TChatConversation[];
  batchMode: boolean;
  collapsed: boolean;
  onMoveToProject: (conversationId: string, workspace: string) => Promise<boolean>;
};

export const historyCollisionDetection: CollisionDetection = (args) => {
  const isHistory = args.active.data.current?.type === 'history';
  const droppableContainers = args.droppableContainers.filter(
    (container) => (container.data.current?.type === 'project') === isHistory
  );
  return (isHistory ? pointerWithin : closestCenter)({ ...args, droppableContainers });
};

export const useDragAndDrop = ({
  pinnedConversations,
  batchMode,
  collapsed,
  onMoveToProject,
}: UseDragAndDropParams) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<TChatConversation | null>(null);
  const isDraggingRef = useRef(false);

  const isDragEnabled = !batchMode && !collapsed && !isMobile;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const persistSortOrder = useCallback(async (conversation_id: string, sortOrder: number) => {
    try {
      await ipcBridge.conversation.update.invoke({
        id: conversation_id,
        updates: {
          extra: {
            sortOrder,
          } as Partial<TChatConversation['extra']>,
        } as Partial<TChatConversation>,
        merge_extra: true,
      });
    } catch (error) {
      console.error('[DragAndDrop] Failed to persist sort order:', error);
    }
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    isDraggingRef.current = true;

    setActiveConversation(event.active.data.current?.conversation ?? null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setActiveConversation(null);
      isDraggingRef.current = false;

      if (!over || active.id === over.id) return;

      const source = active.data.current;
      const target = over.data.current;
      if (source?.type === 'history') {
        if (target?.type === 'project' && typeof target.workspace === 'string') {
          await onMoveToProject(source.conversation.id, target.workspace);
        }
        return;
      }

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      // Build pinned items list with sort orders
      const items = pinnedConversations.map((c) => ({
        id: c.id,
        sortOrder: getConversationSortOrder(c),
      }));
      const itemsWithOrder = assignInitialSortOrders(items);

      const oldIndex = itemsWithOrder.findIndex((i) => i.id === activeIdStr);
      const newIndex = itemsWithOrder.findIndex((i) => i.id === overIdStr);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(itemsWithOrder, oldIndex, newIndex);
      const before = newIndex > 0 ? reordered[newIndex - 1].sortOrder : undefined;
      const after = newIndex < reordered.length - 1 ? reordered[newIndex + 1].sortOrder : undefined;
      const newSortOrder = computeSortOrder(before, after);

      // The sidebar sorts persisted ranks before unranked rows, so the first
      // reorder must persist ranks for the whole list.
      if (
        items.some((item) => item.sortOrder === undefined) ||
        needsReindex(reordered.map((i) => ({ sortOrder: i.id === activeIdStr ? newSortOrder : i.sortOrder })))
      ) {
        const reindexed = reindexSortOrders(reordered);
        await Promise.all(reindexed.map((item) => persistSortOrder(item.id, item.sortOrder)));
        emitter.emit('chat.history.refresh');
        return;
      }

      await persistSortOrder(activeIdStr, newSortOrder);
      emitter.emit('chat.history.refresh');
    },
    [onMoveToProject, pinnedConversations, persistSortOrder]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveConversation(null);
    isDraggingRef.current = false;
  }, []);

  return {
    sensors,
    activeId,
    activeConversation,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    isDragEnabled,
  };
};
