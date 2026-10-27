export const OPEN_LINKS_IN_NEW_PAGE_PERMISSION = 'open-links-in-new-page';
export const OPEN_POPUPS_IN_NEW_TAB_PERMISSION = 'open-popups-in-new-tab';
export const EXTERNAL_NAVIGATION_PERMISSION = 'external-navigation';
export const SELECTION_PANEL_PERMISSION = 'selection-panel';
export const IGNORE_CERTIFICATE_ERRORS_PERMISSION = 'ignore-certificate-errors';

export const getPermissionText = (permission: string) => {
  if (permission === OPEN_LINKS_IN_NEW_PAGE_PERMISSION) {
    return '所有跳转在新页面打开';
  }

  if (permission === OPEN_POPUPS_IN_NEW_TAB_PERMISSION) {
    return '弹窗在新标签页打开';
  }

  if (permission === EXTERNAL_NAVIGATION_PERMISSION) {
    return '外链跳转';
  }

  if (permission === SELECTION_PANEL_PERMISSION) {
    return '隐藏文本选择面板';
  }

  if (permission === IGNORE_CERTIFICATE_ERRORS_PERMISSION) {
    return '忽略证书错误';
  }

  if (permission === 'openExternal') {
    return '打开外部链接';
  }

  if (permission === 'notifications') {
    return '发送通知消息';
  }

  if (permission === 'microphone') {
    return '使用麦克风';
  }

  if (permission === 'camera') {
    return '使用摄像头';
  }

  if (permission === 'geolocation') {
    return '获取位置信息';
  }

  if (permission === 'sensors') {
    return '访问运动与方向传感器';
  }

  if (permission === 'screen-wake-lock') {
    return '保持屏幕常亮';
  }

  if (permission === 'local-network-access') {
    return '访问本地网络';
  }

  if (permission === 'idle-detection') {
    return '检测用户是否处于空闲状态';
  }

  if (permission === 'midiSysex') {
    return '使用 MIDI 系统专有消息';
  }

  return '获取' + permission + '权限';
};

export const getPermissionDecisionText = (type: 1 | 2 | 3) => {
  return type === 1 ? '允许' : type === 3 ? '询问' : '拒绝';
};
