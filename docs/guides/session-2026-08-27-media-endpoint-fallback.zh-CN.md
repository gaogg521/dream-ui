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

### 5.3 真机验证（CDP，dream-ui 上重做过一遍）

在 dev 里起一个本地假中转网关（只复现那一个行为：不路由的路径回 200 空 body，但**确实**代理 `seedance-gateway` 协议），配一条 provider 指向它，走**真实渲染进程 → ipcBridge → 主进程任务引擎 → adapter → driver**。

**前提复现**（按旧仓 §6.1 的教训，探测 provider 用了唯一模型名 `seedance-probe-fallback-xyz`，名字里仍带 `seedance` 才会被目录匹配成 `ark-task`）：

- `ownersOfThisModelName` = `["ZZ-Probe-FakeGateway"]` —— 模型名唯一，没有误命中 dev profile 里真实的 litellm 网关
- `specBefore` = `ark-seedance` / `ark-task` —— 目录猜错，用户处境精确复现
- `warningBefore` = `hostMismatch` —— A 的诊断真机触发
- `model_settings` 只有 `model_kind`，无 `media_endpoint`

**假网关侧收到的请求序列（硬证据）**：

```
POST /v1/contents/generations/tasks   ← 目录猜的原生 Ark，回 200 空 body
POST /api/seedance/createVideo        ← fallback 触发，换兄弟协议
POST /api/seedance/getVideoResult ×2  ← 轮询走 gateway 协议（running → succeeded）
GET  /out.mp4                         ← 下载
```

任务 `done`、视频落盘、`model_settings` 写回成 `{model_kind:'video', media_endpoint:'seedance-gateway'}`（修复前此处必然 `failed`）。

**写回的幂等性也验了**：清空日志后再生成一次，请求序列里**完全没有** `POST /v1/contents/generations/tasks` —— 探测只买一次，这正是 `persistEndpointStyle` 存在的理由。

**自愈后预警自动消失**：`warningBefore` = `hostMismatch` → `warningAfter` = `null`，不会修好了还挂着一个警告。

**A 的 UI 真机渲染**：切到视频模式后 `[data-testid="media-endpoint-warning"]` 出现 1 个，Caution 图标画在参数 pill 右边，**布局零溢出**（这正是刻意用图标而非文字行的原因）；悬停 tooltip 文案完整、插值正确：

> 这个模型按名称被识别为厂商原生接口，但当前渠道地址（http://127.0.0.1:8791/v1）看起来不是 volces.com。提交失败时会自动改用网关协议重试；也可在 设置 → 模型 里手动指定接口协议。

**真机残留已清理**：假 provider 删除、`tools.videoGenerationModel` 恢复成用户自己的选择、假网关进程关闭、假产物删除。

旧仓 §6.1 / §6.2 那两个坑（模型名要唯一、`MediaJobView` 主键是 `jobId`）本轮都规避掉了，要点复述在 §6.3。CDP 的用法见 §8。

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

---

## 八、真机验证顺带挖出的另一条链：AGNES 视频从来没能用过

用户问"这个修复对其他视频模型接入友好吗，比如我加的 AGNES 视频和图片"。查下来**不友好**，而且是两个 bug 互相掩盖了近三周。三个都已修，都有真机证据。

### 8.1 视频侧有两种失败模式，本轮原本只修了一种

| 失败模式                                 | 例子                    | 表现                                                                                    | 本轮                |
| ---------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- | ------------------- |
| 目录按名字匹配上了，但**协议猜错**       | `seedance-*` 挂中转网关 | 每次生成必失败，报错文案清楚                                                            | §4 已修             |
| 目录**不认识**这个名字，用户又没手选协议 | `agnes-video-v2.0`      | spec = `null` → `isMediaGenSupported` 返回 false → **从选择器里静默消失**，没有任何提示 | 原本没覆盖，§8.2 补 |

第二种对用户更难自查：驱动 `agnes-task` 明明存在、模型也被自动声明成 `video` 了，但视频模式里就是看不到它，也没有一句话告诉他"去设置里选 agnes-task 就能用"。

