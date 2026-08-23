# 2026-08-18：让「视觉委托」这条新的模型调用路径受企业治理管辖（P0）

> 承接 [`handoff-2026-08-18-remaining.zh-CN.md`](handoff-2026-08-18-remaining.zh-CN.md) §1（话术 A）。
> 只做这一件事；会话分叉（话术 B/C）、发版（话术 D）、杂项（话术 E）均未碰。
>
> ✅ **已全部收尾并推送**（状态见 §6，真机验证见 §11）。
> ⚠️ **§2 / §3 里写的文件路径已经过期** —— §8/§9 那轮重构把视觉委托抽到了
> `capability/vision_delegate.rs`，对照表与「闸门没被削弱」的逐项核实见 **§10**。

---

## 0. 一句话

给纯文本模型加的 `ReadImage` 读图能力，会委托一个**单独的视觉模型**——这是一条
新的模型调用路径，而它**既不过企业 allowlist，花费也不进账本**。两个洞都已修，
均补测试锁死并做过负向验证。

---

## 1. 问题（复核结论，不是继承的）

交接文档 §1 的两条断言我逐条开文件核对过，**都属实**：

**洞 A：allowlist 够不到委托模型。**
`resolve_vision_delegate`（`1oneCore/crates/aionui-ai-agent/src/factory/aionrs.rs`）
遍历用户已配置的 provider 挑视觉模型，只查 `enabled` / `model_enabled` / 能力判定。
全仓 allowlist 强制点只有两处，都在「会话模型」那一侧——`routes.rs` 的 `check_send`
（发消息）与 `routes_aux.rs` 的 `check_model`（改模型设置），各只有一个调用点。
管理员把某模型踢出清单后，它仍可能被当视觉委托调用。

**洞 B：这次调用的 token 用量被丢弃。**
`aionrs-local/crates/aion-tools/src/read_image.rs` 里写的是
`LlmEvent::Done { .. } => break`——`Done` 明明带 `usage`，直接丢掉。1oneCore 只在
`turn_orchestrator.rs` 记主模型那一次。后果：企业成本上限与用量看板看不见这笔花费。

**这与媒体生成踩过的是同一类洞**，`one-billing::check_media_allowed` 的注释里写的
就是同一句话：媒体走内置 MCP 工具，从未过 `SendGate`。根因也一样——给既有能力开
了一条新的到达路径，旧路径上「顺手就有」的治理没跟过来，而且缺了不报错。

---

## 2. 修复 A：allowlist 够到视觉委托（纯 1oneCore）

`aionui-ai-agent` 与 `one-billing` 同层，不能直接依赖，按本仓既有安排走 trait 注入。
形状照抄现成的三个先例：`aionui_auth::IpAllowlistGate` / `aionui_conversation::SendGate`
/ `UsageRecorder`。

| 改动                                                                           | 位置                                  |
| ------------------------------------------------------------------------------ | ------------------------------------- |
| 新 trait `ModelAllowlistGate`（`is_model_allowed -> Result<bool, String>`）    | `aionui-ai-agent/src/model_policy.rs` |
| `AgentFactoryDeps` 新增 `model_allowlist: Option<Arc<dyn ModelAllowlistGate>>` | `factory/mod.rs`                      |
| `resolve_vision_delegate` 增加闸门，返回类型改为 `VisionDelegate`              | `factory/aionrs.rs`                   |
| 适配器 `BillingModelAllowlistGate`（调 `check_model_allowed`）                 | `aionui-app/src/router/routes.rs`     |
| `BillingService` 构造上移到 `AppServices`，`routes.rs` 改为复用同一实例        | `aionui-app/src/services.rs`          |

### 三个拍板点

**① 用 allowlist-only（`check_model_allowed`），不用 `check_send_allowed`。**
委托是在 **session 构建时**解析一次、缓存整个会话；此刻查预算没有意义（本轮 send
的预算刚被 `SendGate` 查过），而且会把「那一瞬间预算耗尽」永久烙进这个会话的委托
配置。预算侧由修复 B 覆盖。

