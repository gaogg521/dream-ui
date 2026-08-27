# 多媒体生成（图片 / 视频）进展跟踪

> 本文档是多媒体生成工作的**唯一进展归一文档**，供任何接续的 AI/开发者快速上手。
> **接续者先读**：[`handoff-2026-08-06.zh-CN.md`](handoff-2026-08-06.zh-CN.md)（当天交接：被推翻的结论、未决项、验证坑）。
> 架构设计（必读，含现状锚点/决策/风险）：[`architecture.zh-CN.md`](architecture.zh-CN.md)
> 更新纪律：每个阶段有实质进展或决策变更时**必须**同步更新本文档。

## 当前状态一览

| 阶段   | 内容                                                                                                                                                                                                                        | 状态                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 阶段一 | Form A 同步适配器 + 多图全收 + 能力目录雏形 + 工具扩参 + 设置页目录驱动                                                                                                                                                     | ✅ 代码完成，静态验证全绿（2026-08-05）；**仅剩真机出图验收 + 未提交未打包**                  |
| 阶段二 | MediaJobService 异步任务引擎 + MCP 薄壳化（TCP）+ Form C 图片（万相/即梦）                                                                                                                                                  | ✅ 代码完成，静态+端到端验证全绿（2026-08-05）；**未打包，未接真实 key**                      |
| 阶段三 | 视频端到端——工具与引擎在阶段二已落地；**08-05 晚补视频模型设置项**、**08-06 补媒体呈现层（`one-media://` 流式协议 + 播放器 + 多图画廊，真机播放已验证）**；剩**会话内进度卡片**（需 IPC 广播）与视频真机出片（卡 key 权限） | 🔶 大部分完成                                                                                 |
| 阶段四 | 参数面 + **模型类型标签（替代白名单）** + catalog 覆盖 + **发送框媒体模式**                                                                                                                                                 | ✅ 完成（2026-08-06）；**08-07 补完选择器标签，并修好一个让整套「用户声明」存不住的后端缺陷** |
| 阶段五 | 企业管控闭环（跨仓 1oneCore：media-precheck + 用量上报）                                                                                                                                                                    | ✅ 完成（2026-08-06），真机验证个人版红线与两个端点均命中                                     |

## 关键决策记录（增量，全量见架构文档 §3）

- **2026-08-05 用户拍板**：按「图片优先起步、阶段二建 Form C 地基」路线开工；**底层类型一次做全**（视频参数、Form C 形状、轮询配置从第一天就进接口，后续阶段只加实现不改形状）——这是用户明确要求的兼容性优先原则。
- 工具名 `aionui_image_generation` 与 `AIONUI_IMG_*` env 是对外 API，保留不改；新增工具/常量用 `one_` / `BUILTIN_MEDIA_*` 前缀。
- 媒体字节永不过 TCP/MCP 通道，只传文件路径（2026-04-14 base64 事故铁律）。

## 阶段一工作清单

- [x] `common/media/` 底层类型层（MediaKind/MediaGenParams/MediaAsset/适配器接口，含视频与 Form C 完整形状）——`types.ts` + `mediaAssets.ts`（fs 工具，含视频 MIME/下载；`constants.ts` 已加 `VIDEO_EXTENSIONS`/视频 MIME 映射）
- [x] `common/media/catalog/`：`MediaModelSpec` schema + 内置图片条目（3 条 Form B 存量规则 + gpt-image-1/dall-e-2/3/seedream/flux/sd/cogview Form A + wanx/即梦 Form C 数据就绪但被 `EXECUTABLE_FORMS` 闸门挡住）+ 视频条目（seedance/wanx-video/kling/sora/cogvideox，阶段三启用）+ `resolveMediaModelSpec()`/`clipParamsToSpec()`
- [x] `OpenAiImagesAdapter`（Form A：generations + edits，b64/url 双响应，兼容网关 `images:[{url}]` 变体；`OpenAIRotatingClient` 补了 `createImageEdit`）
- [x] Form B 迁移为 `ChatMultimodalAdapter`，修多图只取 `images[0]`（全量落盘）；**`common/chat/imageGenCore.ts` 已删除**（唯一消费方是 imageGenServer，已重指）
- [x] `imageModelAllowlist` 改目录查询（存量三条规则作为目录 Form B 条目原样保留，行为不回退）
- [x] `imageGenServer.ts` 工具 schema 扩参（size/aspect_ratio/n/quality/seed/negative_prompt，不支持的参数裁剪并在返回文本注明"勿重试"）+ 走 `executeMediaGeneration` 按 form 分发（无目录命中 → 回落 Form B 保持旧行为）；env 新增 `AIONUI_IMG_PROVIDER_NAME`（antigravity 条目运行时按名匹配需要）
- [x] 设置页：下拉候选随 allowlist 自动目录驱动；tooltip 补 images API 条目 + 修正过时的"暂不支持"文案（13 语言全改，`i18n-keys.d.ts` 已按序插 key）
- [x] 单测：新增 `tests/unit/media/catalogResolve.test.ts`（存量行为锁死 + Form A 覆盖 + Form C 闸门 + 参数裁剪）、`tests/unit/media/openaiImagesAdapter.test.ts`（b64/url/网关变体/空响应）；更新三个既有测试（见下「验证结果」）
- [x] tsc（exit 0）/ lint（0 error，861 warnings 为项目既有）/ check-i18n（通过，`i18n:types` 报已同步）/ 相关单测 38 绿 / **全量 2947 绿**
- [x] **打包冒烟 + 端到端路由实测**（见下「功能验证」）：`node scripts/build-mcp-servers.js` 通过，启动打包后的 stdio 进程验证工具 schema 带全新参数，并用本地假 OpenAI 服务器坐实路由与多图落盘
- [ ] 真实 provider 出图验收（真 key 打 DALL·E 3 / SiliconFlow Flux + gemini 存量链路无回归）——**唯一未做项**，需 dev 重编或打包后在真机验

## 阶段一验证结果（2026-08-05）

**全量测试 2947 passed / 2 failed**。两个失败是 `tests/unit/previews/` 的 `OfficeWatchViewer` 与 `usePreviewHistory` 冷加载超时，**与本轮无关的既有 flake**：测试文件自己的注释就写着"全量并行负载下会 flake，单独跑很快"，单独跑两个文件 17 条全绿实证。

**三个既有测试因本轮行为变更而更新（全部是刻意变更，不是就地改绿）**：

1. `tests/unit/common/imageModelAllowlist.test.ts` —— 原断言 `gpt-image-1`/`dall-e-3` 必须返回 false，这**正是本轮要消灭的限制**，改为断言"OpenAI 兼容 provider 上的 images API 模型现在受支持"，并补三条守住原意图的新断言（原生协议主机 / 非 OpenAI 协议平台 / 无适配器的异步 form 仍然 false）。
2. `tests/unit/common/imageGenerationMcpEnv.test.ts` —— 期望 env 补 `AIONUI_IMG_PROVIDER_NAME`。
3. `tests/unit/bootstrap/runBackendMigrations.test.ts` —— `imageEnv` fixture 补同一个键。⚠️ 该测试锁的是"无实质变化就不要重复 sync MCP server"，新增 env 键会让**存量用户升级后首次启动多做一次 sync**（把 provider name 写进去）——这是必要且**收敛**的（写完之后前后一致，不会每次启动都 sync），非缺陷。

**功能验证（不止静态检查，实际把打包产物跑起来了）**：

1. `node scripts/build-mcp-servers.js` exit 0，`out/main/builtin-mcp-image-gen.js` 重新生成（2.7MB，含新 Form A 代码）——**这一步很关键**，内置 MCP 是 esbuild 单独打包的，改 import 图有可能只在 bundle 阶段炸。
2. 启动打包后的 stdio 进程走真实 MCP 协议（initialize → tools/list）：工具名仍是 `aionui_image_generation`，参数为 `aspect_ratio,image_uris,n,negative_prompt,prompt,quality,seed,size,workspace_dir` 九个，新参数全在。
3. **路由实测**（本地假 OpenAI 服务器记录被打的端点）：配 `dall-e-3` 调用 → 只打了 `/v1/images/generations`、**从未碰 chat/completions**（证明 Form A 分发真的生效而不是回落 Form B），请求体 `{model:'dall-e-3',prompt,n:1,size:'1024x1024',quality:'standard'}`（默认值正确合并），返回文本含"参数 n 不受支持已忽略，勿重试"。
4. **多图修复实测**：换 `gpt-image-1`（maxN=4）传 `n=3` → 假服务器回 3 张 → 磁盘上落了 3 个不同文件（`img-<ts>.png` / `img-<ts>-2.png` / `img-<ts>-3.png`），工具文本三条路径全列。**旧代码这里只会存第 1 张。**

**过程中揪出并修掉一个我自己写出的真缺陷**（不是测试过时）：`sd3.5-large` 配在 `api.stability.ai` 上被判定为受支持，但 Stability 原生 API 走 `/v2beta/stable-image` multipart、不是 OpenAI images 协议，选了必然运行时失败——**正是设计文档要根除的"可选≠可用"漂移，只是方向反了过来**。根因是仅按模型名匹配的 Form A 条目无法区分"同一个模型由兼容网关提供"还是"由厂商原生 API 提供"（`stable-diffusion-3-5-large` 两边都有，判据是主机不是模型名）。修法=`resolve.ts` 加 `NATIVE_PROTOCOL_HOST_MARKERS`（stability / replicate / fal / bfl / leonardo / midjourney），**只压制按模型名匹配的条目，provider 钉死的条目照旧优先**；将来这些主机有了原生驱动就升级为带 `endpointStyle` 的正式条目，不是永久拒绝。

## 交接要点（接续者先读）

1. **先读架构文档**再动代码，尤其 §3 六条决策与 §7 风险坑表（全是本仓踩过的真坑）。
2. 阶段一执行仍在 MCP 子进程内（Form A/B 都是同步请求）；**薄壳化刻意推迟到阶段二**与 job 引擎一起做，避免两次动 `imageGenServer.ts`。
3. 阶段二/三新增内置 MCP 脚本时，**三件套必须同步**：`asarUnpack` + `build-mcp-servers` + `builtinMcp/constants.ts`，漏一处打包后失效。
4. 验证跑 `bunx tsc --noEmit` + 相关单测即可；真机验证方法见 `docs/guides/cdp.md`。
5. 改主进程/内置 MCP 代码后需重编才生效，见 `docs/guides/ai-handoff-conventions.zh-CN.md`。

## 真机联调记录（2026-08-05，内部 LiteLLM 网关）

环境：provider 走 `https://litellm-internal.123u.com/`（**base_url 不带 `/v1`**），非直连厂商。

**修掉两个会让图片生成必挂的真问题**（commit `f8bf5d6bb`）：

1. **网关缺版本前缀**：base_url 不带 `/v1` 时，聊天可用而图片必挂——网关前置代理放行 `/chat/completions` 却不放行 `/images/generations`，用户看到的是不解释原因的 **405**。实测 `/images/generations` → nginx 405，`/v1/images/generations` → 正常出图。已在图片调用前统一补版本段（已带版本段与 Azure 部署式地址原样保留）。
2. **`gpt-image` 系列匹配过窄**：目录只写 `gpt-image-1`，网关上的 `gpt-image-2`/`gpt-image-2-joymaker` 解析不到条目 → **静默回落聊天多模态路径**，请求打到 `/chat/completions` 并以「模型不存在」告终。已改为匹配整个系列，并去掉 size/quality 默认值（网关变体会拒绝官方模型接受的取值）。

**验证**：用真实网关与真实密钥直接驱动适配器，`gpt-image-2` 成功产出并落盘 **2.2MB PNG**。

**引擎侧全链路已被真实基础设施验证**：job 创建 → 落盘 → provider 解析 → 目录分发 → 执行 → 真实 HTTP 错误捕获 → 错误持久化 → `status` 查询，全部按设计工作（首个失败 job 的 405 就是这条链路完整跑通后如实报出来的）。

**驱动线格式已被用户的独立测试台证实**（此前标注"未验证"的部分）：

- 图片：响应 `{model, created, data:[{url, size}], usage}` —— 正是 Form A 适配器处理的形状（`data[].url` → 下载落盘）。
- 视频（Ark）：提交返回 `{"id":"cgt-…"}`、轮询返回 `{id, model, status:"running"|"succeeded", content:{video_url, last_frame_url}, …}` —— **与 `arkDriver` 的解析逐字段吻合**（`payload.id` / `status` 小写分支 / `content.video_url`）。

**环境侧结论（非代码问题）**：

- `doubao-seedream-5-0-pro`（无日期后缀）在该网关上不存在；真实可用 id 是 `doubao-seedream-5-0-pro-260628`，且需要用户测试台那把 key（`sk-e9…`，"测试环境"档），当前应用配的 key 打它仍报 model_not_found。
- 视频同理：该网关用当前 key 打 `/v1/videos` 与 `/v1/contents/generations/tasks` 都是 **200 但空 body**（volcclb 直通），拿不到 task id；用户测试台用另一把 key 能正常拿到 `cgt-…`。**视频要在应用里跑通，需要配一个对视频有权限的 key。**

⚠️ **`bun run dev` 不会自动重建主进程 bundle**：实测 `out/main/index.js` 停留在启动时刻，改完主进程/common 代码后必须重启 dev 才生效（本轮就因此测到旧代码，绕了一圈才由抓包定位）。

## 阶段二（异步任务引擎 + Form C）

**做完了什么**

