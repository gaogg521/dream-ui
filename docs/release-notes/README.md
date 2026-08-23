# 发布说明（更新日志）——一份内容，三处展示

同一份发布说明现在喂给三个地方：

| 展示位置                                 | 数据来源                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| 桌面端「发现新版本 → 更新日志」面板      | COS 上 `releases/{version}/release-notes.md`（由 `release-distribute.yml` 上传） |
| GitHub Release 正文                      | 同一份 markdown（`gh release create --notes-file`）                              |
| 官网「更新内容」区 + 独立 `updates.html` | `D:\website\1onework\src\changelog.js` 的 `CHANGELOG` 数组                       |

三处的**权威来源都是同一个** `docs/release-notes/<version>.json`。

## 权威文件格式

```json
{
  "version": "2.1.51",
  "date": "2026-07-27",
  "zh": [{ "t": "标题（简短）", "d": "描述（一到两句完整的话，会直接展示给用户）" }],
  "en": [{ "t": "Title", "d": "Description." }]
}
```

- `zh`/`en` 都是**扁平数组**，不分 feat/fix/perf——面向用户的更新说明不需要暴露提交类型。
- 官网渲染这份 JSON 是**纯文本**（过 `escapeHtml`，不解析 Markdown），别写 `**加粗**`
  之类的语法进去，会原样显示成星号。桌面端/GitHub Release 那份是渲染出来的 Markdown，
  由脚本自动生成，跟这份 JSON 无需保持相同语法。
- **双语必须都填好** JSON 才算"就绪"：`en` 为空数组会被当成"还是草稿"，桌面端/Release
  会退回到从 commit 自动生成的兜底文案，`sync-changelog-to-site.js` 会直接拒绝同步。

## 第一步：起草

```bash
bun run release-notes -- --draft-json docs/release-notes/2.1.51.json
```

从**上一个可达的 `v*` tag 到 HEAD** 的提交里提取（只留 `feat`/`fix`/`perf`，
`docs`/`chore`/`ci`/`style`/`test`/`build`/`refactor` 是发布杂务不进日志），
写出 `zh` 数组草稿（`t` = scope 中文标签，`d` = 提交描述原句），`en` 留空。

> 本 fork 的 tag 是稀疏的（不是每个版本都打）。自动回溯取的是最近一个可达的
> `v*` tag，所以一次更新日志可能横跨好几个版本号——这是想要的行为：它覆盖的是
> 上次正式发布以来真正发出去的全部改动。

## 第二步：人工润色（不可跳过）

提交标题是写给开发者看的（`P1-4`、`方向B Phase1`、`前端`之类），草稿的 `d` 也只是
提交描述原句，两者都不到能发给用户看的水准。打开 `docs/release-notes/<version>.json`：

- 把每条 `t`/`d` 改写成用户能看懂的话（参考已发布的 `changelog.js` 里 v2.1.49/v2.1.50
  的文案调性——完整句子，说清楚"对用户意味着什么"，不是复述提交信息）。
- 填好 `en` 数组（翻译，不是留空）——机器翻译质量兜不住官网首屏，这一步没有捷径。
- 条目数量随意增减、合并、拆分，草稿只是省去从空文件开始的功夫。

## 第三步：桌面端 / GitHub Release

```bash
bun run release-notes --out release-notes.md
gh release create v2.1.51 --title "v2.1.51" --notes-file release-notes.md <安装包...>
```

`generate-release-notes.js`（无 `--draft-json` 时）优先读取已就绪的
`docs/release-notes/<version>.json` 渲染成 Markdown；JSON 不存在或还是草稿（`en` 为空）
时才退回 commit 自动生成。Release 正文有内容时 `release-distribute.yml` 直接用它当
COS sidecar；正文为空时工作流会自己跑一遍这个脚本兜底——保证任何一版都不会没有更新日志。

## 第四步：同步进官网（本机手动，不进 GitHub Actions）

```bash
node scripts/sync-changelog-to-site.js --version 2.1.51
```

把这份 JSON 的 `{version, date, zh, en}` prepend 进
`D:\website\1onework\src\changelog.js` 的 `CHANGELOG` 数组最前面（形状完全一致，
零转换），同时把 `D:\website\1onework\src\site.config.js` 的 `release.version`
改成新版本号（下载链接跟着这个字段拼 COS 路径）。

**为什么这一步不能进 CI**：`D:\website\1onework` 不是 git 仓库、不在 GitHub 上，
部署是本机跑 `npm run build` + `D:\game\scripts\deploy-1onework-www.py`（Python/SSH）。
`release-distribute.yml` 摸不到这台机器的文件系统，所以官网这一段只能是"发布时人工
（或 AI 会话）在本机跑一条命令"，跟既有的"官网改完直接部署，不用问"约定一致。

同一版本重复运行会被拒绝（不会静默覆盖已手改的官网文案）；确认改动后：

```bash
cd D:\website\1onework
npm run build
python D:\game\scripts\deploy-1onework-www.py
```

## 官网侧的两处展示

官网也拆成了两层，避免落地页被无限堆积的历史更新拖长（见 `src/main.js` 的
`LANDING_CHANGELOG_LIMIT`）：

- **落地页 `index.html` `#updates` 区**：只渲染最新 1 个版本，底部有
  「查看全部更新记录 →」链接。
- **独立页 `updates.html`**（`src/updates.js`，仿照已有的 `docs.html`/`docs.js`
  轻量页模式）：渲染完整 `CHANGELOG`，不截断。

两处读的是同一个 `CHANGELOG` 数组，`sync-changelog-to-site.js` 只需要写一次。
