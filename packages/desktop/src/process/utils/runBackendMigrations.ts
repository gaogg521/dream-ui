/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { migrateConfigStorage, migrateLegacyMcpConfigToDb, migrateProviders } from '@/common/config/configMigration';
import { httpRequest } from '@/common/adapter/httpBridge';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import { BUILTIN_BROWSER_MCP_NAME } from '@/common/config/constants';
import {
  removeImageGenerationEnvKeys,
  resolveImageGenerationMcpEnv,
  type ImageGenerationMcpEnvResolveResult,
} from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type IProvider } from '@/common/config/storage';
import { hasDeclaredMediaModel } from '@/common/media/declaredModel';
import { BUILTIN_EXPORT_PDF_NAME, BUILTIN_TEAM_KNOWLEDGE_NAME } from '@process/resources/builtinMcp/constants';
import { startExportPdfMcpServer } from '@process/services/exportPdfMcpServer';
import { startTeamKnowledgeMcpServer } from '@process/services/teamKnowledgeMcpServer';
import { startMediaMcpServer } from '@process/services/mediaJob';
import { getBuiltinMcpScriptPath, type ProcessConfig as ProcessConfigType } from './initStorage';
import { migrateAssistantsToBackend } from './migrateAssistants';
import { migrateOneCustomAgents } from '@process/services/oneMigration/importOneCustomAgents';

type ConfigFile = typeof ProcessConfigType;
type MigrationStepResult = boolean;
type McpImportServer = Partial<IMcpServer> & Pick<IMcpServer, 'name' | 'transport'>;
type BackendClientPreferences = Record<string, unknown>;
const BUILTIN_CHROME_DEVTOOLS_NAME = 'chrome-devtools';
const BUILTIN_FTSHARE_NAME = 'ftshare';
const BUILTIN_STOCK_SDK_NAME = 'stock-sdk';

/**
 * 内置「应用内浏览器」MCP。
 *
 * 与 chrome-devtools 的区别：那个默认关闭，开启后会由 MCP 自己开一个独立 Chrome
 * 窗口 —— 用户在 APP 里看不见。这个默认开启，且强制连到 APP 自己的 CDP 端口，
 * Agent 的每一步操作都发生在用户能看到的侧边预览面板里。
 *
 * The built-in in-app browser MCP. Unlike `chrome-devtools` (default-disabled and
 * spawning its own separate Chrome window the user cannot see), this one is
 * enabled by default and pinned to the app's own CDP port, so every agent action
 * happens in the side preview panel where the user can watch it.
 */
const BUILTIN_BROWSER_SCRIPT = 'builtin-mcp-browser';

const LEGACY_BACKEND_CLIENT_PREFERENCE_KEYS = [
  'assistants',
  'migration.assistantEnabledFixed',
  'migration.coworkDefaultSkillsAdded',
  'migration.builtinDefaultSkillsAdded_v2',
  'migration.promptsI18nAdded',
  'migration.assistantsSplitCustom',
] as const;

async function cleanupLegacyClientPreferences(): Promise<void> {
  const payloadEntries = LEGACY_BACKEND_CLIENT_PREFERENCE_KEYS.map((key): [string, null] => [key, null]);
  const payload = Object.fromEntries(payloadEntries);
  await httpRequest<void>('PUT', '/api/settings/client', payload);
}

const CLEANUP_STEPS: Array<{
  name: string;
  run: () => Promise<void>;
}> = [{ name: 'cleanupLegacyClientPreferences', run: async () => cleanupLegacyClientPreferences() }];

async function fetchBackendClientPreferences(): Promise<BackendClientPreferences> {
  try {
    return (await httpRequest<BackendClientPreferences>('GET', '/api/settings/client')) || {};
  } catch {
    return {};
  }
}

async function fetchProviders(): Promise<IProvider[]> {
  try {
    return (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];
  } catch (error) {
    console.warn('[Migration] MCP bootstrap could not load providers for image generation env resolution', error);
    return [];
  }
}