- **`process/services/mediaJob/`**：`jobManager.ts` 状态机（pending→submitted→polling→downloading→终态）、`store.ts` 原子写入的 JSON 持久化（临时文件+rename，写入串行化）、`index.ts` 主进程 TCP 服务 + 引擎组装。IO 全部注入，状态机不依赖后端/网络/磁盘即可测。
- **重启恢复**：只有**已拿到远端 task_id** 的 job 才恢复轮询（那笔钱已经花了）；提交前就中断的直接判失败并提示重跑——**绝不静默重新提交，重复扣费比明确报错更糟**。
- **`TaskPollAdapter` + 驱动层**：轮询骨架（指数退避、超时后尽力远端取消、连续 5 次瞬时错误才放弃、resume 不重复提交）共享；`dashscopeDriver`（万相，`X-DashScope-Async` + `/api/v1/tasks/{id}`，size 转 `1024*1024` 写法）与 `arkDriver`（Seedance/即梦，`contents/generations/tasks`，参数以 `--resolution/--dur` 后缀编码进 prompt）只描述协议差异。**凭据复用用户已配的 chat provider，换 path 不换渠道。**
- **MCP 薄壳化**：`imageGenServer.ts` 只剩工具面，全部调用经 TCP 转给主进程（4 字节长度头+JSON，可先发多个 progress 帧再发 result）。**脚本名与服务名刻意不改**，避免破坏既有安装的 transport 识别。三个工具：`aionui_image_generation` / `one_video_generation` / `one_media_job_status`。
- **顺带消除凭据下发**：`buildEnv` 不再写 `AIONUI_IMG_API_KEY`——生成已搬进主进程，子进程没有调用 provider 的理由，给它 key 就是纯暴露。主进程每次执行时按 providerId 现查（顺带让轮换过的 key 对恢复的 job 也生效）。
- 闸门 `EXECUTABLE_FORMS` 加入 `'C'`。

**验证（不止静态检查）**

- tsc 0 / lint 0 error / check-i18n 通过 / **全量测试 2976 绿、0 失败**。
- 新增单测：`mediaJobManager.test.ts` 10 条（完成、provider 消失、超时映射、task_id 立即持久化、并发上限、运行中取消、排队中取消、三种恢复语义）、`taskPollAdapter.test.ts` 7 条（提交→轮询→下载、DashScope size 写法与异步头、远端失败带原文、resume 不重复提交、超时、abort、瞬时错误重试）。
- **端到端集成测试** `mediaMcpServer.integration.test.ts`：起真实 TCP 服务、用真实帧协议的客户端、假 DashScope，跑通提交→轮询→下载→落盘，并断言 **`sk-secret` 既不出现在返回帧里也不出现在 job 文件里**。
- **打包冒烟**：重新构建 bundle 后启动真实 stdio 进程，三个工具全部注册；**不给 `MEDIA_MCP_PORT` 时按设计返回明确错误而不是静默回落旧路径**。

**过程中修掉的两个真缺陷（都是我自己引入的）**

1. **kling / sora / cogvideox 会被当成"支持"**：闸门一开，这些只有目录条目、没有驱动的 endpointStyle 就会进下拉框，调用时才失败——又一次"可选≠可用"漂移。修法=新增 `IMPLEMENTED_ENDPOINT_STYLES` 并让 `isMediaGenSupported` 对 form C 额外校验驱动存在；`taskDrivers` 导出 `REGISTERED_DRIVER_IDS`，**加了一条测试断言两份清单必须一致**，以后加驱动漏改目录会直接挂 CI。
2. **过期端口**：媒体 TCP 服务每次启动取第一个空闲端口，而 bootstrap 的更新路径是从**旧 env** 里搬 `MEDIA_MCP_PORT`，等于把上次的端口一直留着（薄壳会连到没人监听的端口）。同时创建路径和更新路径各写了一套 env 合并逻辑。修法=抽出 `buildImageServerEnv` 两路共用、端口永远取本次启动的值，并补了回归测试。

**已知边界（诚实说明）**

- DashScope / Ark 两个驱动的**线格式是按我对这两家 API 的了解写的，只用假服务器验证过骨架，没有用真 key 打过真实端点**。字段名或请求体若有出入，需要真机联调修正——这是接续者接手时最该先做的事。解析写得比较宽容（未知状态当作 running，由超时兜底）。
  **已确认的部分**：用无效 key 打真实端点，两家都返回 **401 鉴权错误而不是 404**，说明**提交路径正确、请求已走到鉴权环节**（DashScope `/api/v1/services/aigc/text2image/image-synthesis`、Ark `/api/v3/contents/generations/tasks`）。仍待真 key 验证的是**请求体字段名**与**轮询响应的解析**。
  验证工具：`bunx tsx scripts/probe-media-driver.ts --driver dashscope-task --key <真key> --model wanx2.1-t2i-turbo`，它直接驱动真实驱动代码打真实端点并逐步打印，提交或轮询任一环节的字段不符会立刻显形。⚠️ 每次运行都会产生真实计费任务。
- 渲染层还没有任何媒体 UI：视频只会以路径形式出现在文本里，没有播放器、没有进度卡片、没有多图画廊，附件上传也还不认视频。这些是阶段三剩下的部分。
- 企业成本管控仍未接（阶段五），媒体生成目前依然绕过 SendGate。

## 阶段三前半段：视频模型设置项 + 两个真机暴露的缺陷（2026-08-05 晚）

**起点核实**：接手时先核实"阶段三剩什么"，发现一个比渲染层更靠前的硬缺口——`tools.videoGenerationModel` **只有读没有写**。引擎 `mediaJob/index.ts:45` 按它取模型，但全仓没有任何地方写入它（设置页只有图片模型下拉）。也就是说**即便配上有视频权限的 key，`one_video_generation` 也必然返回「未配置视频模型」**——视频在设置层面就是死的。

**做完了什么**

- **设置页新增「视频生成」卡片**（`ToolsModalContent.tsx`）：候选走 `isMediaGenSupported('video', ...)` 目录查询，与图片下拉同构。**刻意不给它独立开关**——三个工具同属一个内置 MCP server，开关只有一个（在图片卡片上），tooltip 里说明共用。
- **视频不需要 MCP env 同步**：图片那套 `AIONUI_IMG_*` env 是对外契约所以保留，而视频是阶段二之后才有的路径，引擎在执行时直接从 client settings 读 —— **写设置就是全部接线**，没有第二处要同步。
- 新增 6 个 i18n key × 13 语言；顺带**修掉一句已经说反的文案**：`imageGenUnsupportedTooltip` 还写着"通义万相、即梦将在后续版本支持"，但阶段二打通 Form C 之后这两个已经可用了（`dashscope-wanx-image` / `ark-jimeng-image` 都有驱动）。

**修掉两个真缺陷（都是真机打出来的，不是静态审出来的）**

1. **`arkDriver` 在兼容网关上缺版本段——与图片那个 405 完全同类，只是上一轮没查到这个文件。** `apiRoot()` 只 trim 尾斜杠，对 `https://litellm-internal.123u.com/` 这种网关型 base_url 会打到 `/contents/generations/tasks`。**真实网关实测（用无效 token，代理按路径拒绝发生在鉴权之前，零计费）**：`/contents/generations/tasks` → **nginx 405**，`/v1/contents/generations/tasks` → **200**。由于 ark-task 是**唯一驱动视频的驱动**，这意味着通过该网关视频生成此前 100% 必挂。修法=把 `ensureVersionedImagesBaseUrl` 提成共享的 `adapters/baseUrl.ts::ensureVersionedBaseUrl` 并用于 ark（Ark 原生根 `.../api/v3` 已带版本段，对它是 no-op，有测试钉死）。
2. **`readJsonOrThrow` 对 2xx 空 body 抛裸 `SyntaxError`。** 网关把 key 无权限的请求透传成 **200 + 空 body**（用户当前那把 key 必然撞上），`response.json()` 于是抛出 `Unexpected end of JSON input`——既不点名端点也不说原因，和刚修的 405 是同一种死胡同报错。改为空 body 与非 JSON body 各给一条点名端点+状态码+最可能原因的错误。

**真机 CDP 验证（dev 重启加载新 bundle 后）**

- 设置页：`视频模型` 下拉真实候选 = 用户网关上的 `seedance-2-0-fast` / `seedance-2-0-pro` / `doubao-seedance-2-0-260128` 三条；**kling / sora / cogvideox 一条都没出现**（无驱动，`IMPLEMENTED_ENDPOINT_STYLES` 闸门按设计工作）。选中后**整页 reload 仍在**，坐实落盘。
- 直接用真实帧协议驱动主进程里运行的媒体 TCP 服务（19860）发视频 job：链路走到 `model: seedance-2-0-fast`（证明新设置真的被引擎读到），**错误从 `HTTP 405` 变成 200 空 body 的可读提示**——两个修复各自生效的判据。
- **图片回归**：同一服务发图片 job，`gpt-image-2` 真实出图 **926KB PNG / 1254×1254** 落盘，`success: true`。
- 单测：`tests/unit/media` **56 绿**（新增 `baseUrl.test.ts` 6 条 + ark 端点派生 3 条）；`tests/unit/settings` 154 绿。⚠️ 顺带更新了一条既有 DOM 测试：`goToModelSettings` 空状态提示现在图片/视频各一处，`findByText` 撞多个，改为 `findAllByText` 并逐个断言是 BUTTON 且都能跳转（意图未变，只是不再唯一）。

**⚠️ 又一次踩中同一个坑并留下判据**：`bun run dev` 不重建主进程 bundle。本轮第一次真机跑，ark 修复（改于 dev 启动前）生效而 `readJsonOrThrow` 修复（改于 dev 启动后）没生效——**同一次运行里一个修复在、一个不在**，正好成了这个坑最干净的证据。改主进程/common 代码后必须重启 dev。

## 阶段三后半段：媒体呈现层（2026-08-06）

**先撞上一个设计文档没料到的硬约束**：§4.6 假定视频用 `<video>` 直接播，但**渲染层根本拿不到本地文件**——真机实测 origin 是 `http://localhost:5173`，webSecurity 开着，`file://` 无论 `<img src>` 还是 `fetch()` 都失败。图片能显示是因为走 `/api/fs/image-base64` 转 base64（1MB 的 PNG 尚可），而视频几十 MB，走 IPC 正是 **D6 铁律**要根除的。后端也没有任何文件流式端点（`ipcBridge.fs.*` 全是 JSON/base64），加一个要动 1oneCore。

**解法=主进程注册 `one-media://` 流式协议**（`process/services/mediaProtocol.ts`），字节从磁盘直接流给媒体元素，**不经过 IPC/TCP 帧，D6 不破**；支持 `Range`（这是 `<video>` 能拖进度条的前提）。

- 注册分两步：`registerMediaProtocolScheme()` 必须在 app ready **之前**（Electron 硬性要求，故放在 `index.ts` 模块级），`installMediaProtocolHandler()` 在 ready 之后。
- **安全边界=扩展名白名单**（图片+视频），挡住被攻陷的渲染层通过这条通道读源码/配置/凭据。**刻意不做"限制在工作区目录内"**——生成的媒体落在 agent 拿到的任意工作区，没有中央登记表可校验。
- URL 形状 `one-media://local/?path=<encoded>`：路径走 query 而不是 URL path，否则 Windows 盘符会被解析成 host。

**做完了什么**

- `common/media/mediaResultText.ts`：从工具结果里解析 `Generated <kind> saved to: <path>` 行。**渲染刻意不依赖结构化消息字段**——媒体按设计（§8 Q4）从未进 aioncore 消息 schema，那行文本是既有的 agent 面契约，正好当锚点；扩展名优先于声明的 kind（决定怎么渲染的是扩展名）。
- `LocalVideoView`（走协议播放，失败有兜底文案）+ `GeneratedMediaView`（单图全宽 / 多图两列网格 + Arco PreviewGroup，视频内联播放器）。
- **接进两个渲染点**：`MessageToolGroup.ToolResultDisplay`（aionrs/通用工具结果）与 `MessageAcpToolCall`（Claude Code / Codex）。ACP 那处会**排除 `getAcpImagePath` 已渲染的那张**，避免 Codex 自有图片链路重复出图。原文本一律保留（agent 与既有提示词读它），媒体是叠加不是替换。
- 新增 1 个 i18n key × 13 语言。

⚠️ **顺带修掉一个既有 flake**：`mediaMcpServer.integration.test.ts` 的 `afterAll` 删临时目录报 `ENOTEMPTY`——4 条测试全过但套件判失败，全量跑必污染结果。`force` 挡不住这个（Windows 上 job store 最后一次原子 rename 还在落地就被 rmdir 撞上），加 `maxRetries` 后连跑 3 次全绿。

**真机 CDP 验证（重启 dev 加载新 bundle 后）**

| 探测                    | 结果                                             |
| ----------------------- | ------------------------------------------------ |
| 整段拉流                | 200 / `video/mp4` / 426617 字节                  |
| Range 请求              | **206** / `bytes 0-1023/426617` ← 拖进度条的前提 |
| 图片                    | 200 / `image/png` / 926722 字节                  |
| `package.json`          | **403** ← 安全边界生效                           |
| 不存在的文件            | 404                                              |
| **真实 `<video>` 播放** | **metadata-ok 4s 1920×1200** ← 此前结构上不可能  |

单测：`tests/unit/media` **79 绿**（新增 `mediaResultText` 9 条含 URL 往返、`mediaProtocol` 11 条含 range 解析/403/404、`GeneratedMediaView.dom` 4 条锁死多图与"绝不用 file://"）。全量 **3010 绿 / 0 测试失败**；tsc 0 / lint 0 error / i18n 通过。

