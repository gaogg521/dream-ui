# 交接：语音输入与模型设置复用（2026-09-28）

> 本文自包含。目标是让聊天输入框的语音转文字在桌面端、WebUI 和移动端可用，并让它能够直接复用“模型设置”里已配置的语音模型渠道，而不重复保存 API Key。

## 1. 本轮交付范围

已完成但**尚未提交**的改动分布在两个仓库：

| 仓库 | 职责 |
| --- | --- |
| `D:/dream/dream-ui` | 设置界面、聊天输入麦克风、前端配置类型、i18n、DOM 单测 |
| `D:/dream/dream-core` | STT 配置解析、模型渠道凭据解析、OpenRouter URL 兼容、Rust 单测 |

### 已解决的问题

1. 聊天输入框的麦克风此前在未开启语音配置时会直接消失；现在始终显示，未配置时点击进入 `/settings/system`。
2. 语音转写模型下拉框保留预设，但允许手工输入任意模型 ID。
3. 语音设置新增来源“模型设置中的语音模型”。它只列出渠道已启用、模型已启用、且 `model_kind: "audio"` 的模型。
4. 选中模型渠道后，语音配置只持久化 `modelProviderId`、模型 ID 和语言等非敏感项；不会复制渠道的 `api_key` 或 `base_url`。
5. 请求 `/api/stt` 或 `/api/stt/stream` 时，后端根据 `modelProviderId` 即时读取该用户的渠道，确认模型仍可用且为 `audio`，再仅在内存中注入 API Key/Base URL。
6. 自定义 OpenAI 兼容来源填写 `https://openrouter.ai/` 时，后端会归一为 `https://openrouter.ai/api`，最终调用 `/api/v1/audio/transcriptions`，不再请求官网首页并返回 HTML 404。

## 2. 用户操作路径

1. 到“模型设置”，在已有渠道中添加/启用语音模型，并把模型类型设置为“语音模型”。
2. 到“系统设置 → 语音转文字”，打开开关。
3. “服务来源”选择“模型设置中的语音模型”。
4. 选择 `渠道名称 · 模型 ID`，保存并测试。
5. 回聊天输入框点击麦克风。移动 WebUI 录音要求安全上下文（HTTPS）；不满足时现有逻辑会转为选择本地音频文件。

不要把 API Key 放进交接文档、截图或聊天记录。2026-09-28 的截图曾暴露一个 OpenRouter Key，必须在 OpenRouter 控制台撤销并重新生成。

## 3. 数据与运行时契约

前端配置键仍是 `tools.speechToText`（兼容读取旧键 `speechToText`）。模型设置来源的最小形态如下，示例不含秘密：

```json
{
  "enabled": true,
  "provider": "openai",
  "modelProviderId": "openrouter",
  "openai": {
    "api_key": "",
    "base_url": "",
    "model": "qwen/qwen3-asr-0.6b",
    "language": "zh-CN"
  }
}
```

`modelProviderId` 是 UI 扩展字段，后端先读取原始 JSON 并解析它；之后才反序列化为既有 `SpeechToTextConfig`。这样不用把敏感字段加入前端偏好，也不需要迁移已有用户配置。

运行时限制：当前模型设置渠道须提供 OpenAI 兼容的音频转写接口 `POST /v1/audio/transcriptions`。被标记为音频模型并不保证第三方渠道实现该接口；若供应商 API 不兼容，应使用“自定义（OpenAI 兼容）”或为该供应商增加专用 STT 适配器。

## 4. 关键代码位置

### `dream-ui`

- `packages/desktop/src/renderer/components/chat/SpeechInputButton.tsx`：输入框麦克风可发现性与未配置跳转。
- `packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/index.tsx`：加载模型渠道、筛选音频模型、保存 `modelProviderId`。
- `packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/speechSettingsUtils.ts`：来源状态与持久化转换。
- `packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/SpeechTestPanel.tsx`：模型设置来源的测试前校验。
- `packages/desktop/src/common/types/provider/speech.ts`：`SpeechToTextConfig.modelProviderId`。

### `dream-core`

- `crates/dream-core-shell/src/routes.rs`：`load_stt_config` 解析并校验模型设置渠道，在内存中注入凭据。
- `crates/dream-core-shell/src/state.rs`：`ShellRouterState.provider_service`。
- `crates/dream-core-app/src/router/state.rs`：生产 Shell router state 构造 `ProviderService`。
- `crates/dream-core-shell/src/stt_openai.rs`：OpenRouter 根地址归一化。
- `crates/dream-core-api-types/src/lib.rs`：重新导出 `ModelKind` 供 shell 校验音频模型。

## 5. 已完成验证

在 2026-09-28 本地执行并通过：

```powershell
cd D:\dream\dream-ui
bunx vitest run tests/unit/renderer/voiceInputSection.dom.test.tsx tests/unit/renderer/speechSettingsUtils.test.ts tests/unit/renderer/SpeechInputButton.dom.test.tsx
# 结果：3 files / 41 tests passed
bunx tsc --noEmit
bun run i18n:types

cd D:\dream\dream-core
cargo check -p dream-core-shell -p dream-core-app
cargo test -p dream-core-shell stt_openai --lib
# 结果：7 passed
```

同时已运行 `git diff --check`，没有空白错误；所有新增 locale JSON 已逐个解析成功。

## 6. 仍需完成的真实验收

当前没有可操作的运行中桌面应用窗口，因此本轮没有真实截图或网络转写验收。接手后须补齐以下验收，不能以编译或 mock 单测替代：

1. 使用**新生成的** OpenRouter Key，在“模型设置”配置一个实际支持转写的 audio 模型。
2. 语音设置选择“模型设置中的语音模型”，确认不显示/不回填渠道 API Key。
3. 点击“保存并测试”，确认请求到 `https://openrouter.ai/api/v1/audio/transcriptions` 而不是 `https://openrouter.ai/v1/...`。
4. 桌面聊天输入框录音、停止、转写并插入文本；再覆盖 WebUI HTTPS 与手机尺寸。
5. 禁用渠道、禁用模型或将其类型改为非 audio 后重试，确认返回明确的配置错误且不再使用旧凭据。
6. 改完 Rust 后必须重编 bundled backend；仅重新加载前端不会使 `/api/stt` 的后端改动生效。

## 7. Git 注意事项

- 两个仓库均有本轮未提交改动；提交时分仓、精确暂存，不要 `git add .`。
- `dream-ui` 还有 4 个名称异常的未跟踪临时 release 目录，不属于本功能，不能删除或加入提交。
- 本文是本轮新增的交接文件，位于 `dream-ui/docs/guides/`，应与 UI 改动一起提交。
