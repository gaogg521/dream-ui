# 专家/技能本地化 + 卡片排版 + Agnes 媒体接入（2026-09-11）

> **起因**：三条独立的用户反馈串成一天 ——
> ①「切到英语后专家市场和技能市场显示的还是中文」；
> ②「我们的视觉和排版设计是不是丑出天际」（附竞品 workbuddy 截图对比）；
> ③「agnes-video-2.5-fast 生成视频失败，但 2.0 可以」，随后又是生图 `400 n must be 1`。
>
> 本轮 16 个提交。**贯穿全天的 bug 类型只有一个：同一条规则写在两处、两份互相不知道对方存在**，
> 或者**对没测过的东西写下了乐观的断言**。下面每一节都是这个类型的一个实例。

本轮提交：

| 提交      | 内容                                                      |
| --------- | --------------------------------------------------------- |
| `8058b0a` | 技能卡统一形状、有图标的排前面、内置技能文案本地化        |
| `3abcd0b` | 内置技能分类胶囊；修三个失效的「关于」链接                |
| `45aae4f` | 13 个分类覆盖 141 个技能、使用/编辑按钮、深色模式卡片边框 |
| `f11aa88` | 专家市场 252 人本地化；技能文件预览字号 + frontmatter     |
| `6e8d4f6` | 分类与本地化改按技能清单判定，不再按 `source`             |
| `6b5f4ee` | compact 字号的测试                                        |
| `4ed2902` | 技能详情页头部走同一覆盖层；抽出 `skillCorpus.ts`         |
| `d85d209` | 安装器：不再让用户去关一个 Windows 从未点名的进程         |
| `a19af05` | 技能卡/专家卡各砍掉约 70px 死白                           |
| `074cbbe` | Agnes video 2.5 请求体与 2.0 分家                         |
| `7e81824` | 识别「对方队列排满」这类失败                              |
| `f630301` | 未知图像端点不再谎称一次能出 4 张                         |
| `bc12d9f` | Agnes 图像独立 body + 目录条目                            |
| `992f3ba` | 图像模型改为目录已知，不再靠名字推断                      |
| `ea74b26` | adapter 层覆盖 Agnes 分支                                 |
| `a0ea7ec` | CI：不再把 macOS 签名身份塞给 Windows 构建                |

---

## 1. 为什么英文界面全是中文

`marketplace-personas/personas.json`（252 人）和 115 个技能的 SKILL.md frontmatter
**一个 locale 字段都没有**。`builtin-assistants/assistants.json` 有 `name_i18n`，这两个没有。
所以不是「翻译没跟上」，是根本没有可翻译的位置。

做法：不改 schema，加前端覆盖层，和旁边已有的 `CATEGORY_I18N_KEYS` 同一个形状 ——
**带兜底的查表，而不是穷举联合类型**。语料重新打包的频率远高于这段 UI，新增一个专家必须
在没人翻译之前也能正常显示。

- 专家：`settings.marketplacePersona.<id>`，en-US / zh-CN / zh-TW 各 252 条。
  - **`id` 本身就是英文 PascalCase**（`AccessibilityAuditor`），省掉 252 个名称的翻译。
  - 中文昵称（无碍碍、付清清）是谐音梗，英文没有对应物 —— 这个 key **只存在于中文 locale**，
    英文下 `t()` 取不到、那一行整体消失，而不是留半截中文。
  - 搜索同时匹配译文和原始中文：英文界面里粘中文名进去照样搜得到。
- 技能：`settings.skillsHub.builtinSkill.<name>`，27 → **141** 条 × 3 语言。
- zh-TW 用 OpenCC `s2twp` 从 zh-CN 生成。

**刻意不翻译的东西**：技能的 `description` 字段是**给模型看的** ——
`prompt_builder.rs::build_skills_index_text` 把它按 `- **name**: description` 渲染进系统提示词，
触发语也在里面。按 UI 语言翻译它会改变模型的匹配依据。覆盖层只盖显示层，和 `display_name`
盖 `name` 是同一个层级。

---

## 2. 分类写了 141 条，其中 114 条从来没被读到过

`skillPillKey` 先判断 `source` 再查分类表：

```ts
if (skill.source === 'custom') return 'source:custom'; // ← 114 个技能在这里就返回了
const category = BUILTIN_SKILL_CATEGORY[skill.name];
```

