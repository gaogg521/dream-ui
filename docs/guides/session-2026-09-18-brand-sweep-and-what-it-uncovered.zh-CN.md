# 上游品牌残留清理，以及它翻出来的一堆坏东西（2026-09-18）

> 品牌清理是由头，真正的收获是**一批一直绿着、但在检查错误对象的脚本和门禁**。
> 后端侧（兼容层被 sweep 改坏、以及怎么自动发现）见 dream-core 同日文档
> `session-2026-09-18-brand-sweep-and-the-compat-layers-it-broke.zh-CN.md`。

## 一、被翻出来的既有缺陷

这些都不是这轮改坏的，是**旧名字一直挂在那里、没人发现它指向的东西已经不存在了**。

### 1. 安装器没把真正的后端二进制交给 Restart Manager

`resources/windows/installer-process-control.nsh` 的 `$knownRelative` 里只有
`resources\bundled-aioncore\win32-x64\aioncore.exe`。当前打包产物是
`bundled-dreamcore\win32-<arch>\dreamcore.exe` —— 也就是说**被锁住的 dreamcore.exe
从来没被注册进 Restart Manager 查询**，安装失败时报不出是谁占着文件。
现在两条都注册，当前那条用 `${ONEWORK_TARGET_ARCH}` 拼 arch。

### 2. 两个发布门禁在检查不存在的产物

- `scripts/smoke-test-web-cli.sh` 校验 `bundled-aioncore/` 目录和 `aioncore` 二进制，
  而 `pack-web-cli.js` 产出的是 `bundled-dreamcore/` + `dreamcore`
- `scripts/verify-release-assets.sh` 找的是 `aionui-web-1.0.0-*.tar.gz`，实际叫
  `dream-web-*`

两者都是"只有负向断言"的脚本，找不到就应该红 —— 但它们找的是另一个名字，于是
**永远绿**。这正是 memory 里「dream-ui 发版CI假绿」那条的同一类。

### 3. `install-web.sh` 的默认镜像指向别人的 releases

`MIRROR` 默认值、`api.github.com/repos/.../releases/latest` 的版本探测、文档与
issue 链接，全部指向上游仓库。已改到本仓库 / COS。

> ⚠️ COS 上 web tarball 的实际目录布局没有在仓库里任何地方定义，脚本按
> `${MIRROR}/v${VERSION}/${TARBALL}` 拼。默认值改成了 COS releases 根，
> **没有实测过**，第一次真的用 `curl | bash` 装之前请先确认。

### 4. 本地构建/开发脚本指向改名前的产物

- `build-fast-debug-*.ps1` 找 `out\AionUi-<ver>-win-x64.exe`，实际是
  `One-Work-<ver>-win-x64.exe`；本地引擎兜底路径也是旧的 bundled 目录
- `dev-bootstrap.mjs` 的进程发现只扫 `electron|AionUi|node|bun`，**没有 `onework`**，
  而它自己的 `KILLABLE_NAMES` 里是有的 —— 两份名单漂移，导致 `bun run dev` 清不掉
  上一次用当前构建起的窗口。改成两处共用一份 `APP_NAME_FRAGMENTS`

### 5. benchmark 脚本设的是一个不存在的环境变量

`AIONUI_DISABLE_DEVTOOLS` —— 应用读的是 `ONE_DISABLE_DEVTOOLS`，所以 benchmark
跑的时候 DevTools 窗口一直在开。

### 6. 内部 HTTP 头发给了没人接的拼写

主进程 system-resume 通知同时发 `x-dream-internal` 和 `x-aionui-internal`；
dream-core 的 `is_internal` 认的是 `x-dream-internal` / `x-one-internal`。
那条"兼容用"的重复头**任何版本的后端都不接**。已改成 `x-one-internal`。

### 7. 五个没有本仓库权限的 owner

`CODEOWNERS`、`triage-map.json`、`issue-triage.yml`、`discussion-triage.yml` 里
的 owner 全是上游维护者账号。CODEOWNERS 里非协作者会被 GitHub 静默忽略，
issue 指派会抛错然后掉进 `needs-triage` 兜底 —— 也就是这四个文件一直在空转。

### 8. 其它

- `UpdateCheckRequest.repo` 是没有任何读者的死字段，注释还写着默认值是上游仓库
- `.claude/skills/bump-version/SKILL.md` 让你 `gh release view --repo <上游>`
- 示例扩展 `hello-world` 声明的 `engine.aionui` 与后端结构体对不上（后端已加 alias
  兼容旧 key，示例改成新 key）

