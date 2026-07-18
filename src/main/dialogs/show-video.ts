// 导入 BrowserWindow 类
import { BrowserWindow } from 'electron';
// 导入 Application 类
import { Application } from '../application';
// 导入设计相关的常量
import { DIALOG_MARGIN_TOP, DIALOG_MARGIN } from '~/constants/design';

// 显示视频对话框的函数
export const showVideoDialog = (
  browserWindow: BrowserWindow, // 父窗口对象
  x: number, // x 坐标
  y: number, // y 坐标
  data?: { // 数据对象，可选
    videoUrls?: string[]; // 视频 URL 数组
    tabId: number; // 标签页 ID
  },
) => {
  // 如果未提供数据对象，则从当前选定的视图管理器中获取视频 URL 数组和标签页 ID
  if (!data) {
    const {
      videoUrls,
      id,
    } = Application.instance.windows.current.viewManager.selected;
    data = {
      videoUrls,
      tabId: id
    };
  }

  // 调用 Application 实例的 dialogs 对象的 show 方法显示对话框，并传入相关参数
  const dialog = Application.instance.dialogs.show({
    name: 'show-video', // 对话框名称
    browserWindow, // 父窗口对象
    getBounds: () => ({ // 获取对话框位置和尺寸的函数
      width: 144,
      height: 350,
      x: x - 84,
      y: y - DIALOG_MARGIN_TOP,
    }),
    onWindowBoundsUpdate: () => dialog.hide(), // 窗口尺寸更新时隐藏对话框
  });

  // 如果对话框不存在，则直接返回
  if (!dialog) return;

  // 当对话框加载完成时触发的事件
  dialog.on('loaded', (e) => {
    // 向渲染进程回复 'data' 事件，并携带数据对象
    e.reply('data', data);
  });
};
