import * as React from 'react';

import {Header, Title} from '../App/style';
import { ipcRenderer } from '~/common/renderer-ipc';
import {NormalButton} from "~/renderer/views/settings/components/App";
import { getSettingsTranslator } from '../utils';

// alert 文案在事件回调里实时取翻译(语言切换后仍正确)。
const loadExtensionFromCrx = async () => {
  const t = getSettingsTranslator();
  const res = await ipcRenderer.invoke('load-extension-from-crx');
  //console.log("loadExtensionFromCrx", res);
  if (res && res.name) {
    alert(t('setextLoaded', {name: res.name}));
  }
};
const loadExtensionFromDir = async () => {
  const t = getSettingsTranslator();
  const res = await ipcRenderer.invoke('load-extension-from-dir');
  if (res && res.name) {
    alert(t('setextLoaded', {name: res.name}));
  }
};
const loadExtensionFromWeb = (url: string) => () => {
  window.location.href = url;
};

export const Extensions = () => {
  const t = getSettingsTranslator();
  return (
    <>
      <Header>{t('sysExtensions')}</Header>
      <div style={{marginTop: 10}}>
        <NormalButton
          onClick={loadExtensionFromWeb("https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home?hl=zh-CN")}
        >
          {t('setextEdge')}
        </NormalButton>
      </div>
      <div style={{marginTop: 10}}>
        <NormalButton
          onClick={loadExtensionFromWeb("https://www.crxsoso.com/")}
        >
          {t('setextCrxSoso')}
        </NormalButton>
      </div>
      <div style={{marginTop: 10}}>
        <NormalButton
          onClick={loadExtensionFromCrx}
        >
          {t('setextLocal')}
        </NormalButton>
      </div>
      <div style={{marginTop: 10}}>
        <NormalButton
          onClick={loadExtensionFromDir}
        >
          {t('setextUnpacked')}
        </NormalButton>
      </div>
    </>
  );
};
