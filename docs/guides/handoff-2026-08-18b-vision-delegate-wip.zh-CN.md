# 交接：视觉委托治理修复（话术 A）—— ✅ **已全部收尾（2026-08-18 22:35）**

> **这份交接已完成，不需要再接手。** 下面的原文保留作为过程记录；
> 收尾实际发生的事、以及与原文不符之处，全部写在 §0.5「收尾实况」。

> 这份是**中途暂停**的交接。上一份总清单是
> [`handoff-2026-08-18-remaining.zh-CN.md`](handoff-2026-08-18-remaining.zh-CN.md)，
> 这份只覆盖它的 **话术 A（§1 P0 视觉委托绕过企业治理）**。
> 其余话术（B/C 分叉、D 发版、E 杂项、F 人工项）**一个字都没碰**。

---

## 0. 三十秒看懂现在是什么状态

| 仓           | HEAD        | 状态                                   |
| ------------ | ----------- | -------------------------------------- |
| **aionrs**   | `051ff54`   | ✅ **已提交、已推送**                  |
| **1oneUI**   | `5694f7a60` | ✅ 已提交（纯文档），⚠️ **未推送**     |
| **1oneCore** | `f5120f15`  | ⚠️ **代码全在工作区，一次都没 commit** |

**功能上是做完的**：两个洞都修了、测试都补了、三条负向验证都做过。
**流程上没做完**：1oneCore 没提交没推送、临时 `[patch]` 还在、内嵌后端没重编、
没做真机验证。

---

## 0.5 收尾实况（2026-08-18 22:35 补记）—— ⚠️ 与上表不符，以此节为准

上表在写完之后就过期了：**另一个会话（Claude Code/Codex 桥接纯文本模型读图降级 +
本地 OCR 那条）在 19:30 把本轮的 1oneCore 代码一并吞进了它自己的提交并推了出去**，
所以"1oneCore 一次都没 commit"不再成立。

| 仓           | 收尾后 HEAD | 说明                                                                    |
| ------------ | ----------- | ----------------------------------------------------------------------- |
| **aionrs**   | `051ff54`   | 未变，早已推送                                                          |
| **1oneUI**   | `fe56b8e3c` | 另一会话推到 `a877942bd`；本次补了 `docs/README.md` 漏掉的索引行        |
| **1oneCore** | `38cdf307`  | 另一会话推到 `0886193f`（含本轮代码）；本次修 Cargo.lock + 补 CLAUDE.md |

### ⚠️ 那次合并推送留下了一个真缺陷：主干编不过

`0886193f` 提交的 `capability/backend_output_sink.rs` 实现了
`OutputSink::emit_delegate_usage`，但**它的 Cargo.lock 仍指向 aionrs `1d485e5`**
—— 那是 `DelegateUsageSink` 加入之前的提交，其 `OutputSink` 根本没有这个方法。
本地那个临时 `[patch]` 块替它兜住了，所以本机一路编译通过，**而干净 checkout
会直接编译失败**。已在 `38cdf307` 修好（删 patch 块 + `cargo update` 到 `051ff54`）。

**教训（比这个 bug 本身更值得记）**：临时 `[patch]` 块会让"本机编过"这件事
失去意义 —— 它把跨仓依赖的版本错配整个隐藏掉。**只要工作区里存在 `[patch]`，
"编译通过"就不能作为可推送的判据**；必须先删块、`cargo update`、再重编一次。

### 代码在那次重构里的位置变化（治理逻辑已核实完好）

`resolve_vision_delegate` 从 `factory/aionrs.rs` 搬到了
`capability/vision_delegate.rs`，`factory/aionrs_vision_delegate_test.rs` 相应
变成 `capability/vision_delegate_test.rs`。逐项核实过**闸门没有在搬家中被削弱**：
仍在能力判定之后、`resolve_provider_config_for_bridge` 之前，`Ok(false)` 与 `Err`
都 fail closed，6 条治理测试 + relay 3 + orchestrator 3 全部存活。

### 验证补齐情况

