# 1ONE Code（fork v2）开发者上手指南

> **适用对象**：从 `gaogg521` fork 继续开发的人类或 AI。  
> **主分支**：`one-main`（前端 + 后端均在此分支，不是上游 `main`）。

> **仓库更名（2026-07-08）**：GitHub 与本地目录已由 `AionUi` / `AionCore` 改为 **`1oneUI` / `1oneCore`**。旧链接见 [repo-rename-2026-07-08.zh-CN.md](repo-rename-2026-07-08.zh-CN.md)。

---

## 0. 日常开发进哪个目录？

```text
D:\aionui-m0\                 ← 工作区根（不是 git 仓库，放 scripts）
├── scripts\                  ← 启动脚本：frontend-dev / backend-rebuild
├── 1oneUI\                   ← 前端 git：改 UI、设置、桌面 → 在这里 commit
└── 1oneCore\                 ← 后端 git：改 Rust、迁移、API → 在这里 commit

D:\1one-command\              ← 旧版 1ONE ClaudeCode，仅维护遗留 bug，不做 v2 新功能
```

| 你要做的事                  | 进入目录                                      |
| --------------------------- | --------------------------------------------- |
| 改界面 / 设置页 / 打包前端  | `D:\aionui-m0\1oneUI`                         |
| 改 API / 数据库迁移 / Agent | `D:\aionui-m0\1oneCore`                       |
| 一键起 dev / 重编后端       | 在任意处执行 `D:\aionui-m0\scripts\*.ps1`     |
| Cursor 打开整个工程         | **`D:\aionui-m0`**（推荐，同时看到前后端）    |
| 旧 Electron 单仓            | `D:\1one-command`（**不要**用于当前 v2 主线） |

---

## 1. 要克隆哪些仓库？

本项目是 **双仓库** 架构，必须各克隆一份，建议放在同一父目录下：

| 仓库                 | 地址                                       | 分支       | 作用                       |
| -------------------- | ------------------------------------------ | ---------- | -------------------------- |
| **1oneUI**（前端）   | `https://github.com/gaogg521/1oneUI.git`   | `one-main` | Electron 桌面 + React UI   |
| **1oneCore**（后端） | `https://github.com/gaogg521/1oneCore.git` | `one-main` | Rust 本地 API / DB / Agent |

推荐目录结构（Windows 示例）：

```text
D:\aionui-m0\
├── 1oneUI\          ← git clone 1oneUI
├── 1oneCore\        ← git clone 1oneCore
└── scripts\         ← 开发脚本（见 §4；可单独复制 scripts/README.md 中的命令）
```

### 首次克隆

```powershell
mkdir D:\aionui-m0
cd D:\aionui-m0

git clone -b one-main https://github.com/gaogg521/1oneUI.git 1oneUI
git clone -b one-main https://github.com/gaogg521/1oneCore.git 1oneCore
```

### 依赖环境

| 工具            | 版本要求                           |
| --------------- | ---------------------------------- |
| Node.js         | 22+                                |
| bun             | 最新稳定版                         |
| Rust + Cargo    | stable（Windows 需 MSVC 构建工具） |
| Python          | 3.11+（部分 native 模块编译）      |
| GitHub CLI `gh` | 可选（发 Release / 查 PR）         |

1oneUI 安装依赖：

```powershell
cd D:\aionui-m0\1oneUI
bun install
```

---

## 2. 安装包 vs 源码：怎么选？

