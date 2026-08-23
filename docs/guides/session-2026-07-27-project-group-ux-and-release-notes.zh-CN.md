# 2026-07-27 项目组/企业身份 5 个体验问题修复 + 更新日志打通

用户真机反馈的 5 个问题，全部在 1oneUI 前端（含 1 处主进程 + 1 处发布流水线）解决，**未涉及 1oneCore**。

## 1. 客户端 → 服务器切换缺二次确认，且切完地址被清空

**现象**：在「项目组 → 项目组部署模式」把单选从「本机作为客户端」切到「本机作为服务器」，点一下立刻生效、没有任何确认；切完回头看，之前填的服务器地址空了，要重新去查局域网 IP。

**根因**：两件事耦合在一个写操作里。`persistDeploymentConfig(role, url)` 同时写角色和地址，
`handleRoleChange` 里切服务器时传的是 `applyRole(next, next === 'client' ? url : '')` —— 即**用空串覆盖掉已保存的地址**。
`markDeploymentAsServer()`（本机创建项目组时调用）同样是 `persistDeploymentConfig('server', '')`，也会顺手抹掉地址。

**修复**（[`useDeploymentRole.ts`](../../packages/desktop/src/renderer/hooks/enterprise/useDeploymentRole.ts)）：
角色和地址拆成两个独立写操作，互不影响。

- `persistDeploymentRole(role)` —— 只写角色；服务器模式只是**忽略**地址（并 `clearEnterpriseRemotePointer()` 断开远端指针），不再擦除它。
- `persistDeploymentServerUrl(url)` —— 只写地址（并入历史记录）。
- `markDeploymentAsServer()` 改为调 `persistDeploymentRole('server')`，本机建组不再丢地址。
- 旧的 `persistDeploymentConfig(role, url)` 已删除（无调用方，避免留下会重新踩坑的入口）。

确认框（[`EnterpriseDeploymentModeCard.tsx`](../../packages/desktop/src/renderer/pages/settings/components/EnterpriseDeploymentModeCard.tsx)）：
client → server 现在弹 `Modal.confirm`（`webui.promoteConfirmTitle` / `promoteConfirmDesc`），取消则单选回滚。
注意分支顺序：**已加入项目组时的"暂时无法切换"拦截（`Modal.warning`）仍在前面**，确认框只在真能切的时候出现。

## 2. 服务器地址没有历史记录

新增客户端偏好键 `webui.enterpriseServerUrlHistory`（`string[]`，最多 8 条，最近使用在前）。

- 纯函数在 [`webuiEnterpriseConfig.ts`](../../packages/desktop/src/common/config/webuiEnterpriseConfig.ts)：`normalizeEnterpriseServerUrlHistory`（把存量脏数据规整成合法 origin 列表）、`appendEnterpriseServerUrlHistory`（重复项提到最前、不产生重复、封顶）。存的值来自客户端偏好，一律当不可信输入处理。
- 每次「保存地址」自动入历史；输入框由 `Input` 换成 `AutoComplete`（用 Arco 默认 `filterOption` 做子串匹配，别自己写 `filterOption`——`option.props` 在 TS 下是 `unknown`），下方另有一排历史地址快捷按钮 + 「清空」。
- 「清空」只清列表，**不动当前已保存的地址**（`clearDeploymentServerUrlHistory`）。

## 3. 「连接远端项目组服务器」搬到「企业身份」页

企业与项目组已彻底解耦，而这个模块干的事其实是**浏览器 SSO 登录/登出**（企业身份维度），不是项目组治理。

- 从 [`pages/enterprise/index.tsx`](../../packages/desktop/src/renderer/pages/enterprise/index.tsx) 移除，挂到 [`EnterpriseIdentitySettings.tsx`](../../packages/desktop/src/renderer/pages/settings/EnterpriseIdentitySettings.tsx)（仍然只在桌面端 + 客户端模式渲染）。
- 部署模式卡片（地址输入）**留在项目组页**不动 —— 它属于项目组维度。
- 因此两个模块现在跨页：`RemoteServerSection` 里"请先在上方…填写"的文案改成"请先在「项目组」页…"，并加了一个「前往填写」按钮直接 `navigate('/settings/enterprise')`。
- SSO 回跳目标从 `/settings/enterprise` 改成 `/settings/enterprise-identity`（登录完回到发起登录的那一页）。

## 4. 已登录企业的用户，头像菜单不该再出现"登录"

**现象**：SSO 已登录（左下角显示「企业 SSO：xxx」）但还没加入项目组时，菜单项仍是「登录 / 加入项目组」，点进去跳「登录您的账户」页 —— 对已认证用户是死路。

**修复**（[`WorkspaceIdentityEntry.tsx`](../../packages/desktop/src/renderer/components/layout/WorkspaceIdentityEntry.tsx)）：按"企业 ⊃ 项目组"分三态。