## 接入面扩容：视频驱动 2 → 5（2026-08-06）

目录里一直有 5 个视频条目，但只有 2 个有驱动，kling / sora / cogvideox 被 `IMPLEMENTED_ENDPOINT_STYLES` 闸门挡着**在下拉里根本不出现**。本轮把三个补齐。

**先补共享层的一个真实缺口**：`downloadUrlMediaAsset` 不带任何 header，而 OpenAI 的成品视频是从 `/videos/{id}/content` 这种**需要鉴权的端点**取的，不是公开 CDN URL。`TaskResultItem` 因此加可选 `headers`（可加字段，不破契约），下载器透传。否则驱动只能自己把整段视频拉进内存转 base64——正是 D6 要避免的形状。

**三个驱动，各自的协议差异**：

- `openai-video`（Sora 及网关中转）：时长字段叫 `seconds` 且是**字符串**；`progress` 是真实百分比所以透传而不是伪造；结果带鉴权 header。
- `cogvideox`（智谱）：提交与轮询**不在同一路径**（`/videos/generations` → `/async-result/{id}`），状态词全大写。
- `kling`（快手）：唯一不用 bearer key 的——要 **HS256 JWT**，用 access/secret 对签名。provider 只有一个 `api_key` 字段，故约定填 `accessKey:secretKey`（`|`、空格也认，因为用户按控制台的样子粘）。签名用 **Web Crypto** 而非 `node:crypto`，保持与其他驱动一样的环境无关性。文生视频与图生视频是**两个端点**不是一个开关，故由参考图决定走哪条；业务错误装在 200 信封里（`code != 0`），只看 HTTP 状态会误判成功。

**验证**

- 单测 14 条。**JWT 用 Node 独立 HMAC 交叉验证**——手写签名器在 padding / url-safe 字母表 / 签名输入编码上很容易错得很隐蔽，而这类错误会让每一次调用都失败。
- **真实端点可达性探测（无效 token，零计费）**：代理/路由错误会以 404/405 暴露，路径正确则走到鉴权。四个全部 401：OpenAI `/v1/videos`、智谱 `/api/paas/v4/videos/generations`、Kling `/v1/videos/text2video`（返回 `{"code":1000,"message":"Auth failed"}`，**信封形状与驱动解析一致**）、用户网关 `/v1/videos`（200 透传）。这比"只用假服务器验骨架"强得多。
- 真机 CDP：`isMediaGenSupported` 对 sora-2 / kling-v2-master / cogvideox-3 全部转 true 且解析到各自 endpointStyle，非视频模型仍拒。用户网关下拉没变属预期——他那份模型列表里本就没有这三家。

⚠️ **三条既有测试因刻意行为变更而更新**：原先断言"kling/sora/cogvideox 不可选（驱动未实现）"，现在翻转为可选。**那条不变量本身仍在**——改用一个真正无驱动的 `not-implemented-yet` style 继续守"目录条目单独存在绝不能让模型可选"。

**仍未做（阶段三剩余 + 阶段四五）**

- **会话内进度卡片没做**：`MediaJobService` 的进度目前只经 TCP 回推给 MCP 薄壳，**没有任何 IPC 广播到渲染层**。所以长视频生成期间会话里看不到进度，工具调用被 CLI 侧超时砍掉后也没有可见兜底（设计 §4.3 的"三层保险"目前只有两层：job 存活 + `one_media_job_status`）。要做需给 generate 请求带上 conversationId 并加一条 IPC 广播。
- 附件上传未针对视频做预览（`FilePreview` 的 `IMAGE_EXTS` 只认图片，视频会落到通用文件卡片——能传能引用，只是没有缩略图）。
- **视频真机出片仍未达成**。⚠️ **原「key 无权限」的结论已于 2026-08-06 被推翻**：用户指出视频与其他模型是同一把 key，实测同一无效 token 下 chat 路径正常 401 而 `/v1/contents/generations/tasks`、`/v1/videos`、乃至一个**根本不存在的路径**全部返回 200 空 body ——该网关对 `/v1/*` 下未配置的路径一律吞掉。真正结论=**这个网关没有代理 Ark 任务 API，与 key 无关**。解法是把视频 provider 指向火山方舟直连 `https://ark.cn-beijing.volces.com/api/v3`，代码侧无需改动。详见交接文档 §3。
- 阶段四（参数面 / 会话级模型切换 / 用户 catalog 覆盖）未开始。
- 三个新驱动**只验证到"提交路径正确、能走到鉴权"**，请求体字段名与轮询响应解析仍未用真 key 打过成功链路。有真 key 时优先跑 `bunx tsx scripts/probe-media-driver.ts --driver <id> --key <真key> --model <模型>`（⚠️ 会产生真实计费任务）。

## 阶段一改动文件清单（供接续者定位）

**新增**：`common/media/{types,executeMediaGeneration,mediaAssets,index}.ts`、`common/media/catalog/{types,imageModels,videoModels,resolve,index}.ts`、`common/media/adapters/{openaiImagesAdapter,chatMultimodalAdapter,index}.ts`、`tests/unit/media/{catalogResolve,openaiImagesAdapter}.test.ts`
**删除**：`common/chat/imageGenCore.ts`（逻辑迁入 media 模块，唯一消费方已重指）
**修改**：`process/resources/builtinMcp/imageGenServer.ts`、`common/utils/imageModelAllowlist.ts`、`common/config/{constants,imageGenerationMcpEnv}.ts`、`common/api/OpenAIRotatingClient.ts`（+`createImageEdit`）、`renderer/.../ToolsModalContent.tsx`、13 个 locale 的 `settings.json` + `i18n-keys.d.ts`、上述三个既有测试

## 2026-08-07：选择器类型标签 + 会话内呈现返工 + 一个让「用户声明」从来存不住的后端缺陷

### 一、`model_kind` 落盘被后端静默丢弃（本轮最重要，跨仓 1oneCore）

**08-06 那套「用户声明模型类型取代白名单」的架构，在真机上从来没有生效过。**

`1oneCore/crates/aionui-api-types/src/provider.rs` 的 `ModelSettings` 只有 `image_input` 和 `openai_api_mode` 两个字段。设置页写的 `model_kind` / `media_endpoint` / `media_unit_price_usd` 三个键，经 `PUT /api/providers/:id` 反序列化进这个结构体时**被 serde 直接丢掉**——不报错、不告警，读回来就是空对象。真机实证（修复前）：写入 `{'kimi-k2-6': {model_kind: 'image'}}`，读回 `{'kimi-k2-6': {}}`。

`git log` 确认 `provider.rs` 最后一次改动是 07-29 上游同步，08-06 的媒体工作从未扩过它。**所以交接文档 §4.2 把「一个标签都看不到」归因于"用户 16 个模型一个都没标"是错的——真正原因是标了也存不住。**

修法=补齐三个字段 + 新增 `ModelKind` 枚举（`#[serde(rename_all = "lowercase")]` 对齐前端词汇表）。`f64` 不实现 `Eq`，故 `ModelSettings` 的 derive 去掉 `Eq` 保留 `PartialEq`（已确认无处依赖）。新增 3 条 Rust 测试钉死往返，其中一条断言"重新序列化必须复现客户端发来的每一个键"。已重编内嵌（`backend-rebuild.ps1`）。

> ⚠️ **这类缺陷的通用判据**：后端 DTO 是**有类型的结构体而不是透传**，前端往 `Record<string, T>` 里加字段时，只要后端结构体没同步加，就会静默丢——tsc 不会报（前端类型是对的），后端也不会报（serde 默认忽略未知键）。**跨仓加字段必须两边一起改，并用一条往返测试锁死。**

### 二、§4.1 模型选择器类型标签（交接文档点名的第一优先级）

交接文档说有 4 个选择器，**实际是 6 个**——移动端发送框的 action sheet（`AcpSendBox` / `DreamEngineSendBox`）也各自列模型，是独立的第三处。全部覆盖：

| 选择器                                                                                                                 | kind 来源                                        |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `DreamEngineModelSelector` / `GuidModelSelector`(gemini 分支) / `GoogleModelSelector`(含渠道设置 `variant='settings'`) | 直读 `provider.model_settings[model].model_kind` |
| `AcpModelSelector` / `GuidModelSelector`(ACP 分支) / 两个移动端 action sheet                                           | 按模型名在 providers 里反查                      |

前三个走共享的 `RuntimeSelectorModelList`（给 `RuntimeSelectorModel` 加 `kind`、`RuntimeSelectorCheckedItem` 加 `trailing`），`GoogleModelSelector` 自建菜单故单独渲染。

**ACP 的反查是按用户明确要求做的**（我原本建议不加）。它只在**无歧义时**回答：`declaredModelKindByName` 遍历所有 provider，两个 provider 对同名模型声明了不同类型就返回 undefined——ACP 列表只带模型名，同名不等于同一个模型，一个自信的错标签正是这套设计要根除的东西。

**真机验证**：给 `minimax-2-7` 标成视频后，Guid 发送框下拉出现 `✓ minimax-2-7 视频模型`，整个列表**有且只有这一个标签**（其余未声明的保持无标签）。这条同时也是上面后端修复的端到端判据。

### 三、会话页显示返工（用户截图报的问题）

用户给的截图里三张作业卡片吃掉了整个视口，对话内容完全看不见。读代码定位到四条，**交接文档一条都没记**：

1. **面板挂在消息列表之外**：`MediaJobPanel` 是 `ChatLayout` 的第一个子节点，永久置顶不随消息滚动；`useMediaJobs` 不设上限、终态作业永不移除 → 生成几次就把会话挤出视口。**改法=照 artifact VO 的既有模式并进消息流**（新增 `IMediaJobVO`，按 `created_at` 与消息、artifact 一起排序，渲染在滚动容器内），`MediaJobPanel` 随之删除。**刻意不进 aioncore 消息 schema**（设计 §8 Q4），作业仍归主进程 job store，重启不丢的语义不变。顺带把三处散落的"非消息项"类型判断收敛成 `isNonMessageItem`，避免新增一种 VO 时漏改其中一处。
2. **卡片上没有提示词**：`MediaJobView` 契约里没有 prompt（记录里一直有，只是没投影出来），所以两次同模型的失败卡片完全无法区分。已按契约的 additive 约束加 `prompt?`。
3. **错误是原始英文**：引擎错误直接渲染，读起来像没翻译的界面文案。改为 i18n 的「服务端返回」标签 + 原文作次要详情——上游说什么语言不是我们能控制的，标明出处才诚实。
4. **单图 520px 全宽**，且 **`Image.PreviewGroup` 包着裸 `<img>` 其实点击放大从来不生效**（只有 Arco `Image` 会向 PreviewGroup 注册）。先换成 Arco `Image` 让预览真的可用，再把单图收到 360px。

**真机 CDP 验证**：8 张卡片 **8/8 在 `message-list-scroller` 内部、0 张在它之前**；卡片文本含提示词与「服务端返回」标签；图片 `one-media://` 解码 1254×1254、渲染 360×360；点击弹出预览层且源仍是 `one-media://`；页面无横向溢出。

### 四、方舟驱动 vs 用户测试台（未决，缺一个事实）

用户提供了测试台的真实报文（submit `{"id":"cgt-..."}` → poll `status: running` → `succeeded` + `content.video_url`）。**已按这份真实报文新增 4 条测试**（`arkRealPayload.test.ts`），逐字段验证 `arkDriver` 的解析：取 id、把带 `error: null` 的 running 正确判为进行中（而不是失败）、从 succeeded 里取 `video_url`、`last_frame_url: null` 不产生第二个空资产、路径不重复加版本段。**解析层与真实报文完全吻合。**

但用户指出测试台用的就是内部 LiteLLM，这与交接文档 §3「该网关没代理 Ark 任务 API」冲突：

- §3 的"决定性判据"（不存在的路径也返回 200 空）是**用无效 token** 做的，可能只是网关对未鉴权请求的短路行为，不足以证明真实 key 下也没路由。
- 但作业记录里 6 条失败视频用的是**真实 key** 打 `/v1/contents/generations/tasks`，返回同样是 200 空 body——所以至少**这条路径**在真实 key 下确实不通。
- 渲染层受 CSP 限制无法直接探测网关，主进程没有 inspector 端口，因此本轮无法在不产生计费任务的前提下测出正确路径。

**还缺的那一个事实：测试台实际请求的完整 URL**（测试台界面上「Code」按钮里就有）。拿到之后大概率只是把该模型的 `endpointStyle` 从 `ark-task` 换成对应驱动，或给 catalog 加一条 provider 钉死的条目，代码结构不用动。**在拿到之前不要再按「网关没代理」这个结论排查，它的证据基础已经不成立。**

### 四·补：模型分类的「推测」与「判定」分成两层（用户追问后返工）

用户看到 16 个模型全是「未标注」，问「难道默认连模型是属于什么类型都无法判定吗」。原实现只认用户声明，所以库里没标就一片空白——观感上等于没做。

**修法=把标签和闸门拆开，这是全部要点**：

|                                                                                        | 数据来源                         | 允许猜吗             | 用在哪                               |
| -------------------------------------------------------------------------------------- | -------------------------------- | -------------------- | ------------------------------------ |
| **判定**（`resolveDisplayModelKind` / `isChatCapableModel` / `resolveMediaModelSpec`） | 用户声明 → 内置目录              | **不允许**           | 决定模型出现在哪个选择器、走哪条 API |
| **标签**（`resolveModelKindLabel`）                                                    | 用户声明 → 内置目录 → **读名字** | 允许，但必须标成推测 | 只在设置页模型列表显示               |

