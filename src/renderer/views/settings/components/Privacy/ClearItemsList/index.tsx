import * as React from 'react';
import styled, {css} from 'styled-components';

import {getSettingsTranslator} from '../../../utils';
import {ITheme} from '~/interfaces';
import {CLEAR_ON_EXIT_KEYS, ClearOnExitItems} from '~/interfaces/settings';
import type {MessageKey, Translator} from '~/common/i18n';
import {getPalette} from '~/renderer/views/bookmarks/utils/palette';
import {ipcRenderer} from '~/common/renderer-ipc';

// 清理项多选列表(布局对齐 Chrome「清除浏览数据·高级」):每项一行标题 + 一行当前
// 数据量。「退出时自动清理」与「立即清除」两个对话框共用,项目按 CLEAR_ON_EXIT_KEYS 遍历。

type ItemKey = keyof ClearOnExitItems;

interface ClearStats {
  history: number | null;
  searchHistory: number | null;
  downloads: number | null;
  cookies: number | null;
  cache: number | null;
  passwords: number | null;
  passwordSites: string[];
  autofill: number | null;
  siteSettings: number | null;
}

const List = styled.div`
  max-height: min(60vh, 460px);
  overflow-y: auto;
  margin: 0 -4px;
`;

const Item = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  outline: none;

  ${({theme}: {theme: ITheme}) => css`
    color: ${getPalette(theme).textMain};
    &:hover {
      background: ${theme['dialog.lightForeground']
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(0,0,0,0.04)'};
    }
    &:focus-visible {
      box-shadow: 0 0 0 2px ${getPalette(theme).primary};
    }
  `}
`;

const Box = styled.div<{checked: boolean}>`
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 5px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  border: 2px solid rgba(127, 127, 127, 0.4);

  ${({theme, checked}: {theme: ITheme; checked: boolean}) => css`
    background: ${checked ? getPalette(theme).primary : 'transparent'};
    border-color: ${checked ? getPalette(theme).primary : 'rgba(127,127,127,0.4)'};
  `}
`;

const Label = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const Desc = styled.div<{warn?: boolean}>`
  font-size: 12px;
  line-height: 17px;
  overflow: hidden;
  text-overflow: ellipsis;

  ${({warn}) =>
    warn
      ? css`
          color: #e5484d;
        `
      : css`
          opacity: 0.6;
        `}
`;

const Check = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path
      d="M2 6.5L4.5 9L10 3"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LABELS: Record<ItemKey, MessageKey> = {
  history: 'pvItemHistory',
  searchHistory: 'wbSearchHistory',
  downloads: 'coeDownloads',
  cookies: 'coeCookies',
  cache: 'coeCache',
  passwords: 'coePasswords',
  autofill: 'coeAutofill',
  siteSettings: 'coeSiteSettings',
};

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return null;
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
};

// 数据量说明行(对齐 Chrome:「无」「来自 31 个网站」「小于 1 MB」…)。
const describe = (
  key: ItemKey,
  stats: ClearStats | null,
  items: ClearOnExitItems,
  t: Translator,
): string => {
  if (key === 'searchHistory' && items.history) return t('coeSearchHistoryCovered');
  if (!stats) return '';
  const count = stats[key] as number | null;
  if (count == null) return key === 'cookies' ? t('coeCookiesHint') : '';
  switch (key) {
    case 'cache':
      return formatSize(count) || t('coeCacheLess');
    case 'cookies':
      return count === 0
        ? t('coeCountNone')
        : `${t('coeCountSites', {count})} · ${t('coeCookiesHint')}`;
    case 'passwords':
      if (count === 0) return t('coeCountNone');
      return stats.passwordSites.length > 0
        ? t('coeCountPasswordsFor', {count, sites: stats.passwordSites.join(', ')})
        : t('coeCountPasswords', {count});
    case 'autofill':
      return count === 0 ? t('coeCountNone') : t('coeCountSuggestions', {count});
    case 'siteSettings':
      return count === 0 ? t('coeCountNone') : t('coeCountSitesShort', {count});
    default:
      return count === 0 ? t('coeCountNone') : t('coeCountItems', {count});
  }
};

// 把可能缺项/observable 的勾选对象拍平成完整的普通对象。
export const toClearItems = (
  raw?: Partial<ClearOnExitItems> | null,
): ClearOnExitItems => {
  const next = {} as ClearOnExitItems;
  for (const key of CLEAR_ON_EXIT_KEYS) next[key] = !!raw?.[key];
  return next;
};

export const ClearItemsList = ({
  visible,
  items,
  onToggle,
  ariaLabel,
}: {
  visible: boolean;
  items: ClearOnExitItems;
  onToggle: (key: ItemKey) => void;
  ariaLabel: string;
}) => {
  const t = getSettingsTranslator();
  const [stats, setStats] = React.useState<ClearStats | null>(null);

  // 每次打开重新统计,数据量可能已变化。
  React.useEffect(() => {
    if (!visible) return;
    let alive = true;
    ipcRenderer
      .invoke('clear-browsing-data-stats')
      .then((res: ClearStats | null) => {
        if (alive) setStats(res || null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visible]);

  return (
    <List role="group" aria-label={ariaLabel}>
      {CLEAR_ON_EXIT_KEYS.map((key) => {
        const warn = key === 'passwords' && items.passwords;
        const desc = warn ? t('coePasswordWarn') : describe(key, stats, items, t);
        return (
          <Item
            key={key}
            role="checkbox"
            aria-checked={items[key]}
            tabIndex={0}
            onClick={() => onToggle(key)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                onToggle(key);
              }
            }}
          >
            <Box checked={items[key]}>{items[key] && <Check />}</Box>
            <Label>
              <span>{t(LABELS[key])}</span>
              {desc && <Desc warn={warn}>{desc}</Desc>}
            </Label>
          </Item>
        );
      })}
    </List>
  );
};
