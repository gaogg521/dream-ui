# 上游对照与同步参考(前后端 + aionrs)

> **用途**:平台出问题、或想加/更新某个功能时,先来这里查「我们哪个仓对应上游哪个仓、当前同步到哪、去上游哪里找参考」。
> **最后更新**:2026-07-20(三仓已合主分支并推 origin:AionUi 内容≈v2.1.37 之后 5 提交(one-main `55757cee7`)/ AionCore v0.1.48 之后 9 提交(one-main `faebcbe5`)/ aionrs v0.2.6(master `b2b7bde`)。**同步原则本轮起改为默认信上游,只守图标 + 品牌文案两条红线**。详见 [`session-2026-07-20-truncation-fix-and-upstream-resync.zh-CN.md`](session-2026-07-20-truncation-fix-and-upstream-resync.zh-CN.md))。
>
> **⚠️ 2026-07-21 品牌名变更**:产品显示名与打包名统一改为 **「One Work」**(此前是「1One Work」显示 + 「1ONE Code」打包)。**品牌红线现在守的是「One Work」**(上游同步时把 AionUi 品牌串改成 "One Work",不是 "1One Work")。运行时身份/userData 目录仍钉在历史名 `1ONE Code`(见 `configureChromium.ts` 的 `PROD_USERDATA_APP_NAME`,防止老用户数据丢失),exe 仍是 `1onecode.exe`,appId 仍是 `com.huanle.oneone.ai`——这三个是内部标识,不随品牌名走。

---

## 1. 三仓 ↔ 上游映射

