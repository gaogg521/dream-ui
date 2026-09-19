# `docs/` 里 626 个未勾选项的分类（2026-09-18）

> **范围：本文只统计仓库里的历史 PRD / 指南文档。**
> 它**不是**本轮会话的待办清单 —— 那个在
> [`handoff-2026-09-18-enterprise-p0-and-sso-verification.zh-CN.md`](handoff-2026-09-18-enterprise-p0-and-sso-verification.zh-CN.md)。
> 当初提问的人问的其实是后者，这份统计回答的是前者，两件事别混起来看。
>
> 起因：全仓 `- [ ]` 共 **626** 条，分布在 20 个文件。
> 结论先说：**其中 493 条（79%）不是待办**，是已实现功能的验收标准从来没被勾过。
> 但"已实现"这个标签**不能一律采信** —— 抽查就抓到一条标着 `[已实现]` 而后端
> 从来没实现过的（见第 3 节）。

## 1. 分布

按「所属小节标题上的状态标记」统计（脚本把每个勾选框归到它前面最近的标题）：

| 所属小节状态                   |    数量 | 性质                                                                    |
| ------------------------------ | ------: | ----------------------------------------------------------------------- |
| `[已实现]`                     | **493** | 验收标准从未勾选 —— 陈旧噪音，但需抽查标签是否属实                      |
| （无状态标记）                 |      41 | 绝大多数是 `enterprise-team-roadmap` 的 P0/P1/P2 路线图 —— **真实待办** |
| `[部分实现]`                   |      35 | **真实欠账**                                                            |
| `[新增]`                       |      32 | 已设计、未实现（`model-selector` 二级菜单等）                           |
| `[优化]`                       |      10 | 已设计、未实现（`send-drafts` 常驻按钮等）                              |
| `[未实现]`                     |       7 | **真实待办**                                                            |
| `[不变]` / `[保留]` / 标题误判 |       8 | 噪音                                                                    |

按文件（前 6）：

```
82  docs/prds/remote/channels/channels.md
67  docs/prds/conversations/remote/remote-agent.md
66  docs/prds/conversations/custom/custom-agent.md
61  docs/prds/remote/webui/webui.md
59  docs/prds/settings/about/about-update.md
47  docs/prds/conversations/acp/session.md
```

`docs/prds/**` 占 594 条（95%），`docs/guides/**` 只有 28 条。

## 2. 这些框到底是什么

PRD 的写法是：每个功能一个 `## (F-XXX-NN) 标题 [状态]` 小节，正文写用户故事和流程，
末尾一段"**验收标准**"用 `- [ ]` 列条目。

所以：

- **`[已实现]` 下面的框** = 已交付功能的验收清单，没人回头勾。它们**不是待办**，
  但一眼看过去全是空框，导致"文档里全是没做的事"这个错觉。
- **`[未实现]` / `[部分实现]` / `[新增]` / `[优化]` 下面的框** = 真实 backlog。

真实 backlog 合计约 **125 条**（41 + 35 + 32 + 10 + 7）。

## 3. ⚠️ `[已实现]` 不可全信 —— 抽查抓到一条假的

`channels.md` 的 **F-WEBUI-17（WeCom 渠道配置）** 标着 `[已实现]`，写了完整的
用户故事、字段清单、异常分支。实际情况：

- 后端**没有** `PluginType::WeCom` 变体
- 后端**没有** `crates/dream-core-channel/src/plugins/wecom/`
- 后端的内置渠道清单里却有一条 `("wecom", "WeCom")`，于是
  `GET /api/channel/settings/wecom` 每次 `400 Invalid platform: wecom`
- 前端**是诚实的**：渠道列表里企业微信带「即将上线」标记，并没有诱导用户去配

也就是说：PRD 写成了已实现 → 有人照着它在后端补了展示项 → 接口永远 400。
已修（删掉假条目 + `builtin_ids_all_parse_as_a_plugin_type` 断言防漂移），
PRD 状态也已改为 `[未实现]` 并注明原委。

**另一个方向的抽查是好的**：`acp/skills.md` 的 F-SKILL-01「技能注入仅在首条消息时执行」
标 `[已实现]`，对应实现确实在
`dream-core/crates/dream-core-ai-agent/src/capability/first_message_injector.rs`
（`prepare_first_message_with_skills_index`）。