真机确认（不是读代码推断）：`isMediaGenSupported('video', agnesProvider, 'agnes-video-v2.0')` = **false**，而两个 agnes 图片模型都是 true。

### 8.2 根因一：`agnes-task` 是唯一有驱动却没有目录条目的协议

`IMPLEMENTED_ENDPOINT_STYLES` 里六个协议，`ark-task` / `dashscope-task` / `kling` / `openai-video` / `cogvideox` 都有目录条目，只有 `agnes-task` 没有。代码和文档里都找不到排除它的理由——是漏了。

而 video 分支**刻意不猜** endpoint style（`specFromDeclaration` 里写明了：视频厂商在线路协议上互不兼容，猜错就是"能选但永远调不通"），所以没有目录条目 = 除非用户手动指定，否则永久不可用。

**修法**：给 `videoModels.ts` 补一条 **host-pinned** 的 `agnes-video` 条目（`match: { model: /agnes.*video|video.*agnes/i, baseUrlIncludes: ['agnes-ai.com'] }`）。

⚠️ **为什么这里必须 host-pin，而上面五条都是只按名字匹配**——两个理由指向同一个方向：

1. `agnesDriver` **完全无视 `base_url`**，永远打硬编码的 `apihub.agnes-ai.com`（文档就是这么写的）。只按名字匹配的话，一个挂在别人网关上的 agnes 模型会带着**那个网关的 key** 直接绕过网关打到厂商——比"解析不出来"更糟，因为请求真的发出去了。
2. 给一个 host 固定的协议做名字匹配，正是 seedance 挂中转网关时爆掉的那个形状（§二），而 `agnes-task` **没有兄弟协议**可以 fallback 兜底。

所以挂在中转网关上的 agnes 视频**依然**解析为 null、依然需要手选 `media_endpoint`——这是对的，只有用户知道自己的网关讲什么。这条条目只修那个毫无歧义的情况：provider 就指着 Agnes 自己。

真机三种情况全验过：

```
直连 apihub.agnes-ai.com        → agnes-video / C / agnes-task   ✅ 自动可用
挂中转网关、没手选               → null                          ✅ 保守，不猜
挂中转网关、手选 agnes-task      → declared:… / C / agnes-task    ✅ 尊重用户声明
```

### 8.3 根因二：驱动读错了 URL 字段，每次生成都在付钱之后失败

补上目录条目、重启主进程后，生成第一次真正跑起来了——然后失败在：

```
Agnes reported completed but returned no metadata.url
```

驱动读的是 `payload.metadata?.url`（文档原话："final URL at `metadata.url`"）。拿那次已付费任务的 `remoteTaskId` 去直接问真实 API（免费，不用再生成一次），实测响应：

```json
{
  "id": "video_94db…",
  "object": "video",
  "status": "completed",
  "progress": 100,
  "seconds": "3",
  "size": "1088x832",
  "perf_output_size": 911629,
  "url": "https://platform-outputs.agnes-ai.space/videos/agnes-video-v2.0/video_94db….mp4"
}
```

**地址在顶层 `url`，`metadata` 这个键根本不存在。** 视频真的生成好了（`perf_output_size: 911629`，那个 URL curl 下来正好 911629 字节），只是驱动取不到它。

顺带排除了"是不是协议选错了"：同一个 task id 打 `openai-video` 的两条路径，`GET /v1/videos/{id}` 回 400 `task_not_exist`、`/content` 回 404。所以 `agnes-task` 的 `GET /agnesapi?video_id=` **是对的**，纯粹是字段名错。

**为什么三周没人发现**：这两个 bug 互相掩盖——目录缺条目让模型不可达，不可达就没人跑到过驱动的 `completed` 分支。而 `videoDrivers.test.ts` 里那条 completed 测试**喂的正是文档里的 `metadata.url`**，跟驱动犯了同一个假设，所以测试也是绿的。补目录条目才把它暴露出来。

