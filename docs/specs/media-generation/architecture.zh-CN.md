# 多媒体生成（图片 / 视频）架构设计

> 状态：**设计稿，待评审**（2026-08-05）
> 范围：图片生成从「单一 chat 多模态链路」升级为多形态适配 + 视频生成从零建设
> 主要改动仓：1oneUI（桌面端主进程 / 渲染层 / 内置 MCP）；企业管控闸门涉及 1oneCore（阶段五）
> 前置调研结论：见本文 §1（已逐文件核实，锚点均为当前代码实际位置）

---

## 1. 现状与短板（已核实）

### 1.1 图片：只有一条窄路

| 事实                                                                                                            | 锚点                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 唯一入口是内置 MCP 工具 `aionui_image_generation`，stdio 子进程                                                 | `packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts`        |
| 唯一实现是 chat completions 多模态回图（"Form B"）：发 chat 请求，从 `message.images` 或正文 markdown 抠 base64 | `packages/desktop/src/common/chat/imageGenCore.ts:245`                       |
| 没有 `/v1/images/generations`（Form A）适配器，没有任何异步任务/轮询（Form C）能力                              | `packages/desktop/src/common/utils/imageModelAllowlist.ts:10-13`（注释自述） |
| 白名单只能硬编码三条规则（gemini / openrouter.ai / antigravity）+ 模型名含 `image\|banana\|imagine`             | `imageModelAllowlist.ts:30-48`                                               |
| 工具 schema 只有 `prompt` / `image_uris` / `workspace_dir`，无尺寸/比例/张数/质量/seed/负面词                   | `imageGenServer.ts:78-96`                                                    |
| 多图输出只取 `images[0]`，其余直接丢                                                                            | `imageGenCore.ts:299`                                                        |
| 全局唯一图片模型，靠 `AIONUI_IMG_*` 环境变量下发给 MCP 子进程（**api_key 明文进子进程 env**），不能按会话切     | `packages/desktop/src/common/config/imageGenerationMcpEnv.ts`                |
| 能力判定靠模型名正则                                                                                            | `packages/desktop/src/common/utils/modelCapabilities.ts:18-28`               |

被结构性排除（不是没配，是接不了）：DALL·E 3、gpt-image-1、Flux、SD、Seedream/即梦、通义万相、Midjourney、Recraft、Ideogram，以及一切 OpenAI 兼容网关（new-api/one-api）上的图片模型。

### 1.2 视频：零

- `IMAGE_EXTENSIONS`（`packages/desktop/src/common/config/constants.ts:23`）无任何视频格式；无 `VIDEO_EXTENSIONS`。
- `ModelType` 无 `video_generation`；无播放器组件；附件上传不认视频；异步任务基础设施不存在。

### 1.3 输入侧不弱，短板在生成与呈现

aionrs 有 `ContentBlock::Image` + `view_image` 工具（JPEG/PNG/GIF/WebP ≤20MB），看图是通的。**但 aionrs 整体是纯文本架构**（图片/音视频/PDF 转文字注入 agentPrompt），视频内容 agent 看不了——这是本设计的边界约束之一。

### 1.4 凭据侧的好消息

DashScope（`dashscope.aliyuncs.com/compatible-mode/v1`）与火山方舟 Ark（`ark.cn-beijing.volces.com/api/v3`）**已作为平台注册**（`packages/desktop/src/renderer/utils/model/modelPlatforms.ts:155/:199`），只是端点是 chat 的。做 Form C 时 provider 记录与 api_key 直接复用，换 path 即可，用户不用重新配渠道。

### 1.5 市面 API 只有三种形态

| 形态                    | 协议形状                                              | 代表                                                                                               | 现状        |
| ----------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| **A · 同步 REST**       | `POST /v1/images/generations` → 直接回 b64/url        | DALL·E 3、gpt-image-1、SiliconFlow、new-api/one-api 网关、Azure OpenAI                             | ❌          |
| **B · chat 多模态回图** | chat completions → `message.images` / markdown base64 | Gemini image-preview、OpenRouter                                                                   | ✅ 唯一有的 |
| **C · 提交 + 轮询**     | submit → task_id → poll → download                    | **全部视频**（可灵、Seedance、Veo、Sora、Runway、Vidu、CogVideoX）+ 大量国产图片（通义万相、即梦） | ❌          |

