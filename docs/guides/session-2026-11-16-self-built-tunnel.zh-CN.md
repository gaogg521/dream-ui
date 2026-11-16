# 2026-11-16 自研隧道取代 frp（桌面端不再有任何额外可执行文件）

## 起因

「随时随地访问」原来靠内置的 `frpc`（后来改成按需下载）。杀毒软件把 frp 认作黑客工具（`Riskware.Win32.Frp`），
**装包时、下载后都会被隔离**——按需下载只是把报毒挪到了用户主动开启之后（见
[session-2026-11-16-frpc-on-demand-download](./session-2026-11-16-frpc-on-demand-download.zh-CN.md)，该方案已被本文取代）。
根治办法是不再用 frp：客户端用 Node 写、跑在 Electron 主进程里，服务端换成我们自己的 WebSocket 中继。
功能当时尚未发版，没有旧版兼容包袱。

## 现在的架构

```
手机 ──https──> nginx :443 (*.r.1work.vip，泛域名真证书) ──> relay 访客端口 127.0.0.1:7080
                                                              │ 按 Host 找到该子域名的隧道
桌面(Node 客户端) ──wss://1work.vip/~!tunnel──> nginx :443 ──> relay 控制端口 127.0.0.1:7000
                                                              │ 连接时 + 每分钟复检
                                                              └──> dream-trial-broker /internal/tunnel/verify
```

- 服务端 `onework-relay`（systemd，43.163.105.71，node 22）取代 frps；注册与鉴权仍由 broker 负责。
- **一条 WebSocket 复用所有访客请求**；控制通道走 wss/443，能穿过只放行网页流量的网络。
- 中继转发的是 **HTTP 语义**（不是裸 TCP）：OPEN 带方法/路径/原始头列表/访客 IP，桌面端对
  `127.0.0.1:<端口>` 重放，再把响应头和响应体流式送回。WebSocket 升级则在 101 之后变成双向裸字节。

### 代码位置

全部在 `packages/desktop/src/process/services/remoteTunnel/`：

