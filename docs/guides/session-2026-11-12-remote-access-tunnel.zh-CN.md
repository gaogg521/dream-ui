# 远程访问隧道：手机在局域网之外访问自己的电脑（2026-11-12）

设置 → 远程连接 → 「随时随地访问」。打开后桌面端拉起内置 frpc，连到我们自建的 frps，手机访问
`https://<子域名>.r.1work.vip` 就是**这台电脑自己的** WebUI（本地文件、CLI、MCP 都在）。
不是多租户：A 的手机只会连到 A 的电脑。

## 链路

```
手机 ──https──> nginx :443 (*.r.1work.vip，Let's Encrypt 泛域名证书) ──> frps vhost 127.0.0.1:7080
                                                                         │
桌面 frpc ──wss://1work.vip/~!frp──> nginx :443 ──> frps 127.0.0.1:7000 ──┘
                                                   │ 每次 Login / NewProxy / Ping
                                                   └──> dream-trial-broker /internal/frp/handler
```

- 服务端全部在 `43.163.105.71`（新加坡，不需要备案）。部署配置、证书签发/续期、吊销方法见
  `dream-trial-broker/deploy/tunnel/README.md`。
- 子域名与密钥由 broker 发放（`POST /v1/remote/register`，库里只存密钥的 SHA-256）。frps 自己的
  `auth.token` 写在公开的安装包里，**不是密钥**；真正的鉴权是 broker 插件：每个隧道只能用自己的
  密钥登录、只能在自己的子域名上开一个 http 代理（TCP/UDP、自定义域名、占别人子域名都拒绝）。

## 桌面端

| 文件                                            | 作用                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `process/services/remoteTunnel/frpcConfig.ts`   | 纯函数：frpc 配置、注册响应校验、frpc 日志分类、重启退避                                         |
| `process/services/remoteTunnel/RemoteTunnel.ts` | 监督：注册→写配置→拉起 frpc→状态；意外退出退避重启；被拒绝时重新注册一次；停止时删除含密钥的配置 |
| `process/services/remoteTunnel/index.ts`        | 接 Electron（路径、spawn、broker 地址）；进程级 `relayToken`                                     |
| `process/utils/webuiConfig.ts`                  | 隧道跟随 WebUI 生命周期；偏好 `webui.desktop.remoteTunnel` 重启后恢复                            |
| `renderer/.../webuiTunnel/`                     | 设置页开关、地址、状态；二维码在隧道连通时改用外网地址                                           |
| `scripts/prepareFrpc.mjs`                       | 构建时按平台下载 frpc v0.72.0，**按官方 sha256 钉死**；`build-with-builder.js` 自动调用          |

- 地址和密钥存在 `<数据目录>/remote-tunnel/remote-tunnel.json`（0600），重启后地址不变；
  「换一个新地址」会重新注册。
- 开发机上 frpc 取自 `resources/frpc/<平台>-<架构>/`（已 gitignore，`node scripts/prepareFrpc.mjs` 生成）。
- ⚠️ **只在 win32-x64 真机验证过**。mac/linux/arm64 的下载与解压逻辑写了（校验和已钉），没跑过。
  每个平台安装包约 +17 MB。

## 页面结构

设置 → 远程连接 的 WebUI 页：顶部是**总览主卡**（`RemoteHero.tsx`：一句话说明手机现在怎么连、本机服务/局域网/外网三个状态胶囊、
手机该打开的地址、**扫码登录二维码**——二维码原来埋在页面最底下），下面按「连接方式 / 通知 / 账号」分组：

- 连接方式：本机 WebUI 服务、局域网访问（两列）→ 外网访问（随时随地访问，含地址/复制/换新地址/安全提示，
  以及独立的「需要在外网临时访问？让管家帮我开一个临时公网链接」按钮行）
- 通知：任务完成后推送到我的聊天（开关在卡片标题右侧，开启后才出现机器人选择器）
- 账号：登录信息

`SettingsCard.tsx` 是通用卡片：图标颜色跟随状态（绿=开启/成功，黄=进行中，红=出错，灰=关闭），状态用胶囊显示，
浅底 + 细边框 + 轻阴影与页面底色拉开层次。已在浅色、深色（`theme.activeId` 切到深色预设）和 480px 窄屏下用真机截图确认。
`PushTargetField` 的 `embedded` 模式只渲染选择区，开关由外层卡片负责。

## 真机验证了什么（dev 客户端 + 公网）

开关 → 「已连接」→ 公网 HTTPS（真证书，约 0.3s）拿到本机页面；改密码/生成二维码这类本机专属接口
从公网访问返回 403；重启 dev 后 WebUI 与隧道自动恢复且地址不变；伪造密钥登录被拒、拿自己凭据去占
别人子域名被拒；扫码登录整条链（公网打开页面→提交→会话可用→令牌一次性→无会话 401）。
换上带修复的新 dreamcore 后，又在**真实 Chrome（手机尺寸）**里用打包态静态资源走了一遍：打开扫码地址 →
页面显示 “Login successful! Redirecting...” → 跳转后直接进入已登录的主界面（移动端布局正常）。
（dev 模式经隧道访问根页面会空白——Vite 热更新客户端要连 `wss://localhost`，这是 dev 特有的，不是产品问题。）

## 过程中查出的三个真实问题（别再踩）

