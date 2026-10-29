/**
 * Copyright 2026 One Work
 */

/**
 * Edit a scene from where it is used — its card on the home page, or the badge in a scene's own
 * conversation — instead of detouring through the scenes tab.
 *
 * It is the same editor the scenes tab uses, so a person changes the prompt, skills and tools in
 * one familiar place. The boundaries stay the same too: only a scene the person owns (their own,
 * or a built-in starter copied onto this machine) can be edited; a scene a company administrator
 * issued belongs to the company and is only explained, never opened for editing.
 *
 * A saved change never rewrites a conversation that already exists: each conversation keeps the
 * snapshot it started with (rules, skills, tools). The next conversation opened from the scene
 * uses the new settings, and the message after saving says exactly that when the person is
 * inside a running conversation.
 */

import { Message } from '@arco-design/web-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import SceneEditor from '@/renderer/components/scenes/SceneEditor';
import { useScenes } from '@/renderer/components/scenes/useScenes';

export type SceneQuickEdit = {
  /** Whether the scene with this key is one this person may edit. */
  canEdit: (sceneKey: string | undefined) => boolean;
  /** Open the editor for the scene, or say why it cannot be edited. */
  open: (sceneKey: string | undefined) => void;
  /** The editor drawer; render it once next to whatever opens it. */
  element: React.ReactNode;
};

export function useSceneQuickEdit(options: { insideConversation?: boolean } = {}): SceneQuickEdit {
  const { insideConversation = false } = options;
  const { t } = useTranslation();
  const { all, savePersonal } = useScenes();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // The editor loads the MCP catalogue as soon as it mounts; mount it on first use, not on every page.
  const [everOpened, setEverOpened] = useState(false);

  const editable = useMemo(() => {
    const keys = new Set<string>();
    for (const item of all) if (item.mine) keys.add(item.key);
    return keys;
  }, [all]);
  const scene = useMemo<PersonalScene | null>(
    () => (editingKey ? (all.find((item) => item.key === editingKey)?.mine ?? null) : null),
    [all, editingKey]
  );

  const canEdit = useCallback(
    (sceneKey: string | undefined) => Boolean(sceneKey && editable.has(sceneKey)),
    [editable]
  );

  const open = useCallback(
    (sceneKey: string | undefined) => {
      if (!sceneKey) return;
      if (editable.has(sceneKey)) {
        setEverOpened(true);
        setEditingKey(sceneKey);
        return;
      }
      // A scene the company issued: the company owns its definition.
      if (all.some((item) => item.key === sceneKey)) {
        Message.info(t('common.scenes.editCompanyReadOnly'));
      }
    },
    [all, editable, t]
  );

  const handleSave = useCallback(
    async (next: PersonalScene) => {
      try {
        await savePersonal(next);
        setEditingKey(null);
        Message.success(insideConversation ? t('common.scenes.editSavedKeepsCurrent') : t('common.scenes.saved'));
      } catch (error) {
        console.error('[SceneQuickEdit] Failed to save a scene:', error);
        Message.error(t('common.scenes.saveFailed'));
      }
    },
    [insideConversation, savePersonal, t]
  );

  const element = everOpened ? (
    <SceneEditor
      visible={scene !== null}
      mode='edit'
      scene={scene}
      onCancel={() => setEditingKey(null)}
      onSave={handleSave}
    />
  ) : null;

  return { canEdit, open, element };
}
