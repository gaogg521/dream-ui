# 2026-07-30 交接：企业版商业化 5 项待办 + 知识库混合检索 + 企业版 UI 重构 + 两处越权 + 打包/WebUI 阻塞

> 承接活文档 [`enterprise-commercialization-backlog.zh-CN.md`](enterprise-commercialization-backlog.zh-CN.md) §2 的 5 项待办（P0-1 续 / P0-2 / P0-3 / P1-1 / P1-2），**全部落地**。
> 过程中范围因用户追问三次扩大：产品/RBAC 复盘 → 信息架构重构 → WebUI 与下拉重构。
> 本文按**接手人的阅读顺序**组织，不按开发时间顺序。

---

## 〇、先读这一节

### 状态

| 项                       | 状态                                             |
| ------------------------ | ------------------------------------------------ |
| 代码                     | **全部已推 `origin/one-main`（两仓 11 个提交）** |
| 后端合主干               | ✅ 已合（另一会话收尾上游同步时并入）            |
| 测试 / tsc / lint / i18n | 全绿                                             |
| 真机 CDP 验证            | 已做，逐项证据见 §6                              |
| **打包**                 | ❌ **未做**（见下方「必须由人做的事」）          |
| **License 公私钥轮换**   | ❌ **未做，且只能由你离线做**                    |

### 提交清单

| 仓       | 提交                                | 内容                                                      |
| -------- | ----------------------------------- | --------------------------------------------------------- |
| 1oneCore | `092e9071`                          | 5 项待办后端 + 混合检索内核（§2、§3）                     |
| 1oneCore | `985f86a9`                          | 备份/计费两处越权收紧（§4）                               |
| 1oneCore | `034bddee`                          | 文档索引更正                                              |
| 1oneUI   | `3f71b5aca`                         | 5 项待办前端 + 知识库接进 Agent                           |
| 1oneUI   | `3c40734c7`                         | v2 契约校验，**解除打包阻塞**（§7）                       |
| 1oneUI   | `d696207ee`                         | 备份页签按 `system_admin` 显示                            |
| 1oneUI   | `2b1f54a5a`                         | 信息架构重构：13 页签 → 6（§5）                           |
| 1oneUI   | `490f784e8`                         | **dev WebUI 反代 dev server**（§8）+ 工作区下拉重构（§9） |
| 1oneUI   | `c0c6f6c8e` `9d97fa20a` `f6bc19f2e` | 本文档与索引                                              |

### 必须由人做的三件事

**1. 打包前先 bump 版本。** `1oneUI/package.json` 仍是 `2.1.50`，而 `out/One-Work-2.1.50-win-x64.exe` **已存在**——不 bump 会覆盖它，违反「旧安装包一个都不许删」。另：`dist:win` 必须设 `AIONUI_BACKEND_LOCAL_PATH` 指向本地 `aioncore.exe`（私有 fork 没有 GitHub Release 产物）。

**2. License 公私钥轮换（上线前必做）。** 内置的 `LICENSE_PUBLIC_KEY_B64` 是开发占位值，其私钥曾在 AI 会话里打印过，**必须视为已泄露**：

```bash
cargo run -p one-billing --example license_tool -- keygen
```

替换公钥常量，私钥离线保管。**绝不要让任何 AI 会话看到私钥**——本轮因此没有代跑。

**3. 与另一个会话在同一文件上会撞车。** 本轮的 IA 重构（§5）**重写了** `packages/desktop/src/renderer/pages/enterprise/index.tsx`，已推 `2b1f54a5a`；而同期另一个会话对**同一文件**有未提交改动。他们 pull 时必然冲突——**合并时以本轮的分组结构为基线**再叠他们的改动，不要整文件择一，否则要么丢页签收敛、要么丢他们的功能。

### 活文档已作废的两处结论（别再照着执行）

| 活文档原话                                    | 实际                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| P0-3「移植 AnythingLLM UI + 换 LanceDB 内核」 | **已推翻**，改用 SQLite 内置 FTS5。理由见 §3                         |
| P1-2「所有权字段统一 `created_by`」           | **错的**，实际是两套字段，且五张看板表的冗余 `creator_name` 必须同改 |

---

