# 企业客户端登录后整个 UI 卡死（点击无反应）根因与修复

**日期**：2026-07-22
**版本**：复现于打包版 v2.1.49（源码含此前 07-20 的 `getLocalBaseUrl` 路由修复，本问题是**另一个**独立 bug）
**影响**：本机作为**客户端**连接远端项目组服务器、且**已通过企业 SSO（飞书）登录**后，除「项目组」当前页与左下角「用户」头像外，整个界面所有导航/按钮点击无任何反应（Agents/模型/能力扩展/系统/返回聊天全部失效）。未登录时正常。

---

## 一句话根因

[`RemoteServerSection.tsx`](../../packages/desktop/src/renderer/pages/enterprise/components/RemoteServerSection.tsx) 里把**每次渲染都会返回新对象引用**的 `getEnterpriseSession()` 结果，直接当成了 `useEffect` 的依赖，配合分支里无条件 `setSsoProviders([])`（每次都是新数组），在**存在远端会话时**形成**无限渲染循环**。该循环产生的默认优先级更新持续抢占 React Router 基于 `startTransition` 的导航，导致路由 transition 永远无法提交——URL（hash）会变，但 `<Outlet/>` 视图永久冻结在设置页。

```js
// 修复前
const session = getEnterpriseSession();            // 每渲染 JSON.parse → 新对象引用
useEffect(() => {
  if (!urlValid || session) {
    setSsoProviders([]);                            // 每次新 []，React 不 bail-out
    return;
  }
  ...
}, [normalizedUrl, urlValid, session]);             // session 引用每渲染都变 → effect 每渲染都跑
```

**循环链**：渲染 → `session` 是新对象 → effect 依赖变化 → effect 重跑 → `setSsoProviders([])`（新数组，状态"变化"）→ 触发重渲染 → 回到起点。

**为什么完美吻合现象**：

- 只在**登录后**触发：未登录时 `session === null`（稳定引用），依赖不变，不循环。
- 只在**客户端模式**：`RemoteServerSection` 仅在客户端模式渲染。
- 「项目组」「用户头像」能点：前者是当前页原地点击、后者是本地下拉菜单，都不需要 React 提交路由切换；其余全依赖路由 transition，全被循环饿死。

---

## 定位方法（可复用）

打包版默认不开 CDP（`configureChromium.ts` 里 `shouldEnableCdp` 在 `app.isPackaged` 时无条件返回 false，只有环境变量 `AIONUI_CDP_PORT` 能开）。企业会话存 localStorage、**重启后自动回到卡死态**，无需重新登录：

```powershell
Stop-Process -Name 1onecode -Force; Stop-Process -Name aioncore -Force
$env:AIONUI_CDP_PORT='9230'; Start-Process 'C:\Users\<user>\AppData\Local\Programs\1onecode\1onecode.exe'
```

然后用原始 CDP（Node 24 内置 WebSocket）连 `ws://127.0.0.1:9230/devtools/page/<id>`：

1. **导航实验**：`el.click()` 侧栏项 → `location.hash` 变了，但 `.layout-content` 内容不变 → 判定「路由变了但 Outlet 提交不了」。
2. **`Profiler.start/stop` 抓 3 秒 CPU profile** → 决定性区分「挂起」vs「无限渲染」：
   - 结果 top self-time：`formatLanguageCode 15%`（i18n）、`translate`、`React.createElement`、一堆 reconciler 函数、`Ze @ EnterpriseSettings` → **持续重渲染**，坐实无限循环。

---

## 修复

改用稳定原始值 `hasSession` 作依赖，并让 `setSsoProviders` 在已空时返回同一引用（不触发重渲染）：

```js
const session = getEnterpriseSession();
const hasSession = Boolean(session);               // 稳定布尔
useEffect(() => {
  if (!urlValid || hasSession) {
    setSsoProviders((prev) => (prev.length === 0 ? prev : []));  // 已空则同引用返回
    return;
  }
  ...
}, [normalizedUrl, urlValid, hasSession]);
```

**查全结论**：grep 了所有企业组件的 effect 依赖，`WorkspaceIdentityEntry`/`EnterpriseDeploymentModeCard`/`SiderEnterpriseEntry` 用的 `context`（来自 `useOrgContext` 的 `useState`，引用稳定）不会触发同类循环；`getEnterpriseSession()`「每渲染新对象当依赖」的坑**只有 `RemoteServerSection` 一处**。