结论：标签**大体可信但有例外**，不能拿它当验收依据。

## 4. `docs/guides/**` 那 28 条（真实欠账，按文件）

| 文件                                                       | 条数 | 说明                                                                                                                                                                          |
| ---------------------------------------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enterprise-team-roadmap.zh-CN.md`                         |   18 | 企业版路线图 P0/P1/P2。⚠️ **该文件已于 2026-09-19 核实为严重过期**（写于 dream-en 建仓前一个月），其 `[ ]` 里至少 6 条已建好；真正没做的只有 SAML / SCIM 2.0 / OIDC-JWKS 三条 |
| `session-2026-07-19-upstream-sync-changelog.zh-CN.md`      |    6 | 上游同步遗留                                                                                                                                                                  |
| `session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md`  |    3 | 同上                                                                                                                                                                          |
| `session-2026-07-20-post-sync-bug-conflict-audit.zh-CN.md` |    1 | 同上                                                                                                                                                                          |
| `docs/specs/media-generation/progress.zh-CN.md`            |    1 | 媒体生成进度表                                                                                                                                                                |

## 4b. dream-core 侧：506 条里只有 9 条是待办

先查了 dream-ui 就下结论是不对的，补上 dream-core：全仓 `- [ ]` **506** 条，
分布在 37 个文件。但按文件一看就明白：

```
47  crates/dream-core-app/assets/marketplace-personas/rules/StudyAbroadConsultant.md
31  .../GovernmentDigitalPresalesConsultant.md
29  .../RobloxAvatarCreator.md
21  crates/dream-core-app/assets/builtin-assistants/rules/ui-ux-pro-max.{en-US,ru-RU,zh-CN}.md
...
```

这些是**发给模型的人设 / 内置助手提示词内容**，`- [ ]` 是提示词正文里的清单模板。
例如 `SeoExpert.md`：

```markdown
## Meta Tags

- [ ] Title tag: [Primary Keyword] - [Modifier] | [Brand] (50-60 chars)
- [ ] Meta description: [Compelling copy with keyword + CTA] (150-160 chars)
```

—— 那是助手交付给**用户**的检查清单，不是我们的待办。

去掉 `crates/**/assets/**` 之后，dream-core 的文档待办只剩 **9 条**，全在
`docs/guides/p2-2-memory-pipeline-followups.zh-CN.md`（记忆管线的 feature-gating 清单）。

**所以两个仓库加起来，真实待办约 134 条**（dream-ui 125 + dream-core 9），
不是 1132 条。

## 5. 建议（没有自作主张去做）

1. **不要批量勾选那 493 条。** 抽查已经证明标签会错，批量勾等于把"没验过"固化成"验过了"。
2. **改约定，而不是改状态**：`[已实现]` 小节里的"验收标准"改用无框列表（`- ` 而不是 `- [ ]`），
   把勾选框留给真正待办的小节。这样 `grep -c '\- \[ \]'` 才有意义。
3. **企业版 P0 里真正没做的三条**（SAML / SCIM 2.0 / OIDC JWKS 验签）值得单独排期。
   ⚠️ 2026-09-19 核实：原先写作"五条"，其中「席位/license/用量看板」与「细粒度 RBAC + 资源分权」
   **早已建好**，是 roadmap 状态过期 —— 这正好又是本文第 3 节那条教训的反方向实例：
   `[已实现]` 会是假的，`[ ]` 同样会是假的。证据见
   [`handoff-2026-09-18-enterprise-p0-and-sso-verification.zh-CN.md`](handoff-2026-09-18-enterprise-p0-and-sso-verification.zh-CN.md) §3。
4. 每次给 PRD 小节标 `[已实现]` 前，至少确认对应实现文件存在 —— WeCom 这条就是没确认。

## 6. 复现方法

```bash
# 总数与文件分布
grep -rhE '^\s*[-*]\s*\[ \]' docs/ | wc -l

# 按小节状态分类（把每个框归到前面最近的标题，读标题末尾的 [状态]）
# 脚本见本轮 session 记录；核心是一次顺序扫描，维护"当前标题状态"变量
```
