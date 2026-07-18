import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {ThemeProvider} from 'styled-components';

import store from '../../store';
import {UIStyle} from '~/renderer/mixins/default-styles';
import {
  StyledApp,
  Header,
  AppIconWrap,
  AppIcon,
  AppIconFallback,
  TitleCol,
  AppName,
  Publisher,
  CloseBtn,
  Body,
  BodyText,
  OptionsTitle,
  OptionRow,
  CheckBox,
  OptionLabel,
  Footer,
  InstallBtn,
  CancelBtn,
} from './style';

// PWA 安装确认弹窗(Edge 风格)。复选框与"安装中"为本地 React 态,
// 每次弹窗打开(store.visible 翻 true)重置为默认勾选。
export const App = observer(() => {
  const [desktop, setDesktop] = React.useState(true);
  const [startMenu, setStartMenu] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [iconOk, setIconOk] = React.useState(true);

  React.useEffect(() => {
    if (store.visible) {
      setDesktop(true);
      setStartMenu(true);
      setBusy(false);
      setIconOk(true);
    }
  }, [store.visible]);

  const name = store.name || '应用';
  const initial = (name.trim().charAt(0) || '应').toUpperCase();

  const onInstall = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 始终按勾选项执行:首次安装创建快捷方式;已安装时点「打开」会重开窗口并按勾选项
      // 刷新快捷方式(用于修复早期 .png 图标导致的空白快捷方式)。
      await store.confirm({desktop, startMenu});
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemeProvider theme={{...store.theme}}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Header>
          <AppIconWrap>
            {store.iconUrl && iconOk ? (
              <AppIcon src={store.iconUrl} onError={() => setIconOk(false)} />
            ) : (
              <AppIconFallback>{initial}</AppIconFallback>
            )}
          </AppIconWrap>
          <TitleCol>
            <AppName>{name}</AppName>
            {store.publisher ? <Publisher>发布者：{store.publisher}</Publisher> : null}
          </TitleCol>
          <CloseBtn onClick={() => store.cancel()}>✕</CloseBtn>
        </Header>
        <Body>
          <BodyText>
            {store.installed
              ? '已安装此应用,点击「打开」在其独立窗口中运行,并按下方勾选项刷新快捷方式。'
              : '将作为应用安装,并在其各自的窗口中运行。'}
          </BodyText>
          <OptionsTitle>{store.installed ? '快捷方式' : '安装选项'}</OptionsTitle>
          <OptionRow onClick={() => setDesktop((v) => !v)}>
            <CheckBox checked={desktop} />
            <OptionLabel>创建桌面快捷方式</OptionLabel>
          </OptionRow>
          <OptionRow onClick={() => setStartMenu((v) => !v)}>
            <CheckBox checked={startMenu} />
            <OptionLabel>添加到"开始"菜单</OptionLabel>
          </OptionRow>
        </Body>
        <Footer>
          <InstallBtn disabled={busy} onClick={onInstall}>
            {store.installed ? '打开' : busy ? '安装中…' : '安装'}
          </InstallBtn>
          <CancelBtn onClick={() => store.cancel()}>取消</CancelBtn>
        </Footer>
      </StyledApp>
    </ThemeProvider>
  );
});
