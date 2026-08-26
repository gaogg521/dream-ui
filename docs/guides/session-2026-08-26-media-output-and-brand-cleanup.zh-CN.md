# 2026-08-26 媒体产物错位修复 + 品牌迁移收尾

> **一句话**：品牌迁移只改了 TS 一半、没改 Rust 一半，把媒体 MCP 的环境变量契约改断了；
> 这一个 bug 是「产物找不到 / 文件树空 / 只显示文件名不出预览」三个现象的共同根因。
> 跨仓：dream-ui + dream-core（dream-core 同名文档记录后端侧）。

---

## 1. 根因：跨语言 env 契约被单边改名

| 端 | 变量名 | 位置 |
| --- | --- | --- |
| Rust 发出 | `AIONUI_MEDIA_WORKSPACE_DIR` / `AIONUI_MEDIA_CONVERSATION_ID` | `dream-core-mcp/src/media_workspace.rs` |
| TS 读取 | `DREAM_MEDIA_WORKSPACE_DIR` / `DREAM_MEDIA_CONVERSATION_ID` | `builtinMcp/imageGenServer.ts` |

两边永不匹配 → `sessionWorkspaceDir()` 退回 `process.cwd()`（= app 数据目录根）。连锁后果：

1. 产物写进 `%APPDATA%\1ONE Code\1one\img-*.jpg`，不在会话工作区 → **右侧文件树看不到**
2. job 既无 `conversationId`、`workspaceDir` 也对不上 → `jobBelongsToConversation()`
   （`common/media/jobView.ts`）把它过滤掉 → **`MediaJobCard` 整个不渲染**
3. 缩略图 / 播放器 / 打开目录 / 重新生成 / 成本行随卡片一起消失

**编译期完全看不出来，也没有任何测试会红** —— 工具只是「什么都没被告知」，安静地退回兜底。
这正是两仓 CLAUDE.md「跨仓协议改名必须两侧同步」铁律的教科书案例。

**修法**：Rust 常量改成 `DREAM_MEDIA_*`；TS 端**新名优先、旧名兜底**
（`readEnv('DREAM_MEDIA_WORKSPACE_DIR', 'AIONUI_MEDIA_WORKSPACE_DIR')`）——
桌面端配的是固定版本的 `aioncore`（`package.json` 的 `aioncoreVersion`），
UI 比后端新是常态，不兜底就得等后端发版才能验证。

两侧各加了**把字面量钉死**的回归测试（`media_workspace.rs` 的
`env_names_match_the_typescript_media_server`）。

## 2. 产物落到 `工作区/outputs/`

`mediaAssets.ts` 新增 `MEDIA_OUTPUT_SUBDIR` / `mediaOutputDir()`，
`saveBase64MediaAsset` 与 `downloadUrlMediaAsset` 共用 `prepareOutputPath()`（写前 mkdir）。
抄的是 `persistReferenceInputs` 已有的 `refs/` 范式。

**两个不能动的地方**（动了就重新弄坏卡片匹配）：

- `toAsset()` 仍以 **workspace** 为基准算 `relativePath` → 结果是 `outputs/img-*.png`，正是想要的
- `mediaJob/index.ts` 的 `origin.workspaceDir` 仍是**会话工作区**，不是 outputs 子目录

**放弃的做法**：让文件树默认展开 `outputs`。`explorerStore` 的 `port.subscribe()` 是批量调用，
塞一个尚不存在的 key 会让整批 reject 并回滚（含 root），把整棵树弄坏。
`outputs/` 靠 watcher 会自己出现，代价只是点一下。

## 3. 正文里的本地图片/视频出预览

`Markdown/LocalFileLink.tsx`：路径命中 `isImagePath` / `isVideoPath` 时，
在 chip 后追加 `GeneratedMediaView`（复用现成组件，走 `one-media://`）。

- 带行号的 `foo.png:12` **不出**预览 —— 那是源码定位，不是要看图
- chip 是 inline 且渲染在 Shadow DOM 里，预览包一层 `.markdown-local-file-preview`
  （`ShadowView.tsx` 里 `display:block`），否则撑坏行内排版