| 状态                      | 菜单项                                | 跳转                                     |
| ------------------------- | ------------------------------------- | ---------------------------------------- |
| 已加入项目组              | 企业设置 / 退出（+ 管理员的管理后台） | `/settings/enterprise`                   |
| 已 SSO 登录、未加入项目组 | **加入项目组**（不再有"登录"）        | `/settings/enterprise`（加入 UI 所在页） |
| 未登录                    | 登录 / 加入项目组                     | `/enterprise/login`                      |

顺带：菜单头部对第二种状态显示「尚未加入项目组」；左下角副标题原来在这种情况下显示「个人版 · 未登录」（明显撒谎），改为「已登录 · 未加入项目组」。

## 5. 更新提示里的「更新日志」点开是空的

**根因**：本 fork 根本没有任何 release notes 数据源。

- 自动更新走 COS 上的 `latest*.yml`，而 **electron-builder 只有在构建时存在 notes 资源才会往 yml 里写 `releaseNotes` 字段**（见 `app-builder-lib/out/publish/updateInfoBuilder.js` 的 `getReleaseInfo`），本 fork 没有 → 字段缺失。
- 手动检查 `update.check` 的 `body` 也是从同一份 yml 的 `releaseNotes` 读的（`buildLatestReleaseInfo`），同样为空。
- 于是弹窗要么永远停在「更新内容获取中」，要么显示 `releaseNotesFailed`（zh-CN 文案是半句话「获取失败，可」）而 `releasePageUrl` 为空时连后半句链接都不渲染 —— 视觉上就是"什么都没有"。

**修复三处**：

1. **数据来源**：[`release-distribute.yml`](../../.github/workflows/release-distribute.yml) 新增一步，把 GitHub Release 正文写成 `dist/release-notes.md`，随现有 `aws s3 cp dist/ .../{VERSION}/ --recursive` 一起传到 `releases/{version}/release-notes.md`。选这条路而不是构建期生成 yml 字段，是因为**发布说明是在建 Release 时才写的**，走 sidecar 可以事后单独重传一个小文件修正，不用重新打包。正文内容由下面的生成器产出（见 §6）。
2. **客户端读取**：[`updateBridge.ts`](../../packages/desktop/src/process/bridge/updateBridge.ts) 的 `update.check` 在 yml 没带 `releaseNotes` 时，best-effort 拉 `releases/{version}/release-notes.md`（8s 超时、按版本号缓存、失败静默）。对象存储对不存在的 key 有时回 XML 错误文档而不是 404，所以额外挡了一层「正文以 `<` 开头视为无内容」。
3. **兜底文案**：[`UpdateNotificationCard.tsx`](../../packages/desktop/src/renderer/components/settings/UpdateNotificationCard.tsx) 弹窗改为"有正文就渲染 → 正在加载才显示加载中 → 其余一律显示 `noReleaseNotes`/`releaseNotesFailed` + 永远带「前往查看」链接"。同时 `openReleasePage` 在 `releasePageUrl` 为空时回退到 `RELEASES_PAGE_URL`（`https://work.1oneclaw.com/`），不再点了没反应。
4. **状态语义纠正**（真机复测才暴露）：改完 3 之后真机弹出的是「获取失败，可 前往查看」—— 但检查本身是成功的，只是没有正文。根因是 [`updateNotificationState.ts`](../../packages/desktop/src/renderer/components/settings/updateNotificationState.ts) 的 `checkAvailable` / `manualReleaseInfoLoaded` 把「正文为空」直接判成 `'failed'`。已改成**请求成功一律 `'loaded'`**，空不空交给组件用 `noReleaseNotes` 表达；只有 `manualReleaseInfoFailed`（真的请求失败）才是 `'failed'`。真机复测后显示「暂无更新说明。前往查看」。

> ⚠️ **生效前提**：①②要等下一次打包 + 下一次 `release-distribute` 才有效果。已发布的 2.1.50 的 yml 里仍然没有 notes；给它补传 `releases/2.1.50/release-notes.md` 也只有升级到含本次修复的版本之后才读得到。

## 6. 更新日志从提交自动提取（承接 §5，用户追加要求）

§5 只解决了"正文怎么送到客户端"，没解决"正文从哪来"—— 靠人肉写。补一个生成器：
[`scripts/generate-release-notes.js`](../../scripts/generate-release-notes.js)（`bun run release-notes`）。

- **范围**：上一个可达的 `v*` tag → HEAD。本 fork 的 tag 是稀疏的（不是每版都打），
  自动回溯因此可能横跨几个版本号 —— 这是想要的：覆盖上次正式发布以来真正发出去的全部改动。
  `--from` / `--to` / `--version` / `--out` 可覆盖。
