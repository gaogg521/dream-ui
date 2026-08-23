# 交接：2026-08-18 收尾后仍未做的事

> 上一份是 [`handoff-2026-08-17-remaining.zh-CN.md`](handoff-2026-08-17-remaining.zh-CN.md)，
> 它列的 10 项已全部处置（那份文档顶部有逐条结论，**并保留了三条被证伪的前提**，
> 建议先读那一段再读这份）。
>
> 这份只列**这一轮之后还剩什么**，以及**这一轮新发现、已确认但没修的**。

---

## 0. 一句话现状

|               |                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 版本          | `2.1.55`，Windows 安装包已出：`1oneUI/out/One-Work-2.1.55-win-x64.exe`                                                                         |
| ⚠️ 安装包内容 | **不含本轮最后四个修复**（安全修复 + 三处调用缺陷）——它们是打完包之后才提交的                                                                  |
| 三仓 HEAD     | **已过期**——2026-08-18 晚起有多个会话并行推进，读这份文档前先自己 `git log` 一次                                                               |
| 🔴 最要紧     | **§3.0 聊天花费从不入账、企业成本上限对聊天完全失效**（已追到根因，未修）。§1 那个 P0 已完成，但它只补上「委托」这条路径；主模型这条从来没接上 |
| 门禁          | lint 0 / format:check 0 / tsc 0 / test 0（452 文件 4018 测试，无 `Errors` 行）                                                                 |

**要发出这四个修复，必须重编内嵌后端 + 重新打包**（安全修复在 1oneCore，Windows
打包用的是本地编译的 aioncore）。

---

## 1. ✅ P0：视觉委托绕过企业治理（**已于 2026-08-18 修复**）

> ✅ **已全部收尾（2026-08-18 22:35）**：三仓均已提交推送、临时 `[patch]` 块已删、
> 内嵌已重编、真机两条判据均已通过。**这一项不需要再做任何事。**
> 收尾实况（含那次合并推送留下的"主干编不过"缺陷及其修复）见
> [`handoff-2026-08-18b-vision-delegate-wip.zh-CN.md`](handoff-2026-08-18b-vision-delegate-wip.zh-CN.md) §0.5。
>
> **不要重做。** 两个洞（A 走 `ModelAllowlistGate` trait 注入过闸、B 跨三仓把
> 用量穿回 `record_turn`）都已修，附带修掉「被 allowlist 拦掉时报错说假话」。
> 三条负向验证均做过。经过、拍板理由与已知边界见
> [`session-2026-08-18-vision-delegate-governance.zh-CN.md`](session-2026-08-18-vision-delegate-governance.zh-CN.md)。
> 下面保留原始诊断作为背景。

本轮给纯文本模型加了读图能力：`ReadImage` 工具委托给一个单独的视觉模型。
这条**新的模型调用路径**没有被任何治理层看到。两个独立的洞：

### A. 可以使用企业 allowlist 禁止的模型

`resolve_vision_delegate`（`1oneCore/crates/aionui-ai-agent/src/factory/aionrs.rs:341`）
从用户已配置的 provider 里挑视觉模型，**不查 allowlist**。

全仓 allowlist 只有两个强制点，都覆盖不到它：

- `crates/aionui-conversation/src/routes.rs:323` 的 `check_send`（发消息时，查会话模型）
- `crates/aionui-conversation/src/routes_aux.rs:44` 的 `check_model`（用户改模型设置时）

管理员把某个模型踢出清单后，它仍可能被当视觉委托调用。

### B. 这次调用的 token 用量被丢弃

`LlmEvent::Done { stop_reason, usage: TokenUsage }` **是带用量的**
（`aionrs-local/crates/aion-types/src/llm.rs:52`），但
`aionrs-local/crates/aion-tools/src/read_image.rs` 里写的是
`LlmEvent::Done { .. } => break` —— 用量直接丢掉。

而 1oneCore 只记主模型那一次（`crates/aionui-conversation/src/turn_orchestrator.rs:369`
的 `record_turn(… outcome.input_tokens, outcome.output_tokens)`）。

**后果**：企业成本上限与用量看板看不见这笔花费。公司设了上限，仍会被计费。

### 为什么建议单独立项

修 A 需要让 `aionui-ai-agent` 够到 `one-billing` 的判定。两者**同层**，按本仓既有
安排只能走 trait 注入（照 `EnterpriseSync` / `CredentialRevoker` 的做法）。
修 B 需要把用量从 `aion-tools` 一路穿回 1oneCore 的 `record_turn`，跨三仓。

**这和你们在媒体生成上踩过的是同一类洞**，根因也是同一条：给既有能力开了一条
新的到达路径，旧路径上「顺手就有」的治理没跟过来，而且缺了不报错。

---

## 2. 🟠 会话分叉：已确认但未修的语义与体验问题

分叉功能本轮从零完整移植（后端 + 前端 + 迁移 048/049），主链路已真机验证通过
（端点 201、血缘记录、徽标可见、错误码映射有测试）。下面是审查确认、但**没修**的：

### 2.1 at_turn 分叉的语义错位（最要紧的一条）

**UI 按「消息」给入口，引擎按「turn」截断。**

- 后端解析锚点：`crates/aionui-conversation/src/service.rs:2686` 起，取「分叉点或之前
  最近一条非 NULL 的 `backend_turn_id`」
- 引擎截断：`aionrs-local/crates/aion-agent/src/session.rs` 的 `fork_from`，
  `rposition(...)` + `truncate(cut + 1)` —— 截到该 turn 的**最后一条**
- 可见历史复制：`copy_messages_up_to` 是**消息级**精度

**后果**：在一个 turn 内部（不是最后一条）分叉，可见历史停在点击处，但 agent
上下文包含该 turn 剩余全部内容。模型会依据用户看不见的内容作答。

