/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import {
  APP_USER_MODEL_ID,
  DEV_APP_USER_MODEL_ID,
  getDevAppName,
  migrateAndResolveProdUserDataDir,
  PROD_USERDATA_APP_NAME,
} from '@/common/platform';
import { applyGpuRecoveryFlags } from './gpuRecovery';
import { resolveDevtoolsCdpPort } from './devtoolsCdp';

// ============ E2E test isolation ============
// When running under E2E with an explicit sandbox dir, redirect userData there
// BEFORE any getPath() call so the whole data tree (config, dreamcore DB, logs)
// lives in a disposable directory. This keeps tests off the developer's real
// database — critical because Dream Core refuses to boot when a shared DB fails
// migration. Guarded by DREAM_E2E_TEST so it never affects dev/production.
// 仅 E2E：把 userData 指向一次性沙箱目录，避免测试读写真实数据库。
const e2eUserDataDir = process.env.DREAM_E2E_TEST === '1' ? process.env.DREAM_E2E_USER_DATA_DIR : undefined;
if (e2eUserDataDir && e2eUserDataDir.trim() !== '') {
  fs.mkdirSync(e2eUserDataDir, { recursive: true });
  app.setPath('userData', e2eUserDataDir);
}

// ============ Environment Separation ============
// Set app name before any getPath() call so userData is isolated from production.
// Note: getPlatformServices() auto-registration also applies this as a safety net
// in case Rollup loads initStorage's chunk before this module runs.
// 开发模式下设置独立 app 名称，userData 目录将与正式版隔离，允许同时运行
// E2E 沙箱已显式设置 userData 时跳过，避免被 dev app 名覆盖。
if (!app.isPackaged && !e2eUserDataDir) {
  const devAppName = getDevAppName();
  app.setName(devAppName);
  // In Electron 28+, setName alone no longer updates userData path on macOS.
  // Explicitly override userData to the dev directory.
  const appSupportDir = path.dirname(app.getPath('userData'));
  app.setPath('userData', path.join(appSupportDir, devAppName));
  // Windows taskbar identity (AppUserModelID) is independent of app.getName()
  // and the window title — leaving it unset showed a stale/unbranded tooltip
  // even though both of those were correctly branded. No-op on non-Windows.
  app.setAppUserModelId(DEV_APP_USER_MODEL_ID);
} else if (app.isPackaged && !e2eUserDataDir) {
  // Production: pin the app name + userData path to PROD_USERDATA_APP_NAME
  // ("One Work"), independent of any future productName change. A pre-3.0
  // install has its data under the legacy "1ONE Code" directory —
  // migrateAndResolveProdUserDataDir moves it on first launch so upgrading
  // users keep their conversations / model keys / licence. Same
  // setName-then-setPath dance as dev because Electron 28+ does not
  // retroactively move userData on setName (macOS).
  app.setName(PROD_USERDATA_APP_NAME);
  const appSupportDir = path.dirname(app.getPath('userData'));
  app.setPath('userData', migrateAndResolveProdUserDataDir(appSupportDir));
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// app.disableHardwareAcceleration() must run before app is ready.
applyGpuRecoveryFlags();

// Configure Chromium command-line flags for WebUI and CLI modes
// 为 WebUI 和 CLI 模式配置 Chromium 命令行参数

const isWebUI = process.argv.some((arg) => arg === '--webui');
const isResetPassword = process.argv.includes('--resetpass');

// Only configure flags for WebUI and --resetpass modes
// 仅为 WebUI 和重置密码模式配置参数
if (isWebUI || isResetPassword) {
  // In WebUI/reset-password mode on Linux, force headless Ozone backend.
  // This mode should never depend on X11/Wayland availability.
  // 在 Linux 的 WebUI/重置密码模式下，强制使用 headless Ozone 后端，
  // 避免因 DISPLAY 变量存在但显示服务不可用导致平台初始化失败。
  // Note: Do NOT use --headless (browser automation mode that causes auto-exit).
  // Instead, use --ozone-platform=headless which provides a proper display backend
  // without requiring a display server, keeping the Electron process alive.
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform', 'headless');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  // For root user, disable sandbox to prevent crash
  // 对于 root 用户，禁用沙箱以防止崩溃
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    app.commandLine.appendSwitch('no-sandbox');
  }
}