**根因只有一个：缺「异步媒体任务」这层抽象。** 图片被硬绑在 chat 客户端上；视频天生异步（30 秒~5 分钟），这层不建视频永远做不了，一半图片市场也进不来。

---

## 2. 目标 / 非目标

### 目标

1. 图片生成支持三种 API 形态，主流模型（DALL·E 3 / gpt-image-1 / Flux / SD / 万相 / 即梦 / Seedream）全覆盖。
2. 视频生成从零到一：文生视频、图生视频（首帧/首尾帧）、时长/分辨率参数。
3. 异步任务引擎：提交/轮询/下载/超时/取消/重启恢复，job 独立于工具调用存活。
4. 模型能力数据驱动（声明式目录），干掉正则猜测；白名单变成目录查询。
5. 参数面完整并按模型校验；多图全收不再只取第一张。
6. 呈现侧媒体一等公民：多图画廊、视频播放器、进度卡片；附件认视频。
7. 企业管控闭环：媒体生成纳入成本上限与模型 allowlist（当前完全绕过，是真实合规缺口）。
8. 三种 agent 后端（aionrs / Claude Code / Codex CLI）零区别对待——继续走 MCP 一次接线全通。

### 非目标（本期不做）

- 不做本地推理（本地 SD/ComfyUI 集成）。
- 不做音频生成 / TTS（语音已有独立链路）。
- 不做媒体编辑器（裁剪/标注）；「重新生成/出变体/以图生视频」按钮属呈现层增强，排在主链路之后。
- 不动 aioncore 会话消息 schema（阶段一至四完全在 1oneUI 内闭环；见 §8 开放问题 Q4）。

---

## 3. 总体架构

```
                    ┌─────────────────────────────────────────────┐
  agent 后端         │ 1oneUI 主进程                                │
  (aionrs/Claude/    │                                             │
   Codex, 说 MCP)    │  ┌──────────────────┐   ┌────────────────┐  │
      │              │  │ MediaJobService  │──▶│ 企业管控 precheck│  │
      ▼              │  │  (job 状态机/持久化│   │ (阶段五,调1oneCore│ │
 ┌──────────────┐    │  │   /并发/恢复/进度) │   │  billing 端点)  │  │
 │ 内置 MCP 薄壳 │—TCP—▶│        │          │   └────────────────┘  │
 │ (stdio 子进程)│    │  │        ▼          │                      │
 │ one_image_*  │    │  │ MediaProviderRegistry                    │
 │ one_video_*  │    │  │  ├ FormA: OpenAiImagesAdapter            │
 │ one_media_job│    │  │  ├ FormB: ChatMultimodalAdapter (现imageGenCore)│
 └──────────────┘    │  │  └ FormC: TaskPollAdapter                │
      ▲              │  │      ├ dashscope-task 驱动               │
      │ 进度/结果      │  │      ├ ark-task 驱动                     │
      │ (只传路径,     │  │      ├ openai-video 驱动 (Sora)          │
      │  永不传字节)    │  │      └ kling / vidu / ... 驱动           │
      │              │  └──────────────────┘                       │
      │              │        │ 查询           │ IPC 进度广播        │
      │              │  ┌──────────────────┐   ▼                   │
      │              │  │ mediaModelCatalog │  渲染层: 进度卡片/画廊  │
      │              │  │ (声明式能力目录)    │  /播放器/附件         │
      │              │  └──────────────────┘                       │
      └──────────────┴─────────────────────────────────────────────┘
```

### 关键架构决策