这正是前端 `forkConversation.ts` 注释里声称要避免的情形——head-only 后端确实
避免了，at_turn 后端只在 turn 粒度上避免。而 aionrs 是默认后端且迁移 049 给它
硬编码了 `at_turn: true`，所以这是主路径。

**附带**：用户消息行不带锚点（`service.rs:3428` 写 `backend_turn_id: None`），
所以在用户消息上分叉会解析到**上一个** turn 的锚点——方向反过来，可见历史多出
一条引擎不知道的用户消息。两个方向都不一致。

### 2.2 分叉与父会话共用工作目录

`extra` 是父的逐字拷贝（`service.rs:2723`），包括 `workspace`。这是**设计选择**
（注释：claude keys on-disk sessions by cwd），但代价没有被处理：

- 两个会话可以同时运行、写同一批文件、互相覆盖，UI 上**没有任何提示**
- 由此导致**自动工作区目录永久泄漏**：删除识别按 `-temp-<会话id>` 后缀
  （`service.rs:4437`），分叉继承的是**父的**后缀，所以删分叉时直接
  `return None`，删父时又被「有关联会话就跳过」的守卫拦住 → 两个都删完，目录还在

### 2.3 移动端完全没有分叉入口

`MessageText.tsx:330` 的 `{!isMobile && showCopyRow && (…)}` 把 `forkButton` 一起
包进去了。注释解释的是**复制行**为什么在移动端去掉（没有 hover），分叉是被顺带
埋进去的。需要设计一个移动端入口（长按？菜单？），属产品决策。

### 2.4 `is_head` 把 hidden 行算进「最新」，前端不算

- 后端 `service.rs:2670` 的 `is_head` 用 `list_messages_page(InitialLatest, limit 1)`，
  该查询（`sqlite_conversation.rs:688`）只排除 `cron_trigger`/`skill_suggest`，
  **不过滤 `hidden`**
- 前端 `MessageList.tsx:418` 是 `if (message.hidden) continue;`

**后果**：会话末尾有 hidden 行时，前端在最后一条可见消息上显示分叉按钮，点了报 422
——正是本次设计明确想避免的「点了报错的按钮」。

### 2.5 其它已确认的小问题

| 问题                                                                                                                                                   | 位置                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 团队会话那条错误路径没有 `FORK_*` 前缀，且 `ApiError::Forbidden` 把 reason 抹成裸 "Forbidden."（目前 UI 不显示按钮所以只有直接打 API 才撞上）          | `service.rs:2605` + `aionui-common/src/error.rs:185` |
| `errorPointUnsupported` 一条文案覆盖两个语义相反的后端原因（「这条消息太老」vs「该 agent 只支持最新」），zh-CN 文案对第一种情况是错的                  | `service.rs:2700` / `:2708`                          |
| 前端永远发 `msg_id`，后端主查询（按行 id）是死路径，全落到「取最早匹配行」兜底；`msg_id` 在会话内并不唯一（既有 `get_message_by_msg_id` 用三元组定位） | `MessageText.tsx:233` + `service.rs:2657`            |
| `forkingRef` 防重入粒度是「每条消息」不是「每个会话」（`MessageText` 是逐条渲染的），且虚拟滚动卸载重挂会让 ref 归零                                   | `useForkConversation.ts:38`                          |
| doc comment 写 422，但 `to_agent_error` 路径映射成 400                                                                                                 | `service.rs:2589` + `conversation/src/error.rs:123`  |

---

## 3. 🟡 其它已确认未修

### 3.0 🔴 聊天花费从不入账,企业成本上限对聊天完全失效(2026-08-18 发现,已追到根因,未修)

**这是当前清单里影响最大的一条**,也是与 §1 同一类的洞:§1 修的是"委托这条模型调用
路径对治理不可见",而**主模型这条路径从来就没接上**。

**机制**(四步,每步都核实到代码行):

1. 1oneCore 内嵌的是 `aion-agent` 库,而 `OutputSink::emit_stream_end`——唯一携带
   model + 真实 token 数的那个回调——**只有 `aion-cli` 调**
   (`aion-cli/src/run.rs`、`aion-cli/src/json_stream/message.rs`),
   `aion-agent` 全仓零调用。所以 1oneCore 里那个写得很完整、还配了
   `emit_stream_end_carries_the_model_and_real_token_counts` 测试的
   `BackendOutputSink::emit_stream_end`,**在内嵌路径上是死代码**。
2. 内嵌路径实际发的是 `runtime.emit_finish(None)`
   (`manager/aionrs/agent.rs:464`,ACP 侧同理见 `manager/acp/agent.rs:1509/1519/1531`),
   构造 `FinishEventData { session_id, ..Default::default() }` → **model / tokens 全 None**。
3. relay 取出它交给 `turn_orchestrator::meter_attempt` →
   `record_turn(model=None, tokens=None)` → 落一行 `model` 与
   `estimated_cost_micros` 双 NULL 的记录。
4. `budget_used_micros` / `department_budget_used_micros` 是
   `SUM(estimated_cost_micros)`,**SUM 直接跳过 NULL**。

**范围是所有聊天**,不只 aionrs。核过 ACP 路径唯一填 `input_tokens` 的生产代码是
`vision_image_hook.rs:224`,那也是**委托**用量而非主模型;
`agent_session_flow.rs:908` 那处带字段的 `FinishEventData` 在测试模块内。

**真机证据**(dev profile,2026-08-18):`one_usage_events` 127 行里 **94 行**
model/cost 双 NULL;带成本的只有媒体生成(seedream / seedance / gpt-image / agnes,
来自 `record_media_usage`)与 `kimi-k2-6` ×3——后者恰恰是 §1 刚修好的视觉委托。
即成本上限目前**只统计媒体生成 + 视觉委托,聊天一分不算**。

**两个让它长期藏住的原因(改之前务必知道)**:

- `protocol/events/mod.rs:160` 的注释明写 FinishEventData
  "always carry them — see `BackendOutputSink::emit_stream_end`"。
  **这个不变量在内嵌路径上不成立**,但读代码的人会信它。修的时候要连注释一起改。
