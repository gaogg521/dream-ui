/**
 * Copyright 2026 One Work
 */

import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import classNames from 'classnames';
import React from 'react';

/**
 * Shared preference row for the channel config forms. Telegram / Slack /
 * Discord / Lark / DingTalk / WeChat / WeCom each carried a private copy of
 * this component and they drifted (the `required` star only exists on some),
 * so the shape here is the union: label + required star + extra + description
 * on the label side, arbitrary controls on the action side.
 *
 * Desktop keeps the historical two-column layout (label left, control right).
 * On mobile the row stacks vertically: the label block reads full-width on
 * top and the control takes the whole row below. The squeezed side-by-side
 * layout wrapped the long setup descriptions (e.g. Telegram's "打开 Telegram，
 * 找到 @BotFather …") into ~80px vertical strips on a phone.
 */
const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, description, extra, required, children }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;

  const labelBlock = (
    <div className={classNames(isMobile ? 'min-w-0' : 'flex-1')}>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>
          {label}
          {required && <span className='text-red-500 ms-2px'>*</span>}
        </span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
  );

  if (isMobile) {
    return (
      <div className='flex flex-col gap-6px py-12px'>
        {labelBlock}
        <div className='flex items-center w-full min-w-0'>{children}</div>
      </div>
    );
  }

  return (
    <div className='flex items-center justify-between gap-24px py-12px'>
      {labelBlock}
      <div className='flex items-center'>{children}</div>
    </div>
  );
};

export default PreferenceRow;
