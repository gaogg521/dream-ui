# 2026-09-02 图片 seedream 走中转网关自动回退 + seedance 视频音频参数打通

> **一句话**：把 2026-08-27 视频侧修的那套「协议猜错→自动换网关协议→写回→发送前
> 预警」补到**图片 seedream**上（本来 §7 说不做，理由写错了）；顺带修了一个独立
> BUG——`clipParamsToSpec` 从来没透传 `generateAudio`，导致音频面板的开关对所有
> 视频模型都是**静默失效**的。
>
> **范围**：仅 `dream-ui`（`common/media` + 两个渲染层组件 + 单测）。`dream-core` /
> `dream-engine` / `dream-en` 零改动——协议选择和参数裁剪全在 `dream-ui`，与
> 2026-08-27 §5.1 同结论。**无新增 i18n key**（预警文案复用既有
> `conversation.mediaEndpointAutoMismatch`，已足够通用）。

---

## 一、seedance 视频无声音 —— 是我们的 BUG

用户报 `seedance-2-0-fast`（挂本地 litellm 网关，走 `seedance-gateway` driver）
生成的视频没有声音。**同一台机器上直连字节官方 `doubao-seedance-2-0-fast-260128`
（走 `ark-task` driver）出片是有声音的** —— 说明厂商 2.x 默认就生成音频，问题只在
中转网关这条路：我们从不发 `generate_audio`，网关/litellm 那侧按关处理。

### 根因

`clipParamsToSpec`（`common/media/catalog/resolve.ts`）是**所有生成参数进 adapter
前的唯一过滤点**。它对 `size / seed / resolution / firstFrameImage / …` 都有一条
`take()`，**唯独漏了 `generateAudio`**。于是：

- `MediaParamsPanel` 的「音频」段用户选的 on/off → 存进 `useMediaComposer` 的
  `params` state → `startMediaJob({ params })` → `job.params.generateAudio` **有值**
- `executeMediaGeneration` 调 `clipParamsToSpec(job.params, spec)` → 输出的 `params`
  里 **`generateAudio` 被丢掉**（没有 `take`，也不进 `dropped`，纯静默）
- `seedanceGatewayDriver` 里 `if (ctx.params.generateAudio !== undefined)` 永远
  不成立 → 从不发 `generate_audio` → 网关按自己的默认（无声）出片

`arkDriver`（火山直连）把选项编码成 `--flag` 文本后缀、没有音频通道 —— 但**这条
路不用管**：厂商 2.x 默认生成音频，用户实测直连出片有声。本轮不给它加 flag（flag
名无文档，写错会被当场景描述渲染进画面）。

### 修法

| 文件 | 改动 |
| --- | --- |
| `catalog/resolve.ts` | `clipParamsToSpec` 的 `take` 段补 `take('generateAudio', !!support?.audio)`；defaults 合并段补 `generateAudio`（仅当模型声明了 `audio` 能力且 spec 有默认值） |
| `catalog/types.ts` | `MediaModelSpec.defaults` 加 `generateAudio?: boolean` |
| `catalog/videoModels.ts` | `ark-seedance` 条目 `defaults: { …, generateAudio: true }` —— **用户拍板默认开启音频**，显式「不生成」仍可覆盖（`clipParamsToSpec` 既有的 "caller wins" 语义） |
| `adapters/taskDrivers/arkDriver.ts` | **不动**。用户实测火山直连 `doubao-seedance-2-0-fast-260128` 本来就有声音（2.x 默认生成音频），且文本 flag 名无文档、写错会进画面。直连路径靠厂商默认，网关路径靠 `seedanceGatewayDriver` 的 `generate_audio` JSON 字段（本来就支持） |
| `renderer/components/media/MediaParamsPanel.tsx` | 音频单元格 `active` 判断改用有效值 `value.generateAudio ?? spec.defaults?.generateAudio`，让用户看到默认是「生成」且可点掉 |
| `renderer/components/media/MediaModeControl.tsx` | `summarize()` 收一个 `defaultAudio` 参数，♪ / ♪✕ pill 按有效值显示 |

`seedanceGatewayDriver.ts` **无需改**——变更后它自然收到值（含默认 `true`）。

---

## 二、图片 seedream 挂中转网关：本来就该做，2026-08-27 的理由写错了

### 背景

`ark-seedream` 目录条目只按 `/seedream/i` 匹配、无 host pin、**无 endpointStyle**
→ 走标准 Form A `POST {base}/v1/images/generations`。litellm 网关把 seedream 挂在
`/api/seedream/v1/` 命名空间下，标准路径对 seedream 回 `404 model "…" not found`。
当前唯一出路是用户手动去 设置 → 模型 把「接口协议」改成「Seedream 内部网关」。

