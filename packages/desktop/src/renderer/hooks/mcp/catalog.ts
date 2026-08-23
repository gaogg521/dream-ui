import { mcpService } from '@/common/adapter/ipcBridge';
import {
  BUILTIN_IMAGE_GEN_LEGACY_NAMES,
  BUILTIN_IMAGE_GEN_NAME,
  type IMcpServer,
  type IMcpServerTransport,
  type ISessionMcpServer,
} from '@/common/config/storage';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';

type BackendMcpTransport = Exclude<IMcpServerTransport, { type: 'streamable_http' }>;

type BackendMcpPayload = {
  name: string;
  description?: string;
  transport: BackendMcpTransport;
  original_json: string;
  builtin?: boolean;
};

const isBuiltinServer = (server: IMcpServer) => server.builtin === true;

const normalizeServerName = (name: string) => name.trim().toLowerCase();

const getCatalogServerKey = (server: Pick<IMcpServer, 'id' | 'name' | 'builtin'>) => {
  const normalizedName = normalizeServerName(server.name);
  if (server.builtin === true) {
    return `builtin:${normalizedName || server.id}`;
  }
  return `user:${normalizedName || server.id}`;
};

const dedupeServers = (servers: IMcpServer[]) => {
  const seen = new Set<string>();
  const deduped: IMcpServer[] = [];

  for (const server of servers) {
    const key = getCatalogServerKey(server);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(server);
  }

  return deduped;
};

const normalizeTransportForBackend = (transport: IMcpServerTransport): BackendMcpTransport => {
  if (transport.type === 'streamable_http') {
    return {
      type: 'http',
      url: transport.url,
      headers: transport.headers,
    };
  }
  return transport;
};

export const toBackendMcpPayload = (
  server: Pick<IMcpServer, 'name' | 'description' | 'transport' | 'original_json' | 'builtin'>
): BackendMcpPayload => ({
  name: server.name,
  description: server.description,
  transport: normalizeTransportForBackend(server.transport),
  original_json: server.original_json || '{}',
  builtin: Boolean(server.builtin),
});

export const toSessionMcpServer = (server: Pick<IMcpServer, 'id' | 'name' | 'transport'>): ISessionMcpServer => ({
  id: server.id,
  name: server.name,
  transport: server.transport,
});

const isBuiltinMediaMcp = (server: Pick<IMcpServer, 'name'>): boolean =>
  server.name === BUILTIN_IMAGE_GEN_NAME || (BUILTIN_IMAGE_GEN_LEGACY_NAMES as readonly string[]).includes(server.name);

/**
 * Add the built-in media MCP to a session's server snapshot when it is enabled.
 *
 * Both agent factories drop built-in servers on sight — `if !selected ||
 * row.builtin { continue; }` — so a built-in tool only ever reaches an agent by
 * riding in this snapshot, which in turn required the user to tick it per
 * assistant. Nobody does: every conversation in a real install carries
 * `mcp_server_ids: null`. The result was that configuring a video model lit the
 * server up in settings and still left every agent unable to generate video.
 *
 * So this one rides on its own `enabled` state instead, which already tracks
 * whether the user has a media model. Ticking it explicitly still works — the
 * de-dup below keeps that from producing two entries.
 *
 * Deliberately only this server: enabling every built-in by default would hand
 * each agent the PDF exporter and the team knowledge base as well, which is a
 * far larger decision than "the user configured a media model".
 */
export const withBuiltinMediaMcp = (
  snapshot: ISessionMcpServer[],
  available: IMcpServer[] | undefined
): ISessionMcpServer[] => {
  const media = (available || []).find((server) => isBuiltinMediaMcp(server) && server.enabled !== false);
  if (!media || snapshot.some((entry) => entry.id === media.id)) return snapshot;
  return [...snapshot, toSessionMcpServer(media)];
};

export const ensureBackendMcpCatalog = async (): Promise<{
  userServers: IMcpServer[];
  builtinServers: IMcpServer[];
  allServers: IMcpServer[];
}> => {
  const localServers = ((await getClientBusinessSetting('mcp.config').catch((): IMcpServer[] => [])) ||
    []) as IMcpServer[];
  const builtinServers = dedupeServers(localServers.filter(isBuiltinServer));
  const userServers = dedupeServers(await mcpService.listServers.invoke());

  const allServers = dedupeServers([...userServers, ...builtinServers]);

  return {
    userServers,
    builtinServers,
    allServers,
  };
};