**坑**：任何 partial mock 了 `@arco-design/web-react` 的 DOM 测试，只要用到图片路径的本地链接，
现在都会因为缺 `Image` 而崩。已给 `MarkdownViewer.dom.test.tsx` 补上。

## 4. 目录改名一律用「读取回退」，不搬文件

新增 `resolveWithLegacyName(parent, current, legacy)`（`process/utils/utils.ts`），
语义与后端 `data_paths::resolve_with_legacy` 一致：

> 当前名存在 → 用当前名；否则老名存在 → 用老名；都不存在（新装）→ 用当前名。两者都在时当前名优先。

覆盖 `initStorage.ts` 的四个存储文件 + 聊天历史目录：

| 新名 | 老名（只读兜底） |
| --- | --- |
| `one-config.txt` / `one-chat-message.txt` / `one-chat.txt` / `.one-env` | `aionui-*` / `.aionui-env` |
| `one-chat-history/` | `aionui-chat-history/` |

**为什么不做 rename 迁移**：这些文件就是用户数据（自定义 cache/work/log 目录、provider 配置、
会话索引）。指向一个磁盘上不存在的名字**不会报错** —— JSON store 直接当空的、写个新文件，
用户看到的是设置和历史「凭空消失」。

`importOneLegacyDb.ts` 的 `backendDbPath` 也改成同样解析 —— 否则新装机会去探测
`one-backend.db` 而后端在用 `aionui-backend.db`，判断成「还没有后端库」，导入到早已没人读的
遗留库里去。

**`aionui.db` 刻意不改名**：它是只读的历史遗留库，没有任何代码创建它，改名反而弄坏读它的迁移。

## 5. 顺带修掉的真 bug

- `sentry.ts` 的 `getInstallPathKind()` 只认 `\programs\aionui\resources`，
  但实际安装目录是 `executableName` 派生的 `1onecode` → **所有 Windows 装机都误报 `custom`**，
  正好把这个 tag 存在的意义抹掉了。现在两个名字都认。
- `x-aionui-internal` 是跨仓协议头（dream-ui 发、dream-core-cron 收）。
  改成后端认 `x-dream-internal` 与旧名两个、前端两个都发 —— 只改一边会让休眠唤醒后的
  cron 静默 403，界面上没有任何提示。

## 6. 刻意未改（有理由，别「顺手」改掉）

| 项 | 理由 |
| --- | --- |
| `aionui://` 深链、`appId`、`1ONE Code` userData 目录 | CLAUDE.md 列为冻结历史值 |
| Sentry tag 命名空间 `aionui.*` | 改了会断历史报表/告警 |
| localStorage 键、DOM 事件名 | 前者改了会重置用户偏好，后者纯内部约定，本次不在范围 |
| `[[AION_FILES]]` marker 值 | 活的跨进程协议，值本身不含品牌 |
| `_aionui_` 时间戳分隔符 | 两仓都只声明未使用，死常量 |

## 7. 验证

```bash
cd D:/dream/dream-ui && npx tsc --noEmit -p tsconfig.json   # 0 错误
npx vitest run tests/unit/media tests/unit/renderer tests/unit/process
```

端到端（**必须真机点**，单测覆盖不到）：

1. 对话里让助手生成一张图 → 文件应在 `<会话工作区>/outputs/img-*.jpg`，
   **不再**出现在 `%APPDATA%\1ONE Code\1one\` 根部
2. 右侧文件树自动出现 `outputs/`（watcher 驱动，免刷新）
3. 消息流里出现 `MediaJobCard`：缩略图 / 打开目录 / 重新生成 / 成本行齐全
4. 视频走一遍
5. 正文里直接写一个本地图片路径（不走生成工具）→ chip 下方出缩略图，点击可放大

**改了后端就必须重编**：Rust 侧的 `DREAM_MEDIA_*` 改名要等新 `aioncore` 发版 +
抬 `aioncoreVersion` 才生效；在那之前靠 TS 的旧名兜底工作。

## 8. 已知问题（既有，非本次引入）

- `npx oxlint` 跑不起来：配置里引用了不存在的规则 `no-await-thenable`
- dream-core 在 HEAD 时不是 fmt-clean，`cargo fmt --all` 会连带重排大量无关文件；
  本次把格式化拆成了独立提交
