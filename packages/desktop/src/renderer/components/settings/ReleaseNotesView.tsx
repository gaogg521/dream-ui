/**
 * Copyright 2026 One Work
 */

import { openExternalUrl } from '@/renderer/utils/platform';
import { Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { parseReleaseNotes } from './releaseNotesParser';
import MarkdownView from '@/renderer/components/Markdown';

import './ReleaseNotesView.css';

// The marketing site renders the same release-notes source (see
// scripts/generate-release-notes.js). When a section is too long for the
// modal, "view more" hands the reader over to that page.
const UPDATES_PAGE_URL = 'https://1work.vip/updates.html';

// A modal is not the updates page: categories stay scannable and anything
// beyond this many items folds into the "view more" link.
const MAX_ITEMS_PER_CATEGORY = 4;

const ITEM_TAG_RE = /^(【[^】]*】)([\s\S]*)$/;
const BOLD_RE = /\*\*(.+?)\*\*/g;

/** Item text: leading 【小标题】 gets weight, **bold** segments survive. */
function renderInlineText(text: string): React.ReactNode {
  const tag = ITEM_TAG_RE.exec(text);
  const body = tag ? tag[2] : text;
  const nodes: React.ReactNode[] = [];
  if (tag) {
    nodes.push(
      <span key='tag' className='release-notes__item-tag'>
        {tag[1]}
      </span>
    );
  }
  body.split(BOLD_RE).forEach((part, index) => {
    if (!part) return;
    if (index % 2 === 1) {
      nodes.push(<strong key={`b${index}`}>{part}</strong>);
    } else {
      nodes.push(<React.Fragment key={`t${index}`}>{part}</React.Fragment>);
    }
  });
  return nodes;
}

const ReleaseNotesView: React.FC<{ children: string }> = ({ children }) => {
  const { t } = useTranslation();
  const parsed = React.useMemo(() => parseReleaseNotes(children), [children]);

  const openUpdatesPage = React.useCallback(() => {
    void openExternalUrl(UPDATES_PAGE_URL);
  }, []);

  if (!parsed) {
    // Not the canonical notes format (draft or hand-written) — plain markdown beats a broken layout.
    return <MarkdownView allowHtml>{children}</MarkdownView>;
  }

  return (
    <div className='release-notes'>
      {(parsed.version || parsed.date) && (
        <div className='release-notes__head'>
          {parsed.version && <span className='release-notes__badge'>v{parsed.version}</span>}
          {parsed.date && <span className='release-notes__date'>{parsed.date}</span>}
        </div>
      )}
      <div className='release-notes__grid'>
        {parsed.sections.map((section) => {
          const total = section.categories.reduce((n, c) => n + c.items.length, 0) + section.items.length;
          const visibleTotal =
            section.categories.reduce((n, c) => n + Math.min(c.items.length, MAX_ITEMS_PER_CATEGORY), 0) +
            Math.min(section.items.length, MAX_ITEMS_PER_CATEGORY);
          const truncated = total > visibleTotal;
          return (
            <section key={section.title} className={`release-notes__card release-notes__card--${section.edition}`}>
              <h3 className='release-notes__card-title'>
                <span className='release-notes__card-dot' aria-hidden='true' />
                <span className='release-notes__card-name'>{section.title}</span>
                {total > 0 && <span className='release-notes__card-count'>{t('update.itemCount', { n: total })}</span>}
              </h3>
              {section.leadParts.map((lead, index) => (
                <p key={index} className='release-notes__lead'>
                  {lead}
                </p>
              ))}
              {section.categories.map((category) => {
                const visible = category.items.slice(0, MAX_ITEMS_PER_CATEGORY);
                return (
                  <div key={category.label} className='release-notes__cat'>
                    <div className={`release-notes__cat-head release-notes__cat-head--${category.cls}`}>
                      <span className='release-notes__cat-label'>{category.label}</span>
                      {category.items.length > 0 && (
                        <span className='release-notes__cat-count'>{category.items.length}</span>
                      )}
                    </div>
                    <ul className='release-notes__list'>
                      {visible.map((item, index) => (
                        <li key={index} className='release-notes__item'>
                          {renderInlineText(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {section.items.length > 0 && (
                <ul className='release-notes__list'>
                  {section.items.slice(0, MAX_ITEMS_PER_CATEGORY).map((item, index) => (
                    <li key={index} className='release-notes__item'>
                      {renderInlineText(item)}
                    </li>
                  ))}
                </ul>
              )}
              {truncated && (
                <button type='button' className='release-notes__more' onClick={openUpdatesPage}>
                  <span>{t('update.viewMoreItems', { n: total })}</span>
                  <Right size='12' />
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default ReleaseNotesView;
