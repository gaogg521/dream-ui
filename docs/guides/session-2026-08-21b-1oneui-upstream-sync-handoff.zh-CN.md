# 2026-08-21（续）交接：1oneUI 136 提交上游同步已完成并推送

> 承接 [`session-2026-08-21-1onecore-upstream-sync-handoff.zh-CN.md`](session-2026-08-21-1onecore-upstream-sync-handoff.zh-CN.md)。
> 那份文档 §2.1 列的"1oneUI 135 提交同步——完全未开始，优先级最高"，本次会话已完成。

## 0. 一句话现状

| 仓       | 本轮结果                                                    | 状态      |
| -------- | ----------------------------------------------------------- | --------- |
| 1oneCore | 149 提交上游合并（上一份文档记录）                          | ✅ 已推送 |
| 1oneUI   | 136 提交上游同步（`80ddf89f9`→`e613573e1`），含真机回归修复 | ✅ 已推送 |

分支 `sync-v2178`（worktree `D:\aionui-m0\1oneUI-sync-full`）→ 合并提交 `e613573e1` → 直接
`git push origin sync-v2178:one-main`（本地 `one-main` 分支被主仓库另一个 worktree
`D:\aionui-m0\1oneUI` 占用，无法在这个 worktree 里 `git branch -f`，改用远端分支名映射
push，效果等价）。**`origin/one-main` 现在是权威、干净的最新状态。**

⚠️ 主仓库 worktree `D:\aionui-m0\1oneUI`（checkout 在 `one-main`）本地还停留在旧提交
`80ddf89f9`，且工作区里有一批与本次同步无关的脏文件（看着是某次发布脚本把
`C:\Users\...\Temp\...\build-artifacts\` 这类畸形绝对路径当相对路径 `git add` 进了索引，
含真实的 dmg/deb/tar.gz 二进制），**本次会话未触碰这批内容**（超出任务范围、来源不明、
贸然清理有风险）。下次要用那个 worktree 前，先 `git status` 看一眼、必要时
`git reset` 掉这批离奇路径的 staged 条目，再 `git pull --ff-only` 拉到 `e613573e1`。

---

## 1. 本次做完的事

### 1.1 合并本身

- worktree：`D:\aionui-m0\1oneUI-sync-full`，分支 `sync-v2178`，merge-base `80ddf89f9`，
  上游到 `upstream/main`（136 个提交，1393 个文件，+43584/-98129）。
- **169 处显式冲突**逐一 3-way 解决。判断原则：先看下游是否还在用（callers 数量）、
  是否有依赖的后端端点还存在（跨仓核对 `1oneCore/crates/...`）、`git log <commit> -s`
  找上游删除的官方理由、有既有决策记录时优先复用（如社区主题不采纳、providers 表共享
  作用域）。
- **六个架构分歧点全部守住，没被上游覆盖**：Codex/Claude 自定义模型桥接锁定（UI
  model-selector 在桥接开启时禁用切换）、CDP 调试端口（`AIONUI_DEVTOOLS_CDP_PORT`
  双闸门）、Streamdown 渲染引擎（mermaid pan/zoom + shiki，替代上游纯 `react-markdown`）、
  `AppUserModelID`/品牌单一来源机制（`BRAND_DISPLAY_NAME` + 锁死测试）、providers 表
  部署级共享（非按用户隔离）、fork 自己的 CDN（腾讯 COS）更新机制（非 GitHub API，
  因为 fork 仓库是私有的）。

### 1.2 3-way merge 静默删除 fork 独占内容——额外核出 13 个文件/功能

在 169 条显式冲突全部解完后，主动做了 `git ls-tree` vs `git ls-files` 的结构性审计
（不是被报错逼出来的，是按 `upstream-sync-backlog` 文档"零冲突≠安全"这条教训主动排查），
逐一核实取舍：

- **恢复**：7 个社区主题 CSS 文件 + 封面 + 注册表（此前会话已有"不采纳上游主题重构，
  保留 fork 自己主题系统"的明确决策）、Office 自动预览功能整套（`useAutoPreviewOfficeFiles`
  等，真机 UI/i18n/调用点都还在用）、目录选择+导出功能整套（`DirectorySelectionModal`/
  `useExport`——核实 `1oneCore/crates/aionui-file/src/routes.rs` 对应的 zip/rename/remove
  端点仍然存在，上游"已删除"的说法对 fork 不成立）、fork 自己的 legacy 配置迁移桥接
  （`importOneLegacyConfig.ts` → `migrateThemeConfig.ts` 两段式管线）。
- **确认可安全丢弃**：preview-history 功能（`renderHistoryDropdown()` 全仓零调用点）。

### 1.3 合并过程自造成约 50 处 tsc 错误 + 2 处 lint 解析错误——已全部修复

多次不精确的正则批量替换/按行号手工拼接导致的重复 JSX 属性、重复组件定义、丢括号/
丢闭合标签、缺 import、字段名过时（`truncated`→`oversized`）等，逐文件核对修复
（约 15 个文件，含 `SendBox/index.tsx`、`AcpSendBox.tsx`、`PreviewContext.tsx`、
`PreviewPanel.tsx`、`PreviewToolbar.tsx`、`MarkdownViewer.tsx`、`GroupedHistory/index.tsx`、
`MessageList.tsx` 等）。2 处测试文件的 lint 解析错误（`AcpModelSelector.dom.test.tsx`
丢了一个 `});`、`messageText.dom.test.tsx` 里 `vi.mock` 出现重复 key）也已修复。

**验证结果**：`bunx tsc --noEmit` 0 错误、`bun run lint` 0 错误（988 条既有警告，
基线本来就有，不算失败）、`bun run format:check` 通过、`bun run test` 4176 通过 /
1 失败 / 6 跳过——那 1 个失败（`tests/unit/enterprise/directoryTab.dom.test.tsx`）
用同一份测试文件直接跑在未改动的 pristine `one-main` 上复现了相同失败，**确认是
既有缺陷/flake，与本次同步无关**，未修（不在本次任务范围）。

### 1.4 真机 CDP 验证——发现并修复两个真实回归

方法：`AIONUI_BACKEND_BIN=<aioncore.exe路径> AIONUI_DEVTOOLS_CDP_PORT=9231 bun run dev`
（⚠️ **环境变量名已改**，见下方"新教训"），裸 `ws`/Node 原生 `WebSocket` 直连页面
target 跑 `Runtime.evaluate`，参照 [`cdp.md`](cdp.md) 的既有方法论。

- **回归①（白屏，本会话自己造成又自己修复）**：`DocumentTitle.tsx` 是上游新增文件，
  非登录路径的兜底品牌名硬编码成上游字面量 `'AionUi'`。第一次修复时直接
  `import { BRAND_DISPLAY_NAME } from '@/common/platform'`——但 `common/platform/index.ts`
  是**仅供主进程使用**的桶文件（顶层 `import path from 'path'` + 依赖
  `NodePlatformServices.ts` 里的 `child_process`），渲染层导入它会在模块顶层执行时
  抛 `Cannot access "child_process.fork" in client code`，整个 React 应用挂载前就崩溃、
  `#root` 永远 0 子节点。改为渲染层惯用的字面量写法（与 `Titlebar/index.tsx`、
  `Layout.tsx` 现有写法一致，渲染层从不 import 这个桶文件）后恢复正常。**教训**：
  `@/common/platform` 这个桶文件名字看着通用，实际有强烈的进程边界——渲染层要品牌名
  一律抄字面量，不要 import 它。