**D1 — MCP 仍是唯一调用入口。** 三种 agent 后端唯一的公共协议是 MCP；`search_team_knowledge` 已验证过这条路（一次接线三家全通）。换后端原生服务会像 ACP 那样够不着。**不变。**

**D2 — 生成执行从 MCP 子进程搬进主进程，MCP server 变薄壳。** 这是本设计最重要的一条。现状是 `imageGenServer.ts` 子进程自己拿 env 里的明文 api_key 直接调 API；改为薄壳通过 TCP（4 字节长度头 + JSON，**逐条照抄 `teamKnowledgeServer.ts` 的既有套路**）把请求转给主进程 `MediaJobService`。理由：

- **job 必须独立于工具调用存活**（工具调用被 CLI 侧超时砍掉后，视频任务照跑照落盘）——只有主进程能提供这个生命周期；
- 重启恢复需要持久化与常驻轮询，子进程做不到；
- 企业管控闸门（阶段五）必须在主进程统一收口，否则永远有绕过路径；
- 顺带消除 api_key 明文进子进程 env 的现状（子进程今后只拿一个 TCP 端口号）；
- 进度推送：主进程可同时向 MCP 连接发 progress、向渲染层发 IPC。

**D3 — 能力判定数据驱动。** 新建 `mediaModelCatalog`（声明式目录，§4.2），`isImageGenSupported` 与 `CAPABILITY_PATTERNS.image_generation` 降级为目录未命中时的兜底。白名单从「硬编码规则」变「目录查询」。

**D4 — job 落库在主进程本地，不动 aioncore schema。** 阶段一至四 1oneUI 内闭环；企业管控通过调用 1oneCore 既有风格的 HTTP 端点实现（阶段五，跨仓）。个人版红线：无企业配置时零额外请求、行为零变化。

**D5 — 三种形态统一收敛到一个适配器接口。** Form B 现有逻辑（`imageGenCore.ts`）不重写，整体挪进 `ChatMultimodalAdapter`，同批修掉 `images[0]` 只取第一张的问题。

**D6 — 媒体字节永不过 TCP / MCP 通道。** `imageGenCore.ts:304-311` 的注释记录过 2026-04-14 的 base64 大 payload 灾难（数百 MB base64 走 framed TCP 引爆 commit charge）。铁律：主进程落盘，所有通道只传**文件路径 + 元数据**。

---

## 4. 模块设计

### 4.1 MediaProvider 适配器层

位置：`packages/desktop/src/common/media/`（common 层，与 `imageGenCore` 同层，主进程调用）。

```ts
type MediaKind = 'image' | 'video';

type MediaGenParams = {
  // 图片
  size?: string; // '1024x1024' 等，按 catalog 校验
  aspect_ratio?: string; // '16:9' 等（与 size 二选一，catalog 声明哪个可用）
  n?: number; // 张数
  quality?: string;
  seed?: number;
  negative_prompt?: string;
  // 视频
  duration_seconds?: number;
  resolution?: string; // '720p' | '1080p' ...
  first_frame_image?: string; // 本地路径或 URL
  last_frame_image?: string;
  camera?: string; // 运镜，catalog 声明是否支持
};

type MediaAsset = {
  kind: MediaKind;
  filePath: string; // 已落盘的绝对路径（唯一的媒体载体，见 D6）
  relativePath: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  coverFramePath?: string; // 视频封面帧
};

type MediaGenResult = {
  assets: MediaAsset[]; // 多图全收
  text?: string; // 模型附带的文字说明
};

interface MediaProviderAdapter {
  readonly form: 'A' | 'B' | 'C';
  generate(req: {
    kind: MediaKind;
    prompt: string;
    params: MediaGenParams;
    inputUris: string[]; // 参考图/首帧图等
    provider: TProviderWithModel;
    spec: MediaModelSpec; // catalog 条目
    workspaceDir: string;
    signal: AbortSignal;
    onProgress: (p: { stage: string; percent?: number; taskId?: string }) => void;
  }): Promise<MediaGenResult>;
}
```

三个实现：