export function resolveImageGenerationMigrationConfig(
  backendPrefs: BackendClientPreferences,
  fileConfig?: ImageGenerationModelSetting
): ImageGenerationModelSetting | undefined {
  const backendConfig = backendPrefs['tools.imageGenerationModel'];
  if (backendConfig && typeof backendConfig === 'object') {
    return backendConfig as ImageGenerationModelSetting;
  }
  return fileConfig;
}

function resolveImageGenerationMigrationConfigSource(
  backendPrefs: BackendClientPreferences,
  fileConfig?: ImageGenerationModelSetting
): 'backend' | 'file' | 'none' {
  const backendConfig = backendPrefs['tools.imageGenerationModel'];
  if (backendConfig && typeof backendConfig === 'object') {
    return 'backend';
  }
  return fileConfig ? 'file' : 'none';
}

function logImageGenerationEnvResolution(
  result: ImageGenerationMcpEnvResolveResult,
  context: 'bootstrap' | 'update'
): void {
  if (result.ok === true) {
    console.info(
      '[Migration] image MCP env resolved via %s during %s, provider id: %s, platform: %s, model: %s, api key present: %s',
      result.source,
      context,
      result.provider.id,
      result.provider.platform,
      result.model,
      result.provider.api_key ? 'yes' : 'no'
    );
    return;
  }

  console.warn(
    '[Migration] image MCP env resolution failed during %s, reason: %s, message: %s, candidates: %s',
    context,
    result.reason,
    result.message,
    result.candidates?.join(',') || 'none'
  );
}

/**
 * Env for the built-in media MCP server, shared by the create and update paths
 * so the two cannot drift apart.
 *
 * `MEDIA_MCP_PORT` is always taken from the port allocated by THIS app start:
 * the media service picks the first free port each launch, so carrying the
 * stored value forward would leave the shell dialling a port nobody is on.
 * Unrelated keys already present on the row are preserved.
 */
function buildImageServerEnv(
  resolvedEnv: Record<string, string>,
  existingEnv: Record<string, string> | undefined,
  mediaPort?: number
): Record<string, string> {
  return {
    ...removeImageGenerationEnvKeys(existingEnv || {}),
    ...resolvedEnv,
    ...(mediaPort ? { MEDIA_MCP_PORT: String(mediaPort) } : {}),
  };
}

function buildBuiltinImageGenerationServer(
  resolution: ImageGenerationMcpEnvResolveResult,
  config: ImageGenerationModelSetting | undefined,
  mediaPort: number | undefined,
  providers: IProvider[]
): McpImportServer {
  const scriptPath = getBuiltinMcpScriptPath('builtin-mcp-image-gen');
  const env = buildImageServerEnv(resolution.ok ? resolution.env : {}, undefined, mediaPort);
  const serverConfig = {
    command: 'node',
    args: [scriptPath],
    env,
  };

  return {
    name: BUILTIN_IMAGE_GEN_NAME,
    description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
    // Either route counts as "the user configured media generation": the
    // legacy Settings > Tools switch (kept so existing setups do not change
    // behaviour on upgrade) or a model declared as image/video.
    enabled: (config?.switch === true && resolution.ok) || hasDeclaredMediaModel(providers),
    builtin: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: [scriptPath],
      env,
    },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_IMAGE_GEN_NAME]: serverConfig } }, null, 2),
  };
}

function buildBuiltinExportPdfServer(port: number): McpImportServer {
  const scriptPath = getBuiltinMcpScriptPath('builtin-mcp-export-pdf');
  const env = { EXPORT_PDF_MCP_PORT: String(port) };
  const serverConfig = {
    command: 'node',
    args: [scriptPath],
    env,
  };

  return {
    name: BUILTIN_EXPORT_PDF_NAME,
    description: 'Built-in PDF export tool. Converts HTML or Office files (.docx/.xlsx/.pptx) to PDF.',
    enabled: true,
    builtin: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: [scriptPath],
      env,
    },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_EXPORT_PDF_NAME]: serverConfig } }, null, 2),
  };
}

/**
 * The team knowledge-base search tool (P0-3).
 *
 * Enabled by default, unlike the browser/stock default servers: the whole point
 * is that an agent should know the company has a knowledge base without anyone
 * having to turn a switch on first. It is inert when no knowledge base exists —
 * retrieval simply returns nothing.
 */
