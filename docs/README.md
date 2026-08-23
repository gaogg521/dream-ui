# 1oneUI Docs

Documentation is organized by reader intent, not by document type.

| Directory                       | For whom                 | What lives here                                                                                                               |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [`guides/`](guides)             | Users & operators        | How to deploy, test, and run the product. Server deployment, WebUI, Hub testing, CDP debugging.                               |
| [`contributing/`](contributing) | Contributors             | Dev environment setup, file-structure conventions, PR automation workflow.                                                    |
| [`architecture/`](architecture) | Engineers & architects   | System architecture overview, subsystem deep-dives (ACP, queue, team mode), and supporting research notes.                    |
| [`specs/`](specs)               | Engineering-driven specs | Feature design docs, requirements, implementation plans (ACP rewrite, extension market, remote agent, wake prompt, PR notes). |
| [`prds/`](prds)                 | Product team             | Formal Product Requirement Documents maintained by the product team. **Do not reorganize without their consent.**             |
| [`readme/`](readme)             | Global users             | Translated copies of the root `readme.md` (Chinese, Japanese, Korean, Spanish, etc.).                                         |

## Quick pointers

- **多媒体生成（图片/视频）架构设计（Form A/B/C 三形态适配 + 异步任务引擎 + 能力目录，五阶段路线图，待评审）**? [`specs/media-generation/architecture.zh-CN.md`](specs/media-generation/architecture.zh-CN.md).
- New to the project? Start with [`architecture/overview.md`](architecture/overview.md).
- Setting up a dev environment? See [`contributing/development.md`](contributing/development.md).
- Writing code? The entry point for code-style, linting, formatting, and commit rules is [`AGENTS.md`](../AGENTS.md) at the repo root.
- Deploying a server? [`guides/deploy-server.md`](guides/deploy-server.md).
- Digital employees, the expert catalogue, or the `Provider '' not found` run failure? [`guides/session-2026-07-31-digital-employee-expert-model-binding.zh-CN.md`](guides/session-2026-07-31-digital-employee-expert-model-binding.zh-CN.md).
- Continuing the 2026-07-07 evening fork work (sidebar, enterprise, super-assistant, dev pitfalls)? [`guides/session-2026-07-07-evening.zh-CN.md`](guides/session-2026-07-07-evening.zh-CN.md).
- AI handoff rules (document every change + frontend/backend reload)? [`guides/ai-handoff-conventions.zh-CN.md`](guides/ai-handoff-conventions.zh-CN.md).
- **2026-08-18：视觉委托治理 + Claude Code/Codex 桥接纯文本模型的图片防编造降级**? [`guides/session-2026-08-18-vision-delegate-governance.zh-CN.md`](guides/session-2026-08-18-vision-delegate-governance.zh-CN.md).
- **2026-07-27：MCP 管理越界写用户真实 `~/.claude.json` 修复（读写刻意不对称 + 工具 schema 校验闸门）+ 一键导入解析 BUG 修复（Windows 反斜杠丢失 + 命令行拆分白名单太窄 + 弹窗无法单独勾选）**? [`guides/session-2026-07-27-mcp-config-isolation-and-import-fixes.zh-CN.md`](guides/session-2026-07-27-mcp-config-isolation-and-import-fixes.zh-CN.md).
- **2026-07-16：飞书桌面登录根治(回调页 1.2s 自动关闭抢掉协议确认框)+ 姓名回传 + 小猫图标 + 自动升级改指向自有 COS + 企业→项目组改名 + 「真实企业」层(SSO 按公司 tenant_key 自动入伙,后端已完成/前端待做)**? [`guides/session-2026-07-16-enterprise-tier-and-sso-fixes.zh-CN.md`](guides/session-2026-07-16-enterprise-tier-and-sso-fixes.zh-CN.md).
- 2026-07-08: 1ONE CLI branding + hide uninstalled CLI assistants? [`guides/session-2026-07-08-assistant-branding.zh-CN.md`](guides/session-2026-07-08-assistant-branding.zh-CN.md).
- 2026-07-08: 企业部署模式迁移 + 企业管理后台控制台首页(`/enterprise/console`)+ 策略分发方向? [`guides/session-2026-07-08-enterprise-console.zh-CN.md`](guides/session-2026-07-08-enterprise-console.zh-CN.md).
- **Fork 新开发者上手**（克隆哪两个仓库、怎么 dev、怎么打包装 Release）? [`guides/fork-dev-onboarding.zh-CN.md`](guides/fork-dev-onboarding.zh-CN.md).
- **脱离上游、清洗 Git 历史**? [`guides/repository-independence.zh-CN.md`](guides/repository-independence.zh-CN.md).
- **仓库更名对照（AionUi→1oneUI）**? [`guides/repo-rename-2026-07-08.zh-CN.md`](guides/repo-rename-2026-07-08.zh-CN.md).
- **2026-07-10~11：Agent 思考模型报错全部结案（网关拒绝 tool_calls 已用「文本化工具历史」绕过）+ 授权模式默认「全自动」+ 上游对齐 + 黑盒探测网关方法论**? [`guides/session-2026-07-10-thinking-param-and-rename.zh-CN.md`](guides/session-2026-07-10-thinking-param-and-rename.zh-CN.md).
- **2026-07-13：PDF 导出 Agent 不选用 export_to_pdf（aionrs ToolSearch 误判）+ 团队成员 Provider 'aionrs' not found（model="default" 占位符污染）修复，三仓改动索引**? [`guides/session-2026-07-13-toolsearch-team-provider-fixes.zh-CN.md`](guides/session-2026-07-13-toolsearch-team-provider-fixes.zh-CN.md).
- **2026-07-13：企业「一机一企业」残留数据 403 + 自助「重置本机企业数据」入口**? [`guides/session-2026-07-13-enterprise-reset-local-data.zh-CN.md`](guides/session-2026-07-13-enterprise-reset-local-data.zh-CN.md).
- **2026-07-14：模型 Key 反复失效根治（数据加密密钥与 JWT 解耦，不再被企业操作/改密码轮换误伤）+ 解不开的 Provider 显示「密钥失效」而非消失 + officecli PATH 兜底 + 内置 SKILL 打包确认**? [`guides/session-2026-07-14-model-key-encryption-decouple.zh-CN.md`](guides/session-2026-07-14-model-key-encryption-decouple.zh-CN.md).
- **2026-07-15：企业 SSO 桌面 deep link 被 dev/打包版互相抢注根治（`aionui://` 改成 dev/prod 各注册各的 scheme，后端 `scheme` 查询参数白名单校验）**? [`guides/session-2026-07-15-sso-deep-link-scheme-collision.zh-CN.md`](guides/session-2026-07-15-sso-deep-link-scheme-collision.zh-CN.md).
- **2026-07-15：Mac 打包（GitHub Actions 无本地 Mac 机器）已跑通并真机验证——真坑是 1oneCore 版本号改了却从没发 Release 导致下载 404，非 macOS/CI 问题**? [`guides/session-2026-07-15-mac-packaging-github-actions.zh-CN.md`](guides/session-2026-07-15-mac-packaging-github-actions.zh-CN.md).
- **2026-07-15：历史会话引用已删除 Provider 时报裸内部错误，加友好提示**（真正命中的是流式协议路径而非最初以为的 HTTP 路径，CDP 实测纠正了假设；`AgentErrorCode::ProviderNotFound` + 13 语言 i18n）? [`guides/session-2026-07-15-provider-not-found-friendly-error.zh-CN.md`](guides/session-2026-07-15-provider-not-found-friendly-error.zh-CN.md).
- **2026-07-18：上游同步 v2.1.37 作战清单（企业铁律：个人版/终端跟版不得影响企业模块）**? [`guides/session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md`](guides/session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md)。
- **2026-07-19：上游同步（v2.1.37/Core 0.1.48/aionrs 0.2.5）功能与提交总表**? [`guides/session-2026-07-19-upstream-sync-changelog.zh-CN.md`](guides/session-2026-07-19-upstream-sync-changelog.zh-CN.md)。
- **2026-07-20：上游同步合并后 BUG/冲突静态审查（三仓 16 项核查，2 项待办 + 1 项建议补测试 + 企业 WIP stash 澄清）**? [`guides/session-2026-07-20-post-sync-bug-conflict-audit.zh-CN.md`](guides/session-2026-07-20-post-sync-bug-conflict-audit.zh-CN.md)。
- **2026-07-20：企业组织 vs 项目组彻底解耦落地（新增 one-enterprise crate，one-org 剥离 SSO 绑定，真实开发库迁移冒烟验证）**? [`guides/session-2026-07-20-enterprise-org-decouple.zh-CN.md`](guides/session-2026-07-20-enterprise-org-decouple.zh-CN.md)。

## Where to put new docs

| Content type                                               | Destination                 |
| ---------------------------------------------------------- | --------------------------- |
| User/ops-facing how-to                                     | `guides/`                   |
| Contributor convention, workflow, or tooling rule          | `contributing/`             |
| System or subsystem design, technical analysis             | `architecture/`             |
| Exploratory research, analysis reports                     | `architecture/research/`    |
| Feature requirements / design drafts driven by engineering | `specs/<feature-name>/`     |
| Formal PRD owned by product team                           | `prds/` (coordinate first)  |
| README translation                                         | `readme/readme_<locale>.md` |