- **`OpenAiImagesAdapter`（Form A）**：`POST {base}/images/generations`（生成）与 `/images/edits`（图生图）。参数直映射 `size/n/quality`；响应 `b64_json` 或 `url` 两种都处理（url 走下载）。这是性价比最高的一步——一两个文件解锁 DALL·E 3 / gpt-image-1 / SiliconFlow / 各类网关上的 Flux 和 SD。
- **`ChatMultimodalAdapter`（Form B）**：现 `executeImageGeneration` 的 API 调用与抠图逻辑整体迁入；`images[0]` 改为全量循环落盘。`imageGenCore.ts` 里的工具函数（`processImageUri`/`saveGeneratedImage` 等）抽到共享 util 供三个适配器复用。
- **`TaskPollAdapter`（Form C）**：submit → task_id → poll（指数退避，间隔/超时来自 catalog）→ download → 落盘。内部按 `spec.endpointStyle` 分发到具体**驱动**（driver），驱动只描述协议差异（提交 path/header、状态字段名、结果字段名），轮询骨架共享一份：
  - `dashscope-task`：`POST /api/v1/services/aigc/{text2image|video-generation}/...` + `X-DashScope-Async: enable`，`GET /api/v1/tasks/{id}`；
  - `ark-task`：`POST /api/v3/contents/generations/tasks`，`GET .../tasks/{id}`（Seedance/即梦系）;
  - `openai-video`：Sora 风格 `/v1/videos`；
  - 后续：`kling`（JWT 签名）、`vidu`、`cogvideox` 等按需增驱动。

**base_url 换轨规则**：DashScope/Ark 的 provider 存的是 chat 端点（`.../compatible-mode/v1`、`.../api/v3`），驱动声明自己的 `deriveEndpoint(base_url)`（如 dashscope：剥 `/compatible-mode/v1` 得 host 根再拼媒体 path），凭据复用同一条 provider 记录——用户零重配。

### 4.2 mediaModelCatalog：声明式能力目录

位置：`packages/desktop/src/common/media/catalog/`。

```ts
type MediaModelSpec = {
  id: string; // 目录内唯一
  kind: MediaKind;
  form: 'A' | 'B' | 'C';
  endpointStyle?: string; // Form C 驱动名；Form A 默认 openai-images
  match: {
    // provider+model → spec 的匹配规则
    platform?: string[]; // e.g. ['gemini', 'gemini-vertex-ai']
    baseUrlIncludes?: string[]; // e.g. ['openrouter.ai']
    model: string | RegExp; // 精确名优先，正则次之
  };
  params: {
    // 参数能力声明（工具入参照此校验+裁剪）
    sizes?: string[];
    aspectRatios?: string[];
    maxN?: number;
    qualities?: string[];
    seed?: boolean;
    negativePrompt?: boolean;
    durations?: number[]; // 视频可选时长
    resolutions?: string[];
    imageToVideo?: boolean; // 支持首帧
    firstLastFrame?: boolean; // 支持首尾帧
    cameras?: string[];
  };
  defaults?: Partial<MediaGenParams>;
  polling?: { intervalMs: number; timeoutMs: number }; // Form C 必填
};
```

- **内置目录**：主流二十来个条目（dall-e-3 / gpt-image-1 / flux 系 / sd 系 / wanx 万相 / 即梦 / seedream / seedance / veo / sora / kling / cogvideox / gemini image-preview 等），随代码分发、随版本更新。
- **用户覆盖**：设置页给一个 JSON 覆盖入口（高级），merge 语义为按 `id` 覆盖/追加——网关用户（new-api 等）改个 match 就能接上任意兼容模型。
- **兜底**：目录全未命中时，才回落到现有 `IMAGE_NAME_PATTERN` + 平台规则（保持存量用户行为不回退）。
- `imageModelAllowlist.isImageGenSupported` 改为「目录能解析出 spec 即支持」；模型下拉的可选项与实际可执行从此结构性一致。

### 4.3 MediaJobService：异步任务引擎（主进程）

