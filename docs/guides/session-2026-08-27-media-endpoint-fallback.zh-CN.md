# 2026-08-27 视频生成"有几率报错"根治（dream 架构补齐）：协议猜错时自动换兄弟协议 + 猜错前预警

> **一句话**：这个 bug 在 dream 新架构里**原封不动地存在**——不是新引入的，是 2026-08-23 从 `1oneUI` 复制源码时一起带过来的，而旧仓的修复（`8e640d164`）落在 08-27，**晚于复制点**。本轮把旧仓那两个提交等价移植到 `dream-ui` 并按本仓约定收口。
>
> **范围**：仅 `dream-ui`（`common/media` + 主进程任务引擎 + 渲染层提示 + 13 语言文案）。**`dream-core` / `dream-engine` 零改动**——已核实后端只存 `media_endpoint` 字段、按模型名算计费，不参与协议选择（见 §5.1）。
>
> **新架构特有的差异**：企业「公司模型渠道」（managed provider）的协议写回**会在下次渠道同步时被抹掉**，本轮刻意不修，理由和后果见 §6。这一条旧仓文档里没有，是 dream 架构独有的。

---

## 一、这不是新 bug，是继承来的

用户报"有用户生成视频会报错"，截图是发送框视频卡片失败，模型 `seedance-2-0-fast`，错误原文：

```
Ark task submission failed: the endpoint returned HTTP 200 with an empty body,
which is how this gateway answers a path it does not route. It does not proxy
this generation API, so a different key will not help — point this model at an
endpoint that serves it.
当前渠道没有代理这个生成接口，换 key 也不会好。去 设置 → 模型 把该模型指向能提供该接口的地址。
[去修改模型设置]  [重试]
```

**这段报错本身就是旧仓 2026-08-10 `95a885ac7` 那次修复的产物**（诊断文案 + `notRouted` 分类 + 「去修改模型设置」按钮）。那次修的是"说得清、有入口"，没修"默认值这条路"。所以接手者不要以为这是没人管过的报错。

旧仓完整的根因追溯与真机验证记录在
`D:\aionui-m0\1oneUI\docs\guides\session-2026-08-27-media-endpoint-fallback.zh-CN.md`
（只读归档，不在任何 git 仓库里）。**本文档只写 dream 侧的确认、移植与差异**，不重复抄那份。

### 为什么 dream-ui 会带着它

`dream-ui` 的源码是 2026-08-23 从 `1oneUI` 原样复制的（不含 git 历史）。旧仓的修复在 08-27，晚 4 天。两仓之间**没有共享 history，cherry-pick 不可用**，只能按文件移植。

移植前逐文件比对过"旧仓修复前的版本"和"dream-ui 当前版本"，差异**只有品牌串**：

| 文件                                 | 与旧仓 pre-fix 版本的差异                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `taskPollAdapter.ts`                 | 仅版权头 `Copyright 2025 AionUi` → `Copyright 2026 1ONE`                                                                           |
| `catalog/resolve.ts`                 | 同上                                                                                                                               |
| `executeMediaGeneration.ts`          | 同上                                                                                                                               |
| `media/types.ts`                     | 同上                                                                                                                               |
| `MediaModeControl.tsx`               | 同上                                                                                                                               |
| `useMediaFailureAdvice.ts`           | 同上                                                                                                                               |
| `process/services/mediaJob/index.ts` | 版权头 + `AIONUI_MEDIA_CONVERSATION_ID` → `DREAM_MEDIA_...`、临时目录 `Temp/aionui` → `Temp/dream`（P4 改名的产物，与本 bug 无关） |

所以旧仓的 patch 在 dream-ui 上**零冲突干净落地**，逻辑无需改写。

### 在 dream-ui 上实测确认过的两条前提

不是靠"文件一样所以 bug 一样"推断的，两条都直接查过当前代码：

