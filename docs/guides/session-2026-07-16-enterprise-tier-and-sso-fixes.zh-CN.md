# 2026-07-16 飞书桌面登录根治 → 架构盘点 → 「真实企业」层(B2)

> **读者**:后续接手的 AI / 开发者。
> **仓库**:`1oneUI`(前端/壳) + `1oneCore`(Rust 后端)。
> **状态**:**全部改动只在源码,尚未提交、尚未打包、尚未部署到远程服务器**。「真实企业」层**后端 + context 端点 + 前端均已完成并测试/类型/i18n 校验通过,后端已重编内嵌进 bundled**(07-16 补完,见 3.1 F)。剩:E2E 真机扫码、部署到远程 159、打包出新包 —— 均需用户侧操作。
> **红线(用户明确要求)**:本次任何改动**不得影响单机版(个人版)功能**。下文所有设计都围绕这条线。

---

## 1. 前因后果:一条从表象追到架构的链

起因是用户报:**飞书企业登录,浏览器显示已登录,但桌面端面板一直是"访客",怎么试都不变**。追查过程中一层层剥出四个不同的根因,最后引出架构问题:

### 1.1 第一层:不是 scheme 抢注(07-15 修过的那个)

07-15 修过 `aionui://` 被 dev/打包版互抢注册的问题。这次先怀疑它复发,实测**排除**:

- 注册表:`aionui://` → 打包版 `1onecode.exe`;`aionui-dev://` → dev electron,**拆分正确**。
- 合成 `aionui-dev://sso-callback?token=...` 用 `Start-Process` 触发 → dev 侧栏立刻变成 `sso_test_user`、`localStorage` 正确写入。**接收链路完全正常**。
- 抓包实证客户端发出的授权 URL 带了 `desktop=1&scheme=aionui-dev`(用 CDP 拦 `/api/shell/open-external` 拿到实参)。

结论:客户端(发送 + 接收)**全对**,问题在别处。

### 1.2 真因:回调页 1.2 秒自动关闭,抢在浏览器协议确认框之前

`one-sso` 的 `desktop_callback_page` 原本是:

```js
location.href = 'aionui-dev://sso-callback?token=...';
setTimeout(function () {
  window.close();
}, 1200); // ← 元凶
```

浏览器对自定义协议会弹「要打开 Electron 吗?」的**原生确认框**,但这个页面 **1.2 秒后就把标签关了,确认框跟着一起消失**,用户根本来不及点 → deep link 从未真正触发 → 桌面端永远收不到 token。

**决定性证据**:用户截图里那个框写的是「要打开 **Electron** 吗?」——说明远程回吐的 scheme 是 `aionui-dev`(**正确**),纯粹是没点成。用户换 Edge(不允许脚本关它没开的标签)后,页面留住、点「点击这里」→ **登录立刻成功**,监听捕获到真实 JWT session。

> 这个坑**与平台无关**(Win/macOS/Linux 浏览器都一样),也就是说**此前所有平台的飞书桌面登录基本都是坏的**。

### 1.3 第二层:登录成功了,但显示的是代号 `sso_019f68e0` 而不是「赵高」

链路查清:

- 飞书**确实返回了姓名「赵高」**,后端也存进了 `one_sso_identities.display_name`;
- 但登录用户名要过 `sanitize_username()`,**中文被过滤成空** → 回退成 `sso_<uuid前8位>` = `sso_019f68e0`;
- 而 **deep link 只传了 `username`,没传 display_name** → 客户端只能显示代号。

### 1.4 第三层(架构):SSO 认证 与 组织成员关系 是解耦的

实测 `/api/one/org/context` 返回 `{"tenantId":"default","isEnterprise":false,"memberCount":0}` —— 赵高**认证成功但没进任何组织**。读码确认:

- `resolve_or_provision_user`(one-sso)**只建一个带姓名的用户**,不碰 tenant、不写 `one_user_org`,**并且把飞书传回的公司标识 `tenant_key` 丢弃了**;
- `isEnterprise` 取决于 `one_user_org` 里的 tenant 是否 ≠ `default`,而那要靠**邀请码加入 / 建组织**。

