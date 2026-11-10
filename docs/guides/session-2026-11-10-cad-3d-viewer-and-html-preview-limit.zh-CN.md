# 2026-11-10：CAD 转可旋转 3D 模型 + HTML 预览超过 2 MiB 空白

跨仓：功能在 dream-core（内置技能 `autocad-drawing`），一处存量 bug 在本仓库（HTML 预览）。

## 做了什么

**1. CAD 三维文件转可旋转 3D（dream-core `autocad-drawing` 技能）**

`scripts/model3d.cjs`：只依赖 Node、完全离线，输出**一个自包含 .html**，在预览面板里直接拖动旋转/剖切/按图层或零件显隐/截图。

| 输入                                                                                     | 命令   |
| ---------------------------------------------------------------------------------------- | ------ |
| 三维 DXF（线框、3DFACE、多面网格、MESH、带厚度图元、块、样条）、STEP/IGES/BREP、STL、OBJ | `view` |
| 带标注的三视图型线图（DXF）、三维型线、二维横剖面图、JSON 型值                           | `loft` |

- three.js（MIT，精简包）和 OpenCascade（`occt-import-js`，LGPL-2.1，未修改、运行时作为独立文件加载）随技能内置，见技能目录 `vendor/README.md`。
- **DWG 读不了**：Autodesk 私有格式。工具直接提示「另存为 ASCII DXF（2010+）」；SolidWorks/Inventor/CATIA 等原生格式提示导出 STEP。试过 LibreDWG 的 WASM 读取器能读，但它是 **GPL-3.0**，没有授权结论前不进安装包。
- 型线图识别（`model3d_lib/lines_plan.cjs`）只依赖：半宽水线图里每条水线旁的「17.0WL」线名 + 高度轴刻度数字。站位标注、侧视图、横剖线图都不需要。自检：`node scripts/model3d_selftest.cjs`。
- **精度边界**：只放样主水线族；艏艉细节、船底升高、龙骨线没建模；曲面按弧长对应插值，**只适合看外形，不是型值表**。工具会把「内插的水线」「舍弃的线名」写成警告，Agent 必须原样转告。

## 本轮真机发现的三个问题（都已处理）

1. **技能描述只有前约 250 显示列进模型视野**（`dream-engine-skills/src/prompt.rs` 的 `MAX_LISTING_DESC_CHARS`，中文≈125 字）。原描述 652 列，新能力全在截断之后，DEV 里模型连续三轮没加载技能、自己去 pip/npm 装 OpenCascade。改成 196 列、触发词前置后，第四轮起直接加载。**老技能很多都有这个问题**，改技能描述前先量宽度。
2. **仓库 `.gitignore` 忽略所有 `lib/`**：脚本目录叫 `lib/` 时整个没进仓库，本机一直绿。已改名 `model3d_lib/`，并加了 Rust 守卫测试 `autocad_3d_toolchain_is_embedded_intact`（文件齐全、wasm 魔数与体积、模板占位符）。
3. **HTML 预览超过约 2 MiB 就空白**（本仓库，见下）。

## HTML 预览：`data:` URL 超过 2 MiB → `ERR_INVALID_URL`，面板空白无提示

- **症状**：1.9 MB 的 3D 查看器 HTML 从文件树点开，预览面板一片空白；日志 `html_preview_webview_failed_load { errorCode: -300, errorDescription: 'ERR_INVALID_URL' }`，`src: 'data:text/html (2208103 chars)'`。
- **根因**：文件树打开的文件用 `fileRef`（可能指向远程后端），**没有本机 `file_path`**，所以 `HTMLRenderer` 里「干净本地文件走 `file://`」的分支用不上，只能把整页 `encodeURIComponent` 进 `data:` URL；Chromium 对 URL 长度上限约 2 MiB，超了就导航失败，webview 保持空白、界面不提示。凡是大一点的 HTML（离线 3D 查看器、带内嵌数据的报告）都会中招。0.7 MB 的示例一直正常，所以之前没发现。
- **修复**（`HTMLRenderer.tsx`，**只在超限时才走新分支**，正常大小行为不变）：`MAX_DATA_URL_CHARS = 2_000_000`；超限时 webview 先载入一个几十字节的空白页，`dom-ready` 后用 `executeJavaScript('document.open();document.write(<整页>);document.close();')` 写入（脚本走 IPC，没有 URL 上限；内联脚本照常执行），写完重新注入检查模式脚本。`webviewSrc` 的计算拆成 `dataHtml`（带 base 标签的整页）+ 按长度选 src 两步。
- **验证**：测试 `tests/unit/previews/HTMLViewer.dom.test.tsx` 新增 2 条（超限走空白页+脚本写入且内容完整、接近上限仍走原 `data:`），反向验证过（上限调大则失败）；预览目录 225 个测试全过。真机：DEV 里点击 1.99 MB 的船体模型，面板正常渲染，真实鼠标拖动 `pointerdown→pointermove(buttons=1)→pointerup` 画布收到、画面变化，顶视图/线框按钮生效。
- **没做**：超大到 `executeJavaScript` 也吃力的页面（几十 MB）没测；`document.write` 方式下页面origin仍是 `data:` 的 opaque origin，与原 `data:` 路径一致。