## 一、我在本轮犯过的错（先说，免得你踩同样的坑或误信旧结论）

1. **一次假的"编译成功"。** 我用 `(cmd) > log 2>&1; echo $?` 取退出码——那取到的是 `echo` 的退出码，不是 cargo 的。据此报了"编译成功"，实际失败。**判断构建结果必须取命令自身的退出码。**
2. **误判 `/settings/company` 走不到。** 我曾说"侧栏没有企业管理后台入口"。**是错的**——侧栏本来就有（`path: 'company'`，按 `showCompany` 条件显示）。我 grep 的是全路径 `settings/company`，而路由写的是相对 `path: 'company'`，所以没命中。
3. **一次别名深链的假阴性。** 验证旧深链跳转时只改 `location.hash` 的 query，组件不会重新挂载，而 `activeTab` 是 `useState` 初始化的——看起来"没生效"。**必须整页 reload 逐个验。**
4. **把文档提交打到了另一个会话的分支上。** 已回滚（只动 `CLAUDE.md` 一个文件，他们的暂存区和未提交改动全程未碰），改从主干 worktree 重做。
5. **两个自己写出来的 BUG**，见 §10。

---

## 二、五项待办的实现要点

### P0-1 License 前端激活入口

`BillingTab.tsx` 加授权卡片（客户 / 档位 / 席位 / 到期 / 激活时间）、激活码输入、临期 30 天与过期高亮。
**是否过期一律用服务端 `expired` 字段**，不按本机时钟判断。

顺手修掉一个现存误导入口：后端 `set_tier` 早已改为仅降级，但档位下拉框仍可选高档，选了必报 `UPGRADE_REQUIRES_LICENSE`。已改为只列 ≤ 当前档，并把该错误码映射成「请联系厂商获取授权码」。

### P0-2 管理员移除成员 + 席位回收

`one-org::remove_member` **以 `leave()` 为模板**——它已做齐四件事：删 `one_user_org` 行 → `reselect_active_after_leave()` → `invalidate_user_tokens()`（**轮换 JWT，离职者会话立即失效**，这是本功能的核心价值）→ `audit()`。

差异：去掉退出口令校验；加三道守卫——

- 不能移除自己（否则管理员可借此绕过退出口令，须走 `leave`）
- 复用 `ensure_not_last_admin()`
- 非 `system_admin` 不可移除 `system_admin`

**审计归因于操作者（actor）**，target 放 `resource`。`set_user_role` 里有专门注释强调过：弄反会让每次移除都读起来像"自己退出"，掩盖真正的操作人。

`one-enterprise::remove_member` 删公司成员行释放席位（**席位就是行数**，没有单独计数器）。

### P1-2 离职成员资源接管

⚠️ 活文档说的"统一 `created_by`"是错的。实际两套字段：

| 字段约定                               | 表                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `created_by`                           | `one_skill_registry` / `one_mcp_registry` / `one_rag_documents`                               |
| `creator_id` **+ 冗余 `creator_name`** | `one_requirements` / `one_milestones` / `one_test_plans` / `one_test_cases` / `one_pipelines` |

后五张表的 `creator_name` **必须与 id 同改**，否则界面上仍显示离职员工的名字。`one_test_cases` 活文档也漏列了。
`one_requirements.assigned_to` 指向的是数字员工不是人，**不转交**。

**跨租户边界的真实情况**：只有三个 registry 有 `scope`/`team_id` 列，五张看板表**完全没有租户列**（是部署级全局的）。所以"跨组不能转"这道锁实质只在 registry 上成立——代码里如实实现并注释清楚了。收件人必须是本组成员。单事务。

### P1-1 企业配置备份/恢复

新模块 `one-org/src/backup.rs`（`service.rs` 已 2898 行，不再往里塞）。

- **列名用 `PRAGMA table_info` 运行时读取**，不硬编码。迁移会增删列（`one_tenants` 就曾加上又删掉 SSO 绑定列），硬编码会让备份悄悄漏字段。
- 行数据用 SQLite 自己的 `json_object()` 物化，类型不用逐列猜。
- **凭据一律脱敏**：退出口令哈希、MCP secrets、SSO config 按 key 模式剥离。备份文件会被下载、转发、存档，**不能成为凭据外泄路径**。
  - SSO 的 `config` 是 opaque JSON，其密钥名列表在 one-sso 的私有 `secret_keys()` 里，而 one-org 同层不能依赖它。故用**超集清单 + 通用模式匹配**双保险，上游将来加新密钥字段也不会漏。
