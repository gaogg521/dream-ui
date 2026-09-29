# 语音转文字：阿里云托管默认 + 删除 OpenAI/Deepgram 官方预设（2026-09-29）

> 本文自包含，承接
> [handoff-2026-09-28-speech-input-model-settings.zh-CN.md](./handoff-2026-09-28-speech-input-model-settings.zh-CN.md)。
> 那份文档描述的"自定义(OpenAI兼容)"与"模型设置中的语音模型"两条路径已在本轮验证可用；本文记录
> 在此基础上新增的"内置(默认)"托管转写、以及彻底删除 OpenAI/Deepgram 官方预设选项的改动。

## 1. 背景与动机

用户要求：语音转字要"开箱即用"——新装机器、从未碰过语音设置的用户，聊天框麦克风也要能直接用，
不需要先去设置里配置任何 API Key。同时要求彻底删除"OpenAI(官方)"和"Deepgram(官方)"这两个来源
选项（不只是从下拉里隐藏，是连同后端整条代码路径一起删）。

参考的是本仓库已有的"内置联网搜索"(mode C) 先例：真实 vendor key 不进客户端（Electron `asar` 可
解包，公开仓库 = 公开的 key），而是放在公司自己运维的 broker（`dream-trial-broker`）上，客户端只
发请求过去。语音转写照抄这个模式，称为 mode D。

## 2. 验证阿里云真实 API 形状（关键教训）

用户给的阿里云凭据里 `model: qwen3-asr-flash`，直觉上应该打 OpenAI 兼容的
`POST /v1/audio/transcriptions`（跟"自定义(OpenAI兼容)"用的是同一条路径）。**实测是 404**——
用真实 key 直接 curl 验证，而不是假设"标了音频模型就等于实现了这个接口"（这正是
[session-2026-09-28 handoff 文档](./handoff-2026-09-28-speech-input-model-settings.zh-CN.md) 第 53
行早就提醒过的运行时限制）。

真正能用的是 DashScope 自己的 `multimodal-generation` 聊天式接口，音频以 `data:` URI 塞进一条
消息里：

```bash
curl -X POST "https://<workspace-host>/api/v1/services/aigc/multimodal-generation/generation" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"qwen3-asr-flash","input":{"messages":[{"role":"user","content":[{"audio":"data:audio/webm;base64,..."}]}]}}'
```

用真实合成语音（Windows `System.Speech.Synthesis` 生成的 wav）+ 真实静音样本都验证过：

- 静音 → `content: []`（空数组，没有 `text` 字段——不是空字符串，是**没有这个字段**）；必须处理成合法的空转写，不能当错误。
- webm/opus 和 wav 两种容器都直接可用，不需要客户端/服务端转码。

## 3. 三仓改动总览