1. **限流写在了不存在的路径上。** 登录接口是 `/login`，不是 `/api/auth/login`。nginx 现在限
   `/login`、`/api/auth/qr-login`、`/api/auth/mfa/verify` 的 **POST**（GET `/login` 是登录页本身）。
2. **隧道访客共用一个后端限流桶。** 隧道请求到后端时来源都是 127.0.0.1，外人输错 5 次就把
   「5 次失败锁 15 分钟」打满，连 GET `/login` 都 429 ——主人自己也被锁在外面。修法在
   `packages/web-host/src/client-ip.ts`：frpc 给每个请求盖一个**每次启动随机生成**的
   `x-onework-relay-token`（`requestHeaders.set` 会覆盖访客自带的同名头），web-host 只有在口令对得上、
   对端是 loopback 时才采信 nginx 写的 `X-Real-IP`。**不能直接信 `X-Real-IP`**：走 Cloudflare 隧道的人
   自己填这个头会原样透传，等于能随意换桶绕过限流（后端 `audit_client_ip` 的注释专门警告过）。
3. **扫码登录这个功能从来没工作过（局域网也一样），两处都有问题**：
   - web-host 的转发白名单没有 `/qr-login`，扫码打开的是前端 `index.html`（普通登录页）而不是后端的扫码页；
   - 后端扫码页脚本发 `qrToken/deviceId/deviceLabel`，而 `QrLoginRequest` 是 snake_case 且单测断言
     camelCase 必须被拒 → 每次提交都 `Invalid JSON request body`。
     前者在本仓库已修；后者在 dream-core（`389bdd4`），**要等 dreamcore 发版 + bump pin 才进安装包**。

## 已知局限

- **电脑必须开着**，睡眠/关机手机就连不上；没有防睡眠。电脑不在线时手机看到的是离线说明页（frps 的
  `custom404Page`，`deploy/tunnel/offline.html`，10 秒探测、恢复后自动刷新）。
- 流量在中继服务器的 nginx 解 TLS，和 Cloudflare Tunnel 一样，服务器理论上能看到明文
  （设置页已写明）。要做端到端加密需每台电脑自己签证书，会撞 Let's Encrypt 每周 50 张的限制。
- 单节点 frps，没做每用户带宽/流量上限；带宽费用由我们承担，用量大了要先加限速。
- 登录失败的后端限流仍是每 IP 5 次/15 分钟；现在按真实 IP 分桶，外人只能锁自己的 IP。
- **企业版导出管控**：水印和 `.owenc` 打包只有 Electron 才有。手机/浏览器访问企业成员的机器时，公司开了水印或
  加密（默认/强制）就由网关拒绝导出并提示「请在电脑客户端导出」（`gateway.ts` 的 `unsupported_client`），
  没开保护则放行。这是**客户端侧**的拦截（和原有导出保护同一执行点），不是服务端强制。
- 完成通知：网页通知机制本来就有（`useBrowserNotification`，标签页在后台时弹）。补了首次访问的授权提示
  （`useNotificationPermissionPrompt`，原来授权入口藏在系统设置里，手机用户找不到）。**手机锁屏/浏览器被
  冻结时仍收不到**——真正可靠的推送要走 IM 渠道或小程序订阅消息，见下文方案讨论。
- **任务完成推送到 IM（已做）**：设置 → 远程连接 →「任务完成后推送到我的聊天」，选一个已连接的机器人和会话
  （复用定时任务的 `PushTargetField`），再选任务至少运行多久才推（不限/1/5/15 分钟，默认 1 分钟）。
  偏好键 `notify.turnCompleted` = `{enabled, plugin_id, chat_id, min_seconds}`，由 dream-core
  `dream-core-app/src/router/turn_push.rs` 读取：订阅实时总线，`message.stream` 的第一帧记为回合起点，
  `turn.completed` 时算时长并经 `ChannelCronPusher` 发出。**只含会话名和用时，不含结果内容**；经聊天机器人
  进来的会话不回推（回复本来就在那个聊天里）；没见过起点的回合不推；发送失败只记 warn。
  支持的平台：微信、企业微信、飞书/Lark、钉钉、Telegram（和员工通知一致，Slack/Discord 的聊天 id 需要先有会话）。
  ⚠️ 要发版 dreamcore + bump pin 才进安装包；没有 QQ 渠道插件。
- dev 模式下 WebUI 对非根路径返回 404（渲染层走 Vite 代理），所以 dev 里测 SPA 深链接没意义，
  打包态才是真实行为。
- broker 仓库（`dream-trial-broker`）没有 remote，提交只在本机。

## 运维速查

- 吊销：`UPDATE remote_tunnels SET revoked_at = strftime('%s','now')*1000 WHERE subdomain = '…';`
  （一次心跳内生效）。
- 域名换了：改 `REMOTE_TUNNEL_SUBDOMAIN_HOST`、`REMOTE_TUNNEL_SERVER_ADDR`、nginx 与证书；
  客户端地址由 broker 下发，**不用发桌面版**。
- 服务器换了：改 DNS 与 `REMOTE_TUNNEL_SERVER_ADDR` 即可，客户端下次启动重新读取注册响应
  （已注册的隧道会沿用旧的 serverAddr，需要「换新地址」才会刷新）。
