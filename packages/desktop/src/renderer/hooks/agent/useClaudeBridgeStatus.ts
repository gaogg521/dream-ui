import { claudeBridge, type IClaudeBridgeConfig } from '@/common/adapter/ipcBridge';
import useSWR, { type SWRConfiguration } from 'swr';

export const CLAUDE_BRIDGE_STATUS_SWR_KEY = 'claude-bridge-status';

// Bridge config is a Settings-page toggle, not something that changes mid
// conversation — no need to revalidate on focus/reconnect.
const CLAUDE_BRIDGE_STATUS_SWR_OPTIONS: SWRConfiguration<IClaudeBridgeConfig, Error> = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
};

const fetchClaudeBridgeConfig = (): Promise<IClaudeBridgeConfig> => claudeBridge.getConfig.invoke();

const useClaudeBridgeConfig = () => {
  const { data } = useSWR(CLAUDE_BRIDGE_STATUS_SWR_KEY, fetchClaudeBridgeConfig, CLAUDE_BRIDGE_STATUS_SWR_OPTIONS);
  return data;
};

/**
 * Whether the Claude Code custom-provider bridge (Settings → Claude 桥接) is
 * currently enabled. Claude's own per-conversation model selector must not
 * let the user switch models when this is on: the bridge fixes the model at
 * launch time via env vars, and the ACP `session/set_model` call the
 * selector would otherwise send is a live runtime RPC that could silently
 * move the session off the bridge's provider.
 */
export const useClaudeBridgeEnabled = (): boolean => useClaudeBridgeConfig()?.enabled ?? false;

/**
 * The model the Claude bridge is configured to use, when enabled. Prefer this
 * over the ACP session's own advertised model name for display purposes when
 * the bridge is locked — the session's advertised name is a snapshot from
 * subprocess spawn time and does not update when the bridge config is saved
 * again for an already-running session, so it can show a stale model even
 * though the bridge is actually routing every new request through the
 * currently saved one.
 */
export const useClaudeBridgeModel = (): string | null => useClaudeBridgeConfig()?.model ?? null;
