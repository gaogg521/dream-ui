# 上游同步 v2.1.32 + 三仓同步作战计划(交接文档)

> **2026-07-11 会话交接**。接手的 AI **先读这份**,再按需读 [`upstream-sync-reference.zh-CN.md`](upstream-sync-reference.zh-CN.md)(三仓版本对照/映射的常驻参考)。
> **本文自包含**:现状、已做、待办、路线、aionrs 施工图、铁律、命令路径全在这。
> **核心约束**:任何功能改动都要在**桌面端 `bun run dev` 真实 UI 亲测通过**才算完(用户明确);不急提交/打包。

---

## ★★★ 正式发布已执行:三仓合主分支+推 origin+出 2.1.37 包(2026-07-11 深夜,最新)

**用户点头后已执行破坏性发布连锁,三仓全部合主分支并推 GitHub:**

| 仓       | 分支操作                                                       | origin 结果                                            |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| aionrs   | `sync-v022` → **master**(reset --hard,新线替换 5 个废弃旧补丁) | **force-push** `1f36350...1ffc171`(--force-with-lease) |
| 1oneCore | `sync-v0145` → **one-main**(fast-forward)+ Cargo.lock 修复     | push `89d7abe9..ce051338`                              |
| 1oneUI   | `sync-2132` → **one-main**(fast-forward)+ bump 2.1.37          | push `3242fae..7674ba0`                                |

