import React from 'react';
import { Robot } from '@icon-park/react';
import { resolveAssistantAvatar } from '@renderer/utils/model/assistantAvatar';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import { resolveAssistantName } from '@renderer/utils/model/assistantDisplay';
import { assistantRuntimeKey, type Assistant, type MarketplacePersona } from '@/common/types/agent/assistantTypes';

/** Team leader selector entry derived from the unified assistant catalog. */
export type TeamAssistantOption = {
  id: string;
  name: string;
  /** Execution backend (claude, gemini, qwen, …). */
  backend?: string;
  /** Avatar token — a backend-resolved URL or an emoji. */
  icon?: string;
  /** Whether this assistant can currently be used in team mode. */
  team_selectable?: boolean;
  /** Why this assistant cannot currently be used in team mode. */
  team_block_reason?: string;
  /** False for a marketplace-only match the user hasn't installed yet — clicking it
   * should install-then-select rather than select directly. */
  installed?: boolean;
};

export function assistantToOption(assistant: Assistant, localeKey = 'en-US'): TeamAssistantOption {
  return {
    id: assistant.id,
    name: resolveAssistantName(assistant, localeKey, assistant.name),
    backend: assistantRuntimeKey(assistant),
    icon: assistant.avatar,
    team_selectable: assistant.team_selectable,
    team_block_reason: assistant.team_block_reason,
    installed: true,
  };
}

/** Not-yet-installed marketplace match — only surfaced once the user searches
 * (see `mergeWithMarketplaceMatches`), since the picker's default view is just
 * the already-installed catalog. */
export function marketplacePersonaToOption(persona: MarketplacePersona): TeamAssistantOption {
  return {
    id: persona.id,
    name: persona.display_name || persona.name,
    icon: persona.avatar,
    installed: false,
  };
}

/** Merge already-installed matches with marketplace-only matches (by name/description),
 * so searching for e.g. "安全" also surfaces experts the user hasn't added yet. Installed
 * entries always take precedence over a same-id marketplace entry. */
export function mergeWithMarketplaceMatches(
  installedMatches: TeamAssistantOption[],
  marketplacePersonas: MarketplacePersona[],
  query: string
): TeamAssistantOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return installedMatches;
  const byId = new Map(installedMatches.map((option) => [option.id, option]));
  for (const persona of marketplacePersonas) {
    if (byId.has(persona.id)) continue;
    const label = (persona.display_name || persona.name).toLowerCase();
    const description = persona.description?.toLowerCase() ?? '';
    if (label.includes(q) || description.includes(q)) {
      byId.set(persona.id, marketplacePersonaToOption(persona));
    }
  }
  return [...byId.values()];
}

export function assistantKey(assistant: TeamAssistantOption): string {
  return assistant.id;
}

export function assistantFromId(
  assistantId: string,
  allAssistants: TeamAssistantOption[]
): TeamAssistantOption | undefined {
  return allAssistants.find((assistant) => assistantKey(assistant) === assistantId);
}

/** Filter assistants to only those supported in team mode. */
export function filterTeamSupportedAssistants(assistants: TeamAssistantOption[]): TeamAssistantOption[] {
  return assistants;
}

type AssistantOptionLabelProps = {
  assistant: TeamAssistantOption;
  size?: 'compact' | 'large';
  muted?: boolean;
};

export const AssistantOptionLabel: React.FC<AssistantOptionLabelProps> = ({
  assistant,
  size = 'compact',
  muted = false,
}) => {
  const avatar = resolveAssistantAvatar(assistant.icon);
  const isLarge = size === 'large';
  const iconSize = isLarge ? 18 : 16;
  const avatarToneClass = muted ? 'bg-fill-1 text-t-tertiary opacity-75' : 'bg-fill-2 text-t-primary';
  const avatarClass = isLarge
    ? `flex h-30px w-30px shrink-0 items-center justify-center rounded-8px ${avatarToneClass}`
    : `flex h-32px w-32px shrink-0 items-center justify-center rounded-8px ${avatarToneClass}`;
  const nameClass = muted ? 'text-t-tertiary' : 'text-t-primary';
  const avatarNode =
    avatar.kind === 'image' ? (
      <ThemedLogo
        src={avatar.value}
        alt={assistant.name}
        style={{ width: iconSize, height: iconSize, objectFit: 'contain' }}
      />
    ) : avatar.kind === 'emoji' ? (
      <span style={{ fontSize: isLarge ? 18 : 14, lineHeight: `${iconSize}px` }}>{avatar.value}</span>
    ) : (
      <Robot size={String(iconSize)} />
    );

  return (
    <div className={isLarge ? 'flex min-w-0 items-center gap-12px' : 'flex min-w-0 items-center gap-8px'}>
      <span className={avatarClass} data-testid='assistant-avatar'>
        {avatarNode}
      </span>
      <span
        data-testid='assistant-option-name'
        className={
          isLarge ? `min-w-0 truncate text-14px font-500 leading-21px ${nameClass}` : `min-w-0 truncate ${nameClass}`
        }
      >
        {assistant.name}
      </span>
    </div>
  );
};
