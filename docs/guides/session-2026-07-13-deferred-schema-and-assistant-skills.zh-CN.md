# Session 2026-07-13:Agent 助手反复失败的根治(deferred 工具机制 vs GLM)

> 症状:财务建模助手(glm-5-2 @ litellm-internal 网关)收到「做一个简单的
> 数据报表，不要太复杂」这类简单任务,狂刷 ToolSearch、用空参调 Spawn,
> 连挂三轮触发熔断,UI 报 `UNKNOWN_UPSTREAM_ERROR`。用户主诉「AGENT 助手
> 反反复复出问题」。本轮真机 E2E 复现并根治。

## 一句话结论

**根因全部集中在「deferred 工具机制」与 GLM 这类受约束解码模型的冲突上,
与技能物化无关(技能一直有正常物化,见下文「误判纠正」)。** 两条独立
失败路径 + 一个错误分类误导,已分三处修完并真机验证。

## ⭐ 关键定性:这是机制级修复,不是给某个模型打补丁

> 三处改动**没有任何一行按模型名判断**(没有 `if model == "glm"`),完全
> 符合本仓铁律 [No Hardcoded Provider Quirks](../../../aionrs-local/AGENTS.md)。
> 修的是「deferred 工具机制」本身的健壮性缺陷,让它对**所有模型**都正确;
> GLM 只是恰好第一个把这个缺陷踩崩、让问题暴露出来的模型。

- **① schema 提升**:改 `ToolRegistry` 通用逻辑,任何延迟工具被 ToolSearch
  命中或空参失败即对**所有模型**升级为完整申报。受约束解码模型(GLM/
  DeepSeek/Qwen…)是救命,Claude 这类不受申报 schema 约束的模型也无害
  (多给一份完整 schema 从不出错)。
- **② 提示纠偏**:系统提示 + ToolSearch 未命中消息是**发给所有模型的同一
  份文本**,没有分模型;把延迟工具说明写清楚,行为好的模型不受影响,容易
  过度泛化的模型受益最大。
- **③ 错误分类**:熔断改判对任何触发连续工具失败的模型都生效。

**为什么不给 GLM 单开开关**:延迟工具「先申报空 stub、用时再加载」的设计
天生对受约束解码模型不友好。本轮选**通用加固**(用到就提升 + 提示写清楚),
而不是按模型名特判。后备的 `ProviderCompat.eager_tool_schemas` 开关(整仓
/整网关关掉 deferral)也是**按 provider 配置**下发、不是按模型名硬判——仅
当提示级纠偏对某些更顽固模型仍不够时才升级(见文末「遗留」)。

## 三个真根因

### ① deferred 工具的 stub schema 让 GLM 只能吐空参(空参死循环,已修)

aionrs deferred 机制:向模型申报 `{"type":"object","properties":{}}` 空
stub,完整 schema 只在 ToolSearch 命中后**以文本**进入对话,申报层面永不
升级。

黑盒实锤(解密 provider key 直接 curl 网关):

| 申报方式                                      | glm-5-2 的 arguments                              |
| --------------------------------------------- | ------------------------------------------------- |
| 完整 schema                                   | `{"tasks":[{"name":"report","prompt":"..."}]}` ✅ |
| 空 stub                                       | `{}` ❌                                           |
| 空 stub + 完整 schema 塞进 system prompt 文本 | `{}` ❌                                           |

GLM 按**申报的** schema 做受约束解码,`properties:{}` 只能生成 `{}`。
空参 → 报错让它重试 → 仍空参 → 三轮熔断。

**修复(aionrs `8de0bf5`)**:`ToolRegistry` 加会话级 `loaded_schemas`;
`to_tool_defs` 对已加载的 deferred 工具按完整 schema 申报;`ToolSearch`
命中即写入集合;deferred 工具缺必填参失败时也现场提升,提示改「schema
已加载,直接带参重试」。空参重试由死循环变为一次自愈。

### ② GLM 把「deferred 需先 ToolSearch」过度泛化成「所有工具都得先发现」(空转,已修)

真机 E2E 抓到一条**独立于①**的失败路径:模型明明已直接拥有
Read/Write/Edit/Grep/Glob/ExecCommand/Skill(全是非 deferred、满 schema
直连),却连发 **18 次 ToolSearch** 盲搜 `officecli`/`Skill`/`Bash`/`Glob`/
`write file`……一次真实动作都不做,直到耗尽轮次。因 ToolSearch 未命中
返回 `is_error=false`,**不触发失败熔断**,所以不崩,但任务照样做不出。

根因:系统提示里「部分工具是 deferred,调用前先 ToolSearch」被 GLM 过度
泛化;它把 ToolSearch 当成用任何工具的前置步骤。

**修复(aionrs `92d9242`)**:

- `context` 系统提示重写「Using your tools」末段:明确「几乎所有工具现在
  就能直接按名调用,别用 ToolSearch 去发现已可见的工具」;技能用 Skill
  工具调用(`Skill(skill="officecli-financial-model")`),技能永不出现在
  ToolSearch 结果里。从第一轮就把模型引导对。
- `ToolSearch` 未命中消息追加「这些工具现在就能直接调用:<非 deferred 工具
  名清单>」+「用 Skill 工具跑技能」,即使模型已盲搜也能立刻纠偏。

### ③ 熔断错误被错报成 UNKNOWN_UPSTREAM_ERROR(诊断误导,已修)

