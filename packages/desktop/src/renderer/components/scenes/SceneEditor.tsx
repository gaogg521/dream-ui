/**
 * Copyright 2026 One Work
 */

/**
 * The drawer where a person makes or edits their own scene.
 *
 * It asks for what makes a scene more than a preset. Name, picture and the
 * standing prompt are the obvious part; the rest is how the scene turns a rough
 * request into a real one: whether to run a requirements round first, which
 * questions that round must always cover, what the work must never do, and what
 * is handed over. At the bottom is the exact text the conversation will be told,
 * so nothing about a scene is hidden from the person who wrote it.
 */

import { ipcBridge } from '@/common';
import { SCENE_LIMITS, type PersonalScene, type SceneIntent } from '@/common/types/platform/sceneTypes';
import { useMcpServers } from '@/renderer/hooks/mcp';
import { SCENE_ICONS, personalSceneProblems } from '@/renderer/utils/scenes/personalScenes';
import { buildSceneRules } from '@/renderer/utils/scenes/sceneProtocol';
import { Button, Collapse, Drawer, Input, Select, Switch } from '@arco-design/web-react';
import { Delete, Plus } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import styles from './SceneEditor.module.css';

type SceneEditorProps = {
  visible: boolean;
  /** `new` for a fresh draft (possibly from a template), `edit` for a scene already saved. */
  mode: 'new' | 'edit';
  /** The scene being edited, or the draft for a new one. */
  scene: PersonalScene | null;
  onCancel: () => void;
  onSave: (scene: PersonalScene) => void | Promise<void>;
};

/** A list of one-line texts the person can add to and remove from. */
const LineList: React.FC<{
  items: string[];
  max: number;
  maxLength: number;
  placeholder: string;
  addLabel: string;
  testId: string;
  onChange: (items: string[]) => void;
}> = ({ items, max, maxLength, placeholder, addLabel, testId, onChange }) => (
  <div className='flex flex-col gap-6px' data-testid={testId}>
    {items.map((item, index) => (
      <div key={index} className='flex items-center gap-6px'>
        <Input
          value={item}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(value) => onChange(items.map((current, at) => (at === index ? value : current)))}
        />
        <Button
          type='text'
          size='small'
          aria-label='remove'
          icon={<Delete size={14} />}
          onClick={() => onChange(items.filter((_, at) => at !== index))}
        />
      </div>
    ))}
    {items.length < max && (
      <div>
        <Button type='secondary' size='small' icon={<Plus size={14} />} onClick={() => onChange([...items, ''])}>
          {addLabel}
        </Button>
      </div>
    )}
  </div>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className='flex flex-col gap-4px'>
    <div className='text-13px font-500 text-t-primary'>{label}</div>
    {hint ? <div className='text-12px text-t-tertiary'>{hint}</div> : null}
    {children}
  </div>
);

