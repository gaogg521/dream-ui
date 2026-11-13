# 内置浏览器：全局宿主 + 智能体自动开面板（2026-11-13）

## 症状

用户让智能体「打开内置浏览器」，智能体一直报「The in-app browser is not currently attached」，
必须用户**先手动打开应用内的浏览器面板**才行。

## 根因（三层，都在渲染层 / 桥）

1. **按工具流识别「智能体在用浏览器」对 dream 引擎永远失效。** `agentActivity.ts` 只认
   `one-browser__` 前缀或 `confirmationDetails.server_name`，而 dream 引擎（`dream-engine-mcp`
   `tool_proxy.rs`）发给界面的是**裸工具名**（`navigate_page`；撞名时才是 `mcp__server_tool`）。
2. **桥的兜底事件被禁止新建面板。** 11-01 的会话归属门控（`65d68ac6`）为了防串台，规定 void 的
   `agentBrowserRequested` 事件「只接管、不创建」。两条路都走不通，面板没开 → 桥干等 10 秒报错。
3. **浏览器视图本来就只活在打开着的预览面板里。** `PreviewPanel` 收起时 `return null`，
   `ChatLayout` 里它外面的容器也是按需渲染的，所以没有面板就没有 webview 可供智能体连接。

## 做法

### 1. 全局浏览器宿主 `Preview/browser/BrowserHost.tsx`

- 所有浏览器 tab 的 webview 挂在应用根（`PreviewProvider` 内、`createPortal` 到 `document.body`），
  **不依赖预览面板开没开**。
- 面板只渲染一个**占位元素**（`data-testid=browser-slot`，经 `setBrowserSlot` 登记到上下文）；
  宿主 `position: fixed` 逐帧贴在它的矩形上（只在变化时写样式，直接写 DOM 不走 React 状态）。
  逐帧而不是 ResizeObserver：拖拽分栏、侧边栏折叠只改位置不改尺寸，RO 看不见。
- 面板收起 / 激活的是文档 tab / 占位元素尺寸为 0 → 宿主**停靠到屏幕外但保留真实尺寸**
  （`left:-20000px; 1024x768`）。不用 `display:none`（webview 没有布局，截图/滚动/定时器走样）。
  实测 webview 的 dom-ready 在可见、屏幕外、`visibility:hidden`、1x1 下都是 ~100ms，位置不影响加载。
- `BrowserTabLayer` 去掉了整层 `display:none`，新增 `panelVisible`；面板收起时所有 tab 都不「可见」
  但 webview 照常存活。开合面板、切会话都不再重载页面（真机用页面里的 `window.__marker` 验证）。

### 2. 智能体请求浏览器时按「正在生成的会话」归属

- 桥的请求不带会话，但侧边栏已经维护了「正在生成」集合（`getGeneratingConversationIds()`，新导出）。
- 无页签可接管时新建：当前会话在生成、或没有任何会话在生成（兜底）→ 归当前会话，照常开面板；
  只有**别的**会话在生成才归它，并**后台创建**（`openPreview` 新增 `ownerConversationId` /
  `background` / `tabId` 选项）。多个别的会话同时生成无法分辨，取第一个——归属只决定页签显示在哪，
  智能体照样能驱动（宿主常驻）。
- **预览状态按项目作用域存放**：B 在另一个项目里时，切过去那一刻 `closePreviewIfScopeChanged`
  会用 B 作用域的已存状态替换页签，后台页签随之消失。现在该函数多一个 `enteringConversationId`
  参数（会话页 `conversation/index.tsx` 传 `data.id`），把「归属于正要进入的会话」的内存页签带过去，
  不写回旧作用域，并在新作用域里直接展开。
  ⚠️ **不能从 `getCurrentConversation()` 读这个值**：切换那一刻全局存储还是 `null`（真机打日志才发现，
  单测里它是同步设好的，所以单测抓不到）。

### 3. 桥（主进程 `cdpBridge.ts`）

