# Mac 打包签名公证打通 + macOS 老系统 Node 兼容修复 + 发布链路排障（07-21）

> **2026-07-21**。给后续 AI / 人类读的本轮完整交接。涉及三仓：`1oneUI`（`one-main`）、`1oneCore`（`one-main`）。

---

## 0. 起因

用户要给 Mac 端配上签名+公证，一开始只是"帮我把 Apple 开发者证书配成 GitHub secrets"，逐步演变成：真机（MacBook Pro 13-inch M1 2020，**macOS Big Sur 11.6**）装上后报错「1One Work 安装不完整……托管 Node 运行环境无法启动」，且崩溃弹窗里的"下载最新版"按钮跳到了上游官网。顺带把"热更新地址对不对""能不能真正发正式 Release 让热更新跑起来"这条线也一起理清了。

---

## 1. Apple 签名/公证：secrets 配置 + 一个真实签名 bug

用户提供了证书文件（`.p12`）、密码、Apple ID 及 App 专用密码。按安全规则，涉及密码/证书文件本身的操作（`base64` 编码、导入 GitHub secrets）全部由用户自己在 GitHub 网页操作或本机执行，Claude 不经手明文密钥。最终 `gaogg521/1oneUI` 仓库配好 6 个 secrets：`BUILD_CERTIFICATE_BASE64`、`P12_PASSWORD`、`IDENTITY`、`TEAM_ID`、`APPLE_ID`、`APPLE_ID_PASSWORD`。

### 真实 bug：`IDENTITY` 多带了证书类型前缀

第一次打包时 electron-builder 在签名阶段报错：

```
⨯ Please remove prefix "Developer ID Application:" from the specified name — appropriate certificate will be chosen automatically
```

`IDENTITY` secret 存的是完整证书名（`Developer ID Application: Huanle Entertainment (Shanghai)Technology Co., Ltd. (HKT9687899)`），但 electron-builder 的 `CSC_NAME` 只要证书**公司名部分**，前缀它自己会加。多带前缀直接导致签名失败——但项目自带的 DMG 重试逻辑（[`build-with-builder.js:526`](../../scripts/build-with-builder.js:526)，检测到".app 有了但.dmg 没生成"就用 `--prepackaged` 重试）会跳过签名直接把**未签名**的 `.app` 打包成 DMG，而 CI 的判定逻辑只看"DMG 文件是否存在"就报 success——**两次构建都显示绿色，但产物实际未正确签名**，这是本轮排查出来的一个真实、此前未被发现的假阳性坑。

修复：把 `IDENTITY` secret 改成去掉前缀的纯证书名。改完两次重新构建，日志明确出现 `App 1onecode is properly code signed` → `Starting notarization for 1onecode (com.huanle.oneone.ai)...` → `Notarization completed successfully`，是真实通过。

**教训**：CI 报 success 不代表签名真的成功——这条 DMG 重试兜底逻辑本身是为了应对 hdiutil 之类的瞬时性 DMG 创建失败设计的，但会把"签名彻底失败"也一起兜住，值得后续加一道"验证 codesign 是否真的执行过"的显式检查，本轮未做（属于下一轮可选加固项）。

---

## 2. Bundle ID 改名：`com.aionui.app` → `com.huanle.oneone.ai`

用户要求配合新签发的 Developer ID 证书主体改 bundle ID。改了两处（`1oneUI` commit `3d5e555ff`）：

- [`electron-builder.yml:1`](../../packages/desktop/electron-builder.yml) 的 `appId`
- [`autoUpdaterService.ts`](../../packages/desktop/src/process/services/autoUpdaterService.ts) 里 dev 模式下必须与 appId 保持一致的 `updaterCacheDirName`（及一处解释性注释）

`homebrew/aionui.rb.example` 里同样出现的 `com.aionui.app` **没有改**——那是文件自己标注"DO NOT MODIFY"的上游 AionUi 官方 Homebrew cask 模板，跟本 fork 的 bundle ID 无关。

exe 文件名 (`1onecode`) 和 productName 不受此次改动影响。

---

## 3. macOS Big Sur 兼容问题：根因是内置 Node 运行时太新

### 症状