于是引出用户的架构判断(正确):**"真实企业"和"项目组"在组织这块依赖性很弱**,当前"企业"其实只是"邀请码加入的协作容器",和真实公司组织架构没关系 —— 它更像**项目组**。

---

## 2. 为什么要做 / 预期效果

| 事项                    | 为什么                                                                                                              | 预期效果                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **回调页 1.2s→5s**      | 自动关闭抢掉协议确认框,导致所有平台桌面 SSO 登录都走不完最后一步                                                    | 用户有充裕时间点「打开」;页面仍会自动关(不留残页)   |
| **deep link 带 `name`** | 服务器有「赵高」却没交给客户端,只能显示 `sso_xxx` 代号                                                              | 侧栏显示真实姓名                                    |
| **小猫图标**            | WebUI favicon/manifest 与 Mac `app.icns` 仍是旧 AionUi 菱形 logo                                                    | 品牌一致                                            |
| **自动升级改指向 COS**  | fork 的升级源写死上游 `static.aionui.com` + `iOfficeAI/AionUi`,**上游一发版就会把原版 AionUi 推到 fork 装机上覆盖** | 只从用户自己的腾讯 COS 拉更新                       |
| **企业→项目组 改名**    | "企业"一词误导:自建的那个容器不是真实公司组织                                                                       | 概念清晰:项目组=邀请码轻量协作;企业=SSO 公司级      |
| **真实企业层(B2)**      | 商业化方向:公司自建服务器,员工飞书登录**自动入伙**、带真名/部门,免邀请码                                            | 同公司 SSO 登录自动进同一企业;外公司/无绑定不受影响 |

**B2 形态定调(用户拍板)**:每公司自建一台服务器(契合现有"一局域网一服务器 / 一服务器一企业 D3"约束),**不做**云端多租户 SaaS(那需要给 skills/MCP/看板/devops 全套加租户隔离,是大重构)。

---

## 3. 当前进度

### 3.1 已完成(源码,未提交)

**A. 飞书桌面登录 + 姓名**(1oneCore + 1oneUI)

- `one-sso/src/routes.rs` `desktop_callback_page`:**删掉 1.2s 自动关闭 → 改 5s**,并加醒目「打开应用」按钮;单测同步更新(断言 `5000` 存在)。
- `one-sso/src/routes.rs` `callback()`:deep link 参数 **加 `name`**(= 飞书 display_name)。
- `1oneUI`:`enterpriseMode.ts` 的 `EnterpriseSession` 加 `name?`;`useDeepLink.ts` 接收;`WorkspaceIdentityEntry.tsx` **优先显示 name**,拿不到才回退 username。

**B. 图标**(1oneUI)

- `public/pwa/icon-{180,192,512}.png` 用 `resources/app.png`(小猫)重生成;`public/manifest.webmanifest` 品牌 `AionUi`→`1One Work`。
- `resources/app.icns`(Mac 图标)原本是旧菱形,已用小猫重生成(仅 ≤512 原生/缩小尺寸,避免放大产生边缘噪点)。
  > `resources/app.ico`(Windows)本来就是小猫,未动。

**C. 自动升级改指向用户 COS**(1oneUI)

- `process/services/updateFeed.ts`:`CDN_UPDATE_BASE_URL` → `https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases`(**运行时真正生效的 feed**)。
- `process/bridge/updateBridge.ts`:`CDN_HOST`/`CDN_BASE_URL` 同步。
- `packages/desktop/electron-builder.yml`:`publish` 从 `github/iOfficeAI/AionUi` 改成 `generic` 指向同 URL。
- `.github/workflows/release-distribute.yml`:从上游 AWS S3(OIDC)**重写为腾讯 COS**。COS 兼容 S3,直接复用 `aws s3 cp --endpoint-url https://cos.ap-shanghai.myqcloud.com`,用 `COS_SECRET_ID/KEY` 当 AWS 凭据。

**D. 企业→项目组 改名**(1oneUI,i18n)