- **过滤**：只留 `feat` / `fix` / `perf`。`docs`/`chore`/`ci`/`style`/`test`/`build`/`refactor`
  是发布杂务，不进用户可见的更新日志（实测 v2.1.48..HEAD 40 条提交里只有 14 条够格）。
  另外去重、挡版本号 bump、每组封顶 25 条（防上游同步一次灌进几百条）。
- **兜底**：`release-distribute.yml` checkout（`fetch-depth: 0`，要 tag），
  Release 正文非空时照旧直接用；**正文为空时自己跑一遍生成器**，保证任何一版都不会没有更新日志。

（这一版随后在 §7 被升级为 JSON 权威格式，`.md` 纯文本覆盖已废弃。）

## 7. 「同一份内容，三处展示」——桌面端 + GitHub Release + 官网（用户追加：官网也有更新展示）

用户指出官网 `D:\website\1onework` 也有一个「更新内容」展示区
（`src/changelog.js` 驱动），此前和桌面端更新日志完全独立维护，发一版要写两份文案。
详细设计与取舍见计划文档 `refactored-mapping-waffle`（已归档），落地如下：

**关键约束**：`D:\website\1onework` **不是 git 仓库、不在 GitHub 上**（部署是本机
`npm run build` + `D:\game\scripts\deploy-1onework-www.py`，Python/SSH）——官网这一段
**不可能挂进 `release-distribute.yml`**，只能是发布时本机手动（或 AI 会话）跑一条命令，
和既有"官网改完直接部署，不用问"约定一致。

**权威格式升级为 JSON**：`docs/release-notes/<version>.json`（取代 §6 提到的 `.md` 纯文本
覆盖，还没人用过，直接升级不算破坏性变更），形状对齐官网 `changelog.js` 现有条目
（`{version, date, zh:[{t,d}], en:[{t,d}]}`），零转换成本：

- `generate-release-notes.js` 新增 `--draft-json` 起草模式（`t`=scope 中文标签，
  `d`=commit 描述原句，`en` 留空）；原有的"生成扁平 Markdown"逻辑改为优先读这份 JSON——
  **但只有 `zh`/`en` 都非空才采信**，空 `en` 就是"还是草稿"的信号，退回 commit 自动生成，
  防止未润色的占位文案被发出去。
- 新建 [`scripts/sync-changelog-to-site.js`](../../scripts/sync-changelog-to-site.js)：
  读这份 JSON，prepend 进官网 `changelog.js` 的 `CHANGELOG` 数组 + 顺带把
  `site.config.js` 的 `release.version` 也改了（下载链接拼 COS 路径用的就是它）。
  同版本重复跑会拒绝（不静默覆盖已手改文案）；`--dry-run` 预览不写盘。
  真机验证：dry-run 渲染正确（含双引号转义）→ 真实写入 → `import()` 确认产物是合法 ESM
  且 `CHANGELOG.length`/`version` 正确 → 重复运行确认拒绝 → 恢复备份。

**官网渲染层同时改版**（用户中途追加：`CHANGELOG` 全量渲染进落地页会让首屏越滚越长）——
用 `AskUserQuestion` 让用户在"独立更新记录页 / 同页加载更多 / 按年份折叠"三个选项里选，
选了**独立页**（站内已有 `docs.html` 多页构建先例，改动集中、风险低）：

- `src/main.js` 的 `renderChangelog()` 加 `LANDING_CHANGELOG_LIMIT`（初版取 2，用户
  真机复测后要求收紧到只留最新 1 个版本，已改），落地页只渲染最新版本，区块底部加
  「查看全部更新记录 →」（`.updates-more`，样式抄 `.hero-cta__more`）。
- 新建 `updates.html` + `src/updates.js`（仿 `docs.html`/`docs.js` 的轻量页模式：独立
  vite 入口、不拖落地页 980 行的轮播/画廊状态机），渲染**完整** `CHANGELOG`，语言切换
  复用 `www-lang` localStorage（和落地页共享记忆），i18n 文案给了独立的 `updatesPage.*`
  键（没直接复用 `updates.*`——那组是给落地页 section 用的，真机复测发现两者混用会导致
  独立页 H1 显示"更新内容"而不是"更新记录"，语义对不上，已拆开）。
- `vite.config.js` 加第三个构建入口 `updates: resolve(__dirname, "updates.html")`。

用法与完整发布顺序（起草 → 人工润色 → 桌面端/Release → 官网同步 → 部署）写在
[`docs/release-notes/README.md`](../release-notes/README.md)。

## 验证

- `bunx tsc --noEmit` 通过；`bun run lint:fix` / `oxfmt` 通过；`bun run i18n:types` + `node scripts/check-i18n.js` 通过（仅存量 warning）。
- 单测：`EnterpriseDeploymentModeCard.dom` / `webuiEnterpriseConfig` / `UpdateNotificationCard.dom` / `updateNotificationState` / `OverviewTab.dom` + 新建的 `WorkspaceIdentityEntry.dom` 共 50 条全绿。
  - 新增覆盖：切服务器必须先确认且只写角色不写地址、历史地址可点选并保存、历史列表规整/去重/封顶、"无更新日志"不再卡在加载中、身份菜单三态与跳转目标。
