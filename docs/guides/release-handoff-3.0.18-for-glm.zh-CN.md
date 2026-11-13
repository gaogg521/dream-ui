# 桌面 3.0.18 打包发布交接（给 GLM）+ 上周踩坑

> 2026-11-13 夜写成。第一部分是 **2026-11-13 23:30 实时命令核过的状态**；第二部分是**可以直接整段贴给 GLM 的话术**；
> 第三部分是上周（11-01 ~ 11-13）发版踩过的坑，按「症状 → 真因 → 怎么做」排。
> 标准流程（S0–S7）不在这里重复，权威是 [packaging-release-playbook.zh-CN.md](./packaging-release-playbook.zh-CN.md)，
> 预检原理见 [desktop-release-runbook.zh-CN.md](./desktop-release-runbook.zh-CN.md)。

## 一、当前状态快照（别当永远成立，开工先用 §S0 的命令重核）

| 项                         | 值                                                                                                                          | 怎么核                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 线上桌面版本               | **3.0.17**，五个平台全齐（win / macArm / macIntel / linux×2），**新旧两个桶**根清单都是 3.0.17                              | `curl -s <桶>/releases/latest*.yml \| head -1`                      |
| 目标版本                   | **3.0.18**（semver 大于 3.0.17，会推送）                                                                                    | playbook S0 ⑤                                                       |
| `dreamcoreVersion`         | 现在是 `v0.1.103`，**必须追到 `v0.1.104`**                                                                                  | `package.json`                                                      |
| dream-core                 | `v0.1.104` 已发布（11-13 10:57），5 个平台包 + checksums 齐，`main` 与 tag **零差异**                                       | `gh release view v0.1.104 --repo gaogg521/dream-core --json assets` |
| dream-engine               | `16e5aea`（11-12 23:35），与 dream-core `Cargo.lock` 里的固定提交**一致**，已随 v0.1.104 进包                               | `grep -A3 'name = "dream-engine-agent"' Cargo.lock`                 |
| dream-ui `main`            | 本地 = `origin/main`，最后一次推送 `8f4838d7`（11-13 23:16）                                                                | `git status -sb`                                                    |
| 3.0.17 的分界时间点        | win exe `Last-Modified` = 11-07 01:47 GMT = **11-07 09:47（+8）**；mac-x64 补发 11-07 20:44（+8），但那之后只有 CI/文档提交 | playbook S0 ④                                                       |
| 新桶是否可写               | `onework-1521070673` **已充值，读写都通**（3.0.17 发版时还欠费，所以 3.0.17 只发了旧桶；**3.0.18 起恢复双桶发布**）         | —                                                                   |
| 官网 `LEGACY_LAST_VERSION` | 现为 `3.0.17`：≤3.0.17 的下载链接指旧桶，**3.0.18 起指新桶** —— 所以 3.0.18 必须两个桶都传齐再切官网                        | `D:\website\1onework\src\site.config.js`                            |

### ⛔ 开工前必须先解决（否则预检直接红）

1. **`resources/远程连接.png` 在工作区里是被删除状态**（tracked 文件，不是我删的，会话开始前就在）。
   预检用 `git status --porcelain --untracked-files=no`，**已跟踪文件的删除也算「未提交改动」→ FAIL**。
   而 `README.md:188` 还在引用这张图，直接提交删除会让 README 图裂。
   → **这要用户决定**：恢复（`git checkout -- resources/远程连接.png`）还是连 README 一起改。**GLM 不要自己拍板。**
2. 工作区里还有一堆未跟踪的 `.tmp-*.mjs`、`C：Users…release-assets-*` 目录——预检忽略未跟踪文件，**不用清，也别 `git add -A`**。

### ❓ 需要用户确认的两件产品事

1. **「外网访问隧道」要不要进 3.0.18 的更新说明？** 记忆里 11-12 用户说过「先不发」。但 v0.1.104 已经带着扫码登录修复发了，
   隧道功能本身（frpc 内置、`*.r.1work.vip` 泛域名证书、broker 发子域名）线上基础设施是通的。**不确认就别写进更新说明**，
   也别擅自在界面里藏入口。