- zh-CN:78 处「项目组」(`common.enterprise.*` / `enterpriseConsole.*` / `collaborationContext.*` / `settings.workspaceIdentity.*`)。
- en-US:47 处「Project Group」。
- **其余 11 语言本就没有 enterprise 命名空间,运行时回退 en-US(`fallbackLanguage: en-US`),所以改 en-US 即全覆盖** —— "12 语言"实际收敛成只改 en-US。
- 保留不动:真实企业(**企业微信 / 企业 SSO / 企业认证**)、AI**团队作战/团队协作**。

**E. 真实企业层 B2 — 后端已完成**(1oneCore)

- 迁移:`one-org/migrations/004_tenant_sso_binding.sql`(`one_tenants` + `sso_provider`/`sso_org_id` + 唯一索引);`one-sso/migrations/004_identity_org_external_id.sql`(`one_sso_identities` + `org_external_id`)。两者都注册进各自的 `migrate.rs` 账本。
- 捕获公司标识:`ProviderUserInfo` + `org_external_id`;飞书 `to_provider_user_info` 填 `tenant_key`(空白安全回退 None);`bind_identity`/`touch_identity` 持久化。
- 绑定:`OrgService::create_tenant` 建企业时把**创建者的 SSO 公司**绑到 tenant(`sso_org_binding_for`)。
- 自动入伙:`OrgService::auto_provision_enterprise(user, provider, org_external_id)`。
- 接线:`one_sso::EnterpriseAutoJoiner` trait + `aionui-app` 里的 `OrgEnterpriseAutoJoiner` adapter(照抄既有 `TenantResolver`/`OrgTenantResolver` 范式,同层 crate 只能靠 trait 交互);`callback()` 在 **`issue_session` 之前**调用(auto-join 会轮换 jwt secret,顺序反了 token 就废)。

**F. 真实企业层 B2 — context 端点扩字段 + 前端(本轮 07-16 补完)**

后端(1oneCore,`one-org`):

- `OrgContextDto` 扩 4 字段(`crates/one-org/src/models.rs`):`sso_bound: bool`(tenant 是否绑定 SSO 公司 = 区分真实企业/项目组)、`display_name` / `org_unit_path` / `job_title`(本人 org 资料,`Option`)。
- `TenantRow` 补 `sso_provider` / `sso_org_id`(迁移 004 已加的列,之前 Row 没映射)+ `is_sso_bound()` 助手;`UserOrgRow` 补 `display_name` / `job_title`(表本来就有列,`SELECT *` 自动填充,无需改 SQL)。
- `context()` 只在 `is_enterprise` 时填这些字段,**个人版全 `None`/`false`/`0`,与旧行为逐字节一致**(红线)。
- 新增 2 个单测:`context_reports_project_group_as_not_sso_bound`(项目组 `sso_bound=false` 但仍 `is_enterprise`)、`context_in_personal_edition_is_empty`(个人版全空)。

前端(1oneUI):

- `common/types/org/orgTypes.ts`:`OrgContext` 加 `ssoBound?` / `displayName?` / `orgUnitPath?` / `jobTitle?`(bridge 是纯透传 `httpGet<OrgContext>`,新字段自动到达,无需改 bridge)。
- `pages/enterprise/components/OverviewTab.tsx`:企业总览新增「类型」行(真实企业·SSO / 项目组·邀请码 Tag)+ 本人姓名/部门/职位行(仅在有值时显示)。
- `components/layout/WorkspaceIdentityEntry.tsx`:侧栏姓名链补 `context.displayName`;版本行按 `ssoBound` 区分「企业团队版」vs「项目组」;下拉菜单头补「部门:xxx」(有部门才显示)。
- **i18n 语义修正**:上一轮"企业→项目组"改名把 `settings.workspaceIdentity.editionEnterprise` 值直接改成了"项目组版"。本轮有了真实企业/项目组的**真实区分**,把它**回归为"企业团队版"/"Enterprise"(仅 `ssoBound` 时用)**,并新增 `editionProjectGroup`(项目组)、`departmentLine`(部门:{{department}});common.json 新增 `fieldTenantType`/`tierRealEnterprise`/`tierProjectGroup`/`fieldMyName`/`fieldMyDepartment`/`fieldMyJobTitle`。仅 zh-CN + en-US(其余语言回退 en-US)。
- 校验:`bunx tsc --noEmit` 干净、`node scripts/check-i18n.js` 通过(类型定义 in sync)、`oxlint --fix` + `oxfmt` 干净。
- **已重编内嵌**:`aioncore.exe` release 编译(1m56s)并 `prepareAioncore.js` 内嵌进 `resources/bundled-aioncore/win32-x64`(`source=local`);内嵌前需先停掉正在运行的 dev 应用(占用锁二进制,否则 EPERM)。

