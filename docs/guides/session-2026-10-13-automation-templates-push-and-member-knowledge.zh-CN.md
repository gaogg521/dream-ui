# 2026-10-13：自动化模板、结果推送到 bot、成员个人知识库

借鉴 WorkBuddy 的「自动化 / 资料库」设计（用户给了截图；WorkBuddy 的页面要登录，我没能打开，全部按截图设计）。

## 做了什么

| 项               | 做法                                                                                                                  | 落点                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 从模板添加       | 「新建任务」下拉里多一项；12 个常用示例（工作/学习/生活），点卡片打开**已填好**名称、提示词、时间的新建表单，全部可改 | `pages/cron/templates/automationTemplates.ts`（内容只有中英两份，其它语言读英文）、`pages/cron/TemplatesPage`、`/scheduled/templates` 路由                                                                         |
| 推送到我的 bot   | 每次运行成功后，把**最后一段助手回复**发到用户已连接的渠道 bot；bot 和会话从后端列表选，不手输                        | 后端：迁移 `062_cron_push_target`、`CronResultPusher`（cron crate 只认 trait，组合层 `ChannelCronPusher` 接 `ChannelManager`）、`latest_assistant_reply`、`GET /api/channel/push-targets`；前端：`PushTargetField` |
| 成员个人知识库   | 企业普通成员能自己添加/编辑/删除文档；管理员下发的只读，带「企业下发」标；嵌入配置、可见范围仍只有管理员              | 后端 `scope='personal'` + `assert_rag_writable` + `rag_search_acl`；前端 `RagSection` 自己判断角色（不再收 `readOnly` 属性）                                                                                       |
| 绿色「企业下发」 | 徽标改成功色                                                                                                          | `CompanyBadge`                                                                                                                                                                                                     |

## 要记住的几条

1. **个人文档对管理员也不可见**：列表和检索都排除别人的 `personal` 文档（管理员 `viewer_is_privileged` 原本是「不过滤」，这里专门补了 `scope <> 'personal' OR created_by = ?`）。共享的 `member_visibility_where` 没动（skills / MCP 也用它），个人文档在列表里另查一次、在检索里 `OR` 一支。
2. **成员注册文档时服务端强制 `personal`**，不管请求里写了什么 scope/可见范围。
3. **推送是 detached 的**：慢的/挂了的 IM 平台既不拖慢调度，也不会把一次成功的运行变成失败；错误只记日志。推送文本 1800 字内（取各平台单条上限的最小值），超长截断并提示去 One Work 看全文。
4. **一个平台只有在有人给 bot 发过消息后才暴露 chat id**，所以「没聊过的 bot」会在列表里出现但没有会话，界面提示「先发一条消息」。例外：微信、Telegram 的单聊 chat id 就是用户自己的 id，所以**已授权但还没聊过**的用户也会被列出来（`DIRECT_CHAT_PLATFORMS`）；飞书/Slack/Discord 的 chat id 只有会话才知道。
5. **这个应用里 Tailwind 的 `dark:` 变体从不生效**（主题走 data 属性）。渠道设置里的 `bg-blue-50 dark:bg-blue-900/20` 在深色下就是浅蓝底配浅灰字——用户一句「白底黑字好丑」。已全部换成主题令牌（`bg-fill-2`、`rgba(var(--success-6),…)`）。再看到 `dark:` 前缀就是同一个 bug。
6. **没有 box-sizing 重置**：`w-full` + `px-*` 会溢出父容器（模板画廊第三列被裁掉的真因）。写页面容器要自己加 `box-border`。
7. 原生 `<button>` 在深色主题下默认是白底（文件保险箱上传按钮），统一用 Arco `Button`。

## 验证

- 真机（DEV 连 QA 企业服务器，镜像 `qa-20261013-pushkb`）：成员注册文档（无可见范围字段）→ 待处理 → 编辑后自动重新嵌入变 ready → 检索命中 `ZEBRA-4471` → 删除；企业文档行无任何按钮、只有「由企业管理员维护」。
- 模板画廊 12 张卡片、点卡片后表单预填、推送开关空态（无 bot）与有 bot 的选择器。
- **（已补）真发验证**：用户随后接入了自己的微信 bot 并授权我用它测试——运行后日志 `Cron result pushed to chat bot plugin_id=weixin`，重启后端后（无缓存会话）再跑一次同样成功；用户此前用飞书也自己跑通过。下面这条是当时的状态：
- **没有真发一条 IM 消息**：本地 DEV 里有一个真实的 Lark bot 和一个会话，但那是别人的账号，没有授权就不往里发。推送链路逐段有单测（`compose_push_text`、`latest_assistant_reply`、`build_push_targets`、仓储/服务读写），执行器 → 推送器 → `ChannelManager` 这一段没有端到端覆盖。

## 追加：列表行快捷方式

自动化列表每一行右侧加了「编辑」「删除」图标（删除先确认）。起因是用户说「模板创建的不能编辑」——其实详情页右上角有铅笔，但列表上没有任何入口。

- ⚠️ 加这个后 `CreateTaskDialog` 的测试集体挂了：`PushTargetField` 里的 `useNavigate` 要 Router、`@/common` mock 里没有 `channel`。推上去的那次 pre-push 没拦住，Main Guard 的 Code Quality 因格式（CLAUDE.md、scenes 文档）本来就是红的，这条测试失败被盖住了。**改了被别的组件复用的表单后，把整个 `tests/unit/renderer/cron` 跑一遍**。
- 运行被中途取消（用户停止/重复触发）时 `run_agent_turn` 仍返回 Ok，推送会记「Cron run produced no reply to push」并跳过，这是预期。

## 发版

dreamcore v0.1.86（五平台）、dream-ui pin 已 bump；QA 栈已升到 `qa-20261013-pushkb`。