## 二、删掉的东西

| 路径                                       | 为什么                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `.github/workflows/project-automation.yml` | 硬编码上游 org 和 project 编号，在本仓库永远跑不起来                                                   |
| `scripts/install-ubuntu.sh`                | 从上游 GitHub Releases 下 `.deb`；我们既不发 `.deb` 也不发 GitHub Release                              |
| `homebrew/`                                | 官方 Homebrew cask 的参考模板，文件自己写着 DO NOT MODIFY，且它说的 `bump-homebrew.yml` 在本仓库不存在 |
| `CHANGELOG.md` 中 `2.1.x` 及更早           | 那些 compare 链接指向本仓库不存在的 tag。本仓库的 changelog 从 `2.2.0`（三仓独立第一版）开始           |

## 三、两条方法论（比上面的清单重要）

### 改名的粒度必须是「文件」，不能是「行」

第一版脚本按行改 —— 只改"没有 `legacy` 标记的行"。结果：同一个测试 fixture 的
**写入行**在标记窗口内（被跳过）、**断言行**在窗口外（被改名），测试直接坏掉。
改名的最小安全单位是整个文件：文件内保持一致，跨文件靠编译器和 wire 值白名单。

### 字符串字面量的丢失，要在「全仓」范围内查

编译器保护标识符，不保护字符串 —— 而所有持久化契约都是字符串。改完之后要做的是：
取 HEAD 里所有含旧品牌的字面量，减去**整个工作区**里还存在的，**差集就是失去
最后一个读者的兼容层**。只在同文件内做差会漏（值可能从实现里没了、但还留在
别处的测试里）。dream-core 侧靠这一步找出了三个会导致存量用户彻底不可用的改动。

## 四、新增的护栏

`tests/unit/brandResidue.test.ts` 加了第二个 pass，覆盖 `scripts/` 与
`resources/windows/`。这块不随包发布，但它决定**打出什么、验什么** —— 上面
第 1/2/3/4/5 条全躲在这里。新 pass 有自己的白名单，每条必须写理由。

`resources/bundled-*` 与 `node_modules` 被显式跳过（前者是 gitignore 的下载产物，
文件名不归我们管）。

## 五、验证

### 自动化

- `bunx tsc --noEmit` 通过
- `npx vitest run tests/unit`：**605 文件 / 5643 通过 / 7 skipped**（对照 AGENTS.md
  里"数字比 exit code 可信"那条，文件数与上一次全量一致）
- `bun run lint` error 数 0（warning 是既有的）
- `bun run format` 已跑

### 真机（dev + CDP，2026-09-18 夜）

重编 `dreamcore.exe` 并 `prepareDreamcore.js` 落地 bundled 后，用

```bash
DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev
```

起真实 dev，对**存量 dev 库**走查。后端落在 `127.0.0.1:64407`，
`[dreamcore]` 前缀与 `DREAMCORE_LISTENING` 标记都正常 —— 这两个正好是本轮碰过的
跨进程契约，等于顺带验了。

界面侧全部通过：会话/团队/定时任务/历史正常加载；Agents、模型、技能、系统、关于
五个设置页扫描无 `aionui`/`aioncore`/`aionrs`；无任何含旧品牌的资源请求、无坏图。
详细结论（含凭据解密、迁移 057、团队 MCP 不泄漏）记在 dream-core 同日文档的
「七、验证」。

> ⚠️ **本仓的 CDP 方法论有一处必须知道**：应用级 CDP 已经被**故意删掉**，
> `cdpBridge` 只暴露应用内浏览器那一个 webContents、带 token，碰不到 Dream UI 界面。
> 要驱动真实界面只能用开发者通道 `DREAM_DEVTOOLS_CDP_PORT`（dev 专用，打包版硬拒）。
> 另外 `docs/guides/cdp.md` 说得对：**裸 `ws` 客户端比浏览器自动化 MCP 可靠** ——
> 渲染层走 IPC 桥不走 HTTP，直接 `fetch` 后端端口会 `Failed to fetch`，
> 相对路径 `/api/...` 在 dev server 下是 404。正确做法是驱动界面本身让它去取。

### 仍未验证

- **安装器与发布脚本**（第 1/2/3/4 条）需要真的打一次包 / 真的装一次才算验过，
  下次发版时留意
- `install-web.sh` 的 COS 镜像布局没有实测（见第 3 条的警告）