**② 闸门位置：能力判定之后、解密 provider 配置之前。**
放在能力判定之后，日志只会点名「本来就要被用上」的模型；放在解密之前，是因为被
管理员封禁的模型没有理由把凭据解出来。

**③ 失败一律 fail closed。** `Ok(false)` 与 `Err` 都 `continue`，态度与
`BillingSendGate` 的 `POLICY_CHECK_FAILED` 一致：判定不了的策略不等于通过的策略。

### 顺带修掉的「报错说假话」

被 allowlist 拦掉时，原兜底文案是「去 Settings → Models 加一个视觉模型」——这对
被管理员封禁的成员既是错的、也无法执行，用户只会一直试。现在 `VisionDelegate` 带
`policy_blocked` 列表，经 `AionrsResolvedConfig.vision_unavailable_reason` →
`AgentBootstrap::vision_unavailable_reason()` → `ReadImageTool::with_unavailable_reason()`
替换掉那句 remedy，改成点名被拦模型 + 让用户找管理员。

⚠️ **只替换 remedy 那一句**，原文那句「不许猜、不许编」在所有路径上保留——一个含糊
或空的工具结果正是让 agent 编造图片内容的原因，有测试钉死。

### ⛔ 刻意没做

没有放宽 `capability/image_input.rs` 的能力判定或白名单。它有测试锁死
`minimax-2-7` / `deepseek-v4-flash` 这类纯文本 lookalike 不许误放行；提交 `7cf40b96`
曾把默认值从 Unknown 改成 Supported，被当场否掉并 revert（`a1caef8e`）。本次只是在
「检查哪些模型」外面**再加一道闸**，判断本身一个字没动。

---

## 3. 修复 B：委托用量进账本（跨 aionrs → 1oneCore）

用量要从 `aion-tools` 一路穿回 1oneCore 的 `record_turn`。

**aionrs 侧**

- `aion-types/src/usage.rs` 新增 `DelegateUsageSink` trait。**放 aion-types 是必须的**：
  `aion-tools` 已依赖它，而 aion-tools **不能**依赖 aion-agent（会成环）。
- `aion-agent` 的 `OutputSink` 加 `emit_delegate_usage`，**默认 no-op**——terminal /
  null / protocol 三个 sink 因此零改动，与上游同步的冲突面最小。
- `bootstrap.rs` 加 bridge struct 把 `Arc<dyn OutputSink>` 适配成 `DelegateUsageSink`。
- `read_image.rs` 的 `Done` 分支解构出 `usage` 并上报，报的是**委托模型名**。

**1oneCore 侧**

- 新增内部事件 `AgentStreamEvent::DelegateUsage`，契约与 `SegmentBreak` /
  `BackendTurnBound` 一致：**relay 消费、永不转发 WS、无需前端渲染器**。
- `RelayOutcome` 新增 `delegate_usage: Vec<DelegateUsageEventData>`，relay 事件循环
  累积、四条出口逐条填。
- `turn_orchestrator` 抽出 `meter_attempt()`（便于脱离整个会话服务做测试），主模型
  一行 + 每次委托调用各一行。

### 拍板：用量记「委托模型」名，不记主模型

费率表（`aionui-common/src/license.rs`）按族名 substring 匹配：`kimi-k2-6`→`kimi`、
`gpt-4o`→`gpt-4`、`glm-4v`→`glm`，主流视觉模型都匹配得上。记主模型是明确的
misattribution，而且费率也会算错。

⚠️ **匹配不上时按本仓既有约定只打 warn，绝不发明兜底费率**——那是定价决策不是 bug
（`record_media_usage` 早有同款 warn，并有测试 `if this ever becomes non-zero, a rate
was invented` 钉死）。本轮给 `record_turn` 补了同款 zero-cost warn，让「委托模型没
匹配上费率表 → 这笔不消耗成本上限」在日志里看得见。

---

## 4. 验证

**负向验证（两条都做了，各自恢复后复绿）**

