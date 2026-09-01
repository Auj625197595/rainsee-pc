import {execFile} from 'child_process';
import {dialog, shell} from 'electron';
import {existsSync} from 'fs';
import {Application} from '../application';
import {getMainTranslator} from '../i18n';

// 外部下载器(唤起第三方下载器)。
// 启动方式沿用 view.ts 的 callPotPlayer:execFile(path, argvArray) 永不拼 shell 字符串,
// URL/路径作为独立 argv 元素 —— 既避免命令注入(嗅探/右键得到的 url 可能含攻击者可控字符),
// 也避免"浏览器进程派生 cmd.exe"启发式特征。迅雷走 thunder:// 系统协议。

export interface IDownloaderPreset {
  type: string;
  // 右键菜单与提示文案。
  name: string;
  // 为 true 时不走 execFile,改用系统协议(thunder://)唤起。
  usesProtocol?: boolean;
  // 用于从注册表自动发现可执行路径(按顺序尝试),为空表示不走注册表。
  registryKeys?: {key: string; valueName: string}[];
}

export const DOWNLOADER_PRESETS: Record<string, IDownloaderPreset> = {
  idm: {
    type: 'idm',
    name: 'IDM',
    registryKeys: [
      {key: 'HKCU\\Software\\DownloadManager', valueName: 'ExePath'},
      {key: 'HKLM\\SOFTWARE\\Internet Download Manager', valueName: 'ExePath'},
      {key: 'HKLM\\SOFTWARE\\WOW6432Node\\Internet Download Manager', valueName: 'ExePath'},
    ],
  },
  thunder: {
    type: 'thunder',
    // 显示名读取时按当前语言解析(不缓存翻译器);IDM/aria2 为品牌名无需翻译。
    get name() {
      return getMainTranslator(
        Application.instance.settings?.object?.language,
      )('dlThunder');
    },
    usesProtocol: true,
  },
  aria2: {
    type: 'aria2',
    name: 'aria2',
    // aria2 通常无注册表项,需用户在设置中手动指定路径。
  },
  custom: {
    type: 'custom',
    get name() {
      return getMainTranslator(
        Application.instance.settings?.object?.language,
      )('dlCustom');
    },
  },
};

export interface ILaunchOptions {
  type: string;
  // 用户在设置中配置的可执行路径;为空时尝试注册表自动发现(右键菜单场景)。
  customPath?: string;
  // 仅 custom 用:参数模板,占位符 {url} {path} {filename},按空白拆成 argv。
  customArgs?: string;
  url: string;
  // 下载目录。
  path?: string;
  // 文件名(will-download 自动接管时可提供;右键链接通常没有)。
  filename?: string;
}

export interface IAvailableDownloader {
  type: string;
  name: string;
  path?: string;
}

interface IConfiguredDownloader {
  downloaderType?: string;
  downloaderPath?: string;
}

// 构造各预置的 argv(除迅雷外)。
function buildArgv(opts: ILaunchOptions): string[] {
  const {type, url, path, filename, customArgs} = opts;
  if (type === 'idm') {
    // IDMan.exe /d URL [/p PATH] [/f FILENAME] /n
    // /n = 不显示"下载文件信息"对话框,直接加入队列。
    const argv = ['/d', url];
    if (path) argv.push('/p', path);
    if (filename) argv.push('/f', filename);
    argv.push('/n');
    return argv;
  }
  if (type === 'aria2') {
    // aria2c [-d PATH] [-o FILENAME] URL
    const argv: string[] = [];
    if (path) argv.push('-d', path);
    if (filename) argv.push('-o', filename);
    argv.push(url);
    return argv;
  }
  // custom:按空白拆模板,逐 token 替换占位符。
  // 占位符 {url}/{path}/{filename} 是单个 token,含空格的路径仍保持一个 argv 元素(安全)。
  const template = customArgs || '';
  const subst = (tok: string) =>
    tok
      .replace(/\{url\}/g, url)
      .replace(/\{path\}/g, path || '')
      .replace(/\{filename\}/g, filename || '');
  return template
    .split(/\s+/)
    .filter(Boolean)
    .map(subst)
    .filter(Boolean);
}

// 从注册表发现预置下载器的可执行路径(仿 view.ts getPotPlayerInstallPath)。
// 迅雷返回 ''(走协议);aria2/custom 无注册表项也返回 '';均不 reject。
export function discoverDownloaderPath(type: string): Promise<string> {
  const keys = DOWNLOADER_PRESETS[type]?.registryKeys ?? [];
  return new Promise((resolve) => {
    if (keys.length === 0) {
      resolve('');
      return;
    }
    let i = 0;
    const tryNext = () => {
      if (i >= keys.length) {
        resolve('');
        return;
      }
      const {key, valueName} = keys[i++];
      execFile('reg', ['query', key, '/v', valueName], (error, stdout) => {
        if (error || !stdout) {
          tryNext();
          return;
        }
        const re = new RegExp(`${valueName}\\s+REG_SZ\\s+(.+)`, 'i');
        const match = stdout.match(re);
        if (match && match[1]) {
          resolve(match[1].trim());
        } else {
          tryNext();
        }
      });
    };
    tryNext();
  });
}