用户真机（M1 + Big Sur 11.6）装上签好名的包后报「1One Work 安装不完整……当前安装缺少必要的内置运行组件，**托管 Node 运行环境** 无法启动」。

### 定位

追到 [`1oneCore/crates/aionui-runtime/src/node_runtime/mod.rs:228`](../../../1oneCore/crates/aionui-runtime/src/node_runtime/mod.rs) 的 `validate_runtime()`：这个检测是真的在 spawn `node --version` 子进程，失败才报"无法启动"，不是简单查文件存在。当时内置 Node 版本钉的是 [`24.11.0`](../../../1oneCore/crates/aionui-runtime/src/node_runtime/managed.rs)（很新的大版本）。

**排除签名问题**：Apple 公证会递归校验包内所有可执行文件的签名，如果 Node 二进制没签好，公证会直接拒收，但两次公证都干净通过——所以不是签名/公证的问题。

**推断根因**（未能在真机复现验证，是基于代码证据的最合理猜测）：较新 Xcode 工具链（大约 2023 年后）默认给 Mach-O 二进制生成"chained fixups"格式，这种格式**需要 macOS 12+ 的 dyld 才能加载**；Node 24 官方二进制大概率是用这种新工具链编译的，装在 Big Sur (11.x) 上 dyld 直接加载不了，进程起不来，跟证书、公证完全无关。

### 修复：macOS 单独钉一个更老的 Node LTS

只改 macOS（`darwin-arm64` / `darwin-x64`），Windows/Linux 不受影响仍用 24.11.0：

- [`managed.rs`](../../../1oneCore/crates/aionui-runtime/src/node_runtime/managed.rs)：`PlatformSpec` 新增 `node_version` 字段（原来是全平台共享一个 `MANAGED_NODE_VERSION` 常量），macOS 两个分支改用新增的 `MACOS_MANAGED_NODE_VERSION = "22.11.0"`。
- 同步改了 3 处测试夹具（`managed/tests.rs`）里硬编码的 `24.11.0`/`node-v24.11.0-darwin-arm64` 为对应新值，跑过 `cargo test -p aionui-runtime` + `cargo clippy` 确认无回归（2 个跟改动无关的既有失败——unix shebang 脚本在 Windows 开发机原生跑测试必然失败——已在提交前确认与本次 diff 无关）。
- 提交：`1oneCore` commit `1797fcf7`。

**✅ 真机已确认**：用户在同一台 Big Sur M1 机器上装了含修复的新包，"托管 Node 运行环境无法启动"报错消失，确认就是这个根因。

**风险评估（已确认，不阻塞）**：Node 22.11.0 是当时仍在 LTS 维护期内的版本，向后兼容新 macOS（老版本二进制在新系统上天然能跑），代码里没有任何地方写死"必须 Node ≥24"（`validate_runtime` 的 `min_node_major` 参数唯一调用点传的是 `None`），所以这个降级对新 Mac 用户没有负面影响。

---

## 4. 正式版本切号

- `1oneCore`：`Cargo.toml` workspace 版本 `0.1.48-one.1` → `0.1.49-one.1`（含上面的 Node 兼容修复），commit `6054185e`，打 tag `v0.1.49-one.1` 推送，触发 `release.yml` 全平台构建，**6 个资产齐全**（这个 fork 本身就砍掉了 Windows arm64，5 个平台二进制 + 1 个 checksums.txt 是完整态，不是 7 个）。
- `1oneUI`：`package.json` 的 `version` 字段当天已被另一路改动（品牌重命名为「One Work」那次提交 `8598e0777`）先行 bump 到 `2.1.48`；本轮只需把 `aioncoreVersion` 从 `v0.1.48-one.1` 改成 `v0.1.49-one.1`（commit `848e98147`），随后打 tag `v2.1.48` 推送。

---

## 5. 发现「打 tag 自动发布」这条流水线从未真正跑过（未解决）