而 141 个技能里**只有 27 个落在 `builtin_skills_dir`**，其余 114 个是铺到用户技能目录的，
后端一律返回 `source: 'custom'`（`list_user_skills_from_disk` 硬编码）。
那是「不在内置目录」的意思，**不是「用户自己写的」**。

后果：上一轮刚配好的 141 条分类，114 条是死代码；这些技能挤在一个「自定义」胶囊里、分类标签空白、
文案也一并跳过本地化。**分类表写了，没人读。**

两处都改成先查清单、查不到再回落 `source`。不在清单里的（用户真正自己导入的）保持原文和
「自定义」胶囊 —— 这才是真正要区分的边界。团队技能无论如何保留自己的胶囊：那是权限事实，不是主题分类。

同一条规则此时已经有三个消费方（列表、胶囊、详情页），于是抽成
`skillsHub/skillCorpus.ts`。**上一次这条规则写在两处，两份就不一致了。**

配套加了不变量测试：分类表和本地化表必须覆盖同一批 141 个名字。

---

## 3. 卡片 227px 装 121px 的内容

用户给了 workbuddy 的截图问「是不是丑出天际」。不是丑，是**松**。CDP 真机量出来：
技能卡 **227px**，内容只有 121px。三个原因叠在一起，每个单独看都看不出来。

### 3.1 `h-full` 是循环依赖

`height: 100%` 用在 `auto` 行轨的 grid item 上，浏览器改用该 item 的 **max-content** 高度来定行高 ——
而 max-content **不认 `line-clamp`**，整段没截断的描述全算进去了。每张卡自身 157px，被拉到 182px。

grid item 本来就默认 stretch 填满行，**这个 class 既多余、又正是 bug 本身**。

### 3.2 `content-visibility: auto` 固定加 19px

而且**填任何 `contain-intrinsic-size` 都不管用**（150 / 157 / `auto 157px` 实测都是 201px）——
它施加的 containment 改变了 flex 列的解析方式，卡片根本无法收敛到内容高度。
139 张静态卡片不值得为省这点绘制付这个代价。

### 3.3 `min-h-32px` 被两行 clamp 打败

两行 clamp 是 36px，`min-h` 让它赢了，一张长描述撑高整行。改成固定两行盒子。

### 3.4 排版本身

图标独占一行、分类标签孤零零挂在对面 —— 每张卡里都有一个 L 形空洞。
改成图标在左、标题和分类在右（workbuddy 就是这么排的），专家卡同样处理。

**结果：技能卡 227 → 157px，专家卡 186 → 163px，信息一个没少。**

---

## 4. 技能详情页：不只是字号

用户说「点进去之后的字体可以小一点」。字号确实大，但截图里更刺眼的是另一件事：

**SKILL.md 开头的 YAML frontmatter 被当成了 setext 二级标题。**
`name: x` 下面跟一行 `---`，在 CommonMark 里就是「文字下划线」式的 h2。所以每个技能进去，
第一眼是一坨比文档真正标题还大的元数据。

- `Markdown` 新增 `compact`：正文 13px / h1 17px / h2-h6 14px，并且**刻意不跟 `--chat-font-size`**
  —— 那个偏好是给聊天回复用的，跟着它走会撑爆 420px 的面板。
- frontmatter 按 yaml 代码块渲染：保留内容（它决定模型什么时候调这个技能），但踢出标题语法。

---

## 5. 安装器：让用户去关一个不存在的程序

Restart Manager **报不出占用进程的情况远多于报得出**（杀毒/同步客户端的短暂句柄根本不注册）。
而对话框在「正在使用它的应用：」下面打印占位符 `未知进程`，然后说「请关闭上面列出的应用」——
**这是一条无法执行的指令**，接着还建议重启 Windows，去解决一个通常几秒就自行释放的句柄。

改成两个对话框：点名了就列出来让用户关；没点名就说清楚 Windows 认不出来、点名真实成因
（杀毒、OneDrive/Dropbox、停在该目录的资源管理器窗口或终端），让用户等几秒重试。
**两条路径都不再提重启 Windows。**

等待退出的轮询也加了退避：`attempt × 500ms + 1s` 取代固定 1 秒，同样 10 次从 10 秒变约 35 秒 ——
旧循环在大会话数据库还在 flush 的时候就宣告失败了。

---

## 6. Agnes 媒体接入：驱动是照旧版文档写的

### 6.1 视频：2.5 禁掉了 2.0 的全部尺寸字段

