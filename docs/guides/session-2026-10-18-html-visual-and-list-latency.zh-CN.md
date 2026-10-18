# 2026-10-18：文字型图片走 HTML、会话列表慢得不可用

## 1. 日历/小报/海报不再交给生图模型

- 现象：做「2027 年历小报」时自动切到生图模式，画出 2 月 29 天；用户说「2 月错了」又被当成新提示词只画 2 月。
- 做法：`detectMediaIntent` 里 `isLayoutRequest` 命中（日历、小报、海报、信息图、菜单、证书…）就不弹切换，留在对话里；
  内置 MCP `one-html-render`（export-pdf 脚本 `EXPORT_MCP_TOOLS=image` 模式，工具 `render_html_to_image`，**离屏窗口** + CDP
  截图——普通隐藏窗口一覆盖 device metrics 就不再出帧，`executeJavaScript` 永久挂起）；dream-core 自动注入该 MCP 和技能 `html-visual`。
- 技能的日历数据脚本 `calendar-data.cjs` 读香港天文台对照表。**不要信 `Intl` 农历**：2027 春节它算成 2/7，正确是 2/6。
- 弱模型不会自己去读技能：必须在它**一定会读的地方**（图片/渲染工具的描述）写「先加载 html-visual」。第一次真机它自己写 Python、
  全程不说话、漏了春节；改工具描述后同一份需求会加载技能、跑脚本、报「锁定的事实」、自检 OCR。

## 2. 会话列表 5.8 秒、侧边栏「暂无对话历史」要刷多次

- 实测（release，167 条）：`GET /api/conversations?limit=5` 5.8s，不带 limit 22s，`limit=200` 超过 60s 不返回；单条 `GET /conversations/:id` 2.7s。
  日志里这条路由平均 180 秒（debug 构建）。
- 根因：`ConversationService::list/get` 对**每一行**都调 `auto_inject_names_for_user`，它每次遍历整个技能目录（内置+导入+团队）。
  2026-09-09 引入，之后每多一个 auto-inject / 导入 / 团队技能就更慢——所以是「每个版本更卡一点」，用户在「昨天的版本」上才感觉明显。
- 连锁：界面对每个未知会话的帧都重新拉全量列表 → 请求堆积 → 渲染进程请求额度耗尽（`ERR_INSUFFICIENT_RESOURCES`，连 Vite 都 `Failed to fetch`）。
- 修复：只有缺 `skills` 快照的行才读目录（读完就落盘，每行最多一次）：5 条 5.8s→10ms，200 条 >60s→0.2s，单条 2.7s→5ms。
  前端列表刷新改单飞+尾随一次，失败保留上一份列表。回归测试 `list_does_not_read_the_skill_catalog_for_rows_that_already_have_skills`，去掉修复会失败。

## 3. 实时消息被静默丢弃（"处理中"不消失、产物/变更不刷新）

见记忆 `realtime-backpressure-drops-finish`：每连接队列 64、满了静默丢帧；现在满了就踢掉让客户端重连重同步，队列 512，
send loop 在 manager 丢掉客户端后补发 1013 Close，前端在 `realtime.reconnected` 复核 running。

## 仍待做

- `/api/skills` 平均 3s（53 次）、`/api/{mcp,skills}/team-sync` 每次 3s（71 次）也是整目录遍历，可缓存。
- 打包版要 dreamcore 发版 + bump pin 才有上述后端修复。