- `record_turn` 里那个专为「上限不动了」加的诊断 warn 条件是 `cost == Some(0)`;
  而 model 为 None 时 `cost = model.map(...)` 直接是 `None`,**warn 一次都不会响**。
  为发现这类问题而加的口子,恰好漏掉了实际发生的那个 case。

**两条修法(需拍板,均未动)**:

- **aionrs 侧**:让引擎在 run 结束时调 `emit_stream_end`(它手里有 usage),
  1oneCore 那侧现成的实现即刻生效。跨仓,要走「先推 aionrs → bump lock → 重编内嵌」。
- **1oneCore 侧**:让 `emit_finish` 带上用量,前提是 `engine.run()` 能把 usage 交出来。

⚠️ **无论哪条都必须处理竞态**:relay 收到**第一个** Finish 就跳出循环,而
`emit_stream_end` 绕过了 `emit_finish` 的吸收态幂等(`agent_runtime.rs::emit_finish`
的 Finished 吸收态只管自己),两处都发会打架、谁先到谁赢。
另注意 ChannelClosed 出口(`stream_relay.rs:672` 附近)用的是
`FinishEventData::default()`,那条路径本身就没有 usage 可带,属合理缺失。

**算做完**:一次真实聊天轮后,`one_usage_events` 出现带会话模型名与非零
`estimated_cost_micros` 的行;把公司 `monthly_cost_cap_micros` 设成极小值后,
下一次发送被 `BudgetExceeded` 拦住(今天这条链路是拦不住的)。

### 3.1 会话中心表头/模式列在 11 种语言下显示简体中文

`conversation.sessionCenter.colTitle/colMode/colModel/colUpdatedAt` 与
`modeChat/modeImage/modeVideo` 只有 `en-US` 与 `zh-CN` 有，其余 11 种缺失。
**属既有问题**（不是本轮引入）。

⚠️ 但本轮新增的 `SessionCenter.dom.test.tsx` 把 `t` mock 成
`options?.defaultValue ?? key`（`:81`），锁的是源码里硬编码的中文 `defaultValue`，
所以**这个测试结构上永远发现不了缺 key**。

### 3.2 `releasePackagingConfig` 的超时是无效的

`tests/unit/releasePackagingConfig.test.ts:107`/`:117` 用 `spawnSync` 且**没传
`timeout` 选项**。`spawnSync` 同步阻塞 worker，vitest 的 `testTimeout` 根本没机会
触发——本轮把它从 30s 抬到 120s 对「脚本挂住」这一情形**完全无效**。
正确修法是给 `spawnSync` 加 `timeout` + `killSignal`。

### 3.3 `remote-allow-origins` 可能让 `cdp.md` 的手动排查指引走不通（存疑，未实测）

`configureChromium.ts:362` 只放行 `http://127.0.0.1:${port}`。但从
`chrome://inspect` / DevTools 前端发起的 CDP 握手，Origin 是 `devtools://devtools`。
若如此，`cdp.md` 里「Inspect by hand」那两条会失败。

**不影响主用法**：裸 ws 客户端不发 Origin（`cdp.md` 推荐的就是这条，本轮所有真机
验证都走它），chrome-devtools-mcp 也不发。

### 3.4 dev 下端口写错时完全静默

`configureChromium.ts:366` 的告警分支条件是 `env && app.isPackaged`，所以 dev 下
设成 `80` / `9230abc` 时既不开也不打日志，而 `cdp.md` 明写「启动时会有一条醒目
日志确认」。人会以为开了。

### 3.5 既有的红测试与 flaky（非本轮引入，已用干净基线逐条复现）

- 1oneCore `cargo test --workspace` 有 **8 条既有失败**：`aionui-project` 的
  scm/discard 6 条 + `scm_request_path` 1 条 + `team_e2e` 的 Windows 尾随空格 1 条
  （最后那条是 07-18 上游同步带入的已知缺陷，一直没修）
- aionrs 有 **6 条 timeout 测试在重负载下 flaky**（单独跑全绿）。根因是 Windows
  逐进程杀软扫描让进程创建变贵——**下面第 4 节那条杀软排除能顺带改善它**
- 🆕 **1oneUI 的 `bun run test` 在 Windows 上不再是全绿**（§0 那行"test 0"已过期）：
  `tests/unit/common/imageGenCore.test.ts` 有 **3 条失败**，全是
  `EPERM: operation not permitted, symlink`。测试用 `symlinkSync` 造符号链接，
  **Windows 建符号链接要管理员权限或开发者模式**，Linux/macOS 无需。
  来源是更早同步进来的上游安全修复 `3f700a805`（image generation MCP 路径穿越防护），
  **不是本地引入**。2026-08-19 实测：456 文件 / 4055 测试，1 文件 3 条失败。
  ⚠️ **这是一条「本机红、CI 绿」的分歧**（CI 跑 Linux/macOS runner，symlink 无需提权），
  与 08-14 那次「本机绿、CI 红」正好相反——**判断门禁状态时要先问这台机器能不能建
  符号链接**，否则会把环境限制误当成代码回归。要在 Windows 上跑绿需开「开发者模式」。

### 3.6 `asarUnpack` 有一条过期项

`packages/desktop/electron-builder.yml` 里的 `out/main/team-mcp-stdio.js` 既不构建
也无任何源码引用。glob 匹配不到文件属无害，但会误导。**刻意没在验证过的打包配置
上再动手**，留给下次。

---

## 4. ⬜ 人工项（AI 不代做）

### 4.1 License 公私钥轮换

当前内置的是**开发占位公钥**，私钥已泄露（会话里打印过，且明文在桌面 `feishu.txt`）。

```bash
cd D:\aionui-m0\1oneCore && cargo run -p license_tool -- keygen --out D:\keys\license-2026-08.json
```