| 项目                                    | 原文状态                         | 收尾后                                                                                                                                                      |
| --------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 对着 git 上的 aionrs 编译               | ❌ 从没做过（全在 patch 下做的） | ✅ **0 error**                                                                                                                                              |
| `cargo test --workspace --no-fail-fast` | ⚠️ 被叫停、没跑完                | ✅ **跑完**：255 个测试二进制，8 条失败，与基线**逐个同名**（aionui-project scm discard/revert 6 + `scm_request_path` 1 + `team_e2e` 尾随空格 1），一条未增 |
| `backend-rebuild.ps1` 重编内嵌          | ❌ 没做                          | ✅ exit 0                                                                                                                                                   |
| 真机验证                                | ❌ 没做                          | ✅ **两条判据都过**，见下                                                                                                                                   |

### 真机验证记录（企业 `测试科技公司` / 成员 `system_default_user` admin+active 席位）

走后端 HTTP 直连（dev 本地模式无鉴权，比驱动 DOM 稳）。**关键简化：ReadImage 是按
路径调用的工具，所以不必上传附件**——发一句"用 ReadImage 读这个路径"即可触发委托。
主模型固定用 `minimax-2-7`（被 `image_input.rs` 锁死为纯文本 lookalike，正好触发委托）。
⚠️ ReadImage 会触发权限确认，必须 `POST …/confirmations/{call_id}/confirm`
（请求体是 `{msg_id, data:{value}, always_allow}`，`msg_id` 取日志里的
`session_id=… msg_id=…`），否则 turn 一直挂着。

**判据 ①（allowlist 只留 `["minimax-2-7"]`，会话 `aa914503`）**

- 4 个视觉模型被逐个点名拦下：`kimi-k2-6` / `gemini-3-5-flash` /
  `gemini-3-pro-image` / `gemini-3-pro-image-preview`，`policy_blocked=4`
- ReadImage 返给模型的原文是**策略原因**：
  "Your organization's model policy does not allow the vision-capable model(s)
  configured here (…). Ask an administrator to add one to the allowed models list."
  不是"去设置里加视觉模型"；反编造那句 "Do NOT guess, infer from the file name,
  or invent what the image shows." 仍在
- 模型照实转达（说是组织策略、去找管理员），并明确拒绝猜图
- 账本：**只 1 行**（主模型行），**无委托幽灵行**

**判据 ②（allowlist 改为 `["minimax-2-7","kimi-k2-6"]`，会话 `deca178f`）**

- 日志 `Resolved vision delegate … vision_model=kimi-k2-6`，委托被选中
- 委托真跑通：ReadImage 输出 "as read by vision model 'kimi-k2-6' (openai)"，
  模型报出的文字与刻意生成的验证图**逐字一致**（`VERIFY-7Q4XB2` /
  `vision delegate check`）——证明是真读到，不是编的
- 账本：**2 行**，其中一行 `model='kimi-k2-6'`（**委托模型名**，in=479 / out=309 /
  cost=702 micros），与主模型行**分开、未合并**

验证用的 allowlist 改动**已还原为原始的 NULL**（未清理两个测试会话，留作证据）。

### 顺带发现的既有现象（不在本轮范围，未修）

账本里**主模型那一行的 `model` 列一直是 NULL**（`estimated_cost_micros` 也是 NULL）
—— 全库 127 行里带模型名的只有委托行。也就是说本轮让委托花费"看得见"了，
而**主模型这一侧的计价本来就没落到账上**。这是主路径计量的长期状况、与本轮改动
无关，但它意味着"成本上限"目前主要靠委托行之外的什么机制在生效，值得单独查一轮。

⚠️ **一个必须先处置的东西**：aionrs 工作区里有**不是这轮的改动**
（`crates/aion-agent/src/context.rs` + `context_test.rs`，往系统提示里加了一段
"工具报做不到时先自己想办法"）。**它不是我写的**，我第一次 `git add -A` 时误把它
扫进提交，已 `reset --soft` 拆出来，现在原样留在工作区未提交。**别顺手提交它**，
先问清楚是谁的。

---

## 1. 这轮做了什么（已完成）

