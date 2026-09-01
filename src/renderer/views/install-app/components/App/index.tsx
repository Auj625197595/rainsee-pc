import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { PencilSimple } from '@phosphor-icons/react';

import store from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import {
  StyledApp,
  Header,
  AppIconWrap,
  AppIcon,
  AppIconFallback,
  IconEditBadge,
  TitleCol,
  AppName,
  Publisher,
  CloseBtn,
  Body,
  BodyText,
  ErrorText,
  OptionsTitle,
  OptionRow,
  CheckBox,
  OptionLabel,
  Footer,
  InstallBtn,
  CancelBtn,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

// PWA 安装 / 小号快捷方式确认弹窗。复选框与忙碌状态为本地 React 态,
// 每次弹窗打开(store.visible 翻 true)重置为默认勾选。
export const App = observer(() => {
  const t = useI18n();
  const [desktop, setDesktop] = React.useState(true);
  const [startMenu, setStartMenu] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [iconOk, setIconOk] = React.useState(true);
  const [iconSource, setIconSource] = React.useState('');
  const [localIconPath, setLocalIconPath] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (store.visible) {
      setDesktop(true);
      setStartMenu(true);
      setBusy(false);
      setIconOk(true);
      setIconSource(store.iconUrl);
      setLocalIconPath('');
      setError('');
    }
  }, [store.visible]);

  const isProfile = store.mode === 'profile';
  const name = store.name || t('iaAppFallback');
  const initial = (
    name.trim().charAt(0) || t('iaInitialFallback')
  ).toUpperCase();

  const onInstall = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // 始终按勾选项执行:首次安装创建快捷方式;已安装时点「打开」会重开窗口并按勾选项
      // 刷新快捷方式(用于修复早期 .png 图标导致的空白快捷方式)。
      const result = await store.confirm({ desktop, startMenu, localIconPath });
      if (!result?.ok) {
        setError(
          result?.message ||
            (isProfile ? t('iaProfileShortcutFailed') : t('iaInstallFailed')),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onSelectIcon = async () => {
    const selected = await store.selectIcon();
    if (!selected) return;
    setLocalIconPath(selected.path);
    setIconSource(selected.dataUrl);
    setIconOk(true);
    setError('');
  };

  const onIconError = () => {
    if (iconSource !== store.fallbackIconUrl && store.fallbackIconUrl) {
      setIconSource(store.fallbackIconUrl);
      return;
    }
    setIconOk(false);
  };

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <AppIconWrap
            type="button"
            title={t('iaChooseIcon')}
            aria-label={t('iaChooseIcon')}
            onClick={onSelectIcon}
          >
            {iconSource && iconOk ? (
              <AppIcon src={iconSource} onError={onIconError} />
            ) : (
              <AppIconFallback>{initial}</AppIconFallback>
            )}
            <IconEditBadge>
              <PencilSimple size={11} weight="bold" />
            </IconEditBadge>
          </AppIconWrap>
          <TitleCol>
            <AppName>{name}</AppName>
            {store.publisher ? (
              <Publisher>
                {isProfile
        ? store.publisher
        : t('iaPublisher', { name: store.publisher })}
              </Publisher>
            ) : null}
          </TitleCol>
          <CloseBtn onClick={() => store.cancel()}>✕</CloseBtn>
        </Header>
        <Body>
          <BodyText>
            {isProfile
              ? t('iaProfileDesc')
              : store.installed
              ? t('iaProfileInstalledDesc')
              : t('iaAppDesc')}
          </BodyText>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <OptionsTitle>
            {isProfile
        ? t('iaAddLocation')
        : store.installed
          ? t('iaShortcutSection')
          : t('iaInstallOptions')}
          </OptionsTitle>
          <OptionRow onClick={() => setDesktop((v) => !v)}>
            <CheckBox checked={desktop} />
            <OptionLabel>{t('iaDesktopShortcut')}</OptionLabel>
          </OptionRow>
          <OptionRow onClick={() => setStartMenu((v) => !v)}>
            <CheckBox checked={startMenu} />
            <OptionLabel>{t('iaStartMenu')}</OptionLabel>
          </OptionRow>
        </Body>
        <Footer>
          <InstallBtn
            disabled={busy || (isProfile && !desktop && !startMenu)}
            onClick={onInstall}
          >
            {isProfile
              ? busy
                ? t('iaCreating')
                : t('iaCreate')
              : store.installed
              ? t('iaOpen')
              : busy
              ? t('iaInstalling')
              : t('iaInstall')}
          </InstallBtn>
          <CancelBtn onClick={() => store.cancel()}>{t('cancel')}</CancelBtn>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