- 导入：校验版本号 + `INSERT OR REPLACE` 幂等 + 单事务。按**活库 schema** 而非 bundle 自带键集过滤列，新版 bundle 导进旧部署不会炸。

> ⚠️ 这个功能的作用域是**整个部署的所有租户**（有测试 `bundle_spans_every_tenant_not_just_the_callers` 锁死），所以它的门控必须是 `system_admin`——我最初挂错了，见 §4。

### P0-3 知识库接进 Agent（活文档所说缺口的本质）

此前知识库**只在"派发任务给数字员工"时**被自动引用（`one-devops/routes.rs:301`），员工日常对话中 Agent 完全不知道公司有知识库。

复用仓内现成套路（`exportPdfMcpServer.ts`：主进程 TCP 服务 + stdio 转发）新增内置 MCP 工具 `search_team_knowledge`。**aionrs / Claude Code / Codex 三种后端全部受益**，因为 MCP 是三者都说的协议。ACL 由后端 `search_rag` 的 viewer 过滤**自动复用**，成员只搜得到有权看的。

**客户端模式的坑**：`/api/one/devops` 是治理路径，客户端模式下知识库在**远端服务器**上，而主进程**读不到**渲染层 localStorage 里的企业会话（`enterpriseMode.ts` 明确写了主进程看不见这些 key）。故新增 `useGovernanceEndpointSync` 由渲染层主动把远端地址 + 令牌下发给主进程（**仅存内存，不落盘不打日志**）。

**三处注册必须同步**（漏一处打包后失效）：`asarUnpack` + `build-mcp-servers.js` + `builtinMcp/constants.ts`。

### P0-3 知识库 UI

**未照搬 AnythingLLM 代码**——其前提（配套 LanceDB 栈）已不存在，照搬不再是连贯选择。改为做真正有价值的部分：标出混合检索、搜索框文案改为"可搜精确词"、**显性告知 Agent 现在能自行检索**、相似度徽标加标签（原因见 §3 末）。

---

## 三、知识库内核：LanceDB → SQLite FTS5（最重要的一处方案变更）

### 为什么换

用户最初拍板"一次做透，直接上 LanceDB"。按此实现并跑通（93 测试全绿，含真实 LanceDB 落盘的 ACL 前置过滤验证）后，实测体积：

| 方案                    | `aioncore.exe` | 说明                      |
| ----------------------- | -------------- | ------------------------- |
| 改动前                  | 94.3 MB        | 基线                      |
| **LanceDB**             | **299.3 MB**   | +205 MB，3.2 倍           |
| **SQLite FTS5（最终）** | **97.4 MB**    | +3.1 MB，即本轮新代码本身 |

排除过调试符号（pdb 是独立的 61.9 MB 文件，不在 exe 内），那 205 MB 是 arrow 58 + datafusion 54 的真实代码。**用户看到数字后改选 FTS5。**

### LanceDB 的三个坑（将来若再评估，看这里，别重新踩）

1. **需要 `protoc`**：`lance-encoding` 的 build script 硬依赖 Protocol Buffers 编译器。这是**构建环境依赖**，不是 Rust crate——CI 的 Windows/Mac 打包流水线全都要装。活文档选型时没提这一点。
2. **依赖极重**：53 个直接依赖，实际拉取 187+ crate。
3. **ACL 必须重做**：原实现把可见性谓词写在 SQL join 里（`member_visibility_where`）。向量检索一旦离开 SQLite，join 就没了，必须把 `scope`/`team_id`/`visibility` 冗余进向量表做过滤下推。
   - 好消息（已实证）：`QueryBase::only_if()` 是**默认前置过滤**（`postfilter()` 才是后置），top-k 正确性能保住。
   - Rust crate 能力核实过确实齐全（不只 Python 版）：`index::scalar::FtsIndexBuilder`、`IvfHnsw*`、`rerankers::rrf::RRFReranker`。
   - ⚠️ `lancedb::connect()` 这个自由函数在 0.33 **不存在**，入口是 `ConnectBuilder::new(uri).execute()`。

