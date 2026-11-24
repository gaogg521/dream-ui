# One Work 桌面端打包与发布手册（Playbook）

> **怎么读这份文档**
>
> - **第一部分**是现行流程，以最近一次完整发版 **3.0.18**（2026-11-13 夜 → 11-14，五个平台一次走完）为案例，
>   再按平台（Linux / macOS 两个架构 / Windows）分别写「怎么走、注意什么」。**照着第一部分走即可。**
> - **第二部分（附录 A–D）**是历史经验与踩坑（3.0.4 – 3.0.17 时期提炼），**原文完整保留**，放在最下面查阅。
>   它的 S0–S7、§2.x 编号沿用原文，正文内部的交叉引用依然有效。
> - 两部分冲突时**以第一部分为准**；已知的冲突点列在「附录说明」里。
> - 版本坐标：最新完整发版 **3.0.18**（钉 dreamcore v0.1.104）；2026-11-16 对 Linux 两个包做过一次同版本号覆盖补发（见 §1.4）。
>   「当前发布状态」永远用实时命令查（附录 D），别信文档里写死的快照。
> - **开局先读最新一篇发版记录**：`dream-en/docs/release-record-<日期>-<版本>.zh-CN.md`（3.0.18 的是
>   `release-record-2026-11-14-3.0.18.zh-CN.md`）。打包范围、对象数、惯例会演进，别按记忆里的旧版数走。

---

## 第一部分：现行流程（以 3.0.18 为案例）

### 1.1 3.0.18 是怎么发出去的

**版本坐标**

| 项             | 值                                                                  | 备注                                                                                                     |
| -------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 桌面版本       | **3.0.18**                                                          | 发版提交 `86b2bdc4`，随后 `2411725a` 把更新说明日期对齐到出包日 11-14                                    |
| dreamcore 钉版 | **v0.1.104**                                                        | 交接时已发布、一次性到位，无追钉；tag 与 dream-core main 零差异                                          |
| dream-engine   | `16e5aea`                                                           | 由 dream-core 的 `Cargo.lock` 固定，4 条引擎改动全部随包                                                 |
| 更新范围分界   | 旧桶 3.0.17 的 win exe `Last-Modified` = 11-07 09:47（+8）          | 用安装包的产出时间，**不是** release 提交时间                                                            |
| 出包           | 五腿一次发齐（11-14 00:04 +8 dispatch），全部一次绿                 | linux-x64 **11.5** / linux-arm64 **17** / windows-x64 **26** / mac-arm64 **23** / mac-x64 **34**（分钟） |
| COS 对象       | **17 个**：11 个安装包/blockmap + 5 份根清单 + 1 个更新说明 sidecar | 两个桶都传齐                                                                                             |
| 官网           | 四个版本钉 + 五个尺寸 + changelog 条目                              | 全程收口约 11-14 凌晨 3 点（+8）                                                                         |

**八个阶段与 3.0.18 的实际做法**

| 阶段               | 做什么                                                                                                                           | 3.0.18 的实例 / 判据                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 预检            | 四仓本地 = `origin/main`；CI 绿；磁盘余量；**上版时点 = COS `Last-Modified`**；目标版本 semver 必须大于线上版本                  | 预检五腿一次过。详细命令见附录 A 的 S0                                                                                                                          |
| P1 划界 + 扫漏     | 以 P0 的时点做 `git log --since`，**四仓**全量扫；用户可见的逐条映射进更新记录，可合并、**不许漏**；后端独有的 fix 最容易漏      | dream-ui 16 条用户可见全部映射；core 用 tag 范围、engine 用 `Cargo.lock` 范围复核，与时间扫描零差异。产出 `docs/release-notes/3.0.18.json`（zh/en × 单机/企业） |
| P2 钉版            | `package.json` 的 `dreamcoreVersion` 指向已发布的 dream-core tag；**验真三件套缺一不算验过**                                     | ① 11 个关键修复 `merge-base --is-ancestor` v0.1.104 ② zip 对 `dreamcore-checksums.txt` 算 SHA-256 ③ 二进制里 grep 生产代码独有文案（5/5）+ 对照串证明手段有效   |
| P3 发版提交        | `version` + `dreamcoreVersion` + release-notes，一个 `chore(release): <ver>` 提交推 `main`                                       | 直接在 main，不开分支不开 PR，提交信息中文、无 AI 署名                                                                                                          |
| P4 并行出包        | `build-manual.yml` 一次发齐五个平台，`installers_only=false`，记下每个 run id                                                    | 五腿同时 dispatch。Mac 腿最先发、全程盯                                                                                                                         |
| P5 产物落地核验    | `download-gh-artifact.sh` 逐平台下载（GitHub digest 校验）→ 各平台自己的验收（见 §1.3）                                          | 五制品全过 digest；六个安装产物 sha512 与清单逐字一致                                                                                                           |
| P6 传 COS          | `publish-cos-release-asset.sh` 一次写**两个桶**；**安装包先、`latest*.yml` 最后**；别忘更新说明 sidecar                          | 凭据预检提前到上传前做；17 对象逐个传双桶；arm64 的 Mac 清单改名 `latest-arm64-mac.yml`                                                                         |
| P7 官网切版        | 只在**主工作区**构建 → 和线上逐文件比 sha256 → 部署 → 再比一次 → 读线上 bundle 里的版本钉                                        | 部署前 188 个文件相同、仅 index/updates 两处差异；部署后 193 个文件 0 差异；`win/macArm/macIntel/linux:"3.0.18"` 四钉齐                                         |
| P8 终验 + 发版记录 | **不看文案看 URL**：两个桶每个对象 HEAD 200 且 `Content-Length` = 本地字节数；根清单两桶都是新版本且与产物逐字节相同；写发版记录 | 两桶 17 对象逐个核对；发版记录落盘 `dream-en/docs/release-record-2026-11-14-3.0.18.zh-CN.md`                                                                    |

> **发版日期 = 出包日期**：出包完成才算发版（3.0.18 的更新说明日期因此从 11-13 改成 11-14）。

### 1.2 跨平台通用红线

**流程与仓库**

- 只在 `main` 上干活，直接提交推送；**提交信息中文**（type 前缀保留英文），**不加任何 AI 署名**；绝不 force push；
  每次 push 前先 `git fetch`（并行会话也在往 main 推），被拒就 `git pull --rebase`。
- **发版窗口内不往 dream-core 推 build-relevant 提交**（`crates/`、`Cargo.toml`、`Cargo.lock`、`.cargo/`）——
  预检是每个平台各自的显式步骤，会把后面几条腿全拦掉（3.0.17 就这么栽过）。被拦就追最新 tag 重钉重验。
- **不要用 `DREAM_SKIP_PREFLIGHT=1`**，除非已确认被拦的提交与本版无关，并在发版记录里写明。
- 预检把**已跟踪文件被删除**也算「未提交改动」（3.0.18 交接时 `resources/远程连接.png` 就是这样），
  而 `README.md` 还在引用它——**自己判断，别停下等人**：默认恢复它（`git checkout -- <文件>`，最保守、不丢东西、README 不裂图），
  除非能确认是有意删除并同时处理了引用；处理了就在发版记录里写一句。未跟踪文件（`.tmp-*.mjs` 等）预检忽略，别 `git add -A`。
- 凭据（feishu.txt）绝不进仓库、不贴对话、不写日志。

**出包**

- Windows 正式包从 `main` 运行 Manual Build，保留默认开启的 `sign_windows_release`；正式 tag 构建也会开启。凭证存放在 GitHub Actions Secrets（`SSLTRUS_ACCESS_KEY`、`SSLTRUS_ACCESS_SECRET`），证书编号存放在 Actions Variable（`SSLTRUS_CERT_CODE`）。
- 构建日志中搜索 `Verified Windows signature and timestamp` 可核对验签。下载后在安装包的「属性 → 数字签名」中确认签名者为「上海言绪科技有限公司」。续期换证时更新签名钩子的预期指纹，并按需要更新签名凭证及证书编号。

- **五个平台一次发齐**（`platform=macos-arm64 / macos-x64 / windows-x64 / linux-x64 / linux-arm64`），别只发 Mac 等后面补
  （3.0.14 实际发生过，Linux 晚了 20 分钟）。Mac 腿最先发、全程盯。
- **dispatch 前先 `gh release view v<X> --repo gaogg521/dream-core --json assets` 确认六资产已全部发布**（tag 打出来 ≠ 资产发布完，
  Release 工作流还要十几分钟）。3.0.19 当晚资产没发完就 dispatch，五腿全被预检正确拦下（`release v0.1.106 has no dreamcore-v0.1.106-<target>.tar.gz`），
  白烧一轮；等资产齐后 rerun 即可（headSha 不变）。Windows 腿另见 §1.6 的 bsdtar 修复。
- `installers_only` 必须是 **false**：Mac 自动更新走 `.zip` 而不是 `.dmg`，传 `true` 会在上传前把 zip 和清单删掉。
- **`build-manual.yml` 先跑 Code Quality（含全量 vitest），红了所有平台全部 skipped、没有产物**。
  pre-push hook 只跑 `--changed`，所以别处引入的全局断言失败只会在 dispatch 之后才红。dispatch 前先本地把
  `format:check` / `tsc` / 全局约束类测试跑绿，别为一个格式错烧一轮。
- 同一提交「一条腿绿、另一条腿红」先怀疑 flake，见 §1.3.1「CI」。

**上传**

- **两个桶都要写**，两套凭据互不通用；`latest*.yml` 在两个桶都对，已装用户才会收到更新。别只传一个桶就切官网。
- 顺序固定：**安装包先、清单最后**（清单一旦可见，它指向的文件必须已在）。
- 凭据和上传放在**同一次 Bash 调用**里（`fetch-cos-credentials.js` 只有 env 里已有 `COS_ALLOC_*` 才能换临时凭据）。
- 验新桶读权限时别带着旧桶的 `AWS_*` 环境变量（3.0.18 就因此虚惊过一次「AccessDenied」，是自己的 own goal）：
  用 `unset AWS_SESSION_TOKEN` + 显式设新桶 key。
- **GitHub 托管 runner 往上海 COS 传大文件会卡死**，永远本地 aws-cli（或办公网 runner）；`publish-cos.yml` 的真实上传步骤
  至今没在真发时跑过、步骤日志 blob 404，3.0.17/3.0.18 都走手动路径（下载 → prepare → publish）。

**官网**

- 只能在**主工作区** `D:\website\1onework` 构建（`npx vite build --outDir <临时目录>`），**不能**用干净 worktree 或某个提交——
  线上有工作区未提交的内容，部署脚本先清空线上目录再解压；干净 worktree 里 `core.autocrlf=true` 还会把全部文本文件换成 CRLF。