`agnesDriver` 无条件发 `width` / `height` / `num_frames` / `frame_rate`。2.5 把这些换成了
`aspect_ratio` + `size` 档位 + `seconds`，而且文档明写这几个传了**直接 400**，不是忽略：

```
400 {"code":"invalid_request","message":"width is a forbidden field"}
```

连带发现两个：2.5 **必填 `mode`**（text / keyframe / reference），2.0 没这个概念；
以及**目录里一条 entry 同时喂两代模型**，把 2.0 的时长表（含 18s）给了上限 12s 的 2.5。
拆成两条 entry，2.5 那条排在前面 —— `resolveMediaModelSpec` 用的是 `.find()`，**首个命中生效**
（第一次放反了，自查时抓到）。

> **用户侧的坑**：模型列表拉回来的名字是 `agnes-video-2.5-fast`，而文档里这个 id 压根不存在
> （只有 `-flash`）。全仓搜过，`-fast` 不是我们生成的。用户改成 `agnes-video-2.5-flash` 后即通。

### 6.2 图像：`400 n must be 1` 只是四个不兼容里第一个暴露的

`agnes-image-2.1-flash` 匹配不到任何图像目录条目，落到「声明式兜底」spec，
而那条兜底写死 `maxN: 4` —— **凭空断言一个没人测过的端点一次能返回 4 张图**。
Agent 因为「两只妖兽」要了 2 张，`n: 2` 就原样上了线。

**猜错的两个方向代价不对称**：猜低，要 4 张照样给 4 张（Form A 图像会 fan-out 成 4 次单图请求，
同一个函数里同步端点那条分支早就这么干了）；猜高，整个请求直接 400，用户什么都拿不到。
所以兜底改成 `maxN: 1`。

但只修 `n` 会接着撞上另外三个：

| 项        | OpenAI 标准              | Agnes                                |
| --------- | ------------------------ | ------------------------------------ |
| 数量      | `n`                      | **没有这个参数**                     |
| 尺寸      | `size: "1024x1024"` 可选 | `size` **必填**，档位 `1K`–`4K`      |
| 画幅      | 编在 size 里             | 独立的 `ratio` 字段                  |
| 参考图    | multipart 传 edits 路由  | **JSON body 里的 `image: string[]`** |
| seed/负面 | 支持                     | **都没有**                           |

所以给 Agnes 图像单独建了目录条目和 body 构造器，照 seedream 网关那条现成的路子走。
路由没变（还是 `POST /v1/images/generations`），只有 body 不同；匹配钉死 `agnes-ai.com`，
免得中转网关上一个叫 agnes 的模型被塞一个它读不懂的 body。

**自查抓到一个自伤**：常量最初放在 adapter 里让目录去 import，但目录是渲染层要加载的
（媒体选择器靠它），而 adapter 间接依赖 `fs` —— 这会炸渲染进程，**`tsc` 查不出来**。
已反转成常量放目录、adapter 去 import，和 `ARK_SEEDREAM_CATALOG_ID` 同一个模式。

### 6.3 顺带：识别「对方队列排满」

```
503 {"code":"video_queue_unavailable","message":"video queue is unavailable, please retry later"}
```

以前分类不出来，卡片上直接甩一坨原始 JSON。新增 `serviceBusy` 类，**刻意不并进 `rateLimit`**：
429 指向用户自己的 key/配额、有他能控制的补救；这个没有，只能等。

**刻意没做自动重试**：执行器目前只对 `notRouted` 自动重试（那是往另一个协议打一次廉价探测）。
提交阶段的 503 说不清任务到底进没进队列 —— 付费视频生成上赌这一把，可能让用户为一个 prompt 付两次钱。

---

## 7. CI：把 macOS 签名身份塞给了 Windows 构建

现象：构建日志打印 `signing with signtool.exe`，产物却是 `NotSigned`。

根因：Windows 构建步骤的 `env:` 是从 macOS 那段**整块复制**过来的，`IDENTITY` 也一起带过来了。
在 Windows 上 `CSC_NAME` 会变成 `win.certificateSubjectName`，于是 electron-builder 去找一个
主题名是 Apple Developer ID 的证书，找不到可用的、却还是调了 signtool。

**这是两头不落好**：没有签名，还有一份说有签名的日志 —— 这正是它一直没被发现的原因。

按用户决定：**Windows 签名先不做**。摘掉 `CSC_NAME` / `identity`，`CSC_IDENTITY_AUTO_DISCOVERY`
显式留 `false`（而不是干脆不写），让它连找都不去找。

