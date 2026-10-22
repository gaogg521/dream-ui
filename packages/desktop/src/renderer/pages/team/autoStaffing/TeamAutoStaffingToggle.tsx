/**
 * Copyright 2026 One Work
 */

import React from 'react';
import { Switch, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useTeamAutoStaffing } from './useTeamAutoStaffing';

type Props = {
  team_id: string;
};

/**
 * 「自动组队」开关 —— 放在标题行右侧。默认关：Leader 加人前先给阵容等用户确认；
 * 开：Leader 判断需要加人时直接拉人，回复里说明加了谁、为什么。
 */
const TeamAutoStaffingToggle: React.FC<Props> = ({ team_id }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useTeamAutoStaffing(team_id);
  const label = t('team.autoStaffing.label', { defaultValue: 'Auto-staff' });

  return (
    <Tooltip
      content={
        enabled
          ? t('team.autoStaffing.tooltipOn', {
              defaultValue: 'On: the Leader adds teammates directly when needed and tells you who it added and why.',
            })
          : t('team.autoStaffing.tooltipOff', {
              defaultValue:
                'Off: the Leader proposes a lineup and waits for your confirmation before adding teammates.',
            })
      }
    >
      <div className='flex items-center gap-6px' data-testid='team-auto-staffing'>
        <span className='text-12px text-[color:var(--color-text-3)] whitespace-nowrap select-none'>{label}</span>
        <Switch
          size='small'
          checked={enabled}
          onChange={setEnabled}
          aria-label={label}
          data-testid='team-auto-staffing-switch'
        />
      </div>
    </Tooltip>
  );
};

export default TeamAutoStaffingToggle;