// ---------------------------------------------------------------------------
// Agent browser control (CDP) — user-facing on/off switch and its persisted config.
//
// This block no longer allocates a port. The single-target bridge (cdpBridge.ts) binds an
// OS-assigned ephemeral port via listen(0) and backfills it here through setActiveCdpPort,
// so there is exactly one port concept in the codebase: the one you can actually connect to.
//
// The 9230-9250 reservation and the ~/.dream-cdp-registry.json instance registry were
// removed with Chromium's application-wide remote-debugging-port switch. Once that switch
// was gone nothing listened on that range, so the registry tracked a service that did not
// exist, multi-instance avoidance was avoiding phantoms, and — worst of all — the settings
// page displayed the reserved number as "the current CDP port" and built copy-pasteable MCP
// config from it, handing users an address that could never connect.
//
// Do not move the bridge onto a fixed port to bring that bookkeeping back: the ephemeral
// port is the only real barrier against same-user local processes, because the token leaks
// through the unauthenticated discovery endpoint (see the threat model note in cdpBridge.ts).
//
// Configuration file: userData/cdp.config.json
// - enabled: boolean - whether agent browser control is enabled (default: on)
// - port: number - legacy preferred-port field, retained for config compatibility
//
// Override via DREAM_CDP_PORT env variable. Set to "0" or "false" to disable.
// ---------------------------------------------------------------------------

const CDP_CONFIG_FILE = 'cdp.config.json';

/** CDP configuration stored in userData directory */
export interface CdpConfig {
  /** Whether CDP is enabled (default: true in dev mode, false in production) */
  enabled?: boolean;
  /**
   * 历史字段：以前用来挑保留端口。通道改用 listen(0) 之后不再读它，
   * 但保留在类型里，这样老配置文件不会因为多一个未知键而出问题。
   *
   * Legacy field that used to pick a reserved port. Unread since the bridge moved to
   * listen(0), but kept in the type so existing config files do not trip over an
   * unrecognised key.
   */
  port?: number;
}

/** CDP status information exposed to renderer */
export interface CdpStatus {
  /** Whether CDP is currently enabled */
  enabled: boolean;
  /** Current CDP port (null if disabled or not started) */
  port: number | null;
  /** Whether CDP was enabled at startup (requires restart to change) */
  startupEnabled: boolean;
  /** Whether CDP is enabled in the persisted config file (may differ from runtime) */
  configEnabled: boolean;
  /** Whether the app is running in development mode */
  isDevMode: boolean;
}

/**
 * 顺手删掉遗留的实例注册表文件。
 *
 * 这个文件（~/.dream-cdp-registry.json）以前记录「每个实例占了哪个 CDP 端口」。相关逻辑
 * 已随应用级 remote-debugging-port 一起删除，但升级上来的机器上文件还在，里面是一堆早已
 * 无效的 pid/端口。留着只会让人以为还有这套机制，所以清掉。best-effort，失败无所谓。
 *
 * Remove the leftover instance-registry file. ~/.dream-cdp-registry.json used to record
 * which CDP port each instance had taken; that logic went away with the application-wide
 * remote-debugging-port switch, but upgraded machines still have the file sitting there full
 * of long-dead pids and ports. Leaving it implies the mechanism still exists, so clean it up.
 * Best-effort: failure is harmless.
 */
function removeLegacyCdpRegistryFile(): void {
  try {
    const legacyRegistry = path.join(os.homedir(), '.aionui-cdp-registry.json');
    if (fs.existsSync(legacyRegistry)) {
      fs.unlinkSync(legacyRegistry);
    }
  } catch {
    // Nothing depends on this succeeding.
  }
}

/**
 * Load CDP configuration from userData directory.
 * This must be called before app.ready, so we use synchronous file operations.
 */