- 部署前和线上**逐文件比 sha256**，应当只差 `main-*.js` 与引用它的 `index.html`；部署后再比一次应 100% 相同。
- `DEPLOY_OK` 不代表构建过（`npm run build` 失败时脚本照样推旧 dist）：**必须读线上 `main-*.js` 里的 `win:"<ver>"` 等钉**。
- `LEGACY_LAST_VERSION` 是「旧桶里最后一个版本」，不是当前版本，**别当版本号改**（3.0.18 保持 3.0.17 未动，所以 3.0.18 的链接自然指新桶）。
- 官网仓加临时输出目录前**先写 `.gitignore`**：3.0.18 因 `git add -A` 把 `.deploy-tmp-3018`（231 个构建文件）带进了提交，
  只能不 force、后续提交移除并忽略。
- `platformVersions` 四个键（win / macArm / macIntel / linux）各自独立，`platformSizes` 五个尺寸与版本是同一个事实，一起改
  （尺寸 = 实际字节数 ÷ 1048576 取整）。

**这些是常识，自己决定，不要停下来问用户**（用户 2026-11-16 明确说过）：

- **覆盖线上已有对象**：发新版覆盖根清单 `latest*.yml` 本来就是正常动作；同版本号覆盖补发（§1.4）也直接做——照 §1.4 先备份、核对 dreamcore 钉版、
  两个桶都写、从公网回读校验即可，不用先请示。
- **预检要求 `DREAM_SKIP_PREFLIGHT`**：先追最新 tag 重钉重验；确认被拦的提交与本版无关才跳过，并在发版记录里写明原因。判断是你的，写清楚就行。
- **功能要不要写进更新说明**：**用户可见的功能更新一律写进去**（3.0.18 的「外网访问隧道」就是这样），不用问。
- **某个平台反复失败**：按「增量收口」处理——其余平台先发，这一条腿写好配方挂起，别为一条腿拖死整场。

**唯一的边界是企业版：它是单独发的**（升级走另一条线，见 `dream-en/deploy/OFFLINE-BUNDLE.md`），**不混进桌面发版**，桌面发版时不用考虑「要不要同批发」。

### 1.3 分平台指南

五个包的产物与 COS 对象（3.0.18 实测）：

| 平台             | CI 腿（`platform=`） | COS 对象                                               | 根清单                             | 3.0.18 CI 时长（健康基线） |
| ---------------- | -------------------- | ------------------------------------------------------ | ---------------------------------- | -------------------------- |
| Linux x64        | `linux-x64`          | `…-linux-amd64.deb`（**amd64，不是 x64**）             | `latest-linux.yml`                 | 11.5 分钟（4–10）          |
| Linux arm64      | `linux-arm64`        | `…-linux-arm64.deb`                                    | `latest-linux-arm64.yml`           | 17 分钟                    |
| macOS Apple 芯片 | `macos-arm64`        | `mac-arm64` 的 dmg / dmg.blockmap / zip / zip.blockmap | `latest-arm64-mac.yml`（**改名**） | 23 分钟（12）              |
| macOS Intel      | `macos-x64`          | `mac-x64` 的 dmg / dmg.blockmap / zip / zip.blockmap   | `latest-mac.yml`                   | 34 分钟（16）              |
| Windows x64      | `windows-x64`        | `…-win-x64.exe`（**只有 exe，没有 blockmap/zip**）     | `latest.yml`                       | 26 分钟（15）              |

另外每版一个更新说明 sidecar：`releases/<ver>/release-notes.md`（应用的更新弹窗读它，忘了就没有更新说明）。

#### 1.3.1 Linux（x64 + arm64）

**怎么走**

1. 触发：`gh workflow run build-manual.yml -R gaogg521/dream-ui -f platform=linux-x64 -f installers_only=false`（arm64 同理）。
   下载用 `scripts/download-gh-artifact.sh <owner/repo> <run_id> <artifact名> <目录>`（带 size + sha256 校验，每次从空文件开始），别裸 `gh run download`。
   CI 产物名 `linux-build-x64-<sha7>` / `linux-build-arm64-<sha7>`，只含 deb + 清单 + `builder-debug.yml`。
2. 核验：deb 的 sha512 = 清单（`openssl dgst -sha512 -binary` + `base64`）；`dpkg-deb -f <deb> Architecture Version`；
   `app.asar` 是明文拼接格式，直接 `grep -a` 独有字符串即可；内置 `dreamcore` 的 manifest（`resources/bundled-dreamcore/*/manifest.json`）
   `sourceType` 必须是 `download`/release、`version` = 本轮钉版。
3. 上传与官网同 §1.2。Linux 只有 deb，没有 AppImage / rpm，只覆盖 Debian/Ubuntu 系；包名 `1one-claudecode`，装到 `/opt/One Work`，
   `/usr/bin/onework`。依赖只有 gtk3 / nss / libxss / libsecret 等库，**不依赖桌面环境**。

**无桌面服务器：`onework --webui`**

| 症状                                                                                                                | 病根 / 解法                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 无 DISPLAY 时 `onework --webui` 直接退出，日志 `Missing X server or $DISPLAY` / `The platform failed to initialize` | Chromium 在主进程 JS **之前**就选好 Ozone 平台，`configureChromium.ts` 里 JS 的 `appendSwitch('ozone-platform','headless')` **从来没生效**（实测主进程 JS 先跑、X 报错随后）。只有真实命令行参数管用                                                           |
| 修复（`57a72542`）                                                                                                  | `utils/headlessRelaunch.ts`：Linux + `--webui`/`--resetpass` + 命令行无 `--ozone-platform` → `app.relaunch(+ --ozone-platform=headless --disable-gpu)` + `app.exit(0)`，放在 `configureAppDataProfile` **之前**（一次性进程不碰 userData）。已带该参数则不重启 |
| 副作用                                                                                                              | 终端里敲 `onework --webui`，第一个进程立刻退出、真进程在后台起；**systemd 托管请直接写全参数**（`onework --webui --ozone-platform=headless --disable-gpu`，不会触发重启）                                                                                      |

给用户的口径：**有桌面** → 下载 deb，双击（由系统软件安装器安装）或 `sudo apt install ./One-Work-*.deb`，之后从应用菜单启动；
**无桌面** → 装 deb 后 `onework --webui`（修复发布前的旧包必须写全 `--ozone-platform=headless --disable-gpu`），浏览器访问
`http://<ip>:25808`（`DREAM_PORT` 可改）。首启没有可见初始密码，用 `onework --resetpass` 或后端 `POST /api/webui/reset-password` 取新密码。

**CI（Linux 腿经常最先暴露的问题，其实对所有平台都适用）**

- Code Quality 红了所有平台全部 skipped。读失败原因：`gh run view <id> --log-failed`，日志里 ANSI 有两种写法（真 ESC 与字面 `^[[`），
  `sed -E 's/\x1b\[[0-9;]*m//g; s/\^\[\[[0-9;]*m//g'` 两条都要剥，再搜 `FAIL|AssertionError`，别被满屏 warning 淹没。
- **确定性红**：如 `arcoPaletteVarSyntax`（`text-[rgb(var(--primary-6))]` 这类失效 UnoCSS 写法，3.0.18 实际由手机端底部导航带进来，
  已改 `rgba(var(--primary-6),1)`）。要修，不能 rerun。
- **flake**：如 `mermaidBlockPanZoom`、`EnterpriseServerCard`（并发时序）。**同一提交 x64 绿、arm64 红 = 先怀疑 flake**（3.0.18 实际发生）：
  本地单跑 3 次全过 → `gh run rerun <id> --failed`（只重跑失败 job），别改产品代码、别重新 dispatch 整个 run。

**在 WSL 里验真包（x64）**

1. `dpkg -i`（root）装上后先证明包里有修复：`grep -c <独有字符串> "/opt/One Work/resources/app.asar"`（符号名不可靠，用独有字符串）。
2. `env -u DISPLAY -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE HOME=<真实目录> DREAM_PORT=<空闲端口> onework --webui &`，
   轮询 `curl http://127.0.0.1:<port>/` 到 200；再读 `/proc/<pid>/cmdline` 确认被补成 headless、`environ` 里没有显示变量。
3. 再测一次显式全参数写法，确认不会被重复重启。
4. 收尾只杀自己那棵：`pkill -x onework`（**不要 `pkill -f`**，它会匹配并杀掉你自己那条 bash 命令行）。

**测试环境的坑**

- WSL 的 `/tmp` 随 VM 关闭清空：把测试 HOME 指到 `/tmp/...` 且目录没了，Electron 报 `Path must be absolute`（`configureAppDataProfile`），不是产品 bug；HOME 放 `/home/<user>/` 下。
- 该 WSL 里 uid 999 的 `dreamcore` / `dreamcore-admin` 是企业版 QA docker 栈，不是自己起的，别杀。
- Bash 工具会吞反斜杠：往 JS 里注入含 `\n` 的字符串用 Python + `chr(92)`，别在 heredoc 里写 `\\n`。
- 后台命令通知里的 `exit code 0` 是外壳的，**必须读 output/log 文件**才知道成没成。
- 检查 deb 内容的路径含空格（`/opt/One Work/…`），脚本里 `file`/`ls` 一律加引号，别用不带引号的 `$(ls …)`。
- **x86 开发机无法真机运行 arm64 包**（WSL 里也没有 qemu-user）。arm64 实际只能验到这四层，别在文档/汇报里写成「已真机验证」：
  ① 下载 sha512 = 清单；② `dpkg-deb -f` 的 `Architecture: arm64`；③ 主程序与内置 `dreamcore` 都是 `ELF … ARM aarch64`、manifest 的 `arch` 为 arm64；
  ④ `app.asar` 里含修复代码的独有字符串。运行行为靠 x64 同代码的端到端验证外推；要真机验证需要一台 arm64 Linux。

#### 1.3.2 macOS（Apple 芯片 arm64 + Intel x64）

**两条腿的差别**

| 项          | mac-arm64                                                         | mac-x64                                          |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| runner      | `macos-15`（arm）                                                 | **原生 Intel 的 `macos-15-intel`**，不再交叉构建 |
| 3.0.18 时长 | 23 分钟（健康基线 12）                                            | 34 分钟（健康基线 16），一次成功                 |
| 清单文件    | CI 产出 `latest-mac.yml`，**发布时改名为 `latest-arm64-mac.yml`** | `latest-mac.yml`（不改名）                       |
| Mach-O      | `cputype` = `16777228`                                            | `cputype` = `16777223`                           |

