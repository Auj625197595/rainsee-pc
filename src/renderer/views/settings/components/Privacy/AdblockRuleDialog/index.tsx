import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {ipcRenderer} from '~/common/renderer-ipc';

import {Dialog, Title, Content, Buttons, CloseButton} from '../../Dialog';
import {NormalButton} from '../../App';
import store from '../../../store';

const TextArea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    style={{
      width: '100%',
      minHeight: 160,
      resize: 'vertical',
      border: '1px solid #ccc',
      borderRadius: 6,
      padding: 8,
      fontSize: 13,
      fontFamily: 'inherit',
      boxSizing: 'border-box',
      ...(props.style || {}),
    }}
  />
);

export default observer(() => {
  const [value, setValue] = React.useState('');
  const [filterCount, setFilterCount] = React.useState(0);
  const visible = store.dialogContent === 'adblock-rule';

  React.useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    (async () => {
      const lists = await ipcRenderer.invoke('get-ad-lists');
      const count = await ipcRenderer.invoke('get-ad-filter-count');
      if (!active) return;
      setValue(lists || '');
      setFilterCount(count || 0);
    })();
    return () => {
      active = false;
    };
  }, [visible]);

  const onSave = () => {
    ipcRenderer.send('update-ad-lists', value);
    store.dialogContent = null;
  };

  return (
    <Dialog visible={visible} style={{width: 460, marginLeft: 'auto'}}>
      <Title>广告拦截订阅</Title>
      <Content>
        <div style={{fontSize: 12, opacity: 0.7, marginBottom: 8}}>
          {`一行一个订阅地址，支持 ublock / adblockplus / adguard 格式。当前规则数：${filterCount}`}
        </div>
        <TextArea
          value={value}
          placeholder={'例如：https://easylist.to/easylist/easylist.txt'}
          onChange={(e) => setValue(e.target.value)}
        />
      </Content>
      <Buttons>
        <CloseButton/>
        <NormalButton onClick={onSave}>
          保存
        </NormalButton>
      </Buttons>
    </Dialog>
  );
});