- 已知既有失败（与本轮无关，07-20 起就有）：`tests/unit/settings/SettingsSider.dom.test.tsx`（测试里的 `@icon-park/react` mock 缺 `BuildingOne`）、`tests/unit/renderer/LocalAgents.dom.test.tsx`（断言仍指上游 wiki URL）。

### 真机 CDP 冒烟（dev，全部通过）

`frontend-dev.ps1` 起 dev（未改 1oneCore，无需 `backend-rebuild`），CDP 9230 直连渲染进程逐条走：

| 项             | 结果                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ③ 模块搬家     | 项目组页 `hasRemoteSection:false` / 企业身份页 `hasRemoteSection:true` + 「前往填写」按钮在                                                                                     |
| ② 历史记录     | 填 `192.168.1.77:25809` → 保存 → 「历史地址」区出现 `http://192.168.1.77:25809`                                                                                                 |
| ① 确认框       | 点「本机作为服务器」弹出「切换为服务器？…」；**取消**→ 单选回滚到客户端且地址还在                                                                                               |
| ① 地址不丢     | **确定**后读 `/api/settings/client`：`role=server` 而 `enterpriseServerUrl` 仍是 `192.168.1.77:25809`、history 保留（修复前这里会是空串）；切回客户端输入框自动回填             |
| ④ 头像菜单     | 注入 SSO 会话后菜单为「赵高 / 企业 SSO：… / 尚未加入项目组 / **加入项目组**」，无「登录 / 加入项目组」；点击落到 `#/settings/enterprise` 的邀请码加入 UI，`登录您的账户` 未出现 |
| ⑤ 更新日志     | 合成 `aionui-update-available` 事件复现原 BUG（弹窗只有半句「获取失败，可」）→ 修完显示「暂无更新说明。前往查看」                                                               |
| ⑤ sidecar 路径 | `curl releases/2.1.50/release-notes.md` → 404 + `NoSuchKey` XML（`!response.ok` 分支覆盖；同桶 `latest.yml` 200 说明路径形态对）                                                |

> 冒烟注入的假会话与 `192.168.1.77` 地址**已清理**（`one-enterprise:session` 删除、`webui.deploymentRole=client` / `enterpriseServerUrl=''` / history `[]`）。dev 数据目录是 `%APPDATA%\1one-Dev`，与正式安装版隔离。

### §7 官网侧验证（`D:\website\1onework`，全部通过）

- `generate-release-notes.js`：`--draft-json` 起草 → 校验字段齐全；写入就绪的
  `<version>.json`（zh/en 均非空）→ 渲染优先取 canonical（`source: canonical`）；把 `en`
  清空 → 自动退回 commit 生成（`source: commits`）——三条路径都实测过。
- `sync-changelog-to-site.js`：`--dry-run` 渲染正确（含 `\"引号\"` 转义）→ 真实写入 →
  `import("./src/changelog.js")` 确认产物是合法 ESM 且条目数正确 → 重复跑同版本被拒绝 →
  `changelog.js`/`site.config.js` 用备份完整恢复到测试前状态。
- `npm run build`：新增 `updates` 入口正常出包（`dist/updates.html` + 独立
  `updates-*.js` chunk），无报错。
- `npm run preview` + chrome-devtools MCP（`navigate_page`/`evaluate_script`/`take_snapshot`）
  实机核对：
  - 落地页 `#changelog-list` 只有 2 个 `.changelog-entry`（v2.1.50/v2.1.49），
    「查看全部更新记录 →」链接可见且指向 `./updates.html`。
  - `updates.html` 完整渲染同样 2 条历史（当前仓库只有这么多，逻辑上不截断）；
    点击语言切换按钮 → 标题/kicker/条目文案/`document.title`/`<html lang>` 全部转英文，
    且 `localStorage.www-lang` 写入 `"en"`；跳回 `index.html` 语言状态保持一致
    （证明两页共享同一个 `www-lang` 记忆）。
  - 首次真机复测就抓到一个真 bug（已在 §7 描述的实现里改正）：`updates.js` 复用了
    落地页 section 用的 `updates.title` i18n key，导致独立页 H1 显示"更新内容"而不是
    "更新记录"，与 `<title>`/页脚文案对不上——拆成专属的 `updatesPage.*` key 后复测通过。
  - 测试用的 `docs/release-notes/2.1.51.json` 事后已删除，语言状态复测完手动清回 zh。

- **未做**：打包、真正跑一次完整发布（写正式版本的 canonical JSON + 真的同步官网 + 部署）。
