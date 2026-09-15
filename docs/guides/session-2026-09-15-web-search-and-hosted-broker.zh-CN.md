# 2026-09-15：联网搜索从零接入，以及「内置 Key」为什么最终落到 broker

涉及三个仓库：**dream-ui**（内置 MCP + 设置入口）、**dream-core**（白名单）、
**dream-trial-broker**（mode C 托管搜索）。

---

## 1. 起点：One Work 根本没有联网搜索

用户问「为什么找不到最新消息」。三层都查了，结论不是"搜索坏了"，而是**从来就没有**：

| 层                                                                           | 实际情况                                                                                                              | 为什么容易误判成"已经有了"               |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| dream-engine 内置工具                                                        | 只有 9 个：`edit` / `exec_command` / `glob` / `grep` / `read` / `read_image` / `view_image` / `write` / `tool_search` | `tool_search` 是"搜工具"，名字像联网搜索 |
| dream-core `ModelType::WebSearch`、dream-ui `CAPABILITY_PATTERNS.web_search` | **只是按模型名打的 UI 标签**，不给模型任何能力                                                                        | 界面上真的会显示"支持联网搜索"           |
| 内置 MCP `one-browser`                                                       | 是浏览器自动化，模型得自己知道 URL                                                                                    | 它确实联网                               |

**能力其实差一步就通了**：MCP stdio transport 后端早就支持 `env`
（`dream-core-api-types/src/mcp.rs`），JSON 导入界面也原样透传。所以技术上用户
"能"填 key —— 但那个入口是粘一段 JSON，还得背下 env 变量名。**缺的不是能力，是一个人能走完的入口。**

---

## 2. 做法：一个内置 MCP，对模型只暴露一个工具

`one-web-search`，只暴露 `web_search`，换服务商不改工具名和返回格式。

否决的替代方案：预置 Tavily/Serper/Brave 三家现成的第三方 MCP 包。国内四家根本没有
官方 MCP，最终会变成"国外靠第三方包、国内靠自研"两套东西：工具名不一、返回格式不一、
还要 npx 首次拉包。

### 最终核实的端点表（全部以实测为准，不是照文档抄）

| id         | endpoint                                                                      | 认证                                   | body                                 | 结果路径                                     |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------ | -------------------------------------------- |
| bocha      | `api.bochaai.com/v1/web-search`                                               | Bearer                                 | `{query,count,summary}`              | `data.webPages.value`（title 字段叫 `name`） |
| zhipu      | `open.bigmodel.cn/api/paas/v4/web_search`                                     | **Bearer**                             | `{search_query,search_engine,count}` | `search_result[]`                            |
| volcengine | `open.feedcoopapi.com/search_api/web_search`                                  | Bearer                                 | `{Query,SearchType,Count,Filter}`    | `Result.WebResults`                          |
| aliyun     | `{host}/v3/openapi/workspaces/{ws}/web-search/ops-web-search-001`（无默认值） | Bearer                                 | `{query,top_k}`                      | `result.search_result`                       |
| tencent    | `api.wsa.cloud.tencent.com/SearchPro`                                         | Bearer                                 | 只有 `{Query}`                       | `Pages` = **JSON 字符串数组**                |
| tavily     | `api.tavily.com/search`                                                       | Bearer（**不是** body 里的 `api_key`） | `{query,max_results}`                | `results[]`，snippet 字段是 `content`        |
| serper     | `google.serper.dev/search`                                                    | `X-API-KEY`                            | `{q,num}`                            | `organic`                                    |
| brave      | `api.search.brave.com/res/v1/web/search`                                      | `X-Subscription-Token`                 | GET query string                     | `web.results`                                |
| custom     | 用户填                                                                        | 可配                                   | 可配                                 | 只走结构扫描                                 |

**关键结论：没有一家需要 AK/SK 签名**，全是单个 API key —— "填一个 key"的 UI 对全部够用。
（腾讯云另有一条 `wsa.tencentcloudapi.com` 的路径需要 TC3-HMAC-SHA256 签名，刻意没走。）

百度/搜狗不做：它们只返回短摘要、要求调用方自己爬网页，做进来等于还得内置一个爬虫。

---

## 3. 一路上修掉的真实 bug（都不是编译期能发现的）

### 3.1 内置 MCP `enabled` 了也进不了会话（dream-core）

用户截图里模型拿着 `a-stock-data` 去查最新消息，`web_search` 根本没出现。
日志里 `mcp_count=1` 是唯一的线索。