function loadCdpConfig(): CdpConfig {
  try {
    // Try to get userData path - this works even before app.ready
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, CDP_CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
      return {};
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as CdpConfig;
    }
  } catch {
    // Ignore errors when loading config
  }
  return {};
}

/**
 * Save CDP configuration to userData directory.
 */
export function saveCdpConfig(config: CdpConfig): void {
  try {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, CDP_CONFIG_FILE);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[CDP] Failed to save CDP config:', error);
  }
}

/**
 * Determine if CDP should be enabled at startup.
 * Priority: env variable > config file > default (enabled).
 *
 * 默认开启（含正式版）：应用内浏览器要让 Agent 操作，就必须有这条通道，否则
 * 「装好即可用」不成立。通道只绑 127.0.0.1，不对外暴露；用户仍可在设置里关掉，
 * 关掉后 Agent 就无法操作浏览器（此时 MCP 启动器会拒绝启动，不会偷偷开一个
 * 用户看不见的 Chrome）。
 *
 * DREAM_CDP_PORT 现在只当开关用（"0"/"false" 关闭，其它非空值开启）。它的数值不再
 * 决定端口 —— 通道走 listen(0)，端口由系统分配。名字保留是为了不破坏既有脚本和 E2E 夹具。
 *
 * Enabled by default, production included: the in-app browser cannot be driven by the agent
 * without this bridge, so "works out of the box" would otherwise fail. The bridge binds to
 * 127.0.0.1 only and is never externally reachable. Users can still turn it off in settings,
 * after which the agent simply cannot drive the browser (the MCP launcher refuses to start
 * rather than quietly opening a Chrome the user cannot see).
 *
 * DREAM_CDP_PORT now acts purely as a switch ("0"/"false" disables, any other non-empty
 * value enables). Its numeric value no longer selects a port — the bridge uses listen(0) and
 * the OS assigns one. The name is kept so existing scripts and E2E fixtures keep working.
 */
function shouldEnableCdp(config: CdpConfig): boolean {
  const envVal = process.env.DREAM_CDP_PORT;
  if (envVal === '0' || envVal === 'false') return false;
  if (envVal) return true;

  if (config.enabled !== undefined) {
    return config.enabled;
  }

  return true;
}

/**
 * 通道的实际监听端口，由 cdpBridge 启动后回填；未启用/未起来时为 null。
 *
 * 刻意不再在这里预留 9230-9250 段的端口号。移除 remote-debugging-port 之后那个号段
 * 没有任何进程监听，findAvailablePort/registerInstance 追踪的是一个不存在的服务：
 * 多实例避让失去意义，而设置页把它显示成「当前 CDP 端口」、还据此生成可复制的 MCP 配置，
 * 等于给用户一个连不上的地址。通道走 listen(0)（这也是本机唯一真实屏障，见 cdpBridge.ts
 * 的威胁模型说明），所以真实端口只可能在桥起来之后才知道 —— 由它回填这里，全局只保留
 * 一个端口概念。
 *
 * The bridge's real listening port, backfilled by cdpBridge once it starts; null while agent
 * browser control is off or the bridge has not come up.
 *
 * Deliberately no longer reserves a port from the 9230-9250 range here. With
 * remote-debugging-port gone nothing listens on that range, so findAvailablePort /
 * registerInstance were tracking a service that does not exist: multi-instance avoidance
 * became meaningless, while the settings page displayed it as "the current CDP port" and
 * generated copy-pasteable MCP config from it — handing the user an address that cannot be
 * reached. The bridge uses listen(0) (also the only real local barrier — see the threat model
 * note in cdpBridge.ts), so the real port is only knowable after it starts. It backfills this
 * value, leaving exactly one port concept in the codebase.
 */
export let cdpPort: number | null = null;

/** Called by cdpBridge once it is listening, so status/UI report the reachable port. */
export function setActiveCdpPort(port: number | null): void {
  cdpPort = port;
}

/** Whether CDP was enabled at startup (requires restart to change). */
export let cdpStartupEnabled: boolean = false;

