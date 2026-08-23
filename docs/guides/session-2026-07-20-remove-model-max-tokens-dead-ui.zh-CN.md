# 删除 model_max_tokens 死 UI / 死字段（端到端）

> **2026-07-20**。承接同日 [`session-2026-07-20-truncation-fix-and-upstream-resync.zh-CN.md`](session-2026-07-20-truncation-fix-and-upstream-resync.zh-CN.md) 的遗留项 §5.1。
> **状态：代码改动已完成、本地编译/单测通过、已 commit + push 两仓（1oneCore `74a03de1` / 1oneUI `0eab8f448`）、已 backend-rebuild 进 bundled 并 dev 实测通过（见 §3.1）。仅剩 Windows 打包（§4 第 4 步）。**

---

## 1. 背景：为什么删

上一轮（truncation-fix-and-upstream-resync）为对齐上游 #641「ignore max token limits for aionui requests」，把 aionrs 内嵌运行时的 `max_tokens` 全链路清成 `None`。副作用是 fork 07-12 加的「按模型配置最大输出 Token 数」功能变成**死 UI**：设置页那个「最大输出」输入框还能填、还会存进 `providers.model_max_tokens` 列，但运行时永远不读。

用户明确指示：**这是当时临时加的，既然失效就彻底删掉，不要留死 UI**。本轮就是把这个字段/输入框/DB 列/i18n 从前后端端到端删干净。

> ⚠️ **不要删错**：`ProviderCompat.transport.model_max_tokens`（aionrs 自己的 provider 预设按模型规则表，在 `aionrs-local` + `1oneCore` 的 `manager/aionrs/agent.rs`）是**另一个东西**，是上一轮特意对齐上游保留的，**不动**。本轮删的只是 **Provider 实体上的 `model_max_tokens` 字段**（用户在设置页手填的那个）。

---

## 2. 已完成的改动（全部落盘）

### 2.1 后端 1oneCore（15 改 + 1 新迁移）

**数据层**

- `crates/aionui-db/src/models/provider.rs`：删 `Provider.model_max_tokens` 字段 + 注释。
- `crates/aionui-db/src/repository/provider.rs`：删 `CreateProviderParams` / `UpdateProviderParams` 两个结构体的字段。
- `crates/aionui-db/src/repository/sqlite_provider.rs`：删 INSERT/UPDATE SQL 里的列、bind、merge_update 里的字段、`sample_params` 测试夹具。
- `crates/aionui-db/migrations/031_drop_provider_model_max_tokens.sql`（**新增**）：`ALTER TABLE providers DROP COLUMN model_max_tokens;`。**编号 031 接在既有 030 之后，无撞号。**

**API 层**

- `crates/aionui-api-types/src/provider.rs`：删 `ProviderResponse` / `CreateProviderRequest` / `UpdateProviderRequest` 三个 DTO 的字段；删两个专属测试（`test_provider_response_model_max_tokens_serialization`、`..._omitted_when_none`）；清理 `test_provider_response_serialization`、`..._with_per_model_fields` 里的相关断言/构造。

**服务层**

- `crates/aionui-system/src/provider.rs`：删 create/update 的 serialize、params 构造、build_response 的 deserialize + 字段；删 `update_model_max_tokens_persists_and_can_be_emptied` 测试；清理 `create_persists_per_model_fields` 测试断言 + `sample_create_request` 夹具。

**周边（都是构造 `CreateProviderParams` 的结构体字面量，删字段行即可）**

