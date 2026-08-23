# 2026-07-15：Mac 打包（GitHub Actions，无本地 Mac 机器）已跑通并真机验证

## 背景

用户本地没有 Mac 机器，需要出 macOS 安装包。结论：**完全可以在 GitHub Actions 上打，不需要买 Mac**，且已经过真机测试确认可用。

## 现成基础设施（不用新建）

1oneUI 仓库（`gaogg521/1oneUI`，**public**，macOS runner 分钟数免费不限额）已经内置：

- [`.github/workflows/build-manual.yml`](../../.github/workflows/build-manual.yml) — `workflow_dispatch` 手动触发，可单独选 `macos-arm64` / `macos-x64` / `all`
- [`.github/workflows/build-and-release.yml`](../../.github/workflows/build-and-release.yml) — push `dev` 分支或打正式 tag 自动触发全平台构建 + 发 GitHub Release
- 底层命令：`node scripts/build-with-builder.js --mac --arm64`，跑在 `macos-14` runner（真实 macOS 系统）

手动触发示例：

```bash
gh workflow run build-manual.yml --repo gaogg521/1oneUI \
  -f branch=one-main -f platform=macos-arm64 -f skip_code_quality=true
```

下载产物：

```bash
gh run download <run_id> --repo gaogg521/1oneUI -n macos-build-arm64-<hash> -D out/mac-arm64-download
```

## 踩的两个坑

### 坑 1：Prettier 格式检查拦住，跟 Mac 打包无关

第一次触发直接失败在 `Code Quality` job 的 `Check Prettier formatting` 步骤——这是代码库本身存量的格式问题，跟平台无关，且会挡住后面所有平台的构建（包括 mac）。

**解法**：只想验证打包本身能不能跑通时，加 `-f skip_code_quality=true` 跳过前置质检，直奔构建步骤。格式债本身是独立问题，不要混在打包排查里一起修。

### 坑 2（真坑）：1oneCore 后端版本号在代码里改了，但从没发过对应 Release

第二次绕开质检后，client 端（1oneUI）所有平台专属步骤全部通过（Node/依赖/native module 重编译/签名证书探测），最终卡在 **`Prepare aioncore binary`** 步骤：

```
Preparing aioncore for darwin-arm64 (version: v0.1.45-one.1)
Downloading aioncore from https://github.com/gaogg521/1oneCore/releases/download/v0.1.45-one.1/aioncore-v0.1.45-one.1-aarch64-apple-darwin.tar.gz
Download failed: 404
```

**根因**：`1oneUI/package.json` 固定引用后端 `1oneCore` 的某个版本号（对应 `1oneCore/Cargo.toml` 的 `version` 字段，当时是 `0.1.45-one.1`），但 `1oneCore` 仓库**只是代码里改了版本号，从没打 tag、没跑过它自己的 release 流水线**——GitHub 上最新 Release 还停在 `v0.1.42-one.1`。这跟 macOS/GitHub Actions 本身毫无关系，任何平台（Windows/Linux 同理）打包到这一步都会 404。

**关键发现**：`1oneCore/.github/workflows/release.yml` 本来就配置了完整的跨平台矩阵（`macos-latest` + `aarch64-apple-darwin` / `x86_64-apple-darwin`，外加两个 Linux target 和 Windows），只是从来没有为 `v0.1.45-one.1` 这个版本触发过。

**修法**：

```bash
cd 1oneCore
git fetch origin
git tag v0.1.45-one.1 origin/one-main   # 确认 origin/one-main 的 Cargo.toml version 跟 tag 一致后再打
git push origin v0.1.45-one.1           # push tag 自动触发 release.yml（on: push: tags: v*）
```

等 1oneCore 的 release 跑完（五个平台，上次耗时约 18 分钟），回 1oneUI 重新触发打包即可成功。

**通用排查方法**：以后 1oneUI **任何平台**打包卡在 `Prepare aioncore binary`，第一步先查 1oneCore 对应版本号是否真的发过 Release：

```bash
gh release view v<X.Y.Z>-one.<N> --repo gaogg521/1oneCore
```

不存在就照上面打 tag 推送，不要去改 1oneUI 这边的版本锁定逻辑。

## 签名现状（未配置）

`_build-reusable.yml` 里签名/公证的代码逻辑（codesign + notarize）都已经写好，但这个 fork 目前 **一个 secret 都没配**（`BUILD_CERTIFICATE_BASE64` / `P12_PASSWORD` / `APPLE_ID` / `APPLE_ID_PASSWORD` / `IDENTITY` 全空），工作流对此有兜底——没证书就自动降级打 **unsigned** 包，能正常构建，只是用户首次打开会被 Gatekeeper 拦。

要走正式签名分发，需要 Apple Developer Program 账号（$99/年），把证书 + Apple ID app-specific password 配进 GitHub repo secrets 即可，代码不用改。

## 坑 3（比坑 2 更隐蔽）：1oneCore 私有仓库导致打包时好时坏，跟 tag 是否存在无关

补发了 `v0.1.45-one.1` release 之后，第一次重新触发 1oneUI mac 打包**成功了**，让人误以为问题已经解决。第二次同样的操作（没改任何代码）却又在同一个 `Prepare aioncore binary` 步骤 404 失败。

**根因**：`1oneCore` 是**私有仓库**。`packages/shared-scripts/src/prepare-aioncore.js` 里固定版本下载路径打的是匿名 `releases/download/...` 链接（`downloadFile()`），这个链接对私有仓库的正常访问权限校验是必挂的——404，不管有没有带 token 都一样（实测：browser_download_url + Bearer token 依然 404；只有官方 Releases Assets API `https://api.github.com/repos/.../releases/assets/{id}` + `Accept: application/octet-stream` 头才 200）。

