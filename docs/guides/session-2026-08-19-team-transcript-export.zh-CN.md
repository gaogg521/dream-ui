# 团队作战记录全局导出（离线单文件 HTML）

**日期**：2026-08-19 · **范围**：仅 1oneUI（纯前端，后端零改动，**不需要重编内嵌**）

## 一、做了什么

团队作战页抬头新增「导出记录」：把整支团队**所有成员**的历史消息一次拉全，渲染成一份
**离线单文件 HTML**，复现各个 AGENT 的作战过程。

产物特性：

- **两种视图共用同一批 DOM 节点**：`分列视图`（复刻界面的多列布局，列头用成员身份色）与
  `时间线`（按 `created_at` 归并的单列）。切换靠 JS 把节点搬家，**不复制内容** —— 否则大团队
  产物体积直接翻倍。
- 工具调用详情（`rawInput` / `rawOutput` / diff / 涉及文件）**全量保留**，默认折叠。
- 图片内嵌成 data URI（自包含、可转发）；单张超 8MB 或读不到时退化成显示路径，并在页首明示张数。
- 工具条：按成员筛选、关键词筛选、全部展开/折叠。零外链资源，离线可看，含 `@media print`。

## 二、代码落点

| 文件                                                     | 职责                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `renderer/pages/team/export/teamTranscriptTypes.ts`      | 采集层与渲染层之间的数据契约                                 |
| `renderer/pages/team/export/collectTeamTranscript.ts`    | 逐成员翻页拉全量、归并时间线、内嵌图片                       |
| `renderer/pages/team/export/transcriptMarkdown.ts`       | 受限 Markdown → HTML + 转义                                  |
| `renderer/pages/team/export/renderTranscriptMessage.ts`  | 按 11 种消息类型渲染单条消息 + 行级 diff                     |
| `renderer/pages/team/export/renderTeamTranscriptHtml.ts` | 组装整份文档（内联 CSS/JS）                                  |
| `renderer/pages/team/export/transcriptLabels.ts`         | 产物文案（导出那一刻把当前语言烧进去）                       |
| `renderer/pages/team/components/TeamExportButton.tsx`    | 抬头入口 + 进度 + 落盘                                       |
| `renderer/pages/team/TeamPage.tsx`                       | `headerExtra` 接入按钮                                       |
| `services/i18n/locales/*/team.json`                      | `team.export.*`（13 语言，其中 10 种按仓库惯例先用英文占位） |
| `tests/unit/renderer/teamTranscriptExport.test.ts`       | 33 条单测                                                    |

**复用而非另造**：分页走既有的 `renderer/utils/chat/messagePagination.ts::loadConversationMessagePage`
（请求形状只在那里定义一次，本模块只管「怎么翻」）；文件名与时间戳走既有的
`renderer/utils/chat/conversationExport.ts::sanitizeFileName / formatTimestamp`；落盘走
`renderer/utils/file/download.ts::downloadTextContent`。

## 三、几个刻意的决定（别当成漏洞改掉）

1. **不复用界面的 `MarkdownView`**：那是 react-markdown 组件树，依赖 Preview context、unocss
   运行时与懒加载，脱离应用环境渲染不出来。所以手写受限子集，**宁可少画不能画错**；
   安全前提是「先抽出代码片段 → 整体转义 → 只注入自己生成的标签」。
   ⚠️ 所以产物**是复刻不是像素级一致**，这一点是对用户明说过的。
2. **产物内的 `<script>` 不插值任何数据**，全部状态从 DOM 属性读 —— 从结构上杜绝注入。
3. **行级 diff 超 1200 行就不算**（O(n·m) 会把导出卡死），退化成「变更前/变更后」两块，
   不为了好看编一个假的对齐结果。
4. **截断/失败一律印在页首**（`TranscriptNote`）：成员历史撞上限、图片读不到、图片过大，
   都写清条数 —— 静默丢东西会让产物看起来「什么都在」。
5. **超长内容默认折叠但绝不裁剪**：单条正文 > 6000 字、或工具抬头超一行时，抬头只留摘要，
   原文原样折进 `<details>`。

## 四、真机数据抓出来的两个真问题（已修）

用真实 dev 后端（`测试123` 团队，5 成员 448 条消息）跑完整管线，暴露了两个只有真实数据才会出现的问题：

1. **一条 ACP 工具调用的 `update.title` 是整条 PowerShell here-string（实测 15000 字），
   而且那条消息没有 `rawInput`——完整命令只存在于 title 里。** 早期版本把它整段塞进抬头，
   一个工具头就是一屏。修法=抬头收成一行，原文折进「完整内容」块。
   ⚠️ 这里差点做错：直接截断 title 会**真的丢数据**，因为它是那条命令唯一的存放处。
2. **松散有序列表被切成多个 `<ol>`**，于是 `1. / 2. / 3.` 全部显示成 `1.` ——
   模型写的 markdown 普遍在列表项之间留空行。修法见 `collectListBlock`。

顺带修掉一个自己写出的解析缺陷：模型常把整段内容写成**一行**，里面的 ` ``` ` 围栏因此不在行首、
走不到围栏分支；若不排除连续反引号，一个 ` ``` ` 会和下一个 ` ``` ` 配成一个巨大的行内代码片段，
把中间所有加粗与列表都吞掉。

真机效果：文档高度从 146k px 压到 40k px（折叠生效），而 `document.body.textContent`
仍有 101 万字符 —— **没有任何内容被丢弃**。

## 五、验证记录

- `bunx tsc --noEmit` 0 error；`oxlint` 0 error（3 条 `no-await-in-loop` 是刻意的顺序翻页与限并发）；
  `oxfmt --check` 通过；`check-i18n` 通过（`team.export.*` 13 语言齐全）。
- 单测 33 条；**做过负向验证**：故意破坏 HTML 转义 / hidden 过滤 / 游标停滞保护后，
  正是对应的 5 条测试失败（确认它们真的在把关，不是摆设）。
- 相关面回归：`tests/unit/renderer` + team 两个套件共 196 文件 / 1719 条全绿。
- **产物内交互真机核对**（Chrome）：视图切换双向、节点搬回各列后数量正确、成员筛选、
  关键词筛选与空态、全部展开/折叠、深浅色两套配色、无横向溢出、无 console 报错、
  消息内的 `<script>` 以字面文本呈现（未执行）。
- **应用内真机核对**：dev 渲染层直连真实后端点「导出记录」，toast 为
  「已导出 448 条消息（1.7 MB）。」，落盘文件 `测试123-20260819-190606.html`
  标题为「测试123 · 团队作战记录」、5 列 / 448 条、零外链、单个内联 script。

## 六、已拍板 / 未做

- **导出刻意不受企业内容审计（T4 DLP）约束 —— 2026-08-19 用户明确拍板「导出不需要约束」。**
  工具输出里的文件内容与命令原文会原样落成明文 HTML；现有 `PolicyDenial` 那套只管发送链路，
  导出这条路不加闸门。**这是决定，不是遗漏，别再当缺口提出来。**
- 入口只做了「当前团队」。「不打开团队也能导」（侧栏右键）与「全部团队打包」按当时讨论未做。
- 产物没有分页/懒加载：几万条消息的团队会产出几十 MB 的单文件，浏览器打开会慢。
