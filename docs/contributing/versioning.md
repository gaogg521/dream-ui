# 版本号规范

> 本文是 One Work 版本号的**权威说明**。发版流程（怎么打包、怎么发 Release、怎么传 COS）
> 见 [`../guides/packaging-release-playbook.zh-CN.md`](../guides/packaging-release-playbook.zh-CN.md)；
> 这里只回答"版本号该写几、写在哪"。

## 2.2.0 = 新架构起点

**`2.2.0` 是 dream 三仓新架构的第一个版本。** 从这个版本起：

- 代码来自 `dream-ui` / `dream-core` / `dream-engine` 三个独立仓库（外加云端的
  `dream-trial-broker`），不再是 `1oneUI` / `1oneCore` / `aionrs-local` 那套旧仓库，
  也不再跟随开源上游 [AionUi](https://github.com/iOfficeAI/AionUi)。背景见
  [`../../CLAUDE.md`](../../CLAUDE.md) 的"三仓架构"与
  [`../guides/repository-independence.zh-CN.md`](../guides/repository-independence.zh-CN.md)。
- `2.1.x` 及更早的版本属于旧仓库时期。它们的 CHANGELOG 条目里还留着指向
  `iOfficeAI/AionUi` 的 compare 链接，那是历史事实，**不要回头改写**。

选 `2.2.0` 而不是继续 `2.1.62`，是因为仓库身份和构建来源整体换了一次——这对使用者不可见，
但对任何要定位问题、对齐版本、找源码的人是分水岭。次版本号跳一格是最便宜的标记方式。

## 号段含义

采用 `MAJOR.MINOR.PATCH`，但按**产品可感知度**而不是严格 semver 的 API 兼容性来切：

| 位    | 什么时候进位                                         | 例子               |
| ----- | ---------------------------------------------------- | ------------------ |
| MAJOR | 产品形态或数据格式发生不可回退的变化，老版本装不回去 | 暂无               |
| MINOR | 新增用户能看见的功能面，或底层架构/仓库身份换代      | `2.2.0` 三仓新架构 |
| PATCH | 修 bug、补翻译、小改进，用户不需要重新理解产品       | `2.1.61`           |

桌面端有自动更新且**拦截降级安装**，所以版本号只能单调递增——发出去的号不能撤回重用。

## 一次发版要同步改的地方

| 位置                                | 内容                           | 备注                                                                             |
| ----------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `package.json` → `version`          | `2.2.0`                        | 安装包文件名、`app.getVersion()`、自动更新比对全看它                             |
| `package.json` → `aioncoreVersion`  | 指向 dream-core 的 Release tag | **该 tag 必须真实存在**，否则 Mac CI 在下载 aioncore 时 404                      |
| `CHANGELOG.md`                      | 新增一节                       | 面向开发者，按 commit 类型分组                                                   |
| `docs/release-notes/<version>.json` | 新增一份                       | 面向用户，扁平数组、纯文本；桌面端更新面板 / GitHub Release / 官网三处共用这一份 |

`docs/release-notes/<version>.json` 的字段格式见
[`../release-notes/README.md`](../release-notes/README.md)——那里说明了为什么是扁平数组、
为什么不能写 Markdown 语法。

## 不参与版本号的三个值（**别动**）

这几个是运行时身份，改了会让老用户的 `%APPDATA%` 数据失联：

- `appId: com.huanle.oneone.ai`
- `executableName: 1onecode`
- `PROD_USERDATA_APP_NAME: 1ONE Code`

理由与完整清单见 [`../../CLAUDE.md`](../../CLAUDE.md) 的"品牌与技术身份分层"一节。