**验证**：`tsc --noEmit` 干净、`oxlint` 0 error。真机新包验证待重新打包。

---

---

# 企业身份 vs 项目组：模型澄清 + "已 SSO 登录却显示未登录" 修复

用户真机第二个问题：客户端已通过飞书 SSO 登录（左下角显示「王小明2」），但「企业身份」页却显示 **"尚未通过企业 SSO 登录，暂无企业身份信息"**；且感觉「项目组」和「真实企业」在抢资源。

## 模型（07-20 解耦后，两个**独立**维度，本应并存）

|           | 企业身份（真实企业）                                                 | 项目组                                                |
| --------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| 是什么    | 你是谁：飞书 SSO 公司身份（公司/部门/姓名）                          | 你加入了哪个工作区（邀请码 tenant，带技能/工具/角色） |
| 数据/端点 | `one_enterprises`/`one_enterprise_members`，`/api/one/enterprise/me` | `one_tenants`，`/api/one/org/context`                 |

## 「尚未 SSO 登录」根因（完整链路已读到底）

```
EnterpriseIdentityCard → useEnterpriseIdentity → /api/one/enterprise/me（治理→远端）
  → EnterpriseService::identity_of(user.id) → 查 one_enterprise_members 无记录 → null
卡片：identity==null && error==null → 显示"尚未通过企业 SSO 登录"
```

记录为空的**唯一**原因（wiring 全查过是对的：`aionui-app` 已 `.with_enterprise_sync(EnterpriseSyncAdapter)`；回调 `org_external_id` 透传；`run_provider_oauth` feishu 分支保留 tenant_key，仅覆盖 job_title/dept）：

```rust
// EnterpriseService::sync_member
let external_id = external_id.trim();
if external_id.is_empty() { return Ok(()); }   // tenant_key 空 → 空转，不建记录
```

即 **飞书登录时 `/authen/v1/user_info` 没返回 `tenant_key`（公司标识）→ sync_member 空转 → 无企业成员记录 → /me 返回 null**。代码路径正确，值在源头（飞书响应）就是空的——为何空需**服务端日志**坐实（客户端摸不到远端 DB），故本轮加了诊断日志。

同时文案本身误导：徽标已用 SSO 姓名证明用户**确实**登录了，"尚未通过企业 SSO 登录"是错的。

## 本轮三处修复（approach B：企业身份 = SSO 登录用户本身，公司归属是可选增强）

1. **[EnterpriseIdentityCard.tsx]** — `/me` 为 null 但存在 SSO 会话（`getEnterpriseSession()`）时，回退显示会话里的登录身份（认证状态=已通过企业 SSO 登录 / 我的姓名 / 所属企业=未获取），不再谎报未登录；真正无会话时才显示"尚未登录"。
2. **[WorkspaceIdentityEntry.tsx]** — 左下角徽标下拉重构：**标题改回用户 `displayName`（SSO 姓名）而非项目组名**，先列"我的身份（SSO/企业）"，再单独列"项目组：{名称}"，两个维度视觉分离（此前标题用 `tenantName` + 内容全是项目组动作，把"我是谁"和"我在哪个项目组"揉在一起，两者恰好都叫王小明2 放大了混乱）。
3. **[one-sso/routes.rs]** — SSO 回调加 `info!` 记录 `has_company_id`（tenant_key 是否存在，不含敏感值），下次登录即可从服务端日志判定飞书到底返没返 tenant_key。

**验证**：`bunx tsc --noEmit` 干净、`oxlint` 0 error、`cargo check -p one-sso` 通过。**待办**：后端诊断日志需重编 aioncore 生效；下次真机 SSO 登录看服务端日志确认 tenant_key 缺失原因（飞书应用权限/scope，或 v2-token+v1-user_info 搭配），再决定是否修飞书取值方式或让后端在无公司时也返回纯 SSO 身份。

---

## 通用教训

`getEnterpriseSession()`（内部 `JSON.parse`）**每次调用都返回新对象**。任何 React 里把它的返回值直接用作 `useEffect`/`useMemo`/`useCallback` 依赖、或做 `Object.is` 比较的地方，都会因引用不稳定而失效或死循环。要用就先取**原始值**（`?.token`、`Boolean(...)`）再进依赖数组。同理适用于任何「每次返回新对象」的 getter。