位置：`packages/desktop/src/process/services/mediaJob/`。

**Job 状态机**：`pending → precheck → submitted → polling → downloading → done | failed | cancelled | timeout`。

- **持久化**：userData 下 `media-jobs.json`（起步够用；单机任务量小，不引 SQLite；见 §8 Q2）。每条 job 记录：id、kind、conversationId、workspaceDir、provider 摘要（**不存 api_key**，执行时按 providerId 现查）、spec id、params、远端 task_id、状态、时间戳、结果 asset 路径、错误。
- **重启恢复**：启动时扫描非终态 job；有远端 task_id 的 Form C job 重新进入 polling（这是 Form C 相对 A/B 的独有收益——提交过的任务钱已花出去，必须捞回来）；无 task_id 的直接判 failed（幂等重提交交给用户/agent）。
- **并发**：每 provider 并发上限 2，超出排队（防触发限流封号）。
- **取消**：AbortSignal 贯穿；有远端 cancel 端点的驱动（DashScope 有）调 cancel，没有的只停轮询。
- **进度**：两路广播——① 通过 TCP 连接回推给 MCP 薄壳（薄壳转成 MCP progress notification，维持连接活性）；② IPC 广播给渲染层（会话内进度卡片，独立于 agent 存活）。

**MCP 工具的等待语义（阻塞 + 双保险）**：

1. 工具调用默认**阻塞等待完成**（图片 Form A/B 秒级~2 分钟；Form C 视频最长 catalog 的 `timeoutMs`，典型 10 分钟），期间持续发 progress。TCP socket timeout 设为任务级超时而非 60s。
2. 若 agent/CLI 侧提前砍掉工具调用（⚠️ 已知约束：MCP **启动**超时已压到 15s——那是 connect 阶段的超时，不影响单次工具调用；但 CLI 侧对单次 tool call 也可能有自己的上限），**job 照跑**：完成后照常落盘 + IPC 通知渲染层出结果卡片；agent 下一轮可用 `one_media_job_status` 工具凭 job_id 查询/取回结果。工具的即时返回里始终带 job_id，就是为这条兜底路径准备的。

### 4.4 MCP 工具面

沿用内置 MCP 分发机制。⚠️ **新增内置 MCP 脚本必须同步三处**：`asarUnpack` + `build-mcp-servers` + `builtinMcp/constants.ts`（历史坑，漏一处打包后失效）。