推完 `v2.1.48` tag 后发现 `Build and Release`（`.github/workflows/build-and-release.yml`，`on: push: tags: '*'`）**完全没有被触发**。查 `gh api repos/gaogg521/1oneUI/actions/workflows/307311011/runs` 返回 `total_count: 0`——**这个 workflow 在这个 fork 的历史上一次都没有真正跑过**，不是本轮改坏的。Actions 权限、default branch（确认是 `one-main`）、tag ref 本身（`git rev-parse` 核对过指向正确 commit）都正常，具体卡在哪个 GitHub 层面的设置暂未查出。推测过去的"正式 Release"（如 `v2.1.43`）应该都是走 Manual Build 手动跑完再手动 `gh release create` 拼出来的，不是这条自动流水线。

用户已认领"自己去查为什么 tag 触发不了"，本轮未继续深入。**下一轮如果这个问题还没查出来，需要人工介入 GitHub 仓库设置，或者接受"发布只能靠手动拼装"这条路径**（Manual Build 产物里 electron-builder 会自动生成正确的 `latest-mac.yml`/`latest-arm64-mac.yml`，理论上可以手动 `gh release create` 拼出一个能被 `release-distribute.yml` 消费的 Release，只是需要一个平台一个平台手动来，本轮验证过这条路径可行但未真正执行）。

> **更新**：这条"手动拼装 Release"路径本轮被另一路 Windows 打包工作执行过一次——`v2.1.48` **现在有一个真实 Release**（`gh release create` 建的，跳过了这条从未触发的 tag 流水线），不再是"只有 tag"。但那是 Windows 资产，**Mac 资产还没加进去**。发布链路当前的完整状态（会随时间变化，别当死状态记）见 §8。

---

## 6. 排障纠错：一次构建卡了近 6 小时，原因不是苹果公证排队

`x64` 的一次 Manual Build（run `29799307341`）卡在"Build with electron-builder (macOS)"步骤超过 4.5 小时不结束。**当时的第一直觉猜测是"Apple 公证服务器对同一个 Apple ID 的并发提交限流排队"，这个猜测是错的**，用户追问后重新查证：取消后重新拉取该 run 的完整日志，`codesign` 那一步本身在 `03:50:14` 开始后就再没有任何输出，直到 `09:44:37` 收到取消信号，日志里明确写着 `Terminate orphan process: pid (13257) (codesign)`——**是本地 `codesign` 命令自己挂死了近 6 小时，跟苹果服务器排队完全没关系**。这是 macOS CI 上一个已知的偶发坑：`codesign` 默认会做在线证书吊销检查（OCSP），如果那次网络请求卡住不返回，`codesign` 没有内部超时会死等。跟我们的签名配置无关，是偶发性 flaky 失败，复现概率不明，未做进一步加固（比如给 build 步骤包一层超时+自动重试）。

**教训**：对不确定的故障原因，第一直觉的解释要在有真实日志证据之前说清楚是"猜测"，被追问时要老实去查证并纠正，不能把猜测当结论汇报。

---

## 7. 「下载最新版」按钮改指向自家宣传站

[`InstallationIntegrityDialog.tsx`](../../packages/desktop/src/renderer/components/layout/InstallationIntegrityDialog.tsx) 硬编码的 `AIONUI_DOWNLOAD_URL` 之前是 `https://www.aionui.com/`（上游官网），用户点了会拿到上游安装包而不是这个 fork 自己的版本。改成 `https://work.1oneclaw.com/`（"1ONE Work" 宣传站，与上游那个常量的角色对应：宣传/下载入口页，不是文件存储桶本身）。commit `1426ea3e6`。

---

## 8. 热更新链路现状