1. `packages/desktop/src/common/media/catalog/videoModels.ts:22-26` —— `ark-seedance` 条目仍是 `endpointStyle: 'ark-task'` + `match: { model: /seedance/i }`，**没有任何 host pin**（无 `platform` / `baseUrlIncludes` / `providerNameIncludes`）。
2. `packages/desktop/src/renderer/pages/settings/components/AddModelModal.tsx:60-61` —— 错配预警第一行仍是 `if (!mediaEndpoint) return null`，即**只校验用户手选、从不校验系统自动替他选**。

`endpointFallbacks.ts` / `failureClass.ts` 在移植前不存在，也印证了修复确实缺失。

---

## 二、为什么"有几率"——三种配置，两种确定结果

它不是偶发，是**按配置分组的确定性失败**：

| 用户的配置                                                        | 目录解析出的协议    | 实际结果     |
| ----------------------------------------------------------------- | ------------------- | ------------ |
| 模型挂在方舟官方地址（`ark.cn-beijing.volces.com/api/v3`）        | `ark-task` ✅ 猜对  | 一直正常     |
| 挂在中转网关，且**有人手动**把「接口协议」设为 `seedance-gateway` | 手动声明覆盖目录 ✅ | 一直正常     |
| 挂在中转网关，**从没打开过那个下拉框**                            | `ark-task` ❌ 猜错  | **每次必挂** |

第三种就是报错用户。中转网关只代理聊天接口，对方舟的 `/contents/generations/tasks` 不路由。

**「重试」按钮在这种情况下永远无效**——同一个不存在的路径重试多少次都是 200 空 body。

⚠️ **dream 架构下第三种的覆盖面比旧仓更大**：企业「公司模型渠道」是管理员在后台配的，成员本人根本没有那个下拉框可点。管理员若没在渠道定义里写 `media_endpoint`，**整个公司所有成员 100% 挂**。详见 §6。

---

## 三、根因链（结论摘要，完整追溯见旧仓文档）

- 目录条目只按模型名匹配、不 pin host，是 2026-08-06 新增 `seedance-gateway` 驱动时的**有意取舍**（不把某家公司的内网地址写进产品），本轮没有推翻它。代价是同一个模型名在两种部署下含义不同。
- 08-10 的错配预警因为 `if (!mediaEndpoint) return null` 只覆盖"手动选"，而出问题的正是"自动选"那条路。
- 长期没被发现，是因为开发机 dev profile 里那个网关 provider 早就手动钉好了 `seedance-2-0-fast → seedance-gateway`，自测永远是好的。

---

## 四、修法

### 4.1 B（治本）：提交失败自动换兄弟协议

**`common/media/adapters/taskPollAdapter.ts`** 新增 `submitWithFallback`：

- **只有 `notRouted` 触发。** 其余失败类别（401 / 模型不存在 / 限流 / 内容审核）都意味着路径本来是通的、请求被拒了，换协议只会把一个诚实的错误变成两个误导的。
- **成功后连轮询上下文一起换掉。** task id 是兄弟协议发的，继续用原协议去轮询等于查一个那台主机没听过的 id。
- 全部兄弟协议也失败时，抛的是**原始错误**（它点名用户配置的那个协议）+ 追加 `Automatically retried under X, with the same result.`，避免紧随其后的建议文案被读成"还没试过的建议"。
- `pollUntilDone` 的 interval/timeout 改为读 `ctx.spec` 而非 `req.spec`——fallback 之后生效的 spec 在 ctx 里。
- 循环里 `await` 是**故意串行**的（oxlint 会在这里报一条 `no-await-in-loop` warning）：并行提交等于同时下两个付费任务。

**`common/media/catalog/endpointFallbacks.ts`**（新增）：

```ts
export const ENDPOINT_STYLE_FALLBACKS = {
  'ark-task': ['seedance-gateway'],
  'seedance-gateway': ['ark-task'], // 反向也真实存在
};
```

