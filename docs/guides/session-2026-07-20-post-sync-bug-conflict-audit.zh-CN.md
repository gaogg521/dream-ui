# 上游同步（v2.1.37 / Core 0.1.48 / aionrs 0.2.5）合并后 BUG/冲突审查报告

> **2026-07-20**。针对 [`session-2026-07-19-upstream-sync-changelog.zh-CN.md`](session-2026-07-19-upstream-sync-changelog.zh-CN.md) 里合入的上游新功能，逐项核查是否与本 fork 既有的企业模块/自定义网关/品牌定制产生真实 BUG 或冲突。
>
> **方法**：三仓各一个独立静态代码审查（不改任何文件），共拆出约 16 个核查点。先跑了三仓 `<<<<<<<`/`=======`/`>>>>>>>` 冲突标记全量 grep（**零残留**），再逐项人工核查。**本轮全部是静态代码审查，未做真机/CDP 运行时测试**——涉及"需运行时验证"的点已在下面单独标出，还没有被验证。

---

## 结论摘要

**没有发现会阻断发布的真实 BUG。** 三仓合并质量总体干净：6 类 aionrs fork 专属补丁全部完整保留、1oneUI 企业设置 IA 和技能详情页手工移植都没有冲突残留、1oneCore migration 026-029 连续无冲突、aionrs pin 版本一致无漂移。

发现 **2 项需要动手处理的真实遗留**、**1 项建议补测试的脆弱点**、**1 项需要接手者知晓但不用恐慌的历史包袱**：

| #   | 严重度         | 内容                                                                                                                                           | 仓       |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | 待修复         | 品牌注入（`9504fa47`）遗漏了 4 个文件共 ~12 处 agent 会读回的 "AionUi" 错误字符串                                                              | 1oneCore |
| 2   | 建议加测试     | 看图白名单归一化启发式 `strip_edition_letter_before_version` 对形似 `minimax`/`deepseek-v4-flash` 的品牌名有误切逻辑缺陷，当前无真实碰撞但脆弱 | 1oneCore |
| 3   | 需运行时验证   | 拖拽排序过程中 `ResizeObserver`（侧栏弹性历史）是否会被误触发，静态分析看不出结果                                                              | 1oneUI   |
| 4   | 已澄清，非 BUG | `wip-enterprise-before-sync-v0148` stash 是完全独立、从未落地的休眠重构方案，不是"丢失的修复"，round25 生产代码原样健在                        | 1oneCore |

---

## 1. 1oneUI（`sync-2137`，六项核查）

| 核查点                                                                          | 结论                               | 证据                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 企业设置 IA（Router/SettingsSider/capabilities/企业 tab）是否被合并误删         | **NO ISSUE**                       | `Router.tsx:107` 路由健在；`SettingsSider.tsx:26` `BUILTIN_TAB_IDS` 含 `enterprise`；合并 commit `60cd183fa` 的 `git show --stat` 对这几个文件**零改动** |
| 技能详情页手工移植（`cf49252cc`）是否留下孤立 `SkillsSettings` 树或重复状态逻辑 | **NO ISSUE**                       | 全仓 grep 无 `SkillsSettings`（singular）代码残留，仅文档提及；批量删除/单删/挂载卸下均走同一 `ipcBridge` 调用，无重复实现                               |
| 拖拽排序统一（`#3606`）是否误伤 fork 的 `GroupedHistory`                        | **NO ISSUE**（是有意织入非误覆盖） | `d1c0d6a57` 是实际合入 commit，`GroupedHistory/index.tsx` 保留全部 fork 分组逻辑，只是新增了 `@dnd-kit` 包裹                                             |
| 侧栏弹性历史（`79b8d7247`）与新拖拽排序共享同一 DOM 是否冲突                    | **静态 NO ISSUE，但需运行时验证**  | dnd-kit 排序期间只做 CSS transform 不改 DOM 结构，理论上 `ResizeObserver` 不该被触发；**真实拖拽下是否真的不触发需要真机验证**                           |
| 本次新功能相关代码里是否有品牌残留（"AionUi"/"Aion CLI" 用户可见文案）          | **NO ISSUE**                       | 仅 license header 注释和 1 处内部代码注释命中，均非用户可见                                                                                              |
| 本次新增用户可见文案 i18n key 是否补齐                                          | **NO ISSUE**                       | cron 队列开关/技能批量删除确认/内联搜索占位符，en-US + zh-CN 均有真实翻译（非仅 `defaultValue` 兜底）                                                    |

