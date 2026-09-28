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

## 6. 已完成验证

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

**dream-ui**：`tsc --noEmit`、`oxlint`（改动文件范围内无新增 warning）、`oxfmt` 全过；vitest 详见
本文档写入时 CLAUDE.md 更新记录（如果这轮还没来得及跑，接手人必须先跑一遍再当作"完成"）。

## 7. 已知限制 / 后续可做

- Mode D 只做了整段批量转写（`/api/stt`），**没有实时流式**——`stt_stream_provider.rs` 对
  `Hosted` 直接返回 `STT_STREAM_UNSUPPORTED`，前端已有的"流式失败自动退化到整段"逻辑会接住，
  只是慢一点点（多一次协议探测）。要做流式需要接 DashScope 自己的 realtime 协议，工作量不小，
  本轮没做。
- 配额是"次数"而不是"时长"，`MAX_AUDIO_BYTES`(8MB) 是唯一的单次请求成本上限；聊天框正式录音
  没有硬性时长上限（设置页自测按钮有 5 秒上限），理论上一次超长录音仍可能占用较多配额——如果
  以后发现被滥用，加一个客户端侧的录音时长上限比在 broker 上做更精细的计费更简单。
- 阿里云那把 key 是从飞书文档里的一份基础设施凭据表拿的（`feishu.txt`），只写进了生产服务器的
  `/opt/dream-trial-broker/.env`（0600 权限），没有出现在任何 git 仓库里。
