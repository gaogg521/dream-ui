# 2026-10-22 知识库原文预览性能（PDF / Office）

> 承接同日的上传/取消修复（`fix(knowledge): stop large imports hanging forever…`）。本轮只动「打开原文」这一段。

## 结论先看

| 场景（DEV，同一台机器）           | 之前                         | 之后                                    |
| --------------------------------- | ---------------------------- | --------------------------------------- |
| 网络拓扑 PDF（单页 5893×1786 pt） | 最小 40%，左侧被裁掉且滚不到 | 适应宽度（12%）整页可见，可放大到 400%  |
| 80 MB / 61 页 PDF                 | 一次只渲一页、翻页按钮       | 连续滚动，只有视口附近 ≤4 页持有 canvas |
| 79 KB docx 首开                   | 9.3 s                        | 3.6–4.9 s（预热）                       |
| docx 点「编辑」                   | 9.3 s，期间显示"自动保存"    | 5.4 s，0.15 s 出快照，状态显示加载中    |
| 92 MB pptx                        | 22 s，Navigator 挤占大半屏   | 19.9 s；再次打开 0.15 s 出首屏快照      |

## PDF（`renderer/pages/knowledge/original/PdfJsOriginal.tsx`）

- **根因**：`Math.max(0.4, …)` 把适应宽度钳在 40%，超宽页面放不下；外层 `display:flex; justify-content:center`
  在内容比容器宽时会把左侧溢出到负方向——那部分**永远滚不到**。用户说"点中内容不能缩放和左右移动"就是这个。
- 现在：页面绝对定位叠成一列，容器宽度 = 最宽页 × 缩放 + 边距（至少 100%），所以放大后是正常的横向滚动。
- 交互：按住拖动平移（指针捕获，滚动条区域不拦截）；Ctrl/⌘+滚轮或触控板捏合以**光标所在点**为锚缩放；
  按钮缩放以视口中心为锚；缩放改成 ×1.25 乘法步进（原来固定 +0.2，在 12% 时一步就翻倍）。
- 渲染：只渲染视口 ±1 页，±3 页以外释放 canvas（`width = 0`）；先渲到离屏 canvas 再拷贝，缩放时旧位图先拉伸顶着，
  不闪白。每页 backing store 上限 16M 像素 / 单边 16384，超过就让 CSS 拉伸（海报级页面放大到 250% 时满 DPR 要 1.6 亿像素）。
- 页面尺寸先按第 1 页铺，渲染到某页时再用它的真实尺寸校正。

## Office（`process/office/nativeOffice.ts` + `OfflineOfficeEditor.tsx`）

每次打开都是新起一个 LibreOffice WASM 引擎：实测一次 79 KB docx 打开 = 资源校验(首次 ~1 s) + 页面 0.1 s +
**引擎启动 ~4.5 s** + 文档加载 ~3.5–4.7 s。引擎启动和文档无关，所以：

- **预热**：`offline-office:prewarm` 为当前窗口起一个不挂到窗口上的 `WebContentsView`，跑到
  `office-engine:document` 就停住等文档（实测不挂载也能完整启动）。`open` 先 `claimWarm`，把文档直接交给它。
  每窗口最多 1 个备用；5 分钟没用自动丢弃；离开资料库 `releasePrewarm`。
  - 触发点：资料库列表里有 Office 文件且没在看文档时；文档就绪 1.5 s 后再起一个备用（「编辑」会关掉只读会话、
    在新引擎里重开——这条约束是 `.uno:EditDoc` 原地解锁会丢 modify listener，别去改）。
  - 代价：一个闲置引擎约 600 MB 工作集 / 1.5 GB 提交（wasm 预留 1 GB SharedArrayBuffer）。所以有 TTL，别改成常驻。
- **首屏快照**：就绪 4 s 后 `capturePage()` 成 JPEG 发给渲染端，按 `${documentId}:${sourcePath}`（含版本）缓存 12 份。
  下次打开同一版本时先显示快照，并让主进程**在就绪前隐藏引擎视图**（`hideUntilReady`），否则引擎的空白加载面会盖住它。
- **Impress 侧栏**：只读模式下 Impress 侧栏默认打开 Navigator，幻灯片被挤成中间的小缩略图。`office-thread.js`
  在加载后用 `.uno:Sidebar` + 同名布尔参数显式关闭（这个 slot 带参数是"设置"不是"切换"，重复执行安全），1 s 后再执行一次。
- 「编辑」后状态先回到加载中（原来一直显示"自动保存"，实际引擎在重开）。

剩下的大头是 LibreOffice 解析本身（92 MB pptx ~18 s、13 MB xlsx ~10 s），这一层没有可做的缓存；
`[offline-office] document ready in …` 日志行会拆出每段耗时，带 `(prewarmed)` 表示用了预热引擎。

## 验证方式

- 单测：`tests/unit/renderer/PdfJsOriginal.dom.test.tsx`（视口内渲染、乘法缩放、拖动平移、Ctrl+滚轮、
  布局/像素上限辅助函数）、`OfflineOfficeEditor.dom.test.tsx`（备用引擎、快照占位、版本变化不复用）。
- 真机：DEV（`DREAM_DEVTOOLS_CDP_PORT=9230`）里用 CDP `Input.dispatchMouseEvent` 发真实滚轮/拖动；
  **引擎是独立的 WebContentsView，主窗口的 `Page.captureScreenshot` 截不到它**，要连它自己的 target（url 含 `index.html`）截。
- `resources/offline-office/` 是 `scripts/prepareOfflineOffice.mjs` 生成的（gitignored），改了 `runtime/*.js`
  要跑 `node scripts/prepareOfflineOffice.mjs --host-only` 再**重启主进程**，否则 DEV 里跑的还是旧文件。

## 顺带

- `tests/unit/common-platform/bridge.test.ts` 有两处 `?.` 触发 `no-unsafe-optional-chaining` **error**，
  让 Main Guard 连红了三次（pre-push 不跑 lint）。已修。