### 最终实现：`crates/one-devops/src/retrieval.rs`

- **词法半边**：SQLite 内置 FTS5 提供 BM25。**trigram 分词器优先**（`unicode61` 对中文完全无效——中文没空格，整句会被当成一个 token），退 `unicode61`，再退纯向量。
- **稠密半边**：保留原有 cosine（ACL 仍在 SQL join 里，与改动前一致）。
- **融合**：RRF（k=60）。按**排名**而非分数融合——cosine 与 BM25 分值量纲不可比，硬归一化是任意的。
- **FTS 表运行时创建**：刻意**不放进迁移**。若某个构建缺 FTS5，放迁移里会让应用启动即崩；放运行时只会降级成纯向量检索。
- **MATCH 表达式转义**：用户输入按空白切分后逐段加双引号成短语再 OR 连接。FTS5 有 `AND`/`OR`/`NEAR`/`*`/`-` 等算子，裸传用户串既是语法错误风险也是算子注入面。中文无空格 → 整串成一个短语 → trigram 子串匹配，顺带解决了中文检索。
- **放弃的能力**：ANN（亚线性向量检索）。当前语料规模下带 ACL 前置过滤的线性扫描足够。

### ⚠️ `score` 字段刻意保持为 cosine，不要改成 RRF 分数

`one-devops/routes.rs:302` 在派发任务给数字员工时按 `h.score >= 0.35` 筛选注入的知识。**RRF 分数量级是 0.03，全部低于该阈值**——改成 RRF 会让知识注入**静默失效**。

副作用（已知、非 bug）：结果按 RRF 排序，而展示的数字是语义相似度，两者**可能不单调**。前端已给相似度徽标加了标签和 tooltip 说明，避免被误读成排序坏了。真机实测就出现过这种情况，且恰恰证明融合有效（见 §6）。

---

## 四、两处越权（一处我写出来的，一处既有的）

用户读完前半段后问了五个产品问题，其中「RBAC 这块别搞错，项目组只能看它这一个组的信息，而一个企业可以有多个项目组」直接引出这两处。

**判据统一为「守卫必须匹配它触碰的数据的作用域」**：

| 数据作用域           | 应有守卫       |
| -------------------- | -------------- |
| `tenant_id`          | 组管理员       |
| `enterprise_id`      | 企业管理员     |
| 部署级（跨所有租户） | `system_admin` |

### 1. 备份端点 —— 我自己写出来的越权（`985f86a9` / 前端 `d696207ee`）

P1-1 我按"企业后台功能"的直觉挂在了 `RequireOrgAdmin` 上，但 `backup.rs` 导出的是**整个部署的所有租户**。结果是**任何一个项目组的管理员都能导出（并覆盖导入）别的组的全部数据**。已改为 `RequireSystemAdmin`，理由写在路由旁的注释里。

真机验证：`org_admin` 调导出/导入均返回 **403「System administrator role required」**，同一会话的 `listUsers` 仍 200（确认没有误伤），备份页签从 UI 上消失。

### 2. 计费端点 —— 既有越权（`985f86a9` 同批）

`one-billing` 的管理员判定原本是 `Some("system_admin") | Some("org_admin")`。订阅档位、席位上限、成本上限全是**企业级**数据，一个项目组管理员能把整个公司的档位和花费上限改掉。已收紧为仅 `system_admin`，补测试 `billing_admin_is_enterprise_scoped_not_project_group_scoped`。

**这不是本轮引入的**——是计费落地时就有的口径错误，本轮顺着同一条判据复查才发现。

---

## 五、信息架构重构：项目组 13 页签 → 6（`2b1f54a5a`）

用户原话：「企业版这块 UI 设计就不合理，缺乏美学，也没站在产品经理的角度看问题」「不要修修补补，实在不行有些模块你想重构都可以」。

**症状链**：顶层页签一路加到 13 个 → 页签条撑破视口 → 页面级横向滚动条 → 连带把审计表的「资源」「IP」列推出可视区。看起来是样式问题，实际是信息架构没跟上功能增长。

**重分依据仍是数据作用域**（与 §4 同一把尺子）：