- `crates/aionui-ai-agent/src/services/availability/mod.rs`
- `crates/aionui-ai-agent/src/services/provider_health.rs`
- `crates/aionui-ai-agent/src/manager/aionrs/agent.rs` —— ⚠️ **未改**，这里的 `model_max_tokens` 是 `compat.transport.*`，无关（见 §1 警告）。
- `crates/aionui-team/src/service/spawn_support.rs`
- `crates/aionui-team/src/test_utils.rs`
- `crates/aionui-assistant/src/service.rs`
- `crates/aionui-system/src/model_fetcher/mod.rs`
- `crates/aionui-system/tests/model_fetch_routes.rs`
- `crates/aionui-app/tests/assistants_e2e.rs`
- `crates/aionui-ai-agent/tests/factory_provider_integration.rs`：删 `insert_test_provider_with_max_tokens` 辅助函数（合并回 `insert_test_provider`）+ 两个专测该功能的用例（`..._resolves_ok_with_provider_model_max_tokens_and_no_override`、`..._tolerates_malformed_provider_model_max_tokens`）——这两个用例测的是上一轮已删的 `resolve_model_max_tokens` 函数。
- `crates/aionui-db/tests/provider_repository.rs`：清理 `sample_params` + `create_with_all_optional_fields` 断言；删 `update_model_max_tokens_can_be_set_and_cleared_without_touching_other_fields` 测试。

### 2.2 前端 1oneUI（4 代码/类型 + 13 locale）

- `packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx`：删「最大输出」`InputNumber` 输入框整块 + 删除模型时对 `newModelMaxTokens` 的清理逻辑 + 删 `InputNumber` import（`Tooltip` 仍在别处用，保留）。
- `packages/desktop/src/common/config/storage.ts`：删 `IProvider.model_max_tokens` 字段 + 注释。
- `packages/desktop/src/common/types/provider/providerApi.ts`：删 Create/Update 两个 request 类型的字段。
- `packages/desktop/src/renderer/services/i18n/locales/*/settings.json`（13 个语言）：删 `maxOutputTokens` + `maxOutputTokensTooltip` 两个 key（用 node 脚本按 key 精确删，git diff 每个文件只 -2 行，格式无扰动）。
- `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`：`bun run i18n:types` 重新生成，两个 key 已消失。

---

## 3. 已做的验证（如实记录，勿夸大）

- ✅ `cargo build`（dev）：0 error。
- ✅ `cargo build --tests`（dev）：0 error（所有测试目标能编译）。
- ✅ `cargo test -p aionui-db -p aionui-api-types`：**全绿**。db 268 个测试（含迁移 031 的 DROP COLUMN 在真实 SQLite 内存库上跑通）+ api-types 509 个测试。
- ✅ 前端 `bunx tsc --noEmit`：0 error。
- ✅ 前端 `bun run lint:fix`：0 error（833 个既有 warning 不算）。
- ✅ 前端 `node scripts/check-i18n.js`：passed。
- ✅ 前端残留引用扫描：`grep model_max_tokens|maxOutputTokens` 全库为空。

**未验证（留给接手者）**：

- ❌ `aionui-system` / `aionui-ai-agent` / `aionui-team` / `aionui-assistant` / `aionui-app` 的完整 `cargo test`（这几个 crate 只删了字段行和无关断言，编译已过，逻辑无变更，风险低，但没逐个跑完）。
- ❌ Windows 打包。

## 3.1 dev 桌面实测（2026-07-20 已补做）

`backend-rebuild.ps1 -Dev` 跑通：release 后端 3m29s 编译成功、内嵌进 bundled、electron-vite dev 起来（CDP 9230）。aioncore 正常响应 REST。用 CDP 直连渲染进程真实页面（`localhost:5173`，MCP 只能看到 about:blank，故走原生 CDP websocket 脚本）做了 §4 的 4 个冒烟点：

