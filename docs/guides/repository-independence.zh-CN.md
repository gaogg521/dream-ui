# 仓库独立化指南（脱离上游 iOfficeAI）

> **现状（2026-07-08）**
>
> - `gaogg521/1oneUI`、`gaogg521/1oneCore` 在 GitHub 上仍是 **fork**（parent = `iOfficeAI/*`）
> - 本地仍有 `upstream` remote
> - AionUi `one-main` 全历史约 **149** 个 commit，其中自 fork 后自有约 **46** 个
> - AionCore `one-main` 约 **30** 个 commit（含「同步上游」merge）

独立化分 **两层**，只做一层不够：

| 层级                         | 做什么                                               | 效果                                               |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **A. GitHub 脱离 fork 网络** | 仓库 Settings → Danger Zone → **Leave fork network** | GitHub 不再显示「forked from」，与上游 PR 网络断开 |
| **B. Git 历史清洗**          | 重写历史，只保留自有 commit 或单次快照               | `git log` 里不再出现上游几千条 commit              |

---

## 方案选择（历史怎么留）

### 方案 1：单次快照（推荐，最干净）

当前代码树 → **1 个初始 commit**，例如 `feat: initial 1ONE Code v2.1.31`。

- 优点：历史极简、完全看不出上游 lineage
- 缺点：丢失 46 条逐条 commit 信息（可用 CHANGELOG / session 文档补）

### 方案 2：保留自有 commit 链（约 46 / 30 条）

从 fork 起点 `f8c1206`（AionUi）之后 cherry-pick / rebase 到空根上。

- 优点：保留「M3/M4/M5…」等开发脉络
- 缺点：操作复杂，merge commit 可能要手工解

### 方案 3：只断 GitHub、不洗历史

仅 Leave fork network + `git remote remove upstream`，**不 force push**。

- 优点：零风险
- 缺点：`git log` 仍含上游祖先 commit

---

## 方案 1 操作步骤（1oneUI 示例）

**务必先备份：**

```powershell
cd D:\aionui-m0\1oneUI
git branch backup-one-main-20260708
git push origin backup-one-main-20260708
```

**本地重写（在 1oneUI 执行）：**

```powershell
cd D:\aionui-m0\1oneUI
git checkout --orphan main-standalone
git add -A
git commit -m "feat: initial 1ONE Code v2.1.31 standalone codebase"

git branch -D one-main
git branch -m one-main

git remote remove upstream   # 若存在
git push --force origin one-main
```

**1oneCore 同样流程**（在 `D:\aionui-m0\1oneCore` 重复，`commit` 文案改为 1oneCore 版本说明）。

**GitHub 上（每个仓库各做一次）：**

1. 打开 `https://github.com/gaogg521/1oneUI/settings`（1oneCore 同理）
2. 滚到 **Danger Zone** → **Leave fork network**
3. 按提示输入仓库名确认

> 条件：公开仓库、&lt;1GB、无子 fork。不满足则走「删库重建 + mirror push」见 [GitHub 文档](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/detaching-a-fork)。

**Release / 协作者：**

- 已有 Release（如 v2.1.31）在 force push 后 **tag 需重建**（orphan 后旧 tag 指向消失）
- 通知协作者：`git fetch --all` 后 `git reset --hard origin/one-main`（会丢本地未推送 commit）

---

## 洗历史之后还要改什么

| 项               | 建议                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| 默认分支         | 可保持 `one-main`，或改名为 `main` 并在 GitHub Settings 改 default                         |
| 文档             | `contributing/development.md` 里上游 clone 地址可改指向 `gaogg521`                         |
| 更新检查         | `updateBridge.ts` 默认 `iOfficeAI/AionUi` → 改为 `gaogg521/1oneUI`（否则检查更新仍查上游） |
| package / 版权头 | 按需替换 `AionUi (aionui.com)` 等字样                                                      |

---

## 与 `D:\1one-command` 的关系

**独立化只针对 `1oneUI` + `1oneCore`。**  
`D:\1one-command` 是旧版 **1ONE ClaudeCode** 单仓，与 v2 无关；不必合并进新历史，可归档只读。
