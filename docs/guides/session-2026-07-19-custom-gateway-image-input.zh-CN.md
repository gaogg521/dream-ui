# 自定义网关看图白名单修复（2026-07-19）

> **看图 / 自定义网关专用交接。**  
> **本次上游同步的完整功能与 BUG 清单**见 [`session-2026-07-19-upstream-sync-changelog.zh-CN.md`](session-2026-07-19-upstream-sync-changelog.zh-CN.md)。  
> 作战过程见 [`session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md`](session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md)。  
> 仓库根：`D:\aionui-m0`（`1oneUI` / `1oneCore` / `aionrs-local`）。

---

## 1. 今天做了什么（结论）

| 项                                             | 状态                                          | 说明                                                                  |
| ---------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| 自定义 LiteLLM 网关下 **Kimi K2.6** 看图被剥图 | ✅ 已修；**✅ 用户验收通过（2026-07-19 晚）** | LiteLLM + `kimi-k2-6` 贴图可识图；见 §3                               |
| 重编并嵌入 `aioncore.exe`（含上述修复）        | ✅                                            | 看图归一化约 **21:45**；品牌技能约 **22:20**；与对应 release 哈希一致 |
| DeepSeek V4 Flash / MiniMax M2.7「多模态」诉求 | ❌ **不应加白名单**                           | 官方为纯文本，见 §4                                                   |
| 上游同步合主 / push / 出包                     | 见 07-18 清单                                 | 本日未再做 `dist:win`                                                 |

**验收记录**

- **2026-07-19 晚**：用户确认自定义网关下 **Kimi（`kimi-k2-6`）看图已正常**。
- **已 commit**：`357bbbf3`（看图白名单/归一化）于 `1oneCore` `sync-v0148`。

**相关 commit（同分支）**

```
357bbbf3 fix(ai-agent): 自定义网关看图白名单与跨厂商模型 ID 归一化
9504fa47 fix(brand): 注入技能与 ACP 身份改为 1One Work
```

品牌细节见 [`session-2026-07-19-brand-skills-acp.zh-CN.md`](session-2026-07-19-brand-skills-acp.zh-CN.md)。

---

## 2. 现象与根因（给「又看不了图」排查用）

### 2.1 用户环境

- Provider：自定义 **LiteLLM**，形如 `https://litellm-internal.123u.com/`
- 模型 ID 示例：`kimi-k2-6`、`deepseek-v4-flash`、`minimax-2-7`（横杠、非官方完整 ID）
- 表现：贴图后模型回「无法查看图片」，或改用 `Read` / `ExecCommand` 去抠本地文件元数据

### 2.2 真实链路（不是「UI 没贴上」）

```
1oneUI 附件
  → 1oneCore resolve_image_input_capability(provider, base_url, model)
  → aionrs project_image_input：仅 ImageInputCapability::Supported 才保留图片
  → Unknown / 未 Supported → 剥离图片，换成占位文本
  → 模型「看不见图」
```

关键代码：

| 层                        | 路径                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| 能力解析                  | `1oneCore/crates/aionui-ai-agent/src/capability/image_input.rs`                     |
| 白名单 JSON（编译期嵌入） | `1oneCore/crates/aionui-ai-agent/assets/model-capabilities/image_input_models.json` |
| 说明                      | `.../assets/model-capabilities/README.md`                                           |
| 剥图                      | `aionrs-local/crates/aion-agent/src/engine.rs`（`project_image_input`）             |

**上游设计**：按 **API root + 模型 ID** 正向前白名单；匹配不上 → `Unknown` → fail-closed 剥图。  
自定义网关域名 **不在** catalog 的 `api` 列表里 → 以前一律 `Unknown`。  
另：`kimi-k2-6`（横杠）≠ catalog 的 `kimi-k2.6`（点号）→ 精确匹配也会失败。

---

## 3. 代码修复（fork 行为，相对上游）

### 3.1 `image_input.rs` 行为变化

1. **Provider 查找拆成三种结果**
   - `Providers(...)`：API root / 官方 host / builtin 命中 → **只**在该 provider 的 `models` 里查（保持「同网关未列入模型仍 Unknown」，例如 dashscope + `kimi-k2.6`）
   - `CustomGateway`：合法 `http(s)` URL，但 **没有任何** catalog API 命中（LiteLLM / 私有网关）→ 见下
   - `None`：非法 URL 等 → `Unknown`

2. **CustomGateway 回退**  
   若模型 ID（经别名归一后）出现在 **任意** 白名单 provider 的 `models` 中 → `Supported`，放行图片。  
   未知模型 ID → 仍 `Unknown`。

3. **模型 ID 宽松匹配（跨厂商通用，不限 Kimi）** `model_match_keys`  
   适用于白名单内已有的视觉模型（GPT / Claude / Gemini / Qwen / Kimi / GLM / DeepSeek-VL / MiniMax-M3 …）：
   - 大小写、`.` / `_` / `-` / 空白、`vendor/` 前缀
   - 品牌与版本间单字母（`kimi-k2.6` ↔ `kimi2-6`）
   - 尾部日期 `YYYYMMDD`（`claude-sonnet-4-5-20250929` ↔ `claude-sonnet-4.5`）
   - **不会**因此把纯文本 SKU 当成多模态（`deepseek-v4-flash`、`minimax-2-7` 仍 Unknown）