// Load config and initialize CDP at startup
const cdpConfig = loadCdpConfig();
cdpStartupEnabled = shouldEnableCdp(cdpConfig);

if (cdpStartupEnabled) {
  /**
   * 刻意不再调用 appendSwitch('remote-debugging-port', ...)。
   *
   * Chromium 那个开关是应用级的，没有 per-target ACL：一开就把每个 WebContents 都
   * 暴露出去，包括挂着 preload 桥的主窗口，而且不需要任何认证。本机任意进程连上去就能
   * 驱动整个应用。
   *
   * 改由 cdpBridge 只暴露侧边浏览器那一个 webContents。端口与 env 的写入都移到桥启动处
   * （见 index.ts），这里只负责判断「用户是否开启了这个能力」。
   *
   * Deliberately no longer calls appendSwitch('remote-debugging-port', ...). That switch is
   * application-wide with no per-target ACL: it exposes every WebContents — including the
   * main window with its preload bridge — with no authentication, so any local process can
   * drive the whole app. cdpBridge exposes only the in-app browser webview instead. Port
   * allocation and env publication now live where the bridge starts (see index.ts); this
   * block only decides whether the user enabled the capability at all.
   */
  console.log('[CDP] Agent browser control enabled (single-target bridge)');
} else {
  console.log('[CDP] Agent browser control disabled');
}

// 无论开关状态如何都清一次：关掉这个能力的用户同样不该留着那个失效文件。
// Runs regardless of the switch: users who turned the capability off should not be left
// with the stale file either.
removeLegacyCdpRegistryFile();

// ---------------------------------------------------------------------------
// Developer app-wide CDP (debugging only) — deliberately NOT the agent browser bridge.
//
// 这是一条**只给开发者用**的通道，和上面那个 agent 浏览器通道（cdpBridge.ts）是两回事：
//   - agent 通道：单目标、带 token、只暴露应用内浏览器那一个 webContents，正式版默认开；
//   - 这一条：应用级、无 per-target ACL、无认证，一开就把**每个** WebContents 都暴露出去，
//     包括挂着 preload 桥的主窗口。任意本机进程连上去就能驱动整个应用。
//
// 当初把 appendSwitch('remote-debugging-port') 整个删掉，正是因为它**默认常开**且带着上面
// 那个威胁模型。这里恢复的是能力、不是当初的形态，靠两道闸把风险按回去：
//   1. `app.isPackaged` 为真时**无条件拒绝**——正式版没有任何办法打开它，连配置文件都读不到；
//   2. dev 下也**不默认开**，必须显式设 DREAM_DEVTOOLS_CDP_PORT 才生效。
// 两道闸是「与」的关系，缺一条就不开。
//
// 为什么要把它加回来：本仓大量验收依赖「用 CDP 驱动真实界面」这套方法论（见各 session 文档
// 的「真机 CDP 验证」）。agent 浏览器通道按设计碰不到 Dream UI 界面本身，所以那套方法论在它
// 被删之后就断了，新会话照着 cdp.md 做只会白折腾。
//
// 用法（仅 dev）：
//   DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev     # 指定端口
//   DREAM_DEVTOOLS_CDP_PORT=1    bun run dev     # 用默认端口 9230
// ---------------------------------------------------------------------------

/**
 * 实际启用的应用级调试端口；未启用时为 null。
 * 判定逻辑在 ./devtoolsCdp（纯模块，可单测），这里只负责把结果挂到 Chromium 上。
 *
 * The app-wide debugging port actually in effect, or null. The decision lives in
 * ./devtoolsCdp (pure, unit-tested); this file only attaches the result to Chromium.
 */
export const devtoolsCdpPort: number | null = resolveDevtoolsCdpPort({
  isPackaged: app.isPackaged,
  env: process.env.DREAM_DEVTOOLS_CDP_PORT,
});

