@AGENTS.md

## 项目定位

**dream-ui** 是 **One Work** 平台的桌面客户端（Electron + React）与 WebUI 前端。本项目最初基于开源项目 [AionUi](https://github.com/iOfficeAI/AionUi) 二次开发，**现已完全独立成自有平台，不再跟随或合并上游**——这是一次永久的技术身份切换，技术与协议层统一使用小写前缀 `dream`。

> **代码溯源**：本仓库 2026-08-23 从旧仓库 `D:\aionui-m0\1oneUI`（原始最上游是开源项目
> [AionUi](https://github.com/iOfficeAI/AionUi)）**原样复制的一次性快照**，不含 `.git`
> 历史。如果在本仓库里发现某个功能/文件"应该存在但找不到"，先去 `D:\aionui-m0\1oneUI`
> 翻一下——很可能是快照时点之后才在旧仓库落地的，或者是旧仓库里还没合并进 `one-main`
> 主干的分支。`D:\aionui-m0` 三仓（`1oneUI`/`1oneCore`/`aionrs-local`）定位是只读归档，
> 不再往里提交新代码——但**它们仍然是本机长期在用的真实 dev 环境**，不是废弃可随意覆盖的
> 东西，跑本仓库的打包/安装测试前务必先看下一条。

> **⚠️ dev/打包测试前必读**：`D:\aionui-m0\1oneUI` 和本仓库曾经共享同一个本地 dev 数据库
> （`getDevAppName()` 复制时把目录名字面量也带过来了），导致 dream-core 的新迁移把
> 1oneUI 那边跑了数月的真实测试数据往前推了版本、打不开。已修复（dev 模式默认目录名从
> `1one-Dev`/`1one-Dev-2` 改成了 `dream-ui-Dev`/`dream-ui-Dev-2`，天然隔离）。
> **3.0.0 起正式版 userData 目录从 `%APPDATA%\1ONE Code` 改成了 `%APPDATA%\One Work`**
> （`PROD_USERDATA_APP_NAME`；首启 `migrateAndResolveProdUserDataDir` 把旧目录 rename 过去）——
> 装过 1oneUI 正式版（它写 `1ONE Code`）的机器上打包安装 dream-ui 3.0.0，会把 1oneUI 的
> `1ONE Code` 目录搬成 `One Work`，务必谨慎。完整事故记录见
> [session-2026-08-24-dev-userdata-collision.zh-CN.md](./docs/guides/session-2026-08-24-dev-userdata-collision.zh-CN.md)。

> **新会话/新 AI 首读**：AionUi → dream 品牌独立化的完整实施过程（怎么做的、改了哪些文件、
> 过程中发现并修复的真实 bug、踩过的坑）记录在
> [session-2026-08-23-dream-rebrand-data-migration.zh-CN.md](./docs/guides/session-2026-08-23-dream-rebrand-data-migration.zh-CN.md)。
> 本 CLAUDE.md 只保留长期有效的规则和结论，"怎么做到的"这类过程性细节请去读那份文档，
> 不要假设这里的摘要已经足够完整。

## 三仓架构

| 仓库                                                         | 角色                                    | 关键产物                                         |
| ------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------ |
| **dream-ui**（本仓库）                                       | Electron 桌面、React UI、WebUI 静态资源 | 安装包（`One-Work-<version>-<os>-<arch>.<ext>`） |
| **[dream-core](https://github.com/gaogg521/dream-core)**     | Rust 本地服务，30+ 领域 crate           | `dreamcore` 二进制                               |
| **[dream-engine](https://github.com/gaogg521/dream-engine)** | Agent 引擎（CLI/TUI/Provider/工具）     | `dream` 二进制，随 dream-core 构建流程内嵌       |

推荐开发时三仓并列：

```text
dream/
├── dream-ui/      ← 本仓库
├── dream-core/
└── dream-engine/
```

三仓已各自独立发布凭据、CI、发布源，不指向上游组织。改了 dream-core 的 Rust 代码后必须重编 `dreamcore` 并让本仓库 bundled 目录同步更新才生效；改了 dream-engine 需要先推 dream-engine，再在 dream-core 对齐依赖版本。详见 [开发者上手指南](./docs/guides/fork-dev-onboarding.zh-CN.md)。

## 品牌与技术身份分层

| 层级                     | 值                                                                                                                                     | 说明                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户可见产品名           | **One Work**（首字母大写、中间有空格）                                                                                                 | UI、安装器、官网、帮助文档统一用这个；来源 `common/platform/index.ts` 的 `BRAND_DISPLAY_NAME` 常量，禁止散写字面量。**这个名字容易被口头/打字误传成 "OneWork"、"ONE WORK" 等变体，改动前务必以这个常量的实际值为准，不要凭记忆或口述**                                                                                                                                      |
| 技术/协议前缀            | **`dream`**（小写）                                                                                                                    | 环境变量 `DREAM_*`、内部 HTTP 头 `x-dream-*`、Cookie `dream-session`/`dream-csrf-token`、Rust 枚举 serde 值等机器可读标识                                                                                                                                                                                                                                                   |
| 运行时身份（**冻结**）   | `appId: com.huanle.oneone.ai`                                                                                                          | Squirrel.Mac 自动更新按 `CFBundleIdentifier` 匹配包、Windows 卸载注册表 GUID 由它派生、签名证书 team 也绑它。改了 = 老用户自动更新全断。它不是用户可见品牌名，永久保持                                                                                                                                                                                                      |
| 曾冻结、后已改     | `executableName`（`1onecode` → 删除回落 `One Work` → 本次定为 `onework`，进程/安装目录无空格，品牌显示仍是 One Work）、`PROD_USERDATA_APP_NAME`（`1ONE Code` → `One Work`）               | `executableName` 决定 `.app`/DMG/Win exe/Win 安装目录名——改它对数据零风险（userData 靠 `app.setName` 另钉）。userData 目录名改动配了首启迁移 `migrateAndResolveProdUserDataDir`（旧目录存在就 rename，失败就就地用旧目录）。详见 [session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md](./docs/guides/session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md) |
| 已改名、旧值仅作兼容保留 | 深链 `dream://`、浏览器 partition `persist:one-browser`、内置 MCP `one-image-generation` / `one-browser`、存储文件名与 localStorage 键 | 2026-08-26 起的统一做法：**新装用新值，存量安装靠「新值不存在就用旧值」的解析继续工作，一个文件都不搬**。深链两个 scheme 都向 OS 注册、`parseDeepLinkUrl` 两个都认；⚠️ 后端 `sanitize_deep_link_scheme` 必须**先**放行新 scheme，否则它会把不认识的值 fallback 回 `aionui`，SSO 回调被静默丢弃                                                                              |

**任何改动收尾前过一遍品牌复检**：i18n 显示文案 / 渲染层与主进程硬编码 / 安装器脚本（`resources/windows/**`）/ 任务栏与窗口标识（`app.setAppUserModelId`） / 系统托盘 tooltip。品牌名只有一个来源（`BRAND_DISPLAY_NAME`），新增用户可见文案一律 import 它，不要新写字面量。**本仓库、README、GitHub 上显示的内容三者可能不同步**——本地改完必须 `git commit` + `git push` 才会反映到 GitHub，改完只在本地验证过不等于对外可见，收尾前务必确认已推送。

## 持久化线上取值改名的铁律

数据库枚举列、JWT claim、内部协议头这类**跨版本持久化或跨进程约定**的字符串，改名必须做兼容层，否则会破坏历史数据或跨仓协作：

- Rust 枚举变体改名：`#[serde(rename = "新值", alias = "旧值")]`，新值是当前的规范线上值，旧别名保证历史数据/旧客户端仍可解析。
- 哈希派生的稳定 ID（如 `AgentType::id()`）：改名前检查是否有代码把它当稳定值写死进种子数据或断言，若有需要在 `id()` 里对该分支硬编码冻结旧哈希，不能让改名连带改变 ID。
- 跨仓协议（如内部 HTTP 头名）：两侧必须同步改，只改一边会让功能在运行时悄悄失效而不报错。
- 纯前端内部约定（组件内部变量名、event emitter channel 名等，从不持久化、也不跨进程）可以直接改，不需要兼容层。
- 改完只看 `cargo check`/`tsc` 不够——很多类似 bug 是运行时字符串比较，编译期看不出来，必须跑测试或真机验证。

## 开发与验证

```powershell
cd dream-ui
bun install
bun run dev              # 只改前端
```

改了 dream-core 后端：

```powershell
cd dream-core
cargo build -p dream-core-app --release
$env:DREAM_BACKEND_LOCAL_PATH = '..\dream-core\target\release\dreamcore.exe'
node scripts/prepareAioncore.js
```

测试：`bun run vitest run`（或跑单个文件加快迭代）。后端全量测试建议用 `cargo nextest run --workspace`（比 `cargo test --workspace` 快很多，本机实测快 10 倍以上）。

## 文档索引

| 文档                                                                                                                                       | 说明                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md](./docs/guides/session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md) | Mac 包"已损坏"根因（`IDENTITY` secret 带 `Developer ID Application:` 前缀 → 签名失败 → `--prepackaged` 兜底发未签名包 → CI 假绿）+ build 脚本自动剥前缀 / 兜底不再假绿 / CI 签名失败硬红；`1onecode`（executableName）与 `1ONE Code`（PROD_USERDATA_APP_NAME）作为历史品牌名的清除方案（首启目录迁移，`appId` 不动）      |
| [session-2026-09-01-aion-residue-cleanup-and-onework-rename.zh-CN.md](./docs/guides/session-2026-09-01-aion-residue-cleanup-and-onework-rename.zh-CN.md) | **最新**：aion 残留全量清理（P4 映射表漏了小写 `aioncore` 是残留主因）+ `executableName: onework`（进程/安装目录无空格，NSIS patcher 需兼容已打旧补丁的 node_modules）+ moltbook 移除 + 外部契约逐项判定（hub 目录来自上游 iOfficeAI/AionHub 打包时下载，本地改了会被覆盖 → 保留并记录自建步骤）；顺手修 cron `resolve_model` 旧值比较、Dockerfile/compose 旧环境变量名、自动更新默认仓库指向上游三个真实 bug。运行时契约全走「新值写入 + 旧值兼容读」。 |
| [session-2026-08-27-media-endpoint-fallback.zh-CN.md](./docs/guides/session-2026-08-27-media-endpoint-fallback.zh-CN.md)                   | 视频生成"有几率报错"根治（从旧仓继承而来）、协议猜错时自动换兄弟协议重试 + 发送前预警、AGNES 视频两个互相掩盖的 bug（目录缺条目 + 驱动读错 URL 字段）、CDP 真机验证做法与主进程 HMR 假阳性、oxlint 规则名错导致 lint 门禁罷工、费用显示开关 + 分辨率分档计价、上下文指示器对 dream 会话空白的跳仓修复、企业公司渠道写回会被同步抹掉 |
| [session-2026-09-02-media-seedream-gateway-and-seedance-audio.zh-CN.md](./docs/guides/session-2026-09-02-media-seedream-gateway-and-seedance-audio.zh-CN.md) | 把 08-27 视频侧的「协议自动回退 + 写回 + 发送前预警」补到**图片 seedream** 挂中转网关（原 §7 说不做、理由写错了——两条都是 Form A，回退在单个 Form A adapter 内就地做）；独立 BUG：`clipParamsToSpec` 从来没透传 `generateAudio`，中转网关路径的视频永远无声（火山直连默认有声、不受影响）——补 take + `ark-seedance` 默认开启音频，`seedanceGatewayDriver` 随之下发 `generate_audio`；`arkDriver` 不动；本轮未做 CDP 真机（靠整包 build + 真实模块单测 + 代码追踪替代） |
| [session-2026-08-26-media-output-and-brand-cleanup.zh-CN.md](./docs/guides/session-2026-08-26-media-output-and-brand-cleanup.zh-CN.md)     | 媒体产物错位根因（跨语言 env 契约被单边改名）、产物改落 `工作区/outputs/`、正文媒体预览、目录改名的读取回退策略                                                                                                                                                                                                                     |
| [session-2026-08-25-openrouter-trial-model.zh-CN.md](./docs/guides/session-2026-08-25-openrouter-trial-model.zh-CN.md)                     | 一键体验免费模型（OpenRouter trial key），跨 dream-ui/dream-core/新建的 dream-trial-broker 三仓，含未完成事项                                                                                                                                                                                                                       |
| [session-2026-08-23-dream-rebrand-data-migration.zh-CN.md](./docs/guides/session-2026-08-23-dream-rebrand-data-migration.zh-CN.md)         | AionUi→dream 品牌独立化的持久化数据迁移详细过程、真实 bug 清单、验证记录                                                                                                                                                                                                                                                            |
| [fork-dev-onboarding.zh-CN.md](./docs/guides/fork-dev-onboarding.zh-CN.md)                                                                 | 克隆、dev、打包、Release                                                                                                                                                                                                                                                                                                            |
| [ai-handoff-conventions.zh-CN.md](./docs/guides/ai-handoff-conventions.zh-CN.md)                                                           | 改完必写文档 + 前后端加载                                                                                                                                                                                                                                                                                                           |
| [repository-independence.zh-CN.md](./docs/guides/repository-independence.zh-CN.md)                                                         | 脱离上游 fork 网络的历史决策记录                                                                                                                                                                                                                                                                                                    |