| 面                     | 作用域              | 落位                                 |
| ---------------------- | ------------------- | ------------------------------------ |
| 订阅与用量、备份与恢复 | enterprise / 部署级 | **迁到企业管理后台**（SSO 此前已迁） |
| 其余                   | `tenant_id`         | 留在项目组，语义相近的收进二级页签   |

项目组顶层 6 项：概览 / 成员 / **邀请码**(邀请码·批量邀请) / 组织架构 / **审计日志**(操作审计·Agent 审计) / **运行时与集成**(运行时节点·集成连接器·基础设施)。

**原 13 个功能面一个没删**，只是不再全部争抢顶层横向空间。

旧深链仍在流通（企业控制台的卡片就是这么跳的），故保留别名映射；已迁出的 `sso`/`billing`/`backup` **重定向到 `/settings/company`**，而不是静默回落到概览让用户以为功能没了。

---

## 六、真机 CDP 验证记录

方法：原始 WebSocket 直连 Electron 渲染进程 `127.0.0.1:9230`（chrome-devtools MCP 连的是独立浏览器，看不到 Electron 窗口）。脚本见 §12。
知识库链路用一个桩嵌入端点（确定性向量）跑通完整管线，无需真实 provider。

### 已实测通过

| 项                     | 证据                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 混合检索               | 3 篇真实文档；`ERR_QUOTA_4471` 精确命中排第一                                                                                                                                           |
| **RRF 确实改善排序**   | 查询「新员工入职」时 Onboarding Guide 排第一，但其 cosine（0.497）**低于** Expense Policy（0.535）——纯向量会排错，融合纠正了它                                                          |
| 中文检索               | trigram 分词对无空格中文有效                                                                                                                                                            |
| MCP 工具               | 走真实 TCP 协议（4 字节 BE 头 + JSON）拿到命中；空查询被拒；服务在 19840 监听并注册为内置 MCP                                                                                           |
| **升档被拦死**         | 降到 `free` 后升 `enterprise` 返回 **409 `UPGRADE_REQUIRES_LICENSE`**，连升 `team` 也被拒                                                                                               |
| 伪造授权码             | 400 `INVALID_LICENSE_KEY`                                                                                                                                                               |
| 档位下拉限制           | 档位为 `team` 时下拉**只有 `free`/`team`**                                                                                                                                              |
| License 卡片渲染       | i18n 全部解析成中文，未回落成裸 key                                                                                                                                                     |
| 备份往返               | 导出 13 张表 → 导入 200（10 表/10 行）→ 再导出行数不变（**幂等**）                                                                                                                      |
| **脱敏精准**           | 真实飞书配置：`appSecret → __REDACTED__`，而 `appId`/`redirectUri`/`externalIdField` **全部保留**                                                                                       |
| **移除成员全链路**     | 成员 2→1；`one_user_org` 与 `one_active_tenant` 无残留；**JWT 密钥指纹变化**（会话立即失效）；三道守卫；审计归在 **操作者** 名下                                                        |
| 删除清词法索引         | 建索引→搜到→删除→**FTS 行数 0，正文已从磁盘消失**                                                                                                                                       |
| **备份越权已堵**（§4） | `org_admin` → 403，`listUsers` 仍 200                                                                                                                                                   |
| **IA 重构**（§5）      | 顶层 6 页签、`scrollWidth === clientWidth` 无横向溢出、三组二级页签正常、四个旧别名深链各自落位、`?tab=billing` 跳企业后台、企业后台 6 页签                                             |
| **WebUI 反代**（§8）   | `out/renderer` 不存在的前提下 `:25809/` **404 → 200**，与 `:5173` **逐字节相同**，含 `@vite/client`；透过它取到的源码含本轮的 `LEGACY_TAB_ALIASES`/`personalWorkspace`/`menuHeaderName` |
| 个人版红线             | 个人模式下备份端点返回 `NOT_IN_ENTERPRISE`；管理页签正确隐藏；启动干净                                                                                                                  |

### ⚠️ 未能真机验证（如实记录）

- **双账号 ACL**：本地普通用户没有密码登录路径（只有 LDAP/SSO），拿不到第二个用户的 JWT，无法真机模拟成员视角。
  **由单元测试覆盖**：`retrieval::tests::lexical_search_enforces_viewer_acl`（词法半边）、`service::tests::search_rag_visibility_join_scopes_documents_to_viewer`（稠密半边）。