- **回归②（品牌泄漏，真实但影响面小）**：`ChannelModalContent.tsx` 里 Slack/Discord
  两个新渠道（本次同步新增的 upstream 功能）的描述文案 i18n key 兜底值写死了英文字面量
  `'AionUi'`，同一文件里其余五个渠道（telegram/lark/dingtalk/weixin/wecom）的兜底值
  都已经正确写成 `'One Work'`。核实所有 13 个语言的 `settings.json` 里
  `channels.slackDesc`/`channels.discordDesc` 翻译本身已经是正确的"One Work"——**正常
  使用不受影响**，兜底值只在 i18n 加载异常时才会显示，仍按其余渠道的写法统一改正，
  作为防御性加固。

### 1.5 品牌复检补丁——13 语言 × 2 文件、184 处英文品牌名残留（用户提醒后追加发现）

上面 1.4 节的两处回归修复完成、任务看似收尾后，用户追加提醒"一定要切记品牌的替换"，
促使又做了一轮更彻底的全 locale 扫描（此前的复检只是抽样几个模式，没有对全部 13 个
语言目录做完整 grep）。结果发现规模远超预期的残留：

- **`conversation.json`**（13 语言，各 5 处）：CLI 版本校验提示——"已安装的 {{cli}} 低于/
  高于 **AionUi** 验证过的版本"、"AionUi 正在等待重连" 这类文案，是上游这次同步带来的
  **全新功能**（CLI 版本兼容性检测），从未被品牌化。
- **`update.json`**（13 语言，9~10 处不等）：一整个**"来自 AionUi 团队的一封信"迁移
  公告弹窗**（`UpdateMigrationDialog.tsx` 对应的文案，账号体系/免费承诺相关的大段说明
  文字）——标题、称呼、落款、正文多处品牌名，同样是上游新功能，全 13 语言从未汉化/
  品牌化过，是这次追加扫描里最大的一块。