function buildBuiltinTeamKnowledgeServer(port: number): McpImportServer {
  const scriptPath = getBuiltinMcpScriptPath('builtin-mcp-team-knowledge');
  const env = { TEAM_KNOWLEDGE_MCP_PORT: String(port) };
  const serverConfig = {
    command: 'node',
    args: [scriptPath],
    env,
  };

  return {
    name: BUILTIN_TEAM_KNOWLEDGE_NAME,
    description: 'Built-in team knowledge base search. Retrieves internal documents the current user may see.',
    enabled: true,
    builtin: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: [scriptPath],
      env,
    },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_TEAM_KNOWLEDGE_NAME]: serverConfig } }, null, 2),
  };
}

function areStringArraysEqual(left?: string[], right?: string[]): boolean {
  const leftValue = left || [];
  const rightValue = right || [];
  return leftValue.length === rightValue.length && leftValue.every((item, index) => item === rightValue[index]);
}

function areStringRecordsEqual(left?: Record<string, string>, right?: Record<string, string>): boolean {
  const leftValue = left || {};
  const rightValue = right || {};
  const leftKeys = Object.keys(leftValue).toSorted();
  const rightKeys = Object.keys(rightValue).toSorted();
  return areStringArraysEqual(leftKeys, rightKeys) && leftKeys.every((key) => leftValue[key] === rightValue[key]);
}

function isSameStdioTransport(left: IMcpServer['transport'], right: IMcpServer['transport']): boolean {
  return (
    left.type === 'stdio' &&
    right.type === 'stdio' &&
    left.command === right.command &&
    areStringArraysEqual(left.args, right.args) &&
    areStringRecordsEqual(left.env, right.env)
  );
}

function buildBuiltinBrowserServer(): McpImportServer {
  const scriptPath = getBuiltinMcpScriptPath(BUILTIN_BROWSER_SCRIPT);
  const serverConfig = {
    command: 'node',
    args: [scriptPath],
  };

  return {
    name: BUILTIN_BROWSER_MCP_NAME,
    description:
      "Control One Work's built-in browser (the side preview panel): open pages, click, type and read content. " +
      'Sign-in state is shared across tabs and preserved between sessions.',
    // 默认开启：用户装好即可用，无需任何配置
    // Enabled by default: works out of the box with zero configuration.
    enabled: true,
    builtin: true,
    transport: {
      type: 'stdio',
      command: serverConfig.command,
      args: serverConfig.args,
    },
    original_json: JSON.stringify({ mcpServers: { [BUILTIN_BROWSER_MCP_NAME]: serverConfig } }, null, 2),
  };
}

function buildDefaultMcpServers(): McpImportServer[] {
  const chromeConfig = {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
  };
  const stockSdkConfig = {
    command: 'npx',
    args: ['-y', 'stock-sdk-mcp'],
  };
  const ftshareConfig = {
    url: 'https://market.ft.tech/gateway/mcp',
  };

  return [
    {
      name: BUILTIN_CHROME_DEVTOOLS_NAME,
      description: 'Default MCP server: chrome-devtools',
      enabled: false,
      builtin: true,
      transport: {
        type: 'stdio',
        command: chromeConfig.command,
        args: chromeConfig.args,
      },
      original_json: JSON.stringify({ mcpServers: { [BUILTIN_CHROME_DEVTOOLS_NAME]: chromeConfig } }, null, 2),
    },
    {
      name: BUILTIN_STOCK_SDK_NAME,
      description: 'Default MCP server: stock-sdk',
      enabled: false,
      builtin: true,
      transport: {
        type: 'stdio',
        command: stockSdkConfig.command,
        args: stockSdkConfig.args,
      },
      original_json: JSON.stringify({ mcpServers: { [BUILTIN_STOCK_SDK_NAME]: stockSdkConfig } }, null, 2),
    },
    {
      name: BUILTIN_FTSHARE_NAME,
      description: 'Default MCP server: ftshare',
      enabled: false,
      builtin: true,
      transport: {
        type: 'http',
        url: ftshareConfig.url,
      },
      original_json: JSON.stringify({ mcpServers: { [BUILTIN_FTSHARE_NAME]: ftshareConfig } }, null, 2),
    },
    buildBuiltinBrowserServer(),
  ];
}

