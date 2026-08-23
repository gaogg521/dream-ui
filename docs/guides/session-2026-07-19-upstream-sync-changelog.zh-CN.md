# 上游同步变更清单（v2.1.32→v2.1.37 / Core 0.1.45→0.1.48 / aionrs 0.2.2→0.2.5）

> **2026-07-18～19**。给后续 AI / 人类读的**功能与 BUG 修复总表**。  
> 作战过程与企业铁律见 [`session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md`](session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md)。  
> 看图白名单 / 自定义网关细节见 [`session-2026-07-19-custom-gateway-image-input.zh-CN.md`](session-2026-07-19-custom-gateway-image-input.zh-CN.md)。

---

## 0. 版本与仓库映射

| 仓（本机目录）                    | 同步前（约）                | 上游目标                        | 本 fork 结果                                       |
| --------------------------------- | --------------------------- | ------------------------------- | -------------------------------------------------- |
| `aionrs-local` ← iOfficeAI/aionrs | v0.2.2 + fork 补丁          | **v0.2.5**（另吃 main 上 #230） | `master` @ `78672b3`（v0.2.5 + #230 + 6 专属补丁） |
| `1oneCore` ← iOfficeAI/AionCore   | v0.1.45-one.1               | **v0.1.48**                     | **0.1.48-one.1**（`aioncoreVersion` 同）           |
| `1oneUI` ← iOfficeAI/AionUi       | 内容≈v2.1.32；产品号 2.1.46 | **v2.1.37**                     | 内容对齐 v2.1.37；**产品号仍 2.1.46**              |

级联：`aionrs → 1oneCore → 1oneUI`。企业模块（`one-*`、设置 IA）全程保 fork。

---

## 1. 新特性（上游 Release Notes 对照）

### 1.1 个人终端 / Agent