两者合计 **184 处**，用脚本对这 26 个文件做全字匹配替换（`AionUi` → `One Work`），替换
后逐文件 `JSON.parse` 校验通过、`node scripts/check-i18n.js` 通过（仅剩与本次无关的既有
295 条 unknown-key 警告）、`bun run format:check` 通过。土耳其语/德语等有格位后缀的语言
（如 `AionUi'yi`→`One Work'yi`、`AionUi-Team`→`One Work-Team`）保留了机械替换后的轻微
语法瑕疵，**与本项目此前 115 文件品牌重写脚本的既有先例一致**，不是本次新增的问题。

**这条教训比 1.4 节的两处更值得记住**：此前的"品牌复检"习惯性只扫渲染层/主进程源码
（`.tsx`/`.ts`），**很容易漏掉 locale JSON 里的大段说明性文案**——尤其是像"迁移公告信"
这种一次性大段落文本，字符串数量多、grep 起来噪音大（`grep -rn AionUi locales/` 第一次
因为漏了排除 `aionui.com` 而被我误判"没有异常"跳过细看），必须对**全部 locale 目录**做
一次不设范围假设的完整扫描，而不是抽查几个模式就收尾。

### 1.6 新教训：`AIONUI_BACKEND_LOCAL_PATH` 已改名为 `AIONUI_BACKEND_BIN`

本机 memory 里 `packaging-local-aioncore-path.md` 记的旧变量名在这次上游同步里失效了
（`out/main/index.js` 反编译确认现在读的是 `AIONUI_BACKEND_BIN`，`packages/desktop/src`
全仓搜不到 `AIONUI_BACKEND_LOCAL_PATH` 任何引用）。用旧变量名启动 dev 会让
`resolveBinaryPath()` 直接跳过 env override，报
`BackendStartupError: aioncore startup failed while resolving backend binary`。
下次要用本地编译的 aioncore.exe 跑 dev，记得用新名字。

---

## 2. 待办事项

### 2.1 上一份文档 §2.2/§2.3/§2.4 的四项——真机复核后结论更正，**不是全部完成**

⚠️ **本节初版结论有误，已更正**：初版只按符号是否存在（grep 到
`isRuntimeReady`/`TeamActivityView` 等）就判定四项全部完成，用户当场指出"要点开看
才能发现问题"，逐项真机复核后，四项里有**三项真凭实据、一项判断错误**：

- **团队模式（1oneUI #3893 对应能力）——✅ 真机确认**：进入既有团队会话，看板视图
  即 `TeamActivityView`（每列成员一份活动流，带最新/最早/仅消息/仅任务筛选器，
  真实数据渲染无报错）；leader 为 ACP 类型（Claude Code）的团队，模型选择器旁能
  看到圆形刷新图标即 `AcpRuntimeRestartButton`。两者截图均已核对。
- **媒体管线相对路径（#4103/#4105）——✅ 功能性验证通过**：现有会话历史里没有天然
  命中"agent 文本回复内嵌相对路径图片"这个具体场景（fork 自己的媒体生成走独立卡片
  UI，不用 markdown `![]()`），为避免真跑一次生成花钱，改为直接在真机 CDP 里动态
  import `common/chat/chatLib.ts` 的 `joinPath` 与 `common/index.ts` 的
  `ipcBridge.fs.getImageBase64`——这正是 `LocalImageView.tsx` 内部使用的完全相同
  两步逻辑——用真实 workspace 根目录 + 真实相对文件名（`media-project-probe` 项目
  下的 `img-1786014183663.png`）调用，成功读回 875906 字节、正确 PNG 头
  （`data:image/png;base64,iVBORw0K`）的 base64。证明该解析链路本身是通的。
- **单色 logo 跟随主题色（#3614）——⚠️ 部分验证，不能打包票**：`ThemedLogo.tsx`
  组件本身实现完整且正确（按 `.svg` 后缀 + 抓取内容含 `currentColor` 双重判定
  是否走 CSS mask 变色，检测失败一律安全回落成普通 `<img>`，不会破渲染），
  且确认被 `AgentCard.tsx`/`AssistantAvatar.tsx`/`ProviderLogo` 实际使用（后者
  在合并过程中我自己还修过一处传了组件不支持的 `loading`/`decoding` props 的
  bug）。**但**：批量抓取当前 dev 环境实际数据里的助手头像（已启用 42 个 + 专家
  市场 252 个）逐个检测，**没有一个命中真正声明 `currentColor` 的单色 SVG**——
  官方助手的 CLI 品牌图标都是彩色原版（本该保持彩色，不该被强制单色化，这是
  设计如此），专家市场素材是 PNG/emoji。切换深色/浅色主题时整页正常无报错无
  崩溃（截图对比），但**没能在这份数据集里亲眼看到"同一个图标随主题真的变色"
  这个动作**。结论：组件真实存在、接入正确、无渲染错误，但视觉效果本身受限于
  当前没有真正的单色素材，未能 100% 目视确认——如果后续要验，需要找一个后端
  serve 的、内容真含 `currentColor` 的 `.svg` 头像来测。
