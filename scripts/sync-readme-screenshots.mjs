/**
 * Sync README assets from D:\dream\image
 * - resources/screens/  product screenshots (PNG)
 * - resources/adv/      five-advantage SVGs + PNG for GitHub README
 */
import { copyFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
/** Prefer current product shots in the repo; fall back to the marketing dump. */
const SRC_PRIMARY = join(root, "resources");
const SRC_FALLBACK = "D:\\dream\\image";
const outDir = join(root, "resources", "screens");
const advDir = join(root, "resources", "adv");

function resolveSrc(names, preferPrimary = true) {
  const list = Array.isArray(names) ? names : [names];
  const dirs = preferPrimary ? [SRC_PRIMARY, SRC_FALLBACK] : [SRC_FALLBACK, SRC_PRIMARY];
  for (const name of list) {
    for (const dir of dirs) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** @type {string[]} */
const ADV_SVGS = [
  "adv-speed.svg",
  "adv-privacy.svg",
  "adv-cost.svg",
  "adv-bridge.svg",
  "adv-local.svg",
];

/** @type {Array<[string | string[], string]>} */
const MAP = [
  [["首页.png", "首页​.png"], "home.png"],
  [["首页2.png", "首页2​.png"], "home-alt.png"],
  ["中文会话框.png", "workspace-zh.png"],
  [["多语言.png", "英语会话框.png"], "workspace-en.png"],
  ["AGENT助手.png", "agents.png"],
  ["CODEX桥接.png", "bridge-codex.png"],
  ["Claude桥接.png", "bridge-claude.png"],
  [["模型列表.png", "模型添加.png", "模型管理.png"], "models.png"],
  [["股票专家咨询.png", "市场专家.png"], "experts.png"],
  [["超级助手.png", "官方助手.png"], "assistants.png"],
  [["skills技能.png", "SKILL技能管理.png"], "skills.png"],
  ["MCP工具.png", "mcp.png"],
  [["记忆.png", "记忆管理.png"], "memory.png"],
  ["定时任务.png", "cron.png"],
  [["渠道配置.png", "远程控制渠道.png"], "channels-legacy.png"],
  ["通讯渠道控制.png", "channels-control.png"], // marketing dump is newer than repo copy
  ["远程连接.png", "webui.png"],
  ["团队创建-1.png", "team-create.png"],
  ["团队创建-2.png", "team-create-2.png"],
  ["团队创建-3.png", "team-create-3.png"],
  [["团队AGENT测试.png", "团队创建-4.png"], "team-work.png"],
  ["团队任务记录一键导出.png", "team-export.png"],
  ["团队任务记录一键导出-2.png", "team-export-2.png"],
  ["图片内容创作.png", "content-image.png"],
  ["视频内容创作.png", "content-video.png"],
  ["文本内容创作.png", "content-text.png"],
  [["多语言.png", "一键多语言-1.png"], "i18n-1.png"],
  ["一键多语言-2.png", "i18n-2.png"],
  ["3.0开箱即用-1.png", "quickstart-1.png"],
  ["3.0开箱即用-2.png", "quickstart-2.png"],
  ["3.0开箱即用-3.png", "quickstart-3.png"],
  ["数字员工.png", "digital-employee.png"],
  ["ISSUES管理.png", "issues.png"],
  ["历史会话查询.png", "sessions-history.png"],
  ["文生图.png", "gen-text2img.png"],
  ["图生图.png", "gen-img2img.png"],
  ["文生视频.png", "gen-text2video.png"],
  ["图生视频.png", "gen-img2video.png"],
  ["文生多图.png", "gen-text2multi.png"],
  ["文生连环图图.png", "gen-comic.png"],
  ["专家对话.png", "expert-chat.png"],
  ["一句话游戏.png", "game-oneshot-1.png"],
  ["一句话做游戏2.png", "game-oneshot-2.png"],
  ["一句话做游戏3.png", "game-oneshot-3.png"],
  ["一句话游戏4.png", "game-oneshot-4.png"],
  ["服务模式选择.png", "service-mode.png"],
  ["企业版后台登录.png", "enterprise-login.png"],
  ["项目组总后台.png", "enterprise-admin.png"],
  ["logo透明底.png", "logo.png"],
  [["wx-21.png", "作者微信.png"], "author-wechat.png"],
];

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".png")) unlinkSync(join(outDir, f));
}

let ok = 0;
for (const [src, dest] of MAP) {
  const from = resolveSrc(src, dest !== "channels-control.png");
  const to = join(outDir, dest);
  if (!from) {
    console.warn(`SKIP: ${Array.isArray(src) ? src.join(" | ") : src}`);
    continue;
  }
  copyFileSync(from, to);
  ok++;
}
console.log(`Synced ${ok} → resources/screens/`);

mkdirSync(advDir, { recursive: true });
let advOk = 0;
for (const name of ADV_SVGS) {
  const from = join(SRC_FALLBACK, name);
  if (!existsSync(from)) {
    console.warn(`SKIP adv: ${name}`);
    continue;
  }
  copyFileSync(from, join(advDir, name));
  const pngDest = join(advDir, name.replace(".svg", ".png"));
  const pngSrcDest = join(SRC_FALLBACK, name.replace(".svg", ".png"));
  await sharp(from, { density: 144 }).png().toFile(pngDest);
  copyFileSync(pngDest, pngSrcDest);
  advOk++;
}
console.log(`Synced ${advOk} advantage SVGs → resources/adv/ (+ PNG) & D:\\dream\\image\\`);
