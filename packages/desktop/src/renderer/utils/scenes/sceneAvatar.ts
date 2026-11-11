/**
 * Copyright 2026 One Work
 */

/** The picture for a scene: the one the admin set, else the built-in one for its name, else the office one. */

import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import officeAvatar from '@/renderer/assets/scenes/office.png';
import itOpsAvatar from '@/renderer/assets/scenes/it-ops.png';
import securityAvatar from '@/renderer/assets/scenes/cybersecurity.png';
import mediaAvatar from '@/renderer/assets/scenes/media-ops.png';
import marketingAvatar from '@/renderer/assets/scenes/marketing.png';
import lifePortrait from '@/renderer/assets/scenes/portraits/general/life.png';
import webPortrait from '@/renderer/assets/scenes/portraits/general/web.png';
import dataPortrait from '@/renderer/assets/scenes/portraits/work/data.png';
import writingPortrait from '@/renderer/assets/scenes/portraits/work/writing.png';
import notesPortrait from '@/renderer/assets/scenes/portraits/general/notes.png';
import officePortrait from '@/renderer/assets/scenes/portraits/work/office.png';
import toolsPortrait from '@/renderer/assets/scenes/portraits/general/tools.png';
import designPortrait from '@/renderer/assets/scenes/portraits/work/design.png';
import marketingPortrait from '@/renderer/assets/scenes/portraits/work/marketing.png';
import legalPortrait from '@/renderer/assets/scenes/portraits/work/legal.png';
import researchPortrait from '@/renderer/assets/scenes/portraits/general/research.png';
import aiPortrait from '@/renderer/assets/scenes/portraits/general/ai.png';
import blackSatinPortrait from '@/renderer/assets/scenes/portraits/modern/black-satin.png';
import emeraldPortrait from '@/renderer/assets/scenes/portraits/modern/emerald.png';
import silverPortrait from '@/renderer/assets/scenes/portraits/modern/silver.png';
import ivoryPortrait from '@/renderer/assets/scenes/portraits/modern/ivory.png';
import burgundyPortrait from '@/renderer/assets/scenes/portraits/modern/burgundy.png';
import navyPortrait from '@/renderer/assets/scenes/portraits/modern/navy.png';
import hanPortrait from '@/renderer/assets/scenes/portraits/costume/han.png';
import tangPortrait from '@/renderer/assets/scenes/portraits/costume/tang.png';
import songPortrait from '@/renderer/assets/scenes/portraits/costume/song.png';
import mingPortrait from '@/renderer/assets/scenes/portraits/costume/ming.png';

const ADDITIONAL_PORTRAITS = [
  ['av-m01', blackSatinPortrait],
  ['av-m02', emeraldPortrait],
  ['av-m03', silverPortrait],
  ['av-m04', ivoryPortrait],
  ['av-m05', burgundyPortrait],
  ['av-m06', navyPortrait],
  ['av-han', hanPortrait],
  ['av-tang', tangPortrait],
  ['av-song', songPortrait],
  ['av-ming', mingPortrait],
] as const;

/** Additional built-in avatars, in picker order. */
export const ADDITIONAL_SCENE_ICONS = ADDITIONAL_PORTRAITS.map(([id]) => id);

const PERSONAL_PORTRAITS = new Map([
  ['🧭', lifePortrait],
  ['🌐', webPortrait],
  ['📊', dataPortrait],
  ['✍', writingPortrait],
  ['🗒', notesPortrait],
  ['💼', officePortrait],
  ['🛠', toolsPortrait],
  ['🎨', designPortrait],
  ['📣', marketingPortrait],
  ['⚖', legalPortrait],
  ['🧪', researchPortrait],
  ['🤖', aiPortrait],
  ...ADDITIONAL_PORTRAITS,
]);

/** Resolve a preset portrait using the stored icon, including legacy emoji presentation variants. */
export const personalSceneAvatarSrc = (icon: string): string | undefined =>
  PERSONAL_PORTRAITS.get(icon.replace(/[\uFE0E\uFE0F]/g, ''));

const BUILTIN_AVATARS: Record<string, string> = {
  办公: officeAvatar,
  IT运维: itOpsAvatar,
  网络安全: securityAvatar,
  新媒体运营: mediaAvatar,
  市场营销: marketingAvatar,
};

export const sceneAvatarSrc = (scene: Pick<MyScene, 'name' | 'avatarRef'>): string =>
  scene.avatarRef || BUILTIN_AVATARS[scene.name] || officeAvatar;