⚠️ **不要把输出贴进任何对话**。只把 public key 填进内置常量，私钥离线保管。

### 4.2 给托管 node 目录加杀软排除

本机启动一个 node 要 1~1.7 秒（Defender 逐进程扫 89.8MB `node.exe`），
是 `npx` 型 MCP 慢且不稳的根因，也是 3.5 节那 6 条 flaky 的根因。

需**管理员** PowerShell：

```powershell
Add-MpPreference -ExclusionPath "$env:APPDATA\1one-Dev\1one\runtime\node"
```

---

## 5. 📦 发版注意

1. **当前安装包不含最后四个修复**，要发就得重编内嵌 + 重新打包。
   ⚠️ **2026-08-18 追加**：视觉委托治理修复（§1）也在打包之后落地，同样**不在**
   现有安装包里，且它同时改了 1oneCore 与 aionrs——发版前必须先重编内嵌后端。
2. **只出了 Windows 包。** 要出 Mac 包必须**先给 1oneCore 打新 tag 发 Release**
   ——Mac CI 按 `package.json` 的 `aioncoreVersion` 从 Release 下载后端，不发新 tag
   会拿到**不含本轮后端改动的旧二进制，且不会报任何错**。
3. 打包前跑完 [`mac-packaging-preflight.zh-CN.md`](mac-packaging-preflight.zh-CN.md) §1
   的四条，**且它们必须是推送前的最后动作**（本轮踩过一次：改完文档没重新格式化，
   `format:check` 红）。判据是「0 failed **且** 0 errors」。
4. 不许删任何旧 `.exe` 安装包。

---

## 6. 🔧 方法论：本轮值得写进流程的四条

### 6.1 交接文档与子任务的结论是线索，不是事实

上一份交接文档有 **3 条前提被证伪**，全是「某某已存在/不存在」这类**存在性断言**：

- 「会话分叉后端已合入，只差前端」→ 端点在 1oneCore 整个不存在，直接合前端会做出
  一个必然 404 的按钮
- 「`eb4bd7f7` 撞 fork 自己改过的 `watch_service.rs`」→ fork 对那几个文件**零独立
  改动**（blob 哈希逐字节相同）
- 「`b678d839e` 是 `eb4bd7f7` 的前端半边」→ 二者**无依赖**，分组错误

**判据必须是自己开文件核对。一个没查到的文件就能推翻一条存在性断言。**

### 6.2 中途被打断的负向验证会留下没恢复的破坏

本轮真实发生：一个子任务在「故意破坏 → 看测试是否变红」的中途因额度中断，
工作区里留下了

```rust
return ToolResult { content: String::new(), is_error: false };
```

——正好让「没有视觉模型」时静默返回空结果，即这个功能要防的那个失败模式。

**接手任何被打断的工作，先全仓搜 `unreachable_code` / `NEGATIVE` / `TEMPORARY`
这类标记，再跑测试。**

### 6.3 测试输入必须真的走到被断言的那条路径

本轮我自己写出过一条**假绿测试**：给上面那个安全修复配的「保留分叉血缘」测试，
第一版只发 `{"name":"Renamed"}` **不带 `extra`**，而 `extra: None` 时整个 merge
分支被跳过 → 对着它要防的 bug 也是绿的。是做负向验证时才暴露的。

**「绿」只对你真正跑到的那条路径有意义。**

### 6.4 守卫存在 ≠ 守卫覆盖

本轮抓到的缺陷有一个共同形状：**守卫写了，但只覆盖了一半路径**。

- `create` 剥离 `extra.fork` 且有测试，`update` 没有 → 同样的载荷换个动词就进来
- 共享常量 `NON_MESSAGE_ITEM_TYPES` 含 `media_job`，两处手写副本都漏了它
- 「保存并关闭」有错误提示，新加的保存按钮没有

都不是「忘了写」，是**「写了，但没覆盖到新开的那条路」**。
加新入口/新路径时，把旧路径上已有的守卫逐条数一遍。

---

## 7. 本轮改了什么（速查）

| 仓       | 提交范围               | 内容                                                                                                                            |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| aionrs   | `e4d1638..1d485e5`     | `ReadImage` 工具（纯文本模型读图）+ `image_source` 共用模块                                                                     |
| 1oneCore | `9529e55b..f5120f15`   | 会话分叉后端（迁移 048/049）、视觉委托解析、claude CLI 2.1.233、pi-acp 断言漂移修复、**`extra.fork` 注入漏洞修复**              |
| 1oneUI   | `62bf35d61..d184f2044` | CDP 调试端口恢复 + `cdp.md` 重写、会话分叉前端、预览保存按钮、flaky 修复、SessionCenter 测试、2.1.55 发版、**三处调用缺陷修复** |

真机验证过的：CDP 双向闸门、图片识别端到端（视觉委托 `kimi-k2-6` 真的读出图片内容）、
会话分叉端到端、预览保存按钮渲染、打包产物的 `asarUnpack` 与 CLI 版本。

---

## 8. 📋 交接话术（直接复制给新会话，每段自包含）

> 下面每段都可以**原样粘贴**给一个新的 AI 会话。「必读什么、坑在哪、什么算做完、
> 什么绝对不要做」都写进去了，新会话不需要看这轮对话。
>
> **共同前置**（每段开头都带了）：工作目录 `D:\aionui-m0`，三仓 fork
> （`1oneUI` 前端 Electron / `1oneCore` Rust 后端 / `aionrs-local` agent 引擎），
> 只单向同步上游、永不反向提 PR。
>
> **建议顺序**：~~A 最要紧且独立~~（**A 已完成 2026-08-18**）→ B/C 是同一个功能的
> 两半，建议同一会话连做 → D 依赖 B/C 做完 → E/F 可任意时候并行 → G 是你自己的事。

---

### ~~话术 A —— 视觉委托绕过企业治理（P0，最该先做）~~ ✅ 已完成 2026-08-18

