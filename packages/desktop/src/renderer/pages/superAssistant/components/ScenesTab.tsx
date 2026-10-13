/**
 * Scenes tab — every scene this person can use, and where they make their own.
 *
 * A scene is an entry point for a kind of work: the standing context, the skills
 * and tools it needs, and how it turns a rough request into a real one (it can
 * run a requirements round before building). This tab is open to everyone. The
 * person's own scenes live here and can be made, changed, copied and removed;
 * scenes a company administrator issued are listed beside them, read-only,
 * because the company owns their definition. Every scene, either kind, has a
 * switch: one switched off leaves the home page until it is switched on again.
 * Nothing is removed by that, and the company's grant is untouched.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Message, Modal, Popconfirm, Spin, Switch, Tag } from '@arco-design/web-react';
import { Copy, Delete, Edit, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import SceneEditor from '@/renderer/components/scenes/SceneEditor';
import { useScenes } from '@/renderer/components/scenes/useScenes';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import { newPersonalScene } from '@/renderer/utils/scenes/personalScenes';
import type { SceneItem } from '@/renderer/utils/scenes/sceneItem';
import {
  SCENE_TEMPLATES,
  getSceneTemplateText,
  templateIntent,
  type SceneTemplate,
} from '@/renderer/utils/scenes/sceneTemplates';

type EditorState = { mode: 'new' | 'edit'; scene: PersonalScene } | null;

const SceneRow: React.FC<{
  item: SceneItem;
  on: boolean;
  onToggle: (on: boolean) => void;
  actions?: React.ReactNode;
}> = ({ item, on, onToggle, actions }) => {
  const { t } = useTranslation();
  const asksFirst = Boolean(item.company?.intent?.discovery ?? item.mine?.intent.discovery);
  return (
    <div
      data-scene-row={item.name}
      data-scene-source={item.source}
      className='flex items-center gap-12px rounded-6px border border-2 bg-2 p-12px'
    >
      {item.imageSrc ? (
        <img
          src={item.imageSrc}
          alt=''
          className={`h-40px w-40px shrink-0 rd-10px object-cover ${on ? '' : 'opacity-50'}`}
        />
      ) : (
        <span
          aria-hidden='true'
          className={`flex h-40px w-40px shrink-0 items-center justify-center rd-10px bg-fill-2 text-20px ${on ? '' : 'opacity-50'}`}
        >
          {item.icon}
        </span>
      )}
      <div className={`min-w-0 flex-1 ${on ? '' : 'opacity-60'}`}>
        <div className='flex min-w-0 items-center gap-6px'>
          <span className='truncate text-14px font-500'>{item.name}</span>
          {asksFirst ? (
            <Tag size='small' color='arcoblue'>
              {t('common.scenes.askFirst')}
            </Tag>
          ) : null}
        </div>
        <div className='mt-2px flex flex-wrap gap-x-10px text-12px text-t-tertiary'>
          {item.resources.map((summary) => (
            <span key={summary.resourceType}>
              {t(`common.scenes.resourceType.${summary.resourceType}`, { defaultValue: summary.resourceType })}{' '}
              <span className='text-t-secondary'>
                {summary.includesAll ? t('common.scenes.resourceAll') : summary.count}
              </span>
            </span>
          ))}
        </div>
        {item.description ? (
          <div className='mt-4px line-clamp-1 text-12px text-t-tertiary'>{item.description}</div>
        ) : null}
      </div>
      {actions}
      <Switch checked={on} aria-label={item.name} onChange={onToggle} />
    </div>
  );
};

const ScenesTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { companyActive, loaded, all, enabled, setEnabled, isEnabled, savePersonal, deletePersonal, error } =
    useScenes();
  const [picking, setPicking] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  // The home page's "create" button lands here with `new=1`: go straight to choosing a start.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setPicking(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const mine = useMemo(() => all.filter((item) => item.source === 'mine'), [all]);
  const company = useMemo(() => all.filter((item) => item.source === 'company'), [all]);

  const startFrom = useCallback(
    (template: SceneTemplate | null) => {
      setPicking(false);
      if (!template) {
        setEditor({ mode: 'new', scene: newPersonalScene() });
        return;
      }
      const text = getSceneTemplateText(template, i18n.language);
      setEditor({
        mode: 'new',
        scene: newPersonalScene({
          name: text.name,
          description: text.description,
          icon: template.icon,
          prompt: text.prompt,
          intent: templateIntent(template, i18n.language),
          templateId: template.id,
        }),
      });
    },
    [i18n.language]
  );

  const handleSave = async (scene: PersonalScene) => {
    try {
      await savePersonal(scene);
      setEditor(null);
      Message.success(t('common.scenes.saved'));
    } catch (saveError) {
      console.error('[ScenesTab] Failed to save a scene:', saveError);
      Message.error(t('common.scenes.saveFailed'));
    }
  };

  const handleDuplicate = async (scene: PersonalScene) => {
    const copy = newPersonalScene({
      ...scene,
      name: `${scene.name} ${t('common.scenes.copySuffix')}`.slice(0, 40),
    });
    try {
      await savePersonal(copy);
    } catch (copyError) {
      console.error('[ScenesTab] Failed to copy a scene:', copyError);
      Message.error(t('common.scenes.saveFailed'));
    }
  };

  const handleDelete = async (scene: PersonalScene) => {
    try {
      await deletePersonal(scene.id);
      Message.success(t('common.scenes.deleted'));
    } catch (deleteError) {
      console.error('[ScenesTab] Failed to delete a scene:', deleteError);
      Message.error(t('common.scenes.saveFailed'));
    }
  };

  if (!loaded) return error ? <Empty description={t('common.error')} /> : <Spin className='w-full py-40px' />;

  return (
    <div className='flex flex-col gap-16px' data-testid='scenes-tab'>
      <div className='flex items-center justify-between gap-12px'>
        <span className='text-12px text-t-tertiary'>{t('common.scenes.tabHint')}</span>
        <div className='flex shrink-0 items-center gap-12px'>
          {all.length > 0 ? (
            <span className='text-12px text-t-secondary'>
              {t('common.scenes.enabledCount', { enabled: enabled.length, total: all.length })}
            </span>
          ) : null}
          <Button type='primary' icon={<Plus size={14} />} onClick={() => setPicking(true)} data-testid='scene-new'>
            {t('common.scenes.newScene')}
          </Button>
        </div>
      </div>

      <section className='flex flex-col gap-8px'>
        <div className='text-13px font-600'>{t('common.scenes.mine')}</div>
        {mine.length === 0 ? (
          <div className='rounded-6px border border-dashed border-2 p-16px text-12px text-t-tertiary'>
            {t('common.scenes.emptyMine')}
          </div>
        ) : (
          <div className='grid gap-12px md:grid-cols-2'>
            {mine.map((item) => (
              <SceneRow
                key={item.key}
                item={item}
                on={isEnabled(item.key)}
                onToggle={(on) => setEnabled(item.key, on)}
                actions={
                  item.mine ? (
                    <div className='flex shrink-0 items-center'>
                      <Button
                        type='text'
                        size='small'
                        aria-label={t('common.edit')}
                        icon={<Edit size={14} />}
                        onClick={() => item.mine && setEditor({ mode: 'edit', scene: item.mine })}
                      />
                      <Button
                        type='text'
                        size='small'
                        aria-label={t('common.scenes.duplicate')}
                        icon={<Copy size={14} />}
                        onClick={() => item.mine && void handleDuplicate(item.mine)}
                      />
                      <Popconfirm
                        title={t('common.scenes.deleteConfirm', { name: item.name })}
                        onOk={() => item.mine && handleDelete(item.mine)}
                      >
                        <Button
                          type='text'
                          size='small'
                          status='danger'
                          aria-label={t('common.delete')}
                          icon={<Delete size={14} />}
                        />
                      </Popconfirm>
                    </div>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </section>

      {companyActive ? (
        <section className='flex flex-col gap-8px'>
          <div className='text-13px font-600'>{t('common.scenes.companyTitle')}</div>
          {company.length === 0 ? (
            <div className='rounded-6px border border-dashed border-2 p-16px text-12px text-t-tertiary'>
              {t('common.scenes.empty')}
            </div>
          ) : (
            <div className='grid gap-12px md:grid-cols-2'>
              {company.map((item) => (
                <SceneRow
                  key={item.key}
                  item={item}
                  on={isEnabled(item.key)}
                  onToggle={(on) => setEnabled(item.key, on)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <Modal
        visible={picking}
        title={t('common.scenes.pickTitle')}
        footer={null}
        onCancel={() => setPicking(false)}
        style={{ width: 640, maxWidth: '92vw' }}
      >
        <div className='mb-12px text-12px text-t-tertiary'>{t('common.scenes.pickHint')}</div>
        <div className='grid gap-10px md:grid-cols-2' data-testid='scene-templates'>
          {SCENE_TEMPLATES.map((template) => {
            const text = getSceneTemplateText(template, i18n.language);
            return (
              <Button
                key={template.id}
                long
                className='!h-auto !justify-start !whitespace-normal !py-10px !text-left'
                data-template={template.id}
                onClick={() => startFrom(template)}
              >
                <span className='flex items-start gap-10px'>
                  <span className='text-20px leading-none'>{template.icon}</span>
                  <span className='flex min-w-0 flex-col'>
                    <span className='text-13px font-500'>{text.name}</span>
                    <span className='mt-2px text-12px font-400 text-t-tertiary'>{text.description}</span>
                  </span>
                </span>
              </Button>
            );
          })}
          <Button
            long
            className='!h-auto !justify-start !whitespace-normal !py-10px !text-left'
            data-template='blank'
            onClick={() => startFrom(null)}
          >
            <span className='flex items-start gap-10px'>
              <span className='text-20px leading-none'>➕</span>
              <span className='flex min-w-0 flex-col'>
                <span className='text-13px font-500'>{t('common.scenes.blank')}</span>
                <span className='mt-2px text-12px font-400 text-t-tertiary'>{t('common.scenes.blankHint')}</span>
              </span>
            </span>
          </Button>
        </div>
      </Modal>

      <SceneEditor
        visible={editor !== null}
        mode={editor?.mode ?? 'new'}
        scene={editor?.scene ?? null}
        onCancel={() => setEditor(null)}
        onSave={handleSave}
      />
    </div>
  );
};

export default ScenesTab;