打包和使用不受影响，而且由测试说了算而不是靠信任：没有任何地方设 `forceCodeSigning`，
所以缺签名不会让构建失败；`signAndEditExecutable` 保持开启，所以 rcedit 照常把图标和版本信息写进 exe。

> 守卫测试**对改动前的 workflow 实际跑过一次、确认会红**，不是假设。

---

## 8. moltbook 残留清理（仅本机数据）

它不在文件系统里 —— 是 `skills` 表里一条**指向已不存在目录**的行
（`source=builtin`、`enabled=1`、`deleted_at=NULL`）。列表读的是数据库，所以文件早没了它还在显示。

先试 app 自己的删除接口，**清不掉**：`delete_skill` 只查文件系统，文件没了就报 404 `NOT_FOUND`。

> **这是一个还没修的缺口**：一个技能能出现在列表里，删除接口却说它不存在。
> `delete_skill` 看文件系统、`list` 看数据库 —— **两边判断「存在」的依据不一样**。
> 这次是孤儿行，下次可能是别的形式。要修在 dream-core。

改用后端自己那条软删除语句（`sqlite_skill.rs:174`）逐字执行，动库前停 app（WAL 锁）并备份
`one-backend.db` + `-wal` + `-shm`：

```sql
UPDATE skills SET enabled = 0, deleted_at = ?, updated_at = ?
WHERE name = 'moltbook' AND deleted_at IS NULL
```

| 项           | 前     | 后       |
| ------------ | ------ | -------- |
| 技能总数     | 143    | 142      |
| builtin      | 27     | 26       |
| 「我的技能」 | 139    | **138**  |
| 「内置」胶囊 | 内置 1 | **消失** |

选软删除而非硬删除，可逆。**重启后没有被重新物化回来**，说明嵌入语料里确实已移除。

---

## 9. 验证方式：CDP 真机

本轮大部分结论不是靠读代码得出的，是靠驱动真实运行的 app 量出来的。

项目**刻意删掉了应用级 `remote-debugging-port`**（改成单目标 CDP 桥，只暴露侧边浏览器），
但留了 dev 专用开关：

```bash
DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev
```

真机验到的、纯看代码看不出来的东西：

1. **卡片高度的三个成因**（§3）—— 逐个用 CDP 改样式二分出来的。
2. **专家市场 252 张卡零中文**（正则全量扫过），技能市场 139 张同样。
3. **详情页顶部 “Skill info” 还是中文** —— 截图一眼看出来的漏网组件，当轮补上（`4ed2902`）。
4. **Agnes 生图端到端跑通**：走 `ipcBridge.media.startJob`（和界面同一条路）、用户自己的渠道、
   **故意仍然要 2 张图**，结果 `status: done` / `assets: 2`，两张 2048×2048 PNG ——
   这个尺寸本身就是验证，对应新条目的 `size: "2K"` + 默认 `ratio: "1:1"`；
   两次请求时间戳差 31 秒，印证 `maxN: 1` 的 fan-out 生效。

### ⚠️ 改了 `common/` 必须重启主进程

中途有一次用户重试仍然报同样的错，我差点当成「修复无效」。实际是：

| 项                              | 值        |
| ------------------------------- | --------- |
| dev 启动                        | 19:50:53  |
| 图像修复提交                    | 20:05:29  |
| `out/main/index.js` 构建时间    | **19:51** |
| 该文件里 `agnes-image` 出现次数 | **0**     |

**媒体生成跑在主进程里，而 electron-vite 在 `common/` 下的改动不触发主进程重建** —— HMR 只管渲染层。
判断「修复是否生效」之前，先 `grep` 构建产物确认代码在不在里面。

---

## 10. 保留意见 / 未做

- **Windows 代码签名本身**：用户明确划走，先不做。SmartScreen 警告是不签名的固有代价。
- **`delete_skill` 与 `list` 的存在性判据不一致**（§8）：需要改 dream-core，本轮未动。
- **声明式*异步*分支仍是 `maxN: 4`**：Form C 没有 fan-out 兜底，猜低意味着用户要 4 张只拿到 1 张 ——
  那是真的取舍，不是白捡的；且目前没有证据表明某个异步端点会拒绝 `n > 1`。等有实据再动。
- **`POST /api/one/billing/media-precheck` 返回 404**：日志里看到，生成本身不受影响
  （Agnes 现在免费），但这条计费预检路由在后端不存在。未跟进。