aionrs `ToolCallFailures`(本地连续工具失败熔断)在 1oneCore 被硬编码映射
成 `UnknownUpstreamError`,UI 显示「上游 Agent 或模型服务商出错,无法判断
来源」——把明确的本地熔断伪装成不可知上游错误,每次排障都被带偏。

**修复(1oneCore)**:新错误码 `USER_AGENT_TOOL_CALL_LOOP`
(ownership=user_agent,retryable),zh-CN/en-US 文案「Agent 连续多次工具
调用失败…已自动停止以避免死循环」。其他语言缺 key 走 en-US 回落。

## ⚠️ 误判纠正:根因②(技能没物化)是错的,已回滚

排查中一度怀疑「助手勾选的技能从未接进 aionrs」,并在 `factory/aionrs.rs`
加了 `materialize_skills_into_workspace` 把技能目录复制进 workspace。
**真机验证推翻了它**:

- workspace `.aionrs/skills/` 里 `officecli-financial-model` 等 5 个技能
  **一直有正常的 symlink**;
- aioncore.log 明确 `wired skill symlinks into workspace ... links=5`;
- 来源是既有的 `aionui-conversation/src/service.rs:944` →
  `link_workspace_skills`,对 temp/用户 workspace 都生效,早就覆盖 aionrs。

所以那段 factory 代码 + `AcpSkillManager::resolve_skill_dirs` + 相关测试
**已全部 `git checkout` 回滚**。技能物化不是问题,GLM 不肯调 Skill 工具
才是(见根因②)。教训:改前先查现有链路 + 真机看 workspace/日志,别照
「factory 注释说没有 skill-loading path」就下结论。

## 三仓 commit 索引

| 仓库                | commit    | 内容                                                               |
| ------------------- | --------- | ------------------------------------------------------------------ |
| aionrs              | `8de0bf5` | deferred schema 命中即提升(根因①)                                  |
| aionrs              | `92d9242` | GLM 盲搜纠偏:系统提示 + ToolSearch 未命中清单(根因②)               |
| aionrs              | `f7d4318` | CLAUDE.md fork 补丁清单登记                                        |
| 1oneCore (one-main) | 本轮      | `USER_AGENT_TOOL_CALL_LOOP` 错误码(根因③)+ Cargo.lock 对齐 92d9242 |
| 1oneUI (one-main)   | 本轮      | 新错误码 zh-CN/en-US 文案 + i18n types + 本文档                    |

## 排查方法论沉淀

- **会话取证**:`%APPDATA%\<数据目录>\1one\aionrs-sessions/sessions/<id>/
state.json` 存完整 message 历史(含 tool_use input 原文),比日志更接近
  真相——18 次 ToolSearch 空转就是这里看出来的。
- **黑盒探测网关**:`users.jwt_secret` → SHA256("aionui-encryption-key:"+
  secret) → AES-GCM 解 `providers.api_key_encrypted` → 直接 curl 构造变体,
  一锤区分「模型行为」vs「客户端 bug」。
- **真机 E2E 用 CDP**:dev 桌面端开 `--remote-debugging-port=9230`,用
  websocket(`suppress_origin=True` 绕 403)驱动;**注意 CDP Input 用 CSS
  像素,截图是 devicePixelRatio 后的设备像素(本机 1.25×)**,点击坐标要
  用 `getBoundingClientRect` 的 DOM 坐标,不能直接用截图坐标。
- **dev 数据目录 = `%APPDATA%\1one-Dev`**(与正式版 `1ONE Code` 隔离);
  改 Rust 后必须 `backend-rebuild.ps1` 重编 + 内嵌,再 `frontend-dev.ps1`。

## 验证

- aionrs:`cargo test -p aion-agent -p aion-tools` 全绿(新增 registry 提升、
  ToolSearch 提升/直连清单、context Skill 引导等单测)。
- 1oneCore:`aionui-ai-agent`/`aionui-api-types` 全绿。
- 真机 E2E(glm-5-2 + 财务建模助手 +「做一个简单的数据报表」),CDP 驱动:

  | 版本              | ToolSearch | Skill | ExecCommand | 结果                                                              |
  | ----------------- | ---------- | ----- | ----------- | ----------------------------------------------------------------- |
  | 修复前(旧 aionrs) | **33**     | 0     | 0           | 疯狂盲搜,从不调 Skill;线上更早期直接崩 UNKNOWN_UPSTREAM           |
  | 修复后(①+② 全上)  | **1**      | **1** | 4           | 先调 Skill 加载 officecli-financial-model,再 ExecCommand 直接建表 |

  修复后 glm 的叙述即为正解:「让我先加载 excel 技能，然后创建报表」→ 调
  Skill → ExecCommand 逐步建 `销售数据报表.xlsx`,全程零盲搜、零失败熔断,
  文件真实产出(4592 字节,UI 文件面板可见并预览)。33→1 次 ToolSearch,
  且首次真正调用了 Skill 工具。

## 遗留

- 其他语言 locale 的 `USER_AGENT_TOOL_CALL_LOOP` 未补文案(走 en-US 回落),
  与仓库既有缺 key 同批处理。
- 若②的提示级纠偏对某些模型仍不够,后备方案是加 `ProviderCompat` 开关
  `eager_tool_schemas`(对该网关关闭 deferral、全量申报 + 撤掉 ToolSearch 与
  deferred 段落),从 1oneCore compat 下发——本轮先用低风险的提示级修复,
  按真机结果决定是否升级。
