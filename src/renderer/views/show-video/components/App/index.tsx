import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { StyledApp, Buttons } from './style';
import store from '../../store';
import { Button } from '~/renderer/components/Button';
import { ipcRenderer } from 'electron';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';


const onClick = (type: string) => () => {
  ipcRenderer.send(`show-${type}-video-dialog-${store.tabId}`);
  store.hide();
};
const onCopyClick = () => {
  const t = useI18n();
  const s = (store.videoUrls || []).join("\n");
  const textarea = document.createElement('textarea');
  textarea.value = s;
  document.body.appendChild(textarea);
  textarea.select();
  navigator.clipboard.writeText(textarea.value)
    .then(() => {
      alert(t('svvCopiedAlert', { links: s }));
    })
    .catch((error) => {
      alert(t('svvCopyFailedAlert', { error }));
    });
  document.body.removeChild(textarea);
  store.hide();
};

export const App = observer(() => {
  const t = useI18n();
  const videoUrls = store.videoUrls || [];
  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <StyledApp visible={store.visible}>
        <UIStyle />
        <Buttons>
          <Button onClick={onClick("full")}>{t('svvFullscreen')}</Button>
          <Button onClick={onClick("float")}>{t('svvFloat')}</Button>
          <Button onClick={onClick("other")}>{t('svvExternal')}</Button>
          <Button onClick={onCopyClick}>{t('svvCopyUrl')}</Button>
        </Buttons>
      </StyledApp>
    </ThemeProvider>
  );
});
