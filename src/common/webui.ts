import {WEBUI_BASE_URL, WEBUI_URL_SUFFIX} from '~/constants/files';
import {appendDeviceParams, IDeviceParams} from '~/common/newtab-url';

let storeNewTab = "";
let storeNewTabTemp = "";
let storeDeviceParams: IDeviceParams | null = null;

export const updateStoreNewTab = (url: string) => {
  storeNewTab = url;
  if (!url) {
    storeNewTabTemp = url;
  }
}

export const updateStoreNewTabTemp = (url: string) => {
  storeNewTabTemp = url;
}

// 由具备 ipcRenderer 的渲染进程(app 视图)在启动时同步设备参数
export const updateStoreDeviceParams = (params: IDeviceParams) => {
  storeDeviceParams = params;
}

// 登录态(ck=userkey)变化时更新,供新标签页 URL 实时拼接最新 ck
export const updateStoreDeviceParamsCk = (ck: string) => {
  if (storeDeviceParams) {
    storeDeviceParams = { ...storeDeviceParams, ck: ck || '' };
  }
}

export const getWebUIURL = (hostname: string) => {
  if ("newtab" == hostname) {
    if (storeNewTabTemp) {
      return appendDeviceParams(storeNewTabTemp, storeDeviceParams);
    }
    if (storeNewTab) {
      return appendDeviceParams(storeNewTab.split("\n")[0], storeDeviceParams);
    }
  }
  return `${WEBUI_BASE_URL}${hostname}${WEBUI_URL_SUFFIX}`;
}