2. **企业版要不要同批发？** 企业 1.0.17 已在 11-13 发了（含 core v0.1.103），v0.1.104 里「渠道健康检查返回上游模型列表」属于企业侧，
   但**这次只打桌面**。企业版升级走另一条线（`dream-en/deploy/OFFLINE-BUNDLE.md`），别混进来。

---

## 二、话术（整段复制给 GLM）

```text
你要完成 One Work 桌面端 3.0.18 的「打包 + 发布」一条龙：Windows x64、macOS arm64/x64、Linux x64/arm64 五个平台，
传到两个 COS 桶，切官网，写发版记录。你是执行者，发版动作（合并 release PR、传 COS、部署官网）都是你的活，
只有「删除/覆盖线上已有的东西」才需要先问我。

【先读，按顺序，读完再动手】
1. D:\dream\dream-ui\docs\guides\release-handoff-3.0.18-for-glm.zh-CN.md   ← 本次交接，含当前状态和上周踩坑
2. D:\dream\dream-ui\docs\guides\packaging-release-playbook.zh-CN.md        ← 标准流程 S0–S7，权威
3. D:\dream\dream-ui\docs\guides\desktop-release-runbook.zh-CN.md           ← 预检原理
4. D:\dream\dream-en\docs\release-record-2026-11-07-3.0.17.zh-CN.md         ← 上一版的实录，最贴近现状
5. D:\dream\dream-ui\docs\release-notes\README.md                           ← 更新说明 JSON 的固定格式

【硬规矩】
- 提交信息一律中文（type 前缀保留英文，如 chore(release): 3.0.18），不加任何 AI 署名（Co-Authored-By / Generated with 都不要）。
- 只在 main 上干活，直接提交推送，不开分支不开 PR。不要走 bump-version 技能里的「分支→PR→自动合并」流程，那是旧约定，与本仓不符。
- 绝不 force push；推送被拒就 git pull --rebase 再推。每次 push 前先 git fetch——别的会话也在往 main 推。
- 凭据（feishu.txt 里的 Token/SignKey/COS 密钥）绝不进仓库、不贴进对话、不写进日志。
- 发版窗口内不要往 dream-core 推任何影响构建的提交（crates/、Cargo.toml、Cargo.lock、.cargo/）——它会让预检把后面几条腿全拦掉（3.0.17 就这么栽过）。
- 不要用 DREAM_SKIP_PREFLIGHT=1，除非你已经确认被拦的提交和本版无关，并在发版记录里写明。
- Windows Authenticode 不签，是既定决策，别再提。

【开工前，先核对状态（实时命令，不要信文档里的快照）】
- 四仓 git status -sb + origin/main...main 计数；dream-ui 必须没有「已跟踪文件」的未提交改动。
  已知：resources/远程连接.png 在工作区是被删状态，会让预检红——这个不要自己处理，停下来问我。
- dream-core 的最新 tag 是不是 v0.1.104、5 个平台产物 + dreamcore-checksums.txt 是否齐；main 上有没有 v0.1.104 之后的新提交。
- 线上两个桶的 releases/latest*.yml 当前都应是 3.0.17。
- 3.0.17 的分界点 = win exe 在 COS 的 Last-Modified（11-07 09:47 +8）。用它做 git log --since，不要用 release 提交的时间。

【执行】
S2 钉版：package.json 的 dreamcoreVersion 改成 v0.1.104。验三件套（缺一不算验过）：
  ① git merge-base --is-ancestor <修复提交> v0.1.104；② 下载的 zip 对 dreamcore-checksums.txt 算 SHA-256；
  ③ 在二进制里 grep 生产代码里独有的 tracing/错误文案（别挑 #[cfg(test)] 里的字面量；短字面量比较会被内联，要按 8 字节切片搜）。
  不要拿本机 resources/bundled-dreamcore 里本机编的二进制顶替（manifest.json 里 sourceType 必须是 release）。
S1 更新说明：用上面的分界点扫四仓全量 commit，逐条归类，用户可见的必须有对应条目，可以合并、不许漏；后端独有的 fix 最容易漏。
  初筛清单我放在交接文档 §四，你必须自己重扫复核。写 docs/release-notes/3.0.18.json（固定结构：zh/en × 单机/企业 × 新增/优化改进/修复；
  en 小节要直接写 [New]/[Improved]/[Fixed]，英文页不许有汉字）。开头定调按「品牌战略升级 + dream 引擎更强 + 内置模型开箱即用」。
S3 发版提交：package.json version=3.0.18 + dreamcoreVersion + release-notes，一个 chore(release): 3.0.18 提交推 main。
S4 并行出包，dispatch 之后记下每个 run id：
  - Mac 腿最先发、全程盯：build-manual.yml 的 platform=macos-arm64 与 macos-x64（installers_only=false，别传 true）。
    健康基线 arm64 ≈12 分钟、x64 ≈16 分钟（含公证）；任何 Mac 腿超过 25 分钟就是卡死，不要调大超时、不要盲目 rerun，先看 job 日志里的 [wd] 采样栈。
  - linux-x64、linux-arm64、windows-x64 同时发齐，别只发 Mac 等后面补。Windows 也可以本机 bun run build-win:x64（本机无 electron/dreamcore dev 进程占文件）。
S5/S6 落地：谁先好谁先走，不等齐。逐文件 sha512 与清单对账；Mac 产物必须核验「签名 + 公证票据」
  （zip 内 onework.app/Contents/_CodeSignature/CodeResources 与 onework.app/Contents/CodeResources 两个文件都要在，缺公证票据的包不许发布）；
  下载制品用 scripts/download-gh-artifact.sh，按平台并行、每次从空文件开始，不要断点续传。
S5 传 COS：scripts/publish-cos-release-asset.sh，一次写两个桶，顺序固定为安装包先、latest*.yml 最后。
  两套凭据互不通用：旧桶 1onework-1251001122 走 scripts/fetch-cos-credentials.js（先把 feishu.txt 里的 BASEURL/Token/SignKey 解析成 env，BASEURL 是全角冒号、后面补 /oapi/qcloud/alloc，且与上传在同一次 Bash 调用里）；
  新桶 onework-1521070673 走 ONEWORK_COS_ACCESS_KEY_ID / ONEWORK_COS_SECRET_ACCESS_KEY（feishu.txt 倒数第二对，主账号 zhaogao；最后一对对新桶是 403，别用）。
  不要在 GitHub 托管 runner 上传（传不动）；不要跑 publish-cos.yml 的真实上传（它的日志 blob 404、办公网 runner 会话结束就掉线，3.0.17 走的是手动路径）。
  别忘了更新说明 sidecar：node scripts/generate-release-notes.js --version 3.0.18 --out … → releases/3.0.18/release-notes.md，应用的更新弹窗读它。
官网：改 site.config.js 的 platformVersions（win/macArm/macIntel/linux 四个键，谁传完两个桶谁先切）和 platformSizes（字节数 ÷ 1048576）。
  LEGACY_LAST_VERSION 保持 3.0.17 不动——它是「旧桶里最后一个版本」，不是当前版本。
  部署只能在主工作区 D:\website\1onework 构建（npx vite build --outDir <临时目录>），不能用干净 worktree，会抹掉线上现有的未提交内容；
  部署前和线上逐文件比 sha256，应当只有 main-*.js 与 index.html 不同；python D:\game\scripts\deploy-1onework-www.py --dist <临时目录>；
  DEPLOY_OK 不代表构建过——必须读线上 main-*.js 里的 win:"3.0.18" 等钉；部署完立刻在 D:\website\1onework 提交推送。

【终验——不看文案看 URL（S7）】
- 版本目录每个对象在两个桶里 curl -sI 都是 200，Content-Length 等于本地文件大小；
- 两个桶的根清单 latest*.yml 的 version: 都是 3.0.18，其 path: 指向的对象真实存在，且与构建产物逐字节相同；
- 官网线上 bundle 含 win/macArm/macIntel/linux:"3.0.18"，下载链接真实请求能下；
- 发版记录写到 D:\dream\dream-en\docs\release-record-<日期>-3.0.18.zh-CN.md 并推送（参照 3.0.17 的结构：版本坐标 / 范围 / 钉版决策 / 雷 / 发布执行 / 未决事项）。

【遇到这些就停下来问我，别自己决定】
- 任何要删除或覆盖线上已有对象/已发布包的操作；
- 预检要求 DREAM_SKIP_PREFLIGHT；
- 「外网访问隧道」要不要写进更新说明；企业版要不要同批发；
- resources/远程连接.png 怎么处理；
- 某个平台反复失败：先按「增量收口」处理——其余平台先发，这一条腿写好配方挂起，不要为一条腿拖死整场（见 playbook 2.1.1）。

【汇报方式】每完成一个阶段（钉版 / 发版提交 / 每个平台出包 / 每个平台上线 / 官网 / 终验）用一两句中文告诉我结果和证据（run id、对象数、sha 对账结果），
不要只说「完成」。出了事故先说症状和你的判断依据，再说怎么处理。
```