| 工具                      | 动作     | 说明                                                                                                                                                                                                                      |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aionui_image_generation` | **扩展** | 工具名保留（是 agent 可见 API，改名会废掉存量提示词/习惯）；schema 增 `size` / `aspect_ratio` / `n` / `quality` / `seed` / `negative_prompt`，全部 optional；描述里说明「参数支持性取决于当前模型，不支持的参数会被忽略」 |
| `one_video_generation`    | **新增** | `prompt` / `duration_seconds` / `resolution` / `aspect_ratio` / `first_frame_image` / `last_frame_image` / `camera` / `workspace_dir`；新工具按新品牌惯例用 `one_` 前缀（对齐 `one-export-pdf` / `one-team-knowledge`）   |
| `one_media_job_status`    | **新增** | 按 job_id 查状态/进度/结果路径；也支持列出当前会话未完成 job                                                                                                                                                              |

参数校验在**主进程**按 catalog spec 做（不在薄壳做）：不支持的参数**裁剪并在返回文本中注明**，而不是报错——避免 agent 在参数上反复试错盲搜（deferred-schema 盲搜的教训：给 agent 的失败信号要可收敛）。

**imageGenServer.ts 薄壳化**：保留工具注册与 schema，`executeImageGeneration` 调用替换为 TCP 转发；`AIONUI_IMG_*` env 读取逻辑保留一个版本作为降级兼容（主进程 TCP 端口缺失时报清晰错误，不静默回落——静默回落到旧行为正是要根除的模式）。

### 4.5 配置与会话级模型选择

- `ClientBusinessSettingMap` 增 `'tools.videoGenerationModel'`（形状同 `ImageGenerationModelSetting`）；设置页 Tools 区图片/视频模型分开选。
- 模型下拉的候选 = 遍历 providers × models 中 catalog 能解析出对应 kind spec 的组合（替代现在的 allowlist 硬规则）。
- **会话级覆盖**：聊天输入框「+」菜单加「图片模型 / 视频模型」选择器（复用专家选择器的交互模式与单排 chip 布局先例）；会话覆盖存会话侧配置，主进程执行时优先级：会话覆盖 > 全局设置。
- env 下发瘦身：`AIONUI_IMG_*` 五个变量退役为兼容层，薄壳只需 `AIONUI_MEDIA_MCP_PORT` 一个变量（对齐 `TEAM_KNOWLEDGE_MCP_PORT` 模式）。

### 4.6 呈现层

- **常量**：`constants.ts` 增 `VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v']`、对应 MIME map 条目；媒体判定 util 增 `isVideoFile`。
- **进度卡片**：渲染层监听 media-job IPC 事件，会话内展示「生成中（阶段/百分比/耗时）+ 取消按钮」，完成后原位变结果卡片——这条链路**不依赖 agent 存活**，是工具调用被砍后的用户可见兜底。
- **结果展示**：多图画廊（缩略图网格 + 点开大图）、视频 `<video>` 播放器 + 封面帧（下载完成时用 ffmpeg 不可依赖——桌面端无内置 ffmpeg，封面帧取「视频元素首帧截图」由渲染层实现，主进程不做转码）。
- **文本兼容**：工具返回文本仍带 `Generated image saved to: <path>` 行（存量渲染逻辑与 agent 引用习惯不破坏），新增结构化展示是叠加不是替换。
- **附件**：上传入口认视频（供图生视频首帧/参考）；大小上限单独设（视频 ≫ 图片）。
- **agent 边界**：aionrs 纯文本架构 + `view_image` 只认图片——视频结果对 agent 只呈现为「路径 + 元数据文本」，工具描述中明确告知 agent 不要尝试读取视频内容。

### 4.7 企业管控（阶段五，跨仓 1oneCore）

**现状缺口**：SendGate 只注入 chat send_msg 路径；MCP 媒体生成完全绕过成本上限与模型 allowlist，而媒体恰是最贵的调用。

- `MediaJobService` 在 `precheck` 态调 1oneCore 新端点 `POST /api/one/billing/media-precheck`（入参：model/kind/预估参数；出参：allow/deny+原因），完成后上报实际用量（张数/时长/模型）计入既有 usage 体系。
- 模型 allowlist 复用 P1-2 的 allowlist 数据，enforcement 点加在 precheck。
- **个人版红线**（锁死测试）：无企业会话/客户端未连远端时，precheck 整段跳过、零网络请求、行为与阶段四完全一致。
- 客户端模式：precheck 打远端 server（注意 `getLocalBaseUrl`/`getBaseUrl` 之辨的历史坑——precheck 属企业语义，走远端；落盘/进度属本地语义，走本地）。

---

## 5. 核心数据流（Form C 视频为例）

```
agent 调 one_video_generation(prompt, duration=5, first_frame_image=...)
  → MCP 薄壳 TCP → 主进程 MediaJobService
    → 建 job(pending) 落盘 → [企业 precheck]
    → catalog 解析 spec(seedance, form C, ark-task) → 校验/裁剪参数
    → TaskPollAdapter.submit → 拿 task_id → job(submitted) 落盘   ← 此后重启可恢复
    → poll 循环（进度两路广播：MCP progress + 渲染层 IPC 进度卡片）
    → succeeded → 下载视频 → workspace 落盘 → job(done)
  ← TCP 回包 { job_id, assets:[{filePath,...}], text }（只有路径，无字节）
  ← 薄壳组装 MCP 工具结果文本（含路径 + job_id）
渲染层进度卡片原位变为视频播放器卡片
（若 agent 侧早已超时：卡片照常出现；agent 下轮 one_media_job_status(job_id) 取回）
```

