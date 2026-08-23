# 2026-07-14 模型 Key 加密密钥与 JWT 解耦 + officecli PATH 兜底

本轮修三件事：**问题3**（开发/正式环境模型 Provider 的 API Key 反复失效、"重启后模型没了"）——根治；**问题2**（officecli 每次任务都要重装）——补 PATH 兜底；以及排除了"其他内置 SKILL 是否也没打进安装包"的担忧。

> 关联：[`ai-handoff-conventions.zh-CN.md`](ai-handoff-conventions.zh-CN.md)（改完必更新文档 + 前后端加载）、[`session-2026-07-10-thinking-param-and-rename.zh-CN.md`](session-2026-07-10-thinking-param-and-rename.zh-CN.md)（Provider "消失" 的旧诊断，本轮找到并根治了真因）、[`session-2026-07-13-enterprise-reset-local-data.zh-CN.md`](session-2026-07-13-enterprise-reset-local-data.zh-CN.md)（企业重置流程）。

---

## 问题3：模型 API Key 反复失效 —— 根因与根治

### 现象

用户添加好的模型 Provider，一段时间后（尤其"重启"后）API Key 全部失效、Provider 在设置页"凭空消失"。此前 [`session-2026-07-10`](session-2026-07-10-thinking-param-and-rename.zh-CN.md) 只诊断到"JWT secret 轮换 → 加密 key 失效"这一层，给了"重新粘 Key"的临时兜底，**没找到轮换的真正触发点，也没根治**。

### 根因（本轮实锤）

数据加密链路：所有存库的密钥（Provider API Key、团队 agent、MCP、channel、remote agent）都用 `derive_encryption_key(jwt_secret)` 派生的 AES key 加密（`aionui-app/src/config.rs` `derive_encryption_key`）。

而 `jwt_secret` 是**登录会话密钥**，`one-org`（企业域）会在下列操作里**故意轮换它来注销会话**（`one-org/src/service.rs` `invalidate_user_tokens` → `update_jwt_secret`）：

- `create_tenant`（建企业）
- `join_with_invite`（加入企业）
- `leave`（退出企业）
- `reset_local_enterprise`（重置本机企业数据）

`aionui-auth` 改密码（`routes.rs` change-password）也会轮换。

于是：**每做一次企业操作，就把单机版所有模型 Key 的加密密钥换掉，导致此前加密的 Key 全部解不开** —— 这正是用户直觉"模型 Key 跟企业本该没关系"的错误耦合。用户高频测试企业功能，所以反复中招（真实库里 07-09/07-13/07-14 三个 Provider 全部解不开，且后端日志出现 team agent "1ONE CLI" 同款 `Decryption failed`）。

判别方法论（供以后复用）：

- `list()` 返回 `{"success":true,"data":[]}`（成功但空）= 解密失败被跳过（`CryptoError::DecryptionFailed.is_bad_request()==true` → `SystemError::BadRequest`），**不是** JSON 解析回归（那会 500）。
- 写只读诊断（Rust example，读库不打印密钥本身、只打印指纹/布尔）验证"当前库里的 jwt 派生 key 能否解开各 Provider"：新建的能解、老的都不能 → 确认是轮换后重新持久化。
- 日志 grep `Generated and persisted new JWT secret` 只在启动 generate 路径打印；`one-org` 走 `update_jwt_secret` 不打印这行 —— 所以别只靠这行判断有没有轮换。

### 修复：数据加密密钥独立于 JWT（彻底解耦）

新增一个**专用、稳定、永不被认证/企业流程轮换**的 `data_secret`：

**后端（1oneCore）**

- `migrations/025_add_user_data_secret.sql`：`users` 表加 `data_secret TEXT`（可空）。
- `aionui-db` `models/user.rs` 加字段；`repository/user.rs` + `sqlite_user.rs` 加 `update_data_secret`（与 `update_jwt_secret` 平行，独立列）；`create_user` 补 `data_secret: None`。
- `aionui-app/src/services.rs` `from_config`：解析 jwt 之后，解析 `data_secret`——
  - 库里已有非空 `data_secret` → 直接复用；
  - 为空（老库首次升级）→ **用当前 jwt_secret 回填一次**并持久化（保证升级前用当前 jwt 还能解密的数据继续可读），之后永不随 jwt 变。
  - 新增 `AppServices.data_secret_raw` 字段。
- 5 处 `derive_encryption_key(&services.jwt_secret_raw)`（`router/state.rs` ×4 + `services.rs` ×1）全部改用 `data_secret_raw`。`jwt_secret_raw` 仅剩给 `JwtService` 签名用。
- **解不开的 Provider 不再静默隐藏**：`aionui-system/src/provider.rs` `list()` 把 `row_to_response` 拆成 `build_response`（不含解密），解密失败的行改为返回**空 api_key + `key_status=Unrecoverable`**，而不是 `continue` 丢掉。新增 `ProviderKeyStatus`（`aionui-api-types/src/provider.rs`，`Ok`/`Unrecoverable`，`#[serde(default)]`）。

**前端（1oneUI）**

- `common/config/storage.ts` `IProvider` 加 `key_status?: 'ok' | 'unrecoverable'`。
- `ModelModalContent.tsx`：`key_status==='unrecoverable'` 时在 Provider 名旁显示红色"密钥失效"Tag，点击打开 API Key 编辑弹窗重录。
- i18n：`settings.apiKeyUnrecoverable` / `apiKeyUnrecoverableTip`（zh-CN + en-US，其余语言走 `fallbackLanguage: en-US`）。