原问题（交接文档 §1）：`ReadImage` 给纯文本模型读图时会委托**一个单独的视觉模型**，
这条新的模型调用路径 **A) 不过企业 allowlist、B) 花费不进账本**。

### 洞 A：allowlist 够到视觉委托（纯 1oneCore）

| 改动                                                                                                                        | 文件                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 新 trait `ModelAllowlistGate`                                                                                               | `crates/aionui-ai-agent/src/model_policy.rs`（**新文件**）  |
| `AgentFactoryDeps.model_allowlist: Option<Arc<dyn ModelAllowlistGate>>`                                                     | `factory/mod.rs`                                            |
| `resolve_vision_delegate` 加闸门；返回类型 `Option<VisionModelConfig>` → 新结构 `VisionDelegate { config, policy_blocked }` | `factory/aionrs.rs`                                         |
| 适配器 `BillingModelAllowlistGate`（调 `check_model_allowed`）                                                              | `aionui-app/src/router/routes.rs`                           |
| `BillingService` 构造**从 `routes.rs` 上移到 `AppServices`**，`routes.rs` 改为复用 `services.billing.clone()`               | `aionui-app/src/services.rs` + `router/mod.rs`（re-export） |

**为什么要上移 BillingService**：agent 工厂在 `AppServices::from_config` 里装配，
**早于任何 router 存在**，而 `BillingService` 原本在 `routes.rs` 才构造。它自述
dependency-free（只要 pool + `ManualBillingProvider`），上移零风险。

**三个拍板点（改之前先读，别推翻）**

1. **用 allowlist-only（`check_model_allowed`）不用 `check_send_allowed`。**
   委托在 **session 构建时**解析一次并缓存整个会话；此刻查预算等于把"那一瞬间
   预算耗尽"永久烙进这个会话，而且本轮 send 的预算刚被 `SendGate` 查过。
2. **闸门位置：能力判定之后、`resolve_provider_config_for_bridge` 之前。**
   之后 → 日志只点名"本来就要被用上"的模型；之前 → 被封禁的模型不该把凭据解出来。
3. **`Ok(false)` 与 `Err` 都 fail closed**（都 `continue`），与 `BillingSendGate`
   的 `POLICY_CHECK_FAILED` 同一态度。

### 洞 B：委托用量进账本（跨 aionrs → 1oneCore）

**aionrs（已推 `051ff54`）**

- `aion-types/src/usage.rs` 新增 `DelegateUsageSink`。**必须放 aion-types**：
  aion-tools 需要它，而 aion-tools 不能依赖 aion-agent（成环）。
- `OutputSink::emit_delegate_usage`，**默认 no-op** → terminal / null / protocol
  三个 sink 零改动，与上游同步冲突面最小。
- `bootstrap.rs` 加 bridge struct 适配；`read_image.rs` 的
  `LlmEvent::Done { .. } => break` 改为解构 `usage` 并上报**委托模型名**。

**1oneCore（未提交）**

- 新内部事件 `AgentStreamEvent::DelegateUsage`，契约同 `SegmentBreak`：
  **relay 消费、永不转发 WS、无需前端渲染器**。
- `RelayOutcome.delegate_usage: Vec<DelegateUsageEventData>`，relay 循环累积，
  **四条出口都填了**（deferred terminal break / deleting / channel-closed / finalize）。
- `turn_orchestrator` 抽出 `meter_attempt()`（便于脱离整个会话服务测试）：
  主模型一行 + 每次委托调用各一行。
- `one-billing::record_turn` 补 zero-cost warn，与 `record_media_usage` 同款。

**账本记委托模型名不记主模型**：费率表按族名 substring 匹配
（`kimi-k2-6`→`kimi`、`gpt-4o`→`gpt-4`），记主模型是 misattribution 且费率算错。
**匹配不上只打 warn，绝不发明兜底费率**——那是定价决策，有测试钉死。

### 顺带修的：报错不再说假话

被 allowlist 拦掉时，原文案是"去 Settings → Models 加一个视觉模型"，对被管理员
封禁的成员既是错的也无法执行。现经
`VisionDelegate.policy_blocked` → `AionrsResolvedConfig.vision_unavailable_reason`
→ `AgentBootstrap::vision_unavailable_reason()` → `ReadImageTool::with_unavailable_reason()`
替换成点名被拦模型 + 找管理员。