## 2. 1oneCore（`sync-v0148`，六项核查）

| 核查点                                                                                                     | 结论                               | 证据                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| migration 026-029 编号是否真的连续无冲突                                                                   | **NO ISSUE**                       | `crates/aionui-db/migrations/` 001-029 连续无跳号无重复，内容与文件名描述匹配，`sqlx::migrate!()` 扫描目录取版本号不存在人工注册表脱节风险                                                                                 |
| 企业 WIP stash（`wip-enterprise-before-sync-v0148`）里的改动是否已经以其他形式落地，还是当前代码缺了这部分 | **已澄清，非 BUG，见下方专项说明** | stash 是独立的 `one-enterprise` crate 重构尝试，从未通过任何 commit 落地；round25 生产代码路径原样健在                                                                                                                     |
| 看图白名单归一化逻辑（`357bbbf3`）是否有误判                                                               | **当前无真实误判，但发现脆弱点**   | `image_input.rs:261-278` 的品牌名切分启发式对 `minimax-2-7`/`deepseek-v4-flash` 这类"字母紧跟数字"的品牌名会切错，但与当前白名单全量比对**不产生实际碰撞**；建议加测试锁死这两个反例，防止未来白名单新增条目时产生真实误判 |
| 品牌注入（`9504fa47`）是否有遗漏                                                                           | **确认遗漏，见下方专项说明**       | 只改了 `cmd_capabilities.rs` 两处，遗漏 `cmd_config.rs`（5 处）/`cmd_diagnose.rs`（5 处）/`cmd_doctor.rs`（1 处）/`cli.rs`（1 处）共 ~12 处                                                                                |
| Pi agent 集成是否打乱已有 agent 注册/PATH 探测的硬编码逻辑                                                 | **NO ISSUE**                       | 注册/探测均为数据驱动（DB `backend` 字段 + `binary_name`），无硬编码数组；`registry::tests::hydrate_loads_seed_rows` 断言总数已正确算入 Pi 并测试通过                                                                      |
| aionrs pin 是否指向 `gaogg521/aionrs` master 且版本一致                                                    | **NO ISSUE**                       | `Cargo.toml`/`Cargo.lock` 全部 12 处一致指向 `78672b36...`，短哈希与 aionrs 仓库当前一致，无漂移                                                                                                                           |

### 2.1 品牌注入遗漏详情（待办）

`9504fa47`（"注入技能与 ACP 身份改为 1One Work"）本意是让助手/ACP 不再自称 "AionUi"，但只覆盖了 `cmd_capabilities.rs` 里的两处 description。以下路径**仍然硬编码 "AionUi"**，且都是 agent 会主动调用（`aioncore config` / `diagnose` / `doctor`）并把 stdout/stderr 读回自己上下文的命令，出错时模型仍会看到 "AionUi" 字样，与本次修复的初衷矛盾：

- `crates/aionui-app/src/commands/cmd_config.rs:1385,1395,1411,1432,1468`（"failed to call AionUi backend" 等 5 处错误字符串）
- `crates/aionui-app/src/commands/cmd_diagnose.rs:307,317,326,340,359`（同类 5 处）
- `crates/aionui-app/src/commands/cmd_doctor.rs:71`（"AionUi backend doctor —…"）
- `crates/aionui-app/src/cli.rs:13`（`about = "AionUi Backend Server"`）

ACP 协议本身没问题：`ACP_CLIENT_NAME`（`protocol/acp.rs:62`）已正确改名，`ACP_CLIENT_VERSION` 沿用 `CARGO_PKG_VERSION` 未受影响，协议对 `clientInfo.name` 无格式约束。

### 2.2 企业 WIP stash 澄清（重要，避免接手者恐慌）

`stash@{0}: wip-enterprise-before-sync-v0148` 基于 `c66bcd31`（round25「真实企业层」代码 `39b56def` 之后的**后续** WIP，不是被同步覆盖丢失的东西）。内容是一次**尚未完成的大重构方案**：新增完整独立的 `one-enterprise` crate（约 502 行），试图把 "SSO 公司" 概念从 `one_tenants` 里完全剥离，并删除现有的 `OrgService::auto_provision_enterprise`、`TenantRow::is_sso_bound`、`OrgContextDto.sso_bound/display_name/org_unit_path/job_title` 等字段，把 `EnterpriseAutoJoiner` trait 改名为 `EnterpriseSync::sync_member`。净变化 99 行新增 / 297 行删除。

