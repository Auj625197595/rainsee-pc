import * as React from 'react';
import {
  BookOpen,
  TextAa,
  FloppyDisk,
  CaretDown,
  Check,
  FileHtml,
  FileText,
  Minus,
  Plus,
  ArrowSquareOut,
} from '@phosphor-icons/react';

import {ipcRenderer} from '~/common/renderer-ipc';
import {getWebUIContext} from '~/common/webui-context';
import {useI18n} from '~/renderer/components/I18n';
import {
  ReaderArticle,
  ReaderPrefs,
  ReaderTheme,
  FONT_STACKS,
  sanitizeArticleHtml,
  readingMinutes,
  htmlToMarkdown,
  buildOfflineHtml,
} from '../../utils';
import {
  StyledApp,
  Toolbar,
  ToolbarTitle,
  ToolBtn,
  SaveGroup,
  Popover,
  PopLabel,
  Segmented,
  SegBtn,
  Swatch,
  MenuItem,
  Article,
  CenterState,
  Toast,
} from './style';

const PREFS_KEY = 'rainsee-reader-prefs';
const DEFAULT_PREFS: ReaderPrefs = {
  theme: 'auto',
  font: 'sans',
  fontSize: 18,
  width: 720,
  format: 'html',
};
const WIDTHS = [600, 720, 880];
const FONT_MIN = 14;
const FONT_MAX = 28;

const loadPrefs = (): ReaderPrefs => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (raw && typeof raw === 'object') return {...DEFAULT_PREFS, ...raw};
  } catch {
    // 存储不可用时用默认值
  }
  return DEFAULT_PREFS;
};

const savePrefs = (p: ReaderPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // 忽略
  }
};

const browserIsDark = (settings: any) => settings?.theme === 'wexond-dark';

type LoadState = 'loading' | 'ready' | 'error';

