# Mac 包"已损坏" + 历史品牌名 `1onecode` / `1ONE Code` 收尾

> 2026-08-31。用户装 3.0.0 的 Mac 包，报两个问题：DMG / `.app` / Gatekeeper 弹窗全是
> `1onecode` 不是 `One Work`；而且双击弹"已损坏，无法打开"。两个问题独立，都查到了根因。

---

## 一、"已损坏" —— `IDENTITY` secret 带了前缀，签名失败后兜底发了未签名包

### 现象

- `"1onecode"已损坏，无法打开。你应该将它移到废纸篓。`（Chrome 下载 → 带 `com.apple.quarantine`）
- CI（`build-manual.yml`）报绿，Release 也发了。

### 根因链

1. `gaogg521/dream-ui` 的 GitHub Secret **`IDENTITY` 填了证书完整 CN**：
   `Developer ID Application: Huanle Entertainment (Shanghai)Technology Co., Ltd. (HKT9687899)`
   （`MAC/P12-PASSWORD.txt` 里当初配置记录就是带前缀的）。
2. `_build-reusable.yml` 把它同时喂给 `CSC_NAME` / `identity`。electron-builder 26.x 见到
   `Developer ID Application:` 前缀直接报错并**中止签名**：
   ```
   ⨯ Please remove prefix "Developer ID Application:" from the specified name — appropriate certificate will be chosen automatically
      Retrying macOS distributable creation with --prepackaged...
   ```
   （CI run `33317519565` arm64 / `33317523734` x64 日志逐字如此。）
3. `build-with-builder.js` 的 `buildWithDmgRetry` 见"`.app` 有了、`.dmg` 没有"就无条件用
   `--prepackaged` 兜底 —— 这条路**完全不签名**，只把已有的 `.app`（`afterSign.js` 里
   `codesign --force --deep --sign -` 打的 ad-hoc 签名）塞进 DMG。
4. CI 的 macOS build step 只要"DMG 存在"且日志含 `notariz|staple` 就 `exit 0` 当 warning。
   → **未签名 / ad-hoc 的 DMG 一路绿灯发出去**。
5. 用户下载带 quarantine + `hardenedRuntime: true` + 非 Developer-ID 签名 → macOS 判"已损坏"。

对照：`1oneUI` 的 `IDENTITY` secret 是**纯公司名**（不带前缀），所以那边一直签得好。这是
playbook §1.4 早就写死的一条，配 dream-ui secret 时没照做。

证书 CN（从 `MAC/oneone_dist.p12`，密码 `123456` 读出）：

```
subject= UID=HKT9687899, CN=Developer ID Application: Huanle Entertainment (Shanghai)Technology Co., Ltd. (HKT9687899), OU=HKT9687899, O=Huanle Entertainment (Shanghai)Technology Co., Ltd., C=US
```

electron-builder 要的是去掉 `Developer ID Application: ` 的部分：

```
Huanle Entertainment (Shanghai)Technology Co., Ltd. (HKT9687899)
```

### 修复

**代码（本次 PR）：**

- `scripts/build-with-builder.js`
  - 新增 `normalizeSigningIdentityEnv()`：跑 electron-builder 前自动剥掉 `CSC_NAME` /
    `identity` 的 `Developer ID Application:` / `Developer ID Installer:` 前缀，打一行
    `🔑 Stripped …`。以后 secret 再写错也不连累签名。
  - `buildWithDmgRetry`：兜底前先判断 `macSigningConfigured() && !isAppDeveloperIdSigned(appDir)`
    —— 配了签名但 `.app` 没有 `Authority=Developer ID Application` → 判定签名失败，**直接
    throw**，不再用 `--prepackaged` 兜底发未签名包。
  - `createMacArtifactsWithPrepackaged`：产物再复查一次同条件，不过就 throw。
- `.github/workflows/_build-reusable.yml` "Build with electron-builder (macOS)" step：
  - 日志出现 `remove prefix "Developer ID` / `code signing failed` / `No identity found`
    → `::error` + `exit 1`（原来会当 warning 放行）。
  - "只有公证挂"的 warning 分支收紧：必须日志里**真有** `signing … Developer ID Application`
    成功行，才允许降级 warning。

**Secret（用户在 GitHub 网页改，或授权 `gh secret set`）：**

把 `gaogg521/dream-ui` 的 `IDENTITY` 从
`Developer ID Application: Huanle Entertainment (Shanghai)Technology Co., Ltd. (HKT9687899)`
改成
`Huanle Entertainment (Shanghai)Technology Co., Ltd. (HKT9687899)`

**然后重出包：**

```
gh workflow run build-manual.yml --repo gaogg521/dream-ui --ref <分支> \
  -f branch=<分支> -f platform=macos-arm64 -f installers_only=false
```

（x64 同理）验收：日志有 `Notarization completed successfully`、无 `Retrying … --prepackaged`；
Mac 上 `xcrun stapler validate` / `spctl -a -t install` 通过；双击不再"已损坏"。