⚠️ 它替换的是**整段诊断与补救**，不只是补救那一句——默认诊断里那句"没有任何已
配置模型标记为支持图片"在策略拒绝时是**假的**（有一个，只是被拦了）。
**反编造那句（"Do NOT guess..."）在所有路径上保留**，有测试钉死。

### ⛔ 刻意没做

**没有放宽 `capability/image_input.rs`**。它有测试锁死 `minimax-2-7` /
`deepseek-v4-flash` 这类纯文本 lookalike 不许误放行；提交 `7cf40b96` 曾把默认值
从 Unknown 改成 Supported，被当场否掉并 revert（`a1caef8e`）。本次只在"检查哪些
模型"外面**再加一道闸**，判断本身一个字没动。

---

## 2. 验证做到哪一步（**照实说**）

| 项目                                                                                        | 结果                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| aionrs `cargo fmt` / `clippy --workspace --all-targets` / `test --workspace --no-fail-fast` | **全部退出码 0，零 FAILED**                                                                                                                      |
| 1oneCore `cargo fmt --all -- --check`                                                       | **0**                                                                                                                                            |
| 1oneCore `cargo clippy --no-deps` (5 个改动 crate)                                          | ❌ **红，但全是既有债务**——`aionui-ai-agent` 里 `spawn_sdk.rs` / `factory/acp.rs` 测试块的 unused imports，**不在我的 diff 里**，按 ratchet 未碰 |
| 1oneCore `cargo test --workspace --no-fail-fast`                                            | ⚠️ **被我中途叫停，没跑完**。停在 30 个测试二进制、**0 个 FAILED**，但**不是完整结论**                                                           |
| 真机验证                                                                                    | ❌ **没做**                                                                                                                                      |
| `backend-rebuild.ps1` 重编内嵌                                                              | ❌ **没做**                                                                                                                                      |

**负向验证（三条，每条恢复后都复绿了）**

| 破坏什么                                              | 结果                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| 注释掉 `resolve_vision_delegate` 整段闸门             | 4 条治理测试全红（9 passed / 4 failed），恢复后 13 全绿 |
| `read_image.rs` 改回 `LlmEvent::Done { .. } => break` | 用量测试红，恢复后绿                                    |
| 去掉 `meter_attempt` 的委托循环 + relay 的累积        | 4 条红（orchestrator 2 + relay 2），恢复后 6 绿         |

恢复后已全仓搜 `unreachable_code` / `NEGATIVE` / `TEMPORARY`，**没有残留破坏**。

**新增测试 17 条**（每条都验证过桩闸门/桩 sink 真的被调用——"绿"只对真正跑到的
那条路径有意义）

- `aionrs_vision_delegate_test.rs` **6 条**：踢出清单不可被选 / 在清单内仍可选 /
  跳过被拦的继续找下一个 / 判定失败 fail closed / 无闸门（个人版）行为不变 /
  纯文本模型根本不问闸门
- `read_image_test.rs` **5 条**：用量上报且模型名是委托模型 / 调用失败不报零用量 /
  host reason 替换整段诊断且保留反编造指令 / 空白 reason 回退
- `stream_relay.rs` **3 条** + `turn_orchestrator.rs` **3 条**：事件进 outcome 不进
  WS / 多次委托各自计数 / 无委托时不产生幽灵行 / 委托单独成账本行且模型名正确

---

## 3. 接手的人要做什么（按顺序）

### ① 先处置那两个不是我的文件

```bash
cd D:\aionui-m0\aionrs-local && git status --porcelain
```

`context.rs` / `context_test.rs` 有改动。**不是这轮的**，问清楚归属再决定提交还是丢弃。

### ② 跑完 1oneCore 全量测试

```bash
cd /d/aionui-m0/1oneCore && cargo test --workspace --no-fail-fast > /tmp/t.log 2>&1; echo $?
```