---

## 6. 实施路线图

推荐节奏：**图片优先起步，第二阶段就把 Form C 引擎建起来**——Form A 收益立刻兑现，Form C 是唯一绕不过的地基（做完后视频的图片异步部分白送）。

### 阶段一：Form A + 多图 + 目录雏形（收益最快，改动最小）

| 改动                                                                                                  | 文件                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 新建适配器接口 + `OpenAiImagesAdapter`；`imageGenCore` 挪为 `ChatMultimodalAdapter`，修多图只取第一张 | `common/media/`（新）、`common/chat/imageGenCore.ts`                   |
| catalog 雏形（仅图片条目）+ allowlist 改目录查询（正则兜底保底不回退）                                | `common/media/catalog/`（新）、`common/utils/imageModelAllowlist.ts`   |
| 工具 schema 扩参（size/n/quality/seed/negative_prompt），按 spec 裁剪                                 | `process/resources/builtinMcp/imageGenServer.ts`                       |
| 设置页模型下拉候选改目录驱动                                                                          | `renderer/.../ToolsModalContent.tsx`、`useConfigModelListWithImage.ts` |

验收：DALL·E 3 / gpt-image-1 / SiliconFlow Flux 真机出图；gemini 存量链路无回归；`n=4` 四张全落盘。
（此阶段执行仍可在 MCP 子进程内，Form A/B 都是同步请求——薄壳化推迟到阶段二和 job 引擎一起做，避免两次动 imageGenServer。）

### 阶段二：MediaJobService + 薄壳化 + Form C 图片（地基）

| 改动                                                                                                  | 文件                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `MediaJobService`（状态机/持久化/恢复/并发/进度）+ 主进程 TCP server                                  | `process/services/mediaJob/`（新，照 `teamKnowledgeMcpServer` 套路）                       |
| `imageGenServer.ts` 薄壳化（TCP 转发，env 链路降级为兼容）                                            | `process/resources/builtinMcp/imageGenServer.ts`、`common/config/imageGenerationMcpEnv.ts` |
| `TaskPollAdapter` + `dashscope-task` / `ark-task` 两个驱动（万相 / 即梦图片先行，凭据复用已注册平台） | `common/media/adapters/`                                                                   |
| `one_media_job_status` 工具                                                                           | `builtinMcp/` + 三件套接线                                                                 |
| 渲染层进度卡片（IPC 订阅）                                                                            | `renderer/` 消息区组件                                                                     |

验收：万相文生图真机通；kill 应用重启后未完成 job 恢复轮询并最终落盘；工具调用中途取消不留僵尸轮询。

### 阶段三：视频端到端

| 改动                                                                                   | 文件                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `one_video_generation` 工具（三件套接线）                                              | `builtinMcp/videoGenServer.ts`（新）或并入统一 mediaGenServer |
| catalog 增视频条目（seedance/wanx-video 先行，随后 veo/sora/kling）                    | `common/media/catalog/`                                       |
| `VIDEO_EXTENSIONS` / MIME / `isVideoFile`；视频结果卡片（player + 封面帧）；附件认视频 | `common/config/constants.ts`、渲染层                          |
| `tools.videoGenerationModel` 设置 + 设置页                                             | `common/config/clientSettings.ts`、设置页                     |

验收：文生视频、图生视频（首帧）真机通；会话里可播放；重启恢复对视频同样成立。

### 阶段四：参数面与配置 UX 补完

会话级模型覆盖（「+」菜单）、aspect_ratio/duration 全参数打通、用户 catalog 覆盖入口、多图画廊交互（大图/下载）。

### 阶段五：企业管控（跨仓）

1oneCore `media-precheck` + 用量上报端点；1oneUI precheck 接线；个人版红线锁死测试。

---

## 7. 风险与既知坑（多为本仓踩过的真坑）

