/**
 * Copyright 2026 One Work
 */

/**
 * Enterprise scenes, as a compact strip of small cards under the Guid composer.
 *
 * A scene is a role plus a resource package an admin granted, and the home page
 * only needs to say which ones the member carries — so each is a one-line card
 * (avatar, name, how many skills and tools it hands over), with the first four
 * shown and the rest behind "show all". The description and job functions are
 * one hover away rather than taking a card's worth of height each.
 *
 * A card is something to click: it opens a conversation that already has the
 * scene's prompt and skills (see `sceneChat`). Which scenes a member has is the
 * company's call, but which one comes first is theirs, so the cards can be
 * dragged into the order they like (see `sceneOrder`).
 */

import { ipcBridge } from '@/common';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseRemoteActive,
} from '@/common/adapter/enterpriseMode';
import type { MyScene, MySceneResourceSummary } from '@/common/types/platform/enterpriseTypes';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Application, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import officeAvatar from '@/renderer/assets/scenes/office.png';
import itOpsAvatar from '@/renderer/assets/scenes/it-ops.png';
import securityAvatar from '@/renderer/assets/scenes/cybersecurity.png';
import mediaAvatar from '@/renderer/assets/scenes/media-ops.png';
import marketingAvatar from '@/renderer/assets/scenes/marketing.png';

import styles from './EnterpriseHome.module.css';
import { applySceneOrder, loadSceneOrder, moveScene, saveSceneOrder } from './sceneOrder';

const BUILTIN_AVATARS: Record<string, string> = {
  办公: officeAvatar,
  IT运维: itOpsAvatar,
  网络安全: securityAvatar,
  新媒体运营: mediaAvatar,
  市场营销: marketingAvatar,
};

/** Scenes shown before "show all". One row at the home page's usual width. */
const COLLAPSED_SCENE_COUNT = 4;

/** Pixels a press must travel before it is a drag; less than that is a click. */
const DRAG_ACTIVATION_DISTANCE = 8;

type SceneCardProps = { scene: MyScene; opening: boolean; disabled: boolean; onOpen: (scene: MyScene) => void };

const SceneCard: React.FC<SceneCardProps> = ({ scene, opening, disabled, onOpen }) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  const resourceValue = (summary: MySceneResourceSummary): string =>
    summary.includesAll ? t('common.scenes.resourceAll', { defaultValue: '全部' }) : String(summary.count);
  const tooltip = [scene.name, scene.description, scene.jobFunctions.join(' · ')]
    .filter(Boolean)
    .join(String.fromCharCode(10));

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role='button'
      tabIndex={0}
      aria-busy={opening}
      aria-disabled={disabled}
      className={[styles.card, isDragging ? styles.dragging : '', opening ? styles.opening : ''].join(' ')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-scene-name={scene.name}
      title={tooltip}
      onClick={() => {
        if (!disabled && !isDragging) onOpen(scene);
      }}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
          event.preventDefault();
          onOpen(scene);
        }
      }}
    >
      <img src={scene.avatarRef || BUILTIN_AVATARS[scene.name] || officeAvatar} alt='' className={styles.avatar} />
      <div className={styles.cardBody}>
        <span className={styles.name}>{scene.name}</span>
        <div className={styles.resources}>
          {scene.resources.length > 0 ? (
            scene.resources.map((summary) => (
              <span key={summary.resourceType} className={styles.resource}>
                <span>
                  {t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType })}
                </span>
                <span className={styles.resourceValue}>{resourceValue(summary)}</span>
              </span>
            ))
          ) : (
            <span>{t('common.scenes.noResources', { defaultValue: '该场景暂未配置授权包' })}</span>
          )}
        </div>
      </div>
    </div>
  );
};

type EnterpriseSceneGridProps = {
  /** Open a conversation from the scene. Resolve when it has been opened (or has failed). */
  onOpenScene?: (scene: MyScene) => void | Promise<void>;
};