---

## 三、上周踩坑（11-01 → 11-13）

### 3.1 CI 与签名（3.0.17，11-06/07）

| #   | 症状                                                                                      | 真因                                                                                                                                                                                     | 怎么做 / 现状                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 两条 Mac 腿 Build 步**秒级 cancelled**                                                    | GitHub 下线了 `macos-14` runner 镜像（annotation：`config … is not supported`）                                                                                                          | 五处 workflow 已换 `macos-15`；**mac-x64 腿跑原生 Intel 的 `macos-15-intel`**，不再交叉构建。再遇到秒级失败先看 annotation，别猜代码                    |
| 2   | **mac-x64 卡在 `signing file=out/mac/onework.app`**，无输出直到被杀（13 次 attempt 全挂） | **钥匙串自动锁定**：workflow 没设过 `security set-keychain-settings`，只在构建开头 unlock 一次。采样栈 `codesign→…→SSKey::getAcl→mach_msg` = 在等无头机永远不会出现的授权弹窗            | 已修（`a22c1e34`）：`set-keychain-settings -lut 21600` + 构建期间每 60 秒 unlock + 60 秒有界 warm-up 签名，x64 一次过 **16 分钟**。**>25 分钟就是卡死** |
| 3   | 走了一大圈弯路：逐级加大超时、怪交叉编译、重打 partition-list、盲目 rerun                 | 都不是真因；**超时被杀时转储的「最后 40 行」时间戳全是转储那一刻**，据此推算「50 分钟才到签名点」是错的                                                                                  | 别加超时；一次只改一个变量，每次要能在 40 分钟内给出结论；cancel 经常被 runner 拖到 attempt 边界才生效，别对着旧 run 干等                               |
| 4   | **构建全绿、产物齐，但 `.app` 里没有公证票据**                                            | `afterSign.js` 在签名校验不过/Apple 凭据缺失时只打印 `Skipping` 就 return，而 workflow 把 `notarization_status=success` 写死                                                             | 已加闸门（`99bd3bd0`）；**判据永远是下载产物查 `Contents/CodeResources`**，CI 绿不算。日志里应依次出现 `[sign-evidence]` 的三连                         |
| 5   | **Windows CI 腿 3/3 同因死**，且历史上 windows-build-x64 artifact 总数为 0                | `downloadBuilderToolset` **冷缓存首次下载会先往 stdout 打一行进度**再写路径，脚本把整串当路径；本地热缓存永远不显现                                                                      | 已修（`7e4208ba`，取 stdout 末行）。3.0.17 起 Windows 才能在 CI 出包；本机出包仍是常规做法                                                              |
| 6   | 4/5 条腿**预检红**                                                                        | 发版窗口内往 dream-core 推了 build-relevant 提交（Cargo.toml/lock，为修 Security Audit）。preflight 是**每个平台各自的显式步骤**，windows 步里的 skip 只是「本腿已跑过」，不是全平台豁免 | **发版窗口内不推 core 的 build-relevant 提交**；被拦就追最新 tag 重钉重验（v0.1.102→103 就是这么追的）                                                  |
| 7   | linux-x64 / macos-x64 **Code Quality 红**                                                 | `mermaidBlockPanZoom` 并发时序假红（单跑全过、其他腿全过）                                                                                                                               | `gh run rerun --failed`，**别改产品代码**，别为它烧一轮 35 分钟全量重跑                                                                                 |
| 8   | Main Guard **11-02 起连红 11 次**                                                         | 一处 `unicorn(no-useless-fallback-in-spread)` 的唯一 error                                                                                                                               | 一行修复复绿。推完要**看 Main Guard**，pre-push 不跑 lint                                                                                               |