| 目的                  | 做法                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **只想试用/验收功能** | 从 [1oneUI Releases](https://github.com/gaogg521/1oneUI/releases) 下载 `1ONE Code-<version>-win-x64.exe` 安装 |
| **继续改代码**        | 克隆上面两个仓库，按 §3 起 dev 环境                                                                           |
| **只测后端 API**      | `backend-run.ps1`（见 `scripts/README.md`）                                                                   |

> Release 安装包内已 bundled 1oneCore，**不能**用来改后端源码；改 Rust 必须本地 `backend-rebuild.ps1`。

---

## 3. 日常开发怎么跑？

### 只改前端（UI / 设置页 / 助手列表等）

```powershell
D:\aionui-m0\scripts\frontend-dev.ps1
```

等价于在 `1oneUI` 下 `bun run dev`；数据目录 `%APPDATA%\AionUi-Dev`（与正式安装隔离）。

### 改了 1oneCore（API、DB 迁移、Agent 探测）

```powershell
D:\aionui-m0\scripts\backend-rebuild.ps1
D:\aionui-m0\scripts\frontend-dev.ps1

# 或一步到位
D:\aionui-m0\scripts\backend-rebuild.ps1 -Dev
```

**常见误区**：`bun run dev` **不会**自动编译 Rust；dev 启动的是 `1oneUI/resources/bundled-aioncore/.../aioncore.exe`。

### 打 Windows 安装包（发版 / 给测试）

一条命令(推荐,已内置下面的坑规避)：

```powershell
D:\aionui-m0\scripts\package-win.ps1            # 用现有本地 aioncore.exe 打包
D:\aionui-m0\scripts\package-win.ps1 -Rebuild   # 改过后端时:先 cargo build 再打包
```

或手动等价：

```powershell
D:\aionui-m0\scripts\backend-rebuild.ps1   # 若后端有改动

cd D:\aionui-m0\1oneUI
$env:AIONUI_BACKEND_LOCAL_PATH = 'D:\aionui-m0\1oneCore\target\release\aioncore.exe'
bun run dist:win
# 产物：out\1ONE Code-<version>-win-x64.exe
```

> ⚠️ **`AIONUI_BACKEND_LOCAL_PATH` 不是可选的。** 打包链(`build-with-builder.js` →
> `prepare-aioncore.js`)默认按 `package.json` 的 `aioncoreVersion` **去 GitHub Release 下载**
> aioncore 二进制;私有 fork 那个 tag(如 `v0.1.48-one.1`)通常没有对应平台产物,
> 不设这个变量就会在 electron-builder 之前挂掉:
> `❌ Build failed: aioncore binary not found for win32-x64 (tag: ...)`。
> 设了它就走 `prepare-aioncore.js` 的优先级 0 本地分支、跳过下载;日志出现
> `Bundled aioncore prepared: ... [source=local]` 即对。`package-win.ps1` 已替你设好。
>
> 打包前记得(见 [feedback-build-artifacts] 规矩):`package.json` version patch+1 并 commit push;
> **不许删任何旧 `.exe` 安装包**(`out\` 里按版本号命名的都保留)。

上传到 GitHub Release（**务必带上 `latest.yml`**，否则已安装用户收不到自动更新提示）：

```powershell
git tag v<version>
git push origin v<version>

cd D:\aionui-m0\1oneUI\out
gh release create v<version> `
  "1ONE Code-<version>-win-x64.exe" "latest.yml" `
  --repo gaogg521/1oneUI `
  --title "v<version>" `
  --notes "见 session 文档或 PR 说明"
```

> 当前最新：**v2.1.32**（仅 Windows x64）。mac/linux/win-arm64 需在对应平台或 CI 上 `bun run dist:mac` / `dist:linux` 补齐。

---

## 4. 脚本目录说明

`scripts/` 放在 `aionui-m0` 根下，**不是** git 仓库的一部分（避免污染 fork 提交）。若你只有两个 clone、没有 scripts 文件夹，可从同事处复制 `D:\aionui-m0\scripts\` 三个 `.ps1`，或按 [`scripts/README.md`](../../../scripts/README.md)（若已复制到本地）手写等价命令。

| 脚本                  | 作用                                                   |
| --------------------- | ------------------------------------------------------ |
| `frontend-dev.ps1`    | 起 Electron dev                                        |
| `backend-rebuild.ps1` | `cargo build` + 内嵌到 `resources/bundled-aioncore`    |
| `backend-run.ps1`     | 仅跑后端 HTTP API                                      |
| `package-win.ps1`     | 打 Windows 安装包(dist:win),自动用本地 aioncore 不下载 |

---

## 5. 与上游（iOfficeAI）的关系

| 项            | fork (`gaogg521`)              | 上游                            |
| ------------- | ------------------------------ | ------------------------------- |
| 前端          | `gaogg521/1oneUI` `one-main`   | `iOfficeAI/AionUi` `main`       |
| 后端          | `gaogg521/1oneCore` `one-main` | `iOfficeAI/AionCore`            |
| 品牌          | **1ONE Code** / 1ONE CLI       | AionUi / Aion CLI（上游产品名） |
| 关于页 GitHub | `github.com/gaogg521/1oneUI`   | `github.com/iOfficeAI/AionUi`   |
| 官网          | `https://1one.1oneclaw.com`    | `https://www.aionui.com`        |

上游通用贡献说明仍可参考 [`contributing/development.md`](../contributing/development.md)，但 **clone 地址与分支请用本节 fork 表**。

---

## 6. 文档索引（接棒必读）

| 文档                                                                                             | 内容                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [ai-handoff-conventions.zh-CN.md](ai-handoff-conventions.zh-CN.md)                               | 改完必写文档 + 前后端加载对照               |
| [session-2026-07-07-evening.zh-CN.md](session-2026-07-07-evening.zh-CN.md)                       | 侧栏 / 企业 / 超级助手 / dev 踩坑           |
| [session-2026-07-08-assistant-branding.zh-CN.md](session-2026-07-08-assistant-branding.zh-CN.md) | 1ONE CLI、助手过滤、Cursor 探测、关于页链接 |
| [AGENTS.md](../../AGENTS.md)                                                                     | 代码规范、lint、i18n、测试                  |
| `D:\aionui-m0\scripts\README.md`                                                                 | 脚本与加载速查（本地）                      |

---

## 7. 冒烟检查清单

改完功能后至少点一遍：

1. **设置** 各 Tab 不黑屏
2. **设置 → 助手**：CLI 列表符合本机已安装工具
3. **设置 → Agent → 扫描本地 Agent**（装了 Cursor CLI 后应出现 Cursor）
4. **会话首页**：助手胶囊、能新建对话
5. 若动企业/员工：**超级助手 → 创建数字员工**

---

## 8. 当前版本与 Release

- 应用版本见 `1oneUI/package.json` 的 `version` 字段（当前 **2.1.32**）。
- 预编译安装包：**https://github.com/gaogg521/1oneUI/releases**
- 最新发布：[v2.1.32](https://github.com/gaogg521/1oneUI/releases/tag/v2.1.32)（Windows x64）。
- 后端无独立桌面安装包；随 1oneUI 安装包 bundled。