| 仓库                 | 改动                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dream-trial-broker` | 新增 mode D：`POST /v1/stt`，持有阿里云 key，按 install_id 配额（默认每设备 20 次/天、全局 2000 次/天），已部署生产并用真实请求验证通过                                                                                                                                                                                                   |
| `dream-core`         | 新增 `SpeechToTextProvider::Hosted` + `HostedSttService`；**删除** `SpeechToTextProvider::Deepgram`、`DeepgramSpeechToTextConfig`、`stt_deepgram.rs`、`stt_stream_deepgram.rs`；`load_stt_config` 在"完全没存过配置"时默认返回 `{enabled: true, provider: Hosted}`（前提是这套部署确实配了 broker，开发环境没配就还是禁用，不会假装能用） |
| `dream-ui`           | 设置面板"服务来源"下拉从 4 项（OpenAI官方/Deepgram官方/自定义/模型设置）改成 3 项（内置默认/自定义/模型设置）；聊天框麦克风零配置可用；`DEFAULT_SPEECH_TO_TEXT_CONFIG` 默认值本身就是 `{enabled:true, provider:'hosted'}`                                                                                                                 |

## 4. 顺带修的一个真实 bug（用户明确要求核查"自定义"模块）

`stt_openai.rs::transcribe`（以及流式路径 `stt_stream_openai.rs::connect`、`stt_stream.rs::validate_config`）
原来不管来源，只要 `api_key` 为空就直接拒绝——但设置面板对"自定义(OpenAI兼容)"这个来源明确把
API Key 标成"可选"（自建的 OpenAI 兼容服务很多不需要鉴权）。三处都改成：**只有 base_url 为空
（即打官方 api.openai.com）时才强制要求 key**；自定义端点允许空 key 直接发请求，让对方真实的
401/其他错误浮现出来，而不是被前端拦在"未配置"这一步。

## 5. 前端"零操作默认生效"的落地方式

不是加一个"内置(默认)"开关让用户去点——而是让**没有任何持久化配置**这件事本身，在前端和后端
两侧都解释成"已启用 + 使用内置转写"：

- 后端 `load_stt_config`：`prefs.get("tools.speechToText")` 两个 key 都查不到时，如果
  `hosted_stt_service.is_configured()`（即 `DREAM_TRIAL_BROKER_URL` 有值——打包版天生就有，见
  `dream-ui/packages/web-host/src/backend-launcher.ts::resolveTrialBrokerUrl`），直接返回
  `{enabled: true, provider: Hosted}`。
- 前端 `speechConfigDefaults.ts`（从原来的 `VoiceInputSection/speechSettingsUtils.ts` 里提出来，
  单独放到 `renderer/services/speech/` 下，因为聊天框的 `SpeechInputButton.tsx` 现在也要用它，
  不该反过来 import 设置模块内部文件）：`DEFAULT_SPEECH_TO_TEXT_CONFIG` 本身就是
  `{enabled: true, provider: 'hosted'}`；`SpeechInputButton.tsx` 判断麦克风是否可用时用
  `normalizeSpeechToTextConfig(config).enabled`，不再对裸的 `config?.enabled` 做真值判断——
  否则 `getClientBusinessSetting` 在没存过值时返回 `undefined`，`undefined?.enabled` 恒为
  `false`，零配置这条路就废了。

两边必须一致：后端"没配置=用内置"、前端"没配置=显示已启用+内置"，只改一边会出现"设置里显示
已启用，点麦克风却提示未配置"或反过来的不一致。

## 6. 上线后当场翻车：存量配置（本轮最重要的一节）

上面第 5 节做完、真机验证也过了之后，用户一打开就报错：**设置页语音转文字开关是绿的、来源显示
"内置（默认）"，点麦克风却弹"语音转文字尚未配置"**。

查后端日志（`D:\logs\<年>\<月>\<日>\*.dreamcore.log`）看到的真相：

```text
client_preference_read key=tools.speechToText found=true
http response POST /api/stt status=400 latency_ms=0
```

`found=true` + 0 毫秒 = 根本没走到转写，是 `load_stt_config` 阶段就判负。直接读那台机器上实际存的值：

```json
{
  "enabled": true,
  "provider": "openai",
  "openai": { "api_key": "", "base_url": "", "language": "", "model": "gpt-4o-transcribe" }
}
```

**根因**：第 5 节只让前后端对齐了"**压根没有记录**"这一种情况，漏了"**记录存在、但它指向的来源已经
被我删掉了**"。而这恰恰是绝大多数存量用户的状态——语音设置面板从 v3.0.0 就随正式版发布，
**旧版默认配置写的就是 `{enabled:false, provider:'openai', base_url:'', api_key:''}`，用户只要把总开关
拨一下，这条记录就落盘了**。于是：

- 前端 `deriveSpeechSource` 的兜底是"不是 hosted、base_url 又是空 → 当 hosted 显示"，所以 UI 一切正常；
- 后端 `load_stt_config` 看到键存在，跳过零配置分支，把 `provider:"openai"` 按字面当官方 OpenAI 端点，
  空 Key → `STT_OPENAI_NOT_CONFIGURED`(400) → 前端映射成 `not-configured` → 那个 toast。

Deepgram 用户更隐蔽：枚举变体删了又没留 `serde(alias)`，`provider:"deepgram"` 直接反序列化失败，
落进 malformed 分支变成 `{enabled:false}` → `STT_DISABLED` → **同一个 toast，不同根因**。

**修法（两侧同时改，缺一侧就又不一致）**：

- 后端 `is_legacy_unusable_config`（`dream-core-shell/src/routes.rs`）：键存在但它命名的来源本构建已无法提供
  （`provider:"deepgram"`，或 `provider:"openai"` 且 base_url、api_key 双空），等同于"没配置" → 走 hosted。
  **刻意不含**"空 base_url + 真实 api_key"：那个用户的官方 OpenAI 转写现在还能用，把他悄悄挪到共享的
  托管额度上才是回归。带 `modelProviderId` 的同样不动。
- 前端 `migrateLegacySpeechSource`（`speechSettingsUtils.ts`）：加载时做同样的替换，**并且把"带真实 Key 的
  官方 OpenAI"迁成指向 `https://api.openai.com/v1` 的自定义端点**——否则删掉官方来源后，那把 Key 在 UI 里
  再也看不见、改不了（`deriveSpeechSource` 也同步改成"有 Key 就算 custom"）。