### 3.2 上传与发布（3.0.16 / 3.0.17）

| #   | 症状                                                           | 真因                                                                                                                                                                                          | 怎么做                                                                                                                                                                 |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | 第一次上传报 `Unable to locate credentials`                    | `fetch-cos-credentials.js` 只在 env 里**已有** `COS_ALLOC_URL/TOKEN/SIGN_KEY` 时才能换临时凭据；feishu.txt 里 BASEURL 是**全角冒号**、要补 `/oapi/qcloud/alloc`                               | 先把三个值解析成 env，再 eval fetch，再上传，**同一次 Bash 调用**。凭据不进仓库、不贴对话                                                                              |
| 10  | `prepare-release-assets.sh` 报 `installer present without yml` | 它按 `*/<platform>/*` 找清单，而 `download-gh-artifact.sh` 把制品拍平了                                                                                                                       | 按 `macos-build-arm64/`、`windows-build-x64/`、`linux-build-x64/`… 平台子目录重组后重跑                                                                                |
| 11  | `publish-cos` workflow dry-run **卡在队列**，真跑不了          | 办公网自托管 runner（`onework-office`）是**手动起的、会话结束就掉线**，在本机 `D:\actions-runner`；另外该 workflow **步骤日志 blob 上传 404**（步骤结论全 null）                              | 先双击 `run.cmd`；日志不可见就走手动路径（download → prepare → publish，脚本与 workflow 内部调用完全一致）。真实上传和回读校验步骤**还没在真发时跑过，别第一次就押它** |
| 12  | 两个桶的凭据混用 → AccessDenied / 403                          | 新旧桶凭据**互不通用**；新桶 key 是 feishu.txt **倒数第二对（主账号 zhaogao）**，最后一对对新桶是 403                                                                                         | 旧桶 `AWS_*`（内网凭据服务换），新桶 `ONEWORK_COS_*`；缺任一目标凭据脚本会在上传前报错，不会半传                                                                       |
| 13  | 老客户端收不到更新                                             | 已装 App 把更新地址**写死成旧桶**；只传新桶 = 已装用户永远「已是最新」，无任何报错                                                                                                            | **两个桶都要写**，且 `latest*.yml` 在两个桶都对。**别在 3.0.18 只传了一个桶时就切官网**                                                                                |
| 14  | **官网部署抹掉线上内容**                                       | 线上官网有**工作区未提交**的内容（`onebuddy.html/css`、`carousel-manifest.json`、`en.json`…），部署脚本先清空线上目录再解压；干净 worktree 里 `core.autocrlf=true` 还会让全部文本文件换行不同 | 只能在主工作区 `npx vite build --outDir <临时目录>`；**和线上逐文件比 sha256**，应该只差 `main-*.js` 与 `index.html`；部署后再比一次应 100% 相同；部署完立刻提交推送   |
| 15  | `DEPLOY_OK` 却是旧版                                           | `deploy-1onework-www.py` 在 `npm run build` 失败时照样推旧 dist 并打印 DEPLOY_OK                                                                                                              | 读线上 `main-*.js` 里的 `win:"3.0.x"`；英文更新说明里有汉字会被 i18n 门禁拦（`en` 小节直接写 `[New]/[Improved]/[Fixed]`）                                              |
| 16  | 更新弹窗没有更新说明                                           | 忘了 sidecar `releases/<ver>/release-notes.md`                                                                                                                                                | `node scripts/generate-release-notes.js --version <ver> --out …` 后传两个桶                                                                                            |
| 17  | `LEGACY_LAST_VERSION` 被当成「当前版本」改                     | 它是**旧桶里最后一个版本**                                                                                                                                                                    | 3.0.18 发版时**不动**它，3.0.18 的链接自然指新桶                                                                                                                       |

