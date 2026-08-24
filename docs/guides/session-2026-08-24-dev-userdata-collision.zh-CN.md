# dream-ui / 1oneUI 共享 dev userData 导致数据被撞坏事故记录

**日期**：2026-08-24 · **范围**：dream-ui（本次代码修复）+ 影响到 `D:\aionui-m0\1oneUI` 的本机数据

## 一、发生了什么

dream-ui 是 2026-08-23 从 `D:\aionui-m0\1oneUI` 原样复制出来的独立仓库（见 `CLAUDE.md`
"代码溯源"一节）。复制时把 `common/platform/index.ts` 里的 `getDevAppName()` 函数也原样带了
过来——这个函数决定 dev 模式下 Electron 的 `userData` 目录名：

```ts
export function getDevAppName(): string {
  const isMultiInstance = process.env.DREAM_MULTI_INSTANCE === '1';
  return isMultiInstance ? '1one-Dev-2' : '1one-Dev';
}
```

1oneUI 那边的同名函数逻辑完全一样，只是判断的环境变量叫 `AIONUI_MULTI_INSTANCE`——**两边解析
出来的目录名字面量是完全相同的两个字符串**（`1one-Dev` / `1one-Dev-2`）。这意味着两个仓库的
`bun run dev`（不显式设置隔离环境变量的默认情况）会打开**同一个** `%APPDATA%\1one-Dev\1one\
aionui-backend.db`。

当天在 `D:\dream\dream-ui` 跑 dev 模式测试反馈邮件功能时，用的是刚编译的新版 `dreamcore.exe`
（内嵌了本次会话在 dream-core 里新增的迁移 `052_dream_rebrand_persisted_values.sql`）。这个
迁移是 dream-core 独有的，1oneUI 自己的代码库里没有。dreamcore.exe 打开共享的 `1one-Dev`
数据库后照常运行了它认得的全部迁移，把该库的 schema 版本推到了 1oneUI 的旧后端
`aioncore.exe` 认不出来的地方。之后用户重新打开 1oneUI 的 dev 环境时，其后端在启动阶段检测到
"数据库版本比自己新"，触发保护性拦截（`packages/desktop/src/process/startup/
backendStartupFailure.ts` 里的 `DATABASE_NEWER_THAN_APP_BOUNDARY_STAGE`），弹出"需要更新
One Work"对话框拒绝打开——**这是应用自身设计好的保护机制，不是数据损坏**，但确实打不开了。

## 二、恢复过程

1. 确认没有进程还占着共享数据库文件。
2. 用 `vssadmin list shadows` 发现当天上午 11:59 和 12:58 各有一份 Windows 卷影副本（VSS）
   快照，均早于当天下午的 dev 模式测试。
3. 用 `mklink /D` 把卷影副本设备路径挂成普通目录（PowerShell 的 `Test-Path`/`Get-ChildItem`
   不支持直接访问 `\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy*\` 这种路径，必须先建
   junction）。
4. 两份快照互相印证，`aionui-backend.db` 在快照里的状态都是 2026-08-22（污染之前）。
5. 把污染后的当前版本先备份成 `aionui-backend.db.backup-20260824-before-shadowcopy-restore`
   （不直接丢弃），再用快照版本覆盖回去。1oneUI 的 dev 环境验证恢复正常，202 条对话记录
   （最早可追溯到 7 月 12 号）原样都在。

## 三、第二次撞车：`1one-Dev-2`

为验证"以后 dream-ui 加隔离参数就不会再撞车"，用 `DREAM_MULTI_INSTANCE=1` 启动 dream-ui
dev 模式。表面上看数据库路径变成了 `%APPDATA%\1one-Dev-2\...`，跟 `1one-Dev` 不是同一个目录，
误以为已经隔离好了。

但用 Python 的 `sqlite3` 模块直接查两边数据库的 `conversations` 表发现：`1one-Dev-2` 同样是
1oneUI 长期在用的真实数据（158 条对话，最早可追溯到 4 月 14 号）——`1one-Dev-2` 只是 1oneUI
自己"多开模式"（`AIONUI_MULTI_INSTANCE=1`）用的**第二个**共享槽位，跟 `1one-Dev` 是同一类
问题，只是换了个名字。查 `_sqlx_migrations` 表确认 version 52（"dream rebrand persisted
values"，dream-core 独有）已经在当天写入，即这次测试**同样**把它往前推了一版。

这次没能恢复：当天两份 VSS 快照拍摄时 `1one-Dev-2` 这个目录还不存在（大概率是它当时还没被
写入触发 VSS 的写时复制追踪），该 profile 也没有 App 自己做的"迁移前备份"文件（`1one-Dev`
下有两个这样的历史备份，`1one-Dev-2` 没有）。**好在 `1one-Dev-2` 不是 1oneUI 默认使用的
profile**，只有显式设置 `AIONUI_MULTI_INSTANCE=1` 才会碰到它，属于潜伏风险而非当前阻断。

**教训**：`*_MULTI_INSTANCE=1` 这类"隔离开关"本身没有解决根本问题——它只是在两个**同样被
两个仓库共享**的槽位（`1one-Dev` / `1one-Dev-2`）之间切换，不是真正意义上的按仓库隔离。真正
的隔离必须让目录名本身在两个仓库之间不同。

## 四、根治方案（本次改动）

`common/platform/index.ts` 的 `getDevAppName()` 改为返回 `dream-ui-Dev` / `dream-ui-Dev-2`，
不再是 `1one-Dev` / `1one-Dev-2`。这样 dream-ui 的 dev 模式默认（不需要记住加任何环境变量）
就会使用一个 1oneUI 绝不会用到的目录名，两个仓库的 dev 环境从此在目录层面天然隔离，不再依赖
"记得加隔离参数"这种容易遗忘的操作纪律。

`PROD_USERDATA_APP_NAME`（`'1ONE Code'`，正式安装版用的）**没有改**，也不应该改——那是刻意
保留的历史值，为了让真实用户从 AionUi/1oneUI 升级到 One Work 时 `%APPDATA%` 数据不丢失，这
条决策的合理性跟本次事故无关。如果以后要打包安装测试 dream-ui 且机器上还装着 1oneUI 正式版，
两者仍然共享同一个 `1ONE Code` 生产 profile——这是**故意**的设计，不是本次要修的 bug，只是
使用者（包括未来接手的 AI 会话）需要知道这个前提，打包测试前最好谨慎。

## 五、涉及文件

- `packages/desktop/src/common/platform/index.ts` — `getDevAppName()` 改名
- `docs/guides/cdp.md` — 两处 dev userData 路径引用同步更新（中英文各一处）
- 本文档