async function isCommandAvailable(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: 3000 }, (error) => {
      if (!error) {
        resolve(true);
        return;
      }

      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        resolve(false);
        return;
      }

      resolve(true);
    });
  });
}

async function ensureBuiltinChromeDevtoolsAvailability(server?: IMcpServer): Promise<void> {
  if (
    !server ||
    server.name !== BUILTIN_CHROME_DEVTOOLS_NAME ||
    server.transport.type !== 'stdio' ||
    server.transport.command !== 'npx'
  ) {
    return;
  }

  const hasNpx = await isCommandAvailable(server.transport.command);
  if (hasNpx) {
    return;
  }

  try {
    await mcpService.testMcpConnection.invoke(server);
  } catch (error) {
    console.warn('[Migration] chrome-devtools MCP preflight failed', error);
  }
}

function buildOriginalJsonFromTransport(server: Pick<IMcpServer, 'name' | 'description' | 'transport'>): string {
  const transport_config =
    server.transport.type === 'stdio'
      ? {
          command: server.transport.command,
          args: server.transport.args || [],
          env: server.transport.env || {},
        }
      : {
          type: server.transport.type,
          url: server.transport.url,
          ...(server.transport.headers ? { headers: server.transport.headers } : {}),
        };

  return JSON.stringify(
    {
      mcpServers: {
        [server.name]: {
          ...(server.description ? { description: server.description } : {}),
          ...transport_config,
        },
      },
    },
    null,
    2
  );
}

