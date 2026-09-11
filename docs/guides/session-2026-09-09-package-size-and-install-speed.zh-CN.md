# 安装包瘦身 + 安装速度（2026-09-09）

> **起因**：用户反馈「onework 包体臃肿，安装至少 5 分钟以上，同类产品比我们快很多」。
> 本轮只处理**体积**和**解压耗时**两件事；签名 / SmartScreen / Defender 三条是用户明确
> 划走不做的（见 §7 的保留意见）。

本轮提交：

| 仓库           | 提交      | 内容                                                           |
| -------------- | --------- | -------------------------------------------------------------- |
| **dream-core** | `53a6f83` | 不再打包上游原生 claude/codex 二进制（`cli/`）                 |
| **dream-ui**   | `ba61096` | 渲染层专属依赖 / locale / better-sqlite3 编译产物出包          |
| **dream-ui**   | `9db2699` | 开差分更新；locale 改为对齐 13 种 UI 语言；`useZip` 评估后否决 |
| **dream-ui**   | `93de360` | 顺带修的既有 bug：媒体工作目录的别名 require                   |
| **dream-ui**   | `e69e1d1` | 自查修复：blockmap 走通 CI；arm64 保住 zip 载荷                |

`53a6f83` 已含在 `v0.1.71-one.4`，dream-ui 3.0.4 pin 的正是它 —— **`cli/` 的 696 MB 已经
随 dreamcore 真实生效**（2026-09-11 复测本地 bundle：1,578.8 → 883.7 MB，`cli/` 目录已不存在）。

---

## 1. 优化前的实测拆解（win32-x64）

安装包 **462.4 MB** → 安装后 **2,279.9 MB / 10,053 文件**。

```
resources/bundled-dreamcore        1,578 MB   ← 69%
  ├─ managed-resources/cli           696 MB   codex.exe 325 + claude.exe 306 + code-mode-host 51
  ├─ managed-resources/acp           671 MB   codex-acp 403 + claude-agent-acp 268
  ├─ managed-resources/node           98 MB   node.exe 85.7 + npm 11.5
  └─ dreamcore.exe                   114 MB
app.asar                             285 MB   内含 334 MB 未打包的 node_modules
app.asar.unpacked                     90 MB
Electron 运行时                      ~327 MB
```

**8 个文件占了 1,494 MB。** 这个拆解是后面所有决策的依据 —— 先量再动，不要从"哪个包看起来大"
入手。

---

## 2. 删掉 `cli/`（`53a6f83`，−696 MB）

`prepare-managed-resources` 同时准备两套 agent 运行时：`acp/`（`factory/acp.rs` 真正 spawn 的
包装层）和 `cli/`（上游的原生二进制）。**只有前者可达**：

- `crates/dream-core-runtime/src/acp_tool_runtime/mod.rs` 的模块注释写着 `managed_cli` 自
  2026-07-29 同步起就是 dormant 的；
- 全仓 `resolve_bundled_cli` 的**非测试调用点为 0**，只有 `lib.rs` 一行 re-export；
- 两份 `codex.exe` **SHA256 完全一致**（`4b76ded0…9eb956a7`），325 MB 装了两遍。

唯一要求它存在的是 `validate_contract`，而它**只在打包期跑**，运行期没有任何调用点。所以
`REQUIRED_CLI_NAMES` 改成空数组而不是删字段：`clis` 保留在契约里、逐条校验不变，用户数据
缓存里的旧 manifest 仍能解析。`runtime_key` 改从 `acpTools[].platformDirectory` 取（同样带
「必须等于 runtimeKey」不变量），跨架构打包不受影响。

`dream-ui/packages/shared-scripts/src/verify-bundled-dreamcore-resources.js` 的
`REQUIRED_MANAGED_CLI_NAMES` 同步清空 —— 两个常量必须保持一致。

---

## 3. 渲染层专属依赖不进包（`ba61096`，−119.3 MB）

`electron.vite.config.ts` 的 renderer 段**没有** `externalizeDepsPlugin`，Vite 把 mermaid /
@arco-design / pdfjs-dist / cytoscape / @shikijs 等全部编译进 `out/renderer/assets`；
node_modules 里那份是第二份、不可达的副本。