- **等待期间每 2 秒重发一次「请给我浏览器」。** 请求是一次性 void 事件，渲染进程还没订阅（应用刚启动、
  窗口加载中）就丢了，之后干等满 10 秒。真机复现：dev 刚起窗口时第一条桥命令固定卡 10025ms，
  紧接着第二条（重新发起请求）立刻成功。渲染端处理幂等。
- **新一波操作（距上次命令 > 30 秒）已挂载时也发请求。** 宿主常驻后面板收起桥照样挂着，
  不再有「没挂上 → 发请求」这一步，智能体会在用户看不见的地方操作。用 30 秒划分「一波」，
  用户在一波中途收起面板不会被反复弹回。

## 真机验证（CDP，dev，真实会话 + 真实桥）

用桥的令牌像智能体一样直连，不依赖模型。脚本思路：渲染进程 9230 取状态，桥 `/json/version` 取带令牌
的 ws 地址。全部 PASS：

| 场景                        | 结果                                                          |
| --------------------------- | ------------------------------------------------------------- |
| S1 会话页、面板收起，桥请求 | 220~370ms 应答；建页签、开面板；宿主矩形 == 占位矩形          |
| S2 点「收起面板」           | webview 仍在、宿主停靠屏幕外、页面标记未丢（不重载）          |
| S2 等 31s 后桥再请求        | 面板重新弹出、宿主贴合、页面标记仍在                          |
| S3 别的会话在生成，桥请求   | 页签后台建立、A 的画面不动、桥可驱动后台页签                  |
| S3 切到该会话（另一个项目） | 面板自动展开、页签带过来、宿主贴合；截图可见 New Tab + 地址栏 |

### 真实模型端到端（DEV 里配置的模型，真实会话，没有直连桥）

| 场景                                                       | 结果                                                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页发「帮我用内置浏览器打开百度」，此前没有任何浏览器页签 | 发送后 7s 面板自动打开、8s 网页视图加载 `https://www.baidu.com/`，智能体随后用 `read_page` 读到页面（页签标题「百度一下，你就知道」），全程没人手动开面板 |
| 手动收起面板后，在同一会话再让它用浏览器打开 bing          | 发送后 2s 面板自动重新弹出、7s 加载 `https://www.bing.com/`，页签标题「搜索 - Microsoft 必应」                                                            |

⚠️ DEV 窗口被最小化/遮挡时 `document.visibilityState` 为 `hidden`，`Page.captureScreenshot` 会一直挂住（不是页面坏了），
这时只能用页面状态（DOM、`webview.getURL()`）做证据。

## 测试里的坑（别重蹈）

- **别用连续 `Page.reload` 驱动 dev 渲染进程。** 在加载中途 reload 会 `ERR_ABORTED`，应用随后回落去
  加载不存在的 `out/renderer/index.html` 失败，页面之后**不回应任何 CDP 消息**（CPU 0%、`Responding`
  为 True，像死循环但不是）。看到「Page.enable 都没回包」先怀疑这个，别怀疑自己的改动。
- **刚 reload 完别立刻触发桥请求。** 冷加载的会话数据要几秒才到，到了才切预览作用域并替换页签，
  先建的页签会被冲掉（等 ≥15s 或轮询）。
- `PreviewProvider` 现在会渲染 `BrowserHost`，jsdom 里它真会挂载浏览器视图（空地址会被规范成
  `about:blank`），测上下文逻辑的文件要 mock 掉 `BrowserHost`。
- 起 dev 前先 `Get-Process electron` 和查 9230/5173 占用；只杀自己那棵树（按端口找 PID、核对命令行）。

## 相关

- 改动文件：`BrowserHost.tsx`（新）、`BrowserTabLayer.tsx`、`PreviewPanel.tsx`、`PreviewContext.tsx`、
  `conversation/index.tsx`、`useConversationListSync.ts`、`cdpBridge.ts`。
- 测试：`tests/unit/preview/browser/{browserHost,previewContext}.dom.test.tsx`。
- 前序提交 `2372cc27`（先让桥事件能新建面板）被本次取代其「归当前会话」的取舍。