**修法**：`payload.url || payload.metadata?.url`（顶层优先，文档形状保留兜底，成本一个 `??`），失败文案改成同时点名两个字段**并附上真实 payload**——旧文案只点一个字段又把 payload 丢了，这才是它需要花一次真实生成才能诊断出来的原因。测试补了真实响应形状那条。

### 8.4 顺带修：占位卡里"生成中"重复三遍

用户在真机上截图指出来的。`mediaJobStatus_polling` 和 `mediaJobStage_running` 两个不同的 key 恰好都翻译成"生成中"，于是运行中的卡片上，顶部状态 Tag、占位图标题「视频正在生成中…」、标题下面那行阶段文案，**三处说同一件事**——而 `running` 正是任务绝大部分时间所处的阶段，所以用户看到的基本就是这个样子。

修法：`running` 阶段不再往下传，让占位组件退回它那句真正有信息量的提示（「通常需要一到几分钟，期间可以继续做别的事」）。其他阶段（`准备中` / `已提交到服务端` / `服务端排队中` / `下载结果中` / `保存中`）都携带标题没有的信息，继续显示。

### 8.5 每条媒体能力的真机结果

| 路径                                             | 协议                                       | 结果                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 视频 · seedance 挂假中转网关（本轮修复的主目标） | `ark-task` → fallback → `seedance-gateway` | ✅ `done`，落盘，写回，幂等                                                                                                                                                                  |
| 视频 · `agnes-video-v2.0`                        | `agnes-task`（本轮新增目录条目 + 修驱动）  | ✅ `done`，落盘 840379 字节真 MP4（`ftypisom`）                                                                                                                                              |
| 图片 · `agnes-image-2.0-flash`                   | Form A 默认（OpenAI images）               | ✅ `done`，落盘 1.4MB 真 PNG                                                                                                                                                                 |
| 图片 · `doubao-seedream-5-0-pro`                 | `seedream-gateway`（同步 Form A）          | ✅ `done`，落盘 1.5MB 真 PNG                                                                                                                                                                 |
| 图片 · `gemini-3-pro-image`                      | Form A 默认                                | ❌ 渠道侧 `404 model not found`，**不是本仓问题**（该模型在那个 litellm 网关上不存在，`model_health` 里早有记录）。分类为 `modelNotFound` 而非 `notRouted`，所以 fallback **正确地没有触发** |

⚠️ **`gemini-3-pro-image` 那条同时是个正面证据**：它证明"只有 `notRouted` 才换协议"这条规则在真机上生效——一个诚实的 404 没有被 fallback 变成两个误导的错误。Agnes 提交时撞到的厂商侧 `503 no available server` 同理，也没触发 fallback。

⚠️ **顺带发现、未修**：`model_health` 对媒体模型的判断不适用。`doubao-seedream-5-0-pro` 在 `model_health` 里记的是 `unhealthy / 404 model not found`，但实际生成**成功**——因为健康检查打的是 chat 接口，而生成走的是 gateway 的图像路径。会让用户误以为模型坏了。不在本轮范围。

---

## 九、CDP 真机验证怎么做（本轮实测可用的做法）

- **dev 下 CDP 默认关闭**，必须 `DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev`（注意 P4 改名后前缀是 `DREAM_*`，不是 `AIONUI_*`）。日志里会出现 `[CDP] Developer app-wide debugging ENABLED on http://127.0.0.1:9230`。
- **`chrome-devtools` MCP 连的是独立浏览器**，看不到 Electron 窗口。要驱动真实 UI 只能自己连 9230。
- **Node 内置 `WebSocket`（v22+）够用**，不必依赖项目的 `ws`。
- **`/@fs/` 动态 import 应用模块**比模拟 Arco 组件点击稳得多：
  ```js
  const bridge = await import('/@fs/D:/dream/dream-ui/packages/desktop/src/common/adapter/ipcBridge.ts');
  await bridge.media.startJob.invoke({ kind: 'video', prompt: '…', model: '…' });
  ```