async function ensureBootstrapMcpServersInDb(configFile: ConfigFile): Promise<void> {
  const [backendPrefs, fileImageConfig, providers] = await Promise.all([
    fetchBackendClientPreferences(),
    configFile.get('tools.imageGenerationModel').catch((): undefined => undefined),
    fetchProviders(),
  ]);
  const imageConfig = resolveImageGenerationMigrationConfig(backendPrefs, fileImageConfig);
  const imageConfigSource = resolveImageGenerationMigrationConfigSource(backendPrefs, fileImageConfig);
  const existing = await mcpService.listServers.invoke();
  const existingByName = new Map((existing ?? []).map((server) => [server.name, server]));
  const existingImageServer = existingByName.get(BUILTIN_IMAGE_GEN_NAME);
  const existingImageEnv =
    existingImageServer?.transport.type === 'stdio' ? existingImageServer.transport.env : undefined;
  const imageEnvResolution = resolveImageGenerationMcpEnv(imageConfig, providers, existingImageEnv);
  logImageGenerationEnvResolution(imageEnvResolution, 'bootstrap');

  // The media MCP shell forwards every call here; without the port it reports a
  // clear error rather than silently taking a different code path.
  let mediaPort: number | undefined;
  try {
    mediaPort = await startMediaMcpServer();
  } catch (error) {
    console.warn('[Migration] failed to start built-in media generation TCP server', error);
  }

  const imageServer = buildBuiltinImageGenerationServer(imageEnvResolution, imageConfig, mediaPort, providers);
  const defaultServers = buildDefaultMcpServers();

  let exportPdfPort: number | undefined;
  try {
    exportPdfPort = await startExportPdfMcpServer();
  } catch (error) {
    console.warn('[Migration] failed to start built-in export-pdf TCP server', error);
  }
  const exportPdfServer = exportPdfPort !== undefined ? buildBuiltinExportPdfServer(exportPdfPort) : undefined;

  let teamKnowledgePort: number | undefined;
  try {
    teamKnowledgePort = await startTeamKnowledgeMcpServer();
  } catch (error) {
    console.warn('[Migration] failed to start built-in team-knowledge TCP server', error);
  }
  const teamKnowledgeServer =
    teamKnowledgePort !== undefined ? buildBuiltinTeamKnowledgeServer(teamKnowledgePort) : undefined;

  const missing = [
    ...defaultServers,
    imageServer,
    ...(exportPdfServer ? [exportPdfServer] : []),
    ...(teamKnowledgeServer ? [teamKnowledgeServer] : []),
  ].filter((server) => !existingByName.has(server.name));
  let imageServerUpdated = false;

  if (missing.length > 0) {
    await mcpService.batchImportServers.invoke({ servers: missing });
  }

  const existingChromeDevtools = existingByName.get(BUILTIN_CHROME_DEVTOOLS_NAME);
  if (
    existingChromeDevtools &&
    (existingChromeDevtools.builtin !== true ||
      !existingChromeDevtools.original_json ||
      existingChromeDevtools.original_json.trim() === '' ||
      existingChromeDevtools.original_json.trim() === '{}')
  ) {
    await mcpService.updateServer.invoke({
      id: existingChromeDevtools.id,
      data: {
        builtin: true,
        original_json: buildOriginalJsonFromTransport(existingChromeDevtools),
      },
    });
  }

  const refreshedServers = await mcpService.listServers.invoke();
  const chromeDevtoolsServer = refreshedServers.find((server) => server.name === BUILTIN_CHROME_DEVTOOLS_NAME);
  // Do not block startup on chrome-devtools preflight: on packaged Windows builds
  // `npx` is often unavailable until the managed Node runtime finishes preparing,
  // and the backend MCP test can hold the connection open for 30s.
  void ensureBuiltinChromeDevtoolsAvailability(chromeDevtoolsServer);

  if (
    imageEnvResolution.ok === true &&
    existingImageServer &&
    existingImageServer.transport.type === 'stdio' &&
    imageServer.transport.type === 'stdio'
  ) {
    const mergedEnv = buildImageServerEnv(imageEnvResolution.env, existingImageServer.transport.env, mediaPort);
    const updatedTransport = {
      ...imageServer.transport,
      env: mergedEnv,
    };
    const original_json = JSON.stringify(
      {
        mcpServers: {
          [BUILTIN_IMAGE_GEN_NAME]: {
            command: updatedTransport.command,
            args: updatedTransport.args || [],
            env: mergedEnv,
          },
        },
      },
      null,
      2
    );
    const imageTransportChanged = !isSameStdioTransport(existingImageServer.transport, updatedTransport);
    const imageOriginalJsonChanged = existingImageServer.original_json !== original_json;
    const imageServerChanged = imageTransportChanged || imageOriginalJsonChanged;
    console.info(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      existingImageServer.id,
      imageTransportChanged ? 'yes' : 'no',
      imageOriginalJsonChanged ? 'yes' : 'no',
      imageServerChanged ? 'yes' : 'no'
    );
    if (imageServerChanged) {
      await mcpService.updateServer.invoke({
        id: existingImageServer.id,
        data: {
          transport: updatedTransport,
          original_json,
        },
      });
      imageServerUpdated = true;
    }
  } else if (existingImageServer && imageEnvResolution.ok === false) {
    console.warn(
      '[Migration] skipped image MCP env update because provider could not be resolved, server id: %s, reason: %s',
      existingImageServer.id,
      imageEnvResolution.reason
    );
  }

  // The `enabled` decision above only applies to a row being created. An
  // install that predates media models already has this row sitting disabled —
  // the state it was born in, because the legacy switch defaults to off — and
  // the update path above only ever touched transport/original_json. Without
  // this, declaring a video model would light the tools up on a fresh install
  // and do nothing on every existing one.
  //
  // Enabling only, never disabling: removing one media model should not silently
  // strip a capability an agent may be mid-conversation with, and the tool
  // reports its own "no model configured" error far more clearly than a
  // vanished tool ever could. Guarded on the current state, so it flips once and
  // then leaves the row alone.
  if (existingImageServer && existingImageServer.enabled === false && hasDeclaredMediaModel(providers)) {
    try {
      await mcpService.toggleServer.invoke({ id: existingImageServer.id });
      console.info(
        '[Migration] enabled built-in media MCP because a media model is declared, server id: %s',
        existingImageServer.id
      );
    } catch (error) {
      console.warn('[Migration] failed to enable built-in media MCP', error);
    }
  }

  // The TCP port is allocated fresh each app start (19820 + first free slot),
  // so an existing export-pdf server row may point at a now-stale port.
  let exportPdfServerUpdated = false;
  if (exportPdfServer && existingByName.has(BUILTIN_EXPORT_PDF_NAME)) {
    const existingExportPdfServer = existingByName.get(BUILTIN_EXPORT_PDF_NAME)!;
    if (existingExportPdfServer.transport.type === 'stdio' && exportPdfServer.transport.type === 'stdio') {
      const transportChanged = !isSameStdioTransport(existingExportPdfServer.transport, exportPdfServer.transport);
      if (transportChanged) {
        await mcpService.updateServer.invoke({
          id: existingExportPdfServer.id,
          data: {
            transport: exportPdfServer.transport,
            original_json: exportPdfServer.original_json,
          },
        });
        exportPdfServerUpdated = true;
      }
    }
  }

  // Same stale-port problem as export-pdf above (19840 + first free slot).
  let teamKnowledgeServerUpdated = false;
  if (teamKnowledgeServer && existingByName.has(BUILTIN_TEAM_KNOWLEDGE_NAME)) {
    const existingTeamKnowledgeServer = existingByName.get(BUILTIN_TEAM_KNOWLEDGE_NAME)!;
    if (existingTeamKnowledgeServer.transport.type === 'stdio' && teamKnowledgeServer.transport.type === 'stdio') {
      const transportChanged = !isSameStdioTransport(
        existingTeamKnowledgeServer.transport,
        teamKnowledgeServer.transport
      );
      if (transportChanged) {
        await mcpService.updateServer.invoke({
          id: existingTeamKnowledgeServer.id,
          data: {
            transport: teamKnowledgeServer.transport,
            original_json: teamKnowledgeServer.original_json,
          },
        });
        teamKnowledgeServerUpdated = true;
      }
    }
  }

  /**
   * 修复浏览器 MCP 记录里过期的脚本绝对路径。
   *
   * 注册时把绝对路径写进了 transport.args，只在「首次插入」时写一次。应用被移动过
   * （用户把 .app 拖出 /Applications、Windows 重装到别的目录、开发时换 worktree）
   * 之后这条路径就失效了，而按名字判断「已注册」使它永远不会被重新插入 ——
   * 结果是浏览器工具永久失效且不会自愈。所以每次启动都对齐一次实际路径。
   *
   * Repair a stale absolute script path in the browser MCP record. The path is baked
   * into transport.args and only written on first insert, so once the app moves (user
   * drags the .app out of /Applications, a Windows reinstall to a different directory,
   * a developer switching worktrees) it goes stale — and because "already registered"
   * is decided by name, it is never re-inserted, leaving the browser tools broken with
   * no self-heal. Reconcile against the real path on every startup instead.
   */
  const existingBrowserServer = existing.find((server) => server.name === BUILTIN_BROWSER_MCP_NAME);
  let browserServerUpdated = false;
  if (existingBrowserServer) {
    const desiredBrowserServer = buildBuiltinBrowserServer();
    const browserTransportChanged = !isSameStdioTransport(
      existingBrowserServer.transport,
      desiredBrowserServer.transport
    );
    const browserJsonChanged = existingBrowserServer.original_json !== desiredBrowserServer.original_json;
    // description is also baked in at first insert and never reconciled otherwise — a
    // wording/brand fix in code silently never reaches an already-provisioned install
    // without this, same failure shape as the transport-path drift above.
    const browserDescriptionChanged = existingBrowserServer.description !== desiredBrowserServer.description;
    if (browserTransportChanged || browserJsonChanged || browserDescriptionChanged) {
      console.info(
        '[Migration] browser MCP path drifted, server id: %s, transport changed: %s, json changed: %s, description changed: %s',
        existingBrowserServer.id,
        browserTransportChanged ? 'yes' : 'no',
        browserJsonChanged ? 'yes' : 'no',
        browserDescriptionChanged ? 'yes' : 'no'
      );
      await mcpService.updateServer.invoke({
        id: existingBrowserServer.id,
        data: {
          transport: desiredBrowserServer.transport,
          original_json: desiredBrowserServer.original_json,
          description: desiredBrowserServer.description,
        },
      });
      browserServerUpdated = true;
    }
  }

  console.info(
    '[Migration] MCP bootstrap completed, imported %d missing defaults, updated image server: %s, updated browser server: %s, image config source: %s, image enabled: %s, updated export-pdf server: %s, updated team-knowledge server: %s',
    missing.length,
    imageServerUpdated ? 'yes' : 'no',
    browserServerUpdated ? 'yes' : 'no',
    imageConfigSource,
    imageConfig?.switch === true ? 'yes' : 'no',
    exportPdfServerUpdated ? 'yes' : 'no',
    teamKnowledgeServerUpdated ? 'yes' : 'no'
  );
}