### 验证结果（2026-08-31）

`IDENTITY` secret 已用 `gh secret set` 改成去前缀的纯名字。从 `fix/mac-signing-identity-prefix`
（commit `5b85128`）重跑：

| run                                                                                      | 结果       | 关键日志                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [33357644552](https://github.com/gaogg521/dream-ui/actions/runs/33357644552) macos-arm64 | ✅ success | `• signing … identityName=Developer ID Application: *** identityHash=F34F7D42…` → `App … is properly code signed` → `Notarization completed successfully` |
| [33357647221](https://github.com/gaogg521/dream-ui/actions/runs/33357647221) macos-x64   | ✅ success | 同上                                                                                                                                                      |

两条 run 都**没有** `remove prefix` 报错、**没有** `Retrying … --prepackaged`。产物
`macos-build-arm64-5b85128` / `macos-build-x64-5b85128`（含签名+公证的 `.dmg`/`.zip`/`.yml`）。
剩下真机 `stapler validate` / 双击安装由用户在 Mac 上过一遍。

> 注意这两个包的 `.app` 仍是 `1onecode.app`——`.app`/DMG 改名是 PR #3（阶段二）的事。

---

## 二、`1onecode` / `1ONE Code` —— 历史品牌名，3.0.0 起清掉

（阶段二，单独 PR，需双平台真机验收后再发 3.0.x）

### 为什么 `.app` / DMG 是 `1onecode` 不是 `One Work`

`electron-builder.yml` 的 `executableName: 1onecode`。electron-builder 26.x `appInfo.js`：

```js
this.productFilename = executableName != null ? sanitizeFileName(executableName) : this.sanitizedProductName;
```

`productFilename` 决定 `.app` 目录名、DMG 卷标题、Windows `.exe` 名、Windows 默认安装目录。
`productName: One Work` 在这几处不生效。已验证 2.1.61 发布包内部就是 `1onecode.app` +
`Contents/MacOS/1onecode`（`CFBundleName` / `CFBundleDisplayName` 倒是对的，是 `One Work`）。
装完启动后窗口标题 / Dock / 关于页都对，只有装之前的壳（DMG、Finder 图标文字、Gatekeeper
弹窗）是 `1onecode`。

### 数据安全（已核对源码）

- 生产 userData 由 `configureChromium.ts` / `common/platform/index.ts` 的
  `app.setName(PROD_USERDATA_APP_NAME)` + 显式 `app.setPath('userData', …)` 钉死，
  **与 `executableName` 无关** → 改 `executableName` 对数据零风险。
- 全仓无 `safeStorage` / `keytar` → 模型 key 在 SQLite，不在 OS keychain →
  改 `PROD_USERDATA_APP_NAME` 的数据迁移 = 纯目录搬移。
- macOS Squirrel 按 `CFBundleIdentifier`（= `appId`，不变）匹配升级包 → `.app` 改名不断自动更新。

### 决策

| 层  | 值                                    | 决策                                                                                     |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| A   | `executableName: 1onecode`            | 删掉，回落到 `productName` = `One Work`；Linux 加 `linux.executableName: one-work`       |
| B   | `PROD_USERDATA_APP_NAME: '1ONE Code'` | 改 `One Work` + 首启迁移（旧目录存在就 `renameSync` 搬过去，失败就就地用旧目录不丢数据） |
| C   | `appId: com.huanle.oneone.ai`         | **不动** —— 绑死自动更新匹配、Win 卸载注册表 GUID、签名证书 team                         |

### 改动清单（阶段二 PR 落地时补完本节）

- A 层约 10 个文件：`electron-builder.yml`、`packages/desktop/resources/installer.nsh`、
  `resources/windows/installer-observability.nsh`、`resources/windows/support/query-lockers.ps1`、
  `scripts/build-with-builder.js`（进程 kill 列表）、`scripts/packaged-launch.mjs`、
  `scripts/dev-bootstrap.mjs`、`tests/e2e/fixtures.ts`、`packages/desktop/src/sentry.ts`
  （旧名留作历史安装兜底）、`common/platform/index.ts` 注释。
- B 层：`common/platform/index.ts` 加 `migrateAndResolveProdUserDataDir()` +
  `LEGACY_PROD_USERDATA_APP_NAMES`；`configureChromium.ts` + `platform/index.ts` 两个调用点；
  `resources/windows/support/report-installer-failure.ps1` 分析文件路径回退；
  `package.json` `description`。
- 测试：`tests/unit/process/migrateAndResolveProdUserDataDir.test.ts` 新建；
  `tests/unit/common/platformConstants.test.ts` 扩展。
- `CLAUDE.md` "品牌与技术身份分层"表更新（`executableName` 移出"刻意不改"行，
  `PROD_USERDATA_APP_NAME` 行改为"3.0.0 起 = One Work，1ONE Code 仅作首启迁移源"）。