- **零硬编码 host**：两个协议都跑在 provider 已有的 `base_url` 上，只差路径形状、轮询动词、参数如何传递。哪个答应了就是这个部署的真相。所以这条修复**没有违反 08-06 那个取舍**。
- **范围刻意窄**：只收「同 API form + 同 host + 同凭据」的对。图片侧那对（`seedream-gateway` 是 Form A、OpenAI images 是 Form C）两条都不满足，跨 adapter，**不在范围内**。
- 反向（gateway → 原生）不是假设：08-10 那次预警要解决的真实故障就是"模型手动钉了网关协议，而 base_url 指向厂商自己的 host"。
- 有测试钉死表里每个 id 都在 `IMPLEMENTED_ENDPOINT_STYLES` 且真有 driver。

**`process/services/mediaJob/index.ts`** 新增 `persistEndpointStyle`：

- 通过 `PUT /api/providers/:id` 把生效的协议写回 `model_settings`。不写回的话每次生成都要重买一次这个探测；而且崩溃重启后 resume 会用目录还在猜的协议去轮询。
- **写回前重新拉一次 provider**：`PUT` 合并的是字段不是 map 条目，`model_settings` 整份传输，用 job 启动时的旧快照会静默回滚期间用户改的别的模型。
- 已经是目标值就跳过（幂等）。
- 写回失败只 `console.warn`，绝不抛进 job——媒体已经提交成功了，记账失败不该把一次成功的生成变成失败。

**`common/media/failureClass.ts`**（新增）：`classifyMediaFailure` 从 `renderer/hooks/media/useMediaFailureAdvice.ts` 提到 `common/`，hook 改为 re-export。理由：现在 UI 显示的建议和执行器的重试决定用**同一份判据**，不会出现"界面说这个网关没代理、而执行器不作为"或反之。

### 4.2 A（兜底）：发送前预警

**`common/media/catalog/resolve.ts`** 末尾新增 `diagnoseAutoEndpointMismatch`：

- 用户手动声明过 `media_endpoint` 就返回 null（那归设置页那个警告管）。
- **只报 `hostMismatch`**。另两种诊断（`hostAgnostic` / `gatewayStyle`）是回答"这协议是什么"，挂在用户没做过的选择旁边是噪音。
- 显示专用，永不 gate。

**`renderer/hooks/media/useAutoEndpointWarning.ts`**（新增）+ **`components/media/MediaModeControl.tsx`**：参数 pill 旁一个 `Caution` 图标 + Tooltip（`data-testid='media-endpoint-warning'`）。

⚠️ **刻意不加文字行**：这一行 2026-08-07 才因为参数 pill 撑宽溢出画到模型选择器上修过一次（`MediaModeControl.module.css` 的宽度约束就是那次加的）。图标 + tooltip 是零布局增量的形状。

**i18n**：新增 `conversation.mediaEndpointAutoMismatch`，**13 语言全部正式译文**（沿用旧仓已产出并审过的译文，未用英文占位）；`i18n-keys.d.ts` 已同步。

### 4.3 dream 侧的收口

- 4 个新文件的版权头统一为本仓约定的 `Copyright 2026 1ONE`（旧仓 patch 带的是 `Copyright 2025 AionUi (aionui.com)`）。
- 未改 `AddModelModal.tsx` 的那个 `if (!mediaEndpoint) return null`：那个 guard 在它自己的语境里是对的（用户什么都没选，没有可以二次猜疑的对象），自动那条路由 A 覆盖。

---

## 五、验证

### 5.1 后端确认零改动（新架构必须自己查一遍）

旧仓文档写"后端零改动"，但 dream 是三仓架构，不能直接沿用这个结论。实查：