| 破坏什么                                                 | 结果                                                    |
| -------------------------------------------------------- | ------------------------------------------------------- |
| 注释掉 `resolve_vision_delegate` 的整段闸门              | 4 条治理测试全红（9 passed / 4 failed），恢复后 13 全绿 |
| 把 `read_image.rs` 改回 `LlmEvent::Done { .. } => break` | 委托用量测试红，恢复后绿                                |
| 去掉 `meter_attempt` 的委托循环 + relay 的累积           | 4 条红（orchestrator 2 + relay 2），恢复后 6 绿         |

恢复后全仓搜 `unreachable_code` / `NEGATIVE` / `TEMPORARY` 确认没留下破坏。

**测试**：aionrs `cargo test --workspace --no-fail-fast` 退出码 0、零 FAILED。

1oneCore 的全量测试**写这份文档时被中途叫停、没有跑完**（停在 30 个测试二进制、
0 FAILED，不是完整结论）。**收尾时补跑完了**：255 个测试二进制、累计 8 条失败，
与既有基线**逐个同名**——`aionui-project` 的 scm `discard*`/`revert*` 6 条 +
`scm_request_path::a_blank_basename_folder_does_not_become_a_blank_label` 1 条 +
`team_e2e::tc6b_workspace_with_whitespace_segment_is_accepted` 1 条，**一条未增**。
退出码 101（有失败即非零，符合预期）。判定一律取被测命令自己的退出码，不隔着管道看。

**新增测试**（都验证过桩闸门/桩 sink 真的被调用——「绿」只对真正跑到的那条路径有意义）

- `capability/vision_delegate_test.rs`（原 `factory/aionrs_vision_delegate_test.rs`，见 §10）6 条：踢出清单不可被选、在清单内仍可选、跳过被拦
  的继续找下一个、判定失败 fail closed、无闸门（个人版）行为不变、纯文本模型根本
  不问闸门
- `read_image_test.rs` 5 条：用量上报且模型名是委托模型、调用失败不报零用量、
  host reason 替换 remedy 且保留反编造指令、空白 reason 回退
- `stream_relay.rs` 3 条 + `turn_orchestrator.rs` 3 条：事件进 outcome 不进 WS、
  多次委托各自计数、无委托时不产生幽灵行、委托单独成账本行且模型名正确

---

## 5. 已知边界（不是缺陷，是范围）

- **委托在 session 构建时解析一次并缓存。** 管理员在会话进行中改 allowlist，不会
  影响已建好的 agent，要新开会话才生效。这与会话模型的既有行为一致（`check_model`
  也只在切模型那一刻查）。
- **本次只让上限「看得见」委托花费，没有在委托调用前拦预算。** 预算判定留在 send
  路径，理由见 §2 拍板点 ①。
- `aionrs` master 在 HEAD (`1d485e5`) 上**本来就是 fmt 脏的**（全在上一轮 ReadImage
  提交碰过的那几个文件里），本轮 `cargo fmt --all` 顺手清掉了，所以 diff 里会看到
  `engine_test.rs` / `image_source_test.rs` 这两个我没改过的文件。

---

## 6. ✅ 当前状态：已全部收尾并推送（2026-08-18 22:35）

写这份文档时 1oneCore 的改动全在工作区、一次都没 commit。**现已全部收尾**：

| 仓       | HEAD        |                                                         |
| -------- | ----------- | ------------------------------------------------------- |
| aionrs   | `051ff54`   | 已推                                                    |
| 1oneCore | `2c27acae`  | 已推（代码在 `0886193f`，Cargo.lock 修复在 `38cdf307`） |
| 1oneUI   | `e0ca14025` | 已推                                                    |

临时 `[patch]` 块已删、内嵌后端已用 `backend-rebuild.ps1` 重编（exit 0）、
真机两条判据均已通过（见 §11）。收尾实况见
[`handoff-2026-08-18b-vision-delegate-wip.zh-CN.md`](handoff-2026-08-18b-vision-delegate-wip.zh-CN.md) §0.5。

---

## 7. 推送顺序（不可颠倒）—— ✅ 已按此执行，但第 2/3 步当时被漏掉

⚠️ **实际发生过的事故**：本轮代码后来被另一个会话（§8/§9 那条桥接降级）一并吞进
它自己的提交推了出去，**而下面第 2、3 步没做** —— 提交里实现了
`OutputSink::emit_delegate_usage`，Cargo.lock 却仍指向 aionrs `1d485e5`（该方法
尚不存在）。本地 `[patch]` 块替它兜住，所以本机编译测试全绿，**干净 checkout 直接
编不过**。已由 `38cdf307` 修复。

