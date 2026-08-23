# 服务端部署指南（Docker / 独立 tarball）

面向企业 IT：把 1ONE Work 部署在自己的 Linux 服务器上，不需要先装 Windows/Mac 桌面客户端。

后端 `aioncore`（Rust）本身对 Electron **没有硬依赖**——`--parent-pid` 是可选参数、有真实的优雅关闭（SIGTERM/SIGINT）、`/health` 健康检查端点、启动自动跑数据库迁移、完整的多用户 JWT 鉴权与多租户能力（SSO/组织/企业）。`aionui-web`（`packages/web-cli`）是一个真正零 Electron 依赖的独立运行时：拉起 `aioncore` + 托管前端静态资源 + 反代 `/api/*`。本指南就是把这两者包装成一条正式的部署路径。

> 旧的 [`deploy-server.md`](deploy-server.md)（Xvfb + Electron 无头跑桌面壳）已废弃，不要再用于新部署。

## 目录

- [方式一：Docker（推荐）](#方式一docker推荐)
- [方式二：独立 tarball（无 Docker 环境）](#方式二独立-tarball无-docker-环境)
- [首次启动：管理员账号](#首次启动管理员账号)
- [环境变量参考](#环境变量参考)
- [反向代理与 HTTPS](#反向代理与-https)
- [已知限制（不是 bug，是设计边界）](#已知限制不是-bug是设计边界)
- [升级](#升级)
- [排障](#排障)

---

## 方式一：Docker（推荐）

### 1. 构建镜像

`docker build` **不会**在镜像构建过程里重新编译 Rust 或 TypeScript——那是 CI（`.github/workflows/pack-web-cli.yml`）已经做过且做过 smoke test 的事。构建镜像前需要先把 `aionui-web` tarball 的暂存目录准备好：

```bash
# 从已发布的 aioncore 版本拉取（默认行为，见 package.json 的 aioncoreVersion）
PACK_PLATFORM=linux PACK_ARCH=x64 node scripts/pack-web-cli.js

# 或者：用你自己本地编译的 aioncore 二进制（无需等待任何发布）
export AIONUI_BACKEND_LOCAL_PATH=/path/to/1oneCore/target/release/aioncore
PACK_PLATFORM=linux PACK_ARCH=x64 node scripts/pack-web-cli.js

docker build -t aionui-web .
```

### 2. 用 docker-compose 起服务

仓库根目录的 [`docker-compose.yml`](../../docker-compose.yml) 是一份可直接用的示例：

```bash
docker compose build
docker compose up -d

# 查看首次启动生成的管理员密码
docker compose logs app | grep "admin password"
```

打开 `http://<服务器地址>:25808`，用 `admin` + 上面打印出的密码登录。

### 3. 单条 `docker run`（不用 compose 时）

```bash
docker run -d --name aionui-web \
  -p 25808:25808 \
  -v aionui-data:/data \
  aionui-web

docker logs aionui-web | grep "admin password"
```

---

## 方式二：独立 tarball（无 Docker 环境）

`scripts/pack-web-cli.js` 产出的 tarball 本身就是可以直接拿去内网服务器跑的离线包——单个可执行文件（`bun build --compile` 编译，不需要装 Node/Bun）+ `aioncore` 二进制 + 前端静态资源，没有 `node_modules`。

```bash
PACK_PLATFORM=linux PACK_ARCH=x64 node scripts/pack-web-cli.js
# 产物：dist-web-cli/aionui-web-<version>-linux-x86_64.tar.gz

# 传到目标服务器后：
tar -xzf aionui-web-*-linux-x86_64.tar.gz
cd aionui-web
AIONUI_ALLOW_REMOTE=1 AIONUI_DATA_DIR=/opt/aionui-web/data ./aionui-web start
```

### 用 systemd 常驻

```ini
# /etc/systemd/system/aionui-web.service
[Unit]
Description=1ONE Work WebUI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/aionui-web
ExecStart=/opt/aionui-web/aionui-web start
Environment=AIONUI_ALLOW_REMOTE=1
Environment=AIONUI_DATA_DIR=/opt/aionui-web/data
Environment=AIONUI_LOG_JSON=1
Restart=on-failure
User=aionui

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aionui-web
sudo journalctl -u aionui-web -f | grep "admin password"
```

> ⚠️ `scripts/install-web.sh` 目前的一键安装（`curl | bash`）还指向上游仓库的 GitHub Releases，对这个 fork 不成立——按上面的方式手动构建/传输 tarball。

---

## 首次启动：管理员账号

全新数据目录首次启动时，`aionui-web` 会自动检测到"还没有可用密码"，调用后端生成一个随机密码并打印到 **stdout**（`docker logs` / `journalctl` 都能看到）：

```
[aionui-web] Generated initial admin password: Xy9#mK2pQ...
[aionui-web] Log in with username "admin" and change it from the UI.
```

如果错过了这条日志（或者要重置密码），用内置的 `resetpass` 子命令——它是操作者的逃生舱：直接改数据库，不需要先登录。

```bash
# Docker — 注意 --data-dir 是 aioncore 顶层参数，必须写在子命令 resetpass 之前
# （不是 clap 的 global 参数，写反会报 "unexpected argument '--data-dir' found"）
docker exec aionui-web ./bundled-aioncore/linux-x64/aioncore --data-dir /data resetpass

# 独立 tarball / systemd（aionui-web 自己的参数解析没有这个顺序限制）
/opt/aionui-web/aionui-web resetpass --data-dir /opt/aionui-web/data
```

---

## 环境变量参考

`aionui-web`（TypeScript 启动器）自己认的变量：

| 变量                                    | 默认值                                      | 说明                                                                                                                |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AIONUI_PORT` / `PORT`                  | `25808`                                     | HTTP 监听端口                                                                                                       |
| `AIONUI_DATA_DIR`                       | `~/.aionui-web`                             | SQLite 数据库 + 日志所在目录                                                                                        |
| `AIONUI_LOG_DIR`                        | `{data-dir}/logs`                           | 日志文件目录                                                                                                        |
| `AIONUI_ALLOW_REMOTE` / `AIONUI_REMOTE` | 关闭                                        | **容器/服务器部署必须开启**，否则监听地址是 `127.0.0.1`，容器外访问不到（`packages/web-host/src/static-server.ts`） |
| `AIONUI_BACKEND_BIN`                    | 自动探测 `bundled-aioncore/<平台>/aioncore` | 覆盖后端二进制路径                                                                                                  |

底层 `aioncore`（Rust 后端，T1 阶段一新增）额外认的变量——`aionui-web` 会代为 spawn，一般不需要手动设置，直接用 `docker exec ... aioncore ...`（如上面的 `resetpass`）或独立运行 `aioncore` 时才用得到：

| 变量                | 说明                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AIONUI_HOST`       | 监听地址（`aioncore` 自身，非 `aionui-web` 的公网端口）                                                                                                 |
| `AIONUI_PORT`       | 端口                                                                                                                                                    |
| `AIONUI_DATA_DIR`   | 数据目录                                                                                                                                                |
| `AIONUI_LOG_DIR`    | 日志目录                                                                                                                                                |
| `AIONUI_LOG_LEVEL`  | 日志级别（如 `info`、`debug`、`info,aionui_mcp=trace`）                                                                                                 |
| `AIONUI_LOG_JSON=1` | stdout 控制台层也输出 JSON（默认已在 Dockerfile 里开启），方便 Fluentd/Loki/CloudWatch 等容器日志采集直接解析结构化字段，而不必进容器 tail 本地日志文件 |

命令行参数（`--host`/`--port`/`--data-dir`/`--log-dir`/`--log-level`）优先级高于同名环境变量。

---

## 反向代理与 HTTPS

`aioncore` 不做 TLS termination，这是通用做法（同任何后端服务），也和桌面端"允许远程访问"功能的既有假设一致。仓库根目录提供了一份 `Caddyfile.example` + `docker-compose.yml` 的 `caddy` profile：

```bash
cp Caddyfile.example Caddyfile
# 编辑 Caddyfile，把 your-domain.example.com 换成真实域名（DNS 需已指向本机）
docker compose --profile tls up -d
```

Caddy 自动申请/续期 Let's Encrypt 证书，不需要手动跑 certbot。

### 关于 `--local` 模式的安全性（值得了解，不需要额外配置）

`aioncore` 内部总是以 `--local` 模式被 `aionui-web` 拉起（`packages/web-host/src/backend-launcher.ts`）——这个名字容易让人误以为"跳过鉴权"，但实际语义是"桌面共置后端的历史默认行为"，真正生效的鉴权规则是：

- `aionui-web` 的反向代理会给每个转发的请求打上 `x-aionui-forwarded-origin: webui` 请求头（`packages/web-host/src/static-server.ts`）。
- `aioncore` 的鉴权中间件（`aionui-auth/src/middleware.rs`）看到这个请求头时，**不会**走"自动登录成 operator"的捷径，而是走和普通多用户部署完全一样的严格 JWT 校验——没有合法 token 一律 401。
- 这个"自动登录"捷径只在请求**完全绕开反向代理、直连 `aioncore` 自己的回环端口**时才会触发；而 `aioncore` 自己只监听 `127.0.0.1`（`aionui-web` 从不传 `--host`），容器/主机外部网络访问不到那个端口。

也就是说，每个通过公网端口进来的用户都必须用真实账号（本地密码或 SSO）登录，不存在"整个部署共享一个免登录身份"的风险。

---

## 已知限制（不是 bug，是设计边界）

这次交付的范围是**把单实例部署做扎实**，不是把架构改成水平扩展的多租户 SaaS——那是完全不同量级的项目（换数据层到 Postgres、分布式限流、对象存储……）。

- **单实例**：`crates/aionui-app/src/main.rs` 的 `DataDirInstanceGuard`（文件锁）确保同一个 data-dir 同时只能有一个 `aioncore` 进程。这不是"差点意思的多副本"，是数据层（SQLite 单文件）从设计上就没打算支持多副本。不要在多个容器/进程间共享同一个 data-dir volume。
- **SQLite**：没有连接池跨进程共享，备份就是复制 data-dir（先停服务，或至少确保没有并发写入）。
- **进程内限流**：`one-billing` 的成本上限/速率限制状态存在进程内存里，重启会清零，多副本部署下各副本互不知情——但既然是单实例设计，这不构成问题。
- **CORS**：现状是 `Any` origin、无 credentials（代码里有安全推理注释），本次未重新设计。

---

## 升级

```bash
# Docker
PACK_PLATFORM=linux PACK_ARCH=x64 node scripts/pack-web-cli.js   # 拉新版本 aioncore + 前端
docker compose build
docker compose up -d   # 数据卷不受影响，SQLite 迁移随 aioncore 启动自动跑

# 独立 tarball
# 备份旧目录（或至少备份 data-dir），解压新 tarball 到同一路径，重启进程
```

---

## 排障

- **`docker logs` 里没看到 "Generated initial admin password"**：说明数据目录不是全新的（已经设置过密码），用 `resetpass`（见上）。
- **容器外访问不到**：确认 `AIONUI_ALLOW_REMOTE=1` 已生效（`docker exec aionui-web env | grep ALLOW_REMOTE`）——这不是可选项，缺了它监听地址是 `127.0.0.1`。
- **`docker inspect` 显示 `unhealthy`**：健康检查打的是 `/api/auth/status`（`/health` 是 `aioncore` 自己的端点，反向代理不转发它，见 Dockerfile 注释），先看 `docker logs` 里有没有迁移失败或端口冲突。
- **officecli 相关报错（Office 预览/转换崩溃）**：确认镜像里有 `libicu`（本仓库 Dockerfile 已内置；如果自己重新打镜像，别漏掉）。
