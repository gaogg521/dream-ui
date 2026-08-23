# 上游同步 v2.1.37 作战清单（企业铁律）

> **2026-07-18**。对照 [`upstream-sync-reference.zh-CN.md`](upstream-sync-reference.zh-CN.md)。  
> **目标**：吃进上游 AionUi **v2.1.33→v2.1.37** + AionCore **v0.1.46→v0.1.48** + aionrs **v0.2.3→v0.2.5**。  
> **铁律（用户明确）**：**个人版 / 终端跟版绝对不能影响现有企业版模块。**

---

## ★ 企业铁律（拒收门禁，高于一切）

同步过程中下列区域 **一律 `--ours` / 禁止被上游改写行为**：

| 区域            | 路径 / 标识                                                                     | 说明                                                      |
| --------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 企业后端 crates | `1oneCore/crates/one-*`、`one-enterprise/`、`one-sso`、`one-org`、`one-devops`… | fork 自有，上游无对应物                                   |
| 企业前端        | `enterprise` 设置 tab、策略分发、组织/SSO UI、企业控制台                        | 设置 IA 保 fork                                           |
| 设置信息架构    | `Router` / `SettingsSider` / `SettingsPageWrapper` / `SkillsHubSettings`        | 上次已踩坑：上游 #3520 拆分会冲掉 capabilities + 企业 tab |
| 后端版本钉      | `aioncoreVersion = vX.Y.Z-one.N`                                                | 绝不取上游裸 `v0.1.48`                                    |
| aionrs 依赖     | `Cargo.toml` → `gaogg521/aionrs` **`master`**                                   | 绝不跟上游改成 `iOfficeAI/aionrs` tag                     |
| 品牌            | 显示名 1One Work / 1ONE Code；`1onecode.exe` NSIS                               | 内部标识与上游文档 URL 不动                               |

**验收红线（任一触发即拒收、不同 one-main）**：

1. 企业管理 / SSO / 策略 / 组织维度流程崩坏或 UI 消失
2. `one-*` crate 被删、被上游覆盖、或编译断链
3. 设置里企业 tab / capabilities 被上游拆分冲掉
4. aionrs 6 专属补丁丢失（文本化兜底 / 空参 / thinking 阶梯 / deferred / GLM）
5. 新增 tsc / cargo 错误；dev 白屏 / 企业 API 404·500

---

## 0. 版本基线（开工前）

| 仓       | 开工前                      | 目标上游                               | 目标 fork                 |
| -------- | --------------------------- | -------------------------------------- | ------------------------- |
| aionrs   | v0.2.2 + 6 补丁（`master`） | **v0.2.5**                             | v0.2.5 + 6 补丁重贴       |
| 1oneCore | v0.1.45-one.1（`one-main`） | **v0.1.48**（先 `git fetch upstream`） | **v0.1.48-one.1**         |
| 1oneUI   | 2.1.46，内容≈上游 v2.1.32   | **v2.1.37**                            | bump 自有号（合主后再定） |

**级联顺序（强制）**：① aionrs → ② 1oneCore → ③ 1oneUI。  
**隔离分支**：`sync-v025` / `sync-v0148` / `sync-2137`，未验收前不进 `master`/`one-main`。

---

## 1. 开工前准备

- [ ] **1oneCore 企业 WIP stash**（当前脏：`one-enterprise/`、`one-sso`、`one-org`…）→ `stash push -u -m "wip-enterprise-before-sync-v0148"`
- [ ] 三仓 `git fetch upstream --tags`；Core 确认 `upstream/main` = **v0.1.48** tip
- [ ] 1oneUI 无关图片资源保持 untracked，勿 `git add -A`

---

## 2. 波次 A · aionrs → v0.2.5

```bash
cd D:\aionui-m0\aionrs-local
git checkout -b sync-v025 master
git merge v0.2.5
# 冲突：fork 补丁文件优先保留行为；图像相关与 openai_messages/orchestration 重叠处手工合
```

**必须存活的专属补丁（代码，非 docs）**：

| Commit                      | 能力                                      |
| --------------------------- | ----------------------------------------- |
| `3f7b9b5`                   | 流式 tool_call 空参                       |
| `81a1d06`                   | thinking 多级回传重试                     |
| `ea45450`                   | 文本化工具历史（命脉）                    |
| `8de0bf5`                   | deferred schema 命中即提升                |
| `92d9242`                   | GLM 盲搜纠偏                              |
| （附）`f06eb40` / `cb7c871` | ToolSearch 文案 / ExecCommand Win PS 警告 |