- **Agent 在真实对话中自主调用知识库工具**：验的是 TCP 那一层，不是 LLM 真的决定调它。
- **`rendererDevServerUrl` 从干净检出直接启动**：见 §8 末尾的说明——机制与接线分别验过，但"零改动启动即生效"这一步没走过。

---

## 七、⚠️ 打包会直接失败的既有遗留（非本轮引入，已修）

07-29 上游同步后，后端 `cmd_prepare_managed_resources` 改为产出 **`schemaVersion: 2`** 的 manifest（agent CLI 从 npm 包 `acpTools` 换成预备好的原生二进制 `clis`），但**两个校验器都还写死只认 v1**：

| 位置                                                                   | 后果                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/shared-scripts/src/verify-bundled-aioncore-resources.js:174` | `prepareAioncore` / `afterPack` 报 `unsupported_schema_version`，**`dist:win` 打包必失败** |
| `resources/windows/support/verify-bundled-aioncore-install.ps1:346`    | **跑在终端用户装机时**——已装用户在校验/自愈流程里被误判成"安装损坏"                        |

两处均已改为同时支持 v1 与 v2（老 bundle 仍要能过）。v2 按 `clis` 的真实字段校验：`name`/`version`/`root`/`platformDirectory`/`executable`，`requiredFiles`/`requiredDirectories` 可缺省；保留原有的路径逃逸防护、跨平台产物检测、必需 CLI 检查（v2 必需项是 `claude` + `codex`）。

**测试**：原先有一条把 `schemaVersion: 2` 断言成"不支持"的用例——那是旧假设的固化，按 AGENTS.md 的规矩改用 `99` 探测真正不支持的版本，并补 6 条 v2 用例。20 条资产测试全绿，并用**真实 bundle** 跑 `prepareAioncore` 拿到**真实退出码 0**。

---

## 八、⚠️ dev 下 WebUI 伺服一个永不更新的目录（结构性，`490f784e8`）

用户追问「改动同步到网页端了吗？之前好几次改动之后本地生效了，网页端还是旧的」——**问题真实存在，而且不是谁忘了重新构建。**

### 机制

`electron-vite dev` 只重编 `out/main` 与 `out/preload`；renderer 由它自己的 dev server 提供，`out/renderer` **停留在上一次完整构建的产物**。而桌面应用把内嵌 WebUI 的 `staticDir` 指向 `out/renderer`（`packages/desktop/src/index.ts` 与 `process/utils/webuiConfig.ts` 两处都是 `path.join(__dirname, '../renderer')`）。

本机实测证据：

| 观察                                                | 值                                                            |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `out/main`                                          | 19:34（dev 会重编）                                           |
| `out/renderer`                                      | **9:44 —— 十小时前**                                          |
| 产物内含旧文案「项目组设置 / 退出项目组」           | 命中                                                          |
| 产物内含本轮的「运行时与集成」/ `personalWorkspace` | **命中 0**                                                    |
| 全新 worktree 的 `out/renderer`                     | **不存在** → `:25809/` 直接 **404**，而 `/api/*` 正常 **200** |

应用**自己在界面上打印这个地址**（项目组概览页「在浏览器打开以下地址可管理邀请码、成员、SSO」→ `http://127.0.0.1:25809/#/enterprise/console`），所以这是结构性陷阱，不是操作失误。

### 修法

`StaticServerOptions` 新增可选 `rendererDevServerUrl`；置位时 renderer 请求反向代理到 dev server 而不读 `staticDir`。两个桌面调用点传 `process.env.ELECTRON_RENDERER_URL`（dev 下才有，生产恒为 `undefined`，走原静态路径不变）。

- ⚠️ **刻意不做「代理失败回落 staticDir」**——静默回落到旧产物正是要根除的失败模式，故失败返回点名 dev server 的 502（`RENDERER_DEV_SERVER_UNREACHABLE`）。
- ⚠️ **HMR 自己的 WebSocket 不经这一层**（TCP splice 只把后端 upgrade 分流），所以 dev 下 WebUI 是**刷新即最新**，不是热更新。

4 条新单测锁死：代理生效且不回落磁盘、`/api/*` 仍走后端、不可达返回 502、URL 非法启动即抛。

> **验证时的限制（如实记录）**：worktree 的 `node_modules` 是指向主检出的 junction，因此 `node_modules/@aionui/web-host` 也解析到**主检出**那份未改的副本——跑着的应用加载不到修改。不能就地改那个 junction（等于改主检出的 `node_modules`）。最终做法是临时把 3 个 web-host 源文件拷进主检出（那几个文件在那边是干净的），验完 `git checkout --` 还原；`tsc` 则用一份带 `paths` 映射的临时 tsconfig 验证。**所以"从一个干净检出直接启动就生效"这一步没走过**——这批合进主检出后启动一次 dev、打开 `:25809` 即可确认。

---

## 九、工作区身份下拉重构（`490f784e8`）

用户截图指出「这块的设计好像没改，重叠在一起，看的眼花缭乱」——**属实，上一轮只改了页签没动它**。

同一屏出现 **三次**「CDP 验证项目组」：弹层标题、弹层里的「项目组：X」明细行、下方触发器。根因在 `WorkspaceIdentityEntry.tsx`：无 SSO 会话时 `displayName` 回落到 `context.tenantName`，**把项目组名放进了「你是谁」的位置**——而紧邻的注释恰恰写着这两个维度不能混。

| 改动                                              | 理由                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 拆成 `identityName` / `workspaceName` 两个变量    | 身份与工作区各归其位，去掉那个错误回落                                                           |
| 明细行改对齐的 label/value 对，与标题重复则不渲染 | 原来是三行长得差不多的整句堆叠                                                                   |
| 弹层标题**去掉头像**                              | 触发器已有头像 + 名称 + 版本行；弹层再来一遍就是两行一模一样的东西紧贴叠着，这正是「重叠」的来源 |
| 弹层与触发器留 8px                                | 不再像是触发器的延续                                                                             |
| 「项目组设置 / 退出项目组」→「项目组设置」        | 一个路由一个标签；原文案宣传两个去处却只跳一次，退出本就在那个页面上                             |
| 动作项加图标 + 上方分隔线                         | 可扫读                                                                                           |

图标只从**本仓已有 import 证明存在**的集合里取（`Setting`/`Login`/`Earth`/`Peoples`/`Check`），避免写出不存在的导出名导致构建失败。i18n 13 语言：新增 4 key，`openSettings` 去掉斜杠。

---

## 十、本轮修掉的两个自己写出来的 BUG

都是真机测试才暴露的，已修并补测试。

### 1. `useGovernanceEndpointSync` 会拖垮整个 Layout

bridge 方法缺失时（旧 preload、部分接线的宿主、测试 mock）`.invoke` 直接抛错。它跑在 app shell 的 mount effect 里，抛错会**让整个 Layout 挂掉**——和这个仓以前 `RemoteServerSection` 无限渲染冻结 UI 那次是同类事故。

修复：探测 `typeof channel?.invoke === 'function'` 后再调，外层再包 try/catch。缺失只意味着知识库工具留在本地后端，而那本来就是正确默认值。

### 2. 删除知识库文档不清词法索引（数据留存问题）

`delete_rag_document` 只删了文档和分片，FTS 索引里的**正文文本永久留在磁盘上**。

真实库实证：删完 3 篇文档后 `one_rag_documents=0`、`one_rag_chunks=0`，但 `one_rag_chunks_fts` **还剩 3 行**。检索层面不泄漏（JOIN 会过滤孤儿行），但"用户删了文档、原文还在库里"对知识库是实打实的问题。

修复：删除时**先**清词法索引（它靠 `one_rag_chunks` 定位，分片删了就再也找不到了），并补测试锁死。

---

## 十一、测试与质量门 / 环境现状

### 质量门

**后端**：`cargo test` one-devops **46** / one-org **41** / one-enterprise **13** 全绿；`cargo fmt` 干净；`cargo clippy` 三个 crate 无本轮引入的警告。

**前端**：`tsc --noEmit` 0 错；`lint` 0 错（854 条既有警告）；`check-i18n` 通过；web-host + layout 共 **60 条**测试全绿；资产测试 20 条全绿。

**前端整体测试 7 个文件 / 18 条失败——逐个核实过与本轮无关**（失败堆栈中本轮改动文件命中数为 0）。其中 3 个正好对应另一个会话未提交的文件。

**i18n**：新增文案补齐全部 13 语言，**未新增 `defaultValue` 欠债**。

### dev 环境当前状态（本轮验证造成，已征得授权）

- 执行过 `reset-local`：4 个孤儿租户**已归档**至 `%APPDATA%\1one-Dev\1one\enterprise-archives\enterprise-1785376584601.json`
- 现存一个测试项目组「CDP 验证项目组」，`webui.deploymentRole` 已切为 `server`
- 遗留一个无害的测试用户行 `cdp_member`（已从项目组移除）
- 授权档位已还原为 `enterprise`；测试文档、桩嵌入配置、误写的设置脏键均已清理

### dev 库迁移账本被修过一次（保留证据）

后半段重编后端后，dev 库启动报 `migration 19 ... has been modified`。`_sqlx_migrations.checksum` 是迁移文件**原始字节的 sha384**——本轮没改过这些迁移文件，是 07-29 上游同步重排编号时账本没跟上。

处理方式（不是直接 `--ignore-missing` 蒙混）：先对 40 条里 30 条已知良好的行验证 sha384 算法本身对得上，再逐条确认那 10 条 stale 行对应的 schema 变更**在库里确实已经生效**，然后才只改这 10 条的 checksum。原账本已备份至 `sqlx-ledger-backup-before-repair.json`。仅影响本机 dev 库。

### `Cargo.lock` 未提交（有意为之）

另一个会话 staged 的版本含若干依赖升级，而本轮构建把它们重新解析回低版本。提交会覆盖掉他们的意图，故留空——锁文件下次构建自动重生成。

---

## 十二、工具与踩坑手册

### 复用资产（在会话 scratchpad，未入库，需要时照此重建）

- **CDP 驱动**：Node 22+ 自带全局 `WebSocket`，无需 `ws` 包。取 `http://127.0.0.1:9230/json/list` 里 `type === 'page'` 且 url 含 `5173` 的 target，连其 `webSocketDebuggerUrl`，发 `Runtime.evaluate`（`awaitPromise: true, returnByValue: true`）。
- **CDP 截图**：同一连接发 `Page.captureScreenshot`（`format: 'png'`），把 base64 写盘即可——比坐标点击可靠得多，也是本轮给用户看 UI 效果的方式。
- **桩嵌入端点**：实现 `POST /v1/embeddings` 返回确定性向量（字符袋投影后归一化），即可在无真实 provider 的情况下跑通知识库全链路。
- **MCP TCP 探针**：4 字节大端长度头 + UTF-8 JSON body，直连 19840。

### 踩坑手册

- **退出码**：`(cmd) > log 2>&1; echo $?` 取到的是 `echo` 的退出码。判断构建结果**必须取命令自身的退出码**。
- **PS 5.1**：`backend-rebuild.ps1` 对原生命令用 `2>&1` 会误报 `NativeCommandError`。改为手动执行 `cargo build` + `node scripts/prepareAioncore.js`。
- **worktree 共享 `node_modules` 的连带坑**（本轮踩过两次）：worktree 里的 `node_modules` 若是指向主检出的 junction，则其中所有 workspace 包软链（`@aionui/*`）也都解析回**主检出**的源码。表现为「改了 worktree 里的包，跑起来 / `tsc` 都当没改」。另外 `packages/web-host/node_modules` 需单独 junction，否则该包单测报 `Cannot find package 'serve-handler'`。
- **worktree + junction 的清理顺序**：`git worktree remove` 会**顺着 junction 把主检出的真实目录一起删掉**。必须先摘链接再 remove。PowerShell 里 `rmdir` 是 `Remove-Item` 的别名可能被安全策略拦，可靠写法是 `[System.IO.Directory]::Delete($path, $false)`——它不跟随 reparse point。
- **Arco 页签的 `useState` 初始化**：只改 URL query 不会重新挂载组件，深链行为**必须整页 reload 验证**。
- `.sync-worktree/` 与 `1oneUI-sync/` 是另一个会话的工作树，未触碰。
