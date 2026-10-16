# 2026-10-16 修复「初始化版本控制失败：invalid_params」

> 用户报障：部分用户在「变更」面板点「纳入版本控制」报
> **初始化版本控制失败：invalid_params**。截图经 Windows OCR 还原确认
> （本会话模型看不了图，OCR 脚本在 scratchpad/ocr/ 的思路：3 倍放大 + Windows.Media.Ocr）。

## 根因

`scm/init` 的后端契约（dream-core `crates/dream-core-project/src/scm/actor.rs` `init_repository`）：
`pe_id` 省略时**仅当项目只有一个可解析的本地根**才自动选定；根目录为 0 个或 ≥2 个时返回
`InvalidParams { what: "pe_id" }`，wire 层映射成 JSON-RPC 错误名 `invalid_params`
（`wire.rs` `map_error`）。前端把 `RpcError.message` 原样拼进 toast（`ScmPanel.tsx`），
用户就看到裸错误码。

触发人群（解释"部分用户"）：

1. **一个会话挂了多个文件夹**（多根项目）——点初始化必现；
2. **一个可解析根都没有**：会话文件夹未在磁盘上物化、挂载文件夹被移动/删除/无权限——
   `roots_of` 里 resolve 失败的条目被静默丢弃（只打 warn），同样落进 `roots.len() != 1` 分支。

## 修复（全部在前端，协议未动）

- **`scmStore.ts` / `scmTransport.ts`**：`ScmPort.init(projectId, peId?)`，
  `initScmRepository(peId?)` 带上 `pe_id`。
- **`ScmPanel.tsx` `NotARepositoryNotice`**：新增 `roots?: RootRef[]` prop
  （来自 ExplorerContainer 已经 SWR 到手的 `project.get` detail，零新增请求）。
  按 `runtimeStatus`（undefined 视为可用）筛候选根：
  - 单根：静默带 `pe_id` 初始化，不出选择器；
  - 多根：出 `data-scm-root-select` 选择器，默认选 workspace 角色，用户可换；
  - 零可用根：显示 `initNoRoot` 文案，不出按钮（没有可初始化的东西）；
  - roots 未传（测试/旧调用点）：维持旧行为让后端自动选定。
- **错误映射** `describeInitError`：`invalid_params` 且 `data.param === 'pe_id'` →
  i18n `conversation.explorer.scm.initRootUnavailable`（"未找到该文件夹…"）；
  其余保持 `initFailed:{{reason}}`。**wire 错误名不再裸露给用户**。
- **i18n**：13 个 locale 各加 `initPickRoot` / `initNoRoot` / `initRootUnavailable`，
  `node scripts/generate-i18n-types.js` 重新生成 `i18n-keys.d.ts`，`check-i18n.js` 通过。

## 测试

- `scmStore.test.ts`：harness 记录 `initCalls`；新增「带 pe_id 透传」「不传 pe_id」两例。
- `scmPanel.dom.test.tsx`：新增单根静默 pin / 多根选择器默认 workspace /
  手动选根后 init 所选 pe_id / 零可用根无按钮 / invalid_params(pe_id) 映射友好文案 5 例；
  注意两个坑：①`installPort` 的 init mock 要返回新仓库，否则一直停在空状态；
  ②Arco Select 空状态断言要等 `findByText(notARepository)`（loading 态先于空状态）；
  打开下拉用 `mouseDown+click` 双触发即可在 jsdom 里驱动真 Arco Select。
- 3 个 SCM 测试文件 174 例全绿；ExplorerContainer 相关 4 文件 44 例全绿；`tsc --noEmit` 干净。

## 后端未改

`scm/init` 行为不变（省略 pe_id 仍只在单根时自动选定——注释里写明"多根时猜会把用户没
指的文件夹变成仓库"，这是对的设计）。前端现在总是显式传 `pe_id`，错误也有人话文案兜底。
