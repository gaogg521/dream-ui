# Mac 打包前必读（Pre-flight）

> **每次打 Mac 包之前先读这一页，并把 §1 的四条跑完。**
> 不跑就触发，历史命中率是 3 次里 3 次失败。

---

## 0. 为什么 Mac 打包"总是出问题"

不是 Mac 不稳定，是**它是这个仓库唯一带质量门禁的路径**。

|                 | Windows                                          | Mac                                                                 |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| 怎么打          | 本地 `scripts/package-win.ps1`                   | 只能走 GitHub Actions（没有 Mac 机器）                              |
| aioncore 从哪来 | `AIONUI_BACKEND_LOCAL_PATH` 指向本地刚编的二进制 | 按 `package.json` 的 `aioncoreVersion` 从 1oneCore Release **下载** |
| 跑不跑门禁      | **完全不跑**                                     | 跑 `Code Quality`：lint + format:check + tsc + **全量测试**         |

于是：**日常开发从不触发门禁 → 主干上悄悄积累格式漂移与红测试 → 打 Mac 包时一次性全爆**。
失败会显示成 `build-pipeline / Code Quality`，读起来像 Mac 构建炸了，其实是这个仓库
第一次被真正检查。

三个放大因素：

1. **本地 `bun run lint` 不含格式检查**（oxlint 只管 lint，格式在 `format:check`/oxfmt），
   所以格式漂移本地 100% 发现不了。
2. **本地跑出的红测试很容易被当成"既有失败、按 ratchet 规则不用管"**——开发时这个判断是对的，
   **但它们是门禁的一部分，不修就永远出不了 Mac 包**。这条最容易反复踩。
3. **失败日志 95% 是 git 凭据清理噪音**，真因埋在 `Process completed with exit code` 前几行。

---

## 1. 触发前必须跑完的四条（缺一不可）

```bash
bun run lint            # 0 errors（warnings 不算失败）
bun run format:check    # 必须 "All matched files use the correct format."
bunx tsc --noEmit       # exit 0
bun run test            # 必须 0 failed 且 0 errors —— 两个都要看，见下
```

**⚠️ `bun run test` 的判据不是 "0 failed"，是 "0 failed 且 0 errors"。** vitest 的汇总长这样：

```
 Test Files  423 passed | 1 skipped (424)
      Tests  3537 passed | 6 skipped (3543)
     Errors  2 errors          ← 只看上面两行会以为全绿
```

`Errors` 是**未捕获的 promise rejection**，vitest 对它同样返回非 0，门禁照样挂。它的典型
成因是 mock 少了一个**只在异步路径上被调用**的方法（例如 `configService.whenReady`）：
rejection 发生在该测试文件跑完之后，所以**没有任何一条用例变红**，只体现在 `Errors` 行。
2026-08-14 第五次 Mac 失败正是它，而我在本地把同一份输出读成了"全绿"。

定位归属：日志里搜 `This error originated in "<file>"`——它给的是**错误抛出时正在跑的文件**，
未必是根因文件，但通常就是它。

**⚠️ 顺序很重要：这四条必须是推送前的最后动作。**`format:check` 只反映"跑它那一刻"的
状态——先跑检查、再改文件（哪怕只是补一个 `.md`），检查结果就作废了。
2026-08-14 第四次 Mac 失败就是这么来的：跑完四条之后我又新建了这份文档本身，于是
`format:check` 因为**这份教你避免该问题的文档没格式化**而挂掉。
稳妥做法是推送前直接 `bun run format`（写，不是 check），再跑其余三条。

**关于"既有失败"**：门禁不区分是谁引入的。本地看到红的就得处理完，否则触发多少次
失败多少次。两种常见成因（都不是产品代码的问题）：

- **手写 `vi.mock` 少了 namespace/导出**。组件新用了一个 `ipcBridge.xxx.yyy` 或模块新加了
  一个导出，而测试里手写的 mock 工厂没跟上 → 组件调 `undefined.invoke` 抛异常 →
  **报错显示成"找不到元素"，极具迷惑性**。
  修法：补上缺的项；更稳的是改成**部分 mock**，spread 真实模块：
  ```ts
  vi.mock('@/x', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/x')>()),
    someFn: () => stub,
  }));
  ```
- **测试写死 Unix 假设**（路径分隔符、`Instant` 运算、只在 Unix 存在的 API）。

---

## 2. 改过后端就必须先发 1oneCore Release

Windows 用本地二进制，**Mac 用 Release 下载**。不发新 Release，Mac 包里就是**上一个
Release 的旧后端**，而 Windows 包是新的——同版本号两平台跑不同后端，且零报错。

