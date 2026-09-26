# 企业加入流程两个死胡同修复 + 生命周期真机回归（2026-09-26）

> 跨仓：服务端语义（付费档模型解锁 `be00051`）与加入 UI 修复同日完成，服务端见
> dream-trial-broker `docs/baoyun-metered-proxy-handoff.zh-CN.md` §11.19/§11.20；
> 全链路 CDP 生命周期回归（加入→下发→退出恢复→免登录重连）的方法与环境配方
> 记在 scratchpad/cdp-e2e-0925/ 与记忆 `cdp-e2e-env-0925`。

## 1. 加入企业确认弹窗卡死：async onOk 的 rejection 会锁死弹窗

用户填错服务器地址（例如把 admin-web 的 25810 代理当成了企业后端本体）时，
`probeRemoteEnterpriseServer` 返回 unreachable，`Modal.confirm` 的 onOk 里
`Message.error` 之后就 **rethrow**——Arco 对 async onOk 的 rejection 语义是
**保持弹窗打开**，于是：错误 toast 一闪即逝、弹窗留在原地挡住"保存地址"按钮、
用户反复取消也逃不出循环（旧地址一直在配置里生效）。CDP 下复现 5+ 次点击。

**修复**：探测失败不再 rethrow——toast 报错后正常 return 让弹窗关闭，地址框
留在页面上可直接改。开关的视觉状态与持久化状态在失败路径下刻意保持"未连接"，
用户改完地址再点一次开关即可重试。

## 2. 项目组页空白：`!context` 时 `return null` 比报错更糟

企业模式开着但远端服务器不可达时，`useOrgContext` 的治理调用失败，
`OverviewTab` 在 `!context` 分支 `return null`——内容区完全空白（无 spinner、
无提示，实测 75 秒+）。空白的精确条件是 error 与 context 同时为空（本地
backend 代理返回了空数据而非抛错），所以既有的 `if (error)` Alert 分支
接不住。

**修复**：null 分支渲染与错误路径相同的「无法获取企业信息 / 请检查连接」Alert。
加载中由外层 Spin 覆盖，不冲突。

## 3. 复确认后判"设计如此"的（不要当 bug 修）

- **管理后台 429**：API 限流每 IP 60/min，快速巡检 20+ 模块必触发；但
  AuthContext 对 429 有退避重试 + 会话保持（源码注释记录了"第 27 个 tab"
  的实测），spinner ≤2 秒自动恢复。真正的白屏不存在——"请求过于频繁"的
  静态提示是可选优化，未做。
- **"企业管理后台"入口点了没反应**：它调 `openExternalUrl` 在**系统浏览器**
  打开 `{server}/admin/`——CDP 看不见外部浏览器。服务器地址失效时才会像
  "没反应"。
- **退出后 mcp_servers 表残留一行**：那是**软删除墓碑**（`deleted_at` 已置、
  `enabled=0`、UI 不可见）——`clearTeamResources` 的权威空同步工作正常，
  之前用 COUNT(\*) 把墓碑也算进去了。
- **团队作战是分组标题**不是导航项。

## 4. 记录但挂起（复现了，但修复方案有坑）

**preload 双绑定**：`page.reload()` **每次**都会在控制台报
"Unable to load preload script … Cannot bind an API on top of an existing
property on the window object"（同 context 重跑 preload，旧属性还在）。
实测桥与 `__backendPort` 三次 reload 全部存活——首次绑定赢、二次抛错只是
控制台噪音。表面修复（expose 前查存在性跳过）反而危险：若某次 reload 恰逢
后端重启，跳过重绑会留下**过期的 `__backendPort`**，渲染层永远连不上——
这正是必须先弄清绑定时序才能动手的原因。挂起，待专门的复现实验。

## 5. 遗留观察（本轮未修）

- 企业身份页的「已连接项目组服务器」徽章取自本地持久化标志，服务器实际
  不可达时不降级（治理调用失败会在项目组页以 Alert 呈现，见 §2）。
- 本地 backend 代理远端治理调用的超时较长（服务器宕机时错误提示要等很久）。