判据：**既有失败 8 条**（`aionui-project` scm/discard 6 + `scm_request_path` 1 +
`team_e2e` Windows 尾随空格 1），**数字不能变多**。
⚠️ 取被测命令自己的退出码，别隔着管道看。

### ③ 删临时 patch + 重新解析 Cargo.lock

`1oneCore/Cargo.toml` **末尾有一个临时 `[patch."https://github.com/gaogg521/aionrs.git"]` 块**
（块内有醒目注释）。aionrs 已推到 `051ff54`，所以：

```bash
cd /d/aionui-m0/1oneCore && cargo update -p aion-agent -p aion-tools -p aion-types
```

（先手动删掉 Cargo.toml 里那个块，再跑）
删完必须**重新编译一次**确认 1oneCore 真的能对着 git 上的 aionrs 编过——本轮所有
1oneCore 验证都是在 patch 生效下做的。

### ④ 提交 1oneCore

主干 `one-main`，中文 commit message，**禁止 AI 署名**（三仓 AGENTS.md 明文）。
`git push` 而非 `just push`（后者的 workspace-wide `-D warnings` 会被既有债务卡住）。

### ⑤ 重编内嵌 + 真机验证

```powershell
D:\aionui-m0\scripts\backend-rebuild.ps1
```

跑之前确认 dev 应用没在跑（否则 EPERM）；⚠️ **不要**用 `*>` 或 `2>&1` 重定向它——
PS 5.1 会把 cargo 的 stderr 包成 ErrorRecord 报 NativeCommandError，看起来像编译
失败其实没有。

真机判据（dev profile 里已有真实企业 `测试科技公司` 可直接用）：

1. 给 allowlist 只留主模型 → 发一张图 → 委托**不被选中**，且报错说的是**策略原因**
   （点名被拦模型 + 让找管理员），不是"去设置里加视觉模型"
2. allowlist 放开 → 再发一张图 → `one_usage_events` 里出现**一条委托模型名**的记录
   （与主模型那条是两行，不是合并的一行）

CDP 连法见 [`cdp.md`](cdp.md)：`AIONUI_DEVTOOLS_CDP_PORT=9230 bun run dev`，
**用裸 ws 客户端，别用浏览器自动化 MCP**；窗口被遮挡时 Chromium 会停止产帧，
会把正常代码测成 BUG。

### ⑥ 推 1oneUI

`5694f7a60` 是纯文档（session 文档 + 三仓 CLAUDE.md 索引 + 把总清单里的话术 A
标记为已完成），**已提交未推**。

---

## 4. 已知边界（不是缺陷，是范围）

- **委托在 session 构建时解析一次并缓存整个会话。** 管理员在会话进行中改 allowlist
  不影响已建好的 agent，要新开会话才生效。与会话模型的既有行为一致
  （`check_model` 也只在切模型那一刻查）。
- **本轮只让成本上限"看得见"委托花费，没有在委托调用前拦预算。**
  预算判定留在 send 路径，理由见 §1 拍板点 ①。
- **aionrs master 在 `1d485e5` 上本来就是 fmt 脏的**（全在上一轮 ReadImage 提交碰过
  的那几个文件里，我用干净 worktree 核实过），本轮 `cargo fmt --all` 顺手清掉了，
  所以 aionrs 的 diff 里有 `engine_test.rs` / `image_source_test.rs` 两个我没改
  逻辑的文件。
- **1oneCore 有既有 clippy 债务**：`one-sso` 两处 dead_code + 一处 collapsible_if、
  `aionui-ai-agent` 若干 unused imports（都在测试块 / `spawn_sdk.rs`）。按 ratchet
  未碰，但意味着 `just push` 会被卡住。

---

## 5. 相关文档

- 完整经过与设计理由：[`session-2026-08-18-vision-delegate-governance.zh-CN.md`](session-2026-08-18-vision-delegate-governance.zh-CN.md)
- 剩余全部待办的总清单（话术 B/C/D/E/F）：[`handoff-2026-08-18-remaining.zh-CN.md`](handoff-2026-08-18-remaining.zh-CN.md)
  ——其中 **§1 与话术 A 已被标记为完成**（就是这轮做的）

---

