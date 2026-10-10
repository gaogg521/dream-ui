import type { ConversationCommandQueueItem } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { restrictToVerticalAxis } from '@/renderer/utils/ui/dndModifiers';
import {
  type Modifier,
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Typography } from '@arco-design/web-react';
import { ArrowUp, Delete, Drag, Edit } from '@icon-park/react';
import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const getCommandPreview = (input: string): string => input.replace(/\s+/g, ' ').trim();

const createRestrictToQueueContainerModifier = (
  queueContainerRef: React.RefObject<HTMLDivElement | null>
): Modifier => {
  return ({ draggingNodeRect, overlayNodeRect, transform }) => {
    const queueContainerRect = queueContainerRef.current?.getBoundingClientRect();
    const activeRect = overlayNodeRect ?? draggingNodeRect;

    if (!queueContainerRect || !activeRect) {
      return transform;
    }

    const minY = queueContainerRect.top - activeRect.top;
    const maxY = queueContainerRect.bottom - (activeRect.top + activeRect.height);

    return {
      ...transform,
      y: Math.min(Math.max(transform.y, minY), maxY),
    };
  };
};

type CommandQueuePanelProps = {
  items: ConversationCommandQueueItem[];
  interactionLocked: boolean;
  isMobile?: boolean;
  onInteractionLock: () => void;
  onInteractionUnlock: () => void;
  onUpdate?: (commandId: string, input: string) => boolean;
  onEdit?: (item: ConversationCommandQueueItem) => void;
  onSendNow: (item: ConversationCommandQueueItem) => void;
  onReorder: (activeCommandId: string, overCommandId: string) => void;
  onRemove: (commandId: string) => void;
};

type RenderActionIconButtonArgs = {
  ariaLabel: string;
  disabled?: boolean;
  onClick?: () => void;
  icon: React.ReactNode;
  danger?: boolean;
  accent?: boolean;
};