- **aionrs force-push 说明**:master 上 5 个旧补丁(`1f36350`/`32b2fbe`/`90d2e4e` 已被 v0.2.2 上重贴的 `ea45450`/`81a1d06`/`3f7b9b5` 取代;`3d6aceb`/`107417b` 按计划弃用取上游 #203),无价值丢失。1oneCore 的 `aion-* = {git=gaogg521/aionrs, branch=master}` 现拉到 v0.2.2+补丁。
- **Cargo.lock 遗留修复(`ce051338`)**:上一轮 [patch] 构建后删 patch 未重解析,把 6 个 aion-\*+传递依赖(共 12)误留成本地 path 依赖(不可复现)。用**外科手术式最小重解析**改回 git master 源:`git checkout -- Cargo.lock` 恢复上游 pin → `cargo build`(非 generate-lockfile,后者会 bump 125 个包)→ diff **正好 12 行 source**,上游 v0.1.45 传递 pin 全保留。
- **后端 exe + bundling**:从 git 源重编 `aioncore.exe`(0.1.45-one.1,`Finished 3m07s`),空库全链 001-023 复验到达 LISTENING(migration 嵌入正确)。`AIONUI_BACKEND_LOCAL_PATH=<target/release/aioncore.exe> node scripts/prepareAioncore.js` 产出 `resources/bundled-aioncore/win32-x64`(exe cmp 同一 + v0.1.45 managed-resources:node24.11/codex-acp1.1.2/claude-agent-acp0.58.1 + manifest)。**bundled 是 gitignore,不提交**。
- **前端出包**:`AIONUI_BACKEND_LOCAL_PATH=... bun run dist:win`(其内部 prepareAioncore 认这个 env → 用本地 exe **不去 GitHub 下不存在的 release**)。打包脚本 `cleanupWindowsPackOutput` 只清 win-unpacked、**不删旧 .exe**(out/ 里 2.1.32/33/35/36 保留)。产物 `out/1ONE Code-2.1.37-win-x64.exe`(或对应 productName)。
- **推送门禁取舍**:前端 `just push` 全量测试会被 3 个**存量** vitest 失败(useConversationAssistants×2/useDetectedAgents×1)误挡;新提交纯文档+版本号、tsc 0、sync-2132 早已回归验证 → 直接 `git push`。1oneCore 无 justfile,lock-only 改动构建已验证 → 直接 push。
- **发布连锁正确顺序(以后照做)**:①aionrs 合 master force-push(1oneCore pin master 才拉到新 aionrs)→ ②1oneCore 合 one-main + `cargo build` 修 lock 到 git 源 + 重编 exe → ③前端 prepareAioncore 用 LOCAL_PATH 填 bundled → 前端合 one-main + bump + dist:win。级联依赖决定必须自下而上。

**⚠️ 首次 dist:win 失败并已修(打包坑,必记)**:第一次 `dist:win` 在 NSIS 组装阶段中止,只产出 460KB 残次 stub(正常 ~291MB)+ 342MB `.nsis.7z`(payload 未嵌)。真因:`resources/windows/installer-update-verify.nsh:170` 的 `File` 指令要把 `resources/windows/support/verify-bundled-aioncore-install.ps1` 打进安装器,但**该 PS1 在仓库缺失**——它随上游 #3523(`441f57f`)引入,同步合并时**引用方 `.nsh` 进来了、被引用的 `.ps1` 漏合并**(HEAD 树无)。报错:`File: "...verify-bundled-aioncore-install.ps1" -> no files found` → `Error in macro AIONUI_VERIFY_BUNDLED_AIONCORE_RESOURCES` → aborting。修复:`git show 441f57f:resources/windows/support/verify-bundled-aioncore-install.ps1 > <路径>` 恢复(7663 字节),commit `38fe9db` 推 origin,重跑 dist:win。**教训:上游合并后凡 NSIS `.nsh` 里有 `File "...support\\*.ps1"` 引用,必须核对被引用文件真在工作树。**

**⚠️ 2.1.37 安装器运行时报 E1010「无法正确解压应用文件」并已修(打包坑#2,必记,2026-07-12)**:2.1.37 安装包能生成、体积正常(payload 完整),但**运行安装器时**弹 `AionUi 安装失败 (E1010)` / `extract result=fail method=7z missing=AionUi.exe`。真因**不是**真的没解压,而是解压后的**校验步骤在找错名字的 exe**:上游安装器硬化(#3523)的一整套 `resources/windows/*.nsh` 里,应用主 exe 名沿用了上游产品名 `AionUi.exe`,而 fork 的 `electron-builder.yml` `executableName: 1onecode` → 实际产物是 `1onecode.exe`。解压其实成功了(`1onecode.exe` 已就位),但 `AIONUI_LOG_EXTRACT_RESULT`(`installer-observability.nsh`)去找 `$INSTDIR\AionUi.exe` 找不到 → 误报 E1010。**波及 6 处出荷校验**(都经/绕单一 define `AIONUI_APP_EXECUTABLE_FILENAME`):解压校验(observability)、核心文件校验(update-verify:156)、运行中进程探测(update-verify:28/33)、修复自愈 exe 路径(repair-heal:130)、占用者已知文件(process-control:109)。修复:把**唯一 fork define** `AIONUI_APP_EXECUTABLE_FILENAME` 从 `AionUi.exe` 改成 `1onecode.exe`,并把当初**绕过 define 直接写字面量**的解压/核心校验两处宏改成走这个 define——一处改值,6 处校验同时正确。附带修 fork 自有工具里同样的旧产品名:`support/query-lockers.ps1`(占用探测)、`scripts/packaged-launch.mjs`(打包后起动 smoke,原来找 `AionUi.exe` 直接 `No unpacked app found`)、`scripts/build-with-builder.js`(重编前杀进程+失败重试路径)、`scripts/dev-bootstrap.mjs`(dev 清进程)。**教训:上游合并凡带「产品 exe 名」的资源(NSIS 校验/PS 脚本/打包 JS),必须比对 fork 的 `executableName` 改名——`git grep -n 'AionUi\.exe'` 兜底扫一遍。**`scripts/smoke-installer-*.js` 是自带 define 的独立模拟测试(不 include 真实 nsh),故意不动。**改后需重打包才生效**(用户手上那个 2.1.37 仍是旧 nsh)。

**⚠️ 修完 E1010 后 2.1.38 又报 E1030「内置 AionCore 资源不完整」并已修(打包坑#3,必记,2026-07-12)**:exe 名修好后安装推进到解压+核心校验都过,却在 `verify-bundled-aioncore-install.ps1`(#3523 引入、当初从 `441f57f` 恢复)这步返回 1 → `bundled-aioncore-incomplete result=1`。读安装日志 `%TEMP%\aionui-installer-<ver>-*-log.jsonl` 里的 `failures` 明细,精确定位:唯一失败是 `codex-acp/.../node_modules/@zed-industries/codex-acp-win32-x64/bin/codex-acp.exe` `missing_file`(claude/node 全过)。真因:**这个 PS1 是旧版**,校验的是 codex-acp **旧布局** `@zed-industries/codex-acp-*/bin/codex-acp.exe`;而 v0.1.45 内置的 codex-acp **1.1.2 已重构**成 `@agentclientprotocol/codex-acp`(JS 入口,manifest 已声明)+ `@openai/codex-win32-x64/vendor/<triple>/bin/codex.exe`(原生二进制)。上游在 **v2.1.33 之后**才于 `main` 用 **`943a0fe21 fix(build): align Codex installer verifier (#3561)`** 修(v2.1.32/33 tag 都没有,=上游自己 v2.1.32/33 装 codex-acp 1.1.2 也会挂,属上游未发布修复)。修复:`git show upstream/main:.../verify-bundled-aioncore-install.ps1 > <文件>` 整吃上游版(新增 `Get-CodexPlatformExecutable`:win32-x64→x86_64-pc-windows-msvc、arm64→aarch64,param/exit 接口不变),并落地 #3561 配套回归测试 `tests/unit/assets/verifyBundledAioncoreInstallScript.test.ts`(自包含读串断言,已过)。**验证不用重打包也能做**:PS1 是安装时从 installer 释放到 PLUGINSDIR 跑的,直接 `powershell -File <新PS1> -InstallDir <目录> -RuntimeKey win32-x64 -LogPath <tmp>`,对**干净源 bundle**(仓库根:`-InstallDir D:\aionui-m0\1oneUI`)跑得到 `result=ok / exit 0`=修复有效。

**⚠️ 混版陷阱(升级场景,别被误导)**:对**已安装目录**跑上面校验仍报 E1030,但换成 `0.16.0` 版!因为该目录里 codex-acp 有**两个版本目录**:旧 `0.16.0`(旧安装残留,`@zed-industries` 布局)+ 新 `1.1.2`(本次装入,`@openai` 布局)。PS1 会**遍历 codex-acp/ 下所有版本目录**套同一期待路径,故旧版 PS1 只认 0.16.0、新版只认 1.1.2,**混版时哪个 PS1 都过不了**。根因=多次 abort 安装(2.1.37 E1010 / 2.1.38 E1030 都在 verify 阶段中止)累积的脏目录;安装器本有 `installer-remove-registry.nsh` 的 atomic cleanup 会清旧安装,正常一次装成不会累积。**给用户的动作:装前先卸载/删掉 `%LOCALAPPDATA%\Programs\1onecode` 整个目录再装干净**,只留当前版本 → 必过。

**待验证**:①用 **2.1.39** 重打包(把修好的 PS1 编进 installer;`AIONUI_SKIP_AIONCORE_PREPARE=1 bun run dist:win` 复用既存 v0.1.45-one.1 bundle,不删旧 .exe)②**清掉旧安装目录后**跑新安装器,确认 E1010/E1030 均不再出现、装到 `%LOCALAPPDATA%\Programs\1onecode`。旧包(2.1.32/33/35/36/37/38)保留。

---

## ★★ 收尾复验:重编后端全栈 dev 活测通过(2026-07-11 深夜续,先读)

**结论:重编后的 v0.1.45-one.1 后端(含 sync-v0145 + 经 [patch] 引入 sync-v022 aionrs)在真实存量库上 dev 活测全过,migration 方向修复 `6e0dfbe5` 三重坐实。破坏性正式发布仍待用户点头,但代码侧已无未验证项。**

**⚠️ 抓到一个重编大坑(以后重排 migration 后必须照做)**:`6e0dfbe5` 是**纯文件改名**(git `{旧=>新}`,0 增删)。改名不改文件内容 mtime,磁盘上这些 `.sql` 的 mtime 仍早于上次构建 → `sqlx::migrate!()` 的 rerun-if-changed **检测不到**,`cargo build` 死活不重编(exe 停在错序旧版),连 `cargo clean -p aionui-db` 都没强制成功。**正解:`touch crates/aionui-db/migrations/*.sql crates/aionui-db/src/database.rs` 把 mtime 推到现在,再 `cargo build --release -p aionui-app --bin aioncore`**,才会重跑宏、按当前(正确)文件名重嵌。验证 exe 真更新:`cmp` 新旧二进制 + `stat` mtime,别只看 "Finished"(增量会假成功)。

**migration 修复三重验证**:①**校验和比对**——磁盘 019-023(修复后)SHA-384 与存量库 `_sqlx_migrations` 存的 23 条**全 MATCH**(修复后 fork 019/020/021 + 上游 022/023 与库对齐);②**真实存量库运行时**——electron dev 起新后端,`Database initialized` 通过、无 "previously applied but modified"、无 panic,所有 API 200;③**空库全链**——独立 exe 跑空 data-dir,001-023 全 applied 到达 `AIONCORE_LISTENING`。若还是错序 exe,②会在 version 19 校验崩。

**测试假象备忘**(别误读):删 `_sqlx_migrations` 的 22/23 记录行但不撤数据效果,重跑 022 会报 `duplicate column name: default_thought_level_mode`——因 022 是非幂等 `ADD COLUMN`。**真实 v0.1.42 存量库从没跑过 022、无此列,增量升级不会遇到**;sqlx 保证每 version 只跑一次。忠实增量证明改由"空库全链"覆盖(022 的 ADD COLUMN 起点 schema 与真实增量升级相同)。

**env 活测机制坐实可用**:`AIONUI_BACKEND_BUNDLED_DIR=D:\aionui-m0\bundled-aioncore-synctest` → dev 从该目录 spawn 新 `aioncore.exe`(binaryResolver.ts:101 优先级1),**resources/bundled-aioncore 旧 v0.1.42 exe 完全没碰**。后端端口动态(本轮 54496),CDP 9230。该 synctest bundled 目录+DB 备份已留在会话 scratchpad 供继续活测。构建用的临时 `[patch]` **测完已从 Cargo.toml 撤净**(`git checkout -- Cargo.toml Cargo.lock`),1oneCore 回到 `6e0dfbe5` 干净态。

**全栈端到端**:新后端驱动下前端 sync-2132 全部渲染正常——品牌 1One Work、渐变广告语、侧边栏"团队作战"上移、语言快切、model 选择器、1ONE CLI/Excel pills;console 仅 2 条无害 warning(CSP dev / googleAuth stub)。**B1 派活**上轮已活测且本 build 含 `0419e1f4`;**aionrs 阶梯**源码自上轮验证起未变(1ffc171,重编仅重链,行为一致);**B2 拆解**有 one-devops 单测覆盖,活测需特定畸形 LLM 响应不实际。

---

## ★ 全天最终进展汇总(2026-07-11,新 AI 先读这节)

**三仓上游同步全部代码完成**,均在隔离分支、已推 origin、**master/one-main 未动**(破坏性正式发布待用户点头):

- 前端 `1oneUI:sync-2132`、aionrs `sync-v022`(v0.1.38→v0.2.2)、后端 `1oneCore:sync-v0145`(v0.1.42→v0.1.45)。

**前端 sync-2132 关键提交**(领先 one-main):v2.1.32 合并(`2aa06d9`)+ 白屏修复 `bb681b0`(团队缺 slot_work)+ i18n `b9990fd`(Agent 页签 {{count}})+ P1 `94316c8`(httpBridge 超时)+ 品牌 `ef0d733`(1ONE Code→1One Work)+ 广告语渐变艺术字/呼吸动画/自适应字号(`769ccea`/`92b066a`/`5663d3e`)+ 侧边栏拖拽缩放 `273ae83` + UI 优化五项 `92b066a`(团队上移+改名团队作战+i18n 回退修复+语言快切按钮)+ 测试修复 `29d5f2e` + index.html 品牌补齐。

**后端 sync-v0145**:v0.1.45 合并 `53ca9f4e` + B1/B2 `0419e1f4`(派活竞态/拆解切片)+ migration 重编号 `6e0dfbe5`(dev 亲测抓到的会炸存量库的严重 bug:sqlx 已应用 version 号+内容不可改,新来的往后排)。

**aionrs sync-v022**:v0.2.2 基线 + 3 补丁(`3f7b9b5` 流式空参 / `81a1d06` thinking 阶梯 / `ea45450` 文本化兜底 = 命脉)+ `1ffc171` 测试修复。关键认知:上游 #203 只改 thinking 声明(v0.2.2 已含),fork 4 级重试阶梯是正交专属基础设施必须保留。

**品牌规则**:显示品牌 `1ONE Code`→`1One Work` 全刷;内部标识(`1one-claudecode`/`1one-Dev`/`logos/brand/1one.png`/URL)**故意保留**不碰;内置 Agent 名「1ONE CLI」未动(独立 token,在后端 migration 019)。

**反馈提交去向** = Sentry(`SENTRY_DSN`),**非 GitHub**;诊断来自后端 `/api/system/diagnostics/feedback-report`(#585)。

**验证状态**:三仓 tsc/cargo 0 error、check-i18n 过、后端 one-devops 23 测试绿;前端全量 vitest 仅剩 **3 存量失败**(useConversationAssistants×2/useDetectedAgents×1,one-main 就红)。dev 用环境变量 `AIONUI_BACKEND_BUNDLED_DIR` 指向重编后端可本地活测(不碰旧 exe),已验证协作看板派活跑通 aionrs v0.2.2 阶梯。

**待办**:①正式发布连锁(aionrs 合 master+force-push → 后端重编 aioncore.exe 搬 bundled+回填版本 → 前端合 one-main+bump+dist:win)②3 存量测试(低优)③可选:反馈转 GitHub Issue / 「1ONE CLI」改名。**完整细节见记忆 `upstream-sync-checkpoint`(`~/.claude/projects/D--aionui-m0/memory/`)。**

---

## 0. 三仓与上游映射(先建立坐标系)

| 我们的仓(本地)              | 角色               | 上游                                                        | fork remote                                          |
| --------------------------- | ------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| `D:\aionui-m0\1oneUI`       | 前端 Electron/TS   | [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi)     | origin=gaogg521/1oneUI, upstream=AionUi              |
| `D:\aionui-m0\1oneCore`     | 后端 Rust          | [iOfficeAI/AionCore](https://github.com/iOfficeAI/AionCore) | origin=gaogg521/1oneCore, upstream=AionCore          |
| `D:\aionui-m0\aionrs-local` | Agent 运行时 crate | [iOfficeAI/aionrs](https://github.com/iOfficeAI/aionrs)     | origin=gaogg521/aionrs（本会话刚加 upstream remote） |

- **同步方向铁律**:只单向 上游→fork,不反向提 PR。fork 保 **1ONE Code** 品牌 + 企业/团队自有能力。
- `D:\1one-command` = **老架构**,仅作参考,**别在里面改代码**。
- 运行命令:前端 `bun run dev`(**不是** `npm run restart`,那是老架构的);首次先 `bun install`。

---

## 1. 三仓同步全景(本会话查实)

| 层            | fork 当前       | 已同步到上游   | 上游最新                   | 落后                           | 状态                                                 |
| ------------- | --------------- | -------------- | -------------------------- | ------------------------------ | ---------------------------------------------------- |
| 前端 1oneUI   | 2.1.36          | **v2.1.32** ✅ | v2.1.32                    | 0                              | 本会话已同步(分支 `sync-2132`,未合 one-main、未打包) |
| 后端 1oneCore | v0.1.42-one.1   | v0.1.42 (#569) | v0.1.45                    | **31 commit / 3 版本**         | ⚠️ 未同步                                            |
| aionrs        | 0.1.38 + 5 补丁 | v0.1.38        | **v0.2.2**(=upstream/main) | **55 commit,含 v0.2.0 破坏性** | ⚠️ 未同步,最难                                       |

**级联依赖链(同步要从下往上)**:前端 v2.1.32 ──要求──▶ 后端 v0.1.45 ──"adapt to aionrs v0.2.2"──▶ aionrs v0.2.2。
现在三层是**自洽的旧基线,能正常跑**;"落后"只是拿不到上游新功能/修复,依赖后端的前端新功能会**静默降级**。

---

## 2. 本会话已完成:前端 v2.1.32 同步(分支 `sync-2132`)

**3 个提交(在 `D:\aionui-m0\1oneUI` 的 `sync-2132` 分支,未合 one-main、未 push、未打包):**

- `2aa06d9` chore(sync): 合并 upstream/main(=v2.1.32 `0a903d8`,27 commit,上次同步点 #3515,24 冲突)
- `daf3b00` test(skills): 恢复 fork 版 SkillsHubSettings 测试
- `43b3903` test(guid): aionrs 默认全自动 yolo 对齐 fork 设计

**24 个冲突的处置决策(务必理解,别下轮推翻):**

- **品牌**:`package.json`/`readme` 保 1ONE Code;locales 全量 `AionUi→1ONE Code`(40 文件,fork 基线本为 0);上游文档 URL `github.com/iOfficeAI/...` 不动。
- **后端版本钉**:`aioncoreVersion` 保 fork `v0.1.42-one.1`(**上游 v0.1.45 tag 不在 fork 后端仓,硬取会 break**)。
- **设置信息架构(IA)**:`Router.tsx` / `SettingsSider.tsx` / `SettingsPageWrapper.tsx` / `SkillsHubSettings.tsx` 取 **fork 版(`--ours`)**——fork 把 skills/tools 合并成 `capabilities` 页 + 有 `enterprise` 企业 tab,**放弃上游 #3520 拆分改版**(整吃会冲掉企业设置 + 团队技能 UI)。
- **坑(已踩已修)**:上游改版**删了** `CapabilitiesSettings.tsx` / `components/ApiKeyEditorModal.tsx`,auto-merge 静默删除 → fork(--ours)悬空引用 → `tsc TS2307`。修法:`git checkout one-main -- <被删文件>` 恢复(已做)。
- **GuidPage.tsx**:只取上游 slash 菜单 import(#3524)。
- **ru-RU**:采上游俄语翻译 + 回贴 1ONE Code。

**验证结果:**

- `npx tsc --noEmit` = **0 error**
- `node scripts/check-i18n.js` = 通过(type 定义 in sync;435 warning 是 fork superAssistant 动态 key,合并前就有)
- 全量 `npx vitest run` = **2202 passed / 3 failed / 3 skipped**。3 个失败(`useConversationAssistants`×2 / `useDetectedAgents`×1)**已切 one-main 实跑证明=合并前就红的存量失败**,与本次无关(已开独立任务处理)。新功能定向 10 文件/63 用例全绿。

---

## 3. 待办总清单

### 3A. 本轮上游 v2.1.32 已到手、待 UI 实测的能力

| 模块     | 能力                                                                                      | 依赖后端?                  |
| -------- | ----------------------------------------------------------------------------------------- | -------------------------- |
| 团队     | 手动加成员 + 指定 leader(#3532)                                                           | 否                         |
| 会话     | 发送草稿箱(排队消息三态)(#3547)                                                           | 否                         |
| Agent    | 两级模型选择器 Model/Reasoning(#3550)                                                     | 否                         |
| 首页     | slash `/` 命令菜单(#3524)、移动端输入折进"+"(#3554)                                       | 否                         |
| i18n     | 法语 fr-FR(#2731)                                                                         | 否                         |
| 助手     | 助手编辑器/设置打磨(#3528,部分)                                                           | 否                         |
| Bug 修复 | OpenAI apiKey 参数名错、Skills tooltip 崩溃、助手 pill 窄屏、Windows 安装器硬化、俄语补全 | 否                         |
| 反馈诊断 | 提交反馈附后端诊断(#3529)                                                                 | ⚠️ 是(要后端 v0.1.44 #585) |

**主动放弃**:上游 #3520 设置改版(拆分 skills/tools)——保 fork IA,非漏做。

### 3B. 品牌收尾(合并后批量,用户已授权此节奏)

locales 已全刷。**源码里还剩 ~5 处用户可见串**要改 `AionUi→1ONE Code`:`FeedbackReportModal.tsx`(反馈提示语)、`ChannelModalContent.tsx`(各渠道 `t()` defaultValue)、`OfficialAssistantsGrid.tsx`("Maintained by AionUi")。**排除**:所有 `github.com/iOfficeAI/AionUi/...` 文档 URL(改了断链)。改完跑一下会断言品牌的测试。

### 3C. 三仓同步(本会话新查明,最大块)—— 见 §5、§6

后端 1oneCore → v0.1.45;aionrs → v0.2.2。

### 3D. 我们自有待办(从 `1one-command/docs/tech/v2-audit-and-open-items.md` + `1oneUI/docs/guides/STATUS-AND-TODO-2026-07-09.zh-CN.md` 捞全)

**🟠 真实 bug(后端 Rust,值得修):**

- **B1** `one-devops/src/routes.rs` `dispatch_core`+`maybe_autopilot` 派活状态门 **TOCTOU 竞态** → 重复派活浪费额度。修:条件 UPDATE 抢占 `... SET status='developing' WHERE id=? AND status IN('backlog','planning')`,`rows_affected==1` 才跑。
- **B2** `one-devops/src/breakdown.rs:94` `extract_json_array` 贪婪切片 `find('[')..rfind(']')` → 偶发"拆解失败"假报错。
- **P1** `1oneUI` `httpBridge.ts` **无客户端请求超时**(0 命中 `AbortSignal`)→ 服务端挂起时前端永久转圈(老坑重演)。给长请求配宽松超时(对齐后端 5 分钟 idle)。

**🔵 收尾(低优,无阻塞):** 邀请码速率限制(D4 熵已 2^64);M1b teams 三级 scope(`personal/team/organization`,现全 `org` 够用)。

**🅿️ 用户已暂缓/环境卡住(非漏做):** 钉钉/企业微信 SSO(等真实凭据);C 组跨用户活体 E2E(卡 D5 多用户环境);A4 价值流域、A1 L3 tenant backfill、A2 RAG 三增强(需求驱动/可选)。

> 注:企业「策略下发」端到端(F1-F4 + D1-D7)在 07-09 已全部完成并 E2E 实测,不在待办。

### 3E. 存量失败测试(独立任务)

`useConversationAssistants`×2 / `useDetectedAgents`×1,one-main 上就红。根因:`useConversationAssistants` 测试 fixture 的 aionrs 助手缺 `agent:{type:'aionrs'}` 字段,过不了 `isInstalledGeneratedCliAssistant`。修 fixture 或实现语义(别破坏 yolo 全自动设计)。

---

## 4. 建议修复路线(三波,带 UI 测试关卡)

**第 1 波 · 落地已到手的前端红利(不依赖后端,快且低风险)—— ✅ 亲测+修复已完成(2026-07-11 续)**

1. ✅ `bun install` + `bun run dev` 桌面端(CDP 脚本 `scratchpad/cdp.mjs` 驱动)**亲测五项全过**:团队加人+指定 leader / 草稿箱三态 / 两级模型选择器 / slash 菜单 / 法语切换。
   - 亲测中修复 2 真 bug:`bb681b0`(团队 run 缺 slot_work 白屏,加兜底+3测试)、`b9990fd`(Agent 筛选页签 `{{count}}` 字面量,11 locale 剥后缀,以 fr-FR 为准)。
2. ✅ 3B 品牌源码兜底串收尾:`35ee9f6`(4 个 defaultValue AionUi→1ONE Code)。
3. ⏳ 全绿(tsc0/team17pass/settings119pass)→ **待用户点头** 合 `one-main` → bump 版本 → `dist:win`(**不删旧 .exe**)。
   - 观察(非阻塞):CDP 连发偶现 `team_id undefined`/`slot is busy` toast,慢速不复现=时序竞态;`config-options` 404 = 后端落后已知项。

**第 2 波 · aionrs 深度同步 —— ✅ 代码完成(2026-07-11 续,分支 `aionrs-local:sync-v022`,未合 master)**

- 从 v0.2.2 tag 建分支,cherry-pick 3 补丁:`90d2e4e` 流式空参 + `32b2fbe` thinking 阶梯 level1/2 + `1f36350` 文本化 level3。**关键认知**:上游 #203 只改 thinking 声明(v0.2.2 已含),无重试阶梯;fork 4 级阶梯是正交专属基础设施,32b2fbe 的阶梯部分必须留(是 1f36350 的地基),只弃用其声明部分。107417b/3d6aceb 真弃用。
- composed.rs 自动合并 bug(stream_with_compat 用 self.compat 覆盖了升级 compat)已重写修正。测试 mock path 适配 v0.2.2(`/chat/completions`)。
- 验证:release 构建全过、clippy 零警告、workspace 测试 0 失败。

**第 3 波 · 后端 1oneCore 同步 → v0.1.45 —— ✅ 代码完成(分支 `1oneCore:sync-v0145`,1 合并提交,未合 one-main)**

- git merge v0.1.45(31 提交)。5 冲突全解(Cargo.toml 保 fork aion-_ master pin+one-_ crates+版本 0.1.45-one.1;cli.rs 补回丢失的 CronHelperCommand 枚举;error.rs 保 fork 变体;assistant 两测试并存;**migration 撞车**上游占 019/020,fork 重编号 021/022/023)。one-employee 补 `required_runtime_mode: None`。
- 本地临时 [patch] 指向 aionrs-local(sync-v022)验证 cargo check --workspace 全过、测试全绿,**提交前已删 patch**。2 个 active-lease CSRF e2e = 合并前存量失败(one-main worktree 实跑证明)。
- 自有 bug B1/B2/P1 未穿插做(独立任务)。

**⚠️ 三仓收尾(全破坏性/对外,待用户点头)**:①aionrs sync-v022 合 master+推 origin ②1oneCore sync-v0145 合 one-main+重编 aioncore.exe 搬 bundled+前端回填 aioncoreVersion ③前端 sync-2132 合 one-main+bump+dist:win。

---

## 5. ★ aionrs 同步作战计划(v0.1.38 → v0.2.2)

**为什么优先做**:本会话查实,今天手动修的 thinking bug 根因就是 aionrs 太旧——上游 **PR #203 `6a05d5a support OpenAI-compatible thinking and chat paths`** 是官方修复,在 v0.2.x 才有,fork 够不着才手动 back-port。同步后**净减负**。

**fork 的 5 个补丁在 v0.2.2 上的命运(逐条,已 grep 对照上游):**
| 补丁 | 上游对应 | 同步后处理 |
|---|---|---|
| `107417b` 默认启用 thinking | = #203 | **弃用**,取上游 |
| `32b2fbe` 只显式声明 thinking+多级重试 | **= #203 本尊** | **弃用**,取上游 |
| `3d6aceb` golden snapshot | 测试快照 | 重新生成 |
| `90d2e4e` 流式 tool_call 空参 bug | 上游**无** | ⚠️ **重贴(fork 专属)** |
| `1f36350` 文本化工具历史(兜 litellm-internal 网关拒 tool_calls) | 上游**无** | ⚠️ **重贴(fork 专属,命脉)** |

**白捡的上游 provider 修复**:`6f2f8ad make max tokens optional`、`f2a2fb1 preserve 429 body`、`9c9b7ec retry 5xx`。

**施工步骤:**

1. `cd D:\aionui-m0\aionrs-local`(upstream remote 本会话已加,`git fetch upstream --tags` 已做)。
2. 建隔离分支:`git checkout -b sync-v022 master`。
3. **评估 v0.2.0 破坏性变更**:`7969fa2 refactor(cli)!: restructure management flags into subcommands (#184)`——CLI 管理 flag 改成子命令。**这会影响 1oneCore 怎么调 aionrs CLI**(1oneCore v0.1.42「mcp: support aionrs config path subcommand with legacy fallback」正是在适配它)。先 `git show 7969fa2` 摸清 CLI 接口变化。
4. `git merge v0.2.2`(或 rebase fork 的 2 个专属补丁到 v0.2.2 上)。thinking 两补丁(107417b/32b2fbe)让给上游;冲突时取上游 #203 版。
5. **重贴 2 个专属补丁**到 v0.2.x 重构过的 providers 模块(注意 v0.1.35「compose transports」+ #203 都动过 thinking/chat 路径,`composed.rs` 结构可能变):
   - `90d2e4e` 流式 tool_call 空参
   - `1f36350` `textualize_tool_replay` + composed.rs 等级化重试链(原样→content-block→省略thinking→文本化)+ `Arc<AtomicU8>` 会话内粘等级
6. `cargo build --release` 全绿 → 更新 aionrs workspace 版本号。
7. 因 1oneCore 的 `aion-*` 依赖 pin 的是 `gaogg521/aionrs` **master** 分支,合回 master 后 1oneCore 自动吃到(见 §6)。

**验证(桌面端亲测):** 在 deepseek-v4-flash/pro(走 litellm-internal 网关)上跑多步 Agent 任务,确认 `content[].thinking must be passed back` 不再出现、tool_calls 历史正常(文本化兜底仍生效)。方法论:黑盒探测网关 = 从 `users.jwt_secret` 派生 AES key 解密 `providers.api_key_encrypted` 直接 curl,比反复编译快一个数量级(详见 [`session-2026-07-10-thinking-param-and-rename.zh-CN.md`](session-2026-07-10-thinking-param-and-rename.zh-CN.md))。

---

## 6. 后端 1oneCore 同步(v0.1.42 → v0.1.45)

- **落后 31 commit**,上次同步点 = v0.1.42(#569)。
- **必须先做 §5 aionrs**(v0.1.45「adapt to aionrs v0.2.2 config」依赖 aionrs 到 v0.2.2)。
- 关键要拿的:**v0.1.44 #585 `system: add feedback diagnostics report`**(前端 #3529 诊断端点 `GET /api/system/diagnostics/feedback-report` 的后端实现,现在没有=前端诊断静默降级)、v0.1.45 `update Claude/Codex ACP package`(配前端 #3557)+ `agent config/diagnose 命令` + `stop defaulting aionrs max tokens`、v0.1.43 `#576 cron 强制全自动` + `#578 按已安装 agent 过滤生成型助手`。
- 套路:`1oneCore` 建隔离分支 `git merge upstream/main`(或到 v0.1.45 tag)。不变量:`Cargo.toml` 保 fork 的 `one-*` crates + `aion-* = { git="gaogg521/aionrs", branch="master" }` 依赖;工作区版本 `-one.N` 命名。
- 完成后:`cargo build --release` → 重编 `aioncore.exe` 搬进 1oneUI bundled(见 `ai-handoff-conventions.zh-CN.md`)→ 前端 `package.json` `aioncoreVersion` 回填新 `vX.Y.Z-one.N` → 重打包。

---

## 7. 铁律(handoff 必守)

1. **UI 亲测**:任何功能改动都要桌面端 `bun run dev` 真实操作走查,不是自动化测试就算完(用户明确)。测 agent/发送/worker 走**桌面端不走 WebUI**(WebUI PATH 不全会 claude CLI not found)。
2. **企业版坏也绝不影响单机版**:企业逻辑全门控在企业上下文;无 org 行=单机=放行。
3. **不删任何旧 .exe**(打包脚本已内建保护);打包前先 bump `package.json` version。
4. **提交**:中文 commit、无 AI 签名、直接 `one-main`(功能分支只在同步这种大操作用隔离分支)、**精确 `git add`,绝不 `git add -A`**(fork 有他人改动 + temp/out_old 垃圾)。⚠️ `cargo fmt -p <crate>` 会顺手重排他人未提交文件——提交前 `git status` 核对,非本人改动 `git checkout --` 撤销。
5. **主进程 console 禁令**:`1oneUI` 的 `src/process/`、`src/index.ts` 等禁 `console.*`(触发 bridge 广播 + electron-log 同步写盘 → 冻死主进程),用异步 `appendFile`。
6. **不许空壳**:每模块必须真实数据实证。

---

## 8. 环境 / 命令 / 路径速查

- 前端 dev:`cd D:\aionui-m0\1oneUI && bun install && bun run dev`;测试 `bun run test` / `npx vitest run <file>`;类型 `npx tsc --noEmit`;i18n `node scripts/check-i18n.js`。
- 后端/aionrs:`cargo build --release`;重编脚本 `1oneCore` 的 `scripts/backend-rebuild.ps1`。
- dev userData 目录:`%APPDATA%\1one-Dev`(注意不是 1OneClaudeCode-Dev)。
- 当前分支:1oneUI=`sync-2132`;1oneCore=`one-main`;aionrs=`master`(+ 新加 upstream remote)。

---

## 9. 关键文档 / 记忆路由

- **本文** = 本会话交接 + 三波路线 + aionrs 施工图。
- [`upstream-sync-reference.zh-CN.md`](upstream-sync-reference.zh-CN.md) = 三仓↔上游映射、版本对照、同步不变量(常驻参考)。
- [`ai-handoff-conventions.zh-CN.md`](ai-handoff-conventions.zh-CN.md) = 改完重编哪个才生效。
- [`session-2026-07-10-thinking-param-and-rename.zh-CN.md`](session-2026-07-10-thinking-param-and-rename.zh-CN.md) = thinking bug/网关/黑盒探测方法论。
- 自有待办原文:`D:\1one-command\docs\tech\v2-audit-and-open-items.md`(B1/B2/P1 等)、`STATUS-AND-TODO-2026-07-09.zh-CN.md`。
- 记忆(`~/.claude/projects/D--1one-command/memory/`):`upstream-sync-checkpoint`、`gateway-thinking-bug-textualize-fix`、`feedback-upstream-merge-workflow`、`feedback-proactive-comprehensive`、`feedback-build-artifacts`、`feedback_test_via_desktop_not_webui`。
