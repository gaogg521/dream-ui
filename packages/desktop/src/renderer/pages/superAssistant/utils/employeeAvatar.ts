import officeAvatar from '@/renderer/assets/scenes/office.png';
import itOpsAvatar from '@/renderer/assets/scenes/it-ops.png';
import securityAvatar from '@/renderer/assets/scenes/cybersecurity.png';
import mediaAvatar from '@/renderer/assets/scenes/media-ops.png';
import marketingAvatar from '@/renderer/assets/scenes/marketing.png';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';

const FALLBACKS = [officeAvatar, itOpsAvatar, securityAvatar, mediaAvatar, marketingAvatar];

export function resolveEmployeeAvatar(agent: Pick<PersonalAgent, 'id' | 'automationConfig'>): string {
  const custom = agent.automationConfig?.avatarUrl;
  if (typeof custom === 'string' && custom) return custom;
  let hash = 0;
  for (const char of agent.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACKS[hash % FALLBACKS.length];
}