```bash
# 1oneCore
# Cargo.toml bump version → cargo update -w → commit push
git tag vX.Y.Z-one.N && git push origin vX.Y.Z-one.N   # 触发 release.yml，约 25 分钟
gh release view vX.Y.Z-one.N --repo gaogg521/1oneCore --json assets -q '.assets[].name'
# 确认 6 平台产物齐全（含两个 apple-darwin）后
# 再改 1oneUI package.json 的 aioncoreVersion 指向新 tag
```

只改前端时跳过这一节。

---

## 3. 触发

```bash
gh workflow run build-manual.yml --repo gaogg521/1oneUI \
  -f branch=one-main -f platform=macos-arm64 -f installers_only=false
gh workflow run build-manual.yml --repo gaogg521/1oneUI \
  -f branch=one-main -f platform=macos-x64 -f installers_only=false
```

版本号不需要单独设置——CI 从仓库的 `package.json` 读，与 Windows 天然一致。

**⚠️ `-f installers_only=false` 不能省——省了就打出一个收不到自动更新的包。**
`_build-reusable.yml` 的清理步在 `upload_installers_only` 为真时执行
`rm -f out/*.zip out/*.yml`，而 macOS 的 electron-updater **下载的是 `.zip`**
（`latest-mac.yml` 指向它，不是 `.dmg`）。于是产出的 artifact 里只有一个 dmg，
装上去的用户永远收不到更新提示，**而构建本身报绿**。

这个默认值原本写死在 `build-manual.yml` 里改不了（2026-08-16 修为可配）。它之所以
危险，是因为本 fork 的 mac 发布资产**恰恰就是走手动构建产出的**——这个"只传安装器"
的默认值是为冒烟构建设计的，却直接作用在真实发布上。

**验收判据不是"构建成功"，是 artifact 里有没有这三个文件**：

```bash
gh run download <run-id> --repo gaogg521/1oneUI -n <artifact-name> -D <dir>
# 必须同时看到：*.dmg、*-mac-*.zip、latest-mac.yml
```

2026-08-16 我在这里连判错两次：先归因于上传 glob 的品牌残留（那确实是**另一处**
独立的坏点，但只影响 tag 触发的 `build-and-release.yml`），改完重跑，artifact 里
**还是只有 dmg**，才翻到上一步找到真正在删文件的那行。**教训：产物少了东西，
先看有没有谁把它删了，再怀疑收集它的通配符。**

**成功耗时约 13 分钟**。判断信号：

| 挂在第几秒/分     | 说明                                           |
| ----------------- | ---------------------------------------------- |
| ~25–46 秒         | `format:check` 或 `lint`（实测两个数都出现过） |
| ~5 分钟           | 全量测试                                       |
| 越过 1 分钟还在跑 | 格式/lint 过了                                 |
| 越过 5 分钟还在跑 | 门禁全过，在真正打包                           |

---

## 4. 失败时怎么快速定位

```bash
MSYS_NO_PATHCONV=1 gh run view <run-id> --repo gaogg521/1oneUI --log-failed 2>&1 \
  | grep -B 6 "Process completed with exit code" \
  | grep -viE "extraheader|includeIf|credentials|git config|safe.directory"
```

拿失败的测试文件名：

```bash
MSYS_NO_PATHCONV=1 gh run view <run-id> --repo gaogg521/1oneUI --log-failed 2>&1 \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -oE "FAIL[^|]*tests/[a-zA-Z0-9_/.-]+\.test\.[jt]sx?" | sort -u
```

⚠️ `MSYS_NO_PATHCONV=1` 不能省（Git Bash 会把 `/repos/...` 改写成 Windows 路径）。

---

## 5. 已知会伪装成"Mac 构建失败"的东西

| 现象                                               | 真因                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| 46 秒挂，日志一堆 git 凭据                         | `format:check` 有文件没格式化                          |
| 5 分钟挂，测试报"找不到元素"                       | 手写 `vi.mock` 少了 namespace，组件抛异常没渲染        |
| 5 分钟挂，`No "xxx" export is defined on the mock` | 同上，改成部分 mock                                    |
| 包出来了但功能是旧的                               | `aioncoreVersion` 没指向新 Release（见 §2）            |
| 构建报绿，但用户装上收不到自动更新                 | 忘了 `-f installers_only=false`，zip/yml 被删（见 §3） |

---

## 相关

- [`packaging-release-playbook.zh-CN.md`](packaging-release-playbook.zh-CN.md) — 完整发布链路
- [`session-2026-07-15-mac-packaging-github-actions.zh-CN.md`](session-2026-07-15-mac-packaging-github-actions.zh-CN.md) — Mac CI 最初打通的过程