const SceneEditor: React.FC<SceneEditorProps> = ({ visible, mode, scene, onCancel, onSave }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PersonalScene | null>(scene);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setDraft(scene);
    setTouched(false);
  }, [scene, visible]);

  const { data: skills } = useSWR(visible ? 'scene-editor-skills' : null, () =>
    ipcBridge.fs.listAvailableSkills.invoke()
  );
  const { mcpServers } = useMcpServers();
  const skillOptions = useMemo(
    () =>
      (skills ?? [])
        // Skills that are always on need no choosing.
        .filter((skill) => !skill.is_auto_inject)
        .map((skill) => ({ label: skill.name, value: skill.name })),
    [skills]
  );
  const mcpOptions = useMemo(
    () =>
      mcpServers.map((server) => ({
        label: server.name,
        value: server.builtin ? `builtin:${server.name}` : server.id,
      })),
    [mcpServers]
  );

  const rules = useMemo(
    () =>
      draft
        ? buildSceneRules({
            name: draft.name.trim() || t('common.scenes.editor.untitled'),
            description: draft.description,
            prompt: draft.prompt,
            intent: draft.intent,
          })
        : '',
    [draft, t]
  );

  if (!draft) return null;
  const problems = personalSceneProblems(draft);
  const set = (patch: Partial<PersonalScene>) => setDraft({ ...draft, ...patch });
  const setIntent = (patch: Partial<SceneIntent>) => setDraft({ ...draft, intent: { ...draft.intent, ...patch } });

  const handleSave = async () => {
    setTouched(true);
    if (problems.length > 0) return;
    setSaving(true);
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        intent: {
          ...draft.intent,
          // Empty lines are drafts the person never filled in.
          starters: draft.intent.starters.map((item) => item.trim()).filter(Boolean),
          questions: draft.intent.questions.map((item) => item.trim()).filter(Boolean),
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      visible={visible}
      width={560}
      title={mode === 'new' ? t('common.scenes.editor.titleNew') : t('common.scenes.editor.titleEdit')}
      onCancel={onCancel}
      maskClosable={false}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type='primary' loading={saving} onClick={() => void handleSave()} data-testid='scene-save'>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className={`flex flex-col gap-18px ${styles.fields}`} data-testid='scene-editor'>
        <Field label={t('common.scenes.editor.icon')}>
          <div className='flex flex-wrap gap-6px'>
            {SCENE_ICONS.map((icon) => (
              <Button
                key={icon}
                size='small'
                type={draft.icon === icon ? 'primary' : 'secondary'}
                aria-label={icon}
                onClick={() => set({ icon })}
              >
                <span className='text-16px leading-none'>{icon}</span>
              </Button>
            ))}
          </div>
        </Field>

        <Field label={t('common.scenes.editor.name')}>
          <Input
            value={draft.name}
            maxLength={SCENE_LIMITS.name}
            showWordLimit
            placeholder={t('common.scenes.editor.namePlaceholder')}
            status={touched && problems.length > 0 ? 'error' : undefined}
            onChange={(name) => set({ name })}
            data-testid='scene-name'
          />
          {touched && problems.length > 0 ? (
            <div className='text-12px text-danger'>{t('common.scenes.editor.nameRequired')}</div>
          ) : null}
        </Field>

        <Field label={t('common.scenes.editor.description')}>
          <Input
            value={draft.description}
            maxLength={SCENE_LIMITS.description}
            placeholder={t('common.scenes.editor.descriptionPlaceholder')}
            onChange={(description) => set({ description })}
          />
        </Field>

        <Field label={t('common.scenes.editor.prompt')} hint={t('common.scenes.editor.promptHint')}>
          <Input.TextArea
            value={draft.prompt}
            maxLength={SCENE_LIMITS.prompt}
            autoSize={{ minRows: 3, maxRows: 10 }}
            placeholder={t('common.scenes.editor.promptPlaceholder')}
            onChange={(prompt) => set({ prompt })}
          />
        </Field>

        <div className='rounded-8px border border-2 p-12px'>
          <div className='flex items-center justify-between gap-12px'>
            <div className='min-w-0'>
              <div className='text-13px font-500 text-t-primary'>{t('common.scenes.editor.discovery')}</div>
              <div className='text-12px text-t-tertiary'>{t('common.scenes.editor.discoveryHint')}</div>
            </div>
            <Switch
              checked={draft.intent.discovery}
              aria-label={t('common.scenes.editor.discovery')}
              onChange={(discovery) => setIntent({ discovery })}
            />
          </div>
        </div>

        {draft.intent.discovery ? (
          <div className='flex flex-col gap-18px' data-testid='scene-discovery-fields'>
            <Field label={t('common.scenes.editor.questions')} hint={t('common.scenes.editor.questionsHint')}>
              <LineList
                testId='scene-questions'
                items={draft.intent.questions}
                max={SCENE_LIMITS.questions}
                maxLength={SCENE_LIMITS.question}
                placeholder={t('common.scenes.editor.questionPlaceholder')}
                addLabel={t('common.scenes.editor.questionsAdd')}
                onChange={(questions) => setIntent({ questions })}
              />
            </Field>

            <Field label={t('common.scenes.editor.starters')} hint={t('common.scenes.editor.startersHint')}>
              <LineList
                testId='scene-starters'
                items={draft.intent.starters}
                max={SCENE_LIMITS.starters}
                maxLength={SCENE_LIMITS.starter}
                placeholder={t('common.scenes.editor.starterPlaceholder')}
                addLabel={t('common.scenes.editor.startersAdd')}
                onChange={(starters) => setIntent({ starters })}
              />
            </Field>

            <Field label={t('common.scenes.editor.constraints')} hint={t('common.scenes.editor.constraintsHint')}>
              <Input.TextArea
                value={draft.intent.constraints}
                maxLength={SCENE_LIMITS.constraints}
                autoSize={{ minRows: 2, maxRows: 8 }}
                placeholder={t('common.scenes.editor.constraintsPlaceholder')}
                onChange={(constraints) => setIntent({ constraints })}
              />
            </Field>

            <Field label={t('common.scenes.editor.deliverables')} hint={t('common.scenes.editor.deliverablesHint')}>
              <Input.TextArea
                value={draft.intent.deliverables}
                maxLength={SCENE_LIMITS.deliverables}
                autoSize={{ minRows: 2, maxRows: 8 }}
                placeholder={t('common.scenes.editor.deliverablesPlaceholder')}
                onChange={(deliverables) => setIntent({ deliverables })}
              />
            </Field>
          </div>
        ) : null}

        <Field label={t('common.scenes.editor.skills')} hint={t('common.scenes.editor.skillsHint')}>
          <Select
            mode='multiple'
            allowClear
            showSearch
            value={draft.skillNames}
            options={skillOptions}
            placeholder={t('common.scenes.editor.skillsPlaceholder')}
            onChange={(skillNames: string[]) => set({ skillNames })}
          />
        </Field>

        <Field label={t('common.scenes.editor.mcp')} hint={t('common.scenes.editor.mcpHint')}>
          <Select
            mode='multiple'
            allowClear
            showSearch
            value={[...draft.mcpServerIds, ...(draft.builtinMcpNames ?? []).map((name) => `builtin:${name}`)]}
            options={mcpOptions}
            placeholder={t('common.scenes.editor.mcpPlaceholder')}
            onChange={(values: string[]) =>
              set({
                mcpServerIds: values.filter((value) => !value.startsWith('builtin:')),
                builtinMcpNames: values.filter((value) => value.startsWith('builtin:')).map((value) => value.slice(8)),
              })
            }
          />
        </Field>

        <Collapse bordered={false}>
          <Collapse.Item header={t('common.scenes.editor.preview')} name='preview'>
            <div className='mb-6px text-12px text-t-tertiary'>{t('common.scenes.editor.previewHint')}</div>
            <pre
              className='m-0 max-h-320px overflow-auto whitespace-pre-wrap rounded-6px bg-2 p-10px text-12px text-t-secondary'
              data-testid='scene-rules-preview'
            >
              {rules}
            </pre>
          </Collapse.Item>
        </Collapse>
      </div>
    </Drawer>
  );
};

export default SceneEditor;
