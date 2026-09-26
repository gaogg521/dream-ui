# Windows + Mac 打包与发布踩坑手册（Playbook）

> 可操作的打包发布手册。2026-09-19 按 **最近三次成功发版（3.0.4 / 3.0.5 / 3.0.6）**
> 重构：第一部分就是现在的标准流程，照着走即可；第二部分是仍然有效的坑的快速索引；
> 1oneCore / 1oneUI 时代的历史教训压缩成第三部分的一张表，细节在文末的 session 文档里。
>
> **版本坐标（2026-09-20）**：3.0.6 之后已发 3.0.7（备份跨机恢复修订 + 口令），
> 下一版是 **3.0.8**。S0–S7 流程在 3.0.7 上原样复跑通过，无需改动。
>
> 权威的"当前发布状态"永远用实时命令查（§3），别信任何文档里写死的时间点快照。

---

## 第一部分：标准流程（3.0.4 → 3.0.5 → 3.0.6 三次成功发版提炼）

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

### S4. 三路并行打包

```bash
# Windows 本机（~20 min；先确认无 electron/dreamcore dev 进程占文件，杀按 PID）
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

```bash
scripts/publish-cos-release-asset.sh out/One-Work-<ver>-win-x64.exe <ver>   # exe：只进版本目录
scripts/publish-cos-release-asset.sh out/latest.yml <ver>                   # yml：自动镜像根
scripts/publish-cos-release-asset.sh <tmp>/release-notes.md <ver>           # sidecar：只进版本目录
```

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

10 个对象逐个 `publish-cos-release-asset.sh` 上传 → 官网切 `macArm`/`macIntel`

- 真实尺寸 → build + deploy。

### S7. 终验（不看文案看 URL）

1. 版本目录 13 个对象逐个 `curl -sI` = 200；
2. 三份根清单 `releases/latest.yml` / `latest-mac.yml` / `latest-arm64-mac.yml`
   的 `version:` = 新版本，其 `path:` 指向的对象同目录真实存在；
3. 线上 `main-*.js` 含 `win/macArm/macIntel:"<ver>"` 与三个新尺寸；
4. `platformVersions.linux` **没动**（本轮没打 deb 时它必须停在上一版，一个键管两条链）；
5. 发版记录落盘 `dream-en/docs/release-record-<日期>-<ver>.zh-CN.md` 并推送。

---

## 第二部分：仍然有效的坑（快速索引）

### 2.1 Mac CI（build-manual.yml）

| 症状                                  | 病根 / 解法                                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| run 几秒失败、steps 空、log not found | **计费拦截**（私有仓 macOS 10 倍计费）。用 `gh api repos/gaogg521/dream-ui/check-runs/<jobId>/annotations` 看真因；解法是修付款/提额度或转 public                           |
| Prepare dreamcore 404                 | `dreamcoreVersion` 指向的 Release 不存在——S2 的 tag 先出包再 dispatch                                                                                                       |
| 卡 oxfmt/tsc/vitest                   | 本地先跑绿四道 gate 再 dispatch；vitest 历史失败要现查是否与本次相关                                                                                                        |
| 签名成功但装机报已损坏                | 看 build step 的守卫：`signing file=… Developer ID Application` → `properly code signed` → `Notarization completed` 三连，缺一即红（IDENTITY secret 只填证书 CN、不带前缀） |
| 超时 60:17                            | x64 公证排队不可控，timeout 已提到 90 min；codesign 偶发卡死是 OCSP flaky，重跑                                                                                             |

`installers_only` 必须为 **false**：Mac 自动更新走 `.zip` 不是 `.dmg`，
true 会在上传前把 zip+yml 删掉（3.0.1 / 3.0.2 各踩一次）。

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

---

## 第三部分：历史教训（1oneCore / 1oneUI 时代，一句话版）

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

## 实时核实命令

```bash
gh release view v<core-ver> --repo gaogg521/dream-core --json assets --jq '.assets[].name'
gh run list --repo gaogg521/dream-ui --workflow=build-manual.yml --limit 4 --json databaseId,status,conclusion
curl https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/latest.yml
```

## 相关文档

- **3.0.6 发版全记录**（数字、决策、遗留）：[`dream-en/docs/release-record-2026-09-19-3.0.6.zh-CN.md`](../../../../dream-en/docs/release-record-2026-09-19-3.0.6.zh-CN.md)
- **3.0.5 发版全记录 + 三个大坑**（划界、失效类名、双清单）：[`dream-en/docs/handoff-2026-09-13-openocta-parity.zh-CN.md`](../../../../dream-en/docs/handoff-2026-09-13-openocta-parity.zh-CN.md) §10
- 3.0.0 Mac"已损坏"根治 + 改名：[`session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md`](session-2026-08-31-mac-signing-and-brand-executable.zh-CN.md)
- 发布链路 + release-distribute 诊断：[`session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md`](session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md) §6
- 发版只走官网 + COS、不发 GitHub Release：memory `release-channel-cos-website-only`
- 发版脚本模板：`D:\dream\scratchpad\release-3.0.6-upload.sh`（复制改版本号）
