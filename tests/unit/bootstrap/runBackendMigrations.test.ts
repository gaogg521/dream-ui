import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GEN_ENV_KEYS } from '@/common/config/imageGenerationMcpEnv';
import {
  BUILTIN_IMAGE_GEN_LEGACY_NAMES,
  BUILTIN_IMAGE_GEN_NAME,
  type IMcpServer,
  type IProvider,
} from '@/common/config/storage';
import { resolveImageGenerationMigrationConfig, runBackendMigrations } from '@/process/utils/runBackendMigrations';

const {
  batchImportServersMock,
  configFileGetMock,
  configFileSetMock,
  httpRequestMock,
  deleteServerMock,
  listServersMock,
  testMcpConnectionMock,
  updateServerMock,
} = vi.hoisted(() => ({
  batchImportServersMock: vi.fn(),
  configFileGetMock: vi.fn(),
  deleteServerMock: vi.fn(),
  configFileSetMock: vi.fn(),
  httpRequestMock: vi.fn(),
  listServersMock: vi.fn(),
  testMcpConnectionMock: vi.fn(),
  updateServerMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    listServers: { invoke: listServersMock },
    batchImportServers: { invoke: batchImportServersMock },
    updateServer: { invoke: updateServerMock },
    deleteServer: { invoke: deleteServerMock },
    testMcpConnection: { invoke: testMcpConnectionMock },
  },
}));

vi.mock('@/common/config/configMigration', () => ({
  migrateConfigStorage: vi.fn().mockResolvedValue(undefined),
  migrateLegacyMcpConfigToDb: vi.fn().mockResolvedValue(undefined),
  migrateProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/process/utils/initStorage', () => ({
  getBuiltinMcpScriptPath: (name: string) => `/mock/${name}.js`,
}));

vi.mock('@/process/utils/migrateAssistants', () => ({
  migrateAssistantsToBackend: vi.fn().mockResolvedValue(true),
}));

// Keep bootstrap hermetic: the real service binds a TCP port and touches
// userData. This suite is about MCP server config sync, not the job engine.
vi.mock('@process/services/mediaJob', () => ({
  startMediaMcpServer: vi.fn().mockResolvedValue(19860),
}));

const provider: IProvider = {
  id: 'provider-1',
  platform: 'gemini',
  name: 'Gemini',
  base_url: 'https://generativelanguage.googleapis.com',
  api_key: 'provider-key',
  models: ['gemini-image'],
  enabled: true,
};

// No api key: generation moved into the main process, so the subprocess env
// only names the selected model and carries the media service port.
// Key order mirrors an already-synced row: the merge keeps non-image keys
// (the port) first, then re-applies the resolved image keys.
const imageEnv = {
  MEDIA_MCP_PORT: '19860',
  [IMAGE_GEN_ENV_KEYS.providerId]: 'provider-1',
  [IMAGE_GEN_ENV_KEYS.platform]: 'gemini',
  [IMAGE_GEN_ENV_KEYS.baseUrl]: 'https://generativelanguage.googleapis.com',
  [IMAGE_GEN_ENV_KEYS.model]: 'gemini-image',
  [IMAGE_GEN_ENV_KEYS.providerName]: 'Gemini',
};

const imageServer = (): IMcpServer => ({
  id: 'image-server-id',
  name: BUILTIN_IMAGE_GEN_NAME,
  description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
  enabled: true,
  builtin: true,
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/mock/builtin-mcp-image-gen.js'],
    env: imageEnv,
  },
  created_at: 1,
  updated_at: 1,
  original_json: JSON.stringify(
    {
      mcpServers: {
        [BUILTIN_IMAGE_GEN_NAME]: {
          command: 'node',
          args: ['/mock/builtin-mcp-image-gen.js'],
          env: imageEnv,
        },
      },
    },
    null,
    2
  ),
});

const configFile = {
  get: configFileGetMock,
  set: configFileSetMock,
};

beforeEach(() => {
  vi.clearAllMocks();
  configFileGetMock.mockResolvedValue(undefined);
  configFileSetMock.mockResolvedValue(undefined);
  batchImportServersMock.mockResolvedValue([]);
  deleteServerMock.mockResolvedValue(undefined);
  updateServerMock.mockImplementation(async ({ id, data }) => ({
    ...imageServer(),
    id,
    ...data,
  }));
  testMcpConnectionMock.mockResolvedValue({ success: false, error: 'Command not found: npx' });
  httpRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/settings/client') {
      return {
        'tools.imageGenerationModel': {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
        },
      };
    }
    if (method === 'GET' && path === '/api/providers') {
      return [provider];
    }
    return undefined;
  });
});

