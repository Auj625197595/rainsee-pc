import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { Dialog, Title, Content, Buttons, CloseButton } from '../../Dialog';
import { NormalButton } from '../../App';
import store from '../../../store';

const clearData = () => {
  alert("此功能开发中");
}

export default observer(() => {
  return (
    <Dialog visible={store.dialogContent === 'privacy'} style={{ width: 344, marginLeft: "auto" }}>
      <Title>清除浏览数据</Title>
      <Content></Content>
      <Buttons>
        <CloseButton />
        <NormalButton onClick={clearData}>
          立即清除
        </NormalButton>
      </Buttons>
    </Dialog>
  );
});