⚠️ 前端这个迁移里有一个我自己第一版写错、复查才抓到的坑：**判断顺序不能先看 openai 子配置**。老 UI 的
OpenAI 和 Deepgram 是两套独立子配置，切来源时都保留，所以"用 Deepgram、但以前试过自定义 OpenAI 地址"
的用户身上 `provider:'deepgram'` 和一个非空 `openai.base_url` 会同时存在。先看 base_url 就会把他判成
custom，而后端看 `provider=="deepgram"` 判成 hosted——**两边又错开了，等于把刚修的 bug 换了个入口重新
制造一遍**。正确顺序是：先判 provider 是不是本构建还认识的来源，再看子配置。

**可复用的判据**：任何"没配置就给个默认值"的逻辑，都要分别回答两个问题——「**记录不存在**时怎么办」和
「**记录存在但已经不合法**时怎么办」。只答第一个，第二个就会静默绕过整条兜底路径；而线上绝大多数存量
用户恰恰落在第二个上。这和记忆里 `local-record-loss-bypasses-recovery-branch`（"记录存在但坏"≠"记录压根
不存在"）是同一个陷阱的镜像。

## 7. 换模型：qwen3-asr-flash → qwen-audio-3.0-asr-flash（两条协议 + 静音兜底）

用户要求换用更新的 `qwen-audio-3.0-asr-flash`（2026-07 发布，30 语种，汉语七大方言体系）。
**这不是换个字符串**，实测差异如下（全部对着线上端点验过）：

|                              | `qwen3-asr-flash`（原）                     | `qwen-audio-3.0-asr-flash`（现）                              |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| content 项                   | `{"audio": "data:…"}`                       | `{"type":"input_audio","input_audio":{"data":"data:…"}}`      |
| `parameters`                 | 不需要                                      | **必填**，省掉就是空体 400（值不校验，wav 报成 mp3 照样转对） |
| 响应取值                     | `output.choices[0].message.content[0].text` | `sentence.text`                                               |
| webm/opus（浏览器录音）      | ✅                                          | ✅                                                            |
| 裸 base64（无 `data:` 前缀） | —                                           | ❌ 400，必须是 `data:` URI                                    |
| `X-DashScope-SSE: disable`   | —                                           | 不需要                                                        |
| **静音**                     | **200 + 空 `content`（干净空转写）**        | **400 + 空响应体**                                            |

最后一行是唯一的真问题。`400 + {}` 这个响应**和"请求写错了"完全一样**（实测：缺 `parameters`
也是 `400 + {}`），所以 broker 无法区分"用户没说话"和"我们把请求构造错了"——把它当空转写吞掉，
就会静默吃掉真实的集成 bug。

