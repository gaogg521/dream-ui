# 仓库更名对照（2026-07-08）

> 若文档/书签里还是旧名字，按此表替换。

| 旧名                         | 新名                    |
| ---------------------------- | ----------------------- |
| GitHub `gaogg521/dream-ui`   | **`gaogg521/1oneUI`**   |
| GitHub `gaogg521/dream-core` | **`gaogg521/1oneCore`** |
| 本地目录 `...\dream-ui`      | **`...\1oneUI`**        |
| 本地目录 `...\dream-core`    | **`...\1oneCore`**      |

## 新链接

- 前端：https://github.com/gaogg521/1oneUI
- 后端：https://github.com/gaogg521/1oneCore
- Release（安装包）：https://github.com/gaogg521/1oneUI/releases

## 已有 clone 如何更新

```powershell
# 前端
cd D:\旧中转目录\dream-ui   # 若已改名为 1oneUI 则 cd 1oneUI
git remote set-url origin https://github.com/gaogg521/1oneUI.git
git fetch origin

# 后端
cd D:\旧中转目录\dream-core
git remote set-url origin https://github.com/gaogg521/1oneCore.git
git fetch origin
```

可选：将文件夹重命名为 `1oneUI` / `1oneCore`（与文档一致）。**未改名前**，`scripts/*.ps1` 会自动回退到旧目录名 `dream-ui` / `dream-core`。

## 未改名的部分（故意保留）

| 项         | 说明                                                  |
| ---------- | ----------------------------------------------------- |
| 可执行文件 | 仍为 `dreamcore` / `dreamcore.exe`                    |
| Rust crate | 仍为 `dream-ui-*`（内部包名）                         |
| 环境变量   | 仍为 `DREAM_BACKEND_LOCAL_PATH` 等                    |
| 上游文档   | `docs/readme/readme_*.md` 等仍写 dream-ui（上游译文） |

产品对外品牌仍为 **1ONE Code**，不是 1oneUI。