2026-08-27 §7 / `endpointFallbacks.ts` 注释说图片侧不做，理由是
"`seedream-gateway` 是 Form A、OpenAI images 是 Form C，跨 adapter"——**这句是
错的**：两者**都是 Form A**，而且 `openaiImagesAdapter` 本来就同时实现了两条
分支（`viaSeedreamGateway`）。所以图片侧的等价回退**完全可以在单个 Form A adapter
内就地做**，根本不需要碰 `taskPollAdapter` 那张 `ENDPOINT_STYLE_FALLBACKS` 表。

### 修法（对齐视频三件套）

**1. 自动回退 —— `adapters/openaiImagesAdapter.ts`**

`generate()` 重构：把单次 HTTP 调用抽成内部 `callOnce(viaGateway: boolean)`（两条
分支的 client 构造 + 请求都已在文件里），主分支按 `pinnedGateway`（=
`spec.endpointStyle === SEEDREAM_GATEWAY_STYLE`）选路由；失败时用
`classifyMediaFailure(msg)` 判类，满足全部条件才换另一条分支重试一次：

- 失败类 ∈ `{ 'notRouted', 'modelNotFound' }`
  —— 视频侧只认 `notRouted`；图片**多认 `modelNotFound`**，因为 seedream 命名
  空间没挂在标准路径时的确切症状就是 litellm 的 `404 model … not found`。代价是
  对**真不存在**的 seedream 名多打一次毫秒级 404，且 `spec.id === ARK_SEEDREAM_CATALOG_ID`
  收窄到唯一一个目录条目，blast radius 极小（`failureClass.ts` 顶部
  "matching 是猜、成本可接受时才用"同一原则）
- `spec.id === ARK_SEEDREAM_CATALOG_ID`
- 未 abort

成功后：
- 标准→gateway → `req.onEndpointStyleSwitched?.('seedream-gateway')`
- gateway→标准（用户钉错了协议）→ `req.onEndpointStyleSwitched?.('')`（清回 auto）

全兄弟都不答时，抛**原始错误** + 追加 `Automatically retried under X, with the
same result.`（照搬视频侧，避免紧随的建议文案被读成"还没试过"）。

**2. 写回 —— 零改动免费复用**

`process/services/mediaJob/index.ts:249` 的 `onEndpointStyleSwitched → persistEndpointStyle`
链路是 **form-agnostic** 的（`executeMediaGeneration` 对所有 kind/form 都传这个
回调）。图片侧调了回调就自动 `PUT /api/providers/:id` 写回
`model_settings[model].media_endpoint`，幂等已有（`index.ts:223`）。

**3. 发送前预警 —— `catalog/resolve.ts` 的 `diagnoseAutoEndpointMismatch`**

之前对 seedream 返回 `null`（`ark-seedream` 没 `endpointStyle`）。新增分支：
`spec.id === ARK_SEEDREAM_CATALOG_ID` 且 `base_url` 有值且不含 `volces.com` →
返回 `{ kind: 'hostMismatch', hints: ['volces.com'] }`。

- `renderer/hooks/media/useAutoEndpointWarning.ts` 已经对 `image` 模式调用
  （`MediaModeControl.tsx:103`），已处理 `hostMismatch`，图标 + tooltip 形状都在
- **复用既有 i18n key `conversation.mediaEndpointAutoMismatch`**——文案本就通用
  （"…matched to a vendor-native API by its name … retried under the gateway
  protocol automatically"），**零新增 key**

**4. 常量迁移 —— `catalog/imageModels.ts`**

`ARK_SEEDREAM_CATALOG_ID` 原本定义在 `adapters/seedreamGateway.ts`，而那个文件
`import fs/path`，不能被 renderer-safe 的 `catalog/` 引用。移到
`catalog/imageModels.ts`，`seedreamGateway.ts` 留一行注释指向新位置，
`openaiImagesAdapter.ts` 和 `resolve.ts` 都从 `catalog/` 引。

**5. 修正过时注释 —— `catalog/endpointFallbacks.ts`**

文件头那段"图片侧 Form A / Form C 跨 adapter"改成说明图片侧回退已在
`openaiImagesAdapter.ts` 内就地实现、不走这张表。`ENDPOINT_STYLE_FALLBACKS`
本身不动。

---

## 三、验证

### 自动化（全绿）

- `bunx tsc --noEmit` —— 0 错
- `bun run package`（electron-vite build）—— main / preload / renderer 全部干净
  出包，常量迁移没引入跨边界 import 或 renderer-safety 问题