**解法是给 provider chain 加第二个条目**（`src/stt/mod.rs`，chain 循环本来就是为这个留的）：
主模型 `qwen-audio-3.0-asr-flash`，失败回退 `qwen3-asr-flash`。后者对静音本来就返回优雅的空结果，
于是静音又变回了安静的空转写——**而且存量客户端也被兜住**，它们不会因为我们改了前端就获得静音检测。
协议按模型名前缀选（`qwen-audio-` → 新协议，其余 → 旧协议），所以 `STT_ALIYUN_MODEL` 指到一个
本构建没见过的新快照也能工作。

前端同时加了静音检测（`useSpeechInput.ts::isSilentRecording`）：录音时波形本来就在算 RMS，留下峰值，
整段低于阈值就根本不上传，直接走已有的"未识别到内容"提示。阈值 0.005 刻意远低于人声——**漏判的代价
是一次多余往返（broker 会兜住），误判的代价是吞掉用户一句话**。

线上验证（日志为证）：

```text
hosted stt served  provider="aliyun" chars=76   ← 真实语音，主模型直接成功
upstream rejected  status=400 body={}           ← 静音，主模型给出有歧义的空体 400
hosted stt served  provider="aliyun" chars=0    ← 兜底模型接住，干净的空转写
```

⚠️ 静音走兜底会多约 9 秒。已更新的客户端有前端检测、不会发这个请求；存量客户端是"慢但正确"。

**顺带纠正两个我在调研中先说错、后被实测推翻的结论**（留在这里是因为下一个人很可能重蹈）：

1. "阿里云富接口没有模态信息"——**错**。我只看了 `features`（那是 function-calling/cache 这类能力）
   就下结论，实际上同一条记录里有 `capabilities: ["ASR"]` 和
   `inference_metadata.{request_modality,response_modality}`，是精确的机器可读信号。
   但注意：**这是阿里云私有 `/api/v1/models` 才有的**，OpenAI 兼容的 `/v1/models` 确实只有 id。
2. "qwen3-asr-flash 快要下线"——**要下线的是带日期的快照**（`qwen3-asr-flash-2026-02-10`、
   `-2025-09-08`，均 2026-10-10 下线），**不带日期的稳定别名没有下线安排**。判据是模型列表里的
   `inference_offline_info` 字段（518 个模型里 163 个有值，所以 null 是真的"没安排"而不是"没这个字段"）。
   ⚠️ 10-10 之后别名会滚到哪个快照由阿里云决定，行为可能变，那之后应手动验一次。

## 8. 已完成验证

**dream-trial-broker**（生产环境）：

```bash
curl -X POST https://work.1oneclaw.com/trial-broker/v1/stt \
  -H "Content-Type: application/json" -d '{"install_id":"...","audio_base64":"...","mime_type":"audio/wav"}'
# {"provider":"aliyun","text":"Hello, this is a test of speech to text.","quota":{...}}
```

本地单测 + 集成测试 74 个全过；线上真实调用验证过（含一次偶发的首连接 504，重试后 1-2 秒内正常返回，判断是冷启动 TLS 握手，非配置问题）。

**dream-core**：

- 新增/改动的 5 个 crate（`dream-core-shell`、`dream-core-system`、`dream-core-api-types`、
  `dream-core-app`、以及顺手修的 `dream-core-db` 一处测试）单独跑全部通过。
- `cargo test --workspace` 全量跑了两轮：第一轮抓出 2 个还留着 `"provider":"deepgram"` JSON
  字面量的 e2e 测试（编译期看不出来，运行时反序列化失败才暴露，`dream-core-app/tests/shell_e2e.rs`
  - `stt_stream_e2e.rs`）和 1 个跟本次改动无关的预存失败（品牌图标路径断言还停在改名前的值，
    `dream-core-db/src/repository/sqlite_agent_metadata.rs`，顺手修了）；第二轮全绿。