4. **catalog JSON**  
   `moonshot-cn` / `moonshot-global` 显式增加别名 `kimi-k2-6`（与归一逻辑双保险）。

### 3.2 测试

`cargo test -p aionui-ai-agent --lib image_input` → **11 passed**（含自定义网关 + 横杠别名用例）。

注意：fixture 里 openrouter 的 `models: []` 时，**已知 aggregator + 空列表** 仍对裸 `kimi-k2.6` 返回 `Unknown`（不按模型名跨 provider 瞎放）。真实嵌入 catalog 里 openrouter 有 `moonshotai/kimi-k2.6`，basename 匹配后官方 OpenRouter 会 Supported。

### 3.3 重编 / 嵌入

```powershell
# 改了 Core 能力代码后必须重编；dev 跑的是 bundled exe
D:\aionui-m0\scripts\backend-rebuild.ps1
```

注意：

- 若 Electron / `aioncore.exe` 占用文件，`prepareAioncore.js` 可能 EPERM 或卡在 `managed-resources`。
- 可先停进程再编；必要时直接 `Copy-Item`  
  `1oneCore\target\release\aioncore.exe` →  
  `1oneUI\resources\bundled-aioncore\win32-x64\aioncore.exe`  
  并用 SHA256 核对一致。
- **改完代码未重编 = 桌面仍跑旧后端**，看图修复不会生效。

---

## 4. 模型能力真相表（勿再误标多模态）

| 用户侧模型 ID                  | 是否原生看图                  | 本日策略                                            |
| ------------------------------ | ----------------------------- | --------------------------------------------------- |
| **kimi-k2-6** / Kimi K2.6      | ✅ 是（MoonViT）              | CustomGateway + 别名 → **Supported**                |
| **deepseek-v4-flash**          | ❌ 官方纯文本                 | **不加**白名单；硬加只会上游拒识/忽略               |
| **minimax-2-7** / MiniMax-M2.7 | ❌ 官方纯文本（仅 text/tool） | **不加**；同厂看图用 **MiniMax-M3**（catalog 已有） |
| MiniMax-M3                     | ✅                            | 已在 `minimax.models`                               |

白名单原则（见 catalog README）：

- 只收录 **提供商文档确认** 在该 API 协议上支持 image input 的模型。
- DeepSeek 官方 chat 预设 endpoint：`models: []`（无已核实视觉 chat 模型）。
- 不要把第一方模型条目盲目抄到未核实的聚合器/网关；CustomGateway 回退是 fork 对「ID 已在白名单」的折中。

---

## 5. 与 07-18 同步的衔接状态（避免重复劳动）

同步目标大致已合主线（详见 07-18 文档进度表）。本日额外相关点：

| 仓         | 相关 tip / 状态                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| aionrs     | `master` / `sync-v025` @ `78672b3`（v0.2.5 + #230 流诊断 + fork 补丁）                                           |
| 1oneCore   | `0.1.48-one.1`；migration **026–029**；看图 `357bbbf3` + 品牌 `9504fa47`（`sync-v0148`）                         |
| 1oneUI     | 内容对齐上游 v2.1.37；产品号仍 **2.1.46**；技能详情/批量已移植进 fork SkillsHub；`aioncoreVersion=v0.1.48-one.1` |
| 企业铁律   | Router / SettingsSider / `one-*` / capabilities+企业 tab → 仍 `--ours`                                           |
| 企业 stash | `1oneCore` 可能仍有 `stash@{0}: wip-enterprise-before-sync-v0148`（接手时确认）                                  |

---

## 6. 后续 AI 建议步骤

1. ~~**Commit** 1oneCore 三文件看图修复~~ → **已提交 `357bbbf3`**（push / 合 `one-main` 另议）。
2. 确认 bundled `aioncore.exe` ≥ 含看图+品牌的 release（约 22:20+）。
3. ~~`kimi-k2-6` 贴图验收~~ → **已通过（2026-07-19 晚）**；勿用 deepseek-v4-flash / minimax-2-7 验看图。
4. 若日后又剥图：查实际 `base_url` + `model` 是否进 `resolve_image_input_capability`，以及是否仍跑旧 exe。
5. 出包前：发布连锁 aionrs tip → Core release → prepare/embed → `dist:win`。
6. 不要为「用户以为多模态」把 DeepSeek V4 Flash / MiniMax M2.7 写进白名单，除非官方文档改口并实测 `image_url` 成功。

---

## 7. 相关路径速查

```
D:\aionui-m0\1oneCore\crates\aionui-ai-agent\src\capability\image_input.rs
D:\aionui-m0\1oneCore\crates\aionui-ai-agent\src\capability\image_input_test.rs
D:\aionui-m0\1oneCore\crates\aionui-ai-agent\assets\model-capabilities\image_input_models.json
D:\aionui-m0\aionrs-local\crates\aion-agent\src\engine.rs
D:\aionui-m0\scripts\backend-rebuild.ps1
D:\aionui-m0\1oneUI\resources\bundled-aioncore\win32-x64\aioncore.exe
D:\aionui-m0\1oneUI\docs\guides\session-2026-07-18-upstream-sync-v2137-handoff.zh-CN.md
```

对话 transcript（本会话）：`agent-transcripts/7845196b-6e36-40dd-b061-a770b00f8cca`。
