import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {ThemeProvider} from 'styled-components';

import {Translate} from '@phosphor-icons/react';
import store, {TranslateEngine} from '../../store';
import {UIStyle} from '~/renderer/mixins/default-styles';
import {
  StyledApp,
  Header,
  HeaderIcon,
  HeaderTitle,
  EngineSection,
  SectionLabel,
  EngineSelect,
  List,
  Item,
  ItemLabel,
  Check,
  Footer,
  RestoreButton,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

// 语言选择弹窗:点击某语言即翻译/切换到该语言(未开启则开启,已开启则重译)。
// 已开启时底部多出「显示原文」按钮。语言列表使用自定义滚动区域,避免 BrowserView
// 对原生下拉列表的裁剪。
export const App = observer(() => {
  const t = useI18n();
  return (
    <ThemeProvider theme={{...store.theme}}>
      <StyledApp
        visible={store.visible}
        onMouseEnter={() => store.notifyEnter()}
        onMouseLeave={() => store.notifyLeave()}
      >
        <UIStyle />
        <Header>
          <HeaderIcon>
            <Translate size={17} weight="bold" />
          </HeaderIcon>
          <HeaderTitle>{t('tvChooseLanguage')}</HeaderTitle>
        </Header>
        <EngineSection>
          <SectionLabel>{t('tvEngineSection')}</SectionLabel>
          <EngineSelect
            value={store.settings.translateEngine || 'microsoft'}
            onChange={(event) =>
              void store.chooseEngine(event.target.value as TranslateEngine)
            }
          >
            <option value="microsoft">{t('tvEngineMicrosoft')}</option>
            <option value="custom-llm">{t('tvEngineCustom')}</option>
          </EngineSelect>
        </EngineSection>
        <List>
          {store.languages.map((l) => (
            <Item
              key={l.code}
              selected={l.code === store.target}
              onClick={() => store.chooseLanguage(l.code)}
            >
              <ItemLabel>{l.label}</ItemLabel>
              {l.code === store.target && <Check>✓</Check>}
            </Item>
          ))}
        </List>
        {store.active && (
          <Footer>
            <RestoreButton onClick={() => store.restore()}>{t('tvShowOriginal')}</RestoreButton>
          </Footer>
        )}
      </StyledApp>
    </ThemeProvider>
  );
});