**验收**：`cargo test --workspace` 绿；`cargo build --release` 过。  
**合主**：用户点头后再 `master` + push（1oneCore pin master 才吃到）。

---

## 3. 波次 B · 1oneCore → v0.1.48-one.1

```bash
cd D:\aionui-m0\1oneCore
git stash list   # 确认企业 WIP 已 stash
git checkout -b sync-v0148 one-main
git merge v0.1.48   # 或已刷新的 upstream/main
```

**冲突固定决策**：

| 文件                                                  | 决策                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Cargo.toml` / `Cargo.lock`                           | 保 `one-*` + `aion-* = { git=gaogg521/aionrs, branch=master }`；版本 → `0.1.48-one.1` |
| `crates/one-*/**`                                     | **整树 `--ours`**，上游不得改                                                         |
| migration 撞号                                        | fork 已应用号不可改；新上游 migration **往后排号**（上次 019 撞车教训）               |
| butler / assistant / cron / agents(Pi) / image / PATH | 取上游（个人版终端能力）                                                              |
| cli / error 枚举                                      | 合并两边变体，勿丢 fork 命令                                                          |

**禁止**：把 aionrs 改成官方 tag；删除 Bun 时确认 fork 无依赖再跟。

**验收**：`cargo check --workspace`；`one-*` 相关测试仍绿；企业路由源码 diff 相对 stash 前基线无意外删改。  
重编 exe / bundled **本波可做但不强制合主**。

---

## 4. 波次 C · 1oneUI → 上游 v2.1.37 内容

```bash
cd D:\aionui-m0\1oneUI
git checkout -b sync-2137 one-main
git merge upstream/main   # = v2.1.37
```

**冲突固定决策**：

| 区域                                                             | 决策                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Router / SettingsSider / SettingsPageWrapper / SkillsHubSettings | **`--ours`**（企业 tab + capabilities）                                         |
| 技能详情 / 批量删除 / UsedBy                                     | **手工移植**进 fork `SkillsHubSettings`（禁止整吃上游 SkillsSettings 目录改版） |
| cron 可视化 / 队列保护、搜索、拖拽、409/发送修复、标题栏热修     | 取上游                                                                          |
| `package.json` version / aioncoreVersion                         | 保 fork 号；aioncoreVersion → 将来的 `v0.1.48-one.1`                            |
| locales 品牌                                                     | 合并后批量 `AionUi →` 显示品牌                                                  |
| NSIS / `AionUi.exe`                                              | 扫 `1onecode.exe` / `AIONUI_APP_EXECUTABLE_FILENAME`                            |

**企业模块回归清单（桌面亲测，必做）**：

1. 设置 → **企业** tab 仍在、可进
2. 组织 / SSO / 策略相关页不白屏、API 非 404
3. capabilities（技能+工具合并页）仍在，未被拆成上游两页冲掉
4. 个人版：新建会话、发消息、cron、技能列表（个人能力可新，企业壳不能没）

---

## 5. 本轮要吃进的上游能力（对照）

| 能力                                        | 仓                         | 备注                     |
| ------------------------------------------- | -------------------------- | ------------------------ |
| CLI 看图                                    | aionrs 0.2.5 + Core 0.1.48 | 三仓级联                 |
| Pi Agent                                    | Core 0.1.48                |                          |
| cron 可视化 + 队列保护                      | UI 2.1.36 + Core 0.1.47    |                          |
| 技能详情/批量/搜索/拖拽                     | UI 2.1.36                  | 技能 UI 移植，IA 保 fork |
| 409/忙时发送、附件截断、启动修复…           | UI 2.1.34–35               |                          |
| PATH / 团队备用通道 / 管家字段 / 规则规范化 | Core 0.1.46–48             |                          |
| 标题栏热修                                  | UI 2.1.37                  | 跟 2.1.36 bridge 一并吃  |

---

## 6. 发布连锁（仅用户点头后）

1. aionrs `sync-v025` → `master` + push
2. 1oneCore 重编 `aioncore.exe` → prepareAioncore → tag `v0.1.48-one.1` → `one-main`
3. 1oneUI 回填 `aioncoreVersion`、bump、合 `one-main`、`dist:win`（不删旧 exe）
4. **恢复** 1oneCore 企业 stash，在新基线上 rebase/续做

---

## 7. 进度日志

| 时间             | 步骤                                                                                                                                                                                                   | 状态                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18       | 清单落盘；企业 WIP stash `wip-enterprise-before-sync-v0148`                                                                                                                                            | ✅                                                                                                                                                                        |
| 2026-07-18       | **aionrs `sync-v025`**：merge v0.2.5 + 保留 deferred/GLM/textualize；`cargo test --workspace` 全绿                                                                                                     | ✅ 分支 tip `4ead7e1`（**未合 master，push 因 GitHub 网络失败**）                                                                                                         |
| 2026-07-18       | **1oneCore `sync-v0148`**：merge v0.1.48 → `0.1.48-one.1`；**`crates/one-*` 相对 one-main 零 diff**；`cargo check --workspace` 绿                                                                      | ✅ tip `3634e5b8`。⚠️ **临时** `aion-*` 为 path=`../aionrs-local/...`（网络不通无法拉 git）；合主前须改回 `gaogg521/aionrs` `master` 并 `cargo update`                    |
| 2026-07-18       | **1oneUI `sync-2137`**：merge upstream/main(=v2.1.37)；Router/SettingsSider/Capabilities/Enterprise **保 fork**；`aioncoreVersion=v0.1.48-one.1`；`tsc --noEmit` 0                                     | ✅ tip `60cd183fa`。⚠️ 技能详情页/批量删除/UsedBy **未整吃上游 SkillsSettings**（防冲企业 IA），待手工移植进 fork `SkillsHubSettings`；拖拽 polish 保 fork GroupedHistory |
| 2026-07-19       | **migration 撞号**：上游 021–024 与 fork 已应用 021–025 冲突 → 重排为 **026–029**（`15c72819`）                                                                                                        | ✅                                                                                                                                                                        |
| 2026-07-19       | **桌面 `bun run dev` 冒烟**：后端 `0.1.48-one.1` LISTENING；存量库 migration 到 29；CDP：企业/能力扩展/Agents/首页均非白屏；`/api/one/org/*` `/api/one/sso/*` `/api/one/devops/*` `/api/cron/jobs` 200 | ✅（dev 仍在跑）                                                                                                                                                          |
| 2026-07-19       | 发布连锁 / 企业 stash 恢复 / push                                                                                                                                                                      | ⏳ 待用户点头 + 网络恢复                                                                                                                                                  |
| 2026-07-19       | **自定义网关看图**：LiteLLM + 跨厂商模型 ID 归一；重编嵌入                                                                                                                                             | ✅ commit `357bbbf3`；详见看图专项                                                                                                                                        |
| 2026-07-19 晚    | **用户验收**：自定义网关下 **Kimi（`kimi-k2-6`）看图正常**                                                                                                                                             | ✅                                                                                                                                                                        |
| 2026-07-19 晚    | **品牌补齐**：注入技能 / ACP / capabilities 用户可见名 → **1One Work**（保留 `aionui-*` / `AIONUI_*`）                                                                                                 | ✅ commit `9504fa47`；详见 [`session-2026-07-19-brand-skills-acp.zh-CN.md`](session-2026-07-19-brand-skills-acp.zh-CN.md)                                                 |
| 2026-07-19 22:22 | **隔离 dev 验证**：`1one-Dev`；窗口标题 1One Work；`/api/skills` 无 AionUi 品牌串                                                                                                                      | ✅                                                                                                                                                                        |

### 合主前必做

1. `aionrs`: push `sync-v025` → 合 `master`（或用户授权 force-with-lease）
2. `1oneCore`: path deps → git `master` pin；`cargo update`；确认 `one-*` 仍零意外 diff；再合 `one-main`
3. `1oneUI`: 合 `one-main` 前桌面亲测企业 tab / capabilities / SSO
4. `git stash pop` 恢复企业 WIP（在新基线上解决）
5. 技能详情/批量删除：从上游 #3600–3604 **手工移植**，禁止改 Router/SettingsSider

---

## 相关文档

- [`upstream-sync-reference.zh-CN.md`](upstream-sync-reference.zh-CN.md)
- [`session-2026-07-11-upstream-sync-v2132-handoff.zh-CN.md`](session-2026-07-11-upstream-sync-v2132-handoff.zh-CN.md)
- [`session-2026-07-19-upstream-sync-changelog.zh-CN.md`](session-2026-07-19-upstream-sync-changelog.zh-CN.md)（**功能/BUG 总表**，优先给其他 AI 读）
- [`session-2026-07-19-custom-gateway-image-input.zh-CN.md`](session-2026-07-19-custom-gateway-image-input.zh-CN.md)（看图白名单 / 自定义网关细节）
- [`session-2026-07-19-brand-skills-acp.zh-CN.md`](session-2026-07-19-brand-skills-acp.zh-CN.md)（注入技能 / ACP 品牌）
- [`ai-handoff-conventions.zh-CN.md`](ai-handoff-conventions.zh-CN.md)
