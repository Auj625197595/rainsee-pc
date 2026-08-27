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

// PWA 安装 / 小号快捷方式确认弹窗。复选框与忙碌状态为本地 React 态,
// 每次弹窗打开(store.visible 翻 true)重置为默认勾选。
export const App = observer(() => {
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
  const name = store.name || '应用';
  const initial = (name.trim().charAt(0) || '应').toUpperCase();

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
            (isProfile ? '创建快捷方式失败' : '安装失败，请稍后重试'),
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
            title="选择本地图标"
            aria-label="选择本地图标"
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
                {isProfile ? store.publisher : `发布者：${store.publisher}`}
              </Publisher>
            ) : null}
          </TitleCol>
          <CloseBtn onClick={() => store.cancel()}>✕</CloseBtn>
        </Header>
        <Body>
          <BodyText>
            {isProfile
              ? '通过快捷方式直接打开此小号，并可自定义显示图标。'
              : store.installed
              ? '已安装此应用,点击「打开」在其独立窗口中运行,并按下方勾选项刷新快捷方式。'
              : '将作为应用安装,并在其各自的窗口中运行。'}
          </BodyText>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <OptionsTitle>
            {isProfile ? '添加位置' : store.installed ? '快捷方式' : '安装选项'}
          </OptionsTitle>
          <OptionRow onClick={() => setDesktop((v) => !v)}>
            <CheckBox checked={desktop} />
            <OptionLabel>创建桌面快捷方式</OptionLabel>
          </OptionRow>
          <OptionRow onClick={() => setStartMenu((v) => !v)}>
            <CheckBox checked={startMenu} />
            <OptionLabel>添加到“开始”菜单</OptionLabel>
          </OptionRow>
        </Body>
        <Footer>
          <InstallBtn
            disabled={busy || (isProfile && !desktop && !startMenu)}
            onClick={onInstall}
          >
            {isProfile
              ? busy
                ? '创建中…'
                : '创建'
              : store.installed
              ? '打开'
              : busy
              ? '安装中…'
              : '安装'}
          </InstallBtn>
          <CancelBtn onClick={() => store.cancel()}>取消</CancelBtn>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
