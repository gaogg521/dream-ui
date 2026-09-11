/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useEffect, useState } from 'react';

/**
 * How many skills the Skills Marketplace tab will show, for its tab badge.
 *
 * Read here rather than lifted out of `SkillsHubSettings`: that pane owns its
 * own fetch and only mounts once its tab is selected, so a count reported
 * upward from it would be absent exactly when the label needs it — before the
 * user has ever opened the tab.
 *
 * The filter matches the pane's own `mySkills`: extension- and cron-generated
 * skills are machinery rather than library entries, and auto-injected built-ins
 * are always on and never listed. A count that disagreed with the list under
 * it would read as a bug in the list.
 */
export function useSkillCount(): number | undefined {
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void ipcBridge.fs.listAvailableSkills
      .invoke()
      .then((skills) => {
        if (cancelled) return;
        const visible = (skills ?? []).filter(
          (s) => s.source !== 'extension' && s.source !== 'cron' && !(s.source === 'builtin' && s.is_auto_inject)
        );
        setCount(visible.length);
      })
      .catch(() => {
        // A failed count is not worth surfacing: the tab simply renders
        // without a badge, exactly as it did before this existed.
        if (!cancelled) setCount(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return count;
}