- **反馈邮箱字段（#4096）——❌ 判断错误，实际未实现**：打开设置页触发反馈弹窗
  （标题栏"反馈问题"按钮），表单里**没有任何邮箱输入框**。翻源码
  `FeedbackReportModal.tsx` 才发现真相：`readAccountEmail()` 只是**结构化读取已
  登录账号的 email**（注释原文："aionui's AuthUser is { id, username } and carries
  no email... yields undefined whenever the signed-in user has no email"），
  在未登录的个人版下恒为 `undefined`，**界面上从来没有让用户手填邮箱的 input**。
  这与上游 #4096 实际要的"表单里加一个可选邮箱字段"完全是两回事——共享了
  `contactEmail` 这个参数名，语义并不相同。**该项仍待做**：需要在
  `FeedbackReportModal.tsx` 里真的加一个 `Input` 供未登录用户手填联系邮箱，
  `submitFeedbackReport.ts` 的 `contactEmail` 参数已经现成，接上即可。

### 2.2 主仓库 worktree `D:\aionui-m0\1oneUI` 需要人工/下次会话清理

见 §0 的警告。清理方式建议：先确认那批畸形路径不是任何人需要的东西（看起来是
release 脚本的临时产物误入版本控制），`git reset` 撤销 staged，`git clean` 前
再三确认，然后 `git pull --ff-only` 拉到 `e613573e1`。

### 2.3 两个已用 `spawn_task` 标记的跨范围发现（本会话未处理，等用户认领）

- 媒体生成 `image_uris` 路径穿越漏洞（P0 安全问题）——merge 冲突解决过程中顺手发现，
  与本次同步无关，已建 task 卡片，未在本次修复。
- SkillsHub 上游 UX 重构（Tab 化 + 新的 `SkillFileBrowser.tsx`）——与 fork 自己的
  `source: 'team'` 团队技能分发功能冲突面较大，本次直接保留 fork 版本，上游重构
  作为独立跟进项标记，未采纳。

### 2.4 1oneCore 后端完整回归套件重跑——上一份文档遗留，与本次 1oneUI 工作无直接关系

上一份文档提到 `cargo test --workspace --no-fail-fast` 停在"34 个测试二进制、零失败"
未跑完，建议找机会补跑一次确认到底（预计 30–45 分钟）。这是 1oneCore 仓库的事，
本次会话只动了 1oneUI，未处理。

---

## 3. 关键技术教训索引

0. **品牌复检必须对全部 locale 目录做无范围假设的完整扫描，不能只抽查几个模式**——
   本次真正的大头（184 处，13 语言 × `conversation.json`/`update.json`）是被用户提醒
   后才追加扫描出来的，说明"复检"如果只覆盖源码文件、不对 `locales/**/*.json` 做
   一次完整 `AionUi` 全字匹配，会漏掉大段说明性文案（迁移公告信这类一次性长文本）。
   下次任何上游同步的品牌复检，locale 目录要作为独立的、必查的一类，而不是顺带查一下。
1. **渲染层永远不要 import `@/common/platform` 这个桶文件**——它虽然导出了
   `BRAND_DISPLAY_NAME` 这类看着"纯常量"的东西，但顶层依赖 Node 内建模块，渲染层
   import 会在模块加载阶段直接崩溃导致白屏。渲染层要品牌名，抄字面量（`'One Work'`），
   参照 `Titlebar/index.tsx`。
2. **`AIONUI_BACKEND_LOCAL_PATH` 已被上游改名为 `AIONUI_BACKEND_BIN`**——本机 memory
   记的旧名字已经过时，用错变量名 dev 环境会静默走"resolving backend binary"分支
   直接报错退出。
3. **"文档里说前端半成品"不代表"上游同步做完之后仍然是半成品"**——上一份文档记录
   §2.2/2.3/2.4 三项前端缺口时，1oneUI 的 135 提交同步还没开始；同步一旦做完，
   这些缺口大概率已经被覆盖在合并范围内，交接时应该先核实符号是否已存在，而不是
   默认沿用旧文档的"未完成"判断。
4. 与 1oneCore 那轮相同的教训依然成立：**3-way merge 能在零冲突标记的情况下删掉
   fork 独占内容**，"冲突解完"不等于"合并安全"，必须做结构性审计（`git ls-tree`
   对比）而不只是处理冲突列表。