**做法是减法不是白名单**：main 进程用了 `externalizeDepsPlugin`，凡是它 require 的包都必须
继续随包发布，写白名单删错一个就是启动即 `Cannot find module`。所以逐个验证「在
`packages/desktop/src/renderer/` 之外引用数为 0」才排除，`react` / `react-dom` 刻意不在列表里
（`@dream/web-host` 被 bundle 进主进程）。

内置 MCP 不受影响：`scripts/build-mcp-servers.js` 用 `bundle: true` + `external: ['electron']`
产出完全自包含的 CJS，运行时不 require 任何 node_modules。

---

## 4. better-sqlite3 编译产物（`ba61096`，−43.1 MB）

`.iobj` 13.6 + `.ipdb` 3.0 + `sqlite3.lib` 6.6 + `build/Release/obj/`（含 9.1 MB 的
`sqlite3.c`）+ `deps/` 9.8 —— 运行时只加载 1.8 MB 的 `better_sqlite3.node`。

**放在 `afterPack` 里剪，不是 `files:` 排除**：prebuild-install 没有匹配当前 Electron ABI 的
预编译件时，node-gyp 要靠 `src/` + `deps/` 现编，打包期排除会把一条能用的兜底路径变成构建
失败。剪完有字节级断言 —— `bindings` 按固定路径找 addon，丢了就是
`Could not locate the bindings file`，用户看到的是**会话历史打不开**（数据其实完好）。

`9db2699` 补齐了 GCC/Clang 的产物名（`obj.target`、`.a`、`.o`）—— 在那之前 macOS / Linux
只剪掉了约 10 MB。

---

## 5. locale 裁剪（`ba61096` → `9db2699` 修正，−35.1 MB）

Chromium 自己的 UI 字符串（右键菜单、拼写检查、输入法候选框），不是 app 的 i18n。
55 个 pak / 44.2 MB → 13 个 / 9.1 MB。

**这条改了两次，第一版是错的**：

1. 第一版手写 `afterPack` 裁剪，只留 en-US / zh-CN / zh-TW，且 `if (darwin) return` 跳过 Mac。
2. 修正版改用 electron-builder 内置的 `electronLanguages`：
   - 它在 **framework 准备阶段、签名之前**执行，并同时处理 `locales/*.pak` 和 macOS 的
     `.lproj` —— **Mac 第一次拿到这份收益**；
   - 保留数量对齐 `i18n-config.json` 的 `supportedLanguages`（13 种）。只留 3 个意味着
     日 / 韩 / 俄 / 德 / 法等 10 种语言的用户会看到「界面是母语、右键菜单是英文」。

⚠️ **匹配规则反直觉**：它拿 **wanted** 去比对 **文件名**，条目必须等于或比文件名更具体。
`ja-JP` 能保住 `ja.pak`（前缀匹配），但**光写 `en` 会删掉 `en-US.pak`**。macOS 的区域
`.lproj` 用下划线（`zh_CN.lproj`），所以那三个区域条目连字符和下划线两种写法都列了。
`afterPack` 保留一条断言确认兜底 locale 还在 —— 这个选项匹配不到时只 warn 不 fail。

---

## 6. `useZip` 评估后否决（`9db2699`）

把 NSIS 载荷从 solid 7z/LZMA 换成 zip，用安装包体积换解压速度。**实测后否决**：

| 载荷                | 安装包   | 解压 1.39 GB 耗时（`7z t -mmt=1`） |
| ------------------- | -------- | ---------------------------------- |
| `app-64.7z`（LZMA） | 288.1 MB | **21.7 s**                         |
| `app-64.zip`        | 458.6 MB | **10.3 s**                         |

**11.4 秒换 +170 MB 下载**，盈亏平衡点约 15 MB/s（120 Mbps）持续下载速度。而本轮瘦身本身
已经把这一步从约 36 秒降到 21.7 秒 —— **这个优化在载荷 2.28 GB 时值钱，降到 1.39 GB 后不值了。**

测量数据写进了 `electron-builder.yml` 的注释，避免下次有人凭直觉再来一遍。

---

## 7. 差分更新（`9db2699` + `e69e1d1`）