### 3.2 ⚠️ 红线:我改了已批准方案的决策①

原批准方案是「**第一个 SSO 登录者自动建企业并当 system_admin**」。实现前发现**它会踩红线**:一台单机装机只要配了飞书 SSO 有人登录,就会被**悄悄变成企业服务器**。故改为:

- **`auto_provision_enterprise` 是 join-only,永远不建 tenant**;建企业仍是管理员显式操作(`create_tenant`,它才记录公司绑定)。
- 无匹配绑定(异公司 / 无绑定的项目组 / 压根没企业)→ **什么都不做**,用户原样留在个人态。
- `OneSsoRouterState.auto_joiner` 是 **`Option`**;不注入时 SSO 登录行为与今天**逐字节一致**。

### 3.3 测试结果

`cargo test -p one-org -p one-sso` → **one-org 27 passed / one-sso 45 passed / 0 failed**(07-16 补完前端后新增 2 个 context 测试,由 25→27);`cargo fmt` 干净。原后端 6 个测试:

| 测试                                                                       | 锁住的行为                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `auto_provision_enterprise_never_creates_a_tenant`                         | **红线测试**:断言 `one_tenants` 计数保持 0、用户仍在 `default` |
| `auto_provision_enterprise_joins_the_enterprise_bound_to_the_same_company` | 同公司自动入伙(member)+ 真名/部门落到成员行                    |
| `auto_provision_enterprise_ignores_a_different_company`                    | 异公司不入                                                     |
| `auto_provision_enterprise_skips_an_unbound_project_group`                 | 无绑定的项目组不被 SSO 自动加入                                |
| `create_tenant_binds_the_creators_sso_company`                             | 建企业绑定创建者公司                                           |
| `create_tenant_leaves_the_binding_null_without_an_sso_identity`            | 本地建的企业不绑定(= 项目组,邀请码专用)                        |

> clippy 报的 3 条(`heartbeat_runtime_node` 参数过多、dingtalk `access_token` / wecom `open_id` dead_code)是**既有问题**,与本次改动无关,未处理(不扩范围)。

---

## 4. 待办

1. ~~**前端(真实企业层)**:显示部门、区分「真实企业/项目组」~~ ✅ **07-16 完成**(见 3.1 F):`OrgContextDto` 已扩 `sso_bound`/`display_name`/`org_unit_path`/`job_title`;总览页 + 侧栏 + i18n 全改完,类型/i18n/lint 校验通过。
2. ~~**重编 `aioncore.exe` 并进 bundled**~~ ✅ **07-16 完成**(release 编译 + `prepareAioncore.js` 内嵌 `source=local`)。⚠️ **仅本机 dev 生效**;远程 159 那台仍是旧后端,要靠待办 4 部署过去。
3. **E2E 真机验证**(飞书扫码),见第 5 节。**⚠️ 只有本机 dev 用的是新后端**;真机验证真实企业自动入伙/部门显示需先把新后端部署到 159(待办 4)。
4. **部署到远程服务器 `192.168.11.159:25808`**(另一台机器,装的是 **2.1.44**):
   - 回调页 5 秒修复是**服务器端渲染的**,不部署过去,登录体验不变(仍要靠换浏览器/手快)。
   - 真实企业自动入伙也在服务器端。
