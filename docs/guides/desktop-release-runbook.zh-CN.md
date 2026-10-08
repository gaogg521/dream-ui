# 桌面端出包手册（Windows / macOS）

> 出安装包前先读这一页。打包脚本开头会自动跑预检（`scripts/preflight-package.js`），
> 不通过直接中止——但预检只能拦它认识的坑，顺序和原因在这里。

## 1. 安装包由哪几部分拼成

| 部分                          | 来源                                                                                    | 会悄悄过期的方式                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 前端（renderer/main/preload） | **本地这份 dream-ui 检出**，打包时现编                                                  | 本地有没提交/没推送的改动 → 包里的代码 GitHub 上找不到                        |
| dreamcore（后端）             | **下载** dream-core 的 GitHub Release，版本由 `package.json` 的 `dreamcoreVersion` 固定 | dream-core main 往前走了，但没发版或没改 pin → 包里是旧后端，**不报任何错**   |
| dream-engine（引擎）          | 编进 dreamcore，由 dream-core 的 `Cargo.lock` 固定                                      | 引擎推了新提交，但 dream-core 没 `cargo update` → 新引擎不在任何 dreamcore 里 |
| hub 资源                      | 打包时 `scripts/prepareHubResources.js` 下载                                            | —                                                                             |

最容易漏的是第二行：**本地 dev 跑的是你自己编的 dreamcore，打包却去下载 pin 住的版本**，dev 里验证通过的后端改动，进不了安装包。

## 2. 出包顺序

1. 三个仓库的改动都已提交并推送（dream-engine → dream-core → dream-ui）。
2. 改过 dream-engine：在 dream-core 里 `cargo update -p dream-engine-agent`，提交推送。
3. 改过 dream-core（含第 2 步）：发 dreamcore 新版本
   1. 等 dream-core main 的 CI 全绿；
   2. 合并 release-please 自动开的 `chore(main): release 0.1.x` PR（它分支上的 CI 显示 `action_required`/`failure` 是正常的——机器人开的 PR 需要人工批准才跑，从没真正跑过代码；以 main 上的 CI 为准）；
   3. **手动触发 Release 工作流**：`gh workflow run release.yml -f tag_name=v0.1.x`（release-please 用默认 token 打的 tag **不会**触发它，历次发版都是手动）；
   4. 等 5 个平台产物都上传（Windows x64 zip、macOS arm64/x64、Linux x64/arm64）。macOS 托管 runner 偶尔没容量，任务会在「not acquired by Runner」后被取消、上传步骤跳过——`gh run rerun <id> --failed` 重跑即可。
4. dream-ui 把 `dreamcoreVersion` 改成新 tag。改之前**下载一次并在二进制里查本次改动独有的字符串**（日志文案、提示词片段），不要只信版本号。
5. 打包：`bun run build-win:x64` / `bun run build-mac` 等。预检会先跑。

## 3. 预检查什么

| 检查                                                                                                                                               | 失败时                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| dream-ui 有未提交 / 未推送的改动（CI 上跳过）                                                                                                      | FAIL                         |
| pin 住的 dreamcore 版本落后 dream-core main，且差异里有**影响构建的文件**（`crates/`、`Cargo.toml`、`Cargo.lock`、`.cargo/`；测试、文档、CI 不算） | FAIL，列出缺的提交           |
| pin 住的 Release 里缺本次要打的平台/架构的二进制                                                                                                   | FAIL                         |
| `dreamcoreVersion` 没设（会退化成「最新版」，不可复现）                                                                                            | FAIL                         |
| 用 `DREAM_BACKEND_LOCAL_PATH` / `DREAM_BACKEND_RUN_ID` 打包                                                                                        | warn：这种包不可复现，别发布 |
| dream-engine main 有源码改动不在 dream-core 的 pin 里                                                                                              | warn                         |
| dream-core pin 的引擎提交不在引擎 main 上（历史被改写）                                                                                            | FAIL                         |

查 GitHub 失败（断网、限流）也算 FAIL——查不了就不知道后端是不是新的。确实知道自己在干什么时，用 `DREAM_SKIP_PREFLIGHT=1` 跳过，并在发版说明/提交信息里写原因。
有 `GH_TOKEN`/`GITHUB_TOKEN` 时会带上，避免匿名 API 限流。

单独运行：`node scripts/preflight-package.js --platform win32 --arch x64`

## 4. 踩过的坑

- **2026-10-08**：提问弹窗的后端转发、侧边栏等待标记修复都在 dream-core main 上，`dreamcoreVersion` 还停在 v0.1.79。dev 里一切正常（dev 用的是本地编的 dreamcore），直接打包会得到「前端有弹窗、后端不发问题」的安装包。预检当场报出 16 个提交。
- **同日**：合并 release PR 后 Release 工作流没自己跑（tag 不触发）；手动触发后两个 macOS 任务没抢到 runner 被取消，Release 页面只有 Windows/Linux 产物。Mac 包若此时打，`prepareDreamcore` 会在中途下载失败。
- 2026-10-07（v0.1.78→v0.1.79）：同类问题，bundled 目录里是本地编的二进制，CI 无法复现。