- ✅ **冒烟点 1（设置页无最大输出框）**：设置→模型页正常打开不崩，展开「自定义」provider 后 10 个模型行全部渲染，每行只剩 **启用开关 / 心跳 / 删除**，**「最大输出」InputNumber 一个不剩**（`document.querySelectorAll('.arco-input-number').length === 0`，全页文本无「最大输出」）。
- ✅ **冒烟点 2（Provider 增删/create/update）**：后端 REST E2E（dev 的 `--local` aioncore 无 session、本地请求免 CSRF，直接 fetch 即复刻 app 真实调用路径）——`POST /api/providers` 201 → `PUT /api/providers/:id` 200（改名+启用生效）→ `GET` 复核持久化 → `DELETE` 200 归零。全程返回体无 `model_max_tokens`，字段 keys = `[id,platform,name,base_url,api_key,models,enabled,capabilities,is_full_url,key_status,created_at,updated_at]`。
- ✅ **冒烟点 4（存量库迁移 031）**：以上整套 CRUD 全部跑在 dev 数据目录 `%APPDATA%\1one-Dev` 的**既有旧库**上，`DROP COLUMN model_max_tokens` 已干净应用——无列不存在错误、无迁移报错、启动日志正常（仅有与本轮无关的既有 `wecom`/image-MCP bootstrap 噪声）。
- ⏭️ **冒烟点 3（对话跑通）**：未做活测。本轮改动纯粹是 Provider 实体删字段，未触碰 aionrs / agent / 模型解析（`resolve_model_max_tokens` 上一轮已删），且冒烟点 2 已证明 provider 读/写/解析路径完好；发真消息需可用模型 Key 且会打外部网关，与本改动正交，按「验证成本与改动复杂度匹配」原则跳过。

---

## 4. 剩余步骤（接手者从这里继续）

> **更新（07-20）**：下面第 0~1 步（清进程 + backend-rebuild + dev 4 冒烟点）**已做完，见 §3.1**。commit/push（第 2~3 步）**上一手已完成**。**接手者只需做第 4 步：Windows 打包。**

> 本轮既改后端又改 DB 迁移，按 [`ai-handoff-conventions.zh-CN.md`](ai-handoff-conventions.zh-CN.md) §2 必须重编后端进 bundled。

```powershell
# 0. 清残留进程
taskkill /F /IM electron.exe /T ; taskkill /F /IM aioncore.exe /T

# 1. 重编后端 + 搬进 bundled + 起前端 dev（一步到位）
D:\aionui-m0\scripts\backend-rebuild.ps1 -Dev
```

**dev 冒烟点（重点验证删字段没删坏）**：

1. 设置 → 模型：能正常打开（不黑屏），模型行里**「最大输出」输入框已消失**，其余（协议标签、启用开关、心跳、删除）都在。
2. 新增/编辑一个 Provider、加删模型：能正常保存，不报错（`providers` 表已无该列，创建/更新走通即证明后端 DTO/repository 对齐）。
3. 起一个对话跑通（证明 aionrs agent 构造不受影响）。
4. **存量库升级验证**：dev 数据目录 `%APPDATA%\1one-Dev`，如果里面已有旧版含 `model_max_tokens` 列的库，重启后迁移 031 会自动 DROP COLUMN——确认启动不崩、日志无迁移错误。

**确认无误后**：

```powershell
# 2. commit（1oneCore 与 1oneUI 各自提交；1oneUI 提交信息禁止 AI 署名，见其 AGENTS.md）
# 3. push origin one-main（两仓）
# 4. 打 Windows 包（bump version 后）
```

> ⚠️ 打包前记得按 [feedback-build-artifacts] 规矩：`package.json` version patch+1 并 commit push；不许删任何旧 .exe 安装包。

---

## 5. commit 建议

**1oneCore**（可加 AI 署名，本仓惯例允许）：

```
refactor(provider): 删除失效的 model_max_tokens 字段（端到端）

上一轮对齐上游 #641 后 aionrs 运行时恒不读 max_tokens，此字段变成
死数据。从 DB model/repository/sqlite/DTO/service 及所有周边构造点
删除，新增 migration 031 DROP COLUMN。不动 aionrs 的
ProviderCompat.transport.model_max_tokens（provider 预设规则表，无关）。
```

**1oneUI**（**禁止** AI 署名）：

```
refactor(settings): 删除失效的最大输出 token 输入框

对应后端删除 providers.model_max_tokens。删设置页 InputNumber、
IProvider/请求类型字段、13 语言 i18n key。
```

---

## 6. 相关文档

- [本轮起因：截断修复 + 上游二次同步](session-2026-07-20-truncation-fix-and-upstream-resync.zh-CN.md)（§5.1 是本轮的待办来源）
- [前后端加载约定](ai-handoff-conventions.zh-CN.md)（§2 改后端必重编）
- [启动脚本 README](../../../scripts/README.md)