function commandExists(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, args, (error) => resolve(!error));
  });
}

function discoverExecutable(command: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('where.exe', [command], (error, stdout) => {
      if (error || !stdout) {
        resolve('');
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) || '',
      );
    });
  });
}

// 下载确认弹窗只展示本机确实可调用的下载器。已配置路径优先；常见预置则
// 补充注册表/系统 PATH 检测，避免给用户一个点击后才发现未安装的选项。
export async function getAvailableDownloaders(
  configured: IConfiguredDownloader,
): Promise<IAvailableDownloader[]> {
  const configuredType = configured.downloaderType || '';
  const configuredPath = configured.downloaderPath || '';
  const pathFor = (type: string) =>
    configuredType === type && existsSync(configuredPath) ? configuredPath : '';

  const [idmDiscovered, thunderInstalled, ariaDiscovered] = await Promise.all([
    pathFor('idm') ? Promise.resolve('') : discoverDownloaderPath('idm'),
    commandExists('reg', [
      'query',
      'HKCR\\thunder\\shell\\open\\command',
      '/ve',
    ]),
    pathFor('aria2') ? Promise.resolve('') : discoverExecutable('aria2c.exe'),
  ]);

  const available: IAvailableDownloader[] = [];
  const idmPath = pathFor('idm') || idmDiscovered;
  if (idmPath && existsSync(idmPath)) {
    available.push({
      type: 'idm',
      name: DOWNLOADER_PRESETS.idm.name,
      path: idmPath,
    });
  }
  if (thunderInstalled) {
    available.push({type: 'thunder', name: DOWNLOADER_PRESETS.thunder.name});
  }

  const ariaPath = pathFor('aria2') || ariaDiscovered;
  if (ariaPath && existsSync(ariaPath)) {
    available.push({
      type: 'aria2',
      name: DOWNLOADER_PRESETS.aria2.name,
      path: ariaPath,
    });
  }

  const customPath = pathFor('custom');
  if (customPath) {
    available.push({
      type: 'custom',
      name: DOWNLOADER_PRESETS.custom.name,
      path: customPath,
    });
  }

  return available;
}

// 同步预判能否接管下载。用于 will-download 中决定是否同步 preventDefault:
// preventDefault 必须在事件处理函数同步段内调用(await 之后无效),故自动接管时
// 不在此处做注册表查询(慢/异步),要求路径已配置且存在;迅雷走协议默认可唤起。
export function canHandoffDownload(
  type: string,
  configuredPath: string,
): boolean {
  if (DOWNLOADER_PRESETS[type]?.usesProtocol) return true;
  return !!configuredPath && existsSync(configuredPath);
}

// 唤起外部下载器。返回是否成功发起(右键菜单场景用于提示;自动接管场景应在调用前
// 已用 canHandoffDownload 同步预判并 preventDefault)。
export async function launchExternalDownload(
  opts: ILaunchOptions,
): Promise<boolean> {
  const t = getMainTranslator(Application.instance.settings?.object?.language);
  const preset = DOWNLOADER_PRESETS[opts.type];
  const name = preset?.name ?? t('dlpExternalDownloader');

  // 迅雷:走 thunder:// 协议。负载 = base64("AA" + url + "ZZ")(标准迅雷协议)。
  if (preset?.usesProtocol) {
    const payload = Buffer.from(`AA${opts.url}ZZ`).toString('base64');
    try {
      await shell.openExternal(`thunder://${payload}`);
      console.log(`${name}已唤起`);
      return true;
    } catch (e) {
      console.error(`唤起${name}失败:`, e);
      dialog.showMessageBox({
        type: 'warning',
        title: t('dialogHintTitle'),
        message: t('xdLaunchFailed', {name}),
        buttons: [t('confirm')],
      });
      return false;
    }
  }

  // 解析路径:用户配置优先,否则注册表自动发现。
  let path = opts.customPath || '';
  if (!path) {
    path = await discoverDownloaderPath(opts.type);
  }
  if (!path || !existsSync(path)) {
    dialog.showMessageBox({
      type: 'warning',
      title: t('dialogHintTitle'),
      message: t('xdPathNotFound', {name}),
      buttons: [t('confirm')],
    });
    return false;
  }

  const argv = buildArgv(opts);
  if (argv.length === 0) {
    console.warn(`${name}:参数为空,跳过启动`);
    return false;
  }

  execFile(path, argv, (error, _stdout, stderr) => {
    if (error) {
      console.error(`调用${name}失败: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`${name}输出错误: ${stderr}`);
      return;
    }
    console.log(`${name}已启动`);
  });
  return true;
}