根因：`session_mcp.rs` 的 `AUTO_INJECTED_BUILTIN_NAMES` 是一份**白名单**，
不在名单上的内置 MCP，无论 `enabled` 与否都不会注入会话。
**`enabled: true` 是必要条件，不是充分条件。**

### 3.2 `updateServer` 会静默忽略 `enabled`

设置页保存时把 `enabled` 一起塞进 `updateServer` 的 payload —— 后端在这个接口里
根本不读这个字段，只有 `toggleServer` 能改。表现是：界面说"已启用"、key 也存上了，
**条目却一直是关的**，工具从来没加载过。

而且 `toggleServer` 是**翻转不是设置**，只能在目标状态与当前状态不同时调用。

只有把条目读回来才能发现。Mock 的 IPC 永远测不出这个。

### 3.3 豆包指向 Ark、阿里云指向 cloud-iqs —— 两次同一种错

豆包搜索被指到了 `ark.cn-beijing.volces.com`（方舟，是另一个产品），
阿里云被指到了 `cloud-iqs.aliyuncs.com`（IQS，也是另一个产品）。

**两次都是被"探测法"骗的**：拿一个无效 key 去打，看服务是回"凭据被读取并拒绝"
还是"缺少凭据"。方舟对一个完全有效的 key 也回 401；IQS 的 403 甚至还贴心地
给出了申请 key 的控制台地址 —— 于是错误的端点看起来像是被证实了。

> **方法论教训（本次最贵的一条）**：
> 探测只能证明*那个地址上有个服务*，**不能证明它就是你要的那个服务**，
> 更不能说明请求体该长什么样。端点必须以厂商文档里该产品自己的页面为准。

### 3.4 大小写敏感的字段匹配

火山返回 PascalCase（`Title` / `Url`），归一化里的字段名表是小写精确匹配，
一条都匹配不上 —— **就算端点是对的，也会返回零结果**。改成大小写不敏感。

### 3.5 智谱发的是裸 key 不是 `Bearer`

照着记忆写的。重新读文档才发现。

### 3.6 判别式联合不收窄

`SearchOutcome` 本来写成 `{ok:true,...} | {ok:false,...}`，`if (outcome.ok)` 之后
所有字段访问都编译不过。根因：**`dream-ui/tsconfig.json` 的 `strict`/`strictNullChecks` 是关着的**，
而 AGENTS.md 里写着"Strict mode enabled"。没有 `strictNullChecks`，TS 不按字面布尔量收窄联合。

改成扁平可选字段的记录。新写这类结构前先看 tsconfig，别信文档里的那句话。

### 3.7 snippet 里的换行把编号列表冲垮

厂商返回的正文自带换行，塞进编号列表后每个续行都从第 0 列开始，条目边界完全消失，
整块读起来是一堵墙。加了 `flatten()`。**只有真跑一次才看得见。**

### 3.8 Agnes `.cn` 主机不在 catalog —— 一个总闸

`catalog` 不认某个 host，等于该厂商的**全部**修复静默失效。
（详见 memory `agnes-cn-host-gates-all-media-fixes`。）

### 3.9 `echo "tsc=$?"` 取到的是 `head` 的退出码

`bunx tsc --noEmit | head -30` 之后的 `$?` 是管道最后一个命令的。类型错误被整个吞掉。
改成先重定向到文件再看退出码。

---

## 4. 「把 Tavily key 内置进 One Work」为什么变成了 broker

用户的要求是合理的：让用户开箱就能搜，不必先去注册七家里的某一家。

但 `gaogg521/dream-ui` 是 **public 仓库**，而 Electron 的 asar 是**可解开的归档**。
两条路都不成立：

| 做法                    | 结果                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| 硬编码进源码            | 公开仓库即泄露，git 历史永久留存，GitHub 密钥扫描会发现，Tavily 大概率直接吊销 → **所有用户一起断** |
| 打包时从 CI secret 注入 | 不进仓库，但解包就能拿到 —— 只是慢一点泄露                                                          |
| **走 broker 代理**      | key 不离开服务端，可限额、可封单个用户、换 key 不用发版                                             |

**客户端里没有"藏得住的密钥"这回事。** 这与 mode B（宝云计量代理）当初的判断完全一致。

### broker mode C：`POST /v1/search`

