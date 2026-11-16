# 2026-11-16 frpc 改为按需下载（安装包不再带 frpc）

## 起因

「随时随地访问」用内置的 `frpc`（frp 官方客户端）做内网穿透。frp 在主流杀毒软件里有记录
（用户截图：`Riskware.Win32.Frp.V…`，黑客工具/低威胁，`resources\frpc\win32-x64\frpc.exe` 被自动隔离），
所以**只要安装包里带着 frpc.exe，装机时就会被报毒**，哪怕用户从没打开过这个功能。

## 现在的做法

- **安装包不再带 frpc**：`electron-builder.yml` 的 `extraResources` 去掉 `resources/frpc`，
  `build-with-builder.js` 不再跑 `prepareFrpc.mjs`。
- **用户第一次开启时才下载**，且必须先同意：弹窗（`settings.webui.tunnelInstallContent`）写明
  「需要下载并加载 frpc 工具（约 15 MB）…可能被部分杀毒软件误报为病毒，请放心使用」，点「同意并启用」才下载。
- 下载到 `<userData>/1one/remote-tunnel/bin/<版本>/<平台-架构>/frpc[.exe]`。

### 代码位置

| 文件                                              | 职责                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `process/services/remoteTunnel/frpcComponent.ts`  | 版本、**每个平台二进制的固定 SHA-256**、下载（新桶→旧桶依次试）、校验、落盘、落盘后等 1.5 s 复查文件还在不在（杀软实时扫描会删）           |
| `process/services/remoteTunnel/RemoteTunnel.ts`   | 监督器：`start(port, { allowInstall })`；没有组件且未获同意 → `needs_install`；下载中 → `installing`；失败 → `download_failed` / `blocked` |
| `process/services/remoteTunnel/index.ts`          | `resolveFrpcPath()`：先看已下载且**哈希仍匹配**的，再回退 `resources/frpc`（仅 dev/旧包）；状态里附带 `componentReady`                     |
| `renderer/.../webuiTunnel/WebuiTunnelSection.tsx` | 开关：`componentReady === false` 时先弹同意框；失败/缺失时卡片里给「同意并启用 / 重新下载」按钮                                            |

### 几个刻意的设计

- **信任靠固定哈希，不靠主机**：下载到的字节哈希不等于 `FRPC_BINARY_SHA256[平台]` 就丢弃并换下一个源。
  每次启动前也重算一遍落盘文件的哈希，被替换/删除都当作「未安装」重新走同意流程，不会运行被换掉的 exe。
- **同意是会话内存里的 `remoteTunnelInstallConsent`，不持久化**：启动时从配置恢复「已开启」不带同意，
  所以老用户升级后若组件缺失，看到的是「需要下载」+按钮，**不会静默下载**；开关关掉时同意清零。
- **被拦截要有出口**：`spawn` 报 `EPERM/EACCES/EBUSY/UNKNOWN/ENOENT` 或落盘后文件消失 → `blocked`，
  文案提示把 One Work 数据目录加入杀软信任。此前 `child.on('error')` 只打日志，被拒启动会永远停在「连接中」。
- 下载失败**不自动重试**（再下载是用户的决定）；隧道断线重连仍是原来的退避重启。

## 托管位置与升级 frp 版本

二进制是**从官方压缩包里解出来的原始可执行文件**，放在两个 COS 桶（公有读）：

```text
<桶>/components/frpc/<版本>/<平台-架构>/frpc[.exe]
  新桶  https://onework-1521070673.cos.ap-shanghai.myqcloud.com
  旧桶  https://1onework-1251001122.cos.ap-shanghai.myqcloud.com
```

已上传 0.72.0 的 6 个平台（win32-x64/arm64、darwin-x64/arm64、linux-x64/arm64）并从公网逐个核对过哈希。

升级 frp 版本：改 `scripts/prepareFrpc.mjs` 的 `VERSION` 与各平台官方压缩包哈希 → 逐平台跑它 →
对 `resources/frpc/<key>/` 里的原始二进制算 SHA-256 填进 `frpcComponent.ts` 的 `FRPC_BINARY_SHA256` →
上传到两个桶同样的路径。**两个桶都要传**：新旧客户端的回退顺序不同，桶里缺一份只会在回退时才暴露。

凭据：新桶用 `Desktop\feishu.txt` 里第二对 SecretId/SecretKey（子账号）；旧桶走
`scripts/fetch-cos-credentials.js --format sh`（内网凭据服务）。

## 真机验证（2026-11-16，dev + CDP）

把 `resources/frpc` 挪走以模拟「没有组件」，起 dev：

1. 数据里原本就开着开关 → 首屏是「需要先下载 frpc 组件才能使用」+「同意并启用」按钮，**没有下载**；
2. 关掉再打开 → 弹出同意框，文案与按钮符合预期；
3. 点「同意并启用」→ 卡片显示「正在下载远程访问组件…」→ 已连接并拿到 `https://<子域名>.r.1work.vip`；
4. 文件落在数据目录，17,431,040 字节，哈希与固定值一致；关闭后回到「未开启」。

另用真实代码对真实 COS 单独跑过 `downloadFrpc`（含落盘后等待与 `frpc --version`），3.5 s 完成。

## 已知局限 / 后续

- **下载下来的 frpc.exe 仍然是同一个被杀软认识的文件**：这个方案只是把报毒从「装机时」挪到「用户主动开启并已被告知时」，
  并且报毒后有明确提示与重试路径。用户装的杀软若在写盘瞬间就删除，会走 `blocked`。
- 根治办法是**不再使用 frp**：把隧道客户端写成 Node 实现、跑在 Electron 主进程里（无额外 exe），服务端换成自己的 WebSocket 中继。
  工作量在服务端中继 + 真机验证，已作为独立任务提出。重编译改名版 frp 不推荐（启发式查杀照样命中，是猫鼠游戏）。
- 老包（3.0.18 及以前）从未带过这个功能，没有兼容问题；打包预检没有引用 frpc。

## 顺带

- 「工作中 + 计时」改为会话流内联显示，见 `MessageRunningIndicator`（同日提交 `b92b2b9f`）。
- 标题栏语言切换图标由地球改为翻译图标。
- `Modal.confirm` 在新代码里用 `Modal.useModal()`（项目惯例）；直接用静态 `Modal.confirm` 在单测里会因 React 19 没有 `ReactDOM.render` 报错（应用入口有适配器，测试环境没有）。
