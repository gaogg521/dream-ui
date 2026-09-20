import React from 'react';

export type SessionAtMenuItem = {
  id: string;
  title: string;
};

type SessionAtMenuProps = {
  activeIndex: number;
  emptyText: string;
  items: SessionAtMenuItem[];
  label: string;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: SessionAtMenuItem) => void;
};

const SessionAtMenu: React.FC<SessionAtMenuProps> = ({
  activeIndex,
  emptyText,
  items,
  label,
  onHoverItem,
  onSelectItem,
}) => {
  return (
    <div
      className='rounded-14px border border-solid overflow-hidden p-6px flex flex-col gap-2px'
      style={{
        borderColor: 'var(--color-border-2)',
        background: 'color-mix(in srgb, var(--color-bg-1) 94%, transparent)',
        backdropFilter: 'blur(14px) saturate(1.05)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.05)',
      }}
      role='listbox'
      aria-label={label}
    >
      {items.length === 0 ? (
        <div className='px-12px py-10px text-12px text-t-secondary'>{emptyText}</div>
      ) : (
        items.map((item, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              key={item.id}
              role='option'
              aria-selected={isActive}
              className='px-12px py-8px rounded-10px cursor-pointer transition-colors'
              style={{
                background: isActive ? 'var(--color-fill-2)' : 'transparent',
              }}
              onMouseEnter={() => onHoverItem(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectItem(item);
              }}
            >
              <div className='text-13px text-t-primary truncate'>{item.title || item.id}</div>
              <div className='text-11px text-t-secondary truncate'>{item.id}</div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default SessionAtMenu;