| 风险                                                                              | 对策                                                                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **大 base64 过 TCP**（2026-04-14 commit charge 事故，`imageGenCore.ts` 注释在案） | D6 铁律：所有通道只传路径；Form B 抠出的 base64 在主进程立即落盘                                                                 |
| **MCP 15s 启动超时**（团队唤醒优化时压下来的）                                    | 薄壳启动毫秒级不受影响；长的是工具调用阶段，与 connect 超时无关；仍按 §4.3 双保险设计，不假设连接活到任务结束                    |
| **CLI 侧单次 tool call 超时不可控**（Claude Code / Codex 各自行为不同）           | job 独立存活 + `one_media_job_status` 补取 + 渲染层进度卡片兜底，三层里任何一层活着用户都能拿到结果                              |
| **新内置 MCP 打包后失效**                                                         | 三件套铁律：`asarUnpack` + `build-mcp-servers` + `constants.ts` 同步改，阶段二/三各自过一遍                                      |
| **轮询风暴 / 无退避重试**（WebUI focus 重试风暴的同类教训）                       | 轮询指数退避 + catalog 上限 + 每 provider 并发 2 + 终态后立即停                                                                  |
| **静默回落到旧行为**（`out/renderer` 陈旧产物教训）                               | 薄壳找不到 TCP 端口时报清晰错误，不静默走旧 env 链路                                                                             |
| **主进程 console 死锁**                                                           | `MediaJobService` 日志走既有异步日志通道，禁 `console.*`                                                                         |
| **企业绕闸窗口期**                                                                | 阶段一~四期间缺口依旧存在（现状如此，不新增缺口）；阶段五收口；如商业化提速可把 precheck 提前到阶段二一起做                      |
| **国产平台协议漂移**（火山/阿里改版快）                                           | 驱动层薄（只描述协议差异），catalog 数据可随小版本更新；连接测试入口对 Form C 做一次干跑（submit dry-run 或 list-tasks）验证凭据 |

---

## 8. 开放问题（待拍板）

1. **图片优先 vs 视频优先**：本文按「图片起步、阶段二建 Form C 地基」排（另一会话已给出同样建议）。若商业演示急需视频，可将阶段三提前与阶段二并行（阶段二本就为视频铺路）。
2. **job 持久化形式**：起步 `media-jobs.json`（userData）。若后续要做 job 中心页/历史检索再升 SQLite——⚠️ 注意本机 SQLite 曾有 WAL 损坏史（已切 DELETE journal），新库如引入需沿用同配置。
3. **企业 precheck 端点形状**：`media-precheck` 放 one-billing 还是复用 SendGate 的 check 逻辑抽公共函数？涉及 1oneCore 侧设计，阶段五前需单独对齐。
4. **媒体消息要不要成为 aioncore 会话 schema 的一等公民**：本设计刻意回避（文本路径 + 渲染层识别叠加展示），代价是历史会话跨端同步时富展示依赖渲染层重解析。若未来 WebUI/移动端要求一致富展示，再评估动消息 schema。
5. **统一 mediaGenServer vs 独立 videoGenServer**：一个 stdio 进程注册三个工具（省进程、Defender 扫描少一次）vs 两个进程（隔离、但多一份启动开销）。倾向**统一进 mediaGenServer**（imageGenServer 更名迁移，保留旧 js 文件名兼容既有 transport 识别），实现期定。

---

## 9. 与既有约定的关系

- **命名/品牌**:新增用户可见文案全走 i18n;新工具/常量用 `one_` / `BUILTIN_MEDIA_*` 前缀;`aionui_image_generation` 工具名与 `AIONUI_IMG_*` env 作为对外 API 保留不改。
- **验证成本与改动匹配**:阶段一是机械性适配器（编译器兜底 + 单测 + 一次真机出图即可）;阶段二/三是地基工程,按「做透」标准全场景验证（恢复/取消/超时/并发）。
- **文档**:每阶段落地后按惯例补 session 文档并回链本设计;本设计文档随实现演进保持更新。