## 6. 📋 可直接粘给新会话的话术

```
工作目录 D:\aionui-m0，三仓 fork：1oneUI(前端Electron) / 1oneCore(Rust后端) /
aionrs-local(agent引擎)。只单向同步上游、永不反向提 PR。
先读 1oneUI/docs/guides/handoff-2026-08-18b-vision-delegate-wip.zh-CN.md 全文。

任务：把「视觉委托受企业治理管辖」这个改动收尾并推出去。**代码已经写完并验证过
了，你要做的是收尾流程，不是重写。**

## 现状
- aionrs：已提交已推（051ff54）
- 1oneUI：已提交未推（5694f7a60，纯文档）
- 1oneCore：**代码全在工作区，一次都没 commit**

## 按这个顺序做
1) 先看 aionrs 工作区里的 crates/aion-agent/src/context.rs 与 context_test.rs
   ——**那不是这轮的改动**，是别人在途的工作（往系统提示加了一段"工具报做不到时
   先自己想办法"）。别顺手提交，先问归属。
2) 1oneCore 跑完 `cargo test --workspace --no-fail-fast`（上一轮跑到 30 个测试
   二进制、0 FAILED 时被叫停，没跑完）。判据是**既有失败 8 条不能变多**
   （aionui-project scm/discard 6 + scm_request_path 1 + team_e2e 尾随空格 1）。
   取被测命令自己的退出码，别隔着管道看。
3) 删掉 1oneCore/Cargo.toml **末尾的临时 [patch] 块**（块内有醒目注释），
   然后 `cargo update -p aion-agent -p aion-tools -p aion-types` 让 Cargo.lock
   指向 aionrs 的 051ff54，**再完整编译一次**——本轮所有 1oneCore 验证都是在
   patch 生效下做的，对着 git 上的 aionrs 还没编过。
4) 提交 1oneCore（主干 one-main，中文 commit message，**禁止 AI 署名**），
   用 `git push` 不用 `just push`（后者 workspace-wide -D warnings 会被既有债务卡）。
5) 跑 D:\aionui-m0\scripts\backend-rebuild.ps1 重编内嵌。跑之前确认 dev 应用没在
   跑（否则 EPERM）；⚠️ 不要用 `*>` 或 `2>&1` 重定向它，PS 5.1 会把 cargo 的
   stderr 包成 ErrorRecord 报 NativeCommandError，看起来像编译失败其实没有。
6) 真机验证两条（dev profile 里已有真实企业「测试科技公司」）：
   ① allowlist 只留主模型 → 发图 → 委托不被选中，且报错说的是策略原因
     （点名被拦模型 + 找管理员），不是"去设置里加视觉模型"
   ② allowlist 放开 → 发图 → one_usage_events 里出现一条**委托模型名**的记录，
     与主模型那条是**两行**不是合并的一行
   CDP 连法见 docs/guides/cdp.md，用裸 ws 客户端别用浏览器自动化 MCP；
   窗口被遮挡时 Chromium 会停止产帧，会把正常代码测成 BUG。
7) 推 1oneUI 的 5694f7a60。

## ⛔ 不要做
- 不要放宽 1oneCore/crates/aionui-ai-agent/src/capability/image_input.rs 的能力
  判定或白名单（有测试锁死，提交 7cf40b96 改过被当场 revert 成 a1caef8e）。
- 不要把委托的 allowlist 检查改成 check_send_allowed。刻意用 allowlist-only：
  委托在 session 构建时解析一次并缓存整个会话，此刻查预算会把"那一瞬间预算耗尽"
  永久烙进这个会话。
- 不要给"未知模型计价为 0"发明兜底费率。那是**定价决策**不是 bug，有测试钉死，
  本仓约定只打 warn。
- 不要碰 one-sso / spawn_sdk.rs / factory/acp.rs 的既有 clippy 债务（ratchet）。
- 本轮**不碰**会话分叉（话术 B/C）、不发版（话术 D）、不做杂项（话术 E）。

## 每次跑 shell 前确认工作目录
本仓真实发生过跨仓库误提交（cwd 停在一个仓，却在提交另一个仓的改动）。
```