**因此这条顺序不只是「顺序」，第 2/3 步是可推送的前提**：只要工作区里挂着
`[patch]`，"本机编译通过"就不能作为可推送的判据——它把跨仓依赖的版本错配整个隐藏掉。
删块 + `cargo update` + **重编一次**之后才算验证过。

1. 先推 **aionrs**
2. 删掉 `1oneCore/Cargo.toml` 末尾的临时 `[patch."https://github.com/gaogg521/aionrs.git"]`
   块（本轮为联调加的，块内有醒目注释）
3. `cargo update -p aion-agent` 让 `Cargo.lock` 指向 aionrs 的新 commit
4. 再推 **1oneCore**

**本任务不需要改 1oneUI（除本文档）。**
改完 1oneCore 的 Rust 必须跑 `D:\aionui-m0\scripts\backend-rebuild.ps1` 重编内嵌，
否则 dev 用的还是旧后端。

---

## 8. ACP 桥接会话也接入视觉委托（后续补完）

### 真因

Claude Code / Codex 的 ACP 桥接路径与内嵌 aionrs 不同：
`aionui-project/src/chat_files.rs` 把附件展平成
`[[AION_FILES]]` 后的绝对路径文本；
`aionui-ai-agent/src/manager/acp/agent.rs` 只把这段文本送入外部 CLI，
没有传图片字节。因此，一个被桥接到纯文本模型的 CLI 会以为自己能看图，却只能看到
路径，可能据文件名编造内容。

### 修复

- `AcpSessionParams` 现在缓存 `AcpVisionPolicy`：未桥接/目标模型本身支持图片时不改
  prompt；纯文本桥接目标则在建会话时复用 `resolve_vision_delegate`，受同一
  `ModelAllowlistGate` 约束。
- `ImageAttachmentVisionHook` 注册在 ACP `PromptPipeline`。它只对
  `SendMessageData.files` 与 marker 后路径**按位置精确匹配**的图片扩展名生效；用户
  正文和非图片附件保持不变。
- 有视觉委托时先将图片描述替换进 prompt，成功后发出
  `AgentStreamEvent::DelegateUsage`，用量按视觉模型名记账；没有委托或调用失败则替换为
  明确的“无法读取图片，禁止根据文件名猜测/编造”提示，且单张失败不阻断其他附件。

### 验证与加载

- `cargo fmt --all -- --check`、`cargo clippy -p aionui-ai-agent -- -D warnings` 通过。
- `cargo test -p aionui-ai-agent` 通过；新增覆盖了未桥接字节不变、无委托诚实降级、
  委托描述/用量归属、单图失败继续处理，以及实际 pipeline 链路。
- 改的是 `1oneCore` Rust：必须运行
  `D:\aionui-m0\scripts\backend-rebuild.ps1`，再重启/运行
  `D:\aionui-m0\scripts\frontend-dev.ps1`；否则桌面端仍使用旧的 bundled backend。
- 真机检查：给桥接到纯文本模型的 Claude Code 或 Codex 会话附一张图，应获得真实委托
  描述或明确不可读提示，绝不能得到臆测的图片分析。

---

## 9. 纯文本桥接的本地 OCR 优先（后续补完）

### 策略

这条链路**只适用于已确认不支持图片输入的 Claude Code / Codex 桥接目标**：

1. 本机搜索当前用户可用的 Skill，并默认选择当前操作系统随包的 `local-ocr-*` Skill；
2. 将该 Skill 的真实脚本目录、操作说明和精确附件路径写入本轮 prompt，让外部 CLI
   在本机执行 OCR；
3. Skill 不可用时，才尝试受治理的视觉委托；委托的硬超时为 **5 秒**；
4. 两者都不可用/失败时，保留「内容不可读、禁止按文件名或上下文猜测」的终态提示。