08-06 废掉的白名单坏在它**用名字决定能不能用**——正则漏掉的模型直接不可用，要等发版。而猜一个**标签**的代价完全不同：最坏是模型名旁边多一个错词，用户看得见、一键就能改，模型能做什么一点没变。这条边界有测试钉死（`never lets an inferred label change what the model may be used for`）。

推测出的标签渲染成**灰色 + `?` + tooltip**，确定的才是彩色；embedding / rerank 不套五种类型里的任何一种，宁可留空。**选择器刻意不显示推测标签**——能进聊天选择器的本来就都是文本模型，每行挂个「文本模型?」是噪音（第一版这么做了，直接让 21 条既有 DOM 测试变红，是个好信号）。

**真机**：14 个模型全部有标签——`gpt-image-2`/`seedance-*`/`doubao-seedream-*` 彩色（目录确定），其余灰色带 `?`。

### 四·补二：聊天模型列表的过滤方向是反的（用户截图实证）

用户把 `seedance-2-0-pro` 选成聊天模型，报 `404 model "seedance-2-0-pro" not found`，同时问「难道图片模型就不能聊天了吗」。查下来两件事都是同一个根因，**而且和类型标签无关**：

`CAPABILITY_PATTERNS.excludeFromPrimary` 这条 `/dall-e|flux|stable-diffusion|midjourney|flash-image|image|embed|rerank/` 正则在管聊天列表，在真实库上两个方向都错：

- **该显示的被藏了**：`gemini-3-pro-image` ×3 名字带 image 被滤掉，但它是 Form B——**聊天里回图，本来就能聊**。
- **该藏的在显示**：`seedance-*` / `doubao-seedream-*` 名字不带 image 所以照常出现，选了必 404。

**这就是 08-06 那套白名单本尊，只是活在另一个文件里。** 已换成 `isChatCapableModel`（声明 → 目录，不猜）：video/audio 不可聊天；image 只有 **Form B 可以**（Form A/C 是独立生成端点，聊天请求根本到不了）；**不认识的一律放行**——藏起一个没识别出来的模型，正是"新模型要等发版才能用"那个毛病。

⚠️ 两处 `getAvailableModels` 是**重复实现**（`useModelProviderList.ts` 与 `pages/guid/utils/modelUtils.ts`），都改了；两处的缓存 key 都补上 `model_settings`，否则标完类型要等重载才生效。

**真机实证**（同一个 provider，改动前后）：聊天列表新增 `gemini-3-pro-image` ×3，移出 `seedance-2-0-fast`/`seedance-2-0-pro`/`doubao-seedream-5-0-pro`，`gpt-image-2` 保持排除。

### 四·补三：媒体模式切换只挂了一个发送框

用户说「不建议把图片视频的输入窗口跟文本窗口混在一起，至少做个快速切换」。切换器（`MediaModeControl`）其实 08-06 就做了，但**只挂在 `AcpSendBox`**——aionrs（1ONE CLI）发送框和 Guid 欢迎页都没有，所以用户在自己那个页面上根本看不到。`useMediaComposer` 当初收口成 hook 就是为了"每个发送框行为一致"，结果只接了一处。

已给 `DreamEngineSendBox` 补上（同一个 hook、同一套短路逻辑、同样的参考图过滤）。真机：aionrs 会话里出现「对话」按钮，展开是「对话 / 图片生成 / 视频生成」。

**Guid 欢迎页刻意不加**：那时会话还不存在，而 job 的归属设计是会话优先——在没有会话的地方起生成任务，结果只能挂到 workspace 上，正是要避免的那种"东西跑到别处去了"。欢迎页应该先建会话。

### 四·补四：产品评审后的三项体验修复

真机把图片链路完整跑通后做了一轮产品视角评审，发现"功能做完了但闭环断在最后一步"。修掉最挡人的三条：

**① 生成结果拿不走 —— 新增 `MediaResultActions`**
完成态卡片此前**零个操作按钮、也不显示文件路径**（实测 `actionsOnCard: []` / `cardMentionsPath: false`），人拿到图第一反应的四件事一件都做不了。现补：**复制**（仅图片）/ **打开所在目录** / **重新生成**。

- **刻意不做「另存为」**：资产已经是工作区里的真实文件，`showItemInFolder` 一次点击就能拿到，而保存对话框只会复制一份用户已经有的文件（且当前 `dialog` 只有 `showOpen` 没有 save，要新开后端端点）。
- 复制走 `fetch(one-media://…)` → blob → `ClipboardItem`。协议注册时带了 `supportFetchAPI: true`，所以字节不经消息通道（D6 不破）；真机实测 `fetch` 返回 200 / `image/png` / 1002454 字节。
- **重新生成必须复现原请求**，因此给 `MediaJobView` 补了 `params` 与 `inputUris`（可加字段）。否则会拿默认值悄悄换掉尺寸/种子/参考图——**而且是花钱换**。有测试逐字段断言。

**② 媒体模式一眼可辨且可退**
模式是粘的（发完还停在图片生成），下一句想聊天就会变成又一次生成 + 又一次扣费。

- **不做"发完自动退出"**：改提示词再生成一次是这类工具的核心循环，自动退出会把它打断。
- 改为让输入框自己说清楚：媒体模式下 placeholder 变成「描述要生成的图片…（**不会作为消息发给助手**）」，这是用户按下 Enter 前一刻真正在看的东西；模式 chip 旁加显式 `✕ 退出`。
- 顺带修 aionrs 一个既有问题：`disabled={!current_model?.use_model}` 会在没选聊天模型时锁死输入框，但**媒体模式根本不用聊天模型**，已改为只在对话模式下判定。

**③ 同屏两个模型指示器互相矛盾 —— 新增 `mediaModeStore`**
媒体模式下头部 pill 仍写聊天模型（截图里头部 `seedance-2-0-fast` / 发送框 `gpt-image-2`），用户无法判断下一次 Enter 用哪个。

- 模式住在 `useMediaComposer`（发送框内），而 pill 在头部，两者是不同平台外壳挂载的**兄弟节点**——为两个组件包一层 context 要动每个外壳，所以用了极小的外部 store（`useSyncExternalStore`），发送框写、头部读。
- 媒体模式下 pill 显示「图片生成 · gpt-image-2」；退出后回到聊天模型。
- 同时给**钉着不可聊天模型**的存量会话加了红色 `!` + tooltip「该模型没有对话接口，发消息会失败，点这里换一个」——选择器已经不再提供这类模型，但**改动之前建的会话还钉着**，此前每次发消息只有一个看不懂的 404。

**真机 CDP 全链路**（aionrs 发送框，即本轮新接线那条）：
切图片模式 → chip 显示 `gpt-image-2` → 真发「一只橘猫戴着宇航员头盔，简约插画风」→ 卡片即时出现在消息流（已提交/生成中/带提示词）→ 完成，真实 1254×1254 PNG 解码、渲染 360px → 三个操作按钮就位 → 点「重新生成」→ **第二个 job 用同一 prompt/model 建出并再次出图** → 点 `✕` 退出 → placeholder 与头部 pill 双双回到对话态。ACP 发送框同样验过（视频提示词 + 退出按钮 + 卡片操作行）。

### 五、验证与遗留

- tsc 0 / lint 0 error / check-i18n 通过 / 全量 **3099 绿 0 失败**（前端新增 40 条 + Rust 3 条）。
  ⚠️ 全量跑在 dev app 同时运行时会出现 2~6 条 **负载 flake**（`previews` 三件套 + `FeedbackReportModal` + `CreateTaskDialog`），单独跑 112/112 全绿，关掉 dev 后全量也是 0 失败。**判据是单独跑，不是全量那一次的数字。**
- 1oneCore：`cargo fmt --check` 通过、`clippy -p aionui-api-types -D warnings` 通过、`aionui-api-types` 测试全绿。
- ⚠️ `bun run format` 是全仓格式化，会把既有格式债一起改掉（本轮扫出 8 个无关文件，含把 CLAUDE.md 的 `**强调**` 破坏成 `\*\*`）。**已全部还原**，只保留本轮真实改动。
- 未提交、未推送、未打包。

**产品评审里还没做的（按优先级，接续者可直接接）**

1. **视频整条链路仍未跑通** —— 阻塞点已在 2026-08-07 下半段用**带对照组的真实 key 探测**收敛，见下面「视频网关探测」一节。结论：**这台网关上不存在可达的视频入口**，缺的仍是测试台 Seedance 标签页打的**那个主机/路径**。
2. ~~**花费全程不可见**~~ —— **已完成，见下面 2026-08-07 下半段**。
3. **agent 看不见生成结果**，说不了「把它改成竖版」——要动 aioncore 消息 schema，是另一个量级（设计 §8 Q4 刻意回避）。
4. **入口仍偏深**：Guid 欢迎页没有媒体模式（刻意，那时会话不存在），且必须先在 设置→能力扩展→工具 配好媒体模型。
5. ~~**失败卡片缺"我该怎么办"**~~ —— **已完成**，见下。
6. ~~**10 个推测标签没有"一键采纳"**~~ —— **已完成**，见下。
7. ~~小瑕疵：媒体模式 placeholder 尾巴~~ —— **已完成**，见下。

## 2026-08-07 下半段：花费可见（上面清单第 2 项）

### 一、缺口

公司账本一直知道每次生成花了多少（`/api/one/billing/media-usage`），**花钱的那个人不知道**——发送前没有任何数字，发送后也没有。

### 二、口径必须与账本一致，所以先读 Rust

前端不能自己定义"一次生成多少钱"，否则用户拿我们的数字去对账单会发现对不上。新建 `common/media/pricing.ts` **逐条镜像**两处 Rust 实现：

| 来源                                             | 内容                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `aionui-common/src/license.rs`                   | `image_rate_micros` / `video_rate_micros_per_second` / `estimate_media_cost_micros` |
| `one-billing/src/service.rs::record_media_usage` | 用户单价分支的计量口径                                                              |

**读代码纠正了一个我原本的错误假设**：视频不是按秒计，是 **`count × 秒数`**——两条 5 秒片和一条 10 秒片一样贵。缺省时长按 5 秒兜底（Rust 侧注释写明"缺时长不能让视频免费"）。

⚠️ **镜像 = 漂移风险**。防线是把 Rust 侧自己的测试向量逐条抄进 `tests/unit/media/pricing.test.ts`（`media_is_priced_per_asset_and_per_second` 的 7 条 + `record_media_usage` 的 3 条），任一边改费率，这边就红。

### 三、数字分三档来源，措辞跟着变

沿用 08-06 已确认的分层原则（判定不许猜、展示可以猜但必须标明），**且这里不门控任何东西**：

| 来源                 | 显示                                      | 理由                                                                                             |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 用户为该模型填的单价 | `$2.50`                                   | 这是他真实的合同价                                                                               |
| 内置费率表           | `≈$1.00` + tooltip 说明可能与实际计费不同 | 该表按模型名正则匹配，是粗略示意——但它同时**就是**没设单价时公司实际被记的账，所以显示它不是编造 |
| 两者都没有           | 「费用未知」+ 引导去设单价                | **不显示 `$0.00`**：把一次付费生成说成免费是这里唯一不能犯的错                                   |

### 四、两个显示点

- **发送前**：`MediaModeControl` 参数 chip 旁。刻意放在参数边上——数量填 4 就是 4 倍价钱，这件事该在填 4 的那一刻可见。
- **完成后**：`MediaJobCard` 的操作行旁。

**关键做法**：卡片的计量和上报给账本的计量**共用同一个 `meterMediaJob()`**（`reportJobUsage` 已改为调它），所以两个数字在结构上就不可能不一致，而不是靠两处各写一遍再祈祷。

### 五、顺带补的接缝

`MediaJobView` 新增 `providerId`（可加字段）。单价挂在**具体某个 provider** 上，没有它就只能按模型名反查——而同一个模型名可以在两个 provider 上有两个价，把金额算到错的合同上比不显示更糟。有测试钉死"不借用别的 provider 的价"。

### 六、目录规范

`components/media/` 已有 15 个直接子项（既有超标，ratchet 规则只要求不加剧），所以计价逻辑放进 `hooks/media/useMediaCost.ts` 而不是新建组件文件，两个显示点各渲染几行。

### 七、验证

- 新增 30 条测试（`pricing` 15 / `MediaJobCard` 5 / `MediaModeControl` 6 / `jobView` 1，另 3 条既有文件内补充）。
- tsc 0 / lint 0 error / check-i18n 通过 / 13 语言 i18n 补齐 6 个键。
- ⚠️ **格式化只对本轮 13 个文件跑 `bunx oxfmt <files>`**，没跑全仓 `bun run format`（上半段的教训）。

## 变更日志

- **2026-08-06（阶段四收尾·发送框媒体模式）**：按用户确认的「B 为主 A 兜底」落地。**做成输入框工具行里的一个模式切换而不是独立页面**——共用一个会话、一份历史、一个输入框，切回去就是正常对话；独立入口会在产品里长出第二条产品线，且它的历史聊天看不见。媒体模式下发送**短路 agent**（用户要的是一张图，不是关于图的对话），直接走 `startJob`。新增 `useMediaComposer`（收口在 hook 里，因为每种会话类型各渲染各的发送框，行为不一致会与 bug 无法区分）+ `MediaModeControl`（模式下拉 + 参数 chip，chip 上写明将要使用的模型——它同时决定价格和参数面板能给出什么，隐含选择正是用户拿错模型的由来）。切换 kind 时清空参数（时长对图片模型无意义）。job 归属改为**会话优先、workspace 兜底**：发送框起的 job 带会话 id 只在该会话显示，agent 经 MCP 起的没有调用方身份故回落 workspace。参考图只取有真实路径的附件（project 型引用相对于媒体引擎不认识的项目条目）。真机 CDP：模式控件渲染 → 下拉三项齐全 → 切图片模式后 chip 显示 `gpt-image-2` → 面板出「尺寸/质量/生成数量」而**不出**时长与分辨率（那是视频的），证明面板确由 spec 生成。全量 3059 绿。⚠️ **诚实边界**：生成结果以 job 形式归属会话并渲染其中、重启不丢，但**未进 aioncore 消息 schema**（设计 §8 Q4 刻意回避），所以 agent 不会把它当成对话上下文看见。