5. **打包**(bump 版本):图标 + 自动升级改 feed 都要出新包才落到装机版。
   - ✅ **07-16 已本地打包 Windows x64**:`out/1ONE-Code-2.1.45-win-x64.exe`(329MB,已 signtool 签名),版本 2.1.44→**2.1.45**(已 commit+push)。**关键**:打包必须带 `AIONUI_BACKEND_LOCAL_PATH` 指向本地 `1oneCore/target/release/aioncore.exe`,否则 `prepareAioncore` 会去 `gaogg521/1oneCore` releases 下载(我的改动只推了 one-main、没发 release → 会拉到旧版或失败);已核实打进包的后端 `manifest.sourceType=local`、`version=v0.1.45-one.1`。
   - **用途**:装到 159 当企业**服务器**,dev 环境当**客户端**联调(见 5.5)。mac 包仍未出。
6. **用户侧前置条件(非代码)**:
   - 飞书开放平台给应用「IT小助手」加**「通讯录」只读权限** —— 现在它**只有「获取用户身份标识」**(截图实证),所以**拿不到部门**(姓名能拿到)。
   - GitHub 加 `COS_SECRET_ID` / `COS_SECRET_KEY` 两个 Secret;确认 COS 桶公开读。
   - COS 桶目前**只有 dmg、没有 `latest*.yml`**,升级器靠 yml 判版本 —— 要等 `release-distribute.yml` 跑一次才会补齐。

---

## 5. 怎么验证

### 5.1 改了什么 → 该怎么加载(铁律)

| 改动                                                            | 必须做                                                             | 验证                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `1oneCore` Rust(本次 one-sso/one-org/aionui-app + **两个迁移**) | `D:\aionui-m0\scripts\backend-rebuild.ps1` → 再 `frontend-dev.ps1` | 日志出现 `starting: ...\1oneUI\resources\bundled-aioncore\...`;迁移重启自动跑 |
| `1oneUI` 渲染进程 / i18n JSON                                   | dev 热更新(**注意 HMR 会漏**,见下)                                 | 刷新窗口                                                                      |
| 仅文档                                                          | 无需 rebuild                                                       | —                                                                             |

> **本次踩到的 HMR 坑**:改 i18n JSON / `.tsx` 后 dev 窗口可能显示"半拉子"(侧栏已是「项目组」、部署卡还是「企业」)。**不是改错了**,是 HMR 没热更那个文件。**重启 dev 或打包后一致**。别被它误导。

### 5.2 单测

```bash
cd D:\aionui-m0\1oneCore
cargo test -p one-org -p one-sso        # 期望 25 + 45 passed / 0 failed
cargo fmt -p one-org -p one-sso -p aionui-app -- --check
```

### 5.3 E2E:飞书扫码(需先把新后端部署到 192.168.11.159)

1. dev 客户端:设置 →「项目组」页 → 本机作为客户端 → 填 `192.168.11.159:25808` → 保存。
2. 「在浏览器登录企业账号」→「飞书账号」→ 手机扫码授权。
3. 回调页(5 秒版)出现 → 点「打开应用」;浏览器弹「要打开 Electron 吗?」→ **勾「始终允许」+ 点「打开 Electron」**(勾了下次直接秒开)。
4. 期望:
   - 侧栏显示**「赵高」**(不是 `sso_019f68e0`);
   - `GET /api/one/org/context`(带 Bearer)返回 `isEnterprise: true` + 该公司的 tenant —— **前提是服务器上已由管理员显式建过企业(那次创建会绑定公司)**;
   - 同公司第二人登录 → 自动出现在成员列表;
   - 部门要显示,**得先给飞书应用加通讯录权限**。

**本次用过的排查手法(好用,记下来)**:

- CDP 直接读/写渲染进程:`localStorage` 状态、`document.body.innerText` 断言文案、`Page.captureScreenshot`。
- 拦 `window.fetch` 抓 `/api/shell/open-external` 的实参 → 拿到客户端真正打开的授权 URL(证明带没带 `desktop=1&scheme=`)。
- `Start-Process "aionui-dev://sso-callback?token=..."` 合成 deep link,绕开飞书扫码单独验证接收链路。
- 注册表 `HKCU\Software\Classes\{aionui,aionui-dev}\shell\open\command` 看协议归属。

