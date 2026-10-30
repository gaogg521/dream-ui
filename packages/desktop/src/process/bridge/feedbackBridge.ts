/**
 * Copyright 2026 One Work
 */

/**
 * IPC handler for collecting and compressing recent log files
 * for the bug report feature.
 */

import { ipcMain, app, BrowserWindow } from 'electron';
import * as path from 'path';
import { collectFeedbackLogAttachment } from '../feedback/logs';
import { deliverFeedbackReport } from '../feedback/reports';
import type { FeedbackSubmission } from '@/common/types/feedbackDiagnostics';

const submittingWindows = new Set<number>();

ipcMain.handle('feedback:submit-report', async (event, payload: FeedbackSubmission) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (
    !win ||
    win.isDestroyed() ||
    win.webContents.id !== event.sender.id ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error('Feedback must originate in the application window');
  const url = new URL(event.sender.getURL());
  if (url.protocol !== 'file:' && !(!app.isPackaged && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('Untrusted feedback source');
  const timeout =
    typeof payload?.timeoutMs === 'number' && Number.isFinite(payload.timeoutMs)
      ? Math.max(1000, Math.min(30000, payload.timeoutMs))
      : 10000;
  if (submittingWindows.has(event.sender.id)) throw new Error('Feedback is already being submitted');
  submittingWindows.add(event.sender.id);
  try {
    return await deliverFeedbackReport(payload, timeout);
  } finally {
    submittingWindows.delete(event.sender.id);
  }
});

type RendererFeedbackLogPayload = {
  details?: unknown;
  level?: unknown;
  message?: unknown;
};

function normalizeRendererFeedbackLogPayload(payload: RendererFeedbackLogPayload): {
  details?: unknown;
  level: 'info' | 'warn' | 'error';
  message: string;
} {
  const level = payload.level === 'warn' || payload.level === 'error' ? payload.level : 'info';
  const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message : 'feedback log';
  return {
    level,
    message,
    details: payload.details,
  };
}

ipcMain.on('feedback:renderer-log', (_event, payload: RendererFeedbackLogPayload) => {
  const log = normalizeRendererFeedbackLogPayload(payload ?? {});
  const args = [`[FeedbackReport:renderer] ${log.message}`];
  if (log.details !== undefined) {
    args.push(log.details as string);
  }

  if (log.level === 'error') {
    console.error(...args);
  } else if (log.level === 'warn') {
    console.warn(...args);
  } else {
    console.info(...args);
  }
});

ipcMain.handle('feedback:collect-logs', async () => {
  try {
    let logsDir: string;
    try {
      logsDir = app.getPath('logs');
    } catch {
      logsDir = path.join(app.getPath('userData'), 'logs');
    }

    const logDirs = [logsDir, path.join(logsDir, 'logs')];
    const attachment = collectFeedbackLogAttachment(logDirs);
    if (!attachment) return null;

    // Return as number array for IPC serialization (Buffer is not serializable)
    return {
      filename: attachment.filename,
      data: Array.from(attachment.data),
    };
  } catch (error) {
    console.error('[feedbackBridge] Failed to collect logs:', error);
    return null;
  }
});

ipcMain.handle('feedback:capture-screenshot', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      return null;
    }

    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    if (!png || png.length === 0) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return {
      filename: `screenshot-${timestamp}.png`,
      data: Array.from(png),
    };
  } catch (error) {
    console.error('[feedbackBridge] Failed to capture screenshot:', error);
    return null;
  }
});