每架构 5 个对象：dmg / dmg.blockmap / zip / zip.blockmap / 清单。改名规则是 electron-updater 按 `${channel}-mac.yml` 拼清单名、
arm64 的 channel 是 `latest-arm64` 决定的，`prepare-release-assets.sh` 已内置，别手改。

**怎么走**

1. **最先 dispatch、全程盯**（Mac 是唯一会连挂数小时的腿；3.0.14 两次失败都是事后一小时才发现）。`installers_only=false`。
2. 下载：两架构并行，每个约 600 MB，公司网络对 gh 限速可低到 ~70 KB/s——用 `download-gh-artifact.sh`，按平台**并行**发起，别串行排队。
3. **落地前必须核验「签名 + 公证」，CI 绿不算**：zip 里要有 `onework.app/Contents/_CodeSignature/CodeResources`（签名）和
   `onework.app/Contents/CodeResources`（**公证票据**，缺它就是只签名没公证的包，**不许发布**）。Windows 上没法跑 codesign，用存在性核验：

   ```python
   import zipfile, glob
   n = zipfile.ZipFile(glob.glob("*.zip")[0]).namelist()
   print("签名:", any(x.endswith(".app/Contents/_CodeSignature/CodeResources") for x in n))
   print("公证票据:", any(x.endswith(".app/Contents/CodeResources") for x in n))   # 必须是 True
   ```

   再读主程序 Mach-O 头的 `cputype`（见上表）确认架构没装反；asar 抽查从 zip 里解 `onework.app/Contents/Resources/app.asar`。

4. 上传顺序：dmg / zip / blockmap 先、`latest*.yml` 最后；两个桶都写。

**注意什么**

| 症状 / 场景                                             | 真因 / 做法                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 两条 Mac 腿 Build 步**秒级 cancelled**                  | GitHub 下线了 `macos-14` 镜像（annotation：`config … is not supported`）。已换 `macos-15`。再遇到秒级失败**先看 annotation**，别猜代码；私有仓的 macOS 10 倍计费拦截也是几秒失败、steps 空，看 check-runs annotations                                                                                            |
| mac-x64 卡在 `signing file=out/mac/onework.app`，无输出 | **钥匙串自动锁定**（`codesign→…→SSKey::getAcl→mach_msg` 在等无头机永远不会出现的授权弹窗）。已修（`a22c1e34`）：`set-keychain-settings -lut 21600` + 构建期间每 60 秒 unlock + 60 秒有界 warm-up 签名。完整记录见附录 B 的 §2.1.1                                                                                |
| mac-x64 超过 25 分钟                                    | **3.0.18 订正**：25 分钟是「准备收口」的警戒线，**不是「立刻杀」的信号**。3.0.18 的 mac-x64 在警戒线告警后**未干预、未 rerun**，34 分钟自行完成（公证三连 + 产物票据双核验过）。再现 >25 分钟时先看 Apple 公证排队时长再定性；单次尝试上限 40 分钟，卡死会带 `[wd]` 采样栈诊断失败。**别调大超时、别盲目 rerun** |
| 构建全绿、产物齐，但 `.app` 里没有公证票据              | `afterSign.js` 在签名校验不过 / Apple 凭据缺失时只打印 `Skipping`。已加闸门（`99bd3bd0`），日志里应依次出现 `[sign-evidence]` 的三连：`properly code signed` → `Starting notarization` → `Notarization completed successfully`；**判据永远是下载产物查 `Contents/CodeResources`**                                |
| 签名成功但装机报「已损坏」                              | `IDENTITY` secret 只填证书 CN、**不带** `Developer ID Application:` 前缀；签名失败的兜底重试会产出假绿，验收只认三连                                                                                                                                                                                             |
| 一条 Mac 腿反复失败                                     | **增量收口**：其余平台先发，这一条腿写好配方挂起。先发的批次**不要带那条腿的 `latest*.yml`**（根清单里它停在上一版，已装老用户不会被推一个不存在的包），官网对应的钉也留在上一版；补发时再写它的 `latest*.yml` 并切官网那一个钉（3.0.17 的 Intel Mac 就是这么补发的）                                            |
| 超时被杀后看「最后 40 行」推算耗时                      | **错的**：转储里所有行的时间戳都是被杀那一刻。用 `gh api …/runs/<id>/jobs` 的时间戳对账                                                                                                                                                                                                                          |

#### 1.3.3 Windows（x64）

**怎么走**

1. **3.0.18 走 CI 的 `windows-x64` 腿**（26 分钟，与另外四腿同时 dispatch）。CI 能出 Windows 包是 3.0.17 起的事——
   `downloadBuilderToolset` 冷缓存首次下载会先往 stdout 打一行进度再写路径、脚本把整串当路径，本地热缓存永远不显现、CI 上 3/3 同因失败，
   已修（`7e4208ba`，取 stdout 末行）。**本机出包依然可用**：`cd /d/dream/dream-ui && bun run build-win:x64`（约 20 分钟）。
2. 产物只有 **`One-Work-<ver>-win-x64.exe` + `latest.yml`**（没有 blockmap / zip：安装包用 zip 载荷，不产 blockmap）。
   CI 产物名 `windows-build-x64-<sha7>`，下载后放到 `windows-build-x64/` 子目录，否则 `prepare-release-assets.sh` 会报
   `installer present without yml`（它按 `*/<platform>/*` 找清单，而下载脚本把制品拍平了）。
3. **验收六件（全过才传）**，命令与背景见附录 A 的 S5：① sha512 与 `latest.yml` 对账（`openssl dgst -sha512 -binary <exe> | openssl base64 -A`）；
   ② 版本资源 = 新版本；③ ACP 内嵌组件在包里且版本与 dream-core 常量逐字一致（附录 B §2.2，3.0.18 为 `codex-acp/1.1.2` + `claude-agent-acp/0.58.1`）；
   ④ asar 抽查失效类名 0 处；⑤ 只能在打包版验的项（内置联网搜索可用、`bundled-dreamcore` 的 `sourceType` 是 release 且 `version` = 钉版、
   内置技能数）；⑥ 「前端读后端返回值决定要不要弹框」的功能必须走真实点击路径。
4. 上传 `exe`（只进版本目录）→ `latest.yml`（自动镜像到根）→ sidecar，两个桶；官网切 `platformVersions.win` + `platformSizes.windows`。

**注意什么**

| 场景                              | 注意                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticode                      | **不签，是既定决策**：`NotSigned`、SmartScreen「未知发布者」与所有历史版本一致，是预期状态不是缺陷；发版验收不含 Authenticode，**别再提**                                                                                                                              |
| 本机出包前                        | 先确认没有 electron / dreamcore 的 dev 进程占文件，**杀按 PID 不按名字**；`out/` 被占（构建 EPERM）时用 Restart Manager 查谁锁着，别凭「有文件监视器」猜；绕开用 `ONE_BUILD_OUT_DIR=<别的目录>`                                                                        |
| **打包产物验证会碰真实 userData** | 设 `APPDATA` 隔离不了（Electron 走 `SHGetFolderPath`），应用照样打开真实的 `%APPDATA%\One Work`。验证前备份该目录，或接受「就是在生产数据上验」并只做只读观察；**清理只杀自己那棵进程树**（按启动时间认领根 PID），机器上常年有用户自己在跑的实例                      |
| 后端启动慢                        | 首屏后还要约 40 秒才 `Server listening`，探测太早会看到一串 `ERR_CONNECTION_REFUSED`，是时序不是故障；判据看 `%APPDATA%\One Work\logs\…\*.dreamcore.log`                                                                                                               |
| 打包版无法用 CDP 驱动 UI          | `app.isPackaged` 下应用调试端口被无条件拒绝（安全设计，别再试）。等效替代：`grep -a` `app.asar` / 包内 dreamcore；真实点击路径只能装到干净机器手动走。`bunx asar extract` 在本机会解包不完整，直接 `grep -a app.asar` 即可                                             |
| 安装耗时                          | 默认 `useZip: true` + `differentialPackage: false`（x64 静默安装约 109 秒，LZMA 约 238–334 秒）。**量安装耗时必须真装一次**，`7z t` 不落盘、会低估 8–12 倍                                                                                                             |
| 三个安装目录共用一个 appId        | `…\Programs\1onecode`、`One Work`、`onework` 共用同一个卸载注册表键，前两个是孤儿；`appId: com.huanle.oneone.ai` **冻结，永不改**（改了老用户自动更新全断）。别在扫目录时顺手清注册表（`installer-repair-heal.nsh` 已负责）。用户数据在 `%APPDATA%\One Work`，不受影响 |
| 预检里的「未提交改动」            | 已跟踪文件被删除也算（见 §1.2）；工作区未跟踪的 `.tmp-*`、`C：Users…release-assets-*` 目录预检忽略，不用清                                                                                                                                                             |
| `python3`                         | Windows 上是 Store 占位符，静默无输出，用 `python`；这个 shell 的 `ls` 带 `-F`，文件名后会多个 `*`，拼 URL 会得到假 404                                                                                                                                                |

### 1.4 同版本号覆盖补发（3.0.18 的 Linux headless 修复，2026-11-16）

3.0.18 发出后发现 Linux 无桌面启动有 bug，修复后**没有升版本号**，直接重打 linux-x64 / linux-arm64 并覆盖线上两个桶的同名文件。
这类操作的规矩：

- **先想清楚代价**：同版本号 = 清单 sha512 / 大小变了但版本不变 → **已装用户不会收到更新**，只有新下载的人是新包。要让存量用户拿到修复必须升版本发版。
- **覆盖前备份**线上旧清单（两个桶、版本目录和根各一份）和旧安装包；`publish-cos-release-asset.sh` 先传安装包、**最后**传清单。
- 脚本 `set -e`：第一个文件失败就整体停，两个桶都没被改，可安全重跑。
- **覆盖前先核对新包内置的 dreamcore 版本 = 线上同版本号其他平台/旧包的版本**：若 main 在发版后升过 `dreamcoreVersion`，新包会悄悄带上更新的后端，
  和线上 Windows/Mac 的同版本号不一致。查法：`dpkg-deb --fsys-tarfile <deb> | tar -x --wildcards './opt/One Work/resources/bundled-dreamcore/*/manifest.json'`
  读 `version`，与旧 deb 和 `package.json` 的 `dreamcoreVersion` 三者比对（3.0.18 都是 v0.1.104，一致才覆盖）。