type SortableQueueItemProps = {
  item: ConversationCommandQueueItem;
  dragDisabled: boolean;
  dragViaCard: boolean;
  dragHandleLabel: string;
  preview: string;
  fileCountLabel: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onEdit?: (item: ConversationCommandQueueItem) => void;
  onSendNow: (item: ConversationCommandQueueItem) => void;
  onRemove: (commandId: string) => void;
  onDragHandlePointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

type QueueItemCardProps = {
  item: ConversationCommandQueueItem;
  isDragging: boolean;
  dragDisabled: boolean;
  dragViaCard: boolean;
  dragHandleLabel: string;
  preview: string;
  fileCountLabel: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onEdit?: (item: ConversationCommandQueueItem) => void;
  onSendNow: (item: ConversationCommandQueueItem) => void;
  onRemove: (commandId: string) => void;
  onDragHandlePointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  dragHandleButtonProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
  dragHandleRef: (element: HTMLButtonElement | null) => void;
  cardDragListeners?: React.HTMLAttributes<HTMLDivElement>;
  cardDragRef?: (element: HTMLElement | null) => void;
};

const renderQueueActionIconButton = ({
  ariaLabel,
  disabled = false,
  onClick,
  icon,
  danger = false,
  accent = false,
}: RenderActionIconButtonArgs) => (
  <Button
    size='mini'
    type='text'
    shape='circle'
    className='w-24px h-24px min-w-24px p-0 opacity-72 hover:opacity-100'
    disabled={disabled}
    status={danger ? 'danger' : 'default'}
    aria-label={ariaLabel}
    title={ariaLabel}
    onClick={onClick}
    icon={
      <>
        <span
          className='inline-flex items-center justify-center'
          aria-hidden='true'
          style={{
            color: danger
              ? 'rgb(var(--danger-6))'
              : accent
                ? 'rgb(var(--primary-6))'
                : disabled
                  ? 'var(--color-text-4)'
                  : 'var(--color-text-3)',
          }}
        >
          {icon}
        </span>
      </>
    }
  />
);

const QueueItemCard: React.FC<QueueItemCardProps> = ({
  item,
  isDragging,
  dragDisabled,
  dragViaCard,
  dragHandleLabel,
  preview,
  fileCountLabel,
  t,
  onEdit,
  onSendNow,
  onRemove,
  onDragHandlePointerDown,
  dragHandleButtonProps,
  dragHandleRef,
  cardDragListeners,
  cardDragRef,
}) => {
  const { onPointerDown: onSortableDragHandlePointerDown, ...restDragHandleButtonProps } = dragHandleButtonProps ?? {};
  return (
    <div
      {...(dragViaCard ? cardDragListeners : {})}
      ref={dragViaCard ? cardDragRef : undefined}
      className='group flex items-center justify-between gap-6px rd-10px px-8px py-5px transition-[background-color,opacity] duration-180 ease-out'
      data-command-id={item.id}
      data-sortable={dragDisabled ? 'disabled' : 'enabled'}
      aria-grabbed={isDragging}
      aria-label={preview}
      style={{
        background: isDragging
          ? 'color-mix(in srgb, var(--color-fill-2) 88%, var(--color-bg-1))'
          : 'color-mix(in srgb, var(--color-fill-1) 76%, transparent)',
        touchAction: dragViaCard && !dragDisabled ? 'none' : undefined,
      }}
    >
      <div className='flex items-center gap-6px min-w-0 flex-1 relative ps-8px'>
        <div className='flex items-center w-10px shrink-0 relative'>
          <button
            {...restDragHandleButtonProps}
            ref={dragHandleRef}
            type='button'
            aria-label={dragHandleLabel}
            disabled={dragDisabled}
            data-drag-handle={dragDisabled ? 'disabled' : 'enabled'}
            data-floating-handle='visible'
            className={`absolute inline-flex h-16px w-12px items-center justify-center border-none bg-transparent p-0 outline-none transition-[opacity,color] duration-160 ease-out ${
              dragDisabled
                ? 'cursor-default opacity-0'
                : isDragging
                  ? 'cursor-grabbing opacity-100'
                  : 'cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
            style={{
              left: '-6px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-3)',
              touchAction: dragDisabled ? undefined : 'none',
            }}
            onPointerDown={(event) => {
              onDragHandlePointerDown(event);
              onSortableDragHandlePointerDown?.(event);
            }}
          >
            <Drag theme='outline' size='12' strokeWidth={2.5} />
          </button>
        </div>
        <div className='min-w-0 flex-1 flex items-center gap-6px'>
          <Typography.Ellipsis rows={1} showTooltip className='min-w-0 flex-1 text-13px leading-20px text-t-primary'>
            {preview}
          </Typography.Ellipsis>
          {fileCountLabel ? (
            <span
              className='inline-flex items-center rd-999px px-5px py-1px text-9px leading-none shrink-0'
              style={{
                color: 'var(--color-text-3)',
                background: 'color-mix(in srgb, var(--color-fill-2) 72%, transparent)',
              }}
            >
              {fileCountLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className='flex items-center gap-2px shrink-0 h-24px overflow-hidden'>
        <Button
          size='mini'
          type='secondary'
          shape='round'
          className='h-24px px-8px me-2px'
          aria-label={t('conversation.commandQueue.sendNow', { defaultValue: 'Send now' })}
          onClick={() => onSendNow(item)}
        >
          <span className='inline-flex items-center gap-3px text-12px'>
            <ArrowUp theme='outline' size='12' strokeWidth={3} />
            {t('conversation.commandQueue.sendNow', { defaultValue: 'Send now' })}
          </span>
        </Button>
        {renderQueueActionIconButton({
          ariaLabel: t('conversation.commandQueue.edit', { defaultValue: 'Edit' }),
          onClick: () => onEdit?.(item),
          icon: <Edit theme='outline' size='14' strokeWidth={2.5} />,
        })}
        {renderQueueActionIconButton({
          ariaLabel: t('conversation.commandQueue.remove', { defaultValue: 'Remove' }),
          onClick: () => onRemove(item.id),
          icon: <Delete theme='outline' size='14' strokeWidth={2.5} />,
          danger: true,
        })}
      </div>
    </div>
  );
};

const SortableQueueItem: React.FC<SortableQueueItemProps> = ({
  item,
  dragDisabled,
  dragViaCard,
  dragHandleLabel,
  preview,
  fileCountLabel,
  t,
  onEdit,
  onSendNow,
  onRemove,
  onDragHandlePointerDown,
}) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: dragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.58 : 1,
    zIndex: isDragging ? 2 : undefined,
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={style}>
      <QueueItemCard
        item={item}
        isDragging={isDragging}
        dragDisabled={dragDisabled}
        dragViaCard={dragViaCard}
        dragHandleLabel={dragHandleLabel}
        preview={preview}
        fileCountLabel={fileCountLabel}
        t={t}
        onEdit={onEdit}
        onSendNow={onSendNow}
        onRemove={onRemove}
        onDragHandlePointerDown={onDragHandlePointerDown}
        dragHandleRef={dragViaCard ? undefined : setActivatorNodeRef}
        dragHandleButtonProps={
          dragViaCard
            ? {}
            : {
                ...(attributes as React.ButtonHTMLAttributes<HTMLButtonElement>),
                ...(listeners as React.ButtonHTMLAttributes<HTMLButtonElement>),
              }
        }
        cardDragRef={dragViaCard ? setActivatorNodeRef : undefined}
        cardDragListeners={
          dragViaCard
            ? {
                ...(attributes as React.HTMLAttributes<HTMLDivElement>),
                ...(listeners as React.HTMLAttributes<HTMLDivElement>),
              }
            : undefined
        }
      />
    </div>
  );
};

const CommandQueuePanel: React.FC<CommandQueuePanelProps> = ({
  items,
  interactionLocked,
  isMobile = false,
  onInteractionLock,
  onInteractionUnlock,
  onEdit,
  onSendNow,
  onReorder,
  onRemove,
}) => {
  const { t } = useTranslation();
  const queueContainerRef = useRef<HTMLDivElement | null>(null);
  const activeDragHandleRef = useRef<HTMLButtonElement | null>(null);
  // Desktop: drag starts after moving 8px from the handle.
  // Narrow / mobile: no handle, so long-press the whole row (200ms) starts the drag;
  // the delay keeps a normal tap on the action buttons from being read as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: isMobile ? { delay: 200, tolerance: 6 } : { distance: 8 },
    })
  );

  const clearDragHandleFocus = () => {
    activeDragHandleRef.current?.blur();
    activeDragHandleRef.current = null;
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    onInteractionUnlock();
    clearDragHandleFocus();

    if (!over || active.id === over.id) {
      return;
    }

    onReorder(String(active.id), String(over.id));
  };

  const handleDragStart = () => {
    if (interactionLocked) {
      return;
    }

    onInteractionLock();
  };

  const handleDragCancel = () => {
    onInteractionUnlock();
    clearDragHandleFocus();
  };

  const dragHandleLabel = t('conversation.commandQueue.reorder', {
    defaultValue: 'Drag to reorder queued command',
  });
  const dragModifiers = useMemo(
    () => [restrictToVerticalAxis, createRestrictToQueueContainerModifier(queueContainerRef)],
    []
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <div className='relative z-1 mb--12px px-8px pt-8px pb-12px'>
      <div
        aria-label={t('conversation.commandQueue.title', { defaultValue: 'Queued messages' })}
        data-command-queue='true'
        className='overflow-hidden rd-t-18px border b-solid'
        style={{
          borderColor: 'color-mix(in srgb, var(--color-border-2) 56%, transparent)',
          background: 'color-mix(in srgb, var(--color-fill-1) 84%, var(--color-bg-1))',
        }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          modifiers={dragModifiers}
        >
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div
              ref={queueContainerRef}
              data-command-queue-list='true'
              data-drag-axis='vertical'
              data-drag-bounds='queue'
              className='p-6px flex flex-col gap-4px overflow-y-auto overscroll-contain'
              style={{
                maxHeight: isMobile ? 'min(48vh, 320px)' : 'min(36vh, 320px)',
              }}
            >
              {items.map((item) => {
                const preview = getCommandPreview(item.input);
                const fileCountLabel =
                  item.files.length > 0
                    ? t('conversation.commandQueue.files', {
                        count: item.files.length,
                        defaultValue: `${item.files.length} files`,
                      })
                    : null;

                return (
                  <SortableQueueItem
                    key={item.id}
                    item={item}
                    dragDisabled={false}
                    dragViaCard={isMobile}
                    dragHandleLabel={dragHandleLabel}
                    preview={preview}
                    fileCountLabel={fileCountLabel}
                    t={t}
                    onEdit={onEdit}
                    onSendNow={onSendNow}
                    onRemove={onRemove}
                    onDragHandlePointerDown={(event) => {
                      activeDragHandleRef.current = event.currentTarget;
                    }}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};

export default CommandQueuePanel;