### 5.4 自动升级(改完 feed 后)

- Actions 里手动 dispatch `Distribute Release Assets` 对着某个已有 tag 跑 → 验证 COS 出现 `releases/{版本}/` 和 `releases/latest*.yml`。
- ⚠️ 时序:**现装的 2.1.44 用的还是旧 feed(上游)**,必须先出一个带本次改动的新包、手动装上,之后的自动升级才会走 COS。

### 5.5 联调拓扑(159 服务器 + dev 客户端)

- **159 = 企业服务器**:装 `1ONE-Code-2.1.45-win-x64.exe`(新后端 = 真实企业层 + 回调 5s + scheme-aware)。回调页 5s、真实企业自动入伙都在**服务器端**,所以必须装到 159 才生效。
- **dev 环境 = 客户端**(`bun run dev`,scheme `aionui-dev`;新前端 = 显部门/分层/deep link 收 name)。
- **scheme 匹配为什么这次成立**:客户端发 `desktop=1&scheme=aionui-dev`,**新服务器(2.1.45)是 scheme-aware 的**,会照着回吐 `aionui-dev://` → dev 客户端收得到。这正是本轮改动闭环的地方(旧服务器只回 `aionui://`,dev 收不到)。见 [[sso-scheme-desktop-callback-constraint]]。
- **真实企业自动入伙要有绑定目标**:159 上的企业必须是**被 SSO 公司绑定**的(`create_tenant` 在创建者带 SSO 身份时才写 `sso_provider/sso_org_id`)。若企业是本地管理员(无 SSO)建的 → 是**未绑定的项目组**,SSO 登录不会自动入伙。所以测真实企业:建企业的管理员要**先飞书登录**再建企业。
- **部门显示**仍卡在飞书应用的**通讯录只读权限**(没有 → `org_unit_path` 空,姓名能显示)。
- **混版陷阱**:159 现装 2.1.44,装 2.1.45 若行为怪异,先卸干净删旧安装目录再装(见 [[packaging-exe-name-mismatch]])。

---

## 6. 关键结论速查

- 飞书桌面登录走不完最后一步 = **回调页 1.2s `window.close()` 抢掉协议确认框**,与 scheme/平台无关。
- 显示 `sso_xxx` 而非真名 = **中文用户名被 sanitize 掉 + deep link 没传 display_name**,服务器其实有「赵高」。
- **SSO 认证 ≠ 加入组织**:前者只建用户,后者靠 `one_user_org`;飞书 `tenant_key`(公司标识)此前被丢弃 —— 这是"真实企业"层缺的那块拼图。
- 自动升级此前会**把上游原版 AionUi 推到 fork 装机上**,已改指向用户 COS。
- 「一服务器一企业(D3)」是硬约束:`create_tenant` 见到已有 tenant 就拒;因此 B2 选每公司自建服务器,不做多租户。
- **红线**:`auto_provision_enterprise` join-only + `auto_joiner` 为 `Option`,单机版行为零变化,并有测试锁死。

---

## 7. 07-17 联调回归:根因比"缺面板"深 —— 服务器 `--local` 塌缩客户端身份

真机联调(159 装 2.1.45 当服务器,dev 当客户端)暴露三现象:①服务器自己显示"访客";②客户端"除项目组外都点不动";③赵高看不到自己的欢乐互娱身份、只看到项目组名。用户拍板:**企业组织(SSO 公司身份)与项目组(邀请码 tenant)是两个独立维度**,轻量版(只显示公司/部门/岗位)。

### 7.1 真根因(证据链)