- **别漏另一个架构**：x64 修了 arm64 仍是旧包，要么一起重打，要么明确告知（3.0.18 两个都重打了）。
- 官网链接 URL 不变、`platformVersions`/`platformSizes` 不用动（大小 ÷ 1048576 取整没变就不用重部署）；终验只看：从公网**重新下载**两个桶里的包，
  sha512 = 清单 = 新构建，别只看「上传成功」。
- **新桶 COS 凭据**：静态 key 是 `feishu.txt` 里「用户名 zhaogao」下面那一对 SecretId/SecretKey（末尾第二对）；
  「OSS存储桶：onework-1521070673」标题下面那一对对新桶是 `InvalidAccessKeyId`。写之前先用该 key `aws s3 ls s3://onework-1521070673/releases/<ver>/` 探一下。
  旧桶仍走 `fetch-cos-credentials.js --format sh` 换临时凭据。

### 1.5 3.0.18 留下的未决事项（截至 2026-11-16，下版发版前先看一眼）

1. 企业版没随这批发（企业 1.0.17 已于 11-13 发，含 core v0.1.103）；core v0.1.104 里「渠道健康检查返回上游模型列表」属企业侧，随下一轮企业镜像生效。
2. `publish-cos` workflow 的步骤日志 blob 404 未修，真实上传和回读校验步骤没在真发时跑过，仍走手动路径。
3. 官网 DNS 仍指旧服务器，新服务器迁移待用户安排。
4. 已装 3.0.18 的 Linux 用户拿不到 headless 修复（同版本号覆盖，见 §1.4），要等下次升版本发版。
5. mac-x64 时长 34 分钟超基线一倍但一次成功——下版再现 >25 分钟，先看 Apple 公证排队时长再定性，勿直接判卡死。

### 1.6 3.0.19 留下的新坑（2026-11-21）

1. **Windows CI 解压 dreamcore 用系统 bsdtar，不再依赖 Expand-Archive**（`84049bbc`）：runner 镜像 PowerShell/.NET 升级后
   `Expand-Archive` 内部三参 `ExtractToDirectory` 重载解析失败（MethodCountCouldNotFindBest），3.0.19 Windows 腿在
   下载 dreamcore 后解压即挂。`prepare-dreamcore.js` 的 `extractArchive` 现在 win32 优先 `tar -xf`（Windows 10+ 自带
   bsdtar 能解 zip，System32\tar.exe；Git Bash 里的 GNU tar 不行，本地测试要用全路径），Expand-Archive 仅作回落。
2. **官网服务器（work.1oneclaw.com）磁盘会撞满**：3.0.19 部署时 99G/99G 100%，部署 tarball 在 ~99.5% 处两次截断。
   大头是 `/var/lib/containerd`（64G）：历次企业镜像升级 `docker load` 攒下的旧镜像（10 个 GitLab CE 旧版 + 企业旧镜像）。
   处置配方：`journalctl --vacuum-size=200M` + `docker image prune -af`（在用容器镜像自动受保护；删的都是 Hub/GHCR
   可重拉的正本），当晚释放 65.6GB 回到 39%。**每次企业镜像升级后应随手 prune；服务器加磁盘告警仍未做。**
   另：这台 sshd 会话不稳，跑命令用「单连接单命令」模式（prod_ssh.connect() 每次 connect→一条 exec_command→close）。
3. dreamcore Release 工作流的资产发布完成（六资产）才是 dispatch 前提，见 §1.2。
4. **官网域名是分地区解析，`deploy-1onework-www.py` 只更新其中一台**：境外线 `43.163.105.71`（= `OPERONE_DEPLOY_HOST`，
   脚本目标机）+ 境内线 `62.234.93.202`（SSH 别名 `onework-62`，root + `~/.ssh/onework_62` 密钥）。3.0.19 当晚只部署了 43，
   国内用户看到 3.0.18 才发现。**每版部署完 43 后，必须把同一份构建同步到 62**：
   `tar -czf … -C .deploy-tmp-<ver> . && scp … onework-62:/opt/data/1onework-www.tar.gz`，然后在 62 上
   `rm -rf /opt/website-1onework/* && tar -xzf … -C /opt/website-1onework && chown -R nginx:nginx … && nginx -t && systemctl reload nginx`。
   **不要在 62 上跑 deploy 脚本**——它找不到 `work.1oneclaw.com` 的 letsencrypt 证书时会重写该机 nginx conf（62 的证书是
   迁移来的四域名合一证书，conf 是「迁自 43」的手工版）。验收：`curl -sk --resolve work.1oneclaw.com:443:62.234.93.202`
   看 main chunk hash 与四钉（注意 python urllib 直连 IP 会 TLS SNI 报错，用 curl --resolve）。

---

## 第二部分：历史经验与踩坑（原文完整保留）

> **附录说明**
>
> - 下面是 3.0.4 – 3.0.17 时期提炼的手册原文，**一条未删**，只改了三处二级标题的名字（原「第一部分 / 第二部分 / 第三部分」变成附录 A / B / C）。
>   正文里的 S0–S7、§2.x、「§3」等编号和交叉引用沿用原文，在附录内部依然成立。
> - Linux 相关的新内容（原 §2.1.2）已并入第一部分 §1.3.1 / §1.4，附录 B 里只留指针。
> - **与第一部分冲突、以第一部分为准的几处**：
>   1. 附录 A 的 S4 写「Windows 本机」出包——3.0.17 起 CI 的 `windows-x64` 腿也能出，**3.0.18 就是 CI 出的**（本机仍可用）。
>   2. 附录 A 的 S4 / 附录 B 的 §2.1 写「任何一条 Mac 腿超过 25 分钟就是卡死」——3.0.18 的 mac-x64 跑了 34 分钟自行完成，
>      订正为「25 分钟是收口警戒线，不是立刻杀的信号」。
>   3. 附录 A 的 S4 标题「CI 四路」、S7 的「13 个对象 / 三份根清单」是 3.0.14 以前的口径；3.0.13 起是**全平台五路 + COS 17 对象 + 五份根清单**。
>   4. 附录 A 标题里「3.0.4 → 3.0.5 → 3.0.6 三次成功发版提炼」是它当年的依据，现行依据是 3.0.18（第一部分）。
> - 3.0.18 发版前夜的交接话术与「上周（11-01 ~ 11-13）17 个坑」的逐条表格在
>   [release-handoff-3.0.18-for-glm.zh-CN.md](./release-handoff-3.0.18-for-glm.zh-CN.md)，同样保留。

### 旧文首说明（原文）

> 2026-09-19 按 **最近三次成功发版（3.0.4 / 3.0.5 / 3.0.6）** 重构：第一部分就是当时的标准流程；第二部分是仍然有效的坑的快速索引；
> 1oneCore / 1oneUI 时代的历史教训压缩成第三部分的一张表，细节在文末的 session 文档里。
>
> **版本坐标（2026-10-24）**：最新已发包 **3.0.14**（钉 dreamcore v0.1.98，全平台 Windows + macOS×2 + Linux×2）。S0–S7 流程在 3.0.14 上复跑通过；
> 本版新增的坑已并入 S0/S2/S4/S5/§2.1/§2.8/§2.9。
>
> **开局先读最新一篇发版记录**：打包范围、对象数、tag 惯例会演进——3.0.13 起是全平台五路 + COS 17 对象 + 五份根清单，
> 按旧记忆的「三路打包」走会漏腿（3.0.14 实际发生，Linux 晚 dispatch 20 分钟）。
>
> 权威的"当前发布状态"永远用实时命令查（附录 D），别信任何文档里写死的时间点快照。

## 附录 A：旧版标准流程 S0–S7（3.0.4 → 3.0.14 时期提炼，原文保留）

### S0. 预检（发版窗口打开前，2 分钟）

```bash
# ① 四仓本地 = origin/main，无未推送 commit（用户红线：不许有 commit 遗留或搞错仓库）
for repo in dream-ui dream-core dream-en dream-engine; do
  cd /d/dream/$repo && git status -sb | head -2 && git rev-list --left-right --count origin/main...main
done

# ② CI 绿：dream-core 主 CI + dream-ui Main Guard（最新 commit）
#    main 红时按既定决策可绕过：release.yml 只认 tag、不跑测试，与 ci.yml 无依赖——
#    直接打 tag 先出包，CI 修复挪到发版后（3.0.6 的实操决策）。

# ③ 磁盘余量 >100GB：cargo incremental 缓存只增不清，连红排查期曾把 target 堆到
#    871GB（症状 os error 112 / LNK1108）；排查期建议挂 cargo-sweep 或每日 cargo clean

# ④ 上次发版的真实时点 = COS Last-Modified，不是 commit 时间（3.0.5 的教训）
curl -sI https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/<上版>/One-Work-<上版>-win-x64.exe | grep -i last-modified

# ⑤ 目标版本号在 semver 上必须 > 线上版本，否则 electron-updater 永远不推送。
#    "修订版"这种语义不能靠后缀表达：3.0.6-1 是 3.0.6 的预发布版，排在它前面。
cd /d/dream/dream-ui && node -e "const s=require('semver');const [cur,next]=process.argv.slice(1);
  console.log(next, s.gt(next,cur) ? 'OK 会推送' : '❌ 小于/等于 '+cur+'，装了旧版的用户收不到')" <线上版> <目标版>
```

> **3.0.6-1 那类版本号的代价**：`3.0.6-1 < 3.0.6`，自动更新不会触发，用户只能
> 手动去官网下载。要既表达「3.0.6 的修订」又能推送，版本号用 `3.0.7`、把
> 「3.0.6 修订版」写进更新记录标题。`3.0.6+1`（build metadata）同样无效，
> electron-updater 直接忽略 `+` 之后的部分。

**S0 附加两条（3.0.14 教训，写进流程）：**

- **开局先读最新发版记录**再定打包范围与对象清单，别按记忆里的旧版数走。
- **Mac 腿最先 dispatch、全程盯**：它是唯一会连挂数小时的腿（flaky 门禁 +
  codesign 挂死），3.0.14 两次失败都是事后 1 小时才发现，每次白烧一轮等待。

### S1. 划界 + 全量 commit 检测（更新记录的完整来源）

```bash
git log --format='%h %ad %s' --date=format:'%m-%d %H:%M' --since='<上一步的时间，时区+8>' | tac
```

**规矩（3.0.6 后固化的两条）：**