export const App = () => {
  const t = useI18n();
  const [state, setState] = React.useState<LoadState>('loading');
  const [article, setArticle] = React.useState<ReaderArticle | null>(null);
  const [prefs, setPrefs] = React.useState<ReaderPrefs>(loadPrefs);
  const [browserDark, setBrowserDark] = React.useState(() =>
    browserIsDark(getWebUIContext().settings),
  );
  const [panel, setPanel] = React.useState<'none' | 'style' | 'format'>('none');
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<{text: string; path?: string} | null>(null);
  const [barHidden, setBarHidden] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const sessionId = React.useMemo(
    () => new URLSearchParams(window.location.search).get('id') || '',
    [],
  );

  const theme: ReaderTheme =
    prefs.theme === 'auto' ? (browserDark ? 'dark' : 'light') : prefs.theme;

  const updatePrefs = (patch: Partial<ReaderPrefs>) => {
    setPrefs((cur) => {
      const next = {...cur, ...patch};
      savePrefs(next);
      return next;
    });
  };

  React.useEffect(() => {
    if (!sessionId) {
      setState('error');
      return;
    }
    ipcRenderer
      .invoke('reader-get', sessionId)
      .then((data: ReaderArticle | null) => {
        if (!data || typeof data.contentHtml !== 'string') {
          setState('error');
          return;
        }
        setArticle(data);
        setState('ready');
        document.title = data.title || t('rdTitle');
      })
      .catch(() => setState('error'));
  }, [sessionId]);

  React.useEffect(() => {
    if (state === 'error') document.title = t('rdTitle');
  }, [state]);

  // 「跟随浏览器」主题随设置广播实时切换
  React.useEffect(() => {
    const listener = (_e: any, s: any) => {
      if (s && typeof s.theme === 'string') setBrowserDark(browserIsDark(s));
    };
    ipcRenderer.on('update-settings', listener);
    return () => {
      ipcRenderer.removeListener('update-settings', listener);
    };
  }, []);

  // 正文净化后挂载(信任边界:不使用 dangerouslySetInnerHTML)
  React.useLayoutEffect(() => {
    const host = contentRef.current;
    if (!host || !article) return;
    host.textContent = '';
    host.appendChild(sanitizeArticleHtml(article.contentHtml));
  }, [article, state]);

  // 防盗链图片:直连失败后交主进程带原网页 Referer/Cookie 拉取并换成 data: URI
  React.useEffect(() => {
    const host = contentRef.current;
    if (!host || !sessionId) return undefined;
    let queue: HTMLImageElement[] = [];
    let timer: number | null = null;
    const flush = () => {
      timer = null;
      const imgs = queue;
      queue = [];
      const urls = imgs.map((i) => i.getAttribute('src') || '');
      ipcRenderer
        .invoke('reader-inline-images', {id: sessionId, urls})
        .then((map: Record<string, string>) => {
          imgs.forEach((img, i) => {
            const data = map && map[urls[i]];
            if (data) img.src = data;
            else img.style.display = 'none';
          });
        })
        .catch(() => undefined);
    };
    const onError = (e: Event) => {
      const img = e.target as HTMLImageElement;
      if (!img || img.tagName !== 'IMG' || img.dataset.retried) return;
      img.dataset.retried = '1';
      if (!/^https?:/i.test(img.getAttribute('src') || '')) {
        img.style.display = 'none';
        return;
      }
      queue.push(img);
      if (timer === null) timer = window.setTimeout(flush, 120);
    };
    host.addEventListener('error', onError, true);
    return () => {
      host.removeEventListener('error', onError, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [sessionId, state]);

  // 向下滚动收起工具栏,向上滚动露出
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let last = el.scrollTop;
    const onScroll = () => {
      const cur = el.scrollTop;
      if (Math.abs(cur - last) < 6) return;
      setBarHidden(cur > last && cur > 80);
      last = cur;
    };
    el.addEventListener('scroll', onScroll, {passive: true});
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    if (panel !== 'none') setBarHidden(false);
  }, [panel]);

  React.useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), toast.path ? 6000 : 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const minutes = React.useMemo(
    () => (article ? readingMinutes(new DOMParser()
      .parseFromString(article.contentHtml, 'text/html').body.textContent || '') : 0),
    [article],
  );

  const metaParts = article
    ? [
        article.byline,
        article.siteName,
        article.published,
        t('rdMinutes', {count: minutes}),
      ].filter(Boolean)
    : [];
  const metaLine = metaParts.join(' · ');

  const save = async (format: 'html' | 'md' = prefs.format) => {
    const host = contentRef.current;
    if (!article || !host || saving) return;
    setPanel('none');
    setSaving(true);
    try {
      const clone = host.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('img').forEach((img) => {
        img.removeAttribute('loading');
        img.removeAttribute('referrerpolicy');
        img.removeAttribute('data-retried');
        img.removeAttribute('style');
      });
      let content: string;
      if (format === 'md') {
        const header = `# ${article.title}\n\n> ${metaLine ? `${metaLine} · ` : ''}[${t('rdSource')}](${article.pageUrl})\n\n`;
        content = header + htmlToMarkdown(clone) + '\n';
      } else {
        // 离线 HTML:远程图片内联为 data: URI,断网也能完整打开
        const imgs = Array.from(clone.querySelectorAll('img'));
        const urls = imgs.map((i) => i.getAttribute('src') || '').filter((u) => /^https?:/i.test(u));
        if (urls.length) {
          setToast({text: t('rdSavingImages', {count: urls.length})});
          const map: Record<string, string> =
            (await ipcRenderer.invoke('reader-inline-images', {id: sessionId, urls})) || {};
          imgs.forEach((img) => {
            const data = map[img.getAttribute('src') || ''];
            if (data) img.setAttribute('src', data);
          });
        }
        content = buildOfflineHtml(article, clone.innerHTML, theme, prefs, metaLine, t('rdSource'));
      }
      const res = await ipcRenderer.invoke('reader-save', {
        title: article.title || article.siteName || 'article',
        format,
        content,
      });
      if (res && res.ok) {
        setToast({text: t('rdSavedTo', {path: res.path}), path: res.path});
      } else {
        setToast({text: t('rdSaveFailed', {error: (res && res.error) || ''})});
      }
    } catch (e) {
      setToast({text: t('rdSaveFailed', {error: String((e as Error)?.message || e)})});
    } finally {
      setSaving(false);
    }
  };

  const chooseFormat = (format: 'html' | 'md') => {
    updatePrefs({format});
    save(format);
  };

  const showInFolder = (path: string) => {
    ipcRenderer.invoke('reader-show-in-folder', path).catch(() => undefined);
  };

  return (
    <StyledApp
      ref={scrollRef}
      data-theme={theme}
      onMouseDown={(e) => {
        if (panel !== 'none' && !(e.target as HTMLElement).closest('[data-popover],[data-popover-toggle]')) {
          setPanel('none');
        }
      }}
    >
      <Toolbar data-hidden={barHidden}>
        <BookOpen size={18} />
        <ToolbarTitle>{article ? article.siteName : t('rdTitle')}</ToolbarTitle>
        {article && (
          <>
            <ToolBtn
              type="button"
              title={t('rdOpenOriginal')}
              aria-label={t('rdOpenOriginal')}
              onClick={() => window.open(article.pageUrl, '_blank')}
            >
              <ArrowSquareOut size={17} />
            </ToolBtn>
            <ToolBtn
              type="button"
              data-popover-toggle
              data-active={panel === 'style'}
              title={t('rdAppearance')}
              aria-label={t('rdAppearance')}
              onClick={() => setPanel(panel === 'style' ? 'none' : 'style')}
            >
              <TextAa size={18} />
            </ToolBtn>
            <SaveGroup data-popover-toggle>
              <ToolBtn
                type="button"
                disabled={saving}
                title={prefs.format === 'md' ? t('rdSaveAsMd') : t('rdSaveAsHtml')}
                onClick={() => save()}
              >
                <FloppyDisk size={16} />
                {saving ? t('rdSaving') : t('rdOneClickSave')}
              </ToolBtn>
              <ToolBtn
                type="button"
                disabled={saving}
                aria-label={t('rdSaveFormat')}
                title={t('rdSaveFormat')}
                onClick={() => setPanel(panel === 'format' ? 'none' : 'format')}
              >
                <CaretDown size={12} weight="bold" />
              </ToolBtn>
            </SaveGroup>
          </>
        )}
      </Toolbar>

      {panel === 'style' && (
        <Popover data-popover>
          <PopLabel>{t('rdTheme')}</PopLabel>
          <Segmented>
            <SegBtn
              type="button"
              data-active={prefs.theme === 'auto'}
              onClick={() => updatePrefs({theme: 'auto'})}
            >
              {t('rdThemeAuto')}
            </SegBtn>
            {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((k) => (
              <Swatch
                key={k}
                type="button"
                data-swatch={k}
                data-active={prefs.theme === k}
                onClick={() => updatePrefs({theme: k})}
              >
                {t(k === 'light' ? 'rdThemeLight' : k === 'sepia' ? 'rdThemeSepia' : 'rdThemeDark')}
              </Swatch>
            ))}
          </Segmented>
          <PopLabel>{t('rdFont')}</PopLabel>
          <Segmented>
            <SegBtn
              type="button"
              data-active={prefs.font === 'sans'}
              style={{fontFamily: FONT_STACKS.sans}}
              onClick={() => updatePrefs({font: 'sans'})}
            >
              {t('rdFontSans')}
            </SegBtn>
            <SegBtn
              type="button"
              data-active={prefs.font === 'serif'}
              style={{fontFamily: FONT_STACKS.serif}}
              onClick={() => updatePrefs({font: 'serif'})}
            >
              {t('rdFontSerif')}
            </SegBtn>
          </Segmented>
          <PopLabel>{t('rdFontSize')}</PopLabel>
          <Segmented>
            <SegBtn
              type="button"
              aria-label={t('rdSmaller')}
              disabled={prefs.fontSize <= FONT_MIN}
              onClick={() => updatePrefs({fontSize: Math.max(FONT_MIN, prefs.fontSize - 1)})}
            >
              <Minus size={14} weight="bold" />
            </SegBtn>
            <SegBtn type="button" as="div" style={{cursor: 'default', lineHeight: '30px', textAlign: 'center'}}>
              {prefs.fontSize}
            </SegBtn>
            <SegBtn
              type="button"
              aria-label={t('rdLarger')}
              disabled={prefs.fontSize >= FONT_MAX}
              onClick={() => updatePrefs({fontSize: Math.min(FONT_MAX, prefs.fontSize + 1)})}
            >
              <Plus size={14} weight="bold" />
            </SegBtn>
          </Segmented>
          <PopLabel>{t('rdWidth')}</PopLabel>
          <Segmented>
            {WIDTHS.map((w, i) => (
              <SegBtn
                key={w}
                type="button"
                data-active={prefs.width === w}
                onClick={() => updatePrefs({width: w})}
              >
                {t(i === 0 ? 'rdWidthNarrow' : i === 1 ? 'rdWidthMedium' : 'rdWidthWide')}
              </SegBtn>
            ))}
          </Segmented>
        </Popover>
      )}

      {panel === 'format' && (
        <Popover data-popover style={{width: 220}}>
          <MenuItem type="button" onClick={() => chooseFormat('html')}>
            <FileHtml size={18} />
            <span>{t('rdSaveAsHtml')}</span>
            {prefs.format === 'html' && <Check size={14} weight="bold" />}
          </MenuItem>
          <MenuItem type="button" onClick={() => chooseFormat('md')}>
            <FileText size={18} />
            <span>{t('rdSaveAsMd')}</span>
            {prefs.format === 'md' && <Check size={14} weight="bold" />}
          </MenuItem>
        </Popover>
      )}

      {state === 'loading' && <CenterState>{t('rdLoading')}</CenterState>}
      {state === 'error' && (
        <CenterState>
          <BookOpen size={40} />
          {t('rdExpired')}
        </CenterState>
      )}
      {state === 'ready' && article && (
        <Article
          lang={article.lang || undefined}
          dir={article.dir === 'rtl' ? 'rtl' : undefined}
          style={{
            maxWidth: prefs.width,
            fontSize: prefs.fontSize,
            fontFamily: FONT_STACKS[prefs.font],
          }}
        >
          <h1 className="reader-title">{article.title}</h1>
          <div className="reader-meta">
            {metaLine}
            {metaLine ? ' · ' : ''}
            <a href={article.pageUrl} target="_blank" rel="noopener noreferrer">
              {t('rdSource')}
            </a>
          </div>
          <div ref={contentRef} />
        </Article>
      )}

      {toast && (
        <Toast role="status">
          <span title={toast.text}>{toast.text}</span>
          {toast.path && (
            <button type="button" onClick={() => showInFolder(toast.path!)}>
              {t('rdShowInFolder')}
            </button>
          )}
        </Toast>
      )}
    </StyledApp>
  );
};