和 mode A/B **不共用任何代码和任何表**，同样是 opt-in（没有 `SEARCH_TAVILY_API_KEY`
就整个关掉，回 `503 search_unavailable`）。

比 mode B 简单的地方：搜索按次计费，一次就是一个单位，所以**没有账本、没有充值**，
只有"每设备每天的额度"和"全局当日闸"。

两个只有真跑起来才会暴露的细节：

1. **先预留再调用**（`store::reserve` 在 upstream 调用之前），否则同时到达的两个请求
   会读到同一个未超限的计数、双双放行。失败时退还（`release`）—— 没有这个退还，
   **一次上游故障会悄悄吃掉每台设备的当日额度**，而且在故障恢复很久之后仍然显示
   "额度已用完"。退还有下限 0，重复退还不会凭空造出额度。
2. **少于 2 个字符的 query 在 broker 这里就拒掉**。实测 Tavily 对一字查询回 400，
   放过去的代价是一次往返 + 一次预留 + 一次退还，最后得到一个看不懂的 `upstream_error`。

> 这条是被自己的冒烟测试抓到的：我用 `'b'`、`'c'` 当查询词，连着 4 个 502，
> 差点以为是退还逻辑坏了 —— 日志里才写着 "Min query length is 2 characters"。

### 客户端侧

- `resolveWebSearchRoute()`：**用户自己的 key 永远优先于 broker**。这条搞反的代价是
  花我们的额度、而用户自己付费的 key 闲置 —— 而且是无声的，因为两条路返回的结构一模一样。
- install id = `sha256('one-work-web-search:' + analyticsId)` 的前 32 位。
  broker 只需要分辨两台设备，不需要更多；直接发 OS 的 MachineGuid 等于把一个
  **跨所有应用稳定**的标识交给自己的服务器。
- 有 broker 才默认开启。没有（dev 构建、自建部署）保持关闭 —— 开着一个搜不了的工具
  只会白白浪费模型一次调用。
- 存量安装只启用**一次**，用 `migration.webSearchHostedEnabled_v1` 一次性标记挡住。
  内置媒体 MCP 那段是每次启动都重新启用的，**用户关掉后重启又会自己打开** —— 那个形状
  刻意没有照抄。

---

## 5. 验证记录

| 项                      | 做法                                                                                                 | 结果                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| broker 单测 + 集成测试  | `cargo test`                                                                                         | 45 passed（含额度耗尽、上游失败退还、全局闸、未配置、prune、重复退还） |
| broker 真实 Tavily      | 本机起 broker，真 key，`POST /v1/search`                                                             | 3 次 200 → 第 4 次 `429 search_quota_exhausted`                        |
| **内置 MCP 真实 stdio** | 用 `out/main/builtin-mcp-web-search.js`（**就是打包要发的那个 bundle**）跑 JSON-RPC，指向本机 broker | `active: hosted`，返回 3 条带 URL 的中文结果                           |
| 额度耗尽经 MCP          | 打满 broker 额度后再调                                                                               | `isError: true`，文案给出"等重置"和"填自己的 key"两条出路              |
| 用户 key 优先           | 同时设 `WEB_SEARCH_KEY_TAVILY` 与 broker（且 broker 额度已耗尽）                                     | `active: tavily`，正常返回 —— 优先级正确                               |
| dream-ui 单测           | `vitest run tests/unit/webSearch`                                                                    | 45 passed                                                              |
| 类型 / i18n / 格式      | `tsc --noEmit`、`check-i18n.js`、`oxfmt`                                                             | 全绿，13 语言齐                                                        |

---

## 6. 未完成 / 交接

1. **broker 生产环境还没开 mode C**。`43.163.105.71` 的 `.env` 里还没有
   `SEARCH_TAVILY_API_KEY`，所以线上现在会回 `search_unavailable`
   （客户端会优雅降级成"请填自己的 key"）。开启方法见
   `dream-trial-broker/deploy/DEPLOY.md` 的「Enabling mode C」一节 —— 改 `.env` + 重启，
   **不用重新编译，也不用发客户端版本**。
2. **`dream-trial-broker` 是本地仓库，没有 remote**，本次提交只在本机。
3. 仍未用真实 key 验证过的服务商：智谱、腾讯、Serper、Brave（只核到文档层面）。
4. 调试期间用过的四个 key（博查 / 豆包 / 阿里云 / Tavily）**一个都没有进仓库**
   （提交前 `git grep` 核过）。但它们出现在对话记录里，**建议全部吊销重发**。