**多模态模型绝不走这条链路。** `AcpVisionPolicy::NotBridged`（包括桥接目标本身有
图片能力）保持附件 prompt 原样，直接由目标模型读取。

### 随包 Skill

| 主机    | 默认 Skill          | 本地实现                              | 依赖策略                                      |
| ------- | ------------------- | ------------------------------------- | --------------------------------------------- |
| Windows | `local-ocr-windows` | `Windows.Media.Ocr` + PowerShell 脚本 | 使用系统用户语言包；不联网、不安装            |
| macOS   | `local-ocr-macos`   | Vision + Swift 脚本                   | 仅使用已安装的 Command Line Tools；不安装     |
| Linux   | `local-ocr-linux`   | Tesseract wrapper                     | 只使用已安装的 `tesseract` 与语言数据；不安装 |

脚本输出只代表可识别的**文字**，不是完整图像描述。脚本失败或缺语言包时必须如实说明，
不得上传附件、跑包管理器、或依路径/提示词推断图像内容。

### 打包与实机验证

- `aionui-extension/build.rs` 会递归声明 builtin-skill assets 的 Cargo 依赖；因此改动
  `SKILL.md` 或脚本也会重建内嵌语料，而不会因 `include_dir!` 缓存而保留旧内容。
- Windows 脚本同时接受原始 Win32 扩展路径前缀，以及 ACP→PowerShell 引号传递时少一条
  前导反斜杠的等价形态；两者都会先转换为普通绝对路径，再调用 WinRT OCR。
- 2026-08-18 已通过 DEV 的 CDP 附加真实 PNG：纯文本 Claude 桥接只执行了一次
  `local-ocr-windows/scripts/ocr.ps1`，原始扩展路径直接成功输出 OCR 文本；没有视觉
  委托和路径重试。

**verified:**

- `1oneCore/crates/aionui-ai-agent/src/capability/local_ocr_skill.rs`
- `1oneCore/crates/aionui-ai-agent/src/manager/acp/hooks.rs`
- `1oneCore/crates/aionui-ai-agent/src/manager/acp/vision_image_hook.rs`
- `1oneCore/crates/aionui-ai-agent/src/capability/image_description.rs`
- `1oneCore/crates/aionui-extension/build.rs`
- `1oneCore/crates/aionui-app/assets/builtin-skills/local-ocr-{windows,macos,linux}/`

---

## 10. 代码位置在 §8/§9 那轮重构后的变化（治理逻辑已逐项核实完好）

§8/§9 把视觉委托从工厂里抽了出来，所以本文 §2 提到的路径已经过期：

| 本文原写                                           | 现在                                 |
| -------------------------------------------------- | ------------------------------------ |
| `factory/aionrs.rs` 里的 `resolve_vision_delegate` | `capability/vision_delegate.rs`      |
| `factory/aionrs_vision_delegate_test.rs`           | `capability/vision_delegate_test.rs` |

**闸门没有在搬家中被削弱**，逐项核实过：

- 位置不变：仍在能力判定（`capability.supports_images()`）**之后**、
  `resolve_provider_config_for_bridge` **之前**——被封禁的模型不会把凭据解出来
- `Ok(false)` 与 `Err` **都** `continue`（fail closed），注释里的
  「a policy that cannot be evaluated is not a policy that passed」还在
- `VisionDelegate { config, policy_blocked }` 与 `unavailable_reason()` 都在
- 17 条测试全部存活：治理 6（`refuses_a_vision_model_the_company_allowlist_excludes`
  / `allows_…_includes` / `keeps_looking_past_a_policy_blocked_candidate` /
  `fails_closed_when_the_policy_check_itself_errors` /
  `without_a_gate_the_delegate_is_chosen_on_capability_alone` /
  `does_not_consult_the_gate_for_models_that_cannot_see_images`）+ relay 3 +
  orchestrator 3（+ aionrs 侧 read_image 5）
- `ModelAllowlistGate` / `AgentFactoryDeps.model_allowlist` /
  `BillingModelAllowlistGate` / `AppServices.billing` 均在原处
- ⛔ `capability/image_input.rs` **未被碰过**（最后一次改动仍是 `a1caef8e` 那次 revert）

---