- **provider 管理的 ipcBridge 导出名是 `mode`**（不是 `provider`）：`mode.listProviders` / `createProvider` / `updateProvider` / `deleteProvider`。
- **Arco 的 `Dropdown`/`Trigger` 不响应 `element.click()`**，必须走 CDP `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased）。按文本找元素时不能只挑叶子节点，Arco 会把文案包在带子元素的 span 里——按"文本完全相等且外接矩形面积最小"来选。

### 9.1 ⚠️ 改 `common/media` 下的目录后必须重启主进程

**renderer 的 vite HMR 会给你一个假的"已生效"。** 本轮踩了：补完 `videoModels.ts` 后，用 `/@fs/` 在渲染进程里探测，`isMediaGenSupported` 已经是 `true`；但 `media.startJob` 走的是**主进程**，主进程还在跑旧 bundle，于是任务直接以 `unsupported-model` 失败。

`common/` 下的模块两个进程都用，electron-vite 在这种改动下**不一定**重启主进程（本轮日志里就没重启）。**判据**：探测显示"好了"但 `startJob` 报 `unsupported-model`，就是主进程没更新。停掉 dev、确认 `Get-Process electron` 清零、再起。

### 9.2 免费验证已付费任务的技巧

Form C 的任务在厂商侧完成后会留一段时间。失败的 job 在 `%APPDATA%\dream-ui-Dev\config\media-jobs.json` 里留着 `remoteTaskId`，可以：

- 直接调 `driver.poll(ctx, remoteTaskId)` 验证轮询分支——本轮就是这么在不再花钱的情况下确认 §8.3 的修复的；
- 或者给 `TaskPollAdapter.generate()` 传 `resumeTaskId`，跳过提交、走完轮询+下载+落盘。

⚠️ 但**下载那步不要在渲染进程里验**：跨源产物地址会被 CORS 拦掉，报 `Failed to fetch (platform-outputs.agnes-ai.space)`，看起来像 bug 其实是探针位置的问题。真实 adapter 跑在主进程没有这个限制。判据是拿 `curl` 直接拉那个 URL——本轮拉到 HTTP 200 / 911629 字节，跟 API 自报的 `perf_output_size` 完全一致。

### 9.3 个人版的 `media-precheck` 404 是预期的

dev 日志里会看到 `POST /api/one/billing/media-precheck → 404 Route not found`。路由在 `dream-core` 里**是存在的**（`dream-domain-billing/src/routes.rs:39`），只是个人版没挂载 billing 域。`governance.ts` 的 `checkMediaPolicy` 注释里写明了 "fails open on transport errors"，catch 掉返回 allow。**不是缺陷，别去"修"它。**

---

## 十、oxlint 跑不起来：是真 BUG，已修

§7 记为"顺带发现、未修"，本轮查清并修掉了。**它比表面严重：lint 门禁对任何 fresh install 的人都是死的**，而 `AGENTS.md` 写着"任何一步失败就中止 push"——一个跑不起来的门禁不会挡任何东西。

### 10.1 根因：规则名从来就是错的，1.79 把它纠正了

`package.json` 写 `oxlint: ^1.56.0`，caret 会解析到最新 1.x（本机装到 `1.79.0`）。而 `.oxlintrc.json` 里写的是裸名 `no-await-thenable`：

| 版本   | `no-await-thenable`                              | 结果                                   |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 1.56.0 | 存在                                             | 配置能解析，93 条规则跑起来            |
| 1.79.0 | **不存在**（eslint 和 typescript plugin 都没有） | **整份配置解析失败 → lint 完全跑不了** |

从 1.79 自带的 `configuration_schema.json` 里查到真名是 **`typescript/await-thenable`**——`no-` 前缀被去掉，改成与 typescript-eslint 上游一致（上游确实是 `@typescript-eslint/await-thenable`，本来就没有 `no-`）。所以本仓这个名字一开始就写的是 oxlint 早期那个错误别名。

⚠️ **失败形态是"跑不起来"而不是"报错"**，退出码仍是 0，很容易被当成通过。

### 10.2 修法

`.oxlintrc.json` 里 4 处 `no-await-thenable` → `typescript/await-thenable`，并把 4 处 `no-floating-promises` 一并补全前缀成 `typescript/no-floating-promises`（消除 plugin 解析的歧义）。**两个版本都实测接受**：1.79 恢复正常（262 条 warning、0 error、退出码 0），1.56 照旧（1043 warning、0 error）——所以不会反过来破坏还装着旧版本的环境。

不锁版本，因为改名之后两边都能跑；真要彻底防这类漂移，可以把 `^1.56.0` 换成锁定版本。

### 10.3 ⚠️ 顺带查明：这两条 `"error"` 级规则从来没有强制过任何东西

`typescript/await-thenable` 和 `typescript/no-floating-promises` **都是类型感知规则**，需要 `oxlint-tsgolint`——本仓 `package.json` 和 `node_modules` 里都没有。实测：

- 对一段必然违规的代码（`await 42`、以及丢弃一个 Promise 的调用），1.79 和 1.56 **都报 0 条**；
- 同一次运行里 `no-debugger` 正常触发，证明 lint 本身在跑，是这两条规则inert。
- `oxlint --type-aware` 会直接报 `Failed to find tsgolint executable`。

所以那三个 `overrides`（给 `*.js` / `tests/**` / `gemini/cli/**` 关掉这两条）同样一直是空操作。

**本轮刻意不装 `oxlint-tsgolint`**：真开起来会一次性冒出大量 floating-promise 报错（这类问题在任何 Electron 仓里都很常见），是产品级决策而不是顺手修。要开的话建议先装上、把两条降到 `warn` 看清存量、再逐步收紧。

（想在 `.oxlintrc.json` 里留注释是不行的：两个版本都会因 `unknown field \`$comment\`` 拒绝解析，已实测并回滚。）

---

## 十一、两个用户提出的质疑：查清结论

### 11.1 媒体计费：时长和张数是算了的，**清晰度完全没算**；单价入口确实很深

用户质疑"5秒/10秒、1张/2张、清晰度都不一样，价格怎么弄"。实测 `computeMediaCost`（真机跑的实际数字）：

| 输入                   | 来源        | 金额                                |
| ---------------------- | ----------- | ----------------------------------- |
| 视频 seedance 5秒 ×1   | builtin     | $1                                  |
| 视频 seedance 10秒 ×1  | builtin     | **$2** ← 时长有区分                 |
| 视频 seedance 5秒 ×2   | builtin     | **$2** ← 张数有区分                 |
| 图片 gpt-image ×1 / ×4 | builtin     | $0.04 / **$0.16** ← 张数有区分      |
| 视频 未声明时长        | builtin     | $1（默认按 5 秒兜底）               |
| agnes-video-v2.0       | **unknown** | 不显示金额（目录里没有 agnes 费率） |

所以质疑**部分成立**：

- ✅ **时长、张数都已经正确计入**（视频是 `张数 × 秒数 × 每秒费率`，图片是 `张数 × 每张费率`）。
- ❌ **清晰度/分辨率完全不参与计价**：`computeMediaCost` 的参数里根本没有 `resolution`/`size`，480p 与 1080p、1K 与 4K 同价。而厂商实际定价几乎都跟分辨率强相关，这是真实缺口。
- ❌ **用户自填单价是单一标量**（`media_unit_price_usd`：每张图 / 每秒视频），**结构上无法表达**"480p 每秒 $x、1080p 每秒 $y"。即使用户认真填了，分辨率差异也表达不出来。
- ❌ **入口确实很深**：设置 → 模型 → 展开某个 provider → 编辑某个模型 → **先把「模型类型」选成图片/视频**（`AddModelModal.tsx:216` 的条件），单价输入框才会出现；而且它是个没有独立标签的 `Input`，只有 placeholder「单价（美元，选填）」。用户不先知道"要先声明类型"就不可能找到它。

⚠️ **为什么不能顺手改**：`pricing.ts` 顶部写明"**This file mirrors a Rust implementation and must not drift from it**"——费率表在 `dream-core-common/src/license.rs`，用户单价分支在 `dream-domain-billing/src/service.rs::record_media_usage`，两边算出来的数必须一致，否则用户拿界面数字去对企业账单会发现我们的数是错的。把单价从标量改成"按分辨率分档"是**跨仓的数据结构 + 计费改动**，必须两边同时改并重编 `dreamcore`。属于产品决策，不在本轮范围。

### 11.2 对话模式的上下文/成本指示器：功能没丢，但对 `dream` 类型会话不显示

用户说"记得做过一个上下文花费和 token 使用的小功能，好像没找到了"。查清了：

**功能完好**（`ContextUsageIndicator.tsx` + ACP/dream 两个 hook 都接了线），渲染条件是 `tokenUsage ? <Indicator/> : undefined`，**与媒体模式无关**（用户两张截图的差别其实是"欢迎页 vs 会话内"：欢迎页还没有任何用量，所以本来就没有圆环）。

**但在 `dream`（1ONE CLI）类型会话里它永远不出现**，真机抓帧证据——发一轮对话（"3+3=?"，正常完成），整轮收到的帧类型只有：

```
start · thinking · content · finish
```

**没有任何用量帧**，而 `finish` 的 data 是：

```json
{ "session_id": null }
```

`FinishEventData` 上 `model` / `input_tokens` / `output_tokens` 三个字段带 `skip_serializing_if = "Option::is_none"`，所以它们**整个键都不存在**，说明构造时全是 `None`。前端 `useDreamEngineMessage.ts:272` 的守卫是 `'input_tokens' in usageData`，不成立 → `setTokenUsage` 从不调用 → 圆环从不出现。

`GET /api/conversations/{id}/usage` 对所有会话都返回 200 但 `used: null`，包括刚跑完两轮对话的那个——**后端也没有落下用量**。

根因在 dream-core，不在 dream-ui：

- 带用量的发射点 `BackendOutputSink::emit_stream_end`（`input_tokens`/`output_tokens`/`model` 都填）本轮没有被调用；
- 实际走的是 `session_agent.rs` 的路径，它三处 `emit_finish_once()` 都是 `FinishEventData { session_id, ..Default::default() }`；
- `session_agent.rs:3325` 的注释说明这条路径**故意不把用量放在 Finish 上**，而是"pump 把每个 `UsageDelta` 持久化到 `context_usage` 并直接广播"；而 `broadcast_usage_frame` 的过滤是 `UsageDelta { total_tokens, .. } if *total_tokens > 0`——本轮一个用量帧都没广播，说明这条后端路径压根没产出 `UsageDelta`。

**ACP 会话（Claude Code / Codex CLI）是好的**：`useAcpMessage` 三条来源都接了（`acp_context_usage` 实时帧、`GET /usage` 快照、`last_token_usage` 持久化恢复），用户截图 2 里 1M 上下文 + 缓存读写明细正是 Claude 经 ACP 的形状。

**顺带发现的两个前端缺口**（即使后端修好也要一起补）：

- `useDreamEngineMessage` **零次**调用 `getUsage`，没有从后端快照恢复的路径（ACP 那个 hook 有）；
- 它也**完全不处理 `acp_context_usage` 帧**，而 `broadcast_usage_frame` 的注释明确写着"Fires for every backend"——后端设计上是打算广播给所有后端的，前端这边没接。

**修它需要**：dream-core 让 1ONE CLI 这条会话路径上报 token 用量（`UsageDelta` → 持久化 + 广播），加上 dream-ui 这两个缺口，然后 `cargo build -p dream-core-app --release` + `node scripts/prepareAioncore.js` 重编内嵌 `dreamcore` 才会在 dev 生效。跨仓 + 需要重编后端，**本轮未做**。