| 我们的仓(fork)                        | 角色                         | 上游仓库                                                          | 说明                                                                                                                                                            |
| ------------------------------------- | ---------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`1oneUI`**(`gaogg521/1oneUI`)       | 前端壳(Electron/TS)          | **[iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi)**       | UI / 助手 / Agent / 团队 / 设置 / i18n                                                                                                                          |
| **`1oneCore`**(`gaogg521/1oneCore`)   | 后端(Rust)                   | **[iOfficeAI/AionCore](https://github.com/iOfficeAI/AionCore)**   | 会话服务、agent 运行时、诊断、cron、MCP、ACP                                                                                                                    |
| **`aionrs-local`**(`gaogg521/aionrs`) | Agent 运行时 crate           | **[iOfficeAI/aionrs](https://github.com/iOfficeAI/aionrs)**       | 被 1oneCore 的 `Cargo.toml` 以 git 依赖引入(fork 的 **`master`** 分支;GitHub 默认分支若是 `main` 则是上游镜像,看同步结果请切 `master`)                          |
| **`OfficeCLI`**(`gaogg521/OfficeCLI`) | Office 文档 CLI(可选第 4 仓) | **[iOfficeAI/OfficeCLI](https://github.com/iOfficeAI/OfficeCLI)** | Word/Excel/PPT 读写自动化二进制;默认由 1oneCore `aionui-office` **运行时安装官方包**,不在三仓版本级联里。**本 fork 供私有补丁 / 将来本地集成**;有补丁前不必跟版 |

**同步方向铁律**:**只单向 上游 → fork**,不反向给上游提 PR。fork 前端保显示品牌 + 企业/团队等自有能力,内部同步上游最新。

本地路径:`D:\aionui-m0\{1oneUI, 1oneCore, aionrs-local, OfficeCLI}`。每个仓都配了 `upstream` remote 指向对应上游,可直接 `git fetch upstream`。

> **OfficeCLI 与三仓的区别**:AionUi/AionCore/aionrs 是产品本体、必须跟版对齐;OfficeCLI 是外部工具链。日常跑系统用官方安装器即可;要改源码、打私有补丁或改成指向本地/自建二进制时,再动本 fork,并在 1oneCore 的 `officecli` 解析路径上接过去。

---

## 2. 版本对照 & 当前同步状态

上游每次发版会同时 bump 前端版本 + 内置后端 aioncore 版本,对照关系:

| AionUi(前端)          | 内置 AionCore(后端) | 日期  |
| --------------------- | ------------------- | ----- |
| v2.1.30               | v0.1.43             | 07-06 |
| v2.1.31               | v0.1.44             | 07-08 |
| v2.1.32               | **v0.1.45**         | 07-10 |
| **v2.1.33**(上游最新) | v0.1.45             | 07-11 |

**我们当前状态(2026-07-12 核实):**

| 仓             | fork 当前(主分支)                                                | 已同步到上游   | 上游最新    | 落后           | 状态                                        |
| -------------- | ---------------------------------------------------------------- | -------------- | ----------- | -------------- | ------------------------------------------- |
| 1oneUI(前端)   | **2.1.37**(`one-main` `592349a`),`aioncoreVersion=v0.1.45-one.1` | **v2.1.32** ✅ | **v2.1.33** | **1 个小版本** | 内容已合主+出包;相对上游最新差 v2.1.33      |
| 1oneCore(后端) | **v0.1.45-one.1**(`one-main` `ce051338`)                         | **v0.1.45** ✅ | **v0.1.45** | 0              | **已对齐**(含 fork 自有 B1/B2/migration 等) |
| aionrs(运行时) | **0.2.2 + fork 补丁**(`master` `1ffc171`)                        | **v0.2.2** ✅  | **v0.2.2**  | 0              | **已对齐**(比上游多 3 专属补丁+测试修)      |

> ✅ **级联已自洽**:前端 `2.1.37` → 钉后端 `v0.1.45-one.1` → 拉 `gaogg521/aionrs` **`master`**(= v0.2.2 + 流式空参/thinking 阶梯/文本化兜底)。
> ⚠️ **唯一落后**:前端内容基线停在上游 **v2.1.32**;上游已发 **v2.1.33**(未同步)。fork 产品号 `2.1.37` 是自己的发版号,不是上游也有 2.1.37。
> 查看 tip:`1oneUI`/`1oneCore` 看 **`one-main`**;`aionrs` 看 **`master`**(不是 GitHub 默认的 `main`)。

### 级联依赖链(同步要从下往上)

上游三仓是有版本要求链的,**同步顺序应 aionrs → 1oneCore → 回填 1oneUI**:

```
前端 v2.1.32(+fork 2.1.37)  ──要求──▶  后端 v0.1.45-one.1  ──"adapt to aionrs v0.2.2"──▶  aionrs v0.2.2(+补丁)
```

本轮(2026-07-11)已按此顺序合主并推 origin + 出 2.1.37 包。细节见 [`session-2026-07-11-upstream-sync-v2132-handoff.zh-CN.md`](session-2026-07-11-upstream-sync-v2132-handoff.zh-CN.md)。

- **aionrs 同步结果**(旧 0.1.38 上 5 补丁在 v0.2.2 上的命运):

  | fork 补丁                                    | 上游对应           | 最终处理                                  |
  | -------------------------------------------- | ------------------ | ----------------------------------------- |
  | `107417b` 默认启用 thinking                  | = #203             | **弃用**,取上游                           |
  | `32b2fbe` 只显式声明 thinking + 多级回传重试 | **= 上游 PR #203** | 声明取上游;**阶梯部分重贴**(正交基础设施) |
  | `3d6aceb` golden snapshot                    | 测试快照           | **弃用**                                  |
  | `90d2e4e` 流式 tool_call 空参                | 上游**无**         | ✅ **已重贴**(`3f7b9b5`)                  |
  | `1f36350` 文本化工具历史                     | 上游**无**         | ✅ **已重贴**(`ea45450`,命脉)             |

- **1oneCore 怎么引 aionrs**:`Cargo.toml` 的 `aion-*` 全部 `{ git = "gaogg521/aionrs", branch = "master" }`。所以看 aionrs 同步结果必须看 **`master`**,不是 `main`。

---

## 3. 已到手的后端配套能力(原「待同步」,现已在 one-main)

后端 v0.1.43 → v0.1.45 里与前端 v2.1.32 配套的关键项,**现已随 sync-v0145 合入**:

- **v0.1.44 #585 `system: add feedback diagnostics report`** → 前端 #3529 诊断端点 `GET /api/system/diagnostics/feedback-report`(不再静默降级)。
- **v0.1.45** `adapt to aionrs v0.2.2 config` / `update Claude·Codex ACP package`(配前端 #3557)/ `add agent-facing config and diagnose commands` / `stop defaulting aionrs max tokens`。
- **v0.1.43** `#576 cron 强制全自动模式`、`#578 按已安装 agent 过滤生成型助手`。

下一轮前端若跟 **v2.1.33**,先对照上游 release notes 看是否还要求更新后端/aionrs。

---

## 4. 出问题 / 想加功能时,去上游哪里找参考

1. **先判断是前端还是后端问题**:UI/助手/Agent/团队/设置/i18n → 上游 **AionUi**;会话运行时/诊断/cron/MCP/ACP/模型请求 → 上游 **AionCore**;Agent 协议/thinking/tool_calls → 上游 **aionrs**。
2. **查上游改动**:
   - Release notes / 变更点:AionUi `…/releases`、AionCore `…/tags`(每个 tag 的 commit message 里有 changelog)。
   - 某个功能/修复的 PR:在上游仓 `…/pull/<n>` 或 `git log upstream/main --grep '关键词'`。
3. **把上游改动落进 fork**:见下方同步套路。找到对应 PR/commit 后,可 `git cherry-pick` 单点,或整段 `git merge upstream/<branch>`。
4. **对照本地已同步到哪**:`git merge-base one-main <上游tag>` + `git describe --tags` 看上次同步点;`git rev-list --count one-main..<上游tag>` 看落后多少。

---

## 5. 同步套路(前端已验证,后端同理)

在**隔离分支**上操作,别直接在 one-main 合:

```bash
git fetch upstream
git checkout -b sync-<ver> one-main
git merge upstream/main          # 或 merge 到某个 tag
# 解冲突 → tsc / cargo build → 测试 → 合回 one-main → bump → 打包
```

### 解冲突的固定决策(fork 不变量,务必遵守)

- **品牌**:`package.json` / `readme` 保 **One Work**(打包/exe/appId/userData 仍钉 `1ONE Code`,见文首红线说明);i18n locales 里凡上游带进 `AionUi` 的一律批量 `AionUi → One Work`(fork 基线为 0)。**内部标识符 / `AionCore` / `github.com/iOfficeAI/...` 文档 URL 不动。** 品牌不必在解冲突时逐处纠结,**合并完成后统一批量刷,且必须走下方「⚠️ 品牌复检铁律」,不能只查 i18n locales。**
- **后端版本钉**:前端 `aioncoreVersion` 保 fork 自己的 `vX.Y.Z-one.N` tag,**绝不取上游裸版本号**(fork 后端仓没有那个 tag)。
- **设置信息架构(IA)**:`Router` / `SettingsSider` / `SettingsPageWrapper` / `SkillsHubSettings` 保 **fork 版(`--ours`)**——fork 把 skills/tools 合并成 `capabilities` 页 + 加了 `enterprise` 企业 tab,上游是拆分改版,**整吃上游会冲掉企业设置和团队技能 UI**。
- **aioncore 后端依赖**:`Cargo.toml` 保 fork 的 `one-*` crates 与 aionrs fork 依赖。

### 两个已踩过的坑

- **上游删文件 → fork 悬空引用**:上游设置改版**删了** `CapabilitiesSettings.tsx` / `ApiKeyEditorModal.tsx`,auto-merge 静默删除,而 fork(--ours)仍引用它们 → `tsc` 报 `TS2307`。修法:`git checkout one-main -- <被删文件>` 恢复。**凡对深改文件取 `--ours`,合并后必跑全量编译 + 测试,抓上游删除引发的悬空。**
- **auto-merge 带上游测试 → 测试/实现错配**:保留 fork 实现(--ours)但测试被 auto-merge 换成上游版 → 大批测试失败。修法:同步恢复 fork 版测试(`git checkout one-main -- <test>`)。判定「存量失败 vs 本次引入」:`git diff --quiet one-main HEAD -- <test>`(是否被合并改过)+ 切 one-main 实跑对比。

### aionrs 授权默认全自动(fork 有意设计,别被上游改回)

前端 `useGuidAssistantSelection` 的 `pickFullAutoMode` 让新会话优先选**全自动模式(aionrs = `yolo`)**;后端 `aionui-conversation/src/service.rs` 的 `resolve_assistant_snapshot` 也有 `session_mode` 默认 `yolo` 的兜底。上游测试期望 catalog 的 `default`——同步时这类断言要跟随 fork 改成 `yolo`。

### 同步验收标准:保护现有功能的质量门禁

**不能因为同步上游的新补丁就破坏现有项目。** 每次同步上游版本必须满足以下条件:

1. **对标现有功能清单**
   - 对照上游 release notes,明确列举本轮合进的新能力 + 修复项
   - 对标 fork 已有的企业/团队/技能等自有特性,确认无冲突或依赖问题
   - 若新能力与现有功能有交集,需逐项排查兼容性

2. **强制完整测试**
   - ✅ **冒烟测试**(快速通路):登录 → 新建会话 → 发消息 → 切语言/主题 → 企业管理/团队 → 注退出
   - ✅ **定向深测**:上游新增或改动的模块必测(无论代码改动多小)
   - ✅ **存量回归测试**:fork 的自有能力(策略分发、用户管理、技能调用、cron 等)必跑 e2e,不能只看单测
   - 不能仅依赖 tsc / clippy / 单测通过 → 单测不能覆盖运行时 bug

3. **三仓级联验证**(若涉及后端同步)
   - aionrs → 1oneCore → 1oneUI,按顺序各自完整测试
   - 确认版本级联无断层(如前端依赖的后端 API 确实存在)

4. **拒收门禁**
   - 同步产生 **tsc 编译错误** → 拒收(不是警告)
   - 同步产生 **新增失败的 vitest / cargo test** → 拒收(已有的存量失败可接受)
   - 同步的代码在 **本地 dev 环境运行异常**(卡死/白屏/404/500) → 拒收
   - **企业/团队/策略相关流程崩坏** → 绝对拒收
   - **上游补丁与 fork 自有补丁冲突,合并结果被破坏** → 需评估是否保留 fork 补丁

5. **⚠️ 品牌复检铁律(哪怕上面 1-4 全过,这一步不能省)**

   **背景(2026-07-24 真实翻车案例)**:用户真机安装报错弹窗,正文里全是「AionUi 安装失败」「请重新安装 AionUi」——品牌显示名早改成了「One Work」,但 NSIS 自定义安装器脚本(`resources/windows/*.nsh`、`resources/windows/support/*.ps1`)里的错误文案是**手写字符串硬编码**,不在 i18n locales 里,之前几轮"合并完成后统一批量刷"**只刷了 i18n locales**,完全没扫到这批文件,漏了 47+ 处用户可见文案。**教训:批量刷品牌绝不能只看 i18n,必须按下面清单逐类过一遍。**

   **每次「功能验证全部通过」之后,必须再单独跑一轮全仓品牌名扫描,覆盖以下类别(缺一不可)**:
   - i18n locales(`packages/desktop/src/renderer/services/i18n/locales/**`)
   - **NSIS/PowerShell 安装器脚本**(`resources/windows/**/*.nsh`、`resources/windows/**/*.ps1`)——这类最容易漏,因为不走 i18n、不走 tsc、不走常规测试
   - 渲染层硬编码字符串(不该有,但要防上游带新的进来):`grep -rn "AionUi" packages/desktop/src/renderer --include=*.tsx`,排查每条命中是 JSX 渲染文本还是注释/版权头
   - 冒烟测试 / 自动化脚本里对用户可见文案的断言(`scripts/*.js`、`tests/**`)——**改了产品文案必须同步改断言字符串,否则测试会跟着错(继续断言旧品牌名反而是绿的)**
   - 外链:`grep -rn "iOfficeAI/AionUi\|iOfficeAI/AionCore" packages/desktop/src` —— 这些是指向**上游开源项目** GitHub wiki/discussions/issues 的文档链接和"发送安装失败报告"里的 issue 链接,不是我们自己的仓库。是否保留取决于该链接指向的文档内容是否与 fork 一致;**若是"发生错误后引导用户去 GitHub 提 issue/联系团队"这类支持渠道链接,必须提给用户确认**,不能默认这是我们自己的支持入口。

   **判定"要不要改"的分类原则(避免误伤)**:
   - ✅ 要改:用户会读到的完整句子/短语里提到品牌名(错误提示、按钮文案、对话框标题、UI 标题)
   - ❌ 不要碰:内部标识符/变量名/宏名(如 `AIONUI_MSG_*`、`$AionUiSessionLogPath`、C# 命名空间 `AionUi.RestartManager`)、注册表键、`.exe` 文件名、`appId`、userData 目录名——这些是历史遗留的内部标识,改了会破坏卸载/更新/数据迁移,历史上专门有 `app.setName` 钉死过,见文首红线说明
   - ❌ 不要碰:源码文件头的 `Copyright 2025 AionUi (aionui.com)` 版权声明——这是 Apache-2.0 上游项目的版权归属,不是我们的产品品牌文案,私自改会有许可证合规问题

   **执行方式**:优先派一个只读的 Explore/general-purpose 子agent 做全仓扫描并分类汇报,不要在主对话里一个个 grep,省 token。

**执行时机**: 合回 one-main 之前。不能先合再修补。如发现问题,应在 sync 分支上修复或回滚,再合回。品牌复检(上面第 5 项)在功能验证通过后单独执行,可以和其他门禁并行准备,但**必须在本轮同步收尾前跑完,不能拖到"下一轮再说"**。

---

## 6. 相关文档

- **三仓合主 + 2.1.37 发布交接**:[`session-2026-07-11-upstream-sync-v2132-handoff.zh-CN.md`](session-2026-07-11-upstream-sync-v2132-handoff.zh-CN.md)
- 网关/thinking 主文档:[`session-2026-07-10-thinking-param-and-rename.zh-CN.md`](session-2026-07-10-thinking-param-and-rename.zh-CN.md)
- 前后端加载约定(改完重编哪个才生效):[`ai-handoff-conventions.zh-CN.md`](ai-handoff-conventions.zh-CN.md)
- Fork 上手 / dev / 打包:[`fork-dev-onboarding.zh-CN.md`](fork-dev-onboarding.zh-CN.md)