> ✅ **代码与收尾都已做完，这一段整段作废，不要再派。**（实现、1oneCore 提交、
> 删 patch、重编内嵌、真机验证全部完成）记录见
> [`handoff-2026-08-18b-vision-delegate-wip.zh-CN.md`](handoff-2026-08-18b-vision-delegate-wip.zh-CN.md) §0.5。

```
工作目录 D:\aionui-m0，三仓 fork：1oneUI(前端Electron) / 1oneCore(Rust后端) /
aionrs-local(agent引擎)。只单向同步上游、永不反向提 PR。
先读 1oneUI/docs/guides/handoff-2026-08-18-remaining.zh-CN.md 的 §1。

任务：让「视觉委托」这条新的模型调用路径受企业治理管辖。

## 背景
2026-08-18 那轮给纯文本模型加了读图能力：模型调 aionrs 的 ReadImage 工具，
该工具委托给一个单独配置的视觉模型，把图片转成文字返回。功能本身已真机验证
通过（deepseek-v4-flash 通过委托 kimi-k2-6 真的读出了图片内容）。

问题是这条**新的模型调用路径**没有被任何治理层看到。两个独立的洞，已核实：

A) 可以使用企业 allowlist 禁止的模型
   resolve_vision_delegate（1oneCore/crates/aionui-ai-agent/src/factory/aionrs.rs:341）
   从用户已配置的 provider 里挑视觉模型，不查 allowlist。
   全仓 allowlist 只有两个强制点，都在「会话模型」那一侧、覆盖不到委托：
     - crates/aionui-conversation/src/routes.rs:323 的 check_send
     - crates/aionui-conversation/src/routes_aux.rs:44 的 check_model
   （我 grep 过 `.check_model(` 与 `.check_send(` 的全部调用点，各只有一处。
     你自己再核一遍，别继承我的结论。）

B) 这次调用的 token 用量被丢弃
   LlmEvent::Done { stop_reason, usage: TokenUsage } 是带用量的
   （aionrs-local/crates/aion-types/src/llm.rs:52），但
   aionrs-local/crates/aion-tools/src/read_image.rs 里写的是
   `LlmEvent::Done { .. } => break` —— 用量直接丢掉。
   而 1oneCore 只记主模型那一次
   （crates/aionui-conversation/src/turn_orchestrator.rs:369 的 record_turn）。

后果：企业成本上限与用量看板看不见这笔花费。公司设了上限，仍会被计费。

## 为什么不是随手能改
修 A 要让 aionui-ai-agent 够到 one-billing 的判定，而两者**同层**——按本仓既有
安排只能走 trait 注入。**照抄现成的两个先例**：one_org::CredentialRevoker 和
EnterpriseSync，它们解决的是同一个「同层 crate 不能直接依赖」的问题。
⚠️ 注意本仓有一条硬约束：one_devops_service 必须在 one_org_service 之前构造
（routes.rs 里有注释）。加新的 trait 注入时要顺着构造顺序数一遍，谁被依赖谁先造。

修 B 要把用量从 aion-tools 一路穿回 1oneCore 的 record_turn，跨三仓。
⚠️ 推送顺序不可颠倒：先推 aionrs → 删掉 1oneCore/Cargo.toml 末尾可能存在的临时
[patch] 块 → cargo 重新解析让 Cargo.lock 指向新 commit → 再推 1oneCore → 最后 1oneUI。

## 设计上要你拍板的
用量记进账本时，模型名记哪个？记委托模型（kimi-k2-6）更真实，但要确认
record_turn / one-billing 的费率表按模型名匹配时认得它；记主模型会misattribute。
**未知模型计价为 0 是本仓刻意行为**（有测试钉死，见 one-billing 注释：0 成本不消耗
成本上限、等于上限对该模型悄悄失效，所以只打 warn 不发明兜底费率）——
所以如果委托模型匹配不上费率表，你会得到一笔 0 元账，这本身是要处理的。

## ⛔ 绝对不要做
不要放宽 1oneCore/crates/aionui-ai-agent/src/capability/image_input.rs 的能力判定
或白名单。它有测试锁死 minimax-2-7 / deepseek-v4-flash 这类纯文本 lookalike
不许被误放行，是刻意设计。曾有人把「自定义网关未匹配模型」的默认值从 Unknown
改成 Supported（提交 7cf40b96），被用户当场否掉并 revert（a1caef8e）。
resolve_vision_delegate 现在的写法是对的——它复用既有判定、只扩大「检查哪些模型」，
不改变判断本身。保持这一点。

## 算做完
- allowlist：管理员把某模型踢出清单后，它不能再被选作视觉委托（补测试锁死）
- 用量：委托调用的 token 出现在企业用量账本里，成本上限能看见它
- 两条都做**负向验证**（破坏掉，确认正是你预期的那几条测试变红），并在汇报里写出来
- cargo test 取被测命令自己的退出码：`cargo test -p X --no-fail-fast > log 2>&1; echo $?`
  绝不要 `cargo test ... | grep ...`（管道退出码是 grep 的）
- 改完 1oneCore 的 Rust 必须跑 D:\aionui-m0\scripts\backend-rebuild.ps1 重编内嵌，
  否则 dev 用的还是旧后端（跑之前先确认应用没在跑，否则 EPERM；
  ⚠️ 不要用 `*>` 或 `2>&1` 重定向它的输出，PS 5.1 会把 cargo 的 stderr 包成
  ErrorRecord 报 NativeCommandError，看起来像编译失败其实没有）
```

---

### 话术 B —— 会话分叉的 at_turn 语义错位（P1，本功能最要紧的一条）

```
工作目录 D:\aionui-m0，三仓 fork：1oneUI / 1oneCore / aionrs-local。
先读 1oneUI/docs/guides/handoff-2026-08-18-remaining.zh-CN.md 的 §2.1。

任务：修掉会话分叉的「UI 按消息分叉、引擎按 turn 截断」这个语义错位。

## 现状（已核实到代码行，但请自己开文件复核）
- 后端解析锚点：1oneCore/crates/aionui-conversation/src/service.rs:2686 起，
  取「分叉点或之前最近一条非 NULL 的 backend_turn_id」
- 引擎截断：aionrs-local/crates/aion-agent/src/session.rs 的 fork_from，
  rposition(...) + truncate(cut + 1) —— 截到该 turn 的**最后一条**
- 可见历史复制：copy_messages_up_to 是**消息级**精度

后果：在一个 turn 内部（不是最后一条）分叉，可见历史停在用户点击处，但 agent
上下文包含该 turn 剩余的全部内容。**模型会依据用户看不见的内容作答。**

这正是前端 1oneUI/packages/desktop/src/common/chat/forkConversation.ts 的注释里
声称要避免的情形——head-only 后端（claude/ACP）确实避免了，at_turn 后端只在
turn 粒度上避免。而 aionrs 是默认后端、迁移 049 给它硬编码了 at_turn: true，
所以这是主路径而非边角。

附带，方向相反的另一半：用户消息行不带锚点（service.rs:3428 写
backend_turn_id: None），所以在用户消息上分叉会解析到**上一个** turn 的锚点，
可见历史反而多出一条引擎不知道的用户消息。两个方向都不一致。

## 可选方向（你评估后选，或提更好的）
1. 让 UI 只在「turn 边界」给分叉入口（最小改动，但会减少入口数量，
   且要想清楚用户消息那一半怎么办）
2. 让可见历史的复制也按 turn 对齐（改 copy_messages_up_to 的游标语义，
   风险是影响既有的复制行为）
3. 给引擎加消息级截断能力（改动最大，跨到 aionrs）

## ⚠️ 必守
- 不要为了对齐语义去动 route_for_backend 的 claude/codex → AcpManager 这条
  fork 分歧点（1oneCore/crates/aionui-ai-agent/src/factory/acp.rs 有测试锁死，
  注释写明「Fork contract, inverted from upstream」）。上游把它们指回 DirectCli，
  本 fork 刻意不采纳，那是为了保住自定义模型的桥接注入。
- 判定测试通过必须取被测命令自己的退出码，不要隔着管道看。
- 改完 Rust 要 backend-rebuild.ps1 重编内嵌。

## 算做完
分叉出的会话，**可见历史与 agent 上下文一致**；用户消息与 assistant 消息两个方向
都验过；补测试锁死这条一致性；做负向验证并写出来。
```

---

### 话术 C —— 会话分叉其余已确认未修项（P1，可与 B 同会话连做）

```
工作目录 D:\aionui-m0，三仓 fork：1oneUI / 1oneCore / aionrs-local。
先读 1oneUI/docs/guides/handoff-2026-08-18-remaining.zh-CN.md 的 §2.2~§2.5。

任务：清掉会话分叉功能里已确认、但上一轮没修的问题。下面每条都给了证据位置，
**请自己开文件复核后再动手**——上一份交接文档里有三条前提被证伪过，全是
「某某已存在/不存在」这类存在性断言。

## 1. 分叉与父会话共用工作目录，且导致目录永久泄漏
extra 是父的逐字拷贝（service.rs:2723），包括 workspace。共用本身是**设计选择**
（注释：claude keys on-disk sessions by cwd），但代价没处理：
 - 两个会话可同时运行、写同一批文件、互相覆盖，UI 上没有任何提示
 - 自动工作区目录**永久泄漏**：删除识别按 `-temp-<会话id>` 后缀（service.rs:4437），
   分叉继承的是**父的**后缀 → 删分叉时直接 return None；删父时又被
   「有关联会话就跳过」的守卫拦住 → 两个都删完，目录还在
先决定共用还是各用（这是产品决策），再修泄漏。

## 2. 移动端完全没有分叉入口
1oneUI/.../Messages/components/MessageText.tsx:330 的
`{!isMobile && showCopyRow && (…)}` 把 forkButton 一起包进去了。
注释解释的是**复制行**为什么在移动端去掉（没有 hover），分叉是被顺带埋进去的。
需要设计一个移动端入口（长按？菜单？）。

## 3. is_head 把 hidden 行算进「最新」，前端不算 → 点了报 422 的按钮
 - 后端 service.rs:2670 的 is_head 用 list_messages_page(InitialLatest, limit 1)，
   该查询（aionui-db/src/repository/sqlite_conversation.rs:688）只排除
   cron_trigger / skill_suggest，**不过滤 hidden**
 - 前端 MessageList.tsx:418 是 `if (message.hidden) continue;`
后果：会话末尾有 hidden 行时，前端在最后一条可见消息上显示按钮，点了 422 ——
正是本次设计明确想避免的。

## 4. 四条小问题
 - 团队会话那条错误路径没有 FORK_* 前缀，且 ApiError::Forbidden 把 reason 抹成
   裸 "Forbidden."（service.rs:2605 + aionui-common/src/error.rs:185）。
   ⚠️ 该抹除有测试锁死，给用户看的文案要走 ApiError::Coded 那条路，别去改 Forbidden。
 - errorPointUnsupported 一条文案覆盖两个语义相反的后端原因
   （service.rs:2700「这条消息太老」vs :2708「该 agent 只支持最新」），
   zh-CN 文案对第一种情况是错的。拆成两个 key（13 语言补齐）。
 - 前端永远发 msg_id（MessageText.tsx:233），后端主查询按行 id（service.rs:2657）
   是死路径，全落到「取最早匹配行」兜底；而 msg_id 在会话内并不唯一
   （既有 get_message_by_msg_id 用 (conversation_id, msg_id, type) 三元组定位）。
 - forkingRef 防重入粒度是「每条消息」不是「每个会话」
   （useForkConversation.ts:38，而 MessageText 是逐条渲染的），
   且消息列表是虚拟滚动的，卸载重挂会让 ref 归零。
   ⚠️ 本仓踩过一模一样的坑：「ref 跟着组件实例死，store 里的数据不死」。
   真正的会话级防重入要放在 store 或 hook 之上。

## ⚠️ 必守
- 新增用户可见文案必须走 i18n，13 语言 key 补齐（不会的语言用英文占位），
  否则 `node scripts/check-i18n.js` 不过。
- UI 用 @arco-design/web-react（禁裸 <button>/<input>）、图标 @icon-park/react、
  颜色走 uno.config.ts 语义 token。
- 品牌复检：新增文案不得出现「AionUi」，显示名是 One Work（BRAND_DISPLAY_NAME）。
- 收尾跑 bunx tsc --noEmit / bun run lint / bun run format /
  bun run i18n:types / node scripts/check-i18n.js / 相关 vitest，全部取真实退出码。
```

---

### 话术 D —— 发版（⚠️ 当前安装包不含四个修复，其中一个是安全修复）

```
工作目录 D:\aionui-m0。任务：发一个新版本。
先读 1oneUI/docs/guides/handoff-2026-08-18-remaining.zh-CN.md 的 §5。

## 必须知道的三件事
0) ⚠️ 2026-08-18 追加：视觉委托治理修复（1oneCore + aionrs，交接文档 §1）也是打包
   之后落地的，同样不在现有安装包里，这次发版要一并带出去。
1) 现有的 out/One-Work-2.1.55-win-x64.exe **不含最后四个修复**——它们是打完包
   之后才提交的，其中一个是**安全修复**（PATCH 可注入 extra.fork 导致跨用户
   会话内容泄露，1oneCore f5120f15）。所以这次发版的意义就在于把它们带出去。
   另外三个是：分叉运行时预热失败被吞、media_job 常量漂移导致分叉入口消失、
   预览保存静默失败。
2) 安全修复在 1oneCore，所以**必须先跑 D:\aionui-m0\scripts\backend-rebuild.ps1
   重编内嵌**再打包（跑之前确认应用没在跑，否则 EPERM；⚠️ 不要用 `*>` 或 `2>&1`
   重定向它的输出，PS 5.1 会把 cargo 的 stderr 包成 ErrorRecord 报
   NativeCommandError，看起来像编译失败其实没有）。
3) **要出 Mac 包必须先给 1oneCore 打新 tag 发 Release**——Mac CI 按 package.json
   的 aioncoreVersion 从 Release 下载后端，不发新 tag 会拿到**不含这些改动的
   旧二进制，且不会报任何错**。上一轮只出了 Windows 包。

## 打包前必做
- 按约定先 bump version patch +1 并 commit push
- 跑完 1oneUI/docs/guides/mac-packaging-preflight.zh-CN.md §1 的四条：
    bun run lint          # 0 errors（warnings 不算失败）
    bun run format:check  # 必须 "All matched files use the correct format."
    bunx tsc --noEmit
    bun run test          # 判据是「0 failed **且** 0 errors」，两行都要看
  ⚠️ **这四条必须是推送前的最后动作**。上一轮踩过：改完文档没重新格式化，
  format:check 直接红。format:check 只反映跑它那一刻的状态。
- Windows 打包用 scripts/package-win.ps1（它会设 AIONUI_BACKEND_LOCAL_PATH
  指向本地刚编的 aioncore，不走 aioncoreVersion 下载）
- ⚠️ 不许删任何旧 .exe 安装包

## 打完包必须验证
- out/win-unpacked/resources/app.asar.unpacked/out/main/builtin-mcp-browser.js
  **真的被解包出来**（它要被外部 node 进程执行，留在 asar 里就用不了）
- 打包日志里托管资源的 CLI 路径版本号对得上（上一轮是 cli\claude\2.1.233\win32-x64）
- 更新说明：docs/release-notes/<version>.json 是权威源，zh/en 均非空才算就绪
```

---

### 话术 E —— 杂项欠账（P3，适合并行会话）

```
工作目录 D:\aionui-m0，三仓 fork：1oneUI / 1oneCore / aionrs-local。
先读 1oneUI/docs/guides/handoff-2026-08-18-remaining.zh-CN.md 的 §3。

任务：清这几笔互不相干的欠账，可挑着做。

## 1. 会话中心表头/模式列在 11 种语言下显示简体中文
conversation.sessionCenter.colTitle/colMode/colModel/colUpdatedAt 与
modeChat/modeImage/modeVideo 只有 en-US 与 zh-CN 有，其余 11 种缺失（既有问题）。
⚠️ 顺手要处理的结构问题：tests/unit/renderer/conversation/SessionCenter.dom.test.tsx:81
把 t mock 成 `options?.defaultValue ?? key`，锁的是源码里硬编码的中文 defaultValue，
所以**这个测试结构上永远发现不了缺 key**。补 key 的同时想办法让测试能发现它
（比如换一种 mock，或加一条独立的 locale 完整性断言）。

## 2. releasePackagingConfig 的超时是无效的
tests/unit/releasePackagingConfig.test.ts:107 / :117 用 spawnSync 且**没传 timeout
选项**。spawnSync 同步阻塞 worker，vitest 的 testTimeout 根本没机会触发——
上一轮把它从 30s 抬到 120s 对「脚本挂住」这一情形完全无效。
正确修法：给 spawnSync 加 timeout + killSignal，并把 testTimeout 调回合理值。

## 3. dev 下 CDP 端口写错时完全静默
packages/desktop/src/process/utils/configureChromium.ts:366 的告警分支条件是
`process.env.AIONUI_DEVTOOLS_CDP_PORT && app.isPackaged`，所以 dev 下设成
80 / 9230abc 时既不开也不打日志，而 docs/guides/cdp.md 明写「启动时会有一条
醒目日志确认」。人会以为开了。加一条 dev 下的「值无效」告警。

## 4.（存疑，需实测）remote-allow-origins 可能让 cdp.md 的手动排查指引走不通
configureChromium.ts:362 只放行 http://127.0.0.1:${port}。但从 chrome://inspect /
DevTools 前端发起的 CDP 握手，Origin 是 devtools://devtools。若如此，cdp.md 里
「Inspect by hand」那两条会失败。**这条没实测过**，请先起一个 dev 端口验证再改。
不影响主用法：裸 ws 客户端不发 Origin（cdp.md 推荐的就是这条）。

## 5. asarUnpack 有一条过期项
packages/desktop/electron-builder.yml 里的 out/main/team-mcp-stdio.js 既不构建也
无任何源码引用（我 grep 过）。无害但误导。**改完必须重新打包验证**，别在验证过的
打包配置上改完就不管。

## 6. 既有红测试（非本轮引入，已用干净基线逐条复现过）
- 1oneCore cargo test --workspace 有 8 条既有失败：aionui-project 的 scm/discard
  6 条 + scm_request_path 1 条 + team_e2e 的 Windows 尾随空格 1 条。
  最后那条是 07-18 上游同步带入的已知缺陷（validate_workspace_path_availability
  在 Windows 上因 Win32 API 静默剥尾随空格而失效），一直没修。
- aionrs 有 6 条 timeout 测试在重负载下 flaky（单独跑全绿），根因是 Windows
  逐进程杀软扫描让进程创建变贵 —— 话术 F 那条杀软排除能顺带改善它。

## ⚠️ 必守
不许削弱断言、不许删测试、不许加 skip/retry。若断言本身是对的，就去修实现或
修测试的等待方式（本仓 AGENTS.md 明文规定）。
判定测试通过必须取被测命令自己的退出码，不要隔着管道看。
```

---

### 话术 F —— 人工操作项（不能让 AI 做，给你自己留的）

```
这两条属安全/人工操作，AI 不应代做。

1) License 公私钥轮换：当前内置的是**开发占位公钥**，私钥已泄露
   （会话里打印过，且明文在桌面 feishu.txt）。上线前必须换掉。
       cd D:\aionui-m0\1oneCore
       cargo run -p license_tool -- keygen --out D:\keys\license-2026-08.json
   ⚠️ **不要把输出贴进任何对话**（已经发生过两次）。只把 public key 填进内置
   常量，私钥离线保管。

2) 给托管 node 目录加杀软排除：本机启动一个 node 要 1~1.7 秒
   （Defender 逐进程扫 89.8MB node.exe），是 npx 型 MCP 慢且不稳的根因，
   也是 aionrs 那 6 条 flaky 测试的根因。需**管理员** PowerShell：
       Add-MpPreference -ExclusionPath "$env:APPDATA\1one-Dev\1one\runtime\node"
```

---

### 附：给**任何**接手会话的通用纪律（可粘在上面任一段后面）

```
## 本仓反复踩到的坑（每条都真实吃过亏）

1. **交接文档与子任务的结论是线索，不是事实。** 上一份交接文档有 3 条前提被证伪，
   全是「某某已存在/不存在」这类**存在性断言**。判据必须是自己开文件核对——
   一个没查到的文件就能推翻一条存在性断言。

2. **接手被打断的工作，先全仓搜 `unreachable_code` / `NEGATIVE` / `TEMPORARY`
   再跑测试。** 真实发生过：一个子任务在「故意破坏 → 看测试是否变红」的中途被
   打断，工作区留下了没恢复的破坏，正好是该功能要防的那个失败模式。

3. **测试输入必须真的走到被断言的那条路径。** 真实发生过一条假绿测试：它发的
   请求不带 extra，而 extra 为 None 时整个被测分支被跳过 → 对着它要防的 bug
   也是绿的。「绿」只对你真正跑到的那条路径有意义。

4. **判定测试通过必须取被测命令自己的退出码。**
   `cmd > log 2>&1; echo $?`，绝不要 `cmd | grep ...`（管道退出码是 grep 的）。
   `cargo test` 默认 fail-fast，统计失败数必须带 `--no-fail-fast`。
   后台任务的「exit code 0」也可能是末尾 echo 的退出码，看日志里的真实值。

5. **守卫存在 ≠ 守卫覆盖。** 加新入口/新路径时，把旧路径上已有的守卫逐条数一遍。
   本轮所有缺陷都是这个形状：create 有剥离 update 没有、共享常量存在但两处手写
   副本漂移、旧保存入口有错误提示新的没有。

6. **cherry-pick 的冲突视图里会混进「相邻但未同步」的功能代码。** 判据：
   `git show <commit> -- <file>` 里只有 `+`/`-` 行属于该 commit，前导空格是上下文。
   这个坑还会藏在**测试块**里，而 `cargo build` 不编译 test 目标。

7. **3-way merge 会零冲突静默删掉 fork 独占模块。** 「冲突解完」≠ 安全，
   必须全量编译 + 全量测试。

8. **每次跑 shell 命令前确认工作目录。** 真实发生过跨仓库误提交（cwd 停在
   aionrs-local，却在提交 1oneUI 的文档改动），靠分支名不同才暴露。

9. **改完 1oneCore 的 Rust 必须 backend-rebuild.ps1 重编内嵌**，否则 dev 用的
   还是旧后端。跑之前确认应用没在跑（否则 EPERM），且不要用 `*>` / `2>&1`
   重定向它（PS 5.1 会把 cargo 的 stderr 包成 ErrorRecord 误报失败）。

10. **真机验证用 CDP**：`AIONUI_DEVTOOLS_CDP_PORT=9230 bun run dev`，然后连
    127.0.0.1:9230。详见 docs/guides/cdp.md（该文档已按现状重写过）。
    ⚠️ 裸 ws 客户端比浏览器自动化 MCP 可靠；窗口被遮挡时 Chromium 会停止产帧，
    会把正常代码测成 BUG；`display:none` 的元素照样匹配选择器，判据要用
    offsetParent + getBoundingClientRect + computed display。
```
