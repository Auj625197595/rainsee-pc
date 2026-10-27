// 下载 .crx 后的安装确认弹窗 / 安装完成气泡共用的数据。
export interface IExtensionInstallPreview {
  id: string;
  name: string;
  version: string;
  description: string;
  // data: URL,直接取自包内图标;空串表示渲染层用占位图标。
  iconUrl: string;
  // API 权限(storage/tabs/...),渲染层按 Chrome 文案翻译。
  permissions: string[];
  // 网站访问模式(host_permissions + MV2 permissions 里的模式 + content_scripts.matches)。
  hosts: string[];
  isTheme: boolean;
  // 已安装同 ID 扩展时的版本号,用于区分「添加」与「更新」。
  installedVersion: string;
  // 已安装的同名、不同 ID 扩展(同一扩展来自不同渠道:Edge/Chrome 商店、官网 crx、
  // 解压包,签名公钥不同 → ID 不同)。非空时确认框提示,可选择替换或保留两者。
  duplicates?: IExtensionInstallDuplicate[];
}

export interface IExtensionInstallDuplicate {
  id: string;
  name: string;
  version: string;
}

// 确认框结果:false=取消;true=添加(同名时即「保留两者」);'replace'=添加并卸载同名旧扩展。
export type ExtensionInstallDecision = boolean | 'replace';

// 弹窗双模式:confirm=安装前确认(居中模态);installed=安装完成气泡(锚定工具栏扩展按钮)。
export type ExtensionInstallDialogMode = 'confirm' | 'installed';

export interface IExtensionInstallDialogData {
  mode: ExtensionInstallDialogMode;
  preview: IExtensionInstallPreview;
}