- `electron-updater` 的 CDN 地址（[`updateFeed.ts:16`](../../packages/desktop/src/process/services/updateFeed.ts)）**早就正确指向自建腾讯云 COS**（`1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases`），不是上游——这是 07-16 那轮就改好的，本轮只是重新核实确认没有被改回去。
- 但当天检查发现桶里 `releases/latest-mac.yml` 等清单文件根本不存在（`curl` 返回 `NoSuchKey`）——**地址配对了，桶是空的，从未真正发布过 Mac 版本**。用户之前手动把几个 `.dmg` 拖进了桶**根目录**（不在 `releases/` 路径下，也没有版本子目录），这些文件电脑端更新器**永远发现不了**：`electron-updater` 走的是固定路径的 YAML 清单机制，不是扫描目录比版本号大小。
- 打通"真正发布"需要 `COS_SECRET_ID`/`COS_SECRET_KEY` 两个仓库 secret（Tencent Cloud API 密钥），本轮已由用户自己在 GitHub 网页添加（Claude 不经手真实密钥）。
- `release-distribute.yml` 本轮由用户（并行的另一个会话/工具）自己修了 4 个提交（`c56ae0254` → `9cd32e867`）：把"必须 6 个平台 yml 齐全"的硬性校验放宽成"只校验实际存在的 latest\*.yml"，外加修了几个腾讯 COS 的 S3 兼容坑（virtual-hosted 寻址、分片上传 `MissingContentLength`、失败重传的 `force` 选项）。**这几个改动意味着即使只有 Mac 资产也能走通发布流程了**。

> **发布链路状态的唯一权威记录在 [`session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md`](session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md) §6**（4 个 CI bug 的完整诊断过程 + 剩余步骤）。**这里不重复维护一份会过期的文字描述**——发布状态是活的，任何人在任一时刻都可能完成手动上传，用下面这条命令实时核实，别信文档里写的某个时间点的快照：
>
> ```bash
> curl https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/latest.yml
> ```
>
> 返回 `NoSuchKey` = 还没传；返回 yml 内容 = 已发布。

---

## 9. 遗留 / 下一轮接手清单

1. ~~Big Sur M1 那台机器确认 Node 22.11.0 降级修复是否解决"托管 Node 运行环境无法启动"~~ ✅ 已由用户真机确认解决。
2. `Build and Release` 打 tag 自动发布流水线为什么从未触发，用户在查，查不出来就走 Manual Build 手动拼装 Release 这条备选路径（本轮评估过可行，且已用这条路径手动建出 `v2.1.48` Release，见下）。
3. ~~目前没有任何 `1oneUI` 的正式 GitHub Release~~ **✅ 已过期，纠正见 §5/§8**。发布链路完整状态 + 待办以 [`session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md`](session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md) §6 为准，别在这份文档里另记一份——实时验证发没发布用 §8 那条 `curl` 命令。
4. **Mac 资产尚未加入 `v2.1.48` Release**：这次 Release 目前只有 Windows。本轮 Manual Build 产出的 Mac 产物（dmg + `latest-mac.yml`/`latest-arm64-mac.yml`）需要用 `gh release upload v2.1.48 <文件...>` 追加进同一个 Release，再重新走一遍 `release-distribute.yml`（或手动传 COS）才能让 Mac 用户吃到热更新。
5. 存储桶根目录那几个用户手动上传的 `.dmg`（`1ONE-Code-2.1.47-*`）是废弹，不参与热更新，可以考虑清理或忽略。
6. Windows/Linux 平台的正式构建在本轮完全没有测试过（这轮只关注 Mac；Windows 打包见 [`session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md`](session-2026-07-21-brand-rename-and-release-fixes.zh-CN.md) 那一路的工作，Linux 完全没碰）。
7. `1oneCore` 的 `IDENTITY` 假阳性坑（§1）如果要加固，可以考虑在 CI 里加一道显式的 `codesign --verify` 校验，别再靠 DMG-exists 这种弱信号判定"打包成功"。

---

## 10. 三仓最终 commit

| 仓         | 分支       | 关键 commit                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1oneCore` | `one-main` | `1797fcf7`（macOS Node 降级）/ `6054185e`（版本 bump）/ tag `v0.1.49-one.1`                                                                                                                                                                                                                                                                                      |
| `1oneUI`   | `one-main` | `3d5e555ff`（bundle ID）/ `848e98147`（aioncoreVersion 钉版）/ `1426ea3e6`（下载链接）/ `c56ae0254`→`9cd32e867`（`release-distribute.yml` 4 处 CI 修复，见 §8）/ `f788dd6ee`（品牌改名 One Work，另一路工作，见交叉引用文档）/ tag `v2.1.48`（打 tag 的自动构建流水线未触发，见 §5；但已用 `gh release create` 手动建出真实 Release，带 Windows 资产，见 §5/§9） |
