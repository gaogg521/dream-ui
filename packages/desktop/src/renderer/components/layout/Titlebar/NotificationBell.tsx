/**
 * Titlebar notification bell (§4.2) — the member inbox entry point.
 *
 * Renders only once the notifications store has a successful fetch behind it
 * (`available`), which doubles as the enterprise gate: standalone / personal
 * sessions never fetch, so the bell never appears for them. Arrivals toast
 * through the tray via the store; this component is the in-app surface:
 * unread badge, list, per-item and mark-all read receipts.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Remind } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useEnterpriseNotifications } from '@renderer/hooks/enterprise/useEnterpriseNotifications';

/** Relative time for recent items, locale date past that — an inbox wants "3 分钟前", not a raw epoch. */
function formatNotificationTime(createdAt: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const deltaMs = Date.now() - createdAt;
  const minutes = Math.floor(deltaMs / 60_000);
  // Interpolation var is deliberately `n`, not `count` — i18next treats a
  // `count` option as a pluralization request and would look up *_one/_other
  // keys we don't ship.
  if (minutes < 1) return t('common.notifications.justNow', { defaultValue: '刚刚' });
  if (minutes < 60) return t('common.notifications.minutesAgo', { n: minutes, defaultValue: '{{n}} 分钟前' });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.notifications.hoursAgo', { n: hours, defaultValue: '{{n}} 小时前' });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('common.notifications.daysAgo', { n: days, defaultValue: '{{n}} 天前' });
  try {
    return new Date(createdAt).toLocaleDateString();
  } catch {
    return '';
  }
}

const NotificationBell: React.FC<{ iconSize?: number; strokeWidth?: number }> = ({ iconSize = 18, strokeWidth }) => {
  const { t } = useTranslation();
  const { notifications, unreadCount, available, markRead } = useEnterpriseNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape close. Document-level (not backdrop) so the panel
  // stays a lightweight dropdown like the search popover.
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleToggle = useCallback(() => setOpen((previous) => !previous), []);
  const handleItemClick = useCallback(
    (id: string) => {
      void markRead([id]);
    },
    [markRead]
  );
  const handleMarkAll = useCallback(() => {
    void markRead([]);
  }, [markRead]);

  if (!available) return null;

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  const ariaLabel = t('common.notifications.title', { defaultValue: '通知中心' });

  return (
    <div ref={wrapRef} className='app-titlebar__bell'>
      <button
        type='button'
        className='app-titlebar__button'
        onClick={handleToggle}
        aria-label={ariaLabel}
        title={ariaLabel}
        data-notification-bell=''
        data-unread={unreadCount > 0 ? String(unreadCount) : '0'}
      >
        <Remind theme='outline' size={iconSize} fill='currentColor' strokeWidth={strokeWidth} />
        {unreadCount > 0 && (
          <span className='app-titlebar__bell-badge' aria-hidden='true'>
            {badgeLabel}
          </span>
        )}
      </button>
      {open && (
        <div className='app-titlebar__bell-panel' role='dialog' aria-label={ariaLabel}>
          <div className='app-titlebar__bell-header'>
            <span className='app-titlebar__bell-header-title'>{ariaLabel}</span>
            {unreadCount > 0 && (
              <button type='button' className='app-titlebar__bell-mark-all' onClick={handleMarkAll}>
                {t('common.notifications.markAllRead', { defaultValue: '全部已读' })}
              </button>
            )}
          </div>
          <div className='app-titlebar__bell-list'>
            {notifications.length === 0 ? (
              <div className='app-titlebar__bell-empty'>
                {t('common.notifications.empty', { defaultValue: '暂无通知' })}
              </div>
            ) : (
              notifications.map((notification) => {
                const unread = notification.readAt == null;
                return (
                  <button
                    key={notification.id}
                    type='button'
                    className={classNames('app-titlebar__bell-item', { 'app-titlebar__bell-item--unread': unread })}
                    onClick={() => handleItemClick(notification.id)}
                    title={unread ? t('common.notifications.markRead', { defaultValue: '标为已读' }) : undefined}
                  >
                    <span className='app-titlebar__bell-item-dot' aria-hidden='true' />
                    <span className='app-titlebar__bell-item-main'>
                      <span className='app-titlebar__bell-item-title'>{notification.title}</span>
                      {notification.body && <span className='app-titlebar__bell-item-body'>{notification.body}</span>}
                      <span className='app-titlebar__bell-item-time'>
                        {formatNotificationTime(notification.createdAt, t)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
