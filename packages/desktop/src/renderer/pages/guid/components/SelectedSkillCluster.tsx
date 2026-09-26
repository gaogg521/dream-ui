/**
 * Copyright 2026 One Work
 */

import { iconColors } from '@/renderer/styles/colors';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { Close, Lightning } from '@icon-park/react';
import { Button, Popover } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SelectedSkillCluster.module.css';

export type SelectedGuidSkill = {
  name: string;
  description: string;
  isAuto: boolean;
  display_name?: string;
  icon_file?: string;
};

const skillLabel = (skill: SelectedGuidSkill): string => skill.display_name || skill.name;

const SkillGlyph: React.FC<{ skill: SelectedGuidSkill; letterClassName?: string }> = ({ skill, letterClassName }) => {
  if (skill.icon_file) {
    return (
      <img
        src={resolveExtensionAssetUrl(`/api/skills/${encodeURIComponent(skill.name)}/icon`)}
        alt=''
        draggable={false}
      />
    );
  }
  return <span className={letterClassName}>{skillLabel(skill).charAt(0).toUpperCase()}</span>;
};

const SelectedSkillChip: React.FC<{
  skill: SelectedGuidSkill;
  onRemove: (skill: SelectedGuidSkill) => void;
}> = ({ skill, onRemove }) => (
  <span
    className='inline-flex max-w-140px shrink-0 items-center gap-4px rounded-999px py-2px pl-4px pr-6px'
    style={{ background: 'var(--color-fill-2)' }}
    data-testid={`guid-selected-skill-chip-${skill.name}`}
    title={skill.display_name ? `${skill.display_name} (${skill.name})` : skill.name}
  >
    {skill.icon_file ? (
      <img
        src={resolveExtensionAssetUrl(`/api/skills/${encodeURIComponent(skill.name)}/icon`)}
        alt=''
        className='h-16px w-16px rounded-999px object-cover'
      />
    ) : (
      <Lightning theme='filled' size='12' fill={iconColors.primary} style={{ lineHeight: 0 }} />
    )}
    <span className='max-w-100px truncate text-12px text-t-primary'>{skillLabel(skill)}</span>
    <span
      className='inline-flex h-14px w-14px shrink-0 cursor-pointer items-center justify-center rounded-999px hover:bg-fill-3'
      data-testid={`guid-remove-skill-${skill.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onRemove(skill);
      }}
    >
      <Close theme='outline' size={10} fill={iconColors.secondary} />
    </span>
  </span>
);

const SelectedSkillCluster: React.FC<{
  skills: SelectedGuidSkill[];
  onRemove: (skill: SelectedGuidSkill) => void;
}> = ({ skills, onRemove }) => {
  const { t } = useTranslation();

  if (skills.length === 0) return null;

  if (skills.length === 1) {
    return <SelectedSkillChip skill={skills[0]} onRemove={onRemove} />;
  }

  const names = skills.map(skillLabel).join('、');

  const list = (
    <div className={styles.list} data-testid='guid-selected-skill-list'>
      {skills.map((skill) => (
        <div
          key={skill.name}
          className={styles.row}
          data-testid={`guid-selected-skill-chip-${skill.name}`}
          title={skill.display_name ? `${skill.display_name} (${skill.name})` : skill.name}
        >
          <span className={styles.rowIcon}>
            <SkillGlyph skill={skill} letterClassName={styles.letter} />
          </span>
          <span className={styles.rowName}>{skillLabel(skill)}</span>
          <Button
            type='text'
            className={styles.remove}
            data-testid={`guid-remove-skill-${skill.name}`}
            aria-label={t('common.remove', { defaultValue: 'Remove' })}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(skill);
            }}
          >
            <Close theme='outline' size={10} fill={iconColors.secondary} />
          </Button>
        </div>
      ))}
    </div>
  );

  return (
    <Popover trigger='click' position='top' content={list}>
      <Button
        type='text'
        className={styles.cluster}
        data-testid='guid-selected-skill-cluster'
        title={names}
        aria-label={`${t('common.selectedSkills', { defaultValue: 'Selected skills' })} · ${skills.length}`}
      >
        <span className={styles.icon} aria-hidden='true' data-testid='guid-selected-skill-summary-icon'>
          <SkillGlyph skill={skills[0]} letterClassName={styles.letter} />
        </span>
        <span className={styles.label}>
          {t('common.selectedSkills', { defaultValue: 'Selected skills' })} · {skills.length}
        </span>
      </Button>
    </Popover>
  );
};

export default SelectedSkillCluster;
