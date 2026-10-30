# 会话记录 2026-10-30 · 产品截图与品牌素材全面换新（dream-ui + 官网）

> 跨仓：官网仓 `onework-site`（`D:\website\1onework`，线上 work.1oneclaw.com）同批换图并已部署验收。

## 背景与结论

用户把 `dream-ui/resources/` 里的旧产品截图删掉、换成 10-30 新截图（16 张 Oct-30 新图 + 若干 10 月中旬图），要求：图换到仓库和官网、按图解读最新功能设计、**旧图永不回灌**。

- dream-ui：`docs(resources)` 提交 **7950c738**（含 format 修复后 amend），pre-push 四闸过（format/types/i18n/tests）。
- 官网：`docs(www)` 提交 **830a943**，部署 DEPLOY_OK，线上回读验收：`screens-version v=20261030084745`、轮播 16 帧、新 screens/gallery 全 200。
- 旧图已随删除提交入库（ISSUES管理/roadmap_v7/专家对话/图生图2/官方助手/服务模式选择/一键多语言-1/旧logo透明底），pull 不会再回来。

## 关键决策与坑

1. **app.ico/app.icns/app.png 是打包必需品**（electron-builder.yml:212/271/304 引用），用户误删，已从 HEAD 恢复，其余删除照单全收。
2. **新图文件名有雷**：`首页.png`/`首页2.png` 带零宽字符 U+200B、`记忆管理.png` 带尾随空格——已重命名为干净名（与被删旧名同路径，git 记为内容替换 M）。
3. **官网同步唯一入口是 `scripts/sync-screenshots.mjs`**：改它的 MAP/轮播数组，跑完自动清理过期文件+写版本戳。源缺失时**保留旧图兜底**（专家对话/服务模式选择/ISSUES/6 张企业控制台旧图无新替代，线上暂时留旧）。
4. **官网新增 screens 目标名**（后续文档页可直接引用）：scene-work / enterprise-scenes / admin-scenes / admin-knowledge / knowledge / vault / resource-approval / enterprise-digital-employee / agent-memory / memory-space / automations。
5. **i18n 闸**：改 STRINGS.zh 后 `npm run translate` 会把词条填成中文原样（zh==en 被 i18n:lint 拦），要手补 en.json 的英文值再重跑 build。
6. **gallery（首页"真实产品界面"10 张）不走 sync 脚本**，手工映射：g-01首页 g-02助手功能 g-03团队创建-4 g-04团队导出 g-05通讯渠道 g-06远程连接 g-07企业版场景 g-08企业版后台-1 g-09资源申请审批(原Issues看板位，c9 文案已改) g-10企业版skill技能。
7. OCR 老坑：WinRT `GetFileFromPathAsync` 收受**反斜杠**路径；中文路径直接传会炸，先拷成 ASCII 名。

## 新图功能解读（OCR 实证）

企业后台=六步初始化向导(邀请/飞书钉钉企微OIDC LDAP/单机License/组织架构/资源授权矩阵/内容市场/模型渠道/安全三档)+场景管理(内置5场景,技能·成员·资源授权打包下发,不可删)；客户端=我的/企业场景开关、数字员工(后台统管不可改,竞品追踪/SEO/客服质检/报表解读/入职引导,自动@调度)；技能市场 **916** 条(分类+导入规则 50MB/200MB+非下发标记)；知识库=embed 端点 MiniLM-L12-v2@384 + `search-team-knowledge` 权限感知检索(仅自己可见)；记忆=共享+项目+企业三层、旧逐对话记忆(25目录62文件)一键合并、记忆空间实时视图、接管 Claude Code/Codex/Gemini CLI/OpenCode 的 CLAUDE.md；自动化=模板库(6 个内置)+对话创建+保持唤醒；文件保险箱(4.8MB/不限量)；资源申请审批流(申请-驳回-意见留痕)；UI 9 语言。