1. **全量 commit 检测，不许有遗漏。** 上面的清单逐条过，每条归类为
   「用户可见 / 内部实现 / 文档」，用户可见的必须映射进更新记录的条目——
   条目可以合并（几条 commit 并成一条），**不可以遗漏**。3.0.6 被用户
   连抓两轮：第一轮漏了截断提示本地化、MCP 启动健壮性、输出预算上限；
   第二轮漏了 dream-core 的四个 `fix(team)`（供应商拒付停队、投递耗尽通知
   合并、过期信号卡死、收尾去重）和会话 Cookie 401 循环。
   **最容易漏的就是后端独有的 fix 分类（没有 UI 对应物）**——它们不配对
   任何前端 commit，扫漏时按"主题"（团队调度 / 会话状态 / 媒体）归类，
   不是按仓库归类。
   四仓都要看：dream-ui + dream-core + dream-engine（个人版功能在这三个仓配对），
   dream-en 只影响企业后台。
2. **话术简化 + 成段呈现。** 每条只留「改了什么 + 关键数字」，删叙事性的
   "为什么"；相关条目按主题独立成段（如【团队协作】），不要三合一埋没
   重点（3.0.6 的「新建团队可拖拽」曾埋在三合一条目末尾被用户当成漏了）。

### S2. 后端钉版决策：UI 配对才换 dreamcore tag

> ⚠️ **build 预检会拦钉版落后**（`build-with-builder.js` 的 pre-flight 对比
> dream-core main 上 build-relevant 提交）。并行会话持续往 dream-core 推提交时，
> 打包会被反复拦下——**追到最新 tag 重钉重验**即可；确认落后的提交与本版无关
> 才用 `DREAM_SKIP_PREFLIGHT=1`（3.0.14 当天被拦两次、v0.1.96→97→98 三连追，
> 没用过 skip）。这个拦截是对的：它防的正是「新 UI 带旧后端上线的空壳」。

> 🚨 **3.0.8 必须换钉版：`v0.1.74` 里没有本轮的后端改动。**
>
> 2026-09-22 夜里进 dream-core main 的两个 commit **都不在任何 tag 内**
> （`git tag --contains 7ff14c1` 为空）：
>
> | commit    | 内容                                                               | 钉错版的后果                                               |
> | --------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
> | `508e1e0` | `one-browser` / `one-page-reader` 进 `AUTO_INJECTED_BUILTIN_NAMES` | 浏览器工具永远进不了会话，Agent 老实回答「我没有这个工具」 |
> | `7ff14c1` | 内置技能 24 → 115（`include_dir!` 编译期嵌入）                     | 技能市场仍然只有 24 个                                     |
>
> 两条都**只存在于二进制里**，dream-ui 侧怎么改都救不回来。`dreamcoreVersion`
> 停在 `v0.1.74` 出的包 = 这两件事一件都没有，**而且界面不会有任何异常提示**：
> 条目 enabled、连接测试 connected、设置页照常列工具，只有会话日志的
> `mcp_names=[...]` 是真相。这正是它此前躲过整整一轮排查的原因。
>
> 做法照本节正文：dream-core 合 release-please 的 PR 出 `v0.1.75`，
> `dream-ui/package.json` 的 `dreamcoreVersion` 指过去。
>
> **不要拿本机 `resources/bundled-dreamcore/win32-x64/dreamcore.exe` 顶替。**
> 那是 2026-09-22 做 dev 真机验证时本机编的（`manifest.json` 里
> `sourceType: local`），S5 第 ⑤ 条就是拦它的。
>
> 验证钉对了 —— 技能带来大量独有字符串，属于上面说的「字符串检查管用」的情形：
>
> ```bash
> grep -qa "一人公司教练"            dreamcore.exe   # 7ff14c1：91 个新技能之一
> grep -qa "Injecting MCP servers"  dreamcore.exe   # 对照：已知在内，验手段有效
> ```
>
> ⚠️ **`508e1e0` 不能用整串搜。** 它改的是短字面量相等比较，release 优化把比较
> 内联成了 8 字节立即数，整串在文件里根本不连续 —— 连早就存在的 `one-web-search`
> 也搜不到，据此会误判成「修复没进去」。按 8 字节切片搜：
>
> ```bash
> grep -qa "one-page" dreamcore.exe && grep -qa "e-reader" dreamcore.exe   # one-page-reader
> grep -qa "one-brow" dreamcore.exe && grep -qa "-browser" dreamcore.exe   # one-browser
> ```
>
> 体积 123MB → 138MB 是技能嵌入的正常结果，不是产物损坏或拉错文件。

> **挑验证字符串前先看它是否活在 `#[cfg(test)]` 里**——测试 fixture 的字面量
> （哪怕中文长串）不进 release 二进制，grep 必然落空，别误判成「修复没进去」
> （3.0.14 白查一轮）。稳的验证组合拳，按序：
>
> ① `git merge-base --is-ancestor <fix-commit> <tag>` —— 提交在 tag 祖先链上；
> ② 下载的 zip 对 `dreamcore-checksums.txt` 做 SHA-256 —— 拿的确实是这个 tag 的产物；
> ③ 生产代码里的短字面量 / tracing 文案 grep 二进制 —— 内容真嵌进去了。
> 三条全过才叫「钉版验证过」，单靠 ③（或只看 tag 号）都不算。

S1 的清单里若 dream-ui 新功能与 dream-core 划界后的 commit **配对**
（备份↔个人版备份端点、搜索 UI↔web search 到会话、图片 UI↔Agnes 能力），

**手工打 `-one.N` tag 的做法已作废（2026-09-19）。** 改走 release-please：

```bash
# 推到 main 后机器人自动开/更新一个 release PR；合它就打 tag、出 6 资产（~26 min）
gh pr list --repo gaogg521/dream-core            # 找 "chore(main): release X.Y.Z"
gh pr merge <N> --repo gaogg521/dream-core --squash
gh release view v<X.Y.Z> --repo gaogg521/dream-core --json assets --jq '.assets[].name'
```

原因是 semver，不是偏好：`-one.N` 是**预发布后缀**，永远小于同号正式版。

```
0.1.71-one.5  <  0.1.71-one.6  <  0.1.71  <  0.1.72-one.1  <  0.1.72
```

该方案只在「正式版 0.1.71 从未发布」时成立。0.1.72 一发，`-one.N` 就再也
排不到它前面了，无论换不换底。

**资产是 6 个不是 7 个。** `bump-version` 技能 Step 5 的清单里有
`aarch64-pc-windows-msvc.zip`，但这条管线从 one.4 起就没建过 Windows ARM64——
one.4 / one.5 / 0.1.72 三版产物集完全一致。**照技能走会在这一步误判发版失败。**

没有配对就沿用现钉版。**桌面发版伴随 dreamcore 换钉是惯例，不是例外**——
不换，新 UI 功能上线就是空壳。

> ⚠️ **换钉版后必须验证那个二进制真含本轮修复**，别只看 tag 号。
>
> **字符串检查只在修复新增了字符串时管用，是必要条件不是充分条件。** release
> 构建会剥符号，所以 `strings | grep <fn_name>` 一定查不到；能查的是修复独有的
> tracing / 错误文案：
>
> ```bash
> grep -qa "<修复独有的文案>" dreamcore.exe   # 目标
> grep -qa "<已知在内的文案>" dreamcore.exe   # 对照，验证手段本身有效
> ```
>
> **改动不新增字符串时（改 SQL 关键字、改比较符、调顺序），这招无效——必须跑行为。**
> v0.1.72 和 v0.1.73 的这四条字符串完全一样，而前者恢复 500、后者 200；区别只是
> `UPDATE` 变成了 `UPDATE OR IGNORE`。跑法（`--app-version` 必须给 dream-ui 的
> 版本号，否则被「备份来自更新版本」的闸门挡掉）：
>
> ```bash
> dreamcore.exe --local --identity-mode local --port 18907 \
>   --data-dir <临时目录> --app-version <本轮 dream-ui 版本> --log-level warn &
> curl -s -X POST http://127.0.0.1:18907/api/system/backup/restore \
>   -H 'Content-Type: application/json' -d @restore.json   # 期望 200 且 FK 违规 0
> ```
>
> 2026-09-19 的实例：v0.1.72 带着一个让恢复直接 500 的 bug 发了出去，而本地那次
> 「验过了」用的是 mtime 早于修复提交 17 分钟的产物。详见 dream-en 发版记录 §7.2/§7.3。

### S3. bump 三件套 + 发版 commit

1. `dream-ui/package.json`：`version` +1，`dreamcoreVersion` 指向 S2 的 tag；
2. `docs/release-notes/<ver>.json`：按 S1 的全量清单写（zh/en × 单机/企业 四段）；
3. `chore(release): <ver>` 一个 commit 推 main（Mac CI 构建的就是它）。

### S4. 全平台并行打包（Windows 本机 + CI 四路：macOS×2 / Linux×2）

```bash
# Windows 本机（~20 min；先确认无 electron/dreamcore dev 进程占文件，杀按 PID）   ← 3.0.18 订正：也可走 CI 的 windows-x64 腿（26 分钟），见第一部分 §1.3.3
cd /d/dream/dream-ui && bun run build-win:x64

# Mac CI ×2（~35 min；installers_only=false 是默认，别手滑传 true）
gh workflow run build-manual.yml --repo gaogg521/dream-ui --ref main \
  -f branch=main -f platform=macos-arm64 -f installers_only=false
gh workflow run build-manual.yml --repo gaogg521/dream-ui --ref main \
  -f branch=main -f platform=macos-x64  -f installers_only=false
```

Mac CI 前本地把四道 gate 跑绿（`bun run format:check` / `bunx tsc --noEmit` /
`bunx vitest run`），别为一个格式错烧一个 35 分钟的 cycle。
等待窗口内：生成 `release-notes.md`（`node scripts/generate-release-notes.js --out …`）、
注入 COS 凭据（§2.3）。

> **dispatch 后立刻把四个平台全发齐**（arm64/x64/linux×2 各一个 run），发版脚本
> 按「谁好谁先走」逐腿上线即可——别只发 Mac 等后面再补 Linux（3.0.14 按旧记忆
> 只发了三路，Linux 是中途读 3.0.13 发版记录才补的）。
>
> **S6 的 CI 产物下载要按平台并行发起**，别串行排队：公司网络对 gh 限速可低到
> ~70KB/s，一个串行链把 linux-x64 拖了 2 小时；多挂几个并行任务反而都能挤过。