- **2026-08-06（阶段四·直连生成通道 + 参数面板）**：**渲染层此前根本无法发起生成**（只有 MCP 经 TCP 能建 job），补 `ipcBridge.media.startJob`。顺带解决会话级模型/参数——直连路径天然带得上 `model` 与 `conversationId`，而 MCP 调用没有调用方身份，这是两条路的结构性差别而非疏漏。**关键重构**：抽出 `startMediaJob()` 作为唯一入口（校验+企业 precheck+目录刷新都在里面，新入口不可能忘），并把**用量上报从调用方搬到引擎级订阅**——否则渲染层这条新路会静默逃过企业用量统计；带 `reportedJobs` 去重，重复上报会让公司超出自己的上限。新增 `MediaParamsPanel`：**由 `MediaModelSpec.params` 生成而非写死表单**，模型只支持 5s 就只出 5s（手写表单必然与适配器漂移，而给出模型会拒绝的取值正是这层架构要根除的）；未声明的能力整段不显示，比给个禁用控件诚实。真机 CDP：从渲染层直接建 job → 5 次状态推送 → `done` 且 `origin.conversationId` 正确 → **precheck 与 usage 两个端点均命中**（新入口没绕过闸门）。media 128 绿。**仍未做**：发送框的媒体模式 UI（模式切换 + chip），已定 B 为主 A 兜底、生成留痕进会话历史。

- **2026-08-06（阶段四·把白名单换成用户声明）**：**用户指出按模型名匹配本质是白名单**——图片/视频模型层出不穷，不能每出一个就让开发者放行。采纳并重构：新增 `ModelSettings.model_kind`（文本/多模态/图片/视频/语音），**用户声明优先于内置目录**，声明为图片但目录不认识的合成 Form A spec（OpenAI images 接口是兼容网关上的事实标准）。⚠️ **视频刻意不猜**：各家异步任务接口互不兼容，猜错只在调用时才失败，故未指定 `media_endpoint` 的视频模型不予提供，由用户在模型设置里选。**边界澄清**：Form C 的驱动闸门不是白名单，它管的是"有没有实现这个协议的代码"，删不掉。模型列表加彩色类型标签（`ModelKindTag`），解决用户"分不清哪个是图片哪个是文本"的问题。另落地用户 catalog 覆盖（JSON，退居高级出口）+ 视频工具补 `negative_prompt`（此前目录声明了 `negativePrompt` 但工具送不进去）。**费用字段按用户提问评估后的结论=不显示我们猜的价格**：那是决策时刻的数字，错了比不显示更糟，且渠道价格是用户与厂商的合同我们读不到；改为模型设置里可选自填单价，填了才显示、才用于企业用量（1oneCore `1bf8accc` 让自填价覆盖内置费率表）。真机 CDP 实证：全新模型标记前不可用→标记后可用且走 Form A；视频标了但没选接口仍不提供；**`gpt-image-2` 原本被识别，标成"文本模型"后从图片选择器消失，标回图片仍复用内置 spec**。

- **2026-08-06（阶段五·企业管控闭环，跨仓）**：媒体生成纳入成本上限与模型 allowlist——此前聊天走 SendGate，而图片/视频经内置 MCP 工具直达 provider 从未过任何闸门，是文档里标了很久的真实合规缺口。1oneCore `e904eaa7`：`check_media_allowed` 委托 `check_send_allowed`（**刻意与聊天共用一份 allowlist、一个预算**，不另造一套让管理员再去维护）、`record_media_usage` 复用 `one_usage_events`（媒体无 token，那几列留 NULL 只记成本，于是自动进入既有预算汇总与用量看板，**无需迁移**）、新增 `estimate_media_cost_micros` 按张/按秒计价（用 token 费率算会一律得 0，让最贵的调用悄无声息待在上限之下）、两个端点。1oneUI 侧 `governance.ts` 在**提交前** precheck、完成后按**实际产出**回报。**precheck 刻意 fail-open**：拒绝必须意味着"策略说不行"，而不是"请求没送到"——把故障当拒绝会在端点抖动时把所有个人用户的媒体生成一起打死，去执行一条他们根本没有的策略；真正的强制在服务端，答案和账本是同一个后端。真机验证：重编后端 → 个人版真实出图成功（红线成立）+ 日志实证两个端点各返回 200（**不是静默失败开**）。one-billing 17 绿 / aionui-common 124 绿 / 1oneUI 全量 3040 绿。

- **2026-08-06（接入面扩容）**：视频驱动 2 → 5，补齐 openai-video（Sora）/ cogvideox / kling，三者此前只有目录条目、被闸门挡着不可选。顺带给 `TaskResultItem` 加可选 `headers` 并由下载器透传（OpenAI 成品视频在鉴权端点后面，否则驱动只能整段转 base64）。kling 的 HS256 JWT 用 Web Crypto 实现并与 Node 独立 HMAC 交叉验证。四个真实端点用无效 token 探测全部走到 401，证明提交路径正确。media 101 绿 / 全量 3032 绿。

- **2026-08-06（阶段三后半段）**：媒体呈现层落地。撞上设计文档没料到的硬约束——渲染层拿不到 `file://`（webSecurity），而视频走 base64 违反 D6，故在主进程注册 `one-media://` 流式协议（带 Range、扩展名白名单）；新增结果解析、视频播放器、多图画廊，接进 aionrs 与 ACP 两个渲染点。真机验证 206 分段、403 安全边界、真实 `<video>` 解码 1920×1200。顺带修掉集成测试 teardown 的 ENOTEMPTY flake。media 79 绿 / 全量 3010 绿。**会话内进度卡片仍未做**（缺 IPC 广播）。
- **2026-08-05（晚，阶段三前半段）**：补上 `tools.videoGenerationModel` 的写入方（设置页视频模型卡片）——此前只有读没有写，视频在设置层面就是死的；修掉 ark 驱动在兼容网关上缺版本段（真实网关实测 405 vs 200，视频经该网关此前必挂）与 `readJsonOrThrow` 对 2xx 空 body 抛裸 SyntaxError 两个真缺陷；顺带改正已说反的"万相/即梦待后续支持"文案。真机 CDP 验证下拉候选/持久化/引擎读取/图片无回归，media 56 绿、settings 154 绿。视频真机出片仍卡在 key 权限（环境非代码）。
- **2026-08-05（下半场）**：**阶段二代码完成**——异步任务引擎、Form C 适配器与两个国产驱动、MCP 薄壳化走 TCP、凭据不再下发子进程、`one_video_generation` 与 `one_media_job_status` 上线；全量 2976 绿 + 端到端集成 + 打包冒烟；修掉自己引入的"无驱动模型仍被判支持"与"过期 TCP 端口"两个缺陷。未打包，两个驱动未接真实 key。
- **2026-08-05**：架构设计文档定稿（待评审→用户认可开工）；建立本进展文档；**阶段一代码完成**（Form A 落地、多图修复、能力目录上线、工具扩参、13 语言文案更新），静态验证全绿（tsc/lint/i18n/全量测试），修掉一个自己写出的原生协议主机误判缺陷；未提交未打包，真机验收待做。

## 2026-08-07 收尾：视频网关探测 + 清单第 5/6/7 项

### 一、视频网关探测（第 1 项的阻塞点已收敛，但仍未解开）

上一轮那条「网关没代理 Ark 任务 API」的结论**方向对、证据不成立**——它是用**无效 token** 测的，无法排除「网关对未鉴权请求一律短路」。本轮用真实 key 重测，并补上此前缺失的**否定对照组**。

方法：对候选路径 POST **故意不合法的请求体**。路径已路由 → 返回带真实信息的校验错误（不建任务、不扣费）；路径未路由 → 200 空 body。

| 路径                                                                                                                                                             | 结果                     | 判读                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------- |
| `/v1/chat/completions`（正对照）                                                                                                                                 | 404 `model "" not found` | 已路由                     |
| `/v1/images/generations`（正对照）                                                                                                                               | 404 `model "" not found` | 已路由                     |
| **`/v1/zzz-not-a-real-endpoint-9f3a`（负对照）**                                                                                                                 | **200 空 body**          | **这就是「未路由」的样子** |
| `/v1/videos`、`/v1/videos/generations`、`/v1/video/generations`、`/v1/videos/generation`、`/v1/contents/generations/tasks`、`/api/v3/contents/generations/tasks` | 全部 200 空              | 全部未路由                 |
| `/v1/audio/speech`                                                                                                                                               | 200 空                   | 未路由                     |
| `/v3/contents/generations/tasks`                                                                                                                                 | 405 nginx                | 落到静态兜底，非 API       |

**进一步的事实**：

1. `/v1/models` **列出了** `seedance-2-0-pro` / `seedance-2-0-fast` / `joyveo-pro` / `joyveo-flash` / `happyhorse-video-edit`（共 125 个模型，`owned_by` 全是 `joy-maas`）。**但模型清单 ≠ 路由**：带 `model` 缺必填字段再打一次，chat 与 image 两条路由对**每一个**视频模型都答 `model_not_found`，而同样打法的 chat/image 模型会真的打到上游（错误里带 `kimi-k2-6-ucloud/kimi-k2.6`、`gpt-image-2-azure/gpt-image-2`）。
2. **这不是 LiteLLM**。错误信封是 `{"error":{"message":"backend error: [<模型>-<厂商>/<上游模型>] ..."}}`，不是 LiteLLM 的格式；`/openapi.json`、`/docs`、`/model/info` 全部返回同一份 1080 字节的 SPA HTML。**nginx 只代理 `/v1/`，其余落静态**，且 `/v1` 下未知路由一律 200 空——所以**无法枚举路由**，探测能力到此为止。

**结论**：`litellm-internal.123u.com` 上不存在可达的视频入口，换 key 不会改变这一点。仍缺的那一个事实变成了更容易拿的东西：**测试台 Seedance 标签页所在的网页地址**（不是 DevTools 里的请求，是浏览器地址栏）。拿到后可直接读该页 JS 找出它打的主机与路径。

⚠️ **顺带修掉一处误导性诊断**：`taskDrivers/types.ts` 对 200-空-body 抛的错写着「通常意味着 API key 没有这个模型的权限」——**已被本轮负对照证伪**（有效 key + 不存在的路径同样 200 空）。已改为「这是该网关对未路由路径的应答，换 key 无用」。

### 二、第 7 项：媒体模式 placeholder 的对话态尾巴

`SendBox` 无条件把 `conversation.sendbox.hint`（「输入 / 唤起命令，@ 引用文件，↑/↓ 切换历史消息」）拼在任何 placeholder 后面。媒体模式下 `/` 命令与历史消息都不存在。新增 `hideChatHint` prop，两个发送框在媒体模式下传 true。**默认行为逐字节不变**（重构成一个 IIFE，未传该 prop 时三条分支与原表达式等价）。

### 三、第 5 项：失败卡片的「我该怎么办」

两部分：

1. **重试**。失败卡片此前**一个动作都没有**（`MediaResultActions` 遇到无资产直接返回 null），唯一的重试方式是回输入框重敲提示词。改为由「有没有 prompt」决定是否可再跑一次，复制/打开目录仍需要真实文件。文案按状态区分：成功后是「重新生成」，失败后是「重试」。
2. **建议**。新增 `useMediaFailureAdvice`，把能认出的失败归成 6 类（`notRouted` / `modelNotFound` / `auth` / `rateLimit` / `timeout` / `contentPolicy`）各给一条具体下一步。

**两条刻意的设计**：

- 匹配错误文本就是猜，所以**只用于展示、不门控任何东西**（与模型类型标签同一条分层原则）。猜错的代价是一句没用的话；猜错若用于门控，代价是用户够不着的能力。
- **认不出就什么都不显示**，不给「稍后重试」这类通用话术——在一个永远不会成功的错误下让人反复重试，比原来的死胡同更糟。有测试钉死这条。
- `notRouted` 优先级最高：它是唯一「重试和换 key 都没用」的一类，而它的报错里往往也带模型名，先匹配它才不会被误判成 `modelNotFound`。

### 四、第 6 项：推测标签一键采纳

provider 头部新增按钮（**仅在该 provider 确实有推测标签时出现**，带确认框与数量），把全部推测类型写成正式声明。纯计算抽到 `modelCapabilities.ts` 的 `inferredModelKinds()` 以便测试。

**一个需要想清楚的点**：读不出的名字会**兜底**成 `text`（不是读出来的结论）。要不要把兜底也纳入一键采纳？纳入了。理由是：①用户那 10 个灰标签绝大多数正是这一类，排除掉等于这个功能对他没用；②声明 `text` 与「未声明」在**行为上完全等价**（都可聊天、都不参与生成），只影响显示；③按钮带确认框和数量，**点它就是用户替这些猜测拍板**——而「猜测只有经用户认可才成为事实」正是这套分层设计的原意。embedding / rerank 仍被排除：它们不属于五种类型里的任何一种，让用户把它声明成其中之一是错的。

只写 `model_kind`，不动同一模型的其他设置（这是用户认可一个读数，不是重置配置），且之后仍可逐个改。