if (devtoolsCdpPort !== null) {
  app.commandLine.appendSwitch('remote-debugging-port', String(devtoolsCdpPort));
  /**
   * 显式钉死回环地址。Chromium 的默认值本来就是 127.0.0.1，但这个开关一旦被别处改成
   * 0.0.0.0 就会把整个应用暴露到局域网，而那是**静默**的。显式写死让它改不动。
   *
   * Pin the loopback address explicitly. Chromium already defaults to 127.0.0.1, but the
   * failure mode if anything ever flips it to 0.0.0.0 is silent LAN-wide exposure of every
   * WebContents, so state it rather than inherit it.
   */
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  /**
   * 新版 Chromium 会按 Origin 头拒绝 CDP WebSocket 握手。裸 ws 客户端（node/python）不发
   * Origin 不受影响，但 DevTools 前端和部分 MCP 工具会发，所以只放行本机这个端口自己。
   * 刻意不写 `*`——那会让任意网页里的脚本也能握手。
   *
   * Recent Chromium rejects CDP WebSocket handshakes by Origin. Raw ws clients send no Origin
   * and are unaffected, but the DevTools frontend and some MCP tools do, so allow exactly this
   * loopback origin. Deliberately not `*`, which would let scripts on any web page connect.
   */
  app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${devtoolsCdpPort}`);
  console.warn(
    `[CDP] Developer app-wide debugging ENABLED on http://127.0.0.1:${devtoolsCdpPort} — dev build only, every WebContents is exposed without authentication. Do not use on an untrusted machine.`
  );
} else if (process.env.DREAM_DEVTOOLS_CDP_PORT && app.isPackaged) {
  // Loud on purpose: someone tried to debug a packaged build and needs to know why it did not
  // work, rather than silently getting no port and assuming the app is broken.
  console.warn(
    '[CDP] DREAM_DEVTOOLS_CDP_PORT is set but this is a packaged build — refused. App-wide debugging is dev-only by design.'
  );
}

/**
 * verifyCdpReady 没有跟着上面的开发者端口一起恢复。
 *
 * 它当初探测的是应用级端口的 /json/version，并在失败时打一条启动警告。现在那个端口默认
 * 不开（dev 且显式设 env 才开），探测在绝大多数启动里必然失败——留着等于给每次正常启动
 * 加一条必假的警告。需要确认端口通不通的人本来就在手动连它，`curl /json/version` 一条命令
 * 比启动日志直接。单目标 agent 通道的就绪与否则由 startCdpBridge() 的返回值直接体现。
 *
 * verifyCdpReady was NOT restored alongside the developer port above. It probed
 * /json/version on the app-wide port and warned on failure; since that port is now off unless
 * explicitly requested in dev, the probe would fail on nearly every normal boot and add a
 * permanently-false warning. Anyone who needs to confirm the port is up is already connecting
 * to it by hand, where `curl /json/version` says it more directly. Agent-bridge readiness
 * remains evident from startCdpBridge()'s return value.
 */

/**
 * Get current CDP status for display in UI.
 */
export function getCdpStatus(): CdpStatus {
  const config = loadCdpConfig();
  return {
    /**
     * enabled 表示「通道真的起来了、连得上」，所以看 cdpPort 而不是配置：
     * 配置开着但桥启动失败时，UI 不该说它是启用的。
     *
     * `enabled` means the bridge is actually up and reachable, so it reads cdpPort rather
     * than the config: with the setting on but bridge startup failed, the UI must not claim
     * the capability is active.
     */
    enabled: cdpPort !== null,
    port: cdpPort,
    startupEnabled: cdpStartupEnabled,
    configEnabled: config.enabled ?? cdpStartupEnabled,
    isDevMode: !app.isPackaged,
  };
}

/**
 * Update CDP configuration and save to disk.
 * Note: Changing the enabled state requires app restart to take effect.
 */
export function updateCdpConfig(newConfig: Partial<CdpConfig>): CdpConfig {
  const currentConfig = loadCdpConfig();
  const updatedConfig = { ...currentConfig, ...newConfig };
  saveCdpConfig(updatedConfig);
  return updatedConfig;
}