**为什么第一次能成功**：大概率是 GitHub 刚发布 release 资产后有个短暂的 CDN 边缘缓存窗口，任何请求（不分权限）直接命中缓存拿到文件；窗口一过，就必须走正常的仓库权限校验，私有仓库匿名请求必 404。**这个"成功"具有欺骗性，不能当作问题已解决的信号。**

**排查弯路**：一开始以为是"用错了下载方式"，改了 `prepare-aioncore.js` 让它走认证的 Assets API（[packages/shared-scripts/src/prepare-aioncore.js](../../packages/shared-scripts/src/prepare-aioncore.js) 新增 `downloadReleaseAsset()`，commit `282cd8d1d`）。这个改动本身是对的、也保留了（面向未来更规范），但**光改这个不够**——CI 里的 `GH_TOKEN` 实际解析成默认的 `GITHUB_TOKEN`（`gh secret list --repo gaogg521/1oneUI` 是空的，没有配任何跨仓库 PAT），而默认 `GITHUB_TOKEN` 天生只能访问当前仓库（1oneUI），对另一个私有仓库（1oneCore）**认证请求本身也是 404**（`repos/gaogg521/1oneCore/releases/tags/v0.1.45-one.1` 这个 API 都读不到）。

**真正根治**：把 `1oneCore` 仓库可见性从 private 改成 public（用户在 GitHub 网页 Settings → Danger Zone 手动操作，AI 不代为执行仓库权限变更）。改完后不需要任何 token，匿名下载路径永久稳定，跟 1oneUI 本来就是 public 的情况完全对齐。

**用户确认**：`1oneCore` 之前本来就是 public，是用户此前主动改成了 private（大概率出于代码保密考虑），这正是"时好时坏"现象最近才出现的原因——改私有之前打包链路一直是稳的。**⚠️ 如果以后出于保密需要重新把 1oneCore 设回私有**，不能简单切换了事，必须同时给 `1oneUI` 配一个跨仓库 PAT（classic token，`repo` scope）作为 `GH_TOKEN` secret，CI 才有权限跨仓读取——代码侧的认证下载逻辑（`downloadReleaseAsset()`，见上）已经写好了，届时只需补 secret，不用再改代码。

**How to apply**：以后如果 1oneUI/1oneCore 任一仓库又要设回私有，或者新增第三个 fork 仓库参与打包，**必须同时保证打包链路上所有被下载的资产所在仓库都是 public**，否则 CI 打包会呈现"随机时好时坏"的诡异表现（不是每次都失败，容易被误判为网络抖动）。判断方法：`gh api repos/<owner>/<repo> --jq '{private,visibility}'`。

## Mac 用户安装说明（已补进 readme）

[`readme.md`](../../readme.md) 下载安装区块原来只有一行"macOS `.dmg`"，没写 Gatekeeper 拦截怎么办（现在是 unsigned 包，100% 会被拦）。已经补上：拖到 Applications → 右键"打开" → 如果报"已损坏"用 `xattr -cr "/Applications/1ONE Code.app"` 兜底。

**⚠️ 如果以后配了 Apple 签名/公证 secrets**：这段 Gatekeeper 说明要跟着删掉/改写，不然会误导已经能正常双击打开的用户。

## 验证记录

- 2026-07-15 触发 [1oneUI build-manual.yml run 29395429217](https://github.com/gaogg521/1oneUI/actions/runs/29395429217) 成功，产出 `macos-build-arm64-9ccd680`（478MB unsigned `.dmg`）
- 前置补发 [1oneCore v0.1.45-one.1 release](https://github.com/gaogg521/1oneCore/releases/tag/v0.1.45-one.1)（此前只到 v0.1.42-one.1，0.1.43/44/45 之间的提交此前从未发布过）
- 产物已下载到本地 `1oneUI/out/mac-arm64-download/1ONE-Code-2.1.44-mac-arm64.dmg`
- **用户已在真实 Mac 机器上测试，确认可以正常安装运行**
- 2026-07-15 追加：`1oneCore` 改为 public 前，[run 29403809402](https://github.com/gaogg521/1oneUI/actions/runs/29403809402) 复现了 404（证明第一次成功是运气，不是真的修好了）；改为 public 后 [run 29406059168](https://github.com/gaogg521/1oneUI/actions/runs/29406059168) 成功，产出 `macos-build-arm64-282cd8d`，且不再依赖任何 token，稳定可复现
- 2026-07-15 再追加：用户按上文指引生成 classic PAT，配进 `1oneUI` 和 `1oneCore` 两边的 `GH_TOKEN` repo secret（中途一次误把 Name 填成 `CLAUD`，删除重建后确认为 `GH_TOKEN`），随后把**两个仓库都改回了 private**。[run 29411771151](https://github.com/gaogg521/1oneUI/actions/runs/29411771151) 在两仓私有状态下成功，日志明确显示 `Downloading aioncore from gaogg521/1oneCore release asset 477620208 (authenticated)`——证明这次是真的走认证 API 拿到权限成功，不是 CDN 缓存窗口的运气。**至此结论：`GH_TOKEN` + `downloadReleaseAsset()` 认证下载方案在纯私有双仓场景下验证通过，可以放心私有化。**
- ⚠️ 用户后续把 `1oneUI` 本身也改成了 private（此前只有 1oneCore 私有），这会导致 macOS runner Actions 分钟数不再免费不限额——私有仓库走账号的月度配额（Free 2000 分钟/月，macOS runner 按 10 倍计费），已提醒用户去 `https://github.com/settings/billing` 自查额度