| 文件              | 职责                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol.ts`     | 帧格式（`[type u8][streamId u32][payload]`）、关闭码、头过滤（去逐跳头）、退避。**桌面端和中继共用这一份，不会漂移**                                    |
| `mux.ts`          | `Mux` / `MuxStream`：每个访客请求是一条 Node `Duplex`，带**按流的信用额度流控**（类似 HTTP/2），所以请求体/响应体/升级后的 socket 两端都是普通 `pipe()` |
| `tunnelClient.ts` | 桌面端一次连接：wss 拨号 → HELLO 鉴权 → 对每个 OPEN 重放到本机 WebUI；盖 relay token；idle 超时检测半开连接。**不含重连策略**                           |
| `RemoteTunnel.ts` | 监督器：注册 → 连接 → 退避重连；被拒绝只重新注册一次；停止时断开；地址存 `remote-tunnel.json`（0600）                                                   |
| `tunnelConfig.ts` | 注册响应的校验与持久化形态（纯函数）                                                                                                                    |
| `relay/server.ts` | 中继：控制端口（wss）+ 访客端口（HTTP/升级）；离线页；顶替旧连接；每分钟复检                                                                            |
| `relay/main.ts`   | 中继入口（环境变量配置）；`node scripts/buildTunnelRelay.mjs` 打成单文件 `outputs/tunnel-relay/relay.mjs`                                               |

broker 侧（`dream-trial-broker` 仓库，提交 `a2460faf`）：`POST /internal/tunnel/verify`、部署文件与 README。

### 协议要点

- 帧：HELLO / WELCOME / OPEN / HEAD / DATA / END / RESET / WINDOW。只有中继 OPEN，桌面端不会。
- 关闭码：`4401` 凭据被拒（重新注册一次，不循环）、`4409` 被同名新连接顶替、`4426` 协议版本不符、
  `1013` 凭据服务暂时不可用（视为瞬时故障）。
- 流控：每个方向起始额度 256 KiB（双方默认，不发帧）。接收方在**消费者真正读走**之后才发 WINDOW。
  窗口会**按实际需求增长**（每完整收下一个窗口的数据且没有积压就翻倍，上限 4 MiB）——见下面的「查出的真问题 1」。
- 保活：中继每 20 秒 ping，50 秒没动静就断；客户端 60 秒没收到任何帧/ping 判定半开并重连。

## 信任模型（与 frp 时代一致，做法不同）

- **每条隧道独立 secret**，由 broker 校验（库里只存 SHA-256）。中继不持有任何凭据，连接时与之后每分钟向 broker 复检，
  吊销最长 60 秒内生效。**broker 暂时不可达时已连着的隧道不会被踢**，新连接得到 1013 稍后重试。
- 隧道只能服务**自己的**子域名：中继用验证通过的名字登记，不存在“申请别人子域名”的入口。
- **relay token**：客户端对每个转发请求先丢掉访客自带的 `x-onework-relay-token / x-real-ip / x-forwarded-* / forwarded`，
  再盖上**每次启动随机**的 token 和中继告知的访客真实 IP。web-host 只有 token 对得上才采信 `X-Real-IP`
  （不能直接信：Cloudflare 隧道会透传访客伪造的值）。中继在转发前也会剥一遍，两道都是为了不依赖对方。
- 访客 IP 来自 nginx 的 `$remote_addr`；中继两个端口只听 loopback。登录限流按真实 IP 分桶。

## 真机 / 外网验证（2026-11-16，全部在线上真实环境）

用真实 nginx(443) + 泛域名证书 + 线上 broker + 线上中继，访客来自**服务器本机的公网路径**和**这台电脑**（不同 IP）：

| 项             | 结果                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| HTTP           | 200；伪造的 `x-real-ip` / `x-onework-relay-token` 被覆盖，WebUI 看到的是真实访客 IP + 桌面端自己的 token                            |
| 大响应         | 100 MB 逐字节核对 0 处不一致；30 MB 上传 SHA-256 一致                                                                               |
| 吞吐           | 修窗口之前 1.7 MB/s（链路裸速 7.4 MB/s）→ 修后服务器侧 12.5 MB/s（见问题 1）                                                        |
| WebSocket      | 文本 + 500 KB 二进制回显正确；真实 WebUI（dev 客户端）上登录后 `/ws` 升级 101                                                       |
| 扫码登录       | 真实 dev 客户端生成 QR token → 服务器侧访客 `/qr-login` 页 200、POST 换到会话。（旧文档说“从来没工作过”，该链路现在经新隧道是通的） |
| 限流分桶       | 服务器 IP 连输 5 次错密码后 429；**另一个 IP 同时仍是 401 而不是 429**                                                              |
| 断线重连       | 重启中继 ≈2.3 秒自动恢复；重启 nginx 同样自愈；吊销 → 40 秒内旧地址变离线页，客户端按设计**只重新注册一次**并连上新地址             |
| 关闭后地址失效 | UI 关开关 / 杀进程 → 立刻 404 + 离线说明页；`remote-tunnel` 目录里只剩 `remote-tunnel.json`                                         |
| 无 frp 痕迹    | 用户数据目录与仓库里都没有 frp 相关文件；安装包不带也不下载任何额外可执行文件                                                       |

dev 客户端用 `DREAM_MULTI_INSTANCE=1 DREAM_DEVTOOLS_CDP_PORT=9230 bun run dev` 起的隔离实例，CDP 点开关走完整 UI（没有同意弹窗，没有下载）。

## 过程中查出的真问题

1. **固定小窗口把长距离链路卡死在 窗口/RTT。** 第一版窗口 128 KiB，跨洋 RTT ~75 ms，理论上限 ≈1.7 MB/s——单测在回环上永远测不出来，
   真实外网下载 100 MB 才暴露（裸 scp 同链路 7.4 MB/s）。这是自研协议相对 TCP/frp 最容易吃亏的地方。
   修法：起始 256 KiB、按需倍增到 4 MiB，且**只在消费者没有积压时才增长**（慢消费者永远拿不到大窗口，内存上限不变）。
   首版我写的“发送方快没额度了就增长”是**错的**：接收方看不到发送方的空转（授权总是随消费及时发出，它看到的 outstanding 恒≈窗口），
   同样的单测在有 60 ms 往返延迟的模拟链路上才抓到。
2. **Node `Readable._read` 不是“有人消费了”的信号。** 它只在上一次 `_read` 已经 `push` 过之后才会再被调用；慢消费者把缓冲读空时
   `_read` 不会被再次触发 → 信用额度永不返还 → 传输死锁。改为在 `read()` 里归还额度（flowing/pipe 也走 `read()`）。
3. `Duplex` 上不能叫 `closed`（只读 getter）；构造时 `highWaterMark` 会**同时**设读写两侧，写侧要单独设小，否则发送端会在写缓冲里藏 4 MiB。
4. 升级请求不能把 stream pipe 进 `http.request`（头要等 `req.end()` 才发），也不能在中继侧提前 `end()` 自己的写端（101 之后还要写字节）。
5. 杀软不是唯一的坑：`taskkill` / `Get-CimInstance ... -match 'real.mjs'` 这类按命令行匹配的杀进程会把自己所在的 shell 一起杀掉，
   要按 PID 精确杀。

## 清理

- 删除：`frpcComponent.ts`、`frpcConfig.ts`、`scripts/prepareFrpc.mjs`、同意弹窗及 `settings.webui.tunnelInstall*` / `tunnelError.{needs_install,download_failed,blocked,no_binary,spawn_failed}`
  共 13 种语言文案（`bun run i18n:types` + `node scripts/check-i18n.js` 通过）、`resources/frpc`、`.gitignore` / `electron-builder.yml` / `build-with-builder.js` 里的 frpc 注释。
- 状态机与 UI 回到「开 / 关 / 连接中 / 已连接 / 错误(register_failed|rejected)」。
- 服务器：frps 停用并删除（二进制与配置备份在 `/root/frps-removed-20261116/`），nginx 控制通道改为 `/~!tunnel`，
  备份 `1onework-www.conf.bak-tunnel-relay-20261116`；旧 broker 二进制备份 `dream-trial-broker.bak-20261116-tunnel-relay`。
- 新桶 `onework-1521070673/components/frpc/`（6 个文件）已删除。
- ⚠️ **旧桶 `1onework-1251001122/components/frpc/0.72.0/*` 仍在**（公网仍返回 200）：它的凭据来自内网凭据服务
  （`scripts/fetch-cos-credentials.js`，需要连上内网/aTrust），本次会话连不上，没删成。连上内网后执行
  `aws s3 rm s3://1onework-1251001122/components/frpc/ --recursive --endpoint-url https://cos.ap-shanghai.myqcloud.com`。
  客户端已不会访问这条路径，留着只是个会被杀软扫到的公开文件。

## 已知局限

- **不支持经 HTTP CONNECT 代理出网**（frpc 也没支持）。控制通道是标准 wss/443，只放行网页流量的防火墙能过；
  必须走显式 HTTP 代理才能上网的环境暂不支持（要做的话在 `createSocket` 加 `https-proxy-agent`）。
- 同一份凭据被复制到两台电脑会互相顶替（4409 → 客户端按退避重连，稳定连接 30 秒后才重置退避，所以最多 30 秒一轮，不会 2 秒死循环）。
- 单进程单节点中继，没做每用户带宽/流量上限；内存主要是各流窗口（最坏每流 4 MiB × 最多 128 流/隧道，实际远小于此）。服务器已有 swap 压力，中继限了 `MemoryMax=600M`。
- 控制连接的握手没有按 IP 限速（只限同时未认证连接数 256 + 10 秒 HELLO 超时）；密钥 128 位熵，暴力无意义，但可被用来占连接。
- 其余（电脑必须开着、服务器能看到明文、企业导出管控在客户端）同
  [session-2026-11-12-remote-access-tunnel](./session-2026-11-12-remote-access-tunnel.zh-CN.md)。

## 运维速查

- 日志：`journalctl -u onework-relay -f`；在线隧道数：服务器上 `curl 127.0.0.1:7000/healthz`。
- 升级中继：`node scripts/buildTunnelRelay.mjs` → scp 到 `/opt/onework-relay/relay.mjs` → `systemctl restart onework-relay`（在线隧道 2~3 秒自动重连）。
- 吊销、证书、gzip 见 `dream-trial-broker/deploy/tunnel/README.md`。
- 协议升级：`PROTOCOL_VERSION` 不一致时中继以 4426 关闭；真要升版本要中继同时认两个版本，别直接改常量。
