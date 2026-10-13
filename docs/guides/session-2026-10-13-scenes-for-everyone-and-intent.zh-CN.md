# 2026-10-13 场景开放给所有人，场景是「先问清再动手」的入口

> 用户诉求（原话要点）：场景不应只由企业管理员下发——**企业版和单机版用户都能自己创建**；
> 场景不只是加 SKILL 和 MCP，更是「AI 意图击穿用户想法、实现用户需求的快捷入口」。举例：
> 客户说「帮我做个官网吧，再带个 AI 智能助理」，这句话最多算个入口，不能当需求用——正确动作是先做一轮
> 需求调研（访谈 + 现状盘点 + 同类参照），把它拆开、问透、坐实，再动手。侧边栏「数字员工」改名
> 「数字员工与场景」。拖拽换位、开/关也是同一轮提的。
>
> 提交：dream-core `19af41a`（场景提示词/技能 id）、`7dad8ea`（场景 intent，迁移 023）；
> dream-en `5687b4f`、`7e693de`；dream-ui `15be726` `a35f2b9` `804b7036` 等。
> **企业服务器要升镜像才会下发 intent**；连旧服务器时客户端不报错——公司场景退回「只有提示词」。

## 1. 场景模型

场景 = 入口。三层：

| 层            | 内容                                                              | 注入方式             |
| ------------- | ----------------------------------------------------------------- | -------------------- |
| 角色          | 提示词（没写就用名称/描述/职能生成一句）                          | `extra.preset_rules` |
| 工作方法      | `intent.discovery` 开：先复述、再调研、再写需求简报、确认后才动手 | 同上，追加一段协议   |
| 硬约束 / 交付 | `intent.constraints`（含「不做清单」）、`intent.deliverables`     | 同上                 |

资源：技能走 `extra.enabled_skills`；个人场景可限定 MCP（`extra.selected_mcp_server_ids`，不选=沿用已启用的）。

`SceneIntent = {discovery, starters, questions, constraints, deliverables}`，上限：开场示例 4×120、必问问题 8×200、
两段文本各 2000。**服务端与客户端各校验一次**（服务端：`PlatformService::update_scene_intent`，空 intent 存 NULL）。

## 2. 协议文本（`utils/scenes/sceneProtocol.ts`）

核心六句，改它之前先读：

1. 第一句话是入口，不是规格；别拿它直接开工。
2. Step 1 复述；Step 2 需求调研（对象/维护者、之后要做什么、现状与痛点、同类参照、「做完」的定义与第一版范围外）；
3. 一次最多问 5 个、给默认答案、有提问工具就用提问工具；
4. Step 3 需求简报（含 IN/OUT）并请用户确认；Step 4 确认后才分步实现并自测；
5. 用户明说跳过，或请求已足够具体 → 可以跳过 Step 1-3；
6. **调研这一轮是对话不是勘察**：确认前除提问工具、搜同类案例、读用户指给你的文件外，不调任何工具。

⚠️ 第 6 句是真机跑出来的：第一版只写「take stock of what already exists」，模型就去 `Glob` 工作区、读记忆目录、
甚至调了公司 MCP 的 `get_project_release`，随后卡在审批上。加上「不调工具」后，真机上「帮我做个官网吧」得到的是：
先说「先不写代码」→ 复述理解 → 说清还判断不了什么 → 弹出带推荐默认值的 AskUserQuestion 卡片。

## 3. 谁能做什么

- **个人场景**：本机存（`ConfigStorage` 的 `scenes.personal`），任何人（含单机版）可建/改/复制/删；
  模板 5 个（官网与 AI 助理搭建、数据分析、内容运营、客户方案与报价、会议纪要）+ 空白。官网模板是完整示范
  （问题与「先方案后实现、不做清单、合规表述、密钥不进代码」等硬约束都来自 FDE 实战案例的做法）。
  模板文案是内容不是界面，放 `sceneTemplates.ts` 的 zh/en 两份（其余语言读英文），与数字员工模板同一做法。
- **企业场景**：管理员在后台编辑（含 intent）；成员只读，只能开/关。
- **开/关与顺序**：都按「服务器、项目组、成员」存 localStorage；开关存的是「关」集合，新场景默认开。
  关掉只是不出现在首页，公司的授权不动。顺序里个人场景用 `mine:<id>` 键，与公司场景同一条拖拽序列。

## 4. 代码落点（别再去 components/enterprise 找）

- `common/types/platform/sceneTypes.ts`：类型、上限、`PersonalScene`。
- `renderer/utils/scenes/`：`sceneProtocol` `sceneChat` `sceneItem` `personalScenes` `sceneTemplates` `sceneOrder` `sceneEnabled` `sceneAvatar`。
- `renderer/components/scenes/`：`SceneGrid`（首页条）`SceneEditor`（抽屉）`useScenes`（两处来源 + 偏好）。
- `pages/superAssistant/components/ScenesTab.tsx`：场景标签页；首页「新建」带 `?tab=scenes&new=1` 过来直接弹模板选择。
- 服务端：`dream-domain-platform` 迁移 `022_scene_prompt` `023_scene_intent`；后台 `SceneIntentFields.tsx`。

## 5. 踩过的坑

- **公司那头连不上不能把个人场景一起藏掉**：`loaded` 在公司请求出错时也算就绪，首页照样显示个人场景。
- **`useSWR` 在 `guidPage.dom.test` 里被 mock 成返回任意对象**：凡是对 SWR 返回值做 `.map` / `Array.isArray` 之前别假定它是列表。
- Arco `Popconfirm` 的确认按钮在 jsdom 里是「确定」不是「OK」；真机里「删除」按钮用 `aria-label` 找，别拿「行内最后一个 button」（那是开关）。
- 真机验证脚本在 scratchpad `employee-chat-1012/drive-personal-scene.mjs`：建场景 → 首页出现 → 点开 → 说「帮我做个官网吧」→ 断言走了
  `AskUserQuestion` 而不是 `Glob`/`Write`/MCP，结束时删掉自己建的场景。

## 6. 后续补完（同日）

- **调研相关项只在「先调研」打开时才出现、才生效**：必问问题、开场示例、硬约束、交付物。关掉开关=只剩提示词，
  所以会议纪要这类不需要先问的模板，把规则直接写进提示词（不再放 constraints）。数据不丢：开关关了再开，原来填的还在。
- 开场示例做成对话里的芯片（`SceneStarters`）：点一下只往输入框填字，不发送；对话开始或有草稿后消失。
  示例随会话存在 `extra.scene_starters`，刷新还在。
- 公司场景显式授权了 MCP 时，对话限定到本机已同步的那几个（按 `teamRegistryId` 对应）；一个都没同步到就不限定，
  免得对话一个工具都没有。
- 个人场景可导出/导入（`one-work-scenes` JSON，导入一律新 id，不覆盖）。「跟账号走」（服务端按成员存）**仍未做**：
  需要新表和接口，单机版又没有账号，先用文件解决换机和互相分享。
- 数字员工「从模板创建」不再一键直接建：改成打开填好的创建窗口（可改，选模型后才建）。原来的一键创建没带运行后端和模型，
  建出来的员工第一次运行就会报 `Provider '' not found`。
- 编辑器输入框加了可见边框（深色主题下默认填充几乎看不见）。

## 7. 还没做

- 个人场景跟账号走（服务端存储）。
