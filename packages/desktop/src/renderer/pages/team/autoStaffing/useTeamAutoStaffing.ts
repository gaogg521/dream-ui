/**
 * Copyright 2026 One Work
 */

import { useCallback, useSyncExternalStore } from 'react';

/**
 * 自动组队 —— 团队级开关，按团队记在本机（localStorage），默认关闭。
 *
 * 关闭时 Leader 需要加人会先发阵容表、等用户确认（产品默认行为）；开启后，发给 Leader 的
 * 每条消息都附一条 `[SYSTEM NOTE: …]`，表示用户已预先认可阵容，Leader 可直接拉人。
 * 系统备注由后端投影到界面时剥掉（`strip_system_notes`），用户看不到；放在前端拼接是为了
 * 让已发布的旧版 dreamcore 也认得——Leader 提示词早就约定了「SYSTEM NOTE 表示已确认阵容」。
 *
 * 头部开关和发送逻辑在不同组件里，用同一个 external store 共享，切换即时生效。
 */
const storageKey = (team_id: string): string => `team-auto-staffing-${team_id}`;

const listeners = new Set<() => void>();

export const readTeamAutoStaffing = (team_id: string): boolean => {
  try {
    return localStorage.getItem(storageKey(team_id)) === '1';
  } catch {
    return false;
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setTeamAutoStaffing(team_id: string, enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(storageKey(team_id), '1');
    else localStorage.removeItem(storageKey(team_id));
  } catch {
    // storage unavailable — nothing to persist
  }
  for (const listener of listeners) listener();
}

export function useTeamAutoStaffing(team_id: string): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    () => readTeamAutoStaffing(team_id),
    () => false
  );
  const setEnabled = useCallback((next: boolean) => setTeamAutoStaffing(team_id, next), [team_id]);
  return [enabled, setEnabled];
}
