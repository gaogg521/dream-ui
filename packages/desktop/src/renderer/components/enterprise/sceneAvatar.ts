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

const BUILTIN_AVATARS: Record<string, string> = {
  办公: officeAvatar,
  IT运维: itOpsAvatar,
  网络安全: securityAvatar,
  新媒体运营: mediaAvatar,
  市场营销: marketingAvatar,
};

export const sceneAvatarSrc = (scene: Pick<MyScene, 'name' | 'avatarRef'>): string =>
  scene.avatarRef || BUILTIN_AVATARS[scene.name] || officeAvatar;
