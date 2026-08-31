# Windows + Mac 打包与发布踩坑手册（Playbook）

> 给后续 AI / 人类的**可操作**打包发布手册。把散落在各 session 文档里的打包/发布坑集中成一份「照着做 + 出错怎么查」的清单。首次整理于 **2026-07-21**（发 `v2.1.49` 时，Mac CI 连挂 3 次总结出来的）。
>
> 权威的"当前发布状态"永远用实时命令查（见 [§7](#7-实时核实命令)），别信任何文档里写死的时间点快照。

---

## 0. 一句话全景

发一个跨平台版本要走 5 仓/步，**顺序不能乱**：

```
aionrs 改完推 master
  → 1oneCore: cargo update 对齐 aionrs + bump 版本 + 打 tag（触发 release.yml 产 6 个跨平台 aioncore 二进制）
    → 1oneUI: bump package.json version + aioncoreVersion 指向上面那个 1oneCore tag
      → Windows: 本地 package-win.ps1（用本地 aioncore.exe，不走 CI）
      → Mac: GitHub Actions build-manual.yml（macOS runner，签名+公证；从 1oneCore Release 下载 aioncore）
        → gh release create v<ver>（Win + Mac 资产）
          → COS 上传（releases/<ver>/ + releases/latest*.yml，App 自动更新的源）
            → 官网 work.1oneclaw.com（D:\website\1onework，改 site.config.js + 部署）
```

> ⚠️ **发版前必过项**：见 [§2.6](#26-️-内嵌-acp-运行组件claude-agent-acp--codex-acp缺失--全平台且只有全新安装才会暴露)——内嵌 ACP 运行组件缺失会让**全新安装的用户**用不了 Claude Code / Codex，而**有缓存的开发机完全看不出来**，2.1.51 已经这样发出去过一次。

**为什么 Mac 必须等 1oneCore 先发 Release**：Mac 包（`build-manual.yml`）在打包时会去 **1oneCore 的 GitHub Release** 按 `1oneUI/package.json` 的 `aioncoreVersion` 下载对应平台的 aioncore 二进制内嵌。1oneCore Release 不存在 → Mac 包拿不到后端。Windows 本地打包不受此限（用 `AIONUI_BACKEND_LOCAL_PATH` 指本地编译产物）。

---

## 1. Mac 打包（GitHub Actions `build-manual.yml`）——本 fork 最容易挂的地方

> **CI 挂了先看这张表，别从头推理**（2026-07-31 复发一次，从零重推花了十几分钟，而答案就在 §1.2）：
>
> | 症状                                                               | 去看                             |
> | ------------------------------------------------------------------ | -------------------------------- |
> | run 几秒失败、`jobs[].steps` 为空、`--log-failed` 报 log not found | §1.2 计费拦截                    |
> | 在 `Prepare aioncore binary` 步骤 404                              | §1.5 + 下方「后端 tag 必须先发」 |
> | 卡在 oxfmt / oxlint / tsc / vitest                                 | §1.3                             |
> | 签名成功但装上报未签名                                             | §1.4                             |
>
> **判据**：同期公开仓库（1oneCore）的 CI 跑得动、私有仓库（1oneUI）全挡 → 一定是计费，不是代码。私有仓库连最便宜的 ubuntu job 都会被挡，不只 macOS。
>
> **后端 tag 必须先发**：`package.json` 的 `aioncoreVersion` 指向的 1oneCore Release 必须真实存在，CI 才下得到 aioncore。这个 tag 不会自己产生——2026-07-31 打 2.1.51 时 `aioncoreVersion` 已是 `v0.1.53-one.1` 而 1oneCore 最新 Release 只到 `v0.1.49-one.3`，必须先去 1oneCore 打 tag（`release.yml` 由 `v*` 触发，六平台约 22 分钟）再触发前端构建。

触发方式（dream-ui，默认分支就是 `main`）：
`gh workflow run build-manual.yml --repo gaogg521/dream-ui --ref main -f branch=main -f platform=macos-arm64 -f installers_only=false`

- `platform` 是单选，没有"两个 Mac 一起"选项——arm64 / x64 各触发一次（或 `all`，但会连 win/linux 一起打，浪费）。
- **要发版就 `installers_only=false`**（默认 `true`）：`true` 会在上传 artifact 前删掉 `.zip`/`.yml`，而 Mac 自动更新的 `latest*.yml` 指向的是 `.zip` 不是 `.dmg`——只留 `.dmg` 的包等于没自动更新。

### 1.1 `branch` 输入：dream-ui 填 `main`（旧 1oneUI 是 `one-main`）

workflow 的 `branch` input 默认值是 `main`。**dream-ui 的默认分支就是 `main`**，直接用即可。
（历史遗留：旧仓库 `gaogg521/1oneUI` 的默认分支是 `one-main`，那边要 `--ref one-main` + `-f branch=one-main` 都给；别把两仓搞混。）

### 1.2 GitHub Actions 计费拦截（私有仓库）——3 秒零步骤失败，错误藏得很深

**症状**：run 在 ~3 秒内 `conclusion=failure`，`jobs[].steps` 是**空数组**（一个 step 都没跑）。`gh run view --log-failed` 报 "log not found"。

**真正的错误信息**在 job 的 check-run annotations 里，普通 `gh run view` 看不到：

```bash
gh api "repos/gaogg521/1oneUI/check-runs/<jobId>/annotations" \
  --jq '.[] | "\(.annotation_level) :: \(.message)"'
# → "The job was not started because recent account payments have failed
#    or your spending limit needs to be increased..."
```

**根因**：私有仓库的 macOS runner 按 **10 倍**计费；账号付款失败或超了 spending limit，GitHub 直接拒绝派发**所有**计费 job（Mac/Windows/Linux 全挡，不只 Mac）。

**解法**（二选一）：

- **把仓库改 public**（GitHub Actions 对公开仓库免费，含 macOS runner）——`v2.1.49` 就是这么解的，改完 `gh run rerun <id>` 立刻从 3 秒失败变正常 in_progress。⚠️ 改 public 会公开全部代码 + git 历史（公开镜像/克隆即使改回 private 也可能留存）；GitHub **secrets**（COS/Apple 证书）存在 Actions 设置里、不随仓库公开而泄露。
- 或到 GitHub → Settings → Billing & plans 修付款/提额度。

### 1.3 Code Quality gate 挡在 Build 之前（4 道：oxfmt / oxlint / tsc / vitest）

`build-manual.yml` 的 build 依赖 `code-quality` job（见 `_build-reusable.yml`），任一挂了 Build step 直接 skip。**本地 `package-win.ps1` 打 Windows 包不跑这道 gate**——所以格式漂移/测试失败能溜过 Windows、却挡死 Mac CI。

四道 gate 各自的坑：

| Gate          | 命令                                       | 本 fork 已知坑                                                                                                     | 解法                                                     |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Prettier 格式 | `bun run format:check`（=`oxfmt --check`） | 未格式化的 **docs**（`.md`）会挂。写会话文档很容易漏                                                               | `bun run format` 格式化后提交（只动空白/表格对齐，安全） |
| Lint          | `bun run lint`（oxlint）                   | 只 warning，一般不挂                                                                                               | —                                                        |
| 类型          | `bunx tsc --noEmit`                        | —                                                                                                                  | 本地先跑一遍，快                                         |
| 单测          | `bunx vitest run`                          | **2 个既有失败**：`SortableConversationRow.dom.test.tsx`（拖拽 handle 的 DOM 测试，与后端/协议改动无关，长期未修） | 见下                                                     |

**vitest 的既有失败怎么办**：如果本次发布**没动前端源码**（只改了 docs/version/yaml/后端），这 2 个失败是**既有的、与本次无关**，不该挡发布。用 `-f skip_code_quality=true` 触发 Mac 构建跳过整个 gate。**前提**：先本地手动确认 `format:check` + `tsc` 过（`skip_code_quality` 把这几道一起跳了，别把真问题也跳过去）。

> 判断"失败是否既有/无关"：本次 diff 有没有碰 `.ts/.tsx`？没碰就是既有失败。`git log --oneline v<上个tag>..HEAD -- 'packages/**/*.tsx'` 一看便知。

### 1.4 macOS 签名/公证的坑

- **`IDENTITY` secret 不能带 `Developer ID Application:` 前缀**，只要公司名部分（electron-builder 自己加前缀）。带了 electron-builder 26.x 直接报 `⨯ Please remove prefix "Developer ID Application:" from the specified name — appropriate certificate will be chosen automatically`，签名失败。正确值：`Huanle Entertainment (Shanghai)Technology Co., Ltd. (HKT9687899)`（去掉 `Developer ID Application: ` 前缀）。
  - **2026-08-31 在 dream-ui 真踩过并已修**：配 secret 时把证书完整 CN 原样填进了 `IDENTITY`，3.0.0 的 arm64/x64 两个 Mac 包都签名失败、兜底打出未签名包发了出去、CI 报绿、用户装机"已损坏"。已 `gh secret set IDENTITY --repo gaogg521/dream-ui` 改对（值非机密——证书 CN 在任何已签名二进制里都可见）。1oneUI 的 secret 一直是对的。
  - `build-with-builder.js` 的 `normalizeSigningIdentityEnv()` 现在跑 electron-builder 前**自动剥掉** `CSC_NAME`/`identity` 的 `Developer ID Application:` / `Developer ID Installer:` 前缀（日志打 `🔑 Stripped "Developer ID …:" prefix`），secret 写错也不再连累签名——但 secret 本身也该是对的。
- **DMG 重试兜底曾造成假阳性 success（已修，2026-08-31）**：`buildWithDmgRetry` 检测到 ".app 有了但 .dmg 没生成"会用 `--prepackaged` 重试，这条路**跳过签名**、只把已有的 `.app`（`afterSign.js` 的 ad-hoc 兜底签名）塞进 DMG。而 CI 只看"DMG 是否存在"就报绿——于是 3.0.0 一路把 ad-hoc 包发到了 COS。
  - 现在 `buildWithDmgRetry` 重试前先判断：配了签名（`CSC_LINK`/`CSC_NAME`/`CSC_KEYCHAIN` 任一存在）但 `.app` 的 `codesign -dv` 里没有 `Authority=Developer ID Application` → 判定签名失败，**直接 throw 让 CI 红**，不再兜底；`createMacArtifactsWithPrepackaged` 产物也复查同条件。
  - `_build-reusable.yml` "Build with electron-builder (macOS)" step：`build.log` 出现 `remove prefix "Developer ID` / `code signing failed` / `No identity found` → `::error` + `exit 1`；只有 `build.log` 里**真有** `signing … Developer ID Application` 成功行、且只是 `notariz`/`staple` 挂了，才降级 warning。
  - **验收判据永远是日志三连**：`• signing file=out/mac-*/One Work.app … identityName=Developer ID Application:` → `App One Work is properly code signed` → `Notarization completed successfully`，且**没有** `Retrying … --prepackaged`。别只看 CI 绿灯。
- **`codesign` 偶发挂死近 6 小时**：`codesign` 默认做在线证书吊销检查（OCSP），网络请求卡住且它没内部超时会死等。是 flaky，不是配置问题；`build` step 卡几小时不动就是它，取消重跑（现有 `timeout-minutes: 60` 会兜底）。
- 需要的 6 个 secrets：`BUILD_CERTIFICATE_BASE64` / `P12_PASSWORD` / `IDENTITY` / `TEAM_ID` / `APPLE_ID` / `APPLE_ID_PASSWORD`（涉及证书/密码的 base64/导入都由用户自己在 GitHub 网页做，AI 不经手明文；`IDENTITY` 是证书 CN、非机密，AI 可以 `gh secret set`）。`afterSign.js` 读的是小写 `appleId`/`appleIdPassword`/`teamId` env，workflow 已同时喂 `appleId=APPLE_ID` 等。
- macOS 老系统（Big Sur 11.x）兼容：内置托管 Node 已按平台降到 22.11.0（新 Xcode 的 chained-fixups 格式老 dyld 加载不了），见 1oneCore `1797fcf7`。

### 1.5 ⚠️ `Build and Release`（打 tag 自动发布）在本 fork 从未真正触发过

`build-and-release.yml`（`on: push tags`）历史上 `total_count: 0`，从没跑过（GitHub 层面某设置卡着，未查明）。**别指望打 dream-ui tag 自动出包**。正式路径是：`build-manual.yml` 手动出各平台产物 → 本地 aws-cli 传 COS（**不发 GitHub Release**，见 memory `release-channel-cos-website-only` 和 §6）。（注意：**dream-core 的 `release.yml` 是好的**，`v*` tag 能正常触发产 6 资产，别和 dream-ui 的搞混。）

### 1.6 复盘：2026-08-31 v3.0.0 Mac 发布（"已损坏"根治 + `1onecode`→`One Work` 改名）

一次把「用户下的 Mac 包已损坏」查到底 + 顺手清掉历史品牌名的完整过程。踩到的坑按出现顺序：

**A. `.app` / DMG / Gatekeeper 弹窗显示的是 `1onecode` 不是 `One Work`——不是拉了老资源**

`electron-builder.yml` 里的 `executableName: 1onecode`。electron-builder 26.x（`app-builder-lib/out/appInfo.js`）：

```js
this.productFilename = executableName != null ? sanitizeFileName(executableName) : this.sanitizedProductName;
```

`productFilename` 决定 **`.app` 目录名、DMG 卷标题、Windows `.exe` 名、Windows 默认安装目录**——`productName: One Work` 在这几处**全不生效**。装完启动后窗口标题 / Dock / 关于页都对（那些读 `CFBundleName`），只有「装之前的壳」是 `1onecode`。已验证 2.1.61 发布包内部就是 `1onecode.app`，每个包都这样，不是回归。

- **修法**：直接删 `executableName`（回落 `productName`）。Linux 单独加 `linux.executableName: one-work`（deb / 二进制名不要空格）+ `desktop.entry.Icon: one-work`。
- **`executableName` 冻结跟 userData 无关**——生产 userData 是 `configureChromium.ts` / `common/platform/index.ts` 用 `app.setName(PROD_USERDATA_APP_NAME)` + 显式 `app.setPath('userData', …)` 钉的，跟 `executableName` / `productName` 都无关。CLAUDE.md 旧「运行时身份·刻意不改」表把三个值绑一起是过度保守，实际只有 `appId` 真必须冻结（Squirrel.Mac 按 `CFBundleIdentifier` 匹配升级包、Win 卸载注册表 GUID 由它派生、签名证书 team 也绑它）。
- 连带要一起改的 fork 自有文件：`resources/installer.nsh`（`$LOCALAPPDATA\Programs\1onecode` → `One Work`）、`resources/windows/installer-observability.nsh`（`AIONUI_APP_EXECUTABLE_FILENAME`）、`resources/windows/support/query-lockers.ps1`、`scripts/build-with-builder.js` 的进程 kill 列表、`scripts/packaged-launch.mjs`、`scripts/dev-bootstrap.mjs`、`tests/e2e/fixtures.ts`、`packages/desktop/src/sentry.ts` 的 `installDirs`。旧名一律留作兜底，别删。

**B. `PROD_USERDATA_APP_NAME` 改名要配首启迁移**

`1ONE Code` → `One Work` 直接改会让存量用户开 3.0.0 看到空白（数据没删、只是不读了）。加了 `common/platform/index.ts` 的 `migrateAndResolveProdUserDataDir(appSupportDir)`：目标目录已存在就用它；否则旧目录（`LEGACY_PROD_USERDATA_APP_NAMES`）存在就 `renameSync` 搬过去；rename 失败（跨卷 / 被锁）就**就地用旧目录**，数据绝不丢。`configureChromium.ts` + `getPlatformServices()` 两个调用点都换成它。

- ⚠️ `LEGACY_PROD_USERDATA_APP_NAMES` **刻意只放 `1ONE Code`，不放 `AionUi`**——`AionUi` 是上游的目录名，同机跑着上游 App 的人会被误搬数据（跟 `getDevAppName` 撞库同一类事故）。
- **Windows 真机验迁移的正确姿势**：Electron 在 Windows 读 `SHGetKnownFolderPath(FOLDERID_RoamingAppData)`，**不认 `%APPDATA%` 环境变量**——`Start-Process` 前 `$env:APPDATA=...` 没用，会打到真实目录去。用 Chromium 开关 `--user-data-dir=<沙箱>`：`app.getPath('userData')` 会返回它，迁移里的 `path.dirname(userData)` 就落在沙箱里，预置 `<沙箱>\1ONE Code\` 就能安全验。跑完 `1ONE Code` 消失、`One Work` 出现、marker 文件原样保留 = 通过。
- Mac 侧同一函数、同一 `configureChromium.ts` 生产分支，只有 `dirname(userData)` 落点不同（`~/Library/Application Support`）。本地无 Mac 时单测 + Win 真机 + 代码同源可作为可接受的信心，但**能上真 Mac 就上**。
- 全仓无 `safeStorage`/`keytar` → 模型 key 在 SQLite，迁移 = 纯目录搬移，不涉及 keychain 重新加密。

**C. `gh run download` 从公司专线拉 CI 产物：慢 + 抽风，必须带重试**

跟 §6 说的"内网→GitHub 上传慢"是同一条链路，下载同样慢（实测 ~1-2.5 MiB/s，一个 ~1.4GB 的 Mac artifact 要 10-20 分钟）而且会中途报 `error extracting zip archive` / `The file exists`（上一次失败留的半成品）。**每个 artifact 单独 `gh run download --name <artifact> -D <dir>` + 5 次重试 + 每次先 `rm -rf` 目标目录 + 下完检查预期文件在不在**。别用一条 `gh run download <run>`（多 artifact 顺序下、中间挂了前功尽弃）。

**D. 后台跑长脚本：用 Bash 工具原生 `run_in_background`，别 `nohup … &` 套娃**

`nohup cmd & ` 塞进一个 `run_in_background` 调用里，外层 wrapper 一退，MSYS 会把子进程连带杀掉（实测第一次上传脚本这么死的）。直接 `bash publish.sh > log 2>&1` 配 `run_in_background: true`——那个能稳跑 20+ 分钟。

**E. `format:check` 是整仓跑，不是只跑改动文件**

两个 PR 都改了 `CLAUDE.md` 的**不同段落**，各自分支 `oxfmt <changed files>` 都过；合进 main 后，同一张 Markdown 表格的列宽要按所有行重算，`bun run format:check`（整仓）挂。**合并涉及 `.md` 的多个分支后，务必再 `bun run format:check` 整仓跑一遍**，别只信各分支的 changed-files 检查。playbook §1.3 早写了"未格式化的 docs 会挂"，这是它的一个新变种。

**F. 发布 = 覆盖 COS `releases/3.0.0/` + 更新根 `latest*.yml`（不发 GitHub Release）**

官网 `site.config.js` 的下载地址是 `releases/{version}/One-Work-{version}-{os}-{arch}.{ext}` 按版本号拼的。3.0.0 那几个对象**已经在**（是坏的），发新版 = **原地覆盖同名对象** + 重算 `latest*.yml`（`.zip` 的 sha512/size）传 `releases/3.0.0/` 和 `releases/` 根两处。根的 `latest-arm64-mac.yml`（darwin arm64）/ `latest-mac.yml`（darwin x64 默认）/ `latest.yml`（win）是自动更新轮询点，改它 = 存量用户会被推自动升级——发数据迁移类版本前**先跟用户确认要不要推**。官网 `dist/` 和 `site.config.js` 若版本号没变就不用动，直接覆盖 COS 对象即可。

---

## 2. Windows 打包（本地 `D:\aionui-m0\scripts\package-win.ps1`）

用法：`.\package-win.ps1`（用现有 `1oneCore/target/release/aioncore.exe`）或 `-Rebuild`（先 cargo build 再打）。

坑：

- **必须设 `AIONUI_BACKEND_LOCAL_PATH`**（脚本已自动设）：否则打包链去 GitHub Release 下载 `aioncoreVersion` 对应二进制，私有 fork tag 常无产物 → `aioncore binary not found`。日志出现 `Bundled aioncore prepared: ... [source=local]` 才对。
- **PowerShell `$ErrorActionPreference='Stop'` 会把 cargo/npm/vite 往 stderr 写的正常进度行当成终止错误**（`NativeCommandError`）打断构建。脚本已在调原生命令前后切 `Continue`、只靠 `$LASTEXITCODE` 判真失败。
- **bun cache 损坏 → `better-sqlite3` native rebuild 失败**（`v2.1.49` 踩到）：`afterPack.js` 用 `bun x prebuild-install` / `bun x electron-rebuild` 重编原生模块，bunx 把这些包下到 `%TEMP%\bunx-*` 时可能**下不全**，报 `Cannot find module '...prebuild-install/bin.js'` / `Cannot find module 'chalk'`。解法：
  ```bash
  bun pm cache rm && rm -rf "$TEMP"/bunx-*   # 清缓存，重跑 dist:win
  ```
- **打包前停 dev 应用**（避免文件锁）：`taskkill /F /IM electron.exe /T; taskkill /F /IM aioncore.exe /T`。electron 主进程有看门狗会**自动重启 aioncore**，只杀 aioncore 没用，要连 electron 一起杀。

---

## 2.5 AI 代理发布时的额外坑（2026-07-26 v2.1.50 首次遇到）

### 2.5.1 ⚠️ `gh release create` 会被 Auto Mode 分类器拦下，必须显式问用户

`gh release create` 是"发布公开内容"动作（GitHub Release 是公开可见、影响下游用户的），Claude Code 的 auto-mode 安全分类器会**直接拒绝执行**，报错 "Permission for this action was denied by the Claude Code auto mode classifier"。这不是 gh 认证问题，也不是权限配置问题——**每次**要发新 Release 都必须先向用户说清楚要发布的内容（tag/资产列表），拿到明确同意后再跑 `gh release create`。同理，`gh release create/upload`、`git push --tags` 触发公开发布的操作都可能被拦；`release-distribute.yml` 的 CI 自动触发（release published 事件）不受此限，因为那是 GitHub 自己触发的，不是本地新执行的 shell 命令。

### 2.5.2 ⚠️ CI 打的 Mac 包默认不含 update yml，需要自己算 sha512 补上

`build-manual.yml` 用 `upload_installers_only: true`，会在上传 artifact 前删掉所有 `.yml`（见 `_build-reusable.yml` 的 "Clean up non-installer artifacts" 步骤），所以 `gh run download` 下来的产物只有 `.dmg`，没有 `latest-mac.yml`。需要自己补一份：

```bash
DMG=path/to/One-Work-<ver>-mac-arm64.dmg
SHA512=$(openssl dgst -sha512 -binary "$DMG" | openssl base64 -A)
SIZE=$(stat -c%s "$DMG")
```

再手写 yml（格式抄现有 `releases/latest.yml` / `releases/latest-mac.yml`，字段：`version`/`files[].url,sha512,size`/顶层 `path`/`sha512`/`releaseDate`）。

### 2.5.3 ⚠️ Mac 更新 yml 文件名必须区分架构，别覆盖 `latest-mac.yml`

App 自己的 `packages/desktop/src/process/services/autoUpdaterService.ts`（`resolveChannel`）明确写了：darwin **arm64** 走 `latest-arm64-mac.yml`，darwin **x64**（默认）才走 `latest-mac.yml`。COS 上现有 `releases/latest-mac.yml` 是历史 x64 构建产物；**只打了 arm64 包时绝不能把生成的 yml 命名成 `latest-mac.yml` 上传**——那会把 x64 用户的自动更新指向一个他们装不了的 arm64 dmg。正确做法：命名为 `latest-arm64-mac.yml`，作为独立 Release 资产上传，`release-distribute.yml` 的 `dist/latest*.yml` glob 会自动捞到并按文件名镜像到 COS 根目录，不影响已有的 `latest-mac.yml`。**若某次发布同时打了 x64 + arm64 两个 Mac 包，两份 yml 都要生成、都要传，缺哪个哪个架构就没有自动更新。**

### 2.5.4 打包前先跑 `bun run format:check` + `tsc`，且要甄别新失败是否与本次改动相关

见 §1.3 的既有坑；v2.1.50 这次额外发现 vitest 全跑一遍后失败列表可能比 playbook 记录的旧列表更多（历史失败没被跟踪更新）。判断某个失败文件是否"既有、与本次无关"不能只看 playbook 静态记录，要 `git log --oneline -3 -- <失败测试对应的源文件>` 现查最后改动是哪次提交，确认不在本次改动范围内，才可以用 `skip_code_quality=true` 跳过整道 gate。

---

## 2.6 ⚠️ 内嵌 ACP 运行组件（claude-agent-acp / codex-acp）缺失 —— 全平台，且**只有全新安装才会暴露**

**2026-08-07 由用户真机截图发现**：装完点 Claude Code，弹「One Work 安装不完整 …… Claude ACP 运行组件 无法启动」，正文路径指向 `…\resources\bundled-aioncore\win32-x64\…`。Codex 同理（同一套代码路径）。

### 2.6.1 成因（每一环都已核对源码）

fork 走的是「ACP 包装层按 npm 包内嵌」这条路（`acp_tool_runtime`，07-29 同步时从上游删除中恢复），打包版**硬性要求**内嵌目录下存在：

```
resources/bundled-aioncore/<runtimeKey>/managed-resources/acp/<slug>/<version>/<runtimeKey>/
```

但上游 `#609`（2026-07-23，随 07-29 同步进 fork）把 [`cmd_prepare_managed_resources.rs`](../../../1oneCore/crates/aionui-app/src/commands/cmd_prepare_managed_resources.rs) 整体换成了 `managed_cli` 方案——它只产出 `node/` + `cli/claude`、`cli/codex` 两个**原生二进制**，`acp/` 这一层从此不再生成。而 fork 里本该产出它的 `prepare_managed_acp_tool_to_root`（`aionui-runtime/src/acp_tool_runtime/mod.rs`）**全仓库零调用方**，只在 `lib.rs` 里 re-export 了一下。

运行时后果：打包版才带 `--managed-resources-mode bundled`（`packages/web-host/src/backend-launcher.ts`），于是 `activate_local_tool_source` 直接抛 `bundled managed Claude ACP artifact missing under …`；而 npm 兜底路径在 bundled 模式下**第一行就 return**，没有任何回退，直接硬失败。

### 2.6.2 ⚠️ 为什么它能一路混过测试 —— 本机缓存会伪装成"正常"

`ensure_managed_acp_tool` 的解析顺序是「**先查用户数据目录缓存，命中就直接返回**」，命中时根本走不到内嵌包那一步：

```
%APPDATA%\1ONE Code\1one\runtime\managed-tools\acp\<slug>\<version>\<runtimeKey>\
```

而 2026-07-12 ~ 07-28 之间的构建，版本常量已经是 `claude-agent-acp 0.58.1` / `codex-acp 1.1.2`，且内嵌包**还带着 `acp/`**——那段时间装过的机器，早把 0.58.1 物化进了自己的缓存。于是：

| 用户类型                                              | 缓存里有当前版本吗 | 结果                             |
| ----------------------------------------------------- | ------------------ | -------------------------------- |
| 7 月中旬装过、一路升级上来（**所有开发机 / 测试机**） | 有                 | 一切正常，**完全看不到这个 bug** |
| 全新安装 / 换机 / 重装 / 缓存被杀软清掉               | 没有               | **必挂**，弹「安装不完整」       |

**教训：凡是"内嵌资源 + 用户目录缓存"双来源的组件，在有缓存的机器上验证等于没验证。** 必须在清空缓存的前提下验，见 2.6.4。

### 2.6.3 ⚠️ 原本的闸门被自己关掉了

`verify-bundled-aioncore-resources.js` 本来只认 schema v1（校验 `acpTools` → `acp/…` 真在盘上），正是能拦住这个问题的检查。07-30 为「解除打包阻塞」（`3c40734c7`）改成 v1/v2 都接受，而 v2 只校验 `cli/claude/…` 存不存在——**唯一的防线在这里被放行了**。装机侧的 `verify-bundled-aioncore-install.ps1` 同样。

**⚠️ 更要紧的是当时为什么觉得这样安全**——`3c40734c7` 自己的提交信息写着：

> 必需 CLI 为 claude 与 codex(对应 v1 的 codex-acp/claude-agent-acp)

**根因就是这个「对应」不成立**：v2 的原生二进制并**不能**替代 fork 运行时要的 `acp/` 包装层（fork 明确没有采纳 session-port 迁移，见 §2.6.1）。这不是疏忽，是一个看起来完全合理的等价判断——所以写进防线的提醒应该是「**别再相信这两者等价**」，而不只是「别关掉闸门」。后者挡不住下一次上游同步。

### 2.6.4 修复状态（① 已完成，② 仍是每次发版必做）

**① ✅ 已于 2026-08-07 修复，无需再做。**

- 1oneCore：`run_prepare_managed_resources` 现在对 `ClaudeAgentAcp` / `CodexAcp` 各调一次 `prepare_managed_acp_tool_to_root`（新增失败阶段 `acp.prepare`，与 `cli.prepare` 分开报），并恢复了 `managed_acp_tool_contract_for_export`（07-29 同步时**唯一没恢复**的那个函数，正是缺口所在）。v2 契约新增 `acpTools` 段，**形状与 v1 逐字段相同**——这样两个校验器不必各写第二套实现。
- 契约校验 `validate_contract` 现在缺 `acp/` 直接失败（缺 slug / 声明了但盘上没有 / 缺每工具 `manifest.json` / 平台不匹配 / 路径逃逸各有用例）。⚠️ 该函数**只在打包期调用、运行时零读取方**（`acp_tool_sources` 只探目录不读 manifest），所以收紧它对存量安装零风险。
- 1oneUI：`verify-bundled-aioncore-resources.js` 与 `verify-bundled-aioncore-install.ps1` 的 v2 分支改为**同时**校验 `acpTools` 与 `clis`（原为二选一）。装机侧校验器随包分发，故只影响新包，不会把存量 2.1.51 用户误判成损坏。
- 测试：Rust 契约 15 条、JS 校验器 19 条、PS1 5 条，新增的负向用例**都做过负向验证**（拆掉闸门重跑，确认失败的正是它们）。
- **未采纳的顺带项**：`cli/claude`、`cli/codex` 两个原生二进制保留入包。它们确实是当前用不到的重量，但删除属独立决策、且会缩小将来接 session-port 的余地，不在本次修复范围。

**② 打完包，按下面两步验，不许省。**（①只保证代码会产出并拦截，仍不能替代真机验证）

```bash
# 检查一：内嵌包里的 acp/ 版本必须与后端常量逐字一致
grep -A5 'pub fn version' 1oneCore/crates/aionui-runtime/src/acp_tool_runtime/types.rs
ls -d 1oneUI/resources/bundled-aioncore/*/managed-resources/acp/*/*/
# 两边对不上（或 acp/ 根本不存在）= 这个包发出去会让所有新用户装完用不了 Claude/Codex
```

```bash
# 检查二：清空缓存后装机冒烟（模拟全新用户，这一步才是真正的判据）
mv "$APPDATA/1ONE Code/1one/runtime/managed-tools/acp" \
   "$APPDATA/1ONE Code/1one/runtime/managed-tools/acp.bak"
# 然后装包 → 新建会话 → 后端各选 Claude Code / Codex CLI → 各发一条真消息
# 验完想恢复自己的环境就把 acp.bak 改回来
```

> 这条冒烟应固化为**每次发版的必过项**，而不只是本次的补救——只要 fork 还走 `acp_tool_runtime` 这条路，任何一次上游同步都可能再次悄悄切走 `prepare` 的产出。

### 2.6.5 用户侧的观感缺陷（同批已修）

这次暴露的不只是打包。**弹「安装不完整」的那个对话框曾经没有任何可见的关闭出口**——底部只有「发送诊断报告」和「下载最新版」，`closable: false` + `maskClosable: false`。它由两条前提相反的路径共用：

| 路径                                | 触发时机                        | 无出口是否合理                         |
| ----------------------------------- | ------------------------------- | -------------------------------------- |
| `InstallationIntegrityModalHost`    | 后端启动失败                    | 合理，后端死了，关掉也没有可回去的地方 |
| `RuntimeFailureDialogs`（本次这条） | 应用**运行中**收到 runtime 事件 | **不合理**                             |

后者触发时应用是活的（用户截图里聊天还在处理中、模型是 deepseek），却被一个关不掉的模态框挡住，把「Claude 用不了」放大成「应用用不了」。同一文件里**非**完整性的运行时失败分支本来就带 `okText`，可见这是继承来的姿态而非有意设计。已按路径区分：运行时路径可关（`closable` + 「继续使用」按钮），后端启动路径维持不可关。

> ⚠️ 严格说 Esc 一直能关（Arco `escToExit` 默认 `true`），所以补的是**看得见的出口**，不是从无到有。

**文案也是错的**：正文写「请重新安装最新版 One Work」，但按 §2.6.2，07-29 之后所有包都 100% 复现，重装拿到的是同样坏的包；「请检查杀毒软件是否隔离」还把打包缺陷归给用户环境。更糟的是撞上缓存机制——真正受害的是全新安装用户，而重装**不会**创建那个缓存。已改为：说明哪个组件不可用、其余功能不受影响、两种可能原因并列而不预设，并把诊断报告作为真正有用的下一步（13 语言）。

---

## 3. 快速诊断技巧（省时间）

- **哪个 step 挂了**：`gh run view <id> --repo gaogg521/1oneUI --json jobs`，遍历 `jobs[].steps` 找 `conclusion=failure`。
- **3 秒零步骤失败** = 账号/billing 层面，走 §1.2 的 check-runs annotations。
- **别翻 CI 大日志找 gate 失败，本地复现更快**：`bun run format:check`（列出未格式化文件）/ `bunx tsc --noEmit` / `bunx vitest run`（列出失败测试文件）。
- **省 Mac CI 钱**：Mac runner 慢又（私有时）贵，触发前先本地把 `format:check` + `tsc` 跑绿，避免为一个格式/类型错白烧一个 30–45 分钟的 cycle。

---

## 4. 版本号规则

- **1oneUI**：`package.json` `version` patch+1（如 `2.1.48`→`2.1.49`），`electron-builder.yml` 读 `${version}` 不用改；同时把 `aioncoreVersion` 指向新的 1oneCore tag。
- **1oneCore**：`Cargo.toml` `[workspace.package] version`。上游基线没变时**只 bump fork 后缀**（`0.1.49-one.1`→`0.1.49-one.2`）；上游基线变了才动前面（`0.1.48-one.1`→`0.1.49-one.1`）。
- exe 内部名（`1onecode.exe`）、appId（`com.huanle.oneone.ai`）**不随版本/品牌走**（改了会丢用户 userData，见品牌红线）。

---

## 5. 产物命名与 COS 布局

- 安装包名：`One-Work-<ver>-<os>-<arch>.<ext>`（electron-builder `artifactName`）。win: `.exe`，mac: `.dmg`。
- **App 自动更新源**（electron-updater 轮询）：COS `releases/latest.yml`（根）+ `releases/<ver>/One-Work-...` + `releases/<ver>/latest*.yml`。
- **官网下载**（`work.1oneclaw.com`）：`D:\website\1onework\src\site.config.js` 的 `release.version` + download URL，历史上指向 COS 根的旧名 `1ONE-Code-...`，发新版要一并对齐到实际上传的对象。

### ⚠️ 5.1 只出了一个平台的包时，别整体 bump 官网版本号

官网三个下载按钮（win / mac-arm64 / mac-x64）的 URL 都是**按版本号拼**出来的：`releases/{version}/One-Work-{version}-{os}-{arch}.{ext}`。Windows 在本机打、macOS 走 CI，两者**不一定同一轮出包**——这时把全局 `release.version` 一改，没出包的那个平台链接直接 404，而页面看上去一切正常。

2026-07-31 发 2.1.51 时实测：`sync-changelog-to-site.js` 会顺手把 `release.version` 改成新版本，两个 mac 链接当场变成 404（`curl -sI` 实证）。已给 `site.config.js` 加 `release.platformVersions`（`{win, mac}`，缺省回落 `release.version`），某平台这轮没打包就把它留在上一个真实存在的版本上。

发布后**必须按 URL 而不是按文案验收**——文案改对了不代表对象存在：

```bash
node -e "import('./src/site.config.js').then(m=>{const d=m.site.downloads;for(const k of ['windows','macArm','macIntel'])console.log(k,d[k].versionLabel,d[k].url)})"
```

再把打印出的三个 URL 逐个 `curl -sI` 确认 200。i18n 文案在 `src/i18n.js`（zh/en 两套）+ `index.html` 静态 fallback，同样要按平台分别改，别全局替换。

---

## 6. COS 上传 —— ⚠️ 首选本地 aws-cli，别指望 CI

**2026-07-21 和 2026-07-26 两次发布，`release-distribute.yml` 的 CI→上海 COS 网络路径都传不动**（07-21 卡 2 小时+被取消；07-26 连续两次卡满 20 分钟超时，且传输量越大越慢——215 KiB/s 掉到 123 KiB/s，是系统性限速不是偶发抖动）。**这不是配置问题**（元数据校验/virtual寻址/multipart阈值三个真坑早就修过了），就是 GitHub Actions 出口到国内 COS 这条链路本身不可靠。

**结论：直接用本地 aws-cli 上传，不要先跑 CI 等它超时再切换**（省 20-40 分钟）：

1. 检查本机是否已有 aws-cli：`Get-Command aws`（PowerShell）。如果只在 Git Bash 里找不到，先查 PowerShell 的 PATH，两个 shell 的 PATH 不共享。
2. 没装的话优先 `python -m pip install --user awscli`（用户态，不用 UAC）。**别用 `winget install Amazon.AWSCLI`**——它的 MSI 装到一半要 UAC 确认，非交互会话里会直接 exit 1602（"用户取消安装"），卡在这走不下去。pip 装的 `aws.cmd` 在 `%APPDATA%\Roaming\Python\Python3xx\Scripts\`，不在系统 PATH，要用绝对路径调用。
3. **凭据（2026-08 起改了机制）**：公司安全改造后不再发长期 AK/SK，改成 **Token（凭据 Key）+ SignKey（签名密钥）** 换取短期 ak/sk。`~/.aws/credentials` 里的历史长期凭据已作废，别再用。取凭据走仓库脚本 [`scripts/fetch-cos-credentials.js`](../../scripts/fetch-cos-credentials.js)，详见下面 §6.1。**Token / SignKey 绝不贴进对话、绝不写进仓库**，只放本机环境变量或 GitHub Secrets。
4. 配 COS 兼容参数（两个真坑）：`aws configure set default.s3.addressing_style virtual`（COS 拒绝 path-style）+ `aws configure set default.s3.multipart_threshold 5GB`（COS 分片上传缺 Content-Length 会拒绝，抬阈值让几百MB的安装包走单次 PUT）。
5. 上传：`aws s3 cp <本地文件> s3://1onework-1251001122/releases/<ver>/ --endpoint-url https://cos.ap-shanghai.myqcloud.com --acl public-read`，版本目录传完再把 `latest*.yml` 单独 cp 一份到 `releases/` 根（App 自动更新轮询这里）。本地网络路径通常 10-20 MiB/s，几百MB到1GB+的量几分钟传完。
6. CI 工作流 `release-distribute.yml` 仍保留作为"网络路径好的时候能用"的自动化选项（Release published 事件自动触发），已修的 3 个真坑同上；只是别死等它，`--timeout-minutes 20` 一超时就直接转本地方案，不用重跑 CI 第二次。
7. 验证（公开读，不需要凭据）：`curl https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/latest.yml`，以及 `releases/<ver>/` 下每个安装包 `curl -o /dev/null -w '%{http_code}'` 应为 200。

### 6.1 取短期 COS 凭据（Token + 签名，2026-08 起）

签名口径由凭据服务给定：`payload = token={token}&Timestamp={unix秒}`，`hmac-sha256`/`hmac-sha1` 取 `hex(hmac(signKey, payload))`，`md5` 取 `hex(md5(payload + signKey))`；POST `{"token":…,"Timestamp":…,"sign":…}`，返回 `{"code":0,"data":{"ak","sk","expire_at"}}`。脚本已封装，**别手搓 openssl**。

端点（**2026-08-06 实测可用**）：`https://codo-honeypot.123u.com/api/honeypot/oapi/qcloud/alloc`，算法 `hmac-sha256`（脚本默认，实测一次通过）。两个必填环境变量（PowerShell）：

```powershell
$env:COS_ALLOC_URL='https://codo-honeypot.123u.com/api/honeypot/oapi/qcloud/alloc'; $env:COS_ALLOC_TOKEN='<凭据 Key>'; $env:COS_ALLOC_SIGN_KEY='<签名密钥>'
```

算法哪天改了再加 `$env:COS_ALLOC_SIGN_ALGO='hmac-sha1'`（或 `md5`），要和凭据服务网页上配的一致。

然后把凭据注入当前 shell，再照常跑 `aws s3 cp`：

```powershell
node scripts/fetch-cos-credentials.js --format ps1 | Invoke-Expression
```

Git Bash / CI 之外的 bash 用 `eval "$(node scripts/fetch-cos-credentials.js --format sh)"`。脚本按需设置 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`，返回体带 session token 时一并设 `AWS_SESSION_TOKEN`（没有则显式清掉，防上一次的残留串味）。

**凭据形态（2026-08-06 实测）**：返回的是 `AKID` 开头的普通 ak/sk，**不带 session token**，有效期约 **7 天**——所以一次发布全程够用，不必中途重取。但别把它当长期凭据缓存进 `~/.aws/credentials`，每次发布现取即可。脚本在剩余有效期不足 15 分钟时会在 stderr 警告；上传中途报 403 / `InvalidAccessKeyId` 基本就是过期，重取一次即可。

#### ⚠️ 所有凭据的权威副本在 `C:\Users\allenzhao\Desktop\feishu.txt`

这个文件在**所有仓库之外**，含（只列类别）：飞书 App ID/Secret、**COS 的 BASEURL /
SignKey（`COS_ALLOC_SIGN_KEY`）/ Token（`COS_ALLOC_TOKEN`）**、豆包与 Agnes 的模型 KEY、
License 签发的 SECRET 私钥与 PUBLIC 公钥。

**三条规则**：

1. **绝不提交，也绝不复制任何值进仓库。** 2026-08-16 已按真实值扫过三仓全部历史提交：
   真密钥零命中；唯一命中是 License 的 **PUBLIC 公钥**
   （`crates/one-billing/src/license_key.rs`），那是刻意提交的、不是泄露。
2. **绝不贴进对话。** 读取时用脚本直接注入环境变量，输出一律脱敏（只报长度/有无）。
3. **要密钥先来这个文件找，别翻历史会话记录。** 2026-08-16 我为取 COS 凭据去翻 8-07 的
   会话 `.jsonl`，拿到一把**过期的**，据此断言"token 过期了，你去重新签发"，浪费了一轮。

⚠️ 文件里 COS 那行的 `BASEURL` 是**基地址**，脚本需要的是完整 alloc 路径
`https://codo-honeypot.123u.com/api/honeypot/oapi/qcloud/alloc`。

#### 三个错误码怎么读（凭据服务自己的定义）

| code   | 含义                                                                |
| ------ | ------------------------------------------------------------------- |
| `2001` | token 无效：不是最新 Token、与 SignKey 混用了、或带了多余空格/换行  |
| `2010` | 签名失败：SignKey / 算法 / Timestamp 不对（算法就是 `hmac-sha256`） |
| `5000` | 云厂商签发失败 —— **看 `reason` 字段，别看 `message`**              |

**把算法换一遍就能定位在哪一层挂的**：`hmac-sha1`/`md5` 报 `2010` 而 `hmac-sha256` 报别的，
说明签名与 token 都过了，故障在更下游。

#### `5000` 实战：子账号有一把 Inactive 的 AK 卡住配额

2026-08-16 实测原始报文：

```json
{
  "code": 5000,
  "message": "云厂商签发失败",
  "reason": "sub-account has a disabled access key (AKID4we8… is Inactive) on cloud"
}
```

腾讯/阿里/火山一致：**子用户 AK 配额通常只有 2 把**。一把在云控制台被**停用但没删除**时，
它照样占位，于是 alloc 签不出新的。本次那把正是 `~/.aws/credentials` 里 2026-07-21 缓存的
长期 AK——所以"把旧 AK 留在那儿不管"会在一个月后变成发布卡死。

**解法**：去腾讯云控制台把那把 Inactive 的密钥**删掉**（禁用无用，禁用状态本身就是占位原因）。

`~/.aws/credentials` 现已清空并留了说明（备份在同目录 `.disabled-akid-2026-08-16.bak`）。
**短期凭据只进程内生效，永远不要写回这个文件**。

⚠️ `scripts/fetch-cos-credentials.js` 原本只打印 `message`、把 `reason` 丢了，于是这个可修的
问题看起来像"云厂商挂了"。已修为一并输出 `reason`。

### ⚠️ 6.2 GitHub 托管 runner 从此彻底用不了 —— 凭据服务在内网

**2026-08-06 实测坐实（run [31101621547](https://github.com/gaogg521/1oneUI/actions/runs/31101621547)）**：两条 secret 都配好后跑冒烟，卡在换凭据这步，报 `fetch failed`。查明 `codo-honeypot.123u.com` 解析到 **`10.241.5.174`**——RFC1918 内网地址，只在公司网内可路由（本机 51ms 返回 200，公网 runner 连不上）。

**这不是配置问题，改 secret / 换算法 / 加重试都没用**，是路由层面的死路。三条出路：

1. **就走本地 aws-cli**（推荐，且本来就是 §6 的首选）——两次发布已经证明 CI→上海 COS 的带宽本来就不可靠，现在只是多了一个硬理由。**本轮已实测本地全链路通**：换凭据 → `aws s3 ls` 列出桶里 4 个版本目录。
2. 在公司网内架 **self-hosted runner**（要基建 + 安全评审）。
3. 找凭据服务方要一个**公网可达的端点**。

在选定 2 或 3 之前，`release-distribute.yml` 在 GitHub 托管 runner 上**必然失败**，工作流头部注释与失败提示都已写明，别再花时间调它。

其余配置（供将来接自建 runner 用）：仓库 Secrets 只需 **`COS_ALLOC_TOKEN` + `COS_ALLOC_SIGN_KEY`** 两条（端点作为非密钥默认值写在工作流 `env` 里，服务搬家时用 `COS_ALLOC_URL` secret 覆盖；算法非默认时加仓库变量 `COS_ALLOC_SIGN_ALGO`）；旧的 `COS_SECRET_ID` / `COS_SECRET_KEY` 已不再读取，可以删掉。**env 回落与 secret 打码这两条本轮已在真实 CI 日志里验证正确**，坏的只有网络这一环。

---

## 7. 实时核实命令

```bash
# 1oneCore Release 是否有齐 6 资产
gh release view v<core-ver> --repo gaogg521/1oneCore --json assets --jq '.assets[].name'

# 1oneUI Release 资产（Win + Mac 齐没）
gh release view v<ver> --repo gaogg521/1oneUI --json assets --jq '.assets[].name'

# App 自动更新源发没发
curl https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/latest.yml

# Mac 构建 run 状态
gh run list --repo gaogg521/1oneUI --workflow=build-manual.yml --limit 4 --json databaseId,status,conclusion,createdAt
```

---

## 8. 相关文档

- **v3.0.0 Mac"已损坏"根治 + `1onecode`→`One Work` 改名的完整过程**（含 §1.6 每条坑的现场细节、迁移代码、真机验证方法）：[`session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md`](session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md)
- 发布链路当前状态 + `release-distribute.yml` 4 个 CI bug 诊断：[`session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md`](session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md) §6
- Mac 签名/公证配置 + 老系统 Node 兼容 + 打 tag 流水线排障：[`session-2026-07-21-mac-signing-and-node-compat.zh-CN.md`](session-2026-07-21-mac-signing-and-node-compat.zh-CN.md)
- Fork 上手 / 本地 dev / 打包：[`fork-dev-onboarding.zh-CN.md`](fork-dev-onboarding.zh-CN.md)
- 发版只走官网 + COS、不发 GitHub Release：见 memory `release-channel-cos-website-only`
- 自动升级改指向自建 COS：见 memory `autoupdate-cos-repoint`