- `dream-core` 里只有 4 处涉及：`dream-core-api-types/src/provider.rs`（`media_endpoint` 只是个存取字段）、`dream-core-common/src/license.rs` + `dream-domain-billing/src/service.rs`（按模型名估价/配额）、`010_provider_registry.sql`（表结构）。**没有任何 HTTP 协议驱动逻辑。**
- `dream-engine`：0 处。
- `dream-en/admin-web`：只有账单展示（`BillingTab` / `mediaLedgerTab`），不参与生成。
- `dream-ui` 内 `executeMediaGeneration` / `TaskPollAdapter` 的**唯一执行侧调用者**是 `process/services/mediaJob`。三个入口（渲染层 `ipcBridge.media.startJob` → `bridge/mediaBridge.ts`、WebUI 的 HTTP 路由 `services/mediaHttpRoute.ts`、内置 MCP 图像生成工具）**全部汇聚到同一个 `getMediaJobManager()`**，所以 fallback 和写回对这三条路一律生效，没有第四条绕过修复的路径。

结论：协议选择完全发生在 `dream-ui`，**不需要 `backend-rebuild.ps1` 重编内嵌 `dreamcore`。**

### 5.2 测试

- **新增 `tests/unit/media/endpointFallback.test.ts` 11 条**，用**真实 driver + mock fetch** 走完整协议链路（ark 返 200 空 body → gateway `createVideo` → `getVideoResult` → 下载落盘），并断言轮询打的是 gateway 而非 ark。11/11 绿。
- **负向验证（在 dream-ui 上重做过，不是照抄旧仓结论）**：把 `if (classifyMediaFailure(message) !== 'notRouted') throw error;` 改成无条件 `throw error;`，**正是那 3 条 fallback 测试失败、其余 8 条不动**。已还原并复跑绿。这一步证明测试真的在考修复本身，不是空过。
- media 全套 **375 条 / 35 文件全绿**（旧仓当时是 357/33，dream-ui 多出的是它自己后续的媒体工作）。
- 更大范围 `tests/unit/{media,settings,providers,conversation,renderer}` **3062 条 / 341 文件**：见 §7 关于那 1 条无关 flake 的说明。
- `tsc --noEmit` 0 错。
- `node scripts/check-i18n.js` 通过（类型定义 in sync；85 条 unknown literal key 警告是 `superAssistant` 既有的，与本次无关）。
- oxlint **0 error**（用 `oxlint@1.56.0` 跑的，原因见 §7）。

### 5.3 没做真机

**本轮没有在 dream-ui 上做真机（Electron + 假网关）验证**，只做了单测 + 负向验证 + 静态确认。旧仓那次做了完整真机，请求序列是硬证据；由于移植后的代码路径与旧仓逐字等价（§1 的比对表），本轮判断单测足够。

如果要补真机，**先读旧仓文档 §6.1 和 §6.2 那两个坑**（下面 §6.3 复述了要点），别重新踩。

---

## 六、dream 架构特有：企业「公司模型渠道」的写回会被同步抹掉

这一条旧仓文档里没有，是 dream 三仓架构独有的，**对接手者最要紧**。

### 6.1 事实

`dream-core/crates/dream-core-system/src/managed_provider.rs` 的 `write_channel` 是**删除+重建**，不是 update：

> Replace rather than update: the channel definition on the server is the whole
> truth for these rows, and a partial update would let a stale local field
> survive a sync that was supposed to correct it.

而 `model_settings` 整份来自服务端的渠道定义（`None` 时写 `"{}"`）。`update_provider`（`routes.rs:335`）**没有 managed 守卫**，所以 `persistEndpointStyle` 的 `PUT` 会成功、本地也真的持久化——但**下一次 `POST /api/providers/sync-model-channels` 会把整行删掉重建，写回的 `media_endpoint` 随之消失**。

### 6.2 后果与为什么不在本轮修