### 3.3 增量发布配方（Intel Mac 这类卡住的腿）

- 先发的批次**不要带那条腿的 `latest*.yml`**（`prepare-release-assets.sh` 对缺失平台自然不生成），根清单里它还停在上一版，已装老用户不会被推一个不存在的包；官网对应的钉也留在上一版。
- 补发时写它的 `latest*.yml` 并把官网**那一个钉**切过去。官网 `platformVersions` 四个键（win / macArm / macIntel / linux）各自独立，`platformSizes` 与版本是同一个事实，一起改。
- `installers_only` 必须是 `false`：Mac 自动更新走 `.zip` 不是 `.dmg`，传 `true` 会在上传前把 zip 和 yml 删掉。

### 3.4 其他一句话教训

- **发版慢是事故不是流水线**：健康流水线 CI 派发 → COS 传完约 39 分钟（3.0.16 实测）；平时 4~5 小时全来自 mac x64 挂死、网络/白名单、flaky 门禁。遇到慢先用 `gh api …/runs/<id>/jobs` 的时间戳 + COS `Last-Modified` 对账，别凭感觉去重构流水线。
- **发版范围按安装包实际产出的时间划**，不是按 release 提交时间（3.0.5 因此漏了整轮工作）。
- **CI 制品下载**：同一个文件绝不能有第二个写入者（杀下载循环要连 `curl.exe` 一起杀）；`-C -` 断点续传跨 302 不可靠；校验目标是 GitHub 的 artifact digest；下载端点要 `Accept: application/vnd.github+json`（手册以前写反了）。
- **打包版无法用 CDP 驱动 UI**（`app.isPackaged` 下应用调试端口被无条件拒绝，是安全设计）。「设置→工具→one-web-search 显示可用」「技能数 114」这类只能装机验的项，用 grep `app.asar` / 包内 dreamcore 做等效替代。
- **Windows 的 `python3` 是 Store 占位符**，静默无输出，用 `python`；这个 shell 的 `ls` 带 `-F`，文件名后会多个 `*`，拼 URL 会得到假 404；Bash 工具会吞反斜杠。
- **没预检就别信「后端是新的」**：dev 里跑的是本机编的 dreamcore，安装包下载的是 pin 住的 Release；dev 验证再绿也进不了包。