核实结论：**当前 HEAD 上 round25 的原版代码（`one-org/src/models.rs:40-50`、`service.rs:440` 的 `auto_provision_enterprise`、红线锁死测试 `service.rs:1118-1234`）原样健在**，`one-sso` 也仍导出旧名，`crates/one-enterprise/` 目录当前**不存在**——即这份 stash **没有通过任何后续 commit 以任何形式落地**，是完全孤立、休眠的候选方案快照。

⚠️ 另外它的 `Cargo.lock` 基线早于本次同步的 aionrs pin 提交，直接 `pop` 会产生 Cargo.lock 冲突。**接手者需要做的判断只有一件事**：这个新架构方向要不要推进——要推进就手工重新整理，不要直接 `git stash pop`；不推进也可以直接 `git stash drop`，不影响任何生产代码路径。

## 3. aionrs（`master` / `sync-v025` @ `78672b3`，四项核查）

| 核查点                                                                                                                                                  | 结论                                   | 证据                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6 类 fork 专属补丁（空参 tool_call / thinking 阶梯重试 / 文本化工具历史 / deferred schema 提升 / GLM 盲搜纠偏 / ToolSearch 文案）是否被 v0.2.5 合并覆盖 | **全部完整保留**                       | 逐条比对合并前后 commit，`bootstrap.rs:326-334` 甚至有明确注释区分 "Upstream: 过滤 / Fork: 保留"，证明是有意保留                                                                            |
| 看图能力判断（`project_image_input`）是否会跟 1oneCore 白名单产生"各自判断"分歧                                                                         | **架构上不可能分歧，但有跨仓时序风险** | aionrs 自身无任何白名单/判断逻辑，能力值完全由 Core 通过 `SetConfig` 注入；唯一风险是 Core 切模型时若忘记带 `image_input` 字段会 fail-closed 剥图——这是已知的跨仓时序问题，非本次同步新引入 |
| PR#230 流诊断是否与 fork 的 thinking 重试/文本化历史共享判断逻辑、可能被绕过                                                                            | **NO ISSUE**                           | `stream_diagnostics.rs` 的改动纯粹是观测性日志，不参与 `composed.rs` 的重试判断分支，两套机制状态完全独立                                                                                   |
| 团队 lead 工具策略继承（`#226`）是否与 GLM/deferred 补丁的工具注册逻辑冲突                                                                              | **NO ISSUE**                           | 受限分支（`ToolPolicy::AllowOnly`）本就不注册 `ToolSearch`/`Skill`，不会摸到需要 GLM 引导文案的路径，全仓唯一构造入口已核实无其他冲突点                                                     |

---

## 4. 统一待办清单（合并两个会话）

> 这里把**周末同步审查（本文档）**与**企业组织解耦会话**的待办整理到一处。两者互不冲突:前者是同步遗留的小修补,后者是一个被中断的大重构。

### 4.1 已完成（2026-07-20）

- [x] ~~补齐 1oneCore 品牌注入遗漏的 4 个文件 "AionUi" agent-facing 字符串~~（`1oneCore@sync-v0148` `1305500d`；实际 ~15 处：cmd_config/diagnose 各 5、doctor 1、cli.rs 4——审查漏列了 cli.rs 91/93/317 三处 `--help` 文案，一并补齐）
- [x] ~~看图白名单归一化 `minimax`/`deepseek-v4-flash` 反例补单测锁死~~（`1oneCore@sync-v0148` `282f5c02`；新增针对**真实内嵌 catalog** 的 `embedded_allowlist_keeps_text_only_lookalikes_unknown_despite_normalization`，非 fixture）

### 4.2 小待办（不阻断合 `one-main`）