### 五、验证

- 新增 24 条测试（失败分类 8 / 卡片失败态 5 / `inferredModelKinds` 5 / 其余分散补充），并按 AGENTS.md「接口有意变更」的规则更新了 1 条既有断言（无资产不再一律不渲染，改为断言"仍提供重试、但不提供复制/打开目录"）。
- tsc 0 / lint 0 error / check-i18n 通过 / 新增 10 个键 × 13 语言（conversation 7 + settings 3）。
- 全量 **3146 绿 0 失败**。
  ⚠️ 中途出现过一次 3 红，**是本轮引入的真回归**：`modelCapabilities.dom.test.tsx` 用**显式列表** mock 了 `@icon-park/react`，新加的 `CheckOne` 不在列表里 → 整个组件渲染抛错。**给共享组件加图标必须同步这个 mock**，单跑目标测试不会暴露它。另有 1 条 `OfficeWatchViewer` 30s 超时属既有负载 flake（单跑绿）。

**真机验证（dev + CDP，全部未花钱新生成）**：

| 项      | 结果                                                                                                                                                                                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 第 5 项 | 同一会话 8 张卡片：6 张失败卡片只有「重试」，2 张成功卡片是「复制 / 打开所在目录 / 重新生成」；5 条建议全部是 `notRouted` 那句真实中文文案（对应 5 条 empty-body 错误），认不出的那条**不显示建议**；失败卡片上**没有**花费。                                                                                     |
| 第 6 项 | 确认框显示「把 **10** 个推测出的类型写成正式标注？」（正是用户说的 10 个）→ 确定后后端 `model_settings` 落 **10 条，每条只有 `model_kind`**；`gpt-image-2` / `seedance-*` / `doubao-seedream-5-0-pro` **不在其中**（目录确定的不属于推测，没被误改）；写完按钮自动消失（已无可采纳项）。**验证后已还原为 `{}`**。 |
| 第 7 项 | 对话态 placeholder 仍是「发送消息到 claude… 输入 / 唤起命令，@ 引用文件，↑/↓ 切换历史消息」，切图片模式后变为「描述要生成的图片…（不会作为消息发给助手）」，尾巴消失。                                                                                                                                            |

## 2026-08-07 收尾之二：视频端到端跑通（清单第 1 项，历时三轮）

### 一、缺的那个事实由用户给出，我上一轮的推断有一处是错的

用户给了可运行的 curl 脚本。真实入口是 **`POST /api/seedance/createVideo`，同一台主机、`/api/` 前缀**。

⚠️ **更正**：上一轮我写「nginx 只代理 `/v1/`，其余落静态」——**不成立**。我确实探过 `/api/v3/...` 与 `/api/openapi.json`，都拿到 200 空，却把它们归进「未路由」而没有继续在 `/api/` 命名空间里探。判据本身（200 空 = 未路由）是对的，**结论的覆盖面是我自己缩窄的**。

### 二、为什么是新驱动而不是改 `ark-task` 的参数

三处结构性差异：

|      | ark-task                                     | seedance-gateway                                    |
| ---- | -------------------------------------------- | --------------------------------------------------- |
| 提交 | `/v1/contents/generations/tasks`             | `/api/seedance/createVideo`                         |
| 轮询 | **GET**，id 在路径里                         | **POST，带 `{id, model}` body**——每次都要重发 model |
| 取消 | DELETE，id 在路径                            | DELETE，id 在路径 + **model 在 query**              |
| 参数 | `--resolution 480p --dur 5` 拼在提示词文本里 | 普通 JSON 字段                                      |

最后一条尤其要命：把 Ark 那套装饰过的提示词发给这个网关，`--flag` 会**变成画面内容**。有测试钉死提示词里不出现 `--`。

### 三、不硬编码用户的内网主机

目录条目不能按 `litellm-internal` 匹配——那是某家公司的内网地址，不该进产品。走既有通道：`resolveMediaModelSpec` **本来就支持**「用户显式声明的 `media_endpoint` 盖过内置目录」，所以用户在模型设置里把该模型指到 `seedance-gateway` 即可，同时保留目录对 seedance 参数面的既有知识（时长/分辨率/比例）。有测试钉死这两条。

### 四、顺带补的 `generateAudio`

测试台有「生成音频」开关，脚本里也传了 `generate_audio`。音频在部分厂商是计费项，所以**不设默认值**：三态（生成 / 不生成 / 不指定=用服务端默认），点已选项即可清空，与其他参数一致。chip 摘要里用 `♪` / `♪✕` 表示——chip 的职责就是说清楚将要做什么，而这一项会影响账单。

### 五、真机端到端（第一次跑通）

发送框切视频模式 → chip 显示 `seedance-2-0-fast · adaptive · 480p · 5s · ♪`（与用户脚本配置逐项一致）→ 提交返回 `cgt-20260806175841-pvnsd`（格式与用户脚本的任务 id 一致）→ 轮询 → **`done`，落盘 929 KB 的真实 MP4** → 卡片里 `<video>` 解码 **864×496**，花费显示 `≈$1.00`（$0.20/秒 × 5 秒），操作行正确地只有「打开所在目录 / 重新生成」（复制是图片专属）。

### 六、用户截图暴露的另一个真缺陷：欢迎页选中了不能聊天的模型

用户问「在这个窗口发消息到底是回文本还是生成图片视频？很容易摸不着头脑」——截图里欢迎页的模型胶囊是 `seedance-2-0-fast`。

**根因是两个列表分叉**：08-07 上半段已把选择器**列表**收窄为可聊天模型，但 `useGuidModelSelection` 判断「当前选中是否仍可用」和「回落取哪个」用的都还是 `provider.models` **原始列表**——所以陈旧的视频模型选中项能活下来，连回落都可能落到另一个非聊天模型上（取 `models[0]`）。两处均改为 `getAvailableModels()`。

**规则**：**被选中的**必须来自**被提供的**那个列表。两者分叉，用户无法与 bug 区分。

真机：欢迎页胶囊由 `seedance-2-0-fast` 变为 `minimax-2-7`。

⚠️ 顺带澄清一条产品语义：**欢迎页永远是对话**，媒体模式刻意只在会话内提供（那时会话还不存在，job 无处归属）。之前看起来暧昧纯粹是这个缺陷，不是设计。

### 七、验证

全量 **3165 绿 0 失败**（新增 20 条：驱动 16 + 欢迎页选择 4）。tsc 0 / lint 0 error / check-i18n 通过 / 新增 3 个键 × 13 语言。

## 2026-08-07 收尾之三：显示层四项（均由用户看真机截图提出）

### 一、模型选择器每行显示类型标签（推翻本文上半段的一个判断）

上半段刻意不在选择器显示推测标签，理由是「能进聊天选择器的本来就都是文本模型，每行挂个『文本模型?』是噪音」。**这个理由只对它说对的那些行成立**——同一个列表里有 `gemini-3-pro-image`，它既能聊天又能回图，而名字说不出这件事。为了不在多数行上重复，把信号连噪音一起去掉了。

六个调用点由 `declaredModelKindOf`/`declaredModelKindByName`（声明+目录，不猜）换成 `modelKindLabelOf`/`modelKindLabelByName`（可回落到读名字），`RuntimeSelectorModel` 加 `inferred` 透传。**收起后的触发器仍只显示模型名**——选完了，类型就该让位。

### 二、标签去掉问号，改为点标签直接编辑

用户：「可以去掉问号，怕显示不对就让用户点开自己改」。这比原做法好，因为**问号出现的位置不对**——它在用不上它的地方表达不确定：选择器每行挂一个 `?`，而用户在那里改不了任何东西。只表态不给出路，读起来像产品自己都不知道这模型是什么。

改为：措辞直说不加 `?`，推测与声明的区别只靠灰色弱化保留；`ModelKindTag` 新增可选 `onClick`，**只有设置页模型列表传**（那是唯一能真正改这个值的界面），点标签直接打开该模型的「配置模型」弹窗。

一句话：把「显示我不确定」换成「一键让你确定」。

### 三、⚠️ 设置开关的绿色态从来没生效过（既有缺陷，非本轮引入）

用户说开关开着关着看不出区别。真机量色：关 `rgb(201,205,212)`、开 `rgb(78,89,105)`——两个只差一档的灰。

继续查发现仓库早有约定：`settings.css` 的 `.settings-switch-on` 让开启态变绿，WebUI 与企业远程两处都在用。**但这条规则从来没生效过**——它写成 `:global(.arco-switch...)`，而 `:global()` 是 CSS Modules 语法，该文件是普通 `.css`，构建时整条规则被丢掉。

**实证方法（可复用）**：遍历 `document.styleSheets` 找规则文本。同文件的 `.settings-mobile-top-nav` 规则在，这条不在，且全文档没有任何残留的 `:global(`——排除了「文件没加载」这个替代解释。

改为普通选择器后实测：全新 `arco-switch-checked` 仍是 `rgb(78,89,105)`（未误伤全局），带 `settings-switch-on` 的变 `rgb(0,180,42)` 绿色。顺带给图像生成开关补上这个类（它本来就没有）。

⚠️ **教训**：`:global()` 只在 `.module.css` 里有效；写进普通 css 不会报错，规则直接消失。加这类规则后必须在运行时确认它真的在 `document.styleSheets` 里。

### 四、「图像生成」开关没说自己管什么 + 空的「项目」面板

- 该开关控制的是**内置生图 MCP 工具**（助手能不能在对话里自己调生图），而发送框的媒体模式**直连引擎、不经 MCP**——关掉它发送框照样能生图。已补一行说明写清范围。
- 右侧面板在会话无 `project_id` 时返回空 `<div/>`，渲染成一个顶着「项目」标题的空框，看起来像加载失败。已改为说明原因。⚠️ 文案按**有无工作目录**分两种：有目录就点名该目录（那正是人在找的东西）；只有真正没有工作目录时才说「没有文件可浏览」。

### 五、真机验证：项目会话下生成物落在哪（用户的原始问题）

建 workspace 指向 `D:/aionui-m0/media-project-probe` 的会话 → 图片模式 → 发送 → 产物落在 `D:\aionui-m0\media-project-probe\img-1786014183663.png`，与 `README.md` 并排，卡片解码 1254×1254、花费 `≈$0.04`。

**结论：选了工作目录，生成物就落进那个目录。** 此前只是读代码推断，现在有实证。

⚠️ 同一实验暴露一个长期状态：该会话的 `project_id` **始终没有回填**。查因——`bind_project_best_effort` 调的是 `project_service.resolve_existing()`，**只绑定已登记为项目的目录，从不新建**。所以「有真实工作目录但未登记为项目」不是瞬时状态，而是能长期存在的状态，第四节的文案分叉正是为它准备的。

**仍未验证**：项目会话（真正登记过、`project_id` 已回填）下的 Explorer 是否会在新文件出现时自动刷新——探针会话没进到那条分支，该组件一次都没跑到。

## 2026-08-07 收尾之四：媒体模型并回模型选择器（用户拍板的入口方案）

### 一、用户提的两个问题其实是同一个

「图片和视频生成的入口到底在哪？」「我在会话框里看不到这些模型。」

现状：入口是发送框工具行里一个写着**「对话」**的按钮（点开才有图片/视频生成），媒体模型只在 设置 → 能力扩展 → 工具 里配。于是——**用户在设置里给模型标了「视频模型」，然后在会话里再也找不到它，标签像是白标了**；而入口按钮没有任何迹象表明背后有生成模式。

三条抱怨指向同一个根因：**存在两个平行的模型概念**（聊天模型在选择器里、媒体模型在设置里），而用户只被告知了一个。

### 二、方案：一个选择器回答一个问题

用户在三个方案里选了「媒体模型并回模型选择器」。选择器现在分三组：

```
openai            ← 聊天模型（原有分组，按 provider）
图片生成          ← gpt-image-2 / doubao-seedream-5-0-pro
视频生成          ← seedance-2-0-fast / seedance-2-0-pro
```

**选中媒体模型不设置聊天模型**（对它们发 chat 请求必 404），而是**把发送框切进对应生成模式并使用该模型**。反过来，选一个聊天模型会**退出**生成模式——否则就成了一个能进不能出的入口。

判定沿用 `isMediaGenSupported()`（与设置页、与执行路径同一个谓词），所以「选择器里能选的」和「运行时能跑的」不会漂移。

### 三、技术难点：选择器在头部，模式 state 在发送框

两者是不同平台外壳挂载的**兄弟节点**。上半段为了让头部 pill 反映模式，已经建了极小的外部 store（`mediaModeStore`），本轮把它由单向改为**双向**：新增 `requestMediaMode()` + `useMediaModeRequest()`，`useMediaComposer` 订阅并应用。

⚠️ **请求带 `seq` 且只应用一次**。没有它的话，用户手动切回对话后的任意一次重渲染都会把旧请求重新应用一遍，跟用户抢发送框的控制权。

### 四、真机验证

- 下拉出现三个分组，媒体模型各就各位（聊天组里**没有**它们）。
- 点「视频生成 › seedance-2-0-fast」→ 模式按钮变「视频生成」、chip 显示模型、预估 `≈$1.00`、placeholder 切换、退出按钮出现。
- 点回「kimi-k2-6」→ 模式回「对话」、placeholder 回到对话态。

⚠️ **未验证**：媒体模型在下拉里的**选中勾选标记**（代码里写了 `activeMediaId`，但我的 DOM 查询没匹配上 Arco 的标记方式，只在代码层面确认）。

### 五、范围边界

