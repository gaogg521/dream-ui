/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 开发者应用级 CDP 端口的**判定逻辑**（纯函数，不 import electron）。
 *
 * 单独成模块的唯一理由是可测：configureChromium.ts 在模块加载时就会调 app.setName /
 * app.getPath / appendSwitch，想在单测里覆盖这里的判定就得把半个 Electron 都 mock 掉。
 * 而这两道闸是整段能力的安全前提（尤其「打包版必须拒绝」），必须被测试钉死，不能靠人读代码。
 *
 * The decision logic for the developer app-wide CDP port, kept electron-free so it can be
 * unit tested. configureChromium.ts touches app.setName/getPath/appendSwitch at import time,
 * so testing this in place would mean mocking half of Electron — and these two gates are the
 * entire security premise of the capability (above all "packaged builds refuse"), so they must
 * be locked by tests rather than by someone remembering to read the code.
 *
 * 与 cdpBridge.ts 的 agent 浏览器通道是**两回事**，别混：那条是单目标 + token + 正式版默认
 * 开；这条是应用级 + 无认证 + 仅 dev + 需显式开启。
 */

/** Port used when the env var is a truthy non-numeric value ("1" / "true"). */
export const DEFAULT_DEVTOOLS_CDP_PORT = 9230;

/**
 * 解析 DREAM_DEVTOOLS_CDP_PORT 的原始值。null = 不启用。
 *
 * 刻意**不接受 0**：Chromium 收到 `--remote-debugging-port=0` 会挑一个随机端口，只写进
 * userData 里的 DevToolsActivePort 文件，调用方拿不到号。对「我要连上去调试」这个用途等于
 * 没开，却又实实在在把整个应用暴露了——三种结果里最糟的那个，所以按未启用处理。
 *
 * 端口下限取 1024：1024 以下需要特权，dev 场景不会用，写死可以顺手挡掉手滑输入。
 *
 * Parse the raw env value. null means disabled. Zero is deliberately rejected: Chromium would
 * pick a random port recorded only in DevToolsActivePort, so the caller cannot reach it — all
 * of the exposure with none of the debuggability. The 1024 floor rejects privileged ports,
 * which this dev-only path would never legitimately want.
 */
export function parseDevtoolsCdpPort(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '0' || trimmed === 'false') return null;
  if (trimmed === '1' || trimmed === 'true') return DEFAULT_DEVTOOLS_CDP_PORT;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) return null;
  return parsed;
}

/**
 * 两道闸的最终判定：**必须同时满足**才启用。
 *   1. 非打包（dev）；
 *   2. 显式设了合法的 DREAM_DEVTOOLS_CDP_PORT。
 *
 * 闸 1 刻意放在闸 2 之后判断顺序无关，但**不能**改成「或」：这条通道是应用级、无 per-target
 * ACL、无认证的，一开就把每个 WebContents（含挂着 preload 桥的主窗口）都交出去，任意本机
 * 进程都能驱动整个应用。当初它被整个删掉就是因为默认常开。
 *
 * Both gates must hold. Never turn this into an OR: the switch is application-wide with no
 * per-target ACL and no authentication, handing every WebContents — including the main window
 * with its preload bridge — to any local process. It was deleted outright precisely because it
 * used to default to on.
 */
export function resolveDevtoolsCdpPort(options: { isPackaged: boolean; env: string | undefined }): number | null {
  const requested = parseDevtoolsCdpPort(options.env);
  if (requested === null) return null;
  if (options.isPackaged) return null;
  return requested;
}