**dream-ui**：`tsc --noEmit`、`oxlint`（改动文件范围内无新增 warning）、`oxfmt` 全过；vitest 已在
交接会话（2026-09-29，全新 clone）补跑：三个语音测试文件
（`speechModels.test.ts`、`speechSettingsUtils.test.ts`、`speechSilenceDetection.test.ts`）
共 41 个用例全过，无 unhandled errors；`node scripts/check-i18n.js` 通过（仅有的 warning 都在
`SessionDeliveryBlock.tsx`/`DigitalEmployeeDetailModal.tsx` 等无关文件的动态 key 上）。

## 9. 自定义来源：从用户填的端点拉取模型列表

"自定义（OpenAI 兼容）"原来只给三个 OpenAI 预设 + 手输。现在填好 Base URL 后可以点「拉取模型」，
复用已有的 `POST /api/providers/fetch-models`（匿名、建渠道前就能调；`platform: 'openai'` 走
dreamcore 的 OpenAI 兼容 fetcher，它按字面往 base_url 后面接 `/models`，正好匹配这个字段要求的
`https://host/v1` 写法）。

**列表只是便利，不是承诺**——这点必须在 UI 上说清楚，实测依据如下：

| 实测项                                          | 结果                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET {阿里云兼容端点}/v1/models`                | 200，261 个模型，标准 OpenAI 形状 `{id, object, created, owned_by}`——**只有 id，没有模态**                                                                               |
| 阿里云自有富接口 `GET /api/v1/models`           | 200，518 个，带 `name`/`description`/`features`；但 `features` 是 function-calling/cache 这类能力，**`qwen-audio-3.1-asr-flash` 的 features 是 `[]`，TTS 模型也是 `[]`** |
| `POST {阿里云兼容端点}/v1/audio/transcriptions` | **404**——公共 `dashscope.aliyuncs.com/compatible-mode/v1` 和工作区专属 `ws-xxx.../compatible-mode/v1` **两个都是 404**                                                   |

也就是说：**阿里云能列出 6 个 ASR 模型，但一个都不能通过 OpenAI 兼容路径调用**——它根本没实现转写
接口，这正是内置（mode D）不得不走 DashScope 私有 `multimodal-generation` 的原因。所以这个功能对
阿里云用户是"列得出、用不了"，UI 上那句"能否用于转写以「保存并测试」为准"不是免责套话，是实测结论。
阿里云的正解是**用内置（默认）**。

名字启发式 `looksLikeTranscriptionModel`（`renderer/services/speech/speechModels.ts`）**刻意比
媒体目录的 `audio` hint 窄**：后者把 `tts`/`voice`/`realtime` 也算 audio，对"这是不是音频模型"是对的，
对转写选择器是错的——把一个 TTS 模型推荐给转写，只是多绕一圈再失败。它只做**排序**，不隐藏任何模型。

## 10. 已知限制 / 后续可做

- Mode D 只做了整段批量转写（`/api/stt`），**没有实时流式**——`stt_stream_provider.rs` 对
  `Hosted` 直接返回 `STT_STREAM_UNSUPPORTED`，前端已有的"流式失败自动退化到整段"逻辑会接住，
  只是慢一点点（多一次协议探测）。要做流式需要接 DashScope 自己的 realtime 协议，工作量不小，
  本轮没做。
- 配额是"次数"而不是"时长"，`MAX_AUDIO_BYTES`(8MB) 是唯一的单次请求成本上限；聊天框正式录音
  没有硬性时长上限（设置页自测按钮有 5 秒上限），理论上一次超长录音仍可能占用较多配额——如果
  以后发现被滥用，加一个客户端侧的录音时长上限比在 broker 上做更精细的计费更简单。
- 阿里云那把 key 是从飞书文档里的一份基础设施凭据表拿的（`feishu.txt`），只写进了生产服务器的
  `/opt/dream-trial-broker/.env`（0600 权限），没有出现在任何 git 仓库里。