本轮只改了 **aionrs 会话**的模型选择器（媒体模式和 `useMediaComposer` 就活在那条链路上）。**ACP 会话的选择器未改**——它列的是 CLI 下发的模型而非 provider 模型，媒体模型不天然属于那个列表，需要单独设计。**欢迎页也未加**（那时会话不存在，job 无处归属；用户选的是方案一，方案三「欢迎页也能发起」未在本批）。

## 2026-08-07 收尾之五：交接文档 §5 四项待办 + 一个发版级缺陷

按交接文档 §5 的优先级顺序做完四项。中途撞到一个**比这四项都严重、且与媒体无关**的缺陷，先修它才能验证第 1 项。

### 一、前置验证：agent 的上下文到底从哪来（§5 第 1 项的分水岭）

交接文档说方案 A/B 的取舍取决于「agent 下一轮的上下文是从 DB 历史重建，还是活在会话/CLI 自己的 transcript 里」，并注明只有线索、没有正面确认。**已钉死：不是 DB。**

- 代码：`manager/aionrs/agent.rs::send_message` 只把**本轮**内容块交给 `engine.run_with_blocks`；历史来自 `factory/aionrs.rs:133` 的 `SessionManager::load(conversation_id)`，读的是磁盘会话文件。
- 磁盘实证：`%APPDATA%\1one-Dev\1one\aionrs-sessions\sessions\<id>\state.json` 里逐条存着该会话的 user/assistant 消息。
- `insert_raw_message()` 全仓**唯一**生产调用点是团队适配器；`list_messages` 只服务 UI 路由。

⚠️ **第一次查错了目录**：先看的是打包版 `%APPDATA%\1ONE Code\...`，dev 用的是 `1one-Dev`。结论没变，但"正面证据"一度取自错误的安装。**查磁盘证据前先确认跑的是哪个 userData 目录。**

**所以方案 A（往消息表写一条）无效**——UI 会显示，agent 永远看不到。

### 二、⚠️ 发版级缺陷：带文件发消息一律 400（本轮最重要的一条）

验证第 1 项时端到端不通，追下去**根因不在媒体功能**：

| 事实                           | 证据                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 后端只收 `files: Vec<String>`  | `aionui-api-types/src/conversation.rs`，全仓仅此一处定义，`send_msg` 路由确实绑它                                                                            |
| Rust 侧没有 `ChatFileRef` 概念 | grep 零命中                                                                                                                                                  |
| 前端恒发标签对象               | 实跑 `collectChatFileRefs`：上传 lane→`{kind:'upload'}`、本地选择器→`{kind:'upload'}`、Explorer→`{kind:'project',pe_id,…}`，**没有任何一条 lane 产出字符串** |
| 对象必 400、字符串才 202       | 直打端点四种变体实测                                                                                                                                         |
| dev 库从无成功附件             | 20 个会话里带 `[Attached files]` 的只有探针那条；打包版有 6 条（打包版前端更老，还在发字符串）                                                               |

**来源**：上游 `26a2e72e8 feat(explorer): project-scoped Explorer (#3763)` 前端合了、**后端那一半从没合进 1oneCore**。`chatFile.ts` 里「Mirrors the aioncore ChatFileRef serde shape — the backend is the source of truth」对当前 1oneCore **不成立**。

**修法**（1oneCore）：`files` 改成 `#[serde(untagged)]` 枚举同时收裸字符串与标签对象；`upload`/`local` 取 path，`project` 走**本来就存在的** `ProjectService::resolve_reference`（`pe_id`→绝对路径，带 containment 校验）。解析在 `ConversationService::send_message` 边缘一次完成，下游 `SendMessageData.files: Vec<String>` 契约不变。未知 `kind` 仍然 400（有测试钉死，否则会被 untagged 静默吞成"没有附件"）。

⚠️ 我一度报告「`resolve_reference` 不存在」是**错的**——grep 时 `pe_id` 匹配到了 `scope_id` 又被 `head -8` 截断。**组合 grep 出来的"不存在"必须单独复查再下结论。**

**改完必须 `backend-rebuild.ps1` 重编内嵌**（dev 跑的是 bundled exe）。真机复验：裸字符串 202、标签对象 202、`kind:"wat"` 400。

### 三、§5 第 1 项：agent 看得见发送框生成的结果

方案 B，但**做成可见的**而不是往 prompt 里塞隐藏上下文块：结果卡片加「引用到输入框」，把资产走 `<platform>.selected.file.append` 交给发送框，显示为**可删的附件 chip**，下一轮由后端拼成 `[Attached files]` 送达 agent。

- 不自动附加：会给下一条消息悄悄加钱，批量生成时还会堆一排 chip。
- 真机铁证：点按钮 → 发「这张图画的是什么」→ agent 答「**一只戴着白色宇航员头盔的可爱卡通橘猫。**」，正是发送框媒体模式生成的那张；会话 `state.json` 里能看到 `[Attached files]` + 绝对路径。

### 四、§5 第 3 项：ACP 选择器媒体分组

CLI 模型与 provider 模型两种来源共存：**有媒体模型时**才加分组标题（`CLI 模型` / 图片生成 / 视频生成），没有则保持原样的扁平列表，不平白多一个标题。

⚠️ **桥接锁定态原本完全够不着**：`isBridgeLocked` 会提前 return 一个无下拉的只读 pill，而用户只要开着 Claude/Codex 桥接，**每个 ACP 会话都是这种**——分组等于死代码。已单独处理：锁定的是**聊天模型**，媒体模型不设聊天模型，所以锁定态给一个只含媒体分组的下拉，并保留"模型由 X 桥接固定"的说明。真机验证两条路径都出得来。

### 五、§5 第 4 项：欢迎页生成入口（用户拍板要做）

`建会话 → 起 job → 导航`，job 天然归属新会话（直接起会挂到 workspace，正是要避免的"东西跑到别处"）。`submit` 加了 `conversationIdOverride`，因为欢迎页发送那一刻会话才存在。

两个真机才暴露的坑：

1. **`handleSend` 的 `useCallback` 依赖数组漏了 `media`** → 闭包锁死在初始 `mode:'off'`，点发送毫无反应也无报错。
2. **建会话必须带 `type`**，否则 400 `Either type or assistant.id is required`。选 `aionrs`：它是唯一接受顶层 model 的类型，且其发送框带媒体模式，续做"再来一张/让它动起来"不用切任何东西。

真机：欢迎页切图片模式 → 发送 → 建会话 + 出图 + 导航，卡片已完成。

### 六、§5 第 2 项：Explorer 自动刷新 —— **部分结论，未完成**

- ✅ **交接文档说「探针会话 project_id 从未回填」是错的**：库里有 14 个项目、21 个会话已绑定，`media project probe` 绑到 `D:/aionui-m0/media-project-probe`。绑定走 `service.rs:1889` 读时惰性回填，且**回填后本次响应仍返回旧行**，要再读一次才看得到——我一度据此误判成"没绑定"。
- ✅ Explorer 是**文件系统监听驱动**（`fs/subscribe` → `fs/delta` → `applyServerDelta` 处理 `added`），机制上不需要任何媒体侧接线。
- ✅ 产物确实落进所选项目目录（22:25 生成的 `img-1786026339468.png` 在盘上）。
- ❌ **没有观察到树的实时更新**：这一轮始终没能把右侧 Explorer 面板点开（一度把视频卡片上的文件名误判成树内容）。**结论仍是未验证**，接续者需要先解决面板打开方式。

### 七、用户在过程中提出的界面问题（都已改）

1. **媒体控件是方角**，夹在一排圆角 pill 中间很突兀 → 全部换成邻居共用的 `RuntimeSelectorPill`（`shape='round'` + `sendbox-model-btn`）。
2. **参数面板太差**（八个尺寸挤成一条）→ 改为按能力分区、每区等宽网格；比例带按真实宽高比绘制的小矩形；数量改成 1..maxN 一排（原来是 `InputNumber`）；时长带单位（`5s`，避免在"数量"旁边读成个数）。
3. **参考图**：`inputUris` 三个适配器**本来就都消费**（图生图 / 多模态 / 图生视频），发送框也一直在传——**纯粹是没有入口**。已加：媒体模式下 placeholder 明说可附参考图（按 `spec.params.imageInput` / `imageToVideo` 决定是否提示）、`+` 菜单文案改「添加参考图」、设备选择器 `accept=image/*`、并隐藏该模式下无意义的技能/MCP 项。
4. **非图片文件会被当参考图发出去**（用户问"传 PDF 会怎样"）→ 新增 `common/media/referenceInputs.ts`，发送前按扩展名过滤并提示忽略了哪几个。**过滤放在发送路径而不是选择器**：文件也可能来自拖拽、粘贴、Explorer。

### 八、真机验证结论（本轮）

| 能力           | 结果                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| 文生图         | ✅                                                                                   |
| **图生视频**   | ✅ `refs:1 → done`，出片                                                             |
| **图生图**     | ❌ 网关 400 `failed to parse request body: invalid character '-' in numeric literal` |
| 附件送达 agent | ✅                                                                                   |
| 欢迎页发起生成 | ✅                                                                                   |

⚠️ **图生图失败不是本仓的 bug**：适配器按 OpenAI 规范用 `createImageEdit`（multipart → `/v1/images/edits`），而网关回的是 Go 的 JSON 解析错，即**该网关的 edits 路径不吃 multipart**。和 Seedance 那次同类——网关有自己的形状，**不能猜**（AGENTS.md 明令）。需要用户测试台「GPT Image」标签页「Code」按钮里的真实请求契约。

**校验**：tsc 0 / lint 0 error / check-i18n 通过 / 前端全量 **3182 绿 0 失败**；1oneCore `aionui-api-types` 544 绿、`aionui-conversation` 423 绿，fmt + clippy 干净。

## 2026-08-07 收尾之六：Explorer 的真因、落点缺陷、以及界面四改

### 一、⚠️ 项目 Explorer 在这个 fork 里**整个后端都不存在**（这才是 §5 第 2 项的答案）

上一轮只能说"没验证到"。这轮追到底了，结论比"未验证"严重得多：

| 层                                 | 1oneCore 现状                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `ConversationResponse.project_id`  | **没有这个字段**（`storage.ts:175` 的前端注释明写「from `ConversationResponse.project_id`」） |
| `/api/projects/*` 控制面           | **0 处路由**                                                                                  |
| `fs/subscribe` / `fs/delta` 数据面 | **0 处**                                                                                      |

链路是这样断的：响应不带 `project_id` → `setCurrentProject(null)` → `ProjectPanelHost` 直接 `return null` → **面板从来不渲染**。这是上游 `26a2e72e8`（#3763）**第三次**同款：前端合了、后端没合（前两次是 `model_kind` 三字段被 serde 丢弃、`ChatFileRef` 契约）。

**本轮做过又刻意回退的一步**：给 `ConversationResponse` 补 `project_id`/`folder_id` 并映射，重编后真机确认**面板第一次渲染出来了**（`hostPresent:true`、221px、「文件/变更」页签）。但 `GET /api/projects/{id}` 返回 **404 Route not found**，树永远是空的——而 `ChatSlider` 一旦看到 `project_id` 就从"有解释的空面板"切成"没有解释的空树"，**今天净负面**。故回退，字段应当与后端控制面/数据面**一起**落地。

⚠️ 顺带纠正一处既有注释：`ChatSlider` 里写着「`bind_project_best_effort` 只绑定已注册的项目，从不创建」——**不成立**。`resolve_existing → resolve_core` 在没有项目时会原子创建，库里 14 个项目、21 个会话已绑就是证据。那条空状态文案是为了绕过缺失字段而写的，不是关于会话的事实。

**接续者要做的是一个完整特性**（移植上游 stage-3 Explorer 后端），不是补个字段。

### 二、生成物落点缺陷：没给工作目录就写进应用当前目录

`mediaJob/index.ts` 的 `input.workspaceDir || process.cwd()`。dev 下 `cwd` 是仓库根——这轮欢迎页测试真的往 `1oneUI/` 根写了一张 png；**打包后会是 exe 的启动目录，可能是 Program Files**。

- 兜底改为应用自己的 `workDir`（`getSystemDir()`），并且**惰性 require**：`initStorage` 会把整个设置/桥接模块图拉进来，直接 import 会打断只 mock 了其中一部分的 `mediaMcpServer.integration` 测试（已实际踩到并修）。
- 欢迎页改为用**后端实际分配的工作目录**（`conversation.extra.workspace`）而不是用户可能为空的选择。

### 三、界面四改（均由用户看真机截图提出）

1. **原生文件对话框仍是"所有文件 (_._)"** —— 我上一轮的 `accept='image/*'` 只作用于 WebUI 的 `<input>`，Electron 走的是 `dialog.showOpen`，得传 `filters`。`useOpenFileSelector` 加 `imagesOnly` 参数，媒体模式下按 `IMAGE_EXTENSIONS` 过滤。
2. **欢迎页的 `+` 是自己实现的**（`GuidActionRow`，不走 `FileAttachButton`），所以「添加参考图」文案与图片过滤要**在两处各写一遍**。⚠️ 接续者改附件入口时记得有两套。
3. **激活态填充色改绿**：原来用 `type='primary'`（蓝），而这一行其它 pill 选中态也是蓝，读起来像"被选中"而不是"已武装、下一次回车要花钱"。
4. **文本文件当提示词**：刻意**不**支持"读取附件内容拼进提示词"——那会让实际发出的提示词与输入框里显示的不一致，正是本条工作线一直在避免的隐藏注入。改为把话说清楚：「{{files}} 不是图片，已从参考图中忽略。提示词只取输入框里的文字，附上的文本文件不会被当成提示词读取。」

