import * as React from 'react';
import {observer} from 'mobx-react-lite';
import styled from 'styled-components';

import {Dialog, Title, Content, Buttons, CloseButton} from '../../Dialog';
import {NormalButton} from '../../App';
import store from '../../../store';
import {saveWebBrowsingSettings, getSettingsTranslator} from '../../../utils';
import {ClearItemsList, toClearItems} from '../ClearItemsList';

// 「退出时自动清理」多选对话框:勾选项双向绑定 store.settings.clearOnExit.*,
// 确定后持久化。列表与「立即清除」(BrowsingDataDialog)共用 ClearItemsList。

const Hint = styled.div`
  font-size: 12px;
  line-height: 18px;
  margin: 0 4px 6px;
  opacity: 0.6;
`;

export default observer(() => {
  const t = getSettingsTranslator();
  const visible = store.dialogContent === 'clear-on-exit';

  // settings.clearOnExit 始终存在(主进程 load 校验补全),这里防御性兜底。
  const coe = toClearItems(store.settings.clearOnExit);

  const onConfirm = () => {
    saveWebBrowsingSettings({clearOnExit: {...coe}});
    store.dialogContent = null;
  };

  return (
    <Dialog visible={visible} style={{width: 400}}>
      <Title>{t('searchClearOnExit')}</Title>
      <Content>
        <Hint>{t('coeDialogHint')}</Hint>
        <ClearItemsList
          visible={visible}
          items={coe}
          onToggle={(key) => {
            store.settings.clearOnExit = {...coe, [key]: !coe[key]};
          }}
          ariaLabel={t('searchClearOnExit')}
        />
      </Content>
      <Buttons>
        <CloseButton />
        <NormalButton onClick={onConfirm}>{t('confirm')}</NormalButton>
      </Buttons>
    </Dialog>
  );
});
