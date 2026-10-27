import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { PuzzlePiece } from '@phosphor-icons/react';

import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';
import { getExtensionPermissionWarnings } from '~/common/extension-permission-warnings';
import { ExtensionInstallDecision } from '~/interfaces';
import {
  Card,
  Arrow,
  Inner,
  Header,
  IconBox,
  IconFallback,
  TitleCol,
  Title,
  Meta,
  CloseBtn,
  Body,
  Description,
  SectionTitle,
  PermissionList,
  Hint,
  DuplicateNotice,
  Footer,
  PrimaryBtn,
  SecondaryBtn,
  TextBtn,
} from './style';

// 与主进程 dialogs/extension-install.ts 的内容宽度一致。
const CONFIRM_WIDTH = 400;
const INSTALLED_WIDTH = 340;
// DialogBaseStyle 下外边距 16;上外边距 confirm 为 3,installed 为箭头留白 10。
const BOTTOM_MARGIN = 16;
export const CONFIRM_TOP_MARGIN = 3;
export const INSTALLED_TOP_MARGIN = 10;

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M3 3l8 8M11 3l-8 8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const ExtIcon = ({ src, size }: { src: string; size: number }) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  return (
    <IconBox size={size}>
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <IconFallback>
          <PuzzlePiece size={Math.round(size * 0.55)} weight="fill" />
        </IconFallback>
      )}
    </IconBox>
  );
};

export const App = observer(() => {
  const t = useI18n();
  const innerRef = React.useRef<HTMLDivElement>(null);
  const primaryRef = React.useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = React.useState(false);
  const { preview, mode } = store;
  const isConfirm = mode === 'confirm';
  const isUpdate = !!preview.installedVersion;

  React.useEffect(() => {
    setBusy(false);
    if (store.visible) {
      // 默认焦点落在主按钮上,Enter 即确认、Esc 即取消,与 Chrome 一致。
      requestAnimationFrame(() => primaryRef.current?.focus());
    }
  }, [store.openSeq, store.visible]);

  // 内容高度变化(权限条数/描述折行)时回报主进程重排 BrowserView。
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return undefined;
    const top =
      store.mode === 'installed' ? INSTALLED_TOP_MARGIN : CONFIRM_TOP_MARGIN;
    const report = () => store.reportHeight(el.offsetHeight + top + BOTTOM_MARGIN);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [store.openSeq, mode]);

  // 完成气泡:点到气泡外(BrowserView 失焦)即收起。
  React.useEffect(() => {
    if (isConfirm) return undefined;
    const onBlur = () => {
      if (store.visible && store.mode === 'installed') store.respond(false);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [isConfirm]);

  const respond = (decision: ExtensionInstallDecision) => {
    if (busy) return;
    if (decision) setBusy(true);
    store.respond(decision);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      respond(false);
    }
  };

  const name = preview.name || preview.id;

  if (!isConfirm) {
    return (
      <ThemeProvider theme={{ ...store.theme }}>
        <UIStyle />
        <Card
          key={store.openSeq}
          visible={store.visible}
          width={INSTALLED_WIDTH}
          style={{ marginTop: INSTALLED_TOP_MARGIN }}
          role="dialog"
          aria-live="polite"
          aria-label={t('extiInstalledTitle', { name })}
          onKeyDown={onKeyDown}
        >
          <Arrow right={store.arrowRight} />
          <Inner ref={innerRef}>
            <Header>
              <ExtIcon src={preview.iconUrl} size={32} />
              <TitleCol>
                <Title>{t('extiInstalledTitle', { name })}</Title>
              </TitleCol>
              <CloseBtn
                type="button"
                aria-label={t('close')}
                title={t('close')}
                onClick={() => respond(false)}
              >
                <CloseIcon />
              </CloseBtn>
            </Header>
            <Body>
              <Description as="div" style={{ marginBottom: 0 }}>
                {t('extiInstalledDesc')}
              </Description>
            </Body>
            <Footer>
              <TextBtn type="button" onClick={() => store.openManager()}>
                {t('extiManage')}
              </TextBtn>
              <PrimaryBtn
                ref={primaryRef}
                type="button"
                onClick={() => respond(false)}
              >
                {t('extiGotIt')}
              </PrimaryBtn>
            </Footer>
          </Inner>
        </Card>
      </ThemeProvider>
    );
  }

  // 同名不同 ID(另一渠道的同款扩展)已安装:主按钮改为替换,次按钮保留两者。
  const duplicates = isUpdate ? [] : preview.duplicates || [];
  const hasDuplicate = duplicates.length > 0;
  const warnings = preview.isTheme
    ? []
    : getExtensionPermissionWarnings(preview.permissions, preview.hosts, t);
  const title = preview.isTheme
    ? t('extiThemeTitle', { name })
    : isUpdate
    ? t('extiUpdateTitle', { name })
    : t('extiConfirmTitle', { name });
  const primaryLabel = preview.isTheme
    ? t('extiAddTheme')
    : isUpdate
    ? t('extiUpdate')
    : t('extiAdd');
  const meta =
    isUpdate && preview.version && preview.installedVersion !== preview.version
      ? t('extiUpdateVersion', { from: preview.installedVersion, to: preview.version })
      : preview.version
      ? t('extiVersion', { version: preview.version })
      : '';

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <Card
        key={store.openSeq}
        visible={store.visible}
        width={CONFIRM_WIDTH}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exti-title"
        onKeyDown={onKeyDown}
      >
        <Inner ref={innerRef}>
          <Header>
            <ExtIcon src={preview.iconUrl} size={40} />
            <TitleCol>
              <Title id="exti-title">{title}</Title>
              {meta ? <Meta>{meta}</Meta> : null}
            </TitleCol>
          </Header>
          <Body>
            {preview.description ? (
              <Description title={preview.description}>
                {preview.description}
              </Description>
            ) : null}
            {!preview.isTheme &&
              (warnings.length ? (
                <>
                  <SectionTitle>{t('extiCanTitle')}</SectionTitle>
                  <PermissionList>
                    {warnings.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </PermissionList>
                </>
              ) : (
                <div>{t('extiNoWarnings')}</div>
              ))}
            {hasDuplicate ? (
              <DuplicateNotice role="note">
                {t('extiDuplicateNotice', {
                  name: duplicates[0].name || name,
                  version: duplicates[0].version || '?',
                })}
              </DuplicateNotice>
            ) : null}
            <Hint>{t('extiUntrustedHint')}</Hint>
          </Body>
          <Footer>
            <SecondaryBtn type="button" onClick={() => respond(false)}>
              {t('cancel')}
            </SecondaryBtn>
            {hasDuplicate ? (
              <SecondaryBtn
                ref={primaryRef}
                type="button"
                disabled={busy}
                onClick={() => respond(true)}
              >
                {t('extiKeepBoth')}
              </SecondaryBtn>
            ) : null}
            <PrimaryBtn
              // 替换会清掉旧扩展数据,默认焦点(Enter)落在「保留两者」上。
              ref={hasDuplicate ? undefined : primaryRef}
              type="button"
              disabled={busy}
              onClick={() => respond(hasDuplicate ? 'replace' : true)}
            >
              {hasDuplicate ? t('extiReplace') : primaryLabel}
            </PrimaryBtn>
          </Footer>
        </Inner>
      </Card>
    </ThemeProvider>
  );
});