### 为什么放 `users` 行也安全

逐一核对：`create_tenant`/`join`/`leave`/`reset_local_enterprise` 只写 `one_tenants`/`one_user_org`/`one_tenant_invites` + 调 `invalidate_user_tokens`（只 `update_jwt_secret`），**都不碰 `users.data_secret`**。`reset_local_enterprise` 也只 DELETE 那三张企业表，不动 `users`。所以 `data_secret` 一旦生成就再无任何流程会改写它。

### 验证

- 单测：`aionui-db` `update_data_secret_*`（含"jwt 轮换后 data*secret 不变"）；`aionui-app` `data_secret_is_seeded_from_jwt_on_first_init` + `data_secret_survives_jwt_secret_rotation`；`aionui-system` `list_surfaces_undecryptable_provider_rows_as_unrecoverable`（原 `list_skips*...` 因行为变更改写）。
- 干净库 E2E（headless `aioncore --local`，全新空 data-dir，进程间用 taskkill）：BOOT1 建 Provider → BOOT2 普通重启存活 → 同进程 `org/create` 轮换 jwt 后存活 → **BOOT3 企业操作后重启仍存活**（reseed=0）。三场景全 `key_status=ok`。
- 真实库（dev app 起新后端）：迁移 025 应用、`data_secret` 回填、3 个老 Provider 后端返回 `unrecoverable`、UI 显示 3 个"密钥失效"红标（CDP `hasUnrecoverableTag:true`）。**没在真实库做建企业等破坏性操作**，避免污染用户数据。

> ⚠️ 测试踩坑：第一次 E2E **热拷贝了正在运行的 dev 库**（连 4MB 活跃 WAL 一起拷），那是不一致快照，硬杀后 seed 写入没被下次启动读到 → 假象"重启后仍丢"。换全新空库后三场景全过。**别热拷贝运行中的 SQLite 库做测试。**

### 已失效数据不可恢复

真实库那 3 个老 Provider 的明文 Key 已随历次轮换永久丢失，只能显示"密钥失效"提示用户重录。修复后新录入的 Key 用稳定 `data_secret` 加密，企业操作不再误伤。

---

## 问题2：officecli 每次任务都要重装

### 根因

两层：

1. **安装包根本没内置 officecli 二进制**（`electron-builder.yml` `extraResources` 只有 `bundled-aioncore`），agent 首次用必走 `irm https://d.officecli.ai/install.ps1 | iex`，装到 `%LOCALAPPDATA%\OfficeCLI\officecli.exe`（`OfficeCLI/install.ps1`）。
2. **装完当次会话也认不出来**：officecli 装完把目录写进注册表用户级 PATH，但后端 `aioncore` 的 PATH 是启动时一次性合并冻结的（`aionui-runtime/src/shell_env.rs` `enhance_process_path` 只在 `main()` 跑一次），注册表 PATH 变更不会进已运行进程。agent 发的 `officecli --version` 永远看不到它 → 只能反复重装。

### 修复

`shell_env.rs` `platform_extra_bins_at()` Windows 段补 `%LOCALAPPDATA%\OfficeCLI` 作为已知目录兜底（与 pnpm/WinGet/Yarn 同款写法，直接检查目录、不对 exe 做 existsSync —— 避免 [[officecli-bundled]] 记的 AV 扫描冻结）。这样每次后端启动都能兜底把已装的 officecli 加进 PATH，不必等注册表 PATH 生效。

> 运行时闭环（agent 跑文档不再重装）需用户有可用模型才能测；本轮部署时用户模型 Key 都失效、暂未跑。逻辑已确认 + 用户机器上 `officecli.exe` 确在兜底目录。

### 扩大担忧已排除：其他内置 SKILL 会不会也没打进包？

**不会。** 所有内置 SKILL（officecli-\*、mermaid、pdf、moltbook 等全部）用 `include_dir!` 编进 `aioncore.exe`（`aionui-extension/src/skill_service.rs` `BUILTIN_SKILLS`），每次启动按内容 SHA-256 指纹校验重新落地到 `<data_dir>/builtin-skills/`（`startup_materialize.rs`）。不会漏、不会因 app 更新而 stale。`electron-builder.yml` 里没有也不需要 skills 条目。officecli 那个问题只针对**外部工具二进制**，与 SKILL 文件无关。

---

## 改动索引

**1oneCore**（`one-main`）：`aionui-db`(migration 025 + user model/repo)、`aionui-app`(services 密钥解析 + router/state 5 处 derive)、`aionui-system`(provider list surface)、`aionui-api-types`(ProviderKeyStatus)、`aionui-runtime`(shell_env officecli PATH)。
**1oneUI**（`one-main`）：`common/config/storage.ts`、`ModelModalContent.tsx`、i18n(zh-CN/en-US settings + 生成的 i18n-keys.d.ts)。

## 加载 / 部署

改了后端 → 必须 `cargo build -p aionui-app --release` 并把 exe 搬进 `1oneUI/resources/bundled-aioncore/win32-x64/`（dev app 运行时该文件被锁，需先关 app）。前端改动走 `bun run dev` HMR。**未打 Release 安装包**。
