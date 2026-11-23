import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import type { IMcpServer } from '@/common/config/storage';

// Browser MCP advertises English descriptions. The catalog below supplies
// Chinese display text while retaining the original names as tool identifiers.
const browserChinese: Record<string, string> = {
  click: '点击指定的网页元素。',
  close_page: '按索引关闭指定页面。',
  drag: '将一个网页元素拖到另一个元素处。',
  emulate: '调整设备、网络等模拟条件。',
  evaluate_script: '在当前页面执行 JavaScript 并返回结果。',
  fill: '在指定输入框或可编辑区域填写文字。',
  fill_form: '一次填写多个表单字段。',
  get_console_message: '按 ID 查看控制台消息。',
  get_network_request: '查看指定网络请求的详情。',
  handle_dialog: '接受或关闭网页弹窗。',
  hover: '将鼠标移到指定元素上。',
  list_console_messages: '查看当前页面的控制台消息列表。',
  list_network_requests: '查看当前页面的网络请求列表。',
  list_pages: '查看已打开的页面。',
  navigate_page: '让当前页面访问指定网址。',
  navigate_page_history: '在当前页面的浏览历史中前进或后退。',
  new_page: '打开新的浏览器页面。',
  press_key: '在当前页面按下指定键或组合键。',
  resize_page: '调整当前页面的视口尺寸。',
  select_page: '将指定页面设为当前操作目标。',
  take_screenshot: '截取页面或指定元素的图像。',
  take_snapshot: '读取页面元素及其可访问性信息。',
  wait_for: '等待指定文字出现在当前页面。',
  upload_file: '在网页的文件输入控件中选择文件。',
  performance_start_trace: '开始记录页面性能数据。',
  performance_stop_trace: '停止记录并获取性能结果。',
  performance_analyze_insight: '查看指定性能指标的分析详情。',
  lighthouse_audit: '运行 Lighthouse 检查并查看报告。',
};

const browserTraditional: Record<string, string> = {
  click: '點擊指定的網頁元素。',
  close_page: '按索引關閉指定頁面。',
  drag: '將一個網頁元素拖到另一個元素處。',
  emulate: '調整設備、網絡等模擬條件。',
  evaluate_script: '在當前頁面執行 JavaScript 并返回結果。',
  fill: '在指定輸入框或可編輯區域填寫文字。',
  fill_form: '一次填寫多個表單字段。',
  get_console_message: '按 ID 查看控制臺消息。',
  get_network_request: '查看指定網絡請求的詳情。',
  handle_dialog: '接受或關閉網頁彈窗。',
  hover: '將鼠標移到指定元素上。',
  list_console_messages: '查看當前頁面的控制臺消息列表。',
  list_network_requests: '查看當前頁面的網絡請求列表。',
  list_pages: '查看已打開的頁面。',
  navigate_page: '讓當前頁面訪問指定網址。',
  navigate_page_history: '在當前頁面的瀏覽歷史中前進或后退。',
  new_page: '打開新的瀏覽器頁面。',
  press_key: '在當前頁面按下指定鍵或組合鍵。',
  resize_page: '調整當前頁面的視口尺寸。',
  select_page: '將指定頁面設為當前操作目標。',
  take_screenshot: '截取頁面或指定元素的圖像。',
  take_snapshot: '讀取頁面元素及其可訪問性信息。',
  wait_for: '等待指定文字出現在當前頁面。',
  upload_file: '在網頁的文件輸入控件中選擇文件。',
  performance_start_trace: '開始記錄頁面性能數據。',
  performance_stop_trace: '停止記錄并獲取性能結果。',
  performance_analyze_insight: '查看指定性能指標的分析詳情。',
  lighthouse_audit: '運行 Lighthouse 檢查并查看報告。',
};

interface McpServerToolsListProps {
  server: IMcpServer;
}

const McpServerToolsList: React.FC<McpServerToolsListProps> = ({ server }) => {
  const { t, i18n } = useTranslation();
  const browser = server.builtin && ['one-browser', 'chrome-devtools'].includes(server.name);
  const language = i18n.resolvedLanguage ?? i18n.language ?? '';
  const chinese = language.startsWith('zh');
  const localizedCatalog = /^zh-(TW|HK|MO|Hant)/i.test(language) ? browserTraditional : browserChinese;

  if (!server.tools || server.tools.length === 0) {
    return null;
  }

  return (
    <div
      data-testid='mcp-tool-grid'
      className='grid gap-8px'
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 188px), 1fr))' }}
    >
      {server.tools.map((tool) => {
        const localized =
          browser && chinese && Object.hasOwn(localizedCatalog, tool.name) ? localizedCatalog[tool.name] : undefined;
        const description =
          server.builtin && server.name === 'one-team-knowledge' && tool.name === 'search_team_knowledge'
            ? t('settings.mcpToolSearchTeamKnowledge')
            : localized || tool.description || t('settings.mcpNoDescription');
        return (
          <div
            key={tool.name}
            className='min-w-0 rounded-lg border border-solid border-[color:var(--border-base)] bg-2 px-10px py-8px'
          >
            <div className='truncate text-13px font-semibold text-t-primary' title={tool.name}>
              {tool.name}
            </div>
            <Tooltip content={description}>
              <div className='line-clamp-2 text-12px leading-5 text-t-secondary'>{description}</div>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
};

export default McpServerToolsList;
