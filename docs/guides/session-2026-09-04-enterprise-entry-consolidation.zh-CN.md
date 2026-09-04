# 个人端企业入口收敛 + 平台预设改为后端同步（2026-09-04）

> **完整交接在 dream-en 仓库**：`dream-en/docs/handoff-2026-09-04-enterprise-capability-distribution.zh-CN.md`
> —— 那份覆盖三仓全貌、能力下发链路核查结论、矩阵白名单模式、以及所有 file:line。
> 本文件只记 **dream-ui 侧**改了什么、以及接手时要注意的点。

本轮 dream-ui 提交：`7552156` `47b4dea` `77a10e4` `fe0b1b4`（均已推送 main）。

> **收尾追加（同日）**：另外合并了 5 条囤积分支进 main —— 宝云计量代理 Phase 3 +
> 自定义日志目录、会话内选图像/视频模型、渠道按模型协议覆盖同步、两条 docs。
> 其中**渠道协议覆盖和自定义日志目录都是跨仓链路**，dream-core 那一半也同时才合进去；
> 在此之前两个仓各自 main 都是绿的，但链路是断的。详见交接文档 §9。
> ⚠️ **会话内选媒体模型那 6 个 commit 没做 CDP 真机验证**，按本仓惯例应补。

## 1. 企业入口信息架构收敛（`77a10e4`）

**「填服务器地址」和「用什么身份登录它」原本分处两个设置页**，填完地址没有任何可见的下一步。
`EnterpriseDeploymentModeCard` 整体从「设置 → 远程连接」搬到「设置 → 企业身份」，
放在 `RemoteServerSection`（SSO 登录）**上方**，顺序即用户实际动作：先选连哪台，再登录它。

⚠️ **搬的时候「地址输入 + 连接开关」必须整体搬、不能拆开。**
它们当初就是因为分处两页导致「填了地址什么都不会发生」的 bug 才被合到一张卡上的
（`EnterpriseDeploymentModeCard.tsx` 里有原始注释）。

同时清掉了 `RemoteServerSection` / `OverviewTab` 里 5 处指向旧页面的过时文案。
**仍然正确、没动的**：`WorkspaceIdentityEntry` / `EnterpriseLoginChannelPanel` /
`enterprise/index.tsx` 里"请先在设置 → 远程连接中启动 WebUI"——那说的是启动 WebUI，
确实还在那一页。

## 2. 「本机作为服务器」置灰（`77a10e4`）+ 删除本地建组（`fe0b1b4`）

企业版拆分后 `dream-domain-org` 整个在 `enterprise` feature 门控内，个人版构建里
`/api/one/org/{create,reset-local}` 一律返回 501。原来的 UI 会先翻转本机部署角色、
再在接口上失败，报错里对此只字不提。

- 服务器角色 **置灰但保留可见**——存量 `role: 'server'` 的机器要能看到状态并切回客户端。
  若直接删掉选项，而 `markDeploymentAsServer()` 仍可被触发，用户会卡在没有出口的状态。
- `OverviewTab` 的本地"创建企业 / 重置本机企业数据"表单已删，改为说明托管能力去了哪里。
- **邀请码加入远端项目组不受影响**（那条在连上企业后会路由到远端，正常工作）。

## 3. 侧边栏「企业管理后台」入口判定修正（`77a10e4`）

原判定要求 `isServer`，而客户端永远 `isServer=false` —— 已连上企业的管理员**根本看不到入口**。
改为按「是否已连接企业」判定（`isEnterpriseModeEnabled()`）。刻意不再按角色收窄：服务端本来
就会逐次鉴权，把门藏起来对一个服务端本会放行的人（比如后台新设的子管理员）是更糟的失败。

## 4. SSO 按钮置灰时说明原因（`47b4dea`）

未配置的渠道按钮原本被设成 `disabled`，于是**解释文案所在的 onClick 永远不触发**——
用户只看到一排死灰块。而且未连服务器时面板查的是**本机个人版后端**（自然没有任何 SSO 配置），
这和「管理员没在后台启用」是两个完全不同的问题，却长得一模一样。

改为保留可点击（视觉置灰），并区分两种原因分别给出可执行的下一步。

## 5. 模型平台预设改为从后端同步（`7552156`）

dream-ui 的 `MODEL_PLATFORMS` 和 dream-en 的 `MODEL_PLATFORM_PRESETS` 此前是两份手工同步的
静态常量，无防漂移机制。dream-core 新增了 `GET /api/model-platforms` 作为权威源。

**这里的做法刻意保守**，接手时别"优化"掉：
- **没有改任何现有调用点**。`MODEL_PLATFORMS` 仍是同一个导出、同一个数组对象。
- 新增 `modelPlatformsSync.ts` 在启动后拉取一次，把结果**原地 merge** 进那个数组
  （按 `value` 更新已存在的、追加新增的），不重新赋值、不换引用。
- 后端不可达 / 版本落后 → merge 是空操作，行为与改造前完全一致。
- 之所以不改成"所有调用点异步拉取"：那是活跃在线产品的渲染路径，加载态与首屏时序风险
  远大于收益，而原地 merge 已经能达到"企业新增平台自动流向个人端"的效果。

## 6. 接手须知

- **Electron CDP 真机验证本轮没做**：单实例锁挡住第二个实例（`[1ONE] Another instance is
  already running`），当时用户 app 正开着不应杀掉，其实例也没开 CDP 端口。改动的组件都有
  `isElectronDesktop()` 门槛、浏览器里不渲染，故用组件测试 + 页面组合测试覆盖
  （`enterpriseLoginChannelPanel.dom.test.tsx`、`enterpriseIdentitySettings.dom.test.tsx`、
  `EnterpriseDeploymentModeCard.dom.test.tsx`、`OverviewTab.dom.test.tsx`）。
  **用户不使用 app 时应补做一次。**
- `tests/unit/renderer/guidPage.dom.test.tsx` 有 11 个失败，**是 pre-existing 的**——
  已用 `git stash` 在干净 main 上复现确认，与本轮无关。判断本轮回归时请排除它。
- 改文件请用编辑器工具，**别用脚本整体重写**：本仓库多为 CRLF，脚本 `'\n'.join()` 会把
  整个文件行尾改掉，diff 变成几千行噪声（本轮在 dream-core 侧踩过一次）。
