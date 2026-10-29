/**
 * Copyright 2026 One Work
 */

/**
 * Scenes, as a compact strip of small cards under the Guid composer.
 *
 * A scene is an entry point for a kind of work: a role, the skills and tools it
 * needs, and how to turn a rough request into a real one. The home page only
 * needs to say which ones the person has, so each is a one-line card (picture,
 * name, what it carries), with the first four shown and the rest behind "show
 * all". Company scenes and the person's own sit together; the description and
 * example sentences are one hover away rather than taking a card's worth of
 * height each.
 *
 * A card is something to click: it opens a conversation that already has the
 * scene's rules and skills (see `sceneChat`). Which scenes come from the company
 * is the company's call, but which one comes first, and which are switched on,
 * is the person's, so the cards can be dragged into the order they like (see
 * `sceneOrder`).
 */

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { Application, Edit, Plus, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import styles from './SceneGrid.module.css';
import type { SceneItem, SceneItemResource } from '@/renderer/utils/scenes/sceneItem';
import { moveScene } from '@/renderer/utils/scenes/sceneOrder';
import { useScenes } from './useScenes';
import { useSceneQuickEdit } from '@/renderer/hooks/enterprise/useSceneQuickEdit';

/** Scenes shown before "show all". One row at the home page's usual width. */
const COLLAPSED_SCENE_COUNT = 4;

/** Pixels a press must travel before it is a drag; less than that is a click. */
const DRAG_ACTIVATION_DISTANCE = 8;

type SceneCardProps = {
  item: SceneItem;
  opening: boolean;
  disabled: boolean;
  onOpen: (item: SceneItem) => void;
  /** Present only for a scene this person may edit; a company scene has no edit button. */
  onEdit?: (item: SceneItem) => void;
};

const SceneCard: React.FC<SceneCardProps> = ({ item, opening, disabled, onOpen, onEdit }) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  const resourceValue = (summary: SceneItemResource): string =>
    summary.includesAll ? t('common.scenes.resourceAll', { defaultValue: '全部' }) : String(summary.count);
  const jobFunctions = item.company?.jobFunctions ?? [];
  const tooltip = [
    item.name,
    item.description,
    jobFunctions.join(' · '),
    ...item.starters.map((starter) => `"${starter}"`),
  ]
    .filter(Boolean)
    .join(String.fromCharCode(10));
  // What to say under the name when there is no resource count to show.
  const fallbackLine = item.description || item.starters[0] || t('common.scenes.noResources');
  // Name + resources + description is already three text rows, so a card with
  // a description turns vertical: the avatar moves ABOVE the title (aligned
  // with it) and the description gets the full card width to wrap naturally,
  // instead of being squeezed by the avatar into a permanently clipped strip.
  const stacked = Boolean(item.description);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role='button'
      tabIndex={0}
      aria-busy={opening}
      aria-disabled={disabled}
      className={[styles.card, stacked ? styles.stacked : '', isDragging ? styles.dragging : '', opening ? styles.opening : ''].join(
        ' '
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-scene-name={item.name}
      data-scene-source={item.source}
      data-stacked={stacked ? 'true' : 'false'}
      title={tooltip}
      onClick={() => {
        if (!disabled && !isDragging) onOpen(item);
      }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      {item.imageSrc ? (
        <img src={item.imageSrc} alt='' className={styles.avatar} />
      ) : (
        <span className={`${styles.avatar} ${styles.emojiAvatar}`} aria-hidden='true'>
          {item.icon}
        </span>
      )}
      <div className={styles.cardBody}>
        <span className={styles.nameRow}>
          <span className={styles.name}>{item.name}</span>
          {item.source === 'company' && <span className={styles.badge}>{t('common.scenes.sourceCompany')}</span>}
        </span>
        <div className={styles.resources}>
          {item.resources.length > 0 ? (
            item.resources.map((summary) => (
              <span key={summary.resourceType} className={styles.resource}>
                <span>
                  {t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType })}
                </span>
                <span className={styles.resourceValue}>{resourceValue(summary)}</span>
              </span>
            ))
          ) : (
            <span className={styles.fallbackLine}>{fallbackLine}</span>
          )}
        </div>
        {/* A third line says what the scene is for. With no resource counts the line above already does. */}
        {item.resources.length > 0 && item.description ? (
          <div className={styles.description} data-testid='scene-card-description'>
            {item.description}
          </div>
        ) : null}
      </div>
      {onEdit ? (
        <Button
          type='text'
          size='mini'
          className={styles.editButton}
          icon={<Edit size={13} />}
          aria-label={`${t('common.scenes.editScene')} ${item.name}`}
          title={t('common.scenes.editScene')}
          data-testid='scene-card-edit'
          // A press on the button is neither a drag of the card nor a click on it.
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onEdit(item);
          }}
        />
      ) : null}
    </div>
  );
};