`nsis.differentialPackage: true`，electron-updater 只拉变化的块而不是每次整包。原值 `false`
是从 1oneUI 快照继承的，仓库里没有记录理由。

**代价**：安装包 288.1 → **340.4 MB（+52.3 MB）**，因为载荷归档不能再是 solid 的。对一个
更新频繁的产品，用首装 +52 MB 换每次更新省 250~300 MB 是划算的。

**链路上有三个必须同时成立的点**，缺一个就静默退化成全量下载：

1. `prepare-release-assets.sh` 采集 `*.blockmap`，**缺失时让发布硬失败**；
2. blockmap 必须和安装包一起落在 `releases/<version>/` —— `CdnGenericProvider.resolveFiles`
   注入 `{version}/` 前缀，而 electron-updater 是在**已解析的**安装包 URL 后面加 `.blockmap`，
   所以天然对得上；
3. `_build-reusable.yml` 的 `upload_installers_only` 输入会删 blockmap，已标注不可用于发布。

**arm64 例外**：`useZip` 与 `differentialPackage` 在 `NsisTarget` 里互斥
（`!isBuildDifferentialAware && options.useZip`）。arm64 一直刻意用 zip 载荷，理由仓库里没有
记录（同样来自 1oneUI 快照），合理猜测是 `nsis7z.dll` 在 arm64 模拟下的兼容问题。**在不知道
理由的情况下不改别人刻意的配置** —— arm64 单独传 `--config.nsis.differentialPackage=false`
保住 zip，只有 x64 吃差分，blockmap 校验也只查 x64。
（`electron-builder` 的 `coerceValue` 会把字符串 `"false"` 转成布尔 `false` 并对 `config.nsis`
生效，这条覆盖是真起作用的 —— 已查证，不是假设。）

---

## 8. 顺带修的既有 bug（`93de360`）

核查产物时发现 `out/main/index.js` 里有一处 `require("@process/utils/initStorage")`。
**Rollup 只重写静态 import 里的路径别名，`require()` 里的原样留着** —— 所以打包后这个
require 必抛，外层 try/catch 吞掉，`fallbackWorkspaceDir()` **每次都恰好退回
`process.cwd()`**，而这个函数存在的唯一目的就是不要用 `process.cwd()`。生产里从未生效过。

**修法踩了一次坑**：先改成静态 import，结果打挂了 `mediaMcpServer.integration` 整个 suite ——
`initStorage` 会把 `ipcBridge` 拉进 eager 图，那个测试只 mock 了一半。而**函数自己的文档注释
里早就写明了这一点**（「Resolved lazily rather than by a top-level import: `initStorage` drags
the whole settings/bridge graph in with it」），只是那段注释漂到了函数上方 80 行外。

最终用动态 `import()`：Rollup 解析别名（编译成
`await Promise.resolve().then(() => initStorage$1)`，直接引用已打包模块，零运行时开销），
依赖也留在 eager 图外。唯一调用点本来就在 async 函数里。

**两道防线**（这个 bug 的特征是静默）：`build-with-builder.js` 在主 bundle 残留别名 require
时让构建失败；`tests/unit/build-scripts/noAliasedRuntimeRequires.test.ts` 在源码层拦截，比构建
更早。扫描前会屏蔽注释（保留字符偏移，行号不错位），否则连讲这个反模式的注释都会被误伤。

---

## 9. 自查抓到的两个自伤 bug（`e69e1d1`）

改完后做整体自查，查出两个**本轮自己引入**的问题，都是"看着绿其实要炸"：

**9.1 下一次发布必断。** `_build-reusable.yml` 的 artifact 上传 `path:` 是**显式枚举**，没有
`out/*.blockmap`。差分更新生成的 blockmap 在 build → release 之间被丢掉，而 §7 那条硬校验
又要求它存在 —— 实证：完整 mock 产物下 `prepare-release-assets.sh` 退出码 **1**。

漏过去的原因值得单独记：**仓库里唯一跑这个脚本的端到端测试是负向的**（故意删掉 mac zip、
断言退出码非 0），我新增的失败只是叠加上去，两条断言照样成立。已补正向测试
`succeeds on a complete set of release artifacts`（断言退出码 0 且输出无 `::error::`）。

