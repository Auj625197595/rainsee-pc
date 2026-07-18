export const OPEN_LINKS_IN_NEW_PAGE_PERMISSION = 'open-links-in-new-page';

export const getPermissionText = (permission: string) => {
  if (permission === OPEN_LINKS_IN_NEW_PAGE_PERMISSION) {
    return '所有链接在新页面打开';
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

  return '获取' + permission + '权限';
};

export const getPermissionDecisionText = (type: 1 | 2) => {
  return type === 1 ? '允许' : '拒绝';
};