- `bun run vitest run tests/unit/media` —— **36 文件 / 404 条全绿**（此前 35 / 393，
  +1 文件是新增的 `imageEndpointFallback.test.ts`，+11 条）。无 `Unhandled Errors`
- `oxlint`（改动目录）—— 退出码 0，只剩既有 warning
- `node scripts/check-i18n.js` —— 退出码 0；"Validation failed" 那些是既有的
  `skillsHub.*` / `login methods.*` / `agentError.codes.*` 缺 key，与本轮无关，
  本轮 0 新增 key
- DOM 套件 `MediaParamsPanel` / `MediaModeControl` / `pricing` —— 42/42 绿

### 新增 / 扩充的测试

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/media/imageEndpointFallback.test.ts`（新） | 真实 `OpenAiImagesAdapter` + mock client：标准路径 404 model not found → 自动打 `/api/seedream/v1` → 落盘 PNG + `onEndpointStyleSwitched('seedream-gateway')`；反向（钉错协议）→ 回落标准路径 + `onEndpointStyleSwitched('')`；负向：401 auth 失败**不**重试、非 seedream 模型**不**碰 |
| `catalogResolve.test.ts` | `generateAudio` 有 `audio` 能力时透传、无能力时进 `dropped`；`ark-seedance` 默认 `true` 被 merge；显式 `false` 覆盖默认 |
| `endpointFallback.test.ts` | `diagnoseAutoEndpointMismatch` 对 seedream + 非 volces host 命中 `hostMismatch`；对 volces 直连 / 已钉协议返回 null |

**负向验证**：把 `openaiImagesAdapter` 里 `routingMiss` 的分类 guard 临时改成
无条件 `true`，`imageEndpointFallback.test.ts` 的 "does not retry on an honest
auth failure" 立刻失败（`createRotatingClient` 被调 2 次而非 1 次）；还原后复跑绿。
证明那条分类判据是真的在起作用。

### ⚠️ 未做：CDP 真机验证

按 memory `dream-ui-cdp-real-machine-verify` / `verify-from-real-user-perspective`
的要求，媒体改动应起 dev + 假 litellm 网关走一遍真实 渲染进程→主进程→adapter。
**本轮没做**（假网关 + Arco 下拉 CDP 驱动是重活）。已用整包 build + 覆盖真实模块
的单测 + 全代码路径追踪替代。两个集成点靠追踪而非执行确认：

1. `params.generateAudio` 从面板 → `useMediaComposer.params` → `startMediaJob` →
   `job.params` → `clipParamsToSpec`：全程未经任何其他裁剪，`MediaModeControl.tsx:63`
   本来就读 `params.generateAudio` 证明它到得了那一层
2. `onEndpointStyleSwitched → persistEndpointStyle` 的 `PUT`：Form A / Form C 共用
   `executeMediaGeneration` 的同一个回调参数，视频侧已真机验证过这条链路

**建议接手者补一次 CDP 真机**（做法见
`session-2026-08-27-media-endpoint-fallback.zh-CN.md` §9）：
- 图片：不手选协议 → 首次自动回退落盘 + 写回 + 二次生成幂等（不再打标准路径）+
  预警图标出现/自愈后消失
- 视频：音频面板 选「生成」/「不生成」/不碰 → 抓假网关收到的 `createVideo` body
  的 `generate_audio` = true / false / true(默认)
- ⚠️ 改了 `common/media` 必须重启主进程（electron-vite 不一定重启主进程，renderer
  HMR 会给假的"已生效"）

---

## 四、已知边界（不在本轮）

- **企业「公司模型渠道」写回会被同步抹掉**：与视频侧 2026-08-27 §6 完全同构——
  `persistEndpointStyle` 的 `PUT` 会成功、下次 `sync-model-channels` 删行重建时
  丢失。生成始终成功（每次 fallback 兜底），代价是企业成员每次多一个毫秒级探测
  请求。真正收口要把「接口协议」做成 `dream-en` 管理后台的渠道定义字段，是产品面
  改动。
- **火山直连的音频开关是只读默认**：`ark-task` driver 不编码 `generateAudio`（flag
  名无文档）。2.x 默认有声，用户显式选「不生成」在直连路径上不生效。要补得先拿到
  火山官方 flag 名。
- **`modelNotFound` 触发图片回退的假阳性**：如果某网关**真的**没有某个 seedream
  名，会多打一次 `/api/seedream/v1` 的 404（毫秒级）。已收窄到 `ark-seedream`
  一个条目，可接受。