const MIGRATION_STEPS: Array<{
  name: string;
  run: (configFile: ConfigFile) => Promise<MigrationStepResult>;
}> = [
  {
    name: 'migrateLegacyMcpConfigToDb',
    run: async (configFile) => (await migrateLegacyMcpConfigToDb(configFile), true),
  },
  { name: 'migrateConfigStorage', run: async (configFile) => (await migrateConfigStorage(configFile), true) },
  { name: 'migrateProviders', run: async (configFile) => (await migrateProviders(configFile), true) },
  {
    name: 'ensureBootstrapMcpServersInDb',
    run: async (configFile) => (await ensureBootstrapMcpServersInDb(configFile), true),
  },
  { name: 'migrateAssistantsToBackend', run: async (configFile) => migrateAssistantsToBackend(configFile) },
  { name: 'migrateOneCustomAgents', run: async (configFile) => migrateOneCustomAgents(configFile) },
];

async function syncBuiltinMcpConfig(configFile: ConfigFile): Promise<void> {
  const localMcpConfig = ((await configFile.get('mcp.config').catch((): IMcpServer[] => [])) || []) as IMcpServer[];
  const localBuiltinServers = localMcpConfig.filter((server) => server?.builtin === true);

  if (localBuiltinServers.length === 0) {
    return;
  }

  const backendSettings = (await httpRequest<Record<string, unknown>>('GET', '/api/settings/client')) || {};
  const backendMcpConfig = Array.isArray(backendSettings['mcp.config'])
    ? (backendSettings['mcp.config'] as IMcpServer[])
    : [];

  const mergedMcpConfig = [...backendMcpConfig.filter((server) => server?.builtin !== true), ...localBuiltinServers];

  if (JSON.stringify(backendMcpConfig) === JSON.stringify(mergedMcpConfig)) {
    return;
  }

  await httpRequest<void>('PUT', '/api/settings/client', { 'mcp.config': mergedMcpConfig });
  console.info(
    '[AionUi] Synced builtin MCP config to backend settings (%d builtin servers)',
    localBuiltinServers.length
  );
}