**共用面的覆盖确认**：`MediaModeControl` 由 ACP / aionrs / 欢迎页三处共用，所以圆角 pill、参数面板、退出按钮、绿色激活态**三个界面同时生效**；只有 `+` 附件入口是两套实现。

**校验**：tsc 0 / lint 0 error / check-i18n 通过 / 前端全量 **3182 绿 0 失败**。

---

## 2026-08-07 收尾之七：模式切换请求残留，重挂载时把用户拽回已退出的模式

核对交接文档时顺带审这条线的代码，在 `mediaModeStore` 里查到一个**用户可见、可复现**的缺陷。

### 根因：`seq` 防得住重渲染，防不住重新挂载

模型选择器把「切进图片/视频模式」作为一条 request 写进 store，送框（`useMediaComposer`）订阅并应用。为避免重复应用，request 带 `seq`，composer 用 `appliedRequestSeq` 这个 **`useRef`** 记住最后应用过的那条。

问题在于两件事凑在一起：

1. `requests` 这个 Map **只写不删** —— `clearMediaModeSnapshot` 在卸载时只清了 `snapshots`，没碰 `requests`；
2. `appliedRequestSeq` 是 ref，**跟着组件实例一起死**。

于是送框一旦卸载重挂（切到别的会话再切回来、HMR 重载），ref 归零而那条早已应用过的 request 还躺在 store 里，`request.seq !== 0` 立刻成立 → **旧请求被第二次应用**。

用户视角：在会话里选了视频模型 → 手动点「退出生成模式」回到对话 → 切走再切回来 → **送框自己又跳回视频模式**。这正是原注释里声称要防止的「跟用户抢送框的控制权」，只是防漏了一半。

### 修法：request 是一次性指令，应用后消费掉

新增 `consumeMediaModeRequest(conversationId, seq)`，composer 应用完即调用。**按 `seq` 匹配后再删**，这样在 effect 运行与消费之间新到的请求不会被误删（否则会静默吞掉用户最近一次选择）。ref 守卫保留，作同一实例内的双保险。

### 教训：这个缺陷卡在测试的缝里

`mediaModeStore.dom.test.ts` 本来就有 11 条测试，覆盖了 seq 递增、会话隔离、卸载清理——**唯独没有一条问「应用之后请求还在不在」**。补 4 条（含按真实方式建模的 remount 回归：卸载旧 hook、新建一个订阅）。

⚠️ 并且**做了负向验证**：把 `requests.delete` 临时注释掉重跑，确认正是那两条关键用例失败。测试绿本身不是证据，能抓到 BUG 才是。

**顺带修掉仓库卫生问题**：`outputs/`（含媒体生成产物与 3.5MB pptx）和 `.workbuddy/` 一直未被 `.gitignore` 覆盖，长期躺在未跟踪列表里——一次 `git add -A` 就会把多 MB 二进制提交进仓库，正是 §10.5 那条教训的现实版。已加根锚定规则。

**校验**：tsc 0 / lint 0 error / check-i18n 通过 / 前端全量 **3186 绿 0 失败**（较上一轮 +4，即本轮新增的 4 条）。

---

## 2026-08-07 收尾之八：发送框那一行的三处体验问题（用户真机截图提出）

### 一、生成模式下同屏两个模型，而且叠在一起

欢迎页进视频模式后，左边参数 pill 写着 `seedance-2-0-fast`（真正会跑的），右边模型选择器写着 `doubao-seed-evolving`（这次发送根本不参与）。**两个指示器对「我按下回车用哪个模型」给出互相矛盾的回答**——正是 §4 那个单一选择器决定要根除的问题。

**根因**：会话内两个选择器（ACP / aionrs）都做了媒体感知，**唯独欢迎页的 `GuidModelSelector` 一行相关代码都没有**。⚠️ CLAUDE.md 里那句「~~ACP 选择器与欢迎页未做~~ → 已完成」不准确：欢迎页完成的是**生成入口**（建会话→起 job→导航），不是选择器媒体分组。

改为生成模式下不渲染聊天模型选择器（`GuidActionRow.showModelSelector`）。判断放在工具行而非 `GuidPage`——「这一行怎么排」本就是它的职责，而且它有独立测试可以直接驱动（`GuidPage` 那份测试没 mock `useMediaComposer`，而欢迎页 `conversationId` 是 `undefined`、`mediaModeStore` 的 request 机制对它无效，驱动模式的成本高得多）。

**叠在一起是另一半原因**：CSS 里那条 `min-width: 0` 只覆盖了右侧的 `.actionConfigGroup`，**左侧 `.actionTools` 里的 pill 没有对应约束**，而 Arco 按钮是默认 `min-width: auto` 的 flex item，拒绝收缩到内容宽度以下——于是参数 pill 保持原宽**溢出**、直接画在模型选择器上，而不是截断。`MarqueePillLabel` 本来就会截断 + hover 跑马灯，缺的只是祖先链上的宽度约束。约束加进 `MediaModeControl.module.css`，三处宿主一并受益。

### 二、对话模式顶着图片图标

图标由 `mode === 'video' ? VideoTwo : Picture` 选出，**`off` 和 `image` 落进同一分支**——收起态的「对话模式」与下拉里的「图片生成」图标完全一样，三个模式只有两个图标。改为一模一图（`off` = `Message`），菜单项也补上同一套，让选中的行与之后看到的 pill 是同一个东西。

⚠️ `renderModeIcon` **必须声明在 `modeMenu` 之前**：菜单构建 children 时就会调用它，放后面是 TDZ（§6.1 同类坑）。

### 三、「对话」改为「对话模式」（用户建议）

触发器与下拉首项**共用 `mediaModeOff` 这一个 key**，所以收起时它就是一句自我说明——此前只写「对话」，没有任何迹象表明背后是个模式切换器（`DreamEngineModelSelector` 里那句注释当时就写着 _a button labelled "对话" that gave no hint of what was behind it_，但只解决了"媒体模型并回选择器"那一半）。13 种语言按各自习惯翻译（`Chat-Modus` / `Modo chat` / `チャットモード` / `Режим чата` …）。

**测试**：新增 4 条，均做过**负向验证**（把修复分别改回坏逻辑重跑，确认正是这几条失败）。

**真机 CDP 复核**：对话模式 `iconClass=i-icon-message`、文案「对话模式」、工具行 3 个 pill 含模型选择器；视频模式 4 个 pill 无模型选择器，四者横向区间 `551-677 / 683-931 / 1007-1036 / 1108-1218` 两两不相交，重叠消失。

**校验**：tsc 0 / lint 0 error / check-i18n 通过 / 前端全量 **3190 绿 0 失败**（+4）。

---

## 2026-08-07 收尾之九：打通专家 agent 与媒体模型（用户拍板方向，我提了一处修正）

用户提出：**以前专家不能调媒体模型，是因为那时候图片/视频能力还没做好；现在做好了就该打通**——配了专业媒体模型就用，没配就回落专家原来的方式。

### 一、声明的媒体模型此前对 agent 完全不可见（核心缺口）

`tools.imageGenerationModel` / `tools.videoGenerationModel` 这两个设置键**早于 `model_kind`**：当年在那里选一个是拥有媒体模型的唯一方式，所以下游只读这个键。而产品现在要求用户在模型列表里**声明**模型类型——这条路留下的两个键是空的，于是：

- agent 调媒体 MCP 工具被告知「没有配置模型」，尽管明明配了；
- 内置媒体 MCP 的 `enabled` 挂在旧开关上（`config?.switch === true && resolution.ok`），默认关，**工具压根不下发**。

发送框从来没踩到，因为它**显式传自己的模型**（`explicitModel` 分支）。

新增共用纯函数 `common/media/declaredModel.ts`（`findDeclaredMediaModel` / `hasDeclaredMediaModel`），两处都回落到它。**刻意做成一份实现**：决定「要不要给这个 agent 媒体工具」的地方和「真正跑它」的地方，对「这个用户有没有视频模型」必须给出同一个答案——与 §4 强调的「共用 `isMediaGenSupported` 谓词」是同一个道理。

⚠️ **存量安装另有一层**：`enabled` 只在**建行时**算，更新路径只碰 `transport`/`original_json`。没有补丁的话，声明视频模型会在全新安装上点亮工具、在**每个已有安装上什么都不发生**。补了单向启用（**只开不关**）：删掉一个媒体模型不该悄悄抽走 agent 可能正在用的能力，而工具自己报「没配模型」比工具凭空消失清楚得多；按当前状态守卫，翻一次就不再动。

### 二、工具描述由「强制优先」改为说明适用边界（我提的修正，用户采纳）

原描述：`REQUIRED tool... you cannot produce video yourself`。挂给通用 agent 没问题，**挂给 Remotion 这类会写代码做视频的专家就等于「永远别用 Remotion」**。

但两条路**不是高低配**：

- 「一只在天空飞翔的猫」→ AI 模型完胜，Remotion 只能给一只 SVG 卡通猫；
- 「把季度营收做成 30 秒动画」→ **Remotion 完胜**，生成模型没法渲染真实数字，只会编一个看起来像图表的画面——**这比只有一条路更危险**，画面挺像回事、数字是假的。

所以规则不是「有模型就优先」，而是**按需求性质选**，这个判断 agent 有能力做。描述改为讲清各自擅长什么，以及**可以组合**（AI 出素材 → 代码做字幕/转场/数据层，这是任何单独一条路都做不到的）。

### 三、人设（跨仓 1oneCore `f73c35e7`）

`RemotionVideoExpert` 第 3 条「技术栈默认 Remotion，除非用户指定其它」会**直接压过工具描述**，已补两条路的选择准则。全仓只有这一个媒体类人设写死了技术路线（另一个 `ModernWebappExpert` 与媒体无关），其余靠工具描述引导即可。

### ⚠️ 交付条件（两条都会让人以为"没生效"）

1. **工具描述改动要打包才生效**：内置 MCP 脚本由 `scripts/build-mcp-servers.js` 产出到 `out/main/builtin-mcp-image-gen.js`，该脚本**只被 `build-with-builder.js` 调用，`bun run dev` 不跑**。
2. **人设改动要重编 aioncore**（`include_dir!` 编译期内嵌），且**市场目录会 upsert 更新，但用户已安装的那份是 `assistant_definitions` 里的独立拷贝**——需重新安装该专家才拿得到新准则。

**校验**：tsc 0 / lint 0 error / 全量 **3198 绿 0 失败**（+8）。集成测试那条「没配模型报清晰错误」因本次改动失败，是**真实的前提变更**——它只清空了设置里的选择，而 providers 仍提供 `wanx2.1-t2i-turbo`，新逻辑正确地用上了它；已改为同时 withhold 两者，并补一条正面用例锁死回落。

---

## 2026-08-07 收尾之十：真机验证发现打通还差一层（内置 MCP 从不进会话）

用户要求「把这个会话做的事情全部测试验证一遍」。为此**重启了 dev app**（主进程改动只在启动时跑 migration，HMR 只重编 `out/main` 不重启进程）并**手动跑了 `node scripts/build-mcp-servers.js`**（该脚本只被打包流程调用，dev 不跑）。

### 一、UI 三项全部真机通过

| 项                   | 实测                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| 文案                 | 「对话模式」                                                              |
| 对话模式图标         | `i-icon-message`（不再是 picture）                                        |
| 下拉三项图标         | `message` / `picture` / `video-two`，**各不相同**                         |
| 视频模式布局         | 4 个 pill 区间 `410-536 / 542-737 / 813-843 / 966-1076`，**overlaps: []** |
| 生成模式隐藏聊天模型 | ✅ 4 个 pill 里已无                                                       |
| 媒体 MCP 状态        | `aionui-image-generation` **enabled=True**                                |

顺带坐实：`tools.imageGenerationModel` 的 **`switch: false`** —— 按旧逻辑这个 MCP 本该是禁用的。

### 二、⚠️ 但发现「打通」并没有完成

`enabled=true` **不等于 agent 能用**。两条 agent 路径（`factory/acp.rs:497`、`factory/aionrs.rs:473`）里有同一行：

```rust
if !selected || row.builtin { continue; }
```

**builtin MCP 被显式跳过**，只能靠前端把完整配置塞进会话快照才注入，而那要求它被**显式勾选**。实测视频专家 `mcp_server_ids: null`、MCP 模式「自动记住上次」而上次为空，**库里 12 个会话的 `mcp_server_ids` 全是 `null`** —— 内置媒体工具**从来没进过任何一个会话**。

已补 `withBuiltinMediaMcp`（`c6dfe0e30`）：媒体 MCP 跟着**自己的 `enabled`** 进会话快照（enabled 已经跟随媒体模型，是同一个真相源）。**刻意只放这一个**——让所有内置默认生效会把 PDF 导出和团队知识库也塞给每个 agent。只改 `useGuidSend` 一处，全仓只有它构造会话 MCP 快照。

**✅ 真机实证**（打通成立的唯一证据）：

```
Injecting MCP servers into aionrs session conversation_id=2bf5aadb
  mcp_count=1  mcp_names=["aionui-image-generation"]
```

### 三、方法论：这一层是怎么被抓到的

不是靠读代码想出来的，是**先查真实数据再回头读代码**：先 `curl /api/mcp/servers` 看 enabled、再 `curl /api/conversations` 看每个会话的 `mcp_server_ids` 全是 null，**数据对不上**才回头去后端找那行 `continue`。如果只做「改完跑测试」，这一层永远不会暴露——单测里没有"会话快照"这个概念。

**校验**：tsc 0 / lint 0 error / 全量 **3205 绿 0 失败**（+7）。