- **生成始终是成功的**：fallback（B）每次都会兜住。代价是企业成员在这种渠道上**每次生成多付一个探测请求**（打一个不路由的路径，毫秒级返回），直到管理员在渠道定义里写上 `media_endpoint`。
- **resume 边缘情况**：写回被抹掉 + 随后崩溃重启，resume 会用目录还在猜的协议去轮询那个 id，一次轮询失败（任务仍在远端）。
- **不修的理由**：真要修，要么让本地写回穿透同步（直接对抗"服务端是这些行的全部真相"这个设计），要么把它做成渠道定义的一部分（要动 `dream-core` + `dream-en` 管理后台，是产品面改动）。两者都远超"修掉这个报错"的范围。**用户的报错已经不会再出现了**，这一条属于成本优化。
- **A 那半对企业成员是生效的**：公司渠道被物化成真实的 provider 行，`GET /api/providers` 会列出来，`useAutoEndpointWarning` 走的就是同一份列表，所以成员在发送前**一样能看到那个预警图标**——即使写回会被同步抹掉。
- **真要收口的最小做法**（留给后来者）：在 `dream-en` 管理后台配置公司模型渠道时，把「接口协议」做成显式字段并带上和设置页同样的错配预警——从源头让管理员一次配对，比在客户端反复探测更合理。

### 6.3 旧仓那两个坑（真机前必读）

- **媒体引擎按"模型名找 owner"选 provider**（`mediaJob/index.ts` 的 `resolveSelectedProvider`：`providers.find(p => p.models?.includes(explicitModel))`）。旧仓那次真机第一次撞上 dev profile 里**真实**的 litellm 网关 provider（它也提供 `seedance-2-0-fast` 且早已钉好 `seedance-gateway`、排在假 provider 前面），结果用真实 key 真的生成了一个 888KB 视频（约 $1），fallback 一次都没触发、假网关一个请求都没收到。**真机前先确认这个模型名在 provider 列表里唯一**；探测用的名字里**仍要带 `seedance`** 否则目录不会匹配成 `ark-task`，复现不出前提。
- **`MediaJobView` 的主键是 `jobId` 不是 `id`**。`jobs.find(j => j.id === jobId)` 里两边都是 `undefined` 时**恒真**，会匹配到列表里别的 job——旧仓那次据此误报过一次"配置写回失败"，实际一直是好的。媒体 job 的字段是 `jobId` / `status` / `model` / `assets`。

---

## 七、边界与已知项

- **已知假阳性**：若某网关确实代理了 DashScope / OpenAI 的任务 API，那些模型会显示预警图标但其实能用（它们没有兄弟协议，B 也帮不到）。文案是"看起来不是"而非断言，且不阻塞发送。要收窄的话，可以把 A 限制到"有 fallback 兄弟的协议"。
- **图片侧未覆盖**：`seedream-gateway` ↔ OpenAI images 跨 Form A / Form C，换协议要跨 adapter，本轮刻意不做。
- **顺带发现、未修：`oxlint` 在本仓当前 `node_modules` 下跑不起来。** `package.json` 是 `^1.56.0`，实际装成了 `1.79.0`，而 1.79 把 `no-await-thenable` 从 `eslint` plugin 移走了，于是 `.oxlintrc.json` 直接解析失败：

  ```
  Failed to parse oxlint configuration file.
    x Rule 'no-await-thenable' not found in plugin 'eslint'
  ```

  与本次改动无关（没碰任何配置文件），旧仓装的是 1.56.0 所以正常。**本轮 lint 是用 `npx oxlint@1.56.0` 跑的，0 error。** 要根治就把 `oxlint` 从 `^1.56.0` 改成锁定版本，或把那条规则移到 `typescript` plugin 下。

- **`tests/unit/renderer/mermaidBlockPanZoom.dom.test.tsx` 在大批量并跑时失败过一次**，与本次改动无关（本次没碰 mermaid）：单独跑 2/2 绿，整个 `tests/unit/renderer`（261 文件 / 2327 条）也全绿，属于并行顺序相关的既有 flake。
- **`.claude/worktrees/` 下有一份完整的仓库副本**，全仓 grep / sweep 时会被误扫进来（本轮所有改动都只落在主工作树，未动 worktree）。