> **Mac CI 的现状（2026-11-07，3.0.17 起）：**
>
> - `macos-14` 镜像已被 GitHub 下线，五处 workflow 都换成了 `macos-15`；
>   **mac-x64 腿跑在原生 Intel 的 `macos-15-intel` 上**（`build-manual.yml` 里的 `os`），不再交叉构建。
> - 健康基线：mac-arm64 约 12 分钟、mac-x64 约 16 分钟（含公证）、Windows 约 15 分钟、
>   Linux 4~10 分钟。**任何一条 Mac 腿超过 25 分钟就是卡死，别调大超时、别盲目 rerun**，见 §2.1.1。（**3.0.18 订正**：mac-x64 跑了 34 分钟自行完成；25 分钟是收口警戒线而不是立刻杀的信号，见第一部分 §1.3.2。）
> - mac-x64 现在是单次尝试、上限 40 分钟（`_build-reusable.yml`），卡死了 40 分钟就带着诊断信息失败。
> - Windows 腿的 CI 构建 3.0.17 才第一次成功（7za 工具集下载往 stdout 打进度行、污染了路径，
>   `7e4208ba` 已修）；之前 Windows 一直在本机出包，现在 CI 也能出。
> - dispatch 时 **Windows 的 run id 也要记下来**：发布 workflow 要的是「每个平台各一个 run」。

### S5. Windows 腿先上线（增量发版：谁好谁先走，不等齐）

验收六件（全过才传）：

```bash
# ① sha512 与 out/latest.yml 对账（openssl dgst -sha512 -binary <exe> | openssl base64 -A）
# ② 版本资源 = 新版本（PowerShell Get-Item …VersionInfo）
# ③ ACP 内嵌组件在包里且版本与 dream-core 常量逐字一致（见 §2.2）
# ④ asar 抽查：失效类名（border-border-N / bg-bg-N）0 处，修复类在 CSS 有规则
# ⑤ 只能在打包版验的两件（dev 构建结构上验不了，别在 dev 里下结论）：
#    · 内置联网搜索：设置→工具→one-web-search 显示「可用」而不是「当前版本没有内置搜索」。
#      dev 里必然显示不可用——resolveTrialBrokerUrl(isPackaged=false) 返回 undefined，
#      理由写在测试里：每次内置搜索都花公司额度，开发环境不该烧。
#    · bundled dreamcore 来自 release 而非本机：
#      resources/bundled-dreamcore/<plat>/manifest.json 的 sourceType 必须是 release、
#      version 等于本轮钉版；sourceType: local 说明打进去的是本机编译产物。
#    · 内置技能数：设置→助手与专家→技能市场应为 114 个（3.0.7 及以前是 24 个）。
#      少于 114 就是 dreamcore 钉版早于 7ff14c1——技能是编译期嵌入的，见 S2 的告警框。
#      注意：开发机上这里仍会显示 24 左右，因为同名 custom 技能覆盖 builtin，
#      只有干净安装才能验这条。
# ⑥ 涉及备份/恢复这类「前端读后端返回值决定要不要弹某个框」的功能，必须走真实点击路径，
#    不能只用正确参数直接调 API。2026-09-19 的教训：跨安装恢复验证连续多轮都是直接拿
#    正确密码调 POST /restore，从未走「先 preview → 前端读 manifest.encryption 决定
#    弹不弹密码框」这条真实分支——而这个字段从加密功能上线第一天起就没在 preview 的
#    响应里出现过，密码框对任何用户都从未真正弹出过。装机后手动操作一次才复现。
#    验法：CDP 驱动真实点击（原生对话框由 PowerShell 驱动，见
#    scripts/../scratchpad 里的 drive-open-dialog.ps1 模式），断言中间态的
#    DOM（密码框是否真的出现），不要只断言最终 API 调用的返回码。
```

> **打包版无法用 CDP 驱动 UI**：`configureChromium.ts` 对 `app.isPackaged` 无条件拒绝
> 应用级调试端口（安全设计，不是缺陷，别再试）。⑤ 两个装机级验收的等效替代：
> 包内 dreamcore.exe grep 技能语料/修复独有文案；app.asar grep 常量（如
> `work.1oneclaw.com/trial-broker`）+ 确认对应单测存在。涉及真实点击路径的 ⑥
> 只能装到干净机器手动走（2026-10-24 起无 CDP 通道）。
>
> **`bunx asar extract` 在本机会解包不完整**（只出 node_modules/static 后中断）——
> asar 是拼接格式，**直接 `grep -a` app.asar 二进制**即可做类名/资产/常量检查，
> 不必解包。

```bash
scripts/publish-cos-release-asset.sh out/One-Work-<ver>-win-x64.exe <ver>   # exe：只进版本目录
scripts/publish-cos-release-asset.sh out/latest.yml <ver>                   # yml：自动镜像根
scripts/publish-cos-release-asset.sh <tmp>/release-notes.md <ver>           # sidecar：只进版本目录
```

**两个桶（2026-11-02 起）**：一次调用同时传到两个桶，两套凭据互不通用，传之前都要备好：

| 桶                          | 作用                                                                                                                          | 凭据                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `onework-1521070673`（新）  | 官网下载链接指向它（3.0.16 之后的版本）                                                                                       | `ONEWORK_COS_ACCESS_KEY_ID` / `ONEWORK_COS_SECRET_ACCESS_KEY`（feishu.txt 末尾，静态子账号 key） |
| `1onework-1251001122`（旧） | **已装客户端的更新通道**：地址写死在已发出的 App 里（`electron-builder.yml` / `updateFeed.ts`），不传就等于已装用户收不到新版 | `scripts/fetch-cos-credentials.js` 换出的 `AWS_*`（照旧）                                        |

`COS_PUBLISH_TARGETS=new` 或 `legacy` 可只传其中一个；缺任一目标的凭据会在上传前直接报错，不会半传。
旧桶的数据没有迁移：官网的 `src/site.config.js` 里 `LEGACY_LAST_VERSION`（现为 3.0.16）以内的版本链接指旧桶，
之后的指新桶；**不要把 `LEGACY_LAST_VERSION` 之后某个版本只传了一个桶就切官网**。
要彻底只用新桶，得先发一版把更新地址改成新桶的客户端并等用户升级完，企业版升级器还要求更新源与下载地址同源。

官网切 `platformVersions.win` + `platformSizes.windows`（真实字节数 ÷ 1048576）→
`cd D:\website\1onework && npm run build` → `python D:\game\scripts\deploy-1onework-www.py`
→ 验下载 URL 200 + 线上 bundle 含 `win:"<ver>"`。

### S6. Mac 落地（每架构 5 对象：dmg / dmg.blockmap / zip / zip.blockmap / 清单）

```bash
# 下载（两架构并行；公司网络慢，用这个脚本别裸跑 gh run download）
scripts/download-gh-artifact.sh gaogg521/dream-ui <run_id> macos-build-arm64-<sha> <dir>
# 逐文件 sha512 与清单对账；arm64 的 latest-mac.yml 改名 latest-arm64-mac.yml
# （electron-updater 按 ${channel}-mac.yml 拼名，arm64 channel 是 latest-arm64——
#  prepare-release-assets.sh 的改名规则就是这条；x64 的保持 latest-mac.yml。
#  该脚本校验已改为按本轮实际构建的平台派生（2026-09-19），增量集能直接跑过，
#  清单与产物单边缺失会指名报错；全量矩阵跑 STRICT=1 恢复旧合同）
# asar 抽查同 S5-④（从 zip 里解 onework.app/Contents/Resources/app.asar）
```

> **🚨 CI 产物下载三坑（2026-10-31 实战）：**
>
> 1. **同一文件绝不能有第二个写入者。** 老下载循环没杀干净时，新旧两代 curl
>    并发写同一 zip——文件无限增长、CRC 全坏。杀循环必须连 curl.exe 一起
>    （`taskkill /F /IM curl.exe` + 按 CommandLine 过滤杀 bash），重启前用
>    `tasklist` 确认归零。
> 2. **断点续传 `-C -` 跨 302 重定向不可靠**：续传请求可能收到 416 错误体并被
>    curl 当作正常响应追加，文件比标称大 32KB/64KB 且前缀也可能错位。下载
>    一律 fresh 单流，禁 resume。`scripts/download-gh-artifact.sh` 已按此改写
>    （2026-11-02）：每次重试都从空文件开始，下载后核对 GitHub 的 size 与 sha256，
>    全部对上才解压；用 `python`（探测时真的执行一次，避开 Windows 的 `python3`
>    Store 占位符）解压，不再依赖 `unzip`。
> 3. **校验目标是 GitHub 的 artifact digest**：`gh api .../actions/artifacts/<id>`
>    返回 `digest: sha256:<64hex>` 与 `size_in_bytes`，下载后逐字节对账即算
>    "拿到的是这份制品"。注意 `artifacts/<id>`（元数据）与
>    `artifacts/<id>/zip`（下载）端点：**下载端点要 `Accept: application/vnd.github+json`，
>    回 303 跳到 blob 存储再 200**；`application/octet-stream` 现在会回 415（186 字节的
>    JSON 错误体，脚本的大小校验会拦下它）。**这一条以前的手册写反了。**
>    网络限速时（公司 QoS 单连接可低到 ~17KB/s 且多连接无增益），
>    换时段重试比并行连接有效。

**落地前必须核验产物是「签名 + 公证」的，不能只看 CI 绿**（详见 §2.1.1）。下载后在 zip 里查两个文件，
Windows 上没法跑 codesign，这个文件存在性就是最便宜的核验：

```bash
python - <<'EOF'
import zipfile, glob
n = zipfile.ZipFile(glob.glob("*.zip")[0]).namelist()
print("签名:", any(x.endswith(".app/Contents/_CodeSignature/CodeResources") for x in n))
print("公证票据:", any(x.endswith(".app/Contents/CodeResources") for x in n))   # 必须是 True
EOF
```

**两种发布方式，任选其一**（两个桶都要写，凭据互不通用，见本节「两个桶」）：

1. **`publish-cos.yml`（办公网自托管 runner）**：Actions 里手动触发，填各平台构建的 run id，
   默认 `dry_run=true` 只演练，确认后取消勾选真跑。runner 在本机，是手动起的、会话结束就掉线，
   发版前先双击 `D:\actions-runner\run.cmd`。它会下载并校验工件、生成更新说明、先传安装包最后传清单、
   最后从公网回读核对。**GitHub 托管 runner 往上海 COS 传大文件会卡死**（实测 300MB 超过 10 分钟没传完），
   所以发布必须在办公网 runner 或本机做，不要放到托管 runner 上。
2. **本机直接传**：下载工件后逐个 `publish-cos-release-asset.sh`，顺序固定为
   **dmg / zip / blockmap 先、`latest*.yml` 最后**（清单一旦可见，它指向的文件必须已经在）。

