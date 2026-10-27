import * as React from 'react';
import {observer} from 'mobx-react-lite';

import {Dialog, Title, Content, Buttons, CloseButton} from '../../Dialog';
import {NormalButton} from '../../App';
import store from '../../../store';
import {saveWebBrowsingSettings, getSettingsTranslator} from '../../../utils';
import {ClearItemsList, toClearItems} from '../ClearItemsList';
import {ipcRenderer} from '~/common/renderer-ipc';

// 「立即清除浏览数据」对话框。清理项与「退出时自动清理」一致(共用 ClearItemsList),
// 确定后经 clear-browsing-data-now 复用主进程 performClearOnExit 编排。
// 选择态在确认清理时持久化到 clearBrowsingData,供工具栏清理入口复用。

export default observer(() => {
  const t = getSettingsTranslator();
  const visible = store.dialogContent === 'browsing-data';
  const [items, setItems] = React.useState(() =>
    toClearItems(store.settings.clearBrowsingData),
  );
  const [clearing, setClearing] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setItems(toClearItems(store.settings.clearBrowsingData));
    }
  }, [visible]);

  const onClear = async () => {
    setClearing(true);
    try {
      store.settings.clearBrowsingData = {...items};
      saveWebBrowsingSettings({clearBrowsingData: {...items}});
      await ipcRenderer.invoke('clear-browsing-data-now', {items});
    } catch (e) {
      console.error('[clear-browsing-data] failed', e);
    } finally {
      setClearing(false);
      store.dialogContent = null;
    }
  };

  return (
    <Dialog visible={visible} style={{width: 400}}>
      <Title>{t('searchClearBrowsingData')}</Title>
      <Content>
        <ClearItemsList
          visible={visible}
          items={items}
          onToggle={(key) => setItems((prev) => ({...prev, [key]: !prev[key]}))}
          ariaLabel={t('searchClearBrowsingData')}
        />
      </Content>
      <Buttons>
        <CloseButton />
        <NormalButton onClick={onClear} disabled={clearing}>
          {clearing ? t('pvClearing') : t('pvClearNow')}
        </NormalButton>
      </Buttons>
    </Dialog>
  );
});