| 能力                                                         | 来源                       | 我们是否吃进    | 备注                                                         |
| ------------------------------------------------------------ | -------------------------- | --------------- | ------------------------------------------------------------ |
| **Aion CLI 能看图**（按模型能力路由图片附件）                | aionrs 0.2.5 + Core 0.1.48 | ✅              | 依赖能力白名单；自定义网关需见 §5                            |
| **内置编码 Agent：Pi**                                       | Core 0.1.48                | ✅              | 本机未装 `pi` 时为 `missing`，可用 PATH 安装引导             |
| **定时任务可视化计划编辑器** + 高级 Cron                     | UI 2.1.36 (#3552)          | ✅              |                                                              |
| **Cron 队列保护**（上次未跑完则下次等待）                    | UI + Core 0.1.47 (#601)    | ✅              | migration **027**（原上游 022，撞号后重排）                  |
| **技能详情页**（信息 / 挂载卸下助手）                        | UI 2.1.36 (#3604)          | ✅ **手工移植** | 进 fork `SkillsHubSettings`，未整吃上游 `SkillsSettings/` 树 |
| **自定义技能批量删除**                                       | UI 2.1.36 (#3600/#3603)    | ✅ 同上         |                                                              |
| **长列表内联搜索**（技能/MCP 子菜单、助手默认模型/技能/MCP） | UI 2.1.36 (#3605)          | ✅              |                                                              |
| **拖拽排序统一**（团队成员标签、置顶会话）                   | UI 2.1.36 (#3606)          | ✅ 取上游交互   | GroupedHistory 等 fork 区域保 ours                           |

### 1.2 优化与修复（上游清单 + 合入时额外确认）

| 项                                                          | 来源                      | 状态                           |
| ----------------------------------------------------------- | ------------------------- | ------------------------------ |
| CLI 检测遵循 **login shell PATH**（nvm/homebrew/cargo）     | Core #622                 | ✅                             |
| 团队协作 **备用传输通道**                                   | Core #629                 | ✅                             |
| 草稿箱发消息偶发 **409 冲突** / 忙时发送竞态                | UI #3589/#3571            | ✅                             |
| 新团队任务启动误闪「排队中」→ 接受即处理中                  | UI #3576                  | ✅                             |
| 消息正文提到内部附件标记时被截断                            | UI #3590                  | ✅                             |
| 启动时助手数据加载失败 → 引导本地数据修复                   | UI #3583                  | ✅                             |
| 管家三处字段错配 + 规则走 CLI 模型                          | Core #607                 | ✅                             |
| 规则文件存储规范化；不覆盖用户开关                          | Core #625/#634            | ✅                             |
| Codex 安装校验对齐 ACP 新布局                               | UI #3557/#3561            | ✅                             |
| 反馈带团队路由上下文                                        | UI #e2212d0f5 等          | ✅                             |
| 去掉 Bun 运行时 / 旧依赖瘦身                                | Core #623；UI #3594/#3595 | ✅（跟上游；fork 无 Bun 依赖） |
| 标题栏相关：bridge **void-param invoke**                    | UI #3611                  | ✅                             |
| 团队耗时计时器 remount 不归零                               | UI #3612                  | ✅                             |
| Codex 全权限 YOLO 归一；ACP ACK 确认；脏助手 bootstrap 跳过 | Core #608/#635/#615       | ✅                             |
| managed-resources **manifest** 校验                         | Core #617；UI #3587       | ✅                             |
| Provider **流式诊断**（#230，v0.2.5 之后）                  | aionrs                    | ✅ 已合 fork `master`          |
| 团队 lead **工具策略**继承 / 作用域                         | aionrs #226；UI 相关      | ✅                             |

### 1.3 Fork 工程侧（非上游功能，但本次必记）

| 项                | 说明                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| DB migration 撞号 | 上游 021–024 与 fork 已应用 021–025 冲突 → 重排为 **026–029**（`15c72819`）                     |
| aionrs pin        | 保持 `gaogg521/aionrs` **`master`**，不用官方裸 tag                                             |
| 品牌              | locales → **1One Work**；**注入技能/ACP 身份**晚间补齐（`9504fa47`，见品牌专项文档）            |
| 设置 IA           | Router / SettingsSider / capabilities + 企业 tab **`--ours`**                                   |
| 自定义网关看图    | LiteLLM + 模型 ID 宽松归一（`kimi-k2.6`/`kimi2-6`/`kimi-2-6`…）；**Core 改动接手时确认 commit** |

---

## 2. 按仓拆开的上游提交范围（便于对 PR）

### 2.1 AionUi（`v2.1.32` → `v2.1.37`，节选）

- feat: cron 队列保护与自定义日程 (#3552)
- feat: 技能批量删除 / 详情与助手挂载 (#3600/#3604)
- feat: 技能/MCP/助手选择内联搜索 (#3605)
- feat: 团队 tab / 置顶会话拖拽统一 (#3606)
- fix: Codex 安装校验 (#3557/#3561)
- fix: 忙时发送 / 409 (#3589/#3571)
- fix: 团队「处理中」展示 (#3576)
- fix: 附件标记解析 (#3590)
- fix: 启动 bootstrap 分类 (#3583)
- fix: bridge void-param (#3611)；团队计时器 (#3612)
- chore: 去 aioncli-core / office-ai platform (#3594/#3595)

（完整 `git log`：`1oneUI` 上 `v2.1.32..v2.1.37`。）

### 2.2 AionCore（`v0.1.45` → `v0.1.48`，节选）

- feat: 按模型能力路由图片附件；消费 aionrs 结构化图片块
- feat: 内置 ACP Agent **Pi** (#618)
- feat: cron 去重与执行保护 (#601)
- feat: 团队 CLI 备用协作传输 (#629)
- fix: login PATH + 内置 CLI 校验 (#622)
- fix: Codex full-access 归一 (#608)；ACP ACK (#635)
- fix: 管家字段 (#607)；规则规范化 (#625)；脏助手跳过 (#615)
- refactor: 移除 legacy Bun (#623)
- chore: aionrs → v0.2.5

### 2.3 aionrs（`v0.2.2` → `v0.2.5` + #230）

- feat/fix: CLI 图片内容块、能力感知 `view_image`、剥图 harden
- fix: tool-call failure fingerprint；runtime 工具策略；sub-agent 继承
- fix(#230): sanitized provider stream diagnostics（忽略 canceled）

**必须保留的 fork 专属补丁**（合上游时不得丢）：空参 tool_call、thinking 阶梯重试、文本化工具历史、deferred schema 提升、GLM 盲搜纠偏，及 ToolSearch/ExecCommand 文案类小补丁。

---

## 3. 本次合入后「用户可感知」清单（验收用）

**个人 / 终端**

- [x] 会话可贴图；自定义 LiteLLM + **`kimi-k2-6` 看图已由用户验收通过（2026-07-19 晚）**
- [x] 助手身份文案：**注入技能 / ACP 不再自称 AionUi**（dev 隔离验证 22:22；见品牌专项）
- [ ] Agents 列表有 **Pi**；未安装时有引导
- [ ] 定时任务：可视化日程 + 队列开关
- [ ] 技能：详情页、UsedBy、批量删除、长列表搜索
- [ ] 忙时连发 / 草稿发送不乱 409；附件文本不误截断

**企业（铁律，必须仍可用）**

- [ ] 设置 → 企业 / 能力扩展仍在
- [ ] `/api/one/org/*`、`/api/one/sso/*`、`/api/one/devops/*` 正常

**工程**

- [x] 后端版本串 `0.1.48-one.1`；存量库 migration 到 **29**（07-19 冒烟）
- [x] 看图修复已 commit：`357bbbf3`；品牌补齐已 commit：`9504fa47`（`sync-v0148` ahead）
- [x] bundled `aioncore.exe` 含上述修复（看图约 21:45；品牌约 **22:20**）

---

## 4. 看图能力白名单：文件在哪？用户能自己改吗？

### 4.1 相关文件（三份，角色不同）

| 角色                                         | 路径                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| **白名单数据（模型 ID 列表）**               | `1oneCore/crates/aionui-ai-agent/assets/model-capabilities/image_input_models.json` |
| **白名单原则 / 维护说明**                    | `1oneCore/crates/aionui-ai-agent/assets/model-capabilities/README.md`               |
| **解析逻辑（匹配 API / 自定义网关 / 别名）** | `1oneCore/crates/aionui-ai-agent/src/capability/image_input.rs`                     |
| 运行时剥图（aionrs）                         | `aionrs-local/crates/aion-agent/src/engine.rs`（`project_image_input`）             |

原则摘要（详见 README）：

- 编译期 **嵌入**，**运行时不下载、不热更新**
- 正向前白名单：API root + 模型 ID；未命中 → `Unknown` → **剥图**
- 只收录提供商文档确认支持 image input 的模型
- DeepSeek 官方 chat 预设目前 `models: []`；MiniMax 看图是 **M3**，不是 M2.7

### 4.2 用户能不能自己改？

| 角色                           | 能否改生效  | 怎么做                                                                                                                                                                                                      |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **终端用户（安装包 / 纯 UI）** | ❌ **不能** | 没有设置页开关；改 JSON 也不在安装目录暴露为可编辑配置                                                                                                                                                      |
| **本仓库开发者 / 运维**        | ✅ 可以     | 改 `image_input_models.json`（和必要时 `image_input.rs`）→ `cargo build -p aionui-app --release` → `scripts/backend-rebuild.ps1`（或 copy 进 `1oneUI/resources/bundled-aioncore/...`）→ 重启桌面 / 重新出包 |
| **只改 JSON 不重编**           | ❌ 无效     | JSON 是 `include_str!` 打进 `aioncore.exe` 的                                                                                                                                                               |

Fork 额外行为（CustomGateway + 别名归一）：合法自定义网关 URL 若模型 ID 经宽松归一后命中白名单任一条目 → 放行图片。  
常见写法示例：`kimi-k2.6` / `kimi-k2-6` / `kimi2-6` / `kimi-2-6` / `Kimi K2.6` 视为同一视觉模型。详见看图专用交接文档。

**勿擅自加入白名单的例子**：`deepseek-v4-flash`、`minimax-2-7` / MiniMax-M2.7（官方纯文本）。

---

## 5. 已知缺口 / 接手注意

1. Core 看图：`357bbbf3` 已 commit；品牌注入技能：`9504fa47` 已 commit（`sync-v0148`，相对 origin ahead）。
2. `1oneCore` 企业 WIP stash（`wip-enterprise-before-sync-v0148`）是否已 pop：接手时确认。
3. 出包前 bundled `aioncore.exe` 须含 **看图 + 品牌** tip（≥ 22:20 那版或更新）。
4. 「多模态」≠ 白名单 Supported；剥图后模型会表现为「看不到」或用 Read/Shell 瞎摸文件。
5. 品牌分层与残留面：见 [`session-2026-07-19-brand-skills-acp.zh-CN.md`](session-2026-07-19-brand-skills-acp.zh-CN.md)。

---

## 6. 相关文档

- [`session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md`](session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md) — 作战清单 / 企业铁律 / 进度
- [`session-2026-07-19-custom-gateway-image-input.zh-CN.md`](session-2026-07-19-custom-gateway-image-input.zh-CN.md) — 自定义网关看图根因与补丁
- [`session-2026-07-19-brand-skills-acp.zh-CN.md`](session-2026-07-19-brand-skills-acp.zh-CN.md) — 注入技能 / ACP 品牌补齐
- [`upstream-sync-reference.zh-CN.md`](upstream-sync-reference.zh-CN.md) — 常驻同步规范
- Core 白名单原则：`1oneCore/.../model-capabilities/README.md`