**9.2 arm64 静默丢 zip 载荷** —— 见 §7 的 arm64 例外。

---

## 10. 效果

|                   | 优化前                   | 优化后         | 变化                    |
| ----------------- | ------------------------ | -------------- | ----------------------- |
| 安装后（win x64） | 2,279.9 MB / 10,053 文件 | **1,387.2 MB** | **−892.7 MB（−39.2%）** |
| 安装包（win x64） | 462.4 MB                 | **340.4 MB**   | **−122 MB（−26.4%）**   |
| 载荷解压          | ~36 s                    | **21.7 s**     | −14 s                   |
| 更新下载量        | 每次整包                 | 仅变化块       | —                       |

分项：`cli/` −696、渲染层依赖 −119.3、better-sqlite3 −43.1、locale −35.1，合计 −893.5，与
实测总差 −892.7 吻合在 1 MB 以内。

**平台覆盖**：

| 措施           | Windows   | macOS             | Linux |
| -------------- | --------- | ----------------- | ----- |
| 删 `cli/`      | ✅        | ✅                | ✅    |
| 渲染层依赖     | ✅        | ✅ **量完全相同** | ✅    |
| locale         | ✅        | ✅                | ✅    |
| better-sqlite3 | ✅        | ✅                | ✅    |
| 差分更新       | ✅ 仅 x64 | ❌ NSIS 专有      | ❌    |

---

## 11. 接手须知

- **Mac / Linux 的具体数字没有实测。** 本地只有 win32 产物，改动是配置层的，靠读
  electron-builder 实现 + 推理确认。三个平台首次打包后应各量一次。
- **差分打包的安装包没有实际装过一遍**（装了会覆盖开发机上的正式版）。**发版前建议手动
  冒烟安装一次**；差分更新链路本身要两个已发布版本才能跑通。
- **安装慢的最大头可能仍在**：本轮只解决了解压（36 s → 21.7 s）和 39% 的磁盘写入量。
  当时的分析是未签名导致的 SmartScreen + Defender 深扫很可能才是那 5 分钟的主要构成 ——
  `onework.exe` / `dreamcore.exe` / 安装包三者当时都是 `NotSigned`。用户本轮明确划走不做。
- **媒体产物落点变了**：`93de360` 之后走 `workDir` 而不是 `process.cwd()`。这是那个函数
  本来就该有的行为，但老用户散落在进程启动目录的旧文件不会自动迁移。
- **加任何新产物类型（blockmap / sig / 新 target）都要回去改
  `_build-reusable.yml` 的上传 `path:` 清单** —— 它是显式枚举，不加就静默消失。清单里那条
  `out/*-mac-*.zip` 的注释讲的是同一个坑的前一次发作。
- **给发布脚本加硬校验时，必须同时有正向测试**（完整产物应当成功且不输出 `::error::`），
  否则只有负向测试的地方会一直替你背书。
- **`node/` 目录不要为了瘦身裁 npm**：整个目录 98.5 MB 里 `node.exe` 自己就 85.7 MB，npm
  只有 11.5 MB；而 `resolve_managed_entrypoint` 找不到 npm 是直接 `Err`，且真机日志抓到
  `npm exec --yes -- chrome-devtools-mcp@latest` —— **MCP server 的安装就走这份 bundled npm**。
- **`out/` 常被别的程序锁住**（2026-09-09 实测是 ZCode 的文件监视打开了 `app.asar`）。
  症状是构建 EPERM、`buildWithBuilder.test.ts` 的 cleanup 失败并连带清掉 `out/main`。
  查持有者用 `rstrtmgr.dll` 的 Restart Manager（`RmStartSession` / `RmRegisterResources` /
  `RmGetList`），**别按进程名猜**；绕开可以用 `ONE_BUILD_OUT_DIR=<别的目录>` 重定向输出。
- **验证打包产物时 `APPDATA` 环境变量隔离不了 userData**：Electron 的
  `app.getPath('appData')` 走 `SHGetFolderPath`，跑打包产物就是在读写真实的
  `%APPDATA%\One Work`。要么先备份，要么只做只读观察。

---

相关：[发版 CI 假绿与 macOS Intel 失败根因](session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md)、
[AI 交接约定](ai-handoff-conventions.zh-CN.md)