## 11. 真机验证（2026-08-18 22:30，重编内嵌后）

**环境**：dev profile 的真实企业 `测试科技公司`（`one_enterprises`，
id `019f8aa0…`），成员 `system_default_user` role=admin、seat_status=active。
allowlist 存 `one_enterprise_license.allowed_models`。

**方法**：走**后端 HTTP 直连**（dev 本地模式无鉴权，端口见主进程日志
`AIONCORE_LISTENING`），比驱动 DOM 稳得多。
**关键简化**：`ReadImage` 是**按路径**调用的工具，所以不必上传附件——发一句
「用 ReadImage 读 &lt;绝对路径&gt;」即可触发委托。主模型固定 `minimax-2-7`
（被 `image_input.rs` 锁死为纯文本 lookalike，正好触发委托）。
为区分「真读了」与「编的」，用 PIL 生成了一张带随机码的验证图。

⚠️ **必踩的挂起点**：`ReadImage` 会触发权限确认，不批准 turn 会一直挂着。
批准端点 `POST /api/conversations/{id}/confirmations/{call_id}/confirm`，
body `{"msg_id":…,"data":{"value":"proceed_always"},"always_allow":true}`；
`msg_id` **不在** confirmations 列表返回里，要从日志的 `session_id=… msg_id=…` 取，
形状写错只回 `Invalid JSON request body.`、不告诉你缺哪个字段。

⚠️ 每条判据都要**新开会话**——委托在 session 构建时解析一次并缓存整个会话（§5）。
`BillingService::license_of` 无缓存、直改库立即生效。

### 判据 ①：allowlist 只留 `["minimax-2-7"]`（会话 `aa914503`）

- 4 个视觉模型被**逐个点名**拦下，`policy_blocked=4`：
  ```
  Vision-capable model skipped: not allowed by the company's model policy
    conversation_id=aa914503 vision_model=kimi-k2-6
    …=gemini-3-5-flash / gemini-3-pro-image / gemini-3-pro-image-preview
  No vision-capable model available; images will be reported as unreadable
    conversation_id=aa914503 policy_blocked=4
  ```
- ReadImage 返给模型的原文是**策略原因**，不是「去设置里加视觉模型」：

  > Your organization's model policy does not allow the vision-capable model(s)
  > configured here (kimi-k2-6, gemini-3-5-flash, gemini-3-pro-image,
  > gemini-3-pro-image-preview). Ask an administrator to add one to the allowed
  > models list.

  且**反编造那句仍在**：`Do NOT guess, infer from the file name, or invent what
the image shows.`

- 模型照实转达（点明是组织策略、让找管理员），并明确拒绝猜图
- 账本 `one_usage_events`：该会话**只 1 行**（主模型行），**无委托幽灵行** ✅

### 判据 ②：allowlist 改为 `["minimax-2-7","kimi-k2-6"]`（会话 `deca178f`）

刻意用「显式包含委托模型」而不是「清空 allowlist」——后者走的是
`allowed_models.is_empty()` 的短路，证明不了闸门被问到并放行。

- `Resolved vision delegate for text-only session … vision_model=kimi-k2-6`
- 委托**真跑通**：ReadImage 输出 `as read by vision model 'kimi-k2-6' (openai)`，
  模型报出的文字与验证图**逐字一致**（`VERIFY-7Q4XB2` / `vision delegate check`）
  ——证明是真读到，不是编的
- 账本：该会话**2 行**，其中一行 `model='kimi-k2-6'`（**委托模型名**，
  in=479 / out=309 / total=788 / cost=702 micros），与主模型行**分开、未合并** ✅

验证用的 allowlist 改动**已还原为原始的 NULL**；两个测试会话留作证据未删。

### 顺带发现的既有现象（不在本轮范围，未修）

账本里**主模型那一行的 `model` 与 `estimated_cost_micros` 列一直是 NULL**——
全库 127 行里带模型名的只有委托行。也就是说本轮让委托花费「看得见」了，而
**主模型这一侧的计价本来就没落到账上**。这是主路径计量的长期状况、与本轮改动无关，
但它意味着成本上限对主模型花费目前是失效的，值得单独查一轮。
