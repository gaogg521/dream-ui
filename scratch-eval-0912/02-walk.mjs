/**
 * Step 2: walk every console route, screenshot, and collect errors:
 * console.error, pageerror, >=400 responses, arco toasts, stuck spinners,
 * suspiciously empty pages. Results to 02-walk-results.json.
 */
import { connect, collect, visit, report, saveJson } from './harness.mjs';

const ROUTES = [
  ['/', '首页'],
  ['/users', '成员管理'],
  ['/administrators', '管理员'],
  ['/invites', '邀请与入职'],
  ['/invites/onboarding', '入职引导'],
  ['/org-tree', '组织架构'],
  ['/scenes', '场景管理'],
  ['/resource-grants', '资源授权'],
  ['/model-channels', '模型与通道'],
  ['/resource-registry', '资源注册表'],
  ['/config-vault', '配置项'],
  ['/market-sources', '内容市场'],
  ['/api-assets', 'API 资产'],
  ['/content-governance', '分类与标签'],
  ['/knowledge-bases', '知识库'],
  ['/memory', '记忆系统'],
  ['/runtime', '智能体节点'],
  ['/agent-sessions', '智能体会话'],
  ['/llm-trace', 'LLM Trace'],
  ['/reports/overview', '用量总览'],
  ['/reports/channel-model', '通道与模型'],
  ['/reports/user-analysis', '用户分析'],
  ['/reports/approval-security', '审批与安全'],
  ['/enterprise-report', '企业报表'],
  ['/security-policy', '安全策略'],
  ['/approvals', '审批授权'],
  ['/audit', '操作审计'],
  ['/agent-audit', '智能体审计'],
  ['/content-inspection', '内容检查'],
  ['/media-ledger', '媒体台账'],
  ['/file-vault', '个人文件仓库'],
  ['/company', '企业信息'],
  ['/sso', '企业登录'],
  ['/directory', '目录同步'],
  ['/billing', '订阅与License'],
  ['/license', 'License 详情'],
  ['/im-channels', 'IM 管道'],
  ['/api-keys', '开放集成'],
  ['/notifications', '站内消息'],
  ['/backup', '备份与恢复'],
  ['/platform', '平台基础设施(隐藏)'],
  ['/integrations', '集成连接器(隐藏)'],
  ['/no-such-page', '404兜底'],
];

const { browser, page } = await connect();
const state = collect(page);
const rows = [];
for (const [path, label] of ROUTES) {
  const shot = `${String(rows.length + 1).padStart(2, '0')}-${path.replace(/\//g, '_').replace(/^_/, '') || 'home'}.png`;
  try {
    const info = await visit(page, state, path, { shot, settleMs: 2000 });
    const row = report(label, path, info, state);
    rows.push(row);
    const flags = [];
    if (row.bad.length) flags.push(`HTTP:${row.bad.join('; ')}`);
    if (row.console.length) flags.push(`console:${row.console.length}`);
    if (row.pageErrors.length) flags.push(`pageerror:${row.pageErrors.length}`);
    if (row.toasts.length) flags.push(`toast:${row.toasts.join(' | ')}`);
    if (row.spinning) flags.push('stuck-spinner');
    if (row.textLen < 80) flags.push(`thin(${row.textLen})`);
    console.log(`${flags.length ? '⚠' : '✓'} ${label} ${path} ${flags.join(' | ')}`);
  } catch (e) {
    rows.push({ label, path, fatal: String(e).slice(0, 300) });
    console.log(`✗ ${label} ${path} FATAL ${String(e).slice(0, 200)}`);
  }
}
await saveJson('02-walk-results.json', rows);
const bad = rows.filter(
  (r) =>
    r.bad?.length ||
    r.console?.length ||
    r.pageErrors?.length ||
    r.toasts?.length ||
    r.spinning ||
    r.fatal ||
    r.textLen < 80
);
console.log(`\n=== ${rows.length} routes, ${bad.length} with findings`);
