/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVTOOLS_CDP_PORT, parseDevtoolsCdpPort, resolveDevtoolsCdpPort } from '@process/utils/devtoolsCdp';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/**
 * 这条通道是应用级、无 per-target ACL、无认证的：一开就把每个 WebContents（含挂着 preload
 * 桥的主窗口）交给任意本机进程。它当初被整个删掉，就是因为**默认常开**。
 *
 * 所以下面这组断言不是「覆盖率」，是这段能力被允许存在的前提本身。任何一条变红都意味着
 * 正式版可能被打开远程调试，不是测试写错了。
 *
 * The switch is application-wide, unauthenticated, and has no per-target ACL — it hands every
 * WebContents, main window included, to any local process. It was deleted outright because it
 * used to default to on. These assertions are the precondition for letting it exist again: a
 * red one here means a packaged build can be remotely driven, not that the test needs updating.
 */
describe('developer app-wide CDP gate', () => {
  describe('gate 1 — packaged builds refuse unconditionally', () => {
    it.each(['9230', '1', 'true', '45678'])('refuses in a packaged build even when env is %s', (env) => {
      expect(resolveDevtoolsCdpPort({ isPackaged: true, env })).toBeNull();
    });

    it('enables the very same values in a dev build', () => {
      // Paired with the case above on purpose: it proves the refusal comes from isPackaged
      // and not from the value being rejected for some unrelated reason.
      expect(resolveDevtoolsCdpPort({ isPackaged: false, env: '9230' })).toBe(9230);
      expect(resolveDevtoolsCdpPort({ isPackaged: false, env: '1' })).toBe(DEFAULT_DEVTOOLS_CDP_PORT);
    });
  });

  describe('gate 2 — off unless explicitly requested', () => {
    it('stays off when the env var is absent', () => {
      expect(resolveDevtoolsCdpPort({ isPackaged: false, env: undefined })).toBeNull();
    });

    it.each(['', '   ', '0', 'false'])('stays off for the disabling value %j', (env) => {
      expect(resolveDevtoolsCdpPort({ isPackaged: false, env })).toBeNull();
    });
  });

  describe('port parsing', () => {
    it('accepts an explicit port', () => {
      expect(parseDevtoolsCdpPort('9231')).toBe(9231);
      expect(parseDevtoolsCdpPort(' 9231 ')).toBe(9231);
    });

    it('maps the truthy switch forms to the default port', () => {
      expect(parseDevtoolsCdpPort('1')).toBe(DEFAULT_DEVTOOLS_CDP_PORT);
      expect(parseDevtoolsCdpPort('true')).toBe(DEFAULT_DEVTOOLS_CDP_PORT);
    });

    /**
     * 0 是最糟的那种「开了但用不了」：Chromium 会挑一个随机端口，只写进 DevToolsActivePort
     * 文件，调用方拿不到号——暴露照样发生，调试却做不成。必须按未启用处理。
     *
     * Zero is the worst kind of half-on: Chromium picks a random port recorded only in
     * DevToolsActivePort, so the exposure happens but the debugging does not.
     */
    it('rejects 0 rather than letting Chromium pick an unreachable random port', () => {
      expect(parseDevtoolsCdpPort('0')).toBeNull();
    });

    it.each(['-1', '80', '1023', '65536', '99999', 'abc', '9230.5', 'NaN'])('rejects the invalid value %j', (env) => {
      expect(parseDevtoolsCdpPort(env)).toBeNull();
    });
  });

  /**
   * 判定逻辑住在纯模块里，唯一目的就是可测；但真正把开关挂上 Chromium 的是
   * configureChromium.ts。下面几条读源码，确保那边没有绕开判定、也没有把回环地址放开。
   *
   * The decision lives in a pure module so it can be tested, but configureChromium.ts is what
   * actually attaches the switch. These read the source to make sure it did not bypass the
   * decision or widen the bind address.
   */
  describe('wiring in configureChromium', () => {
    const source = read('packages/desktop/src/process/utils/configureChromium.ts');

    it('derives the port from the shared gate rather than reading env directly', () => {
      expect(source).toContain('resolveDevtoolsCdpPort({');
      expect(source).toContain('isPackaged: app.isPackaged');
    });

    it('only appends the Chromium switch when the gate returned a port', () => {
      expect(source).toContain(
        "if (devtoolsCdpPort !== null) {\n  app.commandLine.appendSwitch('remote-debugging-port', String(devtoolsCdpPort));"
      );
    });

    /**
     * 绑定地址一旦变成 0.0.0.0，暴露面从「本机任意进程」扩大到「局域网任意机器」，而且是
     * 静默的——没有任何报错。所以把它钉死在这里。
     *
     * If the bind address ever became 0.0.0.0 the blast radius would silently widen from any
     * local process to any machine on the LAN, so pin it.
     */
    it('pins the debugging bind address to loopback', () => {
      expect(source).toContain("appendSwitch('remote-debugging-address', '127.0.0.1')");
      expect(source).not.toContain("appendSwitch('remote-debugging-address', '0.0.0.0')");
    });

    it('does not allow every origin through the CDP websocket handshake', () => {
      expect(source).not.toContain("appendSwitch('remote-allow-origins', '*')");
      expect(source).toContain('remote-allow-origins');
    });
  });
});