export async function runBackendMigrations(configFile: ConfigFile): Promise<void> {
  await CLEANUP_STEPS.reduce<Promise<void>>(async (previous, step) => {
    await previous;
    const start = Date.now();
    try {
      await step.run();
      console.info(`[AionUi] Backend migration step completed: ${step.name} (${Date.now() - start}ms)`);
    } catch (error) {
      console.error(`[AionUi] Backend migration step failed: ${step.name} (${Date.now() - start}ms)`, error);
    }
  }, Promise.resolve());

  await MIGRATION_STEPS.reduce<Promise<void>>(async (previous, step) => {
    await previous;
    const start = Date.now();
    try {
      const completed = await step.run(configFile);
      const elapsed = Date.now() - start;
      if (!completed) {
        console.warn(`[AionUi] Backend migration step incomplete: ${step.name} (${elapsed}ms)`);
        return;
      }
      console.info(`[AionUi] Backend migration step completed: ${step.name} (${elapsed}ms)`);
    } catch (error) {
      const elapsed = Date.now() - start;
      console.error(`[AionUi] Backend migration step failed: ${step.name} (${elapsed}ms)`, error);
    }
  }, Promise.resolve());

  const syncStart = Date.now();
  try {
    await syncBuiltinMcpConfig(configFile);
    console.info(`[AionUi] Backend migration step completed: syncBuiltinMcpConfig (${Date.now() - syncStart}ms)`);
  } catch (error) {
    console.error(`[AionUi] Backend migration step failed: syncBuiltinMcpConfig (${Date.now() - syncStart}ms)`, error);
  }
}
