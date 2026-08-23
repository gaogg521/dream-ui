# Dream UI — 迁移设置说明

对应旧仓库 `1oneUI`：Electron 桌面端、WebUI、打包和更新。产品对外展示名仍为 **One Work**；`dream` 只用于代码、进程、协议和开发者接口。

这是一份迁移期间的说明文件，不是产品 README（本目录下的 `README.md` 是从 `1oneUI` 原样复制过来的产品说明，内容仍大量使用"1ONE Work"/"1oneUI"/"1oneCore"叙述和指向 `gaogg521/1oneUI`、`gaogg521/1oneCore` 的链接——这是一次独立的文案改写工作，本轮未动，见下方"尚未做的事"）。

完整决策背景、命名规范、迁移原则、P0 身份清单见旧仓库中的规划文档：`D:\aionui-m0\DREAM-PLATFORM-DIRECTION.md`。

## 已完成（2026-08-23）

- [x] 4 个 `@aionui/*` workspace 包改名为 `@dream/*`（`desktop`、`shared-scripts`、`web-cli`、`web-host`），及其在 `package.json`/`.ts`/`.py` 脚本中的全部引用
- [x] 7 个 `Aion*` 基础组件文件改名为 `Dream*`（`AionModal`→`DreamModal`、`AionSelect`→`DreamSelect`、`AionSteps`→`DreamSteps`、`AionCollapse`→`DreamCollapse`、`AionScrollArea`→`DreamScrollArea`、`AionSearchInput`→`DreamSearchInput`、`AionInlineSearchInput`→`DreamInlineSearchInput`，含 `.module.css` 同名文件）及其全部导入引用
- [x] `pages/conversation/platforms/aionrs/` 目录改名为 `platforms/dreamEngine/`，内含 5 个文件同步改名（`AionrsChat`→`DreamEngineChat`、`AionrsModelSelector`→`DreamEngineModelSelector`、`AionrsSendBox`→`DreamEngineSendBox`、`useAionrsMessage`→`useDreamEngineMessage`、`useAionrsModelSelection`→`useDreamEngineModelSelection`）
- [x] Cookie 名与后端 `dream-core` 的改名同步（`web-host/src/static-server.unit.test.ts` 里的 `aionui-session` → `dream-session`）
- [x] `npx tsc --noEmit`（`packages/desktop`）编译通过

## ⚠️ 命名冲突处理原则（重要，避免重蹈覆辙）

改名过程中两次踩到"字符串看起来像普通标识符/注释，实际是持久化匹配值"的坑，处理方式是**只改代码符号，不碰持久化字符串**：

- `type: 'aionrs'`、`preset_agent_type: 'aionrs'` 等**小写字符串字面量**是与后端 `AgentType::serde_name()` 对应的 wire-format 判别值，后端已决定保留 `"aionrs"` 不变（见决策文档第 13 节），前端这些字符串**同步保持不变**；只有 `AionrsChat`/`AionrsModelSelector` 这类**大写开头的组件/函数标识符**被重命名，两者靠大小写严格区分，脚本按精确大小写匹配，未发生误伤。
- `BUILTIN_IMAGE_GEN_LEGACY_NAMES = ['AionUi Image Generation', ...]`（`common/config/storage.ts`）是用于识别/迁移**存量已安装 MCP 服务器名称**的遗留匹配名单，不是普通文案，本轮**未改动**——改了会让存量用户的旧版内置图片生成 MCP 服务器识别失效。

## 尚未做的事（按重要性排序）

- [ ] **注释/文档字符串里的"AionUi"/"AionCore"提及**——规模比预期大得多（初步扫描仅 `packages/desktop/src` 下就有数百处 `// ... AionUi ...` 风格的代码注释、doc comment），且已经证明这类文本里混杂着类似 `BUILTIN_IMAGE_GEN_LEGACY_NAMES` 这样的真实持久化陷阱，不能批量无脑替换，需要逐类抽样核实后再处理，建议作为独立的后续任务
- [ ] `README.md`/`readme.md` 的产品文案改写（仍称"1ONE Work"，链接指向旧仓库 `gaogg521/1oneUI`/`gaogg521/1oneCore`）——这是内容重写工作，不是机械改名
- [ ] `AIONUI_*` 环境变量：已确认约 20 个是真正的运行时变量（`AIONUI_BACKEND_LOCAL_PATH`、`AIONUI_DATA_DIR`、`AIONUI_PORT`、`AIONUI_CDP_PORT`、`AIONUI_MEDIA_*`、`AIONUI_IMG_*` 等，见决策文档第 11.4 节），其余 150+ 个是 NSIS 安装器宏名/错误码（`AIONUI_MSG_*`、`AIONUI_E_*`），后者按既定规则不应改动；前者本轮未处理
- [ ] `bun install` 生成的 `node_modules/@dream/web-host` 符号链接是手动创建的临时方案（完整 `bun install` 在本机异常缓慢，25 分钟未完成疑似卡住，原因未查明），提交前建议在网络/资源更充裕的环境下正式跑一次完整 `bun install` 重新生成 `bun.lock`
- [ ] appId/exe/userData/协议 scheme（`electron-builder.yml`）：按决策文档第 12 节已确认不改，非遗漏
- [ ] 尚未提交、尚未推送到 `https://github.com/gaogg521/dream-ui.git`