**增量补发一条腿（例如 3.0.17 先发四个平台、Intel Mac 后补）：**
先发的批次里不要带那条腿的 `latest*.yml`（`prepare-release-assets.sh` 对缺失平台自然不生成），
这样根清单里它还停在上一版，已装的老用户不会被推一个不存在的包；官网对应的钉也留在上一版。
补发时再写它的 `latest*.yml` 并把官网那一个钉切过去。

官网切钉与部署见 S7 末尾「官网部署」。

### S7. 终验（不看文案看 URL）

1. 版本目录 13 个对象逐个 `curl -sI` = 200；
2. 三份根清单 `releases/latest.yml` / `latest-mac.yml` / `latest-arm64-mac.yml`
   的 `version:` = 新版本，其 `path:` 指向的对象同目录真实存在；
3. 线上 `main-*.js` 含 `win/macArm/macIntel:"<ver>"` 与三个新尺寸；
4. `platformVersions.linux` **没动**（本轮没打 deb 时它必须停在上一版，一个键管两条链）；
5. **两个桶都核对一遍**（`onework-1521070673` 与 `1onework-1251001122`）：每个对象 `Content-Length`
   等于本地文件大小；每份根清单的 `version:` 与 `path:` 对应的对象都存在；根清单与构建产物逐字节相同。
   只有 `latest*.yml` 在两个桶都对，已装用户才会收到更新。
6. 发版记录落盘 `dream-en/docs/release-record-<日期>-<ver>.zh-CN.md` 并推送。

**官网部署（2026-11-07 的教训）：**

- 线上官网里有**工作区未提交的内容**（`onebuddy.html/css`、改过的 `carousel-manifest.json`、`en.json` 等）。
  部署脚本 `deploy-1onework-www.py` 会先清空线上目录再解压，所以**绝不能用干净的 worktree / 某个提交
  去构建部署**——会把这些线上现有内容抹掉；干净 worktree 里 `core.autocrlf=true` 还会把所有文本文件
  换成 CRLF，造成几十个假差异。
- 做法：改 `src/site.config.js` 的钉和尺寸（只暂存并提交这一个文件）→ 在**主工作区**
  `npx vite build --outDir <临时目录> --emptyOutDir`（不要直接 `npm run build`，它的 prebuild 会联网机翻、
  可能改别的文档）→ **和线上逐文件比 sha256**：应该只有 `main-*.js` 和引用它的 `index.html` 不同
  → `python D:\game\scripts\deploy-1onework-www.py --dist <临时目录>` → 再比一次线上与本地构建
  应当 100% 相同 → 线上 bundle 里 `macIntel:"<ver>"` 等钉与尺寸正确 → 真实请求下载链接。
- `LEGACY_LAST_VERSION`（`site.config.js`）是**旧桶里最后一个版本**，不是「当前版本」，别当版本号改；
  新版本两个桶都传好之前，别让官网链接先指向只有一个桶有的版本。

---

## 附录 B：仍然有效的坑（快速索引，§2.x）

### 2.1 Mac CI（build-manual.yml）

| 症状                                                                         | 病根 / 解法                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run 几秒失败、steps 空、log not found                                        | **计费拦截**（私有仓 macOS 10 倍计费）。用 `gh api repos/gaogg521/dream-ui/check-runs/<jobId>/annotations` 看真因；解法是修付款/提额度或转 public                                                                                 |
| Prepare dreamcore 404                                                        | `dreamcoreVersion` 指向的 Release 不存在——S2 的 tag 先出包再 dispatch                                                                                                                                                             |
| 卡 oxfmt/tsc/vitest                                                          | 本地先跑绿四道 gate 再 dispatch；vitest 历史失败要现查是否与本次相关                                                                                                                                                              |
| 签名成功但装机报已损坏                                                       | 看 build step 的守卫：`signing file=… Developer ID Application` → `properly code signed` → `Notarization completed` 三连，缺一即红（IDENTITY secret 只填证书 CN、不带前缀）                                                       |
| 超时 60:17（早期结论，已被订正）                                             | 当时归因为「x64 公证排队 / OCSP flaky」。**2026-11 查明 x64 卡死的真因是钥匙串自动锁定，不是排队**，见 §2.1.1；健康构建 >25 分钟就是卡死，调大 timeout 是错方向                                                                   |
| codesign **连环**挂死（所有 attempt 全超时、控制台零输出）                   | 先看 §2.1.1：采样栈停在 `getAcl → mach_msg` 就是钥匙串锁了。2026-10-24 那次六连挂的最终也发生在 x64 腿；wrapper（`f6e8bbf3`）的**超时转储**只会在被杀后打印尾部 40 行，**它的时间戳是转储时刻，不是各步实际时间**，别据此推算耗时 |
| 构建绿、产物也有，但 `.app` 里没有公证票据                                   | `afterSign.js` 在签名校验不过或凭据缺失时只打印 Skipping、不让构建失败。已加闸门（`99bd3bd0`）；核验方法见 S6 与 §2.1.1                                                                                                           |
| Code Quality 挂在个别 dom 用例（mermaidBlockPanZoom / EnterpriseServerCard） | 并发负载时序 flake：本地单跑全过 + 同提交其他腿全过 = 假红。`gh run rerun --failed` 即可，别改产品代码、别为它烧 35 分钟全量重跑                                                                                                  |

`installers_only` 必须为 **false**：Mac 自动更新走 `.zip` 不是 `.dmg`，
true 会在上传前把 zip+yml 删掉（3.0.1 / 3.0.2 各踩一次）。

### 2.1.1 Intel Mac（mac-x64）签名卡死 + 「构建绿 ≠ 已公证」（2026-11-06/07，3.0.17）

这一轮 mac-x64 卡了一夜多，最后查明是**钥匙串自动锁定**。这节是完整记录，下次遇到先读这里。

**症状**：打包全绿（electron 构建、afterPack 校验、prune 都过），日志最后一行是
`• signing file=out/mac/onework.app`，之后没有任何输出，直到被 attempt 上限杀掉。
mac-arm64 在同一镜像上稳定通过；3.0.16 的 x64 在 macos-14 上总共 11 分钟；换成 macos-15 之后
x64 **13 次 attempt 全部卡死**，而且 macos-15（arm 交叉）和 macos-15-intel（原生）两种硬件都一样。

**怎么定位的**：给构建步加 watchdog（每 15 分钟抓 `ps` 和对 codesign 进程 `sample` 3 秒）。
几次采样全部同一个现场：

```
codesign → SecKeyCopyAttributes → KeyItem::checkIntegrity → SSKey::getAcl
  → SecurityServer::ClientSession::getAcl → mach_msg   ← 永久阻塞
```

意思是 codesign 在读私钥时要和 securityd 通信，而 securityd 在等一个**授权弹窗**的应答；
无头的 CI 机器上没有 SecurityAgent 来答，所以永远等下去。**这个栈的典型成因是钥匙串被锁**
（或私钥的 ACL 没放行）。

**真因与修法（2026-11-07 验证，mac-x64 一次过、16 分钟）**：workflow 里钥匙串用默认的自动锁定超时，
而且只在构建开始时 `unlock-keychain` 了一次，到签名时已经锁上。`_build-reusable.yml` 里
mac-x64 的钥匙串准备段（`a22c1e34`）现在做三件事：

1. 建钥匙串后 `security set-keychain-settings -lut 21600 build.keychain`（GitHub 官方文档的标准写法）；
2. 构建期间后台每 60 秒 `security unlock-keychain` 一次（保活）；
3. 构建前用一个小二进制做 60 秒有界的 **warm-up 签名**，过不了就 60 秒内失败，不再烧满整个 attempt。

另外 watchdog 里加了**一次性锁探测**：同一个 codesign 进程卡住超过 2 分钟，就打印钥匙串状态、立刻解锁，
20 秒后看进程有没有放行，日志里的 `🔬 verdict` 会直接告诉你「是不是锁」。

**走过的弯路（别再试）**：

| 做法                                                 | 结果                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| 逐级调大 attempt 上限（1800 → 3300 → 4500 秒）       | 全部被杀。健康 x64 只要 11~16 分钟，超过 25 分钟就是卡死，加时间只是多烧时间 |
| 归因为交叉编译                                       | 换原生 Intel runner（macos-15-intel）一样卡                                  |
| 只重打 partition-list                                | 采样栈不变，无效                                                             |
| 重建钥匙串 + partition-list + warm-up                | 仍卡；**缺的是取消自动锁定和保活**，加上之后才过                             |
| 盲目 rerun                                           | 100% 复现，不是偶发                                                          |
| 据「超时转储的最后 40 行」推算「到签名点要 50 分钟」 | **错的**：转储里所有行的时间戳都是被杀那一刻，不是各步实际发生的时间         |

**另一个陷阱：构建绿 ≠ 已公证。** 同一轮里，修好卡死后的第一次构建全绿、产物也齐，但
`onework.app/Contents/CodeResources`（公证票据）**不存在**——它是 Developer ID 签了名、没公证的包，
已发布的 arm64 和 3.0.16 的 x64 都有这个文件。原因是 `scripts/afterSign.js` 在「签名校验没过」或
「Apple 凭据缺失」时只打印一行 `Skipping` 就返回、不让构建失败，而 workflow 成功分支曾把
`notarization_status=success` 写死，`exit 0` 就当成功。那个包**没有发布**。

现在（`99bd3bd0`，对所有 Mac 腿生效）：

- 构建结束先把 afterSign 的判断打进 job 日志，行首是 `[sign-evidence]`，应当依次出现
  `App onework is properly code signed` → `Starting notarization for …` → `Notarization completed successfully`；
- 配了 `appleId` 却没有最后一行、或 `xcrun stapler validate` 不过，构建直接退出 1。

**产物层面的核验**（不依赖 CI 日志，S6 里有命令）：zip 内 `onework.app/Contents/_CodeSignature/CodeResources`
和 `onework.app/Contents/CodeResources` 两个文件都要存在；主程序 `Contents/MacOS/onework` 的 Mach-O 头
`cputype` 是 `16777223` 表示 x86_64（arm64 是 `16777228`）。

**Mac 腿卡了怎么办（流程）**：

1. 看 job 日志里的 `[wd]` 采样栈和 `🔬 verdict`，而不是看超时转储；
2. 别为一条腿烧掉整场发版：**按平台增量收口**——其余平台先发，这一条腿写好配方挂起，补发见 S6「增量补发」；
3. 一次只改一个变量，每次改动都要能在 40 分钟内给出结论；
4. 旧的 run 取消经常被 runner 拖到 attempt 边界才生效，不要对着运行中的 run 干等日志
   （job 日志在 run 结束后才可读）。

### 2.1.2 Linux（deb）打包、无桌面运行与单平台补发（2026-11-16，3.0.18）

