# 体验额度入口重做 + 41 处死色值类名（2026-09-24）

> 跨仓：本轮 dream-ui 的改动配合 `dream-trial-broker` 的 §11.15 ~ §11.17
> （见该仓 `docs/baoyun-metered-proxy-handoff.zh-CN.md`），后端侧的"老 key 回填"
> 和"查询页重做"记在那边，这里只记 dream-ui 自己的部分。

## 1. 白屏：Arco 的触发类组件不能直接包 IconPark 图标

**现象**：用户报"点开查询图标就白屏"。真机 DevTools 看到的是
`An error occurred in the <Trigger> component` 加一大串
`recursivelyTraverseLayoutEffects`，`#root` 空了，整棵 React 树被卸载，界面只剩
`body` 的背景色。`Ctrl+R` 能恢复——所以**很容易被误判成 dev 环境偶发抽风**，我
自己一开始就是这么判的。

**根因**（实测，不是推断）：

- Arco 的 `Trigger`（`Tooltip` / `Popover` / `Popconfirm` / `Dropdown` 内部都是
  它）要拿 child 的真实 DOM 节点来算弹层位置，走的是 ref。
- IconPark 图标是普通函数组件，**不转发 ref**。Arco 于是退回
  `ReactDOM.findDOMNode`——**React 19 把这个 API 删了**（本仓库 react 19.2.8，
  `typeof ReactDOM.findDOMNode === 'undefined'`）。
- 拿到 `null`，在 layout effect / rAF 回调里抛
  `Cannot read properties of null (reading 'offsetParent')`。

Arco 自己会在控制台打一条温和的 warning（`Element does not define the
getRootDOMNode method...`），很容易当噪音略过。

**修法**：触发类组件的直接 child 必须能转发 ref——包一层 `<span>`，或用 Arco 自己
的组件。本轮修了两处（`TrialQuotaBadge` 的查询图标、定时任务页的
`<Tooltip><Attention/></Tooltip>`），并加了全仓守卫
`tests/unit/renderer/noBareIconInArcoTrigger.test.ts`。

**⚠️ 写这类测试的坑**：这个崩溃**默认不会让 vitest 失败**——React 19 用
`reportError`（window error 事件）上报，而 Arco 的定位又在 `requestAnimationFrame`
里跑，共享的 dom setup 把 rAF 挂在 Node 定时器上，**回调在测试早已通过之后才执行**，
只会打印一句 "Unhandled Errors"。`TrialQuotaBadge.dom.test.tsx` 的做法是：
`vi.useFakeTimers()` + 在测试内 `runOnlyPendingTimers()` 把 pending frame 抽干，
再加 window error 监听。**验证方式**：把裸图标塞回去，6 个测试挂 5 个才算这测试
是活的。

## 2. 41 处色值类名是死的（17 个文件）

Arco 把调色板存成**逗号分隔**的通道：`--primary-6` 是 `22,93,255`，不是
`22 93 255`。UnoCSS 会把 `text-[rgb(var(--primary-6))]` 编译成

```css
color: rgb(var(--primary-6) / var(--un-text-opacity));
```

这是**空格分隔**的现代语法，喂逗号值就是非法 CSS，浏览器**丢掉整条声明**。成功
勾、危险色文字、警告条、会话 minimap 的选中态……全部在渲染成继承的默认色。

**为什么能躺这么久**：没有任何症状可循——类名在元素上、生成的 CSS 文件里有对应
规则、DevTools 里搜得到，**只有 computed style 里那一行是缺的**。

**判据**（唯一可信的）：在运行中的 app 里读 computed style。探针：

```js
const d = document.createElement('div');
d.style.color = 'rgb(var(--primary-6) / 1)';
document.body.append(d);
getComputedStyle(d).color; // 继承色 → 中招；真色 → 没事
```

**修法**：`rgba(var(--x),1)`；带透明度修饰符的（`/40`）要写成显式 alpha
`bg-[rgba(var(--x),0.4)]`，因为 UnoCSS 无法给一个已经带 alpha 的值再追加一个。
守卫测试 `tests/unit/renderer/arcoPaletteVarSyntax.test.ts`。

**不要一起改的**：纯 CSS 文件和内联 style 里的 `color: rgb(var(--x))` 是**合法
的** legacy 语法（没有 UnoCSS 给它追加 alpha），全仓还有几十处，别顺手扫掉。

## 3. 充值 / 用量查询的产品级重做

- **余额从"裸标签 + 旁边一个孤零零的放大镜"改成药丸形菜单按钮**（钱包图标 + 余额
  - ▾），点开是「充值 / 查询用量」。触发器用普通 `<span>` 而不是 Arco `Button`：
    Button 自带的背景/边框规则要靠 `!important` 去压，而 span 天然转发 ref，正好
    是 Trigger 需要的。
- **充值弹窗**：第一行从"选择金额"这个标签，改成**这笔交易要改变的那个数字**
  ——当前余额；选了金额就地显示「充值后 ¥36.00」，按钮文案跟着变成「支付 ¥20.00」。
  快捷金额改成 4 格网格。新增 `remainingAmount()`（`useTrialQuota.ts`）——
  `remainingLabel` 是给显示用的，要做算术得有个返回数字的。
- **查询用量不再让用户粘 key**：原来的真实流程是「打开编辑模型平台 → 复制 key →
  粘进网页」，而 app 手里本来就有这把 key。现在用 **URL fragment**
  （`#key=...`）交给页面——fragment 浏览器不发给服务器，不进 nginx / broker 日志；
  页面读完立刻 `replaceState` 抹掉。多把 key 轮询时只送第一把；没有 key 就原样
  打开让页面自己问（分享链接也是这个形态）。

## 4. 前后端加载

本轮**只改了 dream-ui 渲染进程 + 一个 broker 静态页面**，没有动 dream-core 的
Rust（那边只是删了一条已经没人调的代理路由，`23add80`）。

| 改动                                           | 怎么生效                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/desktop/src/renderer/**`             | `bun run dev` 热更新即可；崩溃后 `Ctrl+R`                                 |
| `packages/desktop/src/index.ts`（dotenv 加载） | **主进程，不热更新**，必须重启 dev                                        |
| broker 的 `webui/usage.html`                   | 在 broker 仓 `deploy/redeploy.sh` 重新编译部署（`include_str!` 进二进制） |

**⚠️ dev 下体验额度功能默认是关的**：`DREAM_TRIAL_BROKER_URL` 只有**打包版**才
自动注入（`packages/web-host/src/backend-launcher.ts` 的 `isPackaged` 判断）。
本轮给主进程加了 dev-only 的 `.env` 自动加载（`f116009`），仓库根目录放一个
gitignore 掉的 `.env`：

```
DREAM_TRIAL_BROKER_URL=https://work.1oneclaw.com/trial-broker
```

不带这个变量起 dev，整个试用 key 子系统会报"未配置"，余额标签和菜单**整个不
渲染**——看起来像功能没了，其实是没配。