describe('resolveImageGenerationMigrationConfig', () => {
  it('uses backend client preference when local config file no longer has the image model', () => {
    const backendConfig = {
      id: 'gemini',
      name: 'Gemini',
      platform: 'gemini',
      base_url: 'https://example.test',
      api_key: 'backend-key',
      use_model: 'gemini-image',
    };

    expect(resolveImageGenerationMigrationConfig({ 'tools.imageGenerationModel': backendConfig }, undefined)).toEqual(
      backendConfig
    );
  });
});

describe('runBackendMigrations', () => {
  it('does not write image generation business config back to local config storage', async () => {
    listServersMock.mockResolvedValue([imageServer()]);
    configFileGetMock.mockImplementation(async (key: string) => {
      if (key === 'tools.imageGenerationModel') {
        return {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
          switch: true,
        };
      }
      return undefined;
    });
    httpRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return {};
      }
      if (method === 'GET' && path === '/api/providers') {
        return [provider];
      }
      return undefined;
    });

    await runBackendMigrations(configFile as never);

    expect(configFileSetMock).not.toHaveBeenCalledWith('tools.imageGenerationModel', expect.anything());
  });

  it('refreshes a stale media service port on the image MCP server row', async () => {
    // The media TCP service takes the first free port each launch, so a row
    // carrying last run's port would leave the MCP shell dialling nobody.
    const stale = imageServer();
    if (stale.transport.type === 'stdio') {
      stale.transport.env = { ...stale.transport.env, MEDIA_MCP_PORT: '19999' };
    }
    listServersMock.mockResolvedValue([stale]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    const updated = updateServerMock.mock.calls[0][0];
    expect(updated.data.transport.env.MEDIA_MCP_PORT).toBe('19860');
  });

  it('does not sync the built-in image MCP server when bootstrap makes no effective change', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalled();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'no',
      'no'
    );
  });

  it('does not sync agents when only the stored image MCP JSON representation differs', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        original_json: '{"legacy":true}',
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'yes',
      'yes'
    );
  });

  /**
   * The bug these pin: "already registered" was decided by exact current name,
   * so a row still called `aionui-image-generation` was invisible to the check
   * and a second row was inserted beside it. Both stayed enabled, so every
   * media tool existed twice and the agent used whichever it saw first.
   */
  describe('pre-rebrand builtin rows', () => {
    const LEGACY_IMAGE_NAME = BUILTIN_IMAGE_GEN_LEGACY_NAMES[0];

    it('renames a legacy image row forward instead of inserting a second one', async () => {
      listServersMock.mockResolvedValue([{ ...imageServer(), name: LEGACY_IMAGE_NAME }]);

      await runBackendMigrations(configFile as never);

      const renames = updateServerMock.mock.calls.filter((call) => call[0].data?.name === BUILTIN_IMAGE_GEN_NAME);
      expect(renames).toHaveLength(1);
      expect(renames[0][0].id).toBe('image-server-id');
      expect(deleteServerMock).not.toHaveBeenCalled();

      const imported = batchImportServersMock.mock.calls.flatMap((call) => call[0].servers as IMcpServer[]);
      expect(imported.map((server) => server.name)).not.toContain(BUILTIN_IMAGE_GEN_NAME);
    });

    it('drops the legacy row when a current-named one already exists', async () => {
      listServersMock.mockResolvedValue([
        imageServer(),
        { ...imageServer(), id: 'legacy-image-id', name: LEGACY_IMAGE_NAME },
      ]);

      await runBackendMigrations(configFile as never);

      expect(deleteServerMock).toHaveBeenCalledOnce();
      expect(deleteServerMock).toHaveBeenCalledWith({ id: 'legacy-image-id' });
      expect(updateServerMock.mock.calls.some((call) => call[0].data?.name === BUILTIN_IMAGE_GEN_NAME)).toBe(false);
    });

    it('leaves an install that is already on the current name alone', async () => {
      listServersMock.mockResolvedValue([imageServer()]);

      await runBackendMigrations(configFile as never);

      expect(deleteServerMock).not.toHaveBeenCalled();
      expect(updateServerMock).not.toHaveBeenCalled();
    });

    it('keeps going when one row cannot be reconciled', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      deleteServerMock.mockRejectedValueOnce(new Error('row is locked'));
      listServersMock.mockResolvedValue([
        imageServer(),
        { ...imageServer(), id: 'legacy-image-id', name: LEGACY_IMAGE_NAME },
      ]);

      // A single unreconcilable row must not abort MCP bootstrap for the rest:
      // the reward for throwing here is an install with no builtin servers.
      await expect(runBackendMigrations(configFile as never)).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        '[Migration] failed to reconcile legacy builtin MCP row %s',
        LEGACY_IMAGE_NAME,
        expect.any(Error)
      );
    });
  });
});