内容已并入第一部分：**§1.3.1 Linux**（产物事实、headless 启动、CI、WSL 验真包、测试环境的坑、arm64 只能验到哪一层）和 **§1.4 同版本号覆盖补发**（覆盖的代价、备份、dreamcore 钉版核对、新桶凭据）。

### 2.2 ACP 内嵌组件 —— 每次发版必查

打包后核对两处（缓存会伪装正常，只有全新安装才暴露，2.1.51 发出去过一次）：

```bash
grep -A5 'pub fn version' <dream-core>/crates/dream-core-runtime/src/acp_tool_runtime/types.rs
ls -d <包>/resources/bundled-dreamcore/*/managed-resources/acp/*/*/
# claude-agent-acp / codex-acp 两套版本必须逐字一致
```

### 2.3 COS 上传（本地 aws-cli，CI 上传不可用）

- 凭据：`C:\Users\allenzhao\Desktop\feishu.txt` 的 Token/SignKey（**绝不进仓库、
  绝不贴对话**），`COS_ALLOC_URL` 要在文件 BASEURL 后补 `/oapi/qcloud/alloc`；
  `eval "$(node scripts/fetch-cos-credentials.js --format sh)"` 注入，短期有效 ~7 天。
- 寻址：`addressing_style=virtual` + `multipart_threshold=5GB` 已配好，别动。
- **CI→COS 的网络路径不可靠**（限速 120-215 KiB/s 且超时），GitHub runner 还连不上
  内网凭据服务——永远本地 aws-cli，别先试 CI 再切换。
- `publish-cos-release-asset.sh`：按文件名自动判断 `latest*.yml` 并镜像到根
  （3.0.2 那次五平台四根清单停在旧版的事故就是"根目录忘记同步"造成的）。

### 2.4 官网切版

- `sync-changelog-to-site.js --version <ver>` 无去重，**重跑前先删旧条目**；
  它会顺手 bump `release.version`。
- `platformVersions` 四个键按下载条目独立（macArm / macIntel 不共享 mac 键），
  每个键停在它自己最后一次真实上传 COS 的版本，没出包就别动；
  `platformSizes` 与版本是同一个事实，一起改（尺寸 = 实际字节数 ÷ 1048576 取整）。
- 部署后按 URL 验收，不信文案：bundle 里 `win:"<ver>"` 等 + 逐 URL 200。

### 2.5 工具链三坑（3.0.6 实操记录）

1. 两个 nextest 不能并行（channel_e2e spawn 的 dreamcore.exe 撞链接）；
   泄漏进程按 PID 清，不按名字。
2. `cmd | tail` 吞退出码；固定 `REAL_EXIT=$?` 紧跟命令。
3. **cargo 的 incremental 缓存只增不清**（cargo 已知痛点，不是操作失误）。CI 连红
   期间为了不吃一轮 20 分钟的红往返，本地会反复全量编译验证，`target/` 下的
   incremental 缓存随之堆积旧版本——3.0.6 那晚堆到 **871GB**（D 盘 100% 满，
   表面症状是 os error 112 / LNK1108 写入失败）。清理后 target 34GB 是正常水平。
   **这个问题一定会复发**：连红排查期间给 dream-core 配 cargo-sweep，或每天
   `cargo clean` 一次；`df -h /d` 先看盘再猜代码。

### 2.6 Windows 签名 —— 决策已定，不再询问

**现阶段不购买 Authenticode 证书。** 本管线的 Windows 包只带 electron-builder 的
asar 完整性自签：`Get-AuthenticodeSignature` 显示 `NotSigned`、用户装机见到
SmartScreen"未知发布者"，**与线上所有历史版本一致，是预期状态不是缺陷**。
发版验收不含 Authenticode 检查；除非用户主动改变决策，发版流程里不要再提。

### 2.7 更新记录生成（S1 两条规矩的落地工具）

- 全量清单来自 S1 的 `git log --since=<COS Last-Modified>`（四仓）；
- canonical 源 `docs/release-notes/<ver>.json` 同时喂桌面端面板（COS sidecar）与官网
  changelog，两处永远同文；
- `sync-changelog-to-site.js` 无去重：重跑改文案前先删 `src/changelog.js` 里的旧条目。

### 2.8 dream-ui 的 pre-push 门（2026-09-19 起）

`git push` 跑四道检查：format / types / i18n / `vitest --changed origin/main`，
热缓存约 50 秒。两条新坑（当天都发生过）：

1. **钩子验证的是工作区，不是推送内容。** commit 信息写了测试改动、
   `git add` 却漏了 `tests/`——pre-push 全绿（工作区里是修好的），
   origin 上还是旧断言，发现它的将是 push 后的 Main Guard 而不是你。
   推送前 `git show --stat HEAD` 对一眼，确认信息里声称的文件真的在。
2. **`vitest --changed` 包含工作区未提交改动。** 另一个会话的进行中
   WIP 会挡住你的纯文档推送——此时 `git push --no-verify` 是钩子自述
   的合法场景（docs-only），但先 `git diff --stat origin/main..main`
   确认自己的推送范围确实碰不到代码。
3. **dom 测试在并发负载下时序假红**（2026-10-24 两例：EnterpriseServerCard
   单跑 6/6 过、CI 上 34s 超时挂 2 个；mermaidBlockPanZoom 本地 7/7 过、
   CI 点击放大挂 1 个）。单跑复验通过 + 失败源不在自己 diff → 重推 /
   `gh run rerun --failed` 是正当处置，别为假红改产品代码。
4. **mock 漂移是 Main Guard 红静音键的新形态**：组件新增 ipcBridge 通道（如
   `conversation.approvalPending`）时，凡用固定形状 mock `@/common` 的 dom
   测试会整树崩、**整个文件**全红。新增通道必须同步 grep `vi.mock\('@/common'`
   把 mock 形状补齐（3.0.14 补了 3 个文件 40 个用例才转绿）。

---

### 2.9 多会话并行下的发版（2026-10-24 固化）

多个 AI 会话共用四仓，dream-core / dream-ui 的 origin 会被并行会话持续推进
（3.0.14 当天 dreamcore 0.1.95→0.1.98 四连发、dream-ui main 当天推进多次）。
发版期的三条规矩：

1. **动手前 fetch 一次，每次 push 前再 fetch**：push 被拒先 `git rebase origin/main`
   再推（rebase 前确认没有别人基于你的提交），绝不 force。
2. **本地旧检出 ≠ 落后工作**：遇到大量未推送提交 / WIP，先核对是否已被并行会话
   经干净 worktree 落库（同消息 `git log --grep`、文件逐字节 `diff`、行数对账），
   确认后备份到 `wip-backup-<日期>` 分支再 `reset --hard origin/main`——3.0.14 的
   88 文件 WIP 核对后全部已在 origin，一场虚惊；dream-ui 的 office chrome 改进
   则是真·未落库工作，验证后随版提交。两种都要会分辨。
3. **打包中途被 pre-flight 拦 = 并行会话又进了新提交**（见 S2 警示框）：追最新
   tag 重钉重验；如果并行会话当天连发，先 `gh run list --repo gaogg521/dream-core
--workflow=Release` 看在途构建再决定钉哪个，减少追的轮数。

---

## 附录 C：历史教训（1oneCore / 1oneUI 时代，一句话版）

| 事故                       | 一句话教训                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| 2.1.49 bun cache 损坏      | native rebuild 失败先清 `bun pm cache rm`                                                 |
| 2.1.51 ACP 组件缺失        | 内嵌资源 + 用户目录缓存双来源的组件，有缓存的机器验证等于没验证                           |
| 2.1.51 CI 全挡             | 私有仓 macOS 10 倍计费；3 秒零步骤失败 = 看账单不是看代码                                 |
| 3.0.0 Mac"已损坏"          | 签名失败的兜底重试会产出假绿；验收只认日志三连                                            |
| 3.0.0 改名                 | `executableName` 决定 .app/exe 壳名；appId 才是冻结项                                     |
| 3.0.1/3.0.2 macos-x64 超时 | 公证排队不可控，timeout 90 min + 构建步内自重试已落地                                     |
| 3.0.2 根清单停旧版         | "传完记得同步根"当人工步骤必丢——publish-cos-release-asset.sh 因此而生                     |
| release-distribute.yml     | CI→COS 限速 + runner 连不上内网凭据服务，永远本地传                                       |
| auto-retry job             | 在自己 run 里调 rerun API 必 403，已移除                                                  |
| Release Please 连红数周    | 两个独立病根：index 里的 CRLF TOML（解析器拒 CR）+ Actions 无权建 PR 的仓库设置；均已修绿 |
| 3.0.6 更新记录两轮返工     | 全量 commit 扫漏 + 话术成段，见 S1 两条规矩                                               |

---

## 附录 D：实时核实命令与相关文档

### 实时核实命令

```bash
gh release view v<core-ver> --repo gaogg521/dream-core --json assets --jq '.assets[].name'
gh run list --repo gaogg521/dream-ui --workflow=build-manual.yml --limit 4 --json databaseId,status,conclusion
curl https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/latest.yml
```

### 相关文档

- **3.0.18 交接话术 + 上周（11-01~11-13）踩坑汇总**（给接手发版的 Agent 直接贴）：[`release-handoff-3.0.18-for-glm.zh-CN.md`](release-handoff-3.0.18-for-glm.zh-CN.md)
- **3.0.14 发版全记录**（mac x64 codesign 连环挂、钉版三连追、多会话并行）：[`dream-en/docs/release-record-2026-10-24-3.0.14.zh-CN.md`](../../../../dream-en/docs/release-record-2026-10-24-3.0.14.zh-CN.md)
- **3.0.6 发版全记录**（数字、决策、遗留）：[`dream-en/docs/release-record-2026-09-19-3.0.6.zh-CN.md`](../../../../dream-en/docs/release-record-2026-09-19-3.0.6.zh-CN.md)
- **3.0.5 发版全记录 + 三个大坑**（划界、失效类名、双清单）：[`dream-en/docs/handoff-2026-09-13-openocta-parity.zh-CN.md`](../../../../dream-en/docs/handoff-2026-09-13-openocta-parity.zh-CN.md) §10
- 3.0.0 Mac"已损坏"根治 + 改名：[`session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md`](session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md)
- 发布链路 + release-distribute 诊断：[`session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md`](session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md) §6
- 发版只走官网 + COS、不发 GitHub Release：memory `release-channel-cos-website-only`
- 发版脚本模板：`D:\dream\scratchpad\release-3.0.6-upload.sh`（复制改版本号）