- [ ] 真机验证「拖拽排序中侧栏弹性历史高度计算」不受影响（1oneUI，§1 第 4 行）—— **2026-07-20 尝试过 CDP 自动化验证，结论：工具链走不通，仍待人工真机验证**。起 dev（`backend-rebuild.ps1` 后 `bun run dev`）后用 playwright 连 `ws://127.0.0.1:9230` 想模拟拖拽：`page.mouse` 派发的 `pointerdown`/`pointermove` 确实被 `window` 上的原生监听器收到（坐标正确），但 dnd-kit 的 `useSortable`（`SortableConversationRow.tsx`）全程未激活——`isDragging` 恒为 `false`（`opacity` 恒为 `1`，两条置顶会话顺序全程不变），多组时序/步长/延迟都试过，怀疑是 CDP 合成指针事件不满足 dnd-kit `PointerSensor` 的可信度检查或 `setPointerCapture` 语义，Electron 里的已知类问题。`computer-use` 也走不通：dev 窗口标题 `1One Work` 不在 Windows 已装应用目录里，`request_access` 解析不到。**结论待办**：需要人工用真实鼠标在 dev 窗口里连续拖拽置顶会话验证一次；间接证据是 pin/unpin（真实内容高度变化）确实会正确触发 `ResizeObserver`（预期行为），只是拖拽期间纯 CSS transform 是否误触发仍未验证。
- [x] ~~`sync-2137` / `sync-v0148` / aionrs 各自合进 `one-main`（周末同步收尾）~~（2026-07-20；aionrs master/sync-v025 本就同一 commit `78672b3` 无需动；1oneCore one-main FF 合并 sync-v0148 → `282f5c02` 已推送；1oneUI one-main FF 合并 sync-2137 → `5e593f818` 已推送，随手带的 5 个游离素材图片改动另提交 `0f33be347`）
- [x] ~~出正式包前确认 bundled `aioncore.exe` ≥ 含 `9504fa47`（品牌）+ `1305500d`(品牌补齐) 的 build~~（2026-07-20；核实原 bundled exe 停在 07-19 22:20（只含 `9504fa47`），缺 07-20 10:50 的 `1305500d`/`282f5c02`；已 `cargo build -p aionui-app --release`（HEAD=`282f5c02`）+ `prepareAioncore.js` 重新内嵌，`resources/bundled-aioncore/win32-x64/aioncore.exe` 现已是最新 build）。

### 4.3 大任务:企业组织 vs 项目组 彻底解耦（**单独会话手工做,勿在同步分支顺手干**）

联调暴露"企业组织(SSO 公司)"与"项目组(邀请码 tenant)"数据模型纠缠 → 用户拍板彻底解耦(建独立 `one-enterprise` crate + 独立表,拆 B2 的 tenant-SSO 绑定)。**上次实现约 07-17 在 Part C 中途被 `API stalled mid-stream` 打断**,WIP 被周末同步 `git stash -u` 完整存下:

- **方案(含精确恢复点)**:`~/.claude/plans/tidy-percolating-allen.md` 末尾「⏸️ 恢复状态」节。
- **半成品**:`1oneCore stash@{0}: wip-enterprise-before-sync-v0148`(基于 `c66bcd31`)。⚠️ **别 `git stash pop`**(基线早于同步会 Cargo.lock/one-sso 冲突);手工重做或 `git checkout stash@{0} -- crates/one-enterprise` 捞新 crate。
- **恢复点一句话**:stash 里 Part A(one-enterprise crate)/Part B(one-sso)/Part C 主体已做;**没做完** = ① one-org B2 测试清理(service.rs 还有 8 处 `auto_provision_enterprise` 引用→编译不过,中断点)② Part D aionui-app 装配(stash 没动)③ Part E 前端(没动)④ 编译测试。
- 背景澄清见本文档 §2.2;不推进的话可 `git stash drop`,不影响任何生产代码。

---

## 5. 相关文档

- [`session-2026-07-19-upstream-sync-changelog.zh-CN.md`](session-2026-07-19-upstream-sync-changelog.zh-CN.md) — 本次同步的功能与提交总表
- [`session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md`](session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md) — 作战过程/企业铁律
- [`session-2026-07-19-custom-gateway-image-input.zh-CN.md`](session-2026-07-19-custom-gateway-image-input.zh-CN.md) — 看图白名单细节
- [`session-2026-07-19-brand-skills-acp.zh-CN.md`](session-2026-07-19-brand-skills-acp.zh-CN.md) — 品牌/技能/ACP 补齐（本报告 §2.1 是它的遗留缺口）