type SceneGridProps = {
  /** Open a conversation from the scene. Resolve when it has been opened (or has failed). */
  onOpenScene?: (item: SceneItem) => void | Promise<void>;
  /** The project folder chosen above; a scene opens working in it. */
  workspaceDir?: string;
  /** What a scene is opened with when that is not what the person picked above (the engine). */
  agentNote?: string;
  /** Scenes use the built-in conversation engine even when a CLI tab is selected. */
  modelSelector?: React.ReactNode;
  /** Open this scene as soon as the list is loaded (once), e.g. when the scenes tab sent the person here. */
  autoOpenKey?: string;
  /** Go and make a new scene. Without it the grid offers no way to make one. */
  onCreateScene?: () => void;
};

const SceneGrid: React.FC<SceneGridProps> = ({
  onOpenScene,
  onCreateScene,
  workspaceDir,
  agentNote,
  modelSelector,
  autoOpenKey,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const { companyActive, loaded, all, enabled: ordered, setOrder, refreshCompany, isValidating, error } = useScenes();
  const quickEdit = useSceneQuickEdit();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } })
  );

  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!autoOpenKey || !loaded || !onOpenScene || autoOpened.current === autoOpenKey) return;
    autoOpened.current = autoOpenKey;
    const target = all.find((item) => item.key === autoOpenKey);
    if (!target) return;
    setOpeningKey(target.key);
    void Promise.resolve(onOpenScene(target)).finally(() => setOpeningKey(null));
  }, [autoOpenKey, loaded, all, onOpenScene]);

  if (!loaded) return null;
  if (error && all.length === 0)
    return (
      <div className={styles.empty} role='status'>
        <span>{t('common.error')}</span>
        <Button onClick={() => void refreshCompany()} loading={isValidating}>
          {t('common.retry')}
        </Button>
      </div>
    );

  const createButton = onCreateScene ? (
    <Button type='text' size='small' icon={<Plus size={14} />} onClick={onCreateScene} data-testid='scene-create'>
      {t('common.scenes.create')}
    </Button>
  ) : null;
  const refreshButton = companyActive ? (
    <Button
      type='text'
      size='small'
      loading={isValidating}
      icon={<Refresh size={14} />}
      onClick={() => void refreshCompany()}
    >
      {t('common.refresh')}
    </Button>
  ) : null;

  if (ordered.length === 0) {
    const emptyHint = all.length > 0 ? t('common.scenes.allOff') : t('common.scenes.emptyCreate');
    return (
      <div className={styles.compactEmpty} data-testid='enterprise-scene-grid'>
        <Application size={18} className='shrink-0 text-t-tertiary' />
        <div className={styles.compactCopy}>
          <span className={styles.compactTitle}>{t('common.scenes.title')}</span>
          <span className={styles.compactHint} title={emptyHint}>
            {emptyHint}
          </span>
        </div>
        {createButton}
        {refreshButton}
      </div>
    );
  }

  // A chosen folder is what the next scene will work in; say so, since the choice is made above.
  const folderHint = workspaceDir
    ? t('common.scenes.workspaceHint', { name: workspaceDir.split(/[\\/]/).filter(Boolean).pop() ?? workspaceDir })
    : null;
  const workspaceHint = [folderHint, agentNote].filter(Boolean).join(' · ') || null;
  const visible = expanded ? ordered : ordered.slice(0, COLLAPSED_SCENE_COUNT);
  const hiddenCount = ordered.length - COLLAPSED_SCENE_COUNT;

  const handleOpen = async (item: SceneItem) => {
    if (openingKey || !onOpenScene) return;
    setOpeningKey(item.key);
    try {
      await onOpenScene(item);
    } finally {
      setOpeningKey(null);
    }
  };

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over) return;
    // Reorder within the full list, so a scene dragged to the front of the
    // visible four also leads once the rest are shown.
    setOrder(
      moveScene(
        all.map((item) => item.key),
        String(dragged.id),
        String(over.id)
      )
    );
  };

  return (
    <div className={styles.section} data-testid='enterprise-scene-grid'>
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <h2 className={styles.title}>{t('common.scenes.title', { defaultValue: '工作场景' })}</h2>
          <span className={styles.hint} title={workspaceHint ?? t('common.scenes.gridHint')}>
            {workspaceHint ?? t('common.scenes.gridHint')}
          </span>
        </div>
        <div className={styles.headingActions}>
          {modelSelector && (
            <div className='flex items-center gap-6px' data-testid='scene-model-selector'>
              <span className='text-12px text-t-secondary'>{t('common.scenes.modelLabel')}</span>
              {modelSelector}
            </div>
          )}
          <span className={styles.count}>{ordered.length}</span>
          {createButton}
          {refreshButton}
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible.map((item) => item.key)} strategy={rectSortingStrategy}>
          <div className={styles.grid}>
            {visible.map((item) => (
              <SceneCard
                key={item.key}
                item={item}
                opening={openingKey === item.key}
                disabled={Boolean(openingKey) || !onOpenScene}
                onOpen={(target) => void handleOpen(target)}
                onEdit={quickEdit.canEdit(item.key) ? (target) => quickEdit.open(target.key) : undefined}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {quickEdit.element}
      {hiddenCount > 0 && (
        <div className={styles.more}>
          <Button type='text' size='small' onClick={() => setExpanded((open) => !open)}>
            {expanded ? t('common.collapse') : t('common.scenes.showAll', { count: ordered.length })}
          </Button>
        </div>
      )}
    </div>
  );
};

export default SceneGrid;
