import { codexBridge, type ICodexBridgeConfig } from '@/common/adapter/ipcBridge';
import useSWR, { type SWRConfiguration } from 'swr';

export const CODEX_BRIDGE_STATUS_SWR_KEY = 'codex-bridge-status';

// Bridge config is a Settings-page toggle, not something that changes mid
// conversation — no need to revalidate on focus/reconnect.
const CODEX_BRIDGE_STATUS_SWR_OPTIONS: SWRConfiguration<ICodexBridgeConfig, Error> = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
};

const fetchCodexBridgeConfig = (): Promise<ICodexBridgeConfig> => codexBridge.getConfig.invoke();

const useCodexBridgeConfig = () => {
  const { data } = useSWR(CODEX_BRIDGE_STATUS_SWR_KEY, fetchCodexBridgeConfig, CODEX_BRIDGE_STATUS_SWR_OPTIONS);
  return data;
};

/**
 * Whether the Codex compatibility bridge (Settings → Codex 桥接) is
 * currently enabled. Codex's own per-conversation model selector must not
 * let the user switch models when this is on: the bridge fixes the model at
 * Codex launch time via a config override, and the ACP `session/set_model`
 * call the selector would otherwise send is a live runtime RPC that could
 * silently move the session off the bridge's provider.
 */
export const useCodexBridgeEnabled = (): boolean => useCodexBridgeConfig()?.enabled ?? false;

/**
 * The model the Codex bridge is configured to use, when enabled. Prefer this
 * over the ACP session's own advertised model name for display purposes when
 * the bridge is locked — the session's advertised name is a snapshot from
 * subprocess spawn time and does not update when the bridge config is saved
 * again for an already-running session, so it can show a stale model even
 * though the bridge is actually routing every new request through the
 * currently saved one.
 */
export const useCodexBridgeModel = (): string | null => useCodexBridgeConfig()?.model ?? null;