- 桌面 co-located 后端**硬编码 `--local`**(`1oneUI/packages/web-host/src/backend-launcher.ts:575` `local: true`)。
- "本机作为服务器"用 web-host `static-server` 绑 `0.0.0.0`(`static-server.ts:140`)把 `/api/*` 反代到 `127.0.0.1` 的 `--local` 后端(`static-server.ts:63-83`)。
- `--local` 的 `auth_middleware`(`1oneCore/crates/aionui-auth/src/middleware.rs`)**无条件注入 `system_default_user`、跳过 JWT** → **所有远端客户端的登录 token 被无视,全体塌缩成 `system_default_user`**。所以赵高连上去,服务端一切治理接口都以 system_default_user 回答(看到的是它的成员/tenant,而非自己)。还是安全隐患:无 token 打 `:25808` 也被当成 system_admin。

### 7.2 已修(源码,已测)

**P1(核心)`aionui-auth/src/middleware.rs`**:`--local` 分支改为 **带有效 Bearer JWT 就解析成那个真实用户**(复用 `jwt_service.verify` + `user_repo`),没带/无效才回落 `system_default_user`。桌面本机(不带 token)行为不变;远端客户端(带 token)终于认成自己。**严格改进,不削弱现状**(无 token→operator 的既有行为未动)。3 个新单测锁定(honor token / 无 token / 无效 token)。⚠️ 残留:无 token 打网络暴露的服务器仍被当成 operator —— 这是**既有安全洞**,本轮未扩范围去堵(要堵需区分 loopback 桌面 vs 反代远端,是更大的设计),已在此标注。

**P2(独立企业组织维度)**:

- 后端 `one-sso`:`SsoService::identity_of(user_id)` + `GET /api/one/sso/me` 返回调用者自己的 SSO 身份(`provider`/`companyId`=tenant_key/`displayName`/`department`/`jobTitle`),**独立于任何 tenant**。DTO `SsoIdentityDto`(models.rs)。新路由组 `one_sso_member_routes`(挂在 auth 之后,非 admin 门控),`aionui-app` 里 merge。2 个新单测。
- 前端:`oneSso.me` bridge(`ipcBridge.ts`)+ `SsoIdentity` 类型 + `useSsoIdentity` hook + `OverviewTab` 顶部新增独立「企业组织」块(认证来源/所属企业/姓名/部门/岗位),与下方项目组并存。i18n zh-CN+en-US 新键(`orgIdentity*` / `ssoProvider*`)。

测试:`aionui-auth` 116+3+23+35 全绿;`one-sso` 47(+2);`one-org` 27;前端 tsc/oxlint/i18n 校验全过。

### 7.3 修完后的预期行为(需 159 装 2.1.46 复测)

- 赵高连上 159:服务端认得出他 → `/api/one/org/context` 返回**赵高自己**的上下文(他没用邀请码 join 王小明1,所以正确显示"未加入项目组");`/api/one/sso/me` 返回他的 SSO 身份(欢乐互娱 tenant_key + 姓名;**部门/岗位仍需飞书通讯录权限**,公司只有 tenant_key 无中文名)。
- 企业组织块与项目组分开展示 —— 落地"两个独立维度"。
- **#1(服务器显示访客)**:用户确认 王小明1 是在 159 桌面 App 里建的 → 创建者应是 `system_default_user`、本该是成员。若装 2.1.46 后仍显示访客,是独立 bug,需 159 运行时取证(查 `/api/one/org/context` 实际返回 + 是否真 `--local` + create 是否写了 membership 行)。
- **#2(客户端除项目组外点不动)**:静态分析**证伪**了"WS 带远端 token 致本机拒握手"(本机 `--local` 的 WS `token_validator` 恒 true、`token_extractor` 忽略 header,见 `aionui-app/src/router/state.rs:821-842`)。真因待运行时取证(dev DevTools:`[ensureWs]` 是 CONNECTED 还是 CLOSED?close code?`getBackendPort` 是否回退 13400=本机后端没起来?)。历史上同款报告曾是**误导性 UI 文案**(见 [[session-2026-07-13-enterprise-client-6bugs]])。

### 7.4 打包

已本地打包 `out/1ONE-Code-2.1.46-win-x64.exe`(带 `AIONUI_BACKEND_LOCAL_PATH`,后端 `sourceType=local`)。装到 159 复测。
