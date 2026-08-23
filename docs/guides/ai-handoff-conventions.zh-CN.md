# AI / 开发者交接约定（fork v2）

> **读者**：后续接手的 AI 或人类开发者。  
> **仓库**：`D:\aionui-m0\1oneUI` + `D:\aionui-m0\1oneCore`；脚本 `D:\aionui-m0\scripts\`。

---

## 1. 用户明确要求（必须遵守）

**每次功能/修复改完后，必须更新文档**，让下一个 AI 能看懂：

- 改了什么、为什么改
- 踩了什么坑、怎么验证
- **改了前端还是后端 → 该怎么重启/加载**

文档落点（按优先级）：

| 内容                   | 写到哪里                                                      |
| ---------------------- | ------------------------------------------------------------- |
| 当次会话的功能/坑/验证 | `docs/guides/session-YYYY-MM-DD-*.zh-CN.md`（新建或追加一节） |
| 启动 / 前后端加载      | `D:\aionui-m0\scripts\README.md`（行为变化时同步）            |
| 索引入口               | `docs/README.md` Quick pointers 加一行链接                    |

不要只口头总结；**未落盘 = 未完成**。

---

## 2. 前后端加载（改完必对照）

前端 dev **不会**自动编译 1oneCore 源码；spawn 的是 `resources/bundled-aioncore/.../aioncore.exe`。

| 你改了什么                                                                           | 必须做什么                                       | 验证                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 仅 `1oneUI` 渲染进程 / 公共 TS（`packages/desktop/src/renderer/**`、`common/**` 等） | `frontend-dev.ps1`（或已在跑的 dev 热更新）      | 刷新窗口；WebUI/LAN 需 rebuild `out/`                                              |
| `1oneCore` Rust（API、迁移、agent 检测、assistant 服务）                             | `backend-rebuild.ps1` → 再 `frontend-dev.ps1`    | 日志 `starting: ...\1oneUI\resources\bundled-aioncore\...`；`/health` version 对齐 |
| DB 迁移（`aionui-db/migrations/*.sql`）                                              | **同上**：必须重编并进 bundled；重启后迁移自动跑 | 看 `%APPDATA%\1one-Dev` 下 DB / 日志                                               |
| 仅文档 / 脚本 README                                                                 | 无需 rebuild                                     | —                                                                                  |

**禁止**假设 `bun run dev` 等于后端已更新。

**进程**：重启前 `taskkill /F /IM electron.exe /T` 与 `aioncore.exe /T`，避免多实例端口错乱。

详见：`D:\aionui-m0\scripts\README.md`、`docs/guides/session-2026-07-07-evening.zh-CN.md` §2。

---

## 3. 冒烟最低线（桌面）

改完除 tsc/test 外，至少点：

1. **设置**（不黑屏）
2. **设置 → 助手**（列表与预期一致）
3. **会话首页**（助手胶囊、能开对话）
4. 若动 employee API：**超级助手 → 创建数字员工**

---

## 4. 相关会话文档

- [Fork 开发者上手指南](fork-dev-onboarding.zh-CN.md)（克隆仓库、dev、打包、Release）
- [仓库更名对照](repo-rename-2026-07-08.zh-CN.md)
- [2026-07-07 晚间：侧栏 / 企业 / 超级助手 / dev](session-2026-07-07-evening.zh-CN.md)
- [2026-07-08：1ONE CLI 品牌 + 助手按本机安装过滤](session-2026-07-08-assistant-branding.zh-CN.md)
- [2026-07-08：企业部署模式迁移 + 企业管理后台控制台首页 + 策略分发方向](session-2026-07-08-enterprise-console.zh-CN.md)