const EnterpriseSceneGrid: React.FC<EnterpriseSceneGridProps> = ({ onOpenScene }) => {
  const { t } = useTranslation();
  const { context } = useOrgContext();
  const [expanded, setExpanded] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const active = Boolean(context?.isEnterprise && isEnterpriseRemoteActive());
  const tenantId = context?.tenantId ?? '';
  const server = getEnterpriseServerUrl();
  const userId = getEnterpriseSession()?.userId ?? null;
  const orderScope = useMemo(() => ({ server, tenantId, userId }), [server, tenantId, userId]);
  const [order, setOrder] = useState<string[]>(() => loadSceneOrder(orderScope));
  // Another member, project group or server on this machine has its own order.
  useEffect(() => setOrder(loadSceneOrder(orderScope)), [orderScope]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } })
  );
  const {
    data: scenes,
    mutate,
    isValidating,
    error,
  } = useSWR<MyScene[]>(
    active
      ? ['enterprise-conversation-scenes', getEnterpriseServerUrl(), getEnterpriseSession()?.userId, tenantId]
      : null,
    async () => {
      // A server (or bridge) that answers with anything but a list is treated as no scenes.
      const list = await ipcBridge.onePlatform.myScenes.invoke();
      return Array.isArray(list) ? list : [];
    },
    { revalidateOnFocus: true, refreshInterval: 30000, shouldRetryOnError: false }
  );

  const ordered = useMemo(() => applySceneOrder(Array.isArray(scenes) ? scenes : [], order), [scenes, order]);

  if (!active) return null;
  if (!scenes)
    return error ? (
      <div className={styles.empty} role='status'>
        <span>{t('common.error')}</span>
        <Button onClick={() => void mutate()} loading={isValidating}>
          {t('common.retry')}
        </Button>
      </div>
    ) : null;

  if (scenes.length === 0)
    return (
      <div className={styles.compactEmpty} data-testid='enterprise-scene-grid'>
        <Application size={18} className='shrink-0 text-t-tertiary' />
        <div className={styles.compactCopy}>
          <span className={styles.compactTitle}>{t('common.scenes.title')}</span>
          <span className={styles.compactHint} title={t('common.scenes.empty')}>
            {t('common.scenes.empty')}
          </span>
        </div>
        <Button
          type='text'
          size='small'
          loading={isValidating}
          icon={<Refresh size={14} />}
          onClick={() => void mutate()}
        >
          {t('common.refresh')}
        </Button>
      </div>
    );

  const visible = expanded ? ordered : ordered.slice(0, COLLAPSED_SCENE_COUNT);
  const hiddenCount = ordered.length - COLLAPSED_SCENE_COUNT;

  const handleOpen = async (scene: MyScene) => {
    if (openingId || !onOpenScene) return;
    setOpeningId(scene.id);
    try {
      await onOpenScene(scene);
    } finally {
      setOpeningId(null);
    }
  };

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over) return;
    // Reorder within the full list, so a scene dragged to the front of the
    // visible four also leads once the rest are shown.
    const next = moveScene(
      ordered.map((scene) => scene.id),
      String(dragged.id),
      String(over.id)
    );
    setOrder(next);
    saveSceneOrder(orderScope, next);
  };

  return (
    <div className={styles.section} data-testid='enterprise-scene-grid'>
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <h2 className={styles.title}>{t('common.scenes.title', { defaultValue: '工作场景' })}</h2>
          <span className={styles.hint} title={t('common.scenes.gridHint')}>
            {t('common.scenes.gridHint')}
          </span>
        </div>
        <div className={styles.headingActions}>
          <span className={styles.count}>{scenes.length}</span>
          <Button
            type='text'
            size='small'
            loading={isValidating}
            icon={<Refresh size={14} />}
            onClick={() => void mutate()}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible.map((scene) => scene.id)} strategy={rectSortingStrategy}>
          <div className={styles.grid}>
            {visible.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                opening={openingId === scene.id}
                disabled={Boolean(openingId) || !onOpenScene}
                onOpen={(target) => void handleOpen(target)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
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

export default EnterpriseSceneGrid;
