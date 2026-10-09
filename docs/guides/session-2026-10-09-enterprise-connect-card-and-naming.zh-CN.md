# 2026-10-09 企业入口收敛：去掉「服务器 / 客户端」角色选择，统一叫「企业服务器」

> 同日三仓背景：一份外部安全测试报告（21 项）在 dream-core / dream-en 修完，逐项状态见
> dream-en `docs/security-fix-status-2026-10-09.zh-CN.md`。本文只记 dream-ui 这一侧。
> 提交：`274546c`（连接卡片）、`0c8aead`（叫法统一）。**只改了渲染进程**，dev 热更新即可，
> 打包版跟下一个 dream-ui 安装包走，不需要 dreamcore 发版。

## 1. 为什么改

「设置 → 企业身份」顶部是「项目组部署模式」卡：「本机作为服务器 / 本机作为客户端」二选一 +
地址框 + 保存地址 + 连接开关。这个二选一只在**服务端和桌面端打包在一起**时成立；服务端拆成
独立的企业版（容器栈）之后，每台桌面都只能是客户端，「本机作为服务器」永久置灰却仍占着首位，
三个控件表达同一个决策。用户原话：「留这么多选项用户反而看得很懵逼」。外部测试报告的 U1/U6/U7
（地址提示引导人填后端端口、角色选择器是已消失拓扑的遗留、状态区块主次不分）也指向这里。

## 2. 现在的样子

| 状态                         | 「企业」分组里有什么                         | 「企业身份」页显示什么                      |
| ---------------------------- | -------------------------------------------- | ------------------------------------------- |
| 没连企业服务器（个人版常态） | 只有「企业身份」                             | 只有「企业服务器」卡片：地址 + 「连接」     |
| 已连接、未登录               | + 项目组、企业管理后台、文件保险箱、我的审批 | 卡片显示已连接地址（更换 / 断开）+ 登录卡片 |
| 已登录                       | 同上                                         | + 企业身份信息                              |

- **连接 = 保存 + 探测 + 启用一步完成**（`EnterpriseServerCard.tsx`）。失败在卡片里用红色提示，
  写明**实际尝试的地址**和原因。
- **探测逻辑共用**：`renderer/utils/enterprise/probeEnterpriseServer.ts`，设置页和左下角连接向导
  （`EnterpriseLoginPage`）都走它：
  - 地址带显式端口且不通 / 不是企业服务器 → 自动改试同主机的默认端口（网关 80/443），能通就用它并提示
    「已自动改用 …」。离线包部署只发布网关，填 `:25808`/`:25809` 是最常见的错误。
  - 地址是**本机客户端自己**（回环或本机 LAN IP + 本机后端/WebUI 端口）→ 明说「这是本机 One Work
    客户端自己的地址」，不再误报成「对方未提供企业 API」（报告 U3：填 25808 连到本机实例返回 404）。
- **「项目组」只在已连接时出现**（`SettingsSider` 监听 `DEPLOYMENT_ROLE_CHANGED_EVENT`，连接时不一定
  reload，所以必须监听）。
- 左下角身份卡不再写「客户端」：个人版 · 未连接企业 / 已连接企业 · 未登录 / 已连接企业。
- 全部用户可见文案里「项目组服务器 / project group server」→「企业服务器 / enterprise server」。
  只改值，没改键名。

## 3. 存量用户（重要）

`webui.deploymentRole` 键和 `'server' | 'client'` 类型都保留，但 `resolveDeploymentRole` **一律返回
`client`**。理由：选择器去掉后，存过 `server` 的老用户在 UI 上再也没有切回的路；而个人版本来就
不编企业治理 crate（本地 `/api/one/org/*` 回 501），`server` 状态什么也托管不了。
`persistDeploymentRole` / `markDeploymentAsServer` / 项目组页的「请切回客户端」提示一并删除。

## 4. 踩坑

- **这个 tsconfig 没开 strict，判别式联合不收窄**。`resolveEnterpriseServer` 的返回值原来写成
  `{ok:true,...} | {ok:false, reason}`，调用处 `if (!result.ok)` 之后取 `reason` 编译报错，改成扁平类型。
- **dev 窗口启动后会被关掉**：第一次起 dev 约 8 秒后日志出现正常的 `before-quit`（窗口弹出后被人关了），
  不是崩溃。重起前当场查实例（`tasklist electron.exe` + 5173/9230 端口）。
- **dev 数据本身就是报告里那种错配**：`%APPDATA%\dream-ui-Dev` 里连的是 `http://127.0.0.1:25808`——
  也就是装好的 One Work 客户端自己。验证时断开/重连后已按原值（localStorage 三个 `one-enterprise:*`
  键 + client prefs 地址）还原；地址历史里多了一条 `127.0.0.1:26808`。
- `TaskStop` 停掉 `bun run dev` 不会带走 electron 子进程树：要么 CDP `Browser.close`，要么按
  `CreationDate`/`ParentProcessId` 确认是自己起的那棵再杀。

## 5. 验证

- CDP 真机（`DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev`，脚本走真实按钮点击）：断开 → 只剩「企业身份」、
  页面只剩连接卡片；填本 dev 后端端口 → 「本机客户端自己的地址」；填不可达地址 → 「连接不上 …」；
  填隔离企业版实例 `127.0.0.1:26808` → 连上，项目组等入口出现、登录卡片出现、身份卡隐藏到登录后。
- 单测：新增 `tests/unit/renderer/EnterpriseServerCard.dom.test.tsx`（解析逻辑 + 卡片），改写
  `enterpriseIdentitySettings`、`SettingsSider`、`OverviewTab`、`webuiEnterpriseConfig`、
  `deploymentRoleOrgContext` 测试；删除 `EnterpriseDeploymentModeCard.dom.test.tsx`。
  `vitest --changed origin/main` 21 文件 150 用例通过。

## 6. 没做的

- 废弃的 `settings.webui.deploy*` 角色相关 i18n 键（`deployRoleServer`、`promoteConfirmDesc` 等）已无引用，未删。
- 登录卡片（`RemoteServerSection`）还有「已连接 … 还需先登录」这类分散提示，可以继续收成单一状态卡（报告 U7）。