## 追加：用户拿真实文件试（一张总布置图 / 一份真实导出的型线图 DXF）

- **总布置图不是三维模型**：某散货船总布置图（75 个图层、58.6 万线段）是把侧视、各层甲板平面、上层建筑、艏艉视图和横剖面平铺画在一张图上，91% 的点在 Z=0。原先工具只在「所有 Z 完全相同」时才提示平面图，这张图有零散竖线所以**没提示，照样生成了一个 18.5MB 的「3D」页面**，容易误导。现在按「同一平面的点占比」判断（≥90% 提示「平铺的二维工程图」），并默认用顶视图打开；自检含正反例。
- **DXF 里的实体可能是空壳**：这份 DXF 文件头第一行是 `LibreDWG 0.12.2`，340 个 3DSOLID/REGION/BODY 记录**只有头和 GUID，没有 ACIS 数据**，换什么读取器都还原不了。结论写进了技能文档：看到 LibreDWG 生成的 DXF，要让用户用 AutoCAD/中望等原生软件另存 DXF，或直接导出 STEP。
- **真实 DXF 验证**：同一张型线图的真实 DXF（LibreDWG 导出、代码页 ANSI_936）跑 `loft`，结果与重建版逐项一致（35280 个三角面、同样 4 条警告）。注意它不是 AutoCAD 原生导出的 DXF，只能说明识别逻辑在一份独立生成的真实文件上成立。
- **FreeCAD 导出的三维型线线框：我选错了命令，不是文件不行**。这份 DXF（167 个图层、每条线一个对象）本身就是三维线框，正确用法是 `view`（干净的可旋转线框、图层可逐个显隐）；我之前拿 `loft` 去放样，48 个站位的横剖线被拆成最多 26 段、只取最长一段，才出毛刺。现在 loft 遇到这种输入只出一条聚合提示并指向 view。

## 追加：用户在 DEV 里说「阅读一下这个图纸」，模型去装 ezdxf（本轮最该记的一条）

- **现象**：同一个技能在最新 DEV 里，模型看到了技能清单里的 autocad-drawing，却判断「这是个 DXF，先自己看看」，没加载技能，`pip install ezdxf` 后自己写解析脚本。你最开始给我的 SLDPRT 用的也是「阅读一下这个图纸」。
- **原因**（三个缺口都在我）：① 描述前半段全是「转 3D」，「读图」意图没对上，而我**验收时只用了自己想的说法（「转成能旋转的 3D」），没用用户的原话**；② 技能里没有零依赖的读图命令；③ 旧「提取」流程本身就写着用 ezdxf。
- **修复**（dream-core `9f17d78`）：新增 `model3d.cjs read`（约 1 秒、零依赖，输出格式/生成工具/实体构成/图层/范围/文字摘要，并给出「平铺二维图 / 真三维 / 带标注型线图」的结论和下一步命令）；描述前置「阅读/看看/分析」和「免装任何包，勿自装 ezdxf/OCP」；SKILL.md 顶部加「先读图」及结论到命令的对照表。
- **教训**：给技能加能力后，验收一定要用**用户最自然的原话**在真机上走一遍，别只测自己设计的触发说法；技能描述只有前约 250 列进模型视野，要把用户会说的词放在最前面。
- DEV 里的技能是我手工拷进数据目录的（用户技能目录会覆盖内置，且 DEV 用的是旧版内置后端），不代表安装包里的状态；安装包要等 dreamcore 发版并 bump pin。

## 待发版

## 待发版

- dream-core：autocad-drawing 技能更新（随 dreamcore 发版，安装包按 pin 带上）。后端二进制每平台约 +8.3 MB（OpenCascade wasm + three.js 嵌入）。
- dream-ui：技能广场 13 种语言介绍文案、本次 HTML 预览修复，随桌面版发。