---

## 四、更新说明初筛（我粗扫的，GLM 必须按 S1 重扫复核）

分界点 11-07 09:47（+8），到 11-13 23:16。**这是初筛，不是定稿**：

**dream-ui 用户可见**

- 新增：智能体用「内置浏览器」时自动打开面板（此前必须手动先开面板，否则报「未挂载」）；浏览器视图提到全局宿主，开合面板不再重载页面；浏览器出现时自适应宽度（项目会话折叠资源管理器、预览区加宽到 640px）；标题栏新增常驻的彩色浏览器按钮
- 新增：任务完成后推送到「我的聊天」（IM 机器人）；远程连接页重做、手机端导出管控与通知授权提示、渠道名改为飞书/Lark；外网访问隧道（**待用户确认是否写入**）
- 新增：共享场景与数字员工头像；技能广场 AutoCAD 说明补「转可旋转三维模型」；`CONTEXT_DEGRADED_COMPACT`、`CONTEXT_SUSPECTED_OVERLIMIT` 两条上下文压缩提示（13 种语言）
- 修复：HTML 预览超过约 2 MiB 时整页空白

**dream-core `v0.1.103 → v0.1.104`（随钉版进包）**

- 新增：CAD 三维文件/带标注型线图转可旋转 3D、`read` 零依赖读图命令、`--texts` 列出图中文字、`preview` 出图命令（输出不再写进技能目录）；长任务完成后推送到用户自己的 IM 机器人
- 修复：扫码登录页提交的字段名与接口不一致，**每次扫码都失败**；「打开所在目录」对目录改为打开目录本身；读图任务设完成标准，不再被「必读/必写经验库」拖成几十步
- 引擎（dream-engine）：非标准 `finish_reason` 不再丢工具调用（「主导只宣布不派活」的真因）；超长上下文失常时自动压缩；无回复且上下文很大时提示手动压缩；默认上下文窗口对齐 500k

**企业版小节**：运行时节点心跳上报本机已装 Agent（`becaa701`）；渠道健康检查返回上游模型列表（core `5295ab8`）。

> 最容易漏的是**后端独有的 fix**（没有 UI 对应物）——按「主题」归类，不要按仓库归类。