## 追加（同日）：浏览器面板自适应宽度 + 标题栏常驻入口

用户在 1079px 宽窗口里实测：面板能自动开了，但**浏览器只有约 445px 宽，网页被裁掉**；入口还藏在右栏头部
「打开方式」下拉里（右栏收起——默认状态——时连入口都没有）。

### 1. 浏览器出现时让位（transient，不写偏好）

文档预览 340px 起步够用，网页不够。浏览器一出现就按「聊天区先让、不够再收右栏」腾出 640px：

| 布局                                                                        | 谁来做                                                    | 做法                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **项目会话**（截图里的就是这个：右栏是 Layout 级资源管理器列「文件/变更」） | `useProjectPreviewRegionWidth` 新增 `browserFit` 参数     | 聊天最小 360 + 资源管理器放不下 640 → 折叠资源管理器；预览区加宽到 `min(640, 剩余)` |
| 非项目会话（ChatLayout 自带右栏）                                           | `useBrowserAutoFit` + `planBrowserFit`（`layoutCalc.ts`） | 先压聊天区（最小 360），不够才收工作区栏                                            |

- **一律临时**：`useResizableSplit` 新增 `setSplitRatioTransient`（只改状态、不写 localStorage），折叠用 `useProjectPanelCollapse`
  的裸 `setCollapsed`（不落盘偏好）。浏览器消失（切到文档 tab / 收起面板 / 离开）就**归位**；
  归位前用户动过（手动展开右栏、拖过分栏）就不再替他改。
- ⚠️ **原有的「宽度超限就落盘收缩」clamp 会在浏览器刚出现的那一帧（资源管理器还没折叠）把预览宽度永久存成 340**，
  之后文档预览也被带窄。已让该 clamp 跳过「浏览器刚出现、fit 尚未执行」的那一趟（`browserShown && !fitRef.current`）。
  单测里要用「折叠状态和宽度同在一个组件」的 harness 才抓得到（mock `setExplorerCollapsed` 抓不到——
  真实 Layout 里两个 setState 同批、同一次渲染生效）。

### 2. 标题栏常驻浏览器按钮

- 标题栏右侧工具条（反馈按钮与工作区按钮之间）新增 `Browser` 图标按钮，仅桌面端 + 会话页显示；
  面板正显示浏览器时高亮（`aria-pressed`）。
- 点击走新的 `toggleBrowserPanel`（`PreviewContext`）：**显示中 → 收起**（页面保留）；否则切到当前会话已有的浏览器
  tab 并打开面板；一个都没有才新建空白 tab。**不会每点一次就多开一个空白页**。
- 复用既有 i18n 键 `conversation.workspace.openWith.browser`，右栏头部下拉里的老入口保留。

### 真机验证（DEV，窗口 1079×720 = 用户截图宽度）

| 场景                                                       | 结果                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 左侧栏收起（截图状态）、资源管理器展开，点标题栏浏览器按钮 | 预览区 **640px**，聊天区 364，资源管理器折叠；地址栏完整可见                                                            |
| 再点一次                                                   | 面板收起，资源管理器与聊天区**归位**（894+164 / 701），各项折叠偏好 localStorage 未变，`chat-preview-width-px` 仍为 480 |
| 左侧栏展开（再少 215px）                                   | 预览 482px：聊天最小 360 + 左侧栏已占满，没有更多可让——如需更宽得再决定要不要联动收左侧栏                               |

⚠️ 验证踩的坑：**最小化的 DEV 窗口里 Chromium 的 `visibilityState` 是 `hidden`，ResizeObserver/rAF 暂停，
布局量到的是陈旧宽度**（一度量出「explorer 被挤到 1249px、预览 640」这种不可能的几何）。
要量布局必须先把窗口真正显示出来（Win32 `ShowWindow`+`SetWindowPos`，脚本在 scratchpad `win.ps1`；
PowerShell 变量名大小写不敏感，`$H` 会和 `$h` 撞）；Electron 的 CDP 没有 `Browser.setWindowBounds`。
