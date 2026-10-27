import { ipcRenderer } from 'electron';
import { action, makeObservable, observable } from 'mobx';
import { IDownloadItem } from '~/interfaces';
import { DialogStore } from '~/models/dialog-store';

export class Store extends DialogStore {
  public downloads: IDownloadItem[] = [];

  public maxHeight = 0;

  public constructor() {
    super();

    makeObservable(this, { downloads: observable, maxHeight: observable });

    this.init();

    ipcRenderer.on('download-started', (e, item) => {
      this.downloads.push(item);
    });

    ipcRenderer.on('download-progress', (e, item: IDownloadItem) => {
      const index = this.downloads.findIndex((x) => x.id === item.id);
      if (index === -1) return;

      // 完成/取消是终态。旧的进度事件可能在 IPC 队列中晚于终态事件到达，
      // 不能让它把已完成任务重新显示成暂停或下载中。
      if (this.isTerminal(this.downloads[index])) {
        // 失败终态例外:手动/自动重试恢复传输时,主进程会先清除 failed 再推送
        // 进行中进度,据此解除失败态;仍是中断/暂停的旧事件不解除。
        if (
          !this.downloads[index].failed ||
          item.paused ||
          item.interrupted ||
          item.retrying
        ) {
          return;
        }
        this.downloads[index] = {
          ...this.downloads[index],
          failed: false,
          failReason: undefined,
        };
      }

      this.downloads[index] = {
        ...this.downloads[index],
        ...item,
      };
    });

    ipcRenderer.on('download-completed', (e, id: string) => {
      const index = this.downloads.findIndex((x) => x.id === id);
      if (index === -1) return;
      this.downloads[index] = {
        ...this.downloads[index],
        completed: true,
        canceled: false,
        paused: false,
        interrupted: false,
        retrying: false,
        speedBytesPerSecond: 0,
      };
    });

    ipcRenderer.on('download-paused', (e, id: string) => {
      const i = this.downloads.find((x) => x.id === id);
      if (!i || this.isTerminal(i)) return;
      i.paused = true;
    });

    ipcRenderer.on('download-canceled', (e, id: string) => {
      const i = this.downloads.find((x) => x.id === id);
      if (!i) return;
      i.completed = false;
      i.canceled = true;
    });

    // 自动重试耗尽,主进程已收敛为失败终态(仍可手动重试)。
    ipcRenderer.on('download-failed', (e, id: string, reason?: IDownloadItem['failReason']) => {
      const index = this.downloads.findIndex((x) => x.id === id);
      if (index === -1) return;
      this.downloads[index] = {
        ...this.downloads[index],
        failed: true,
        failReason: reason,
        paused: false,
        interrupted: true,
        retrying: false,
        speedBytesPerSecond: 0,
      };
    });

    ipcRenderer.on('download-removed', (e, id: string) => {
      this.downloads = this.downloads.filter((x) => x.id !== id);
    });

    ipcRenderer.on(
      'download-open-when-done-change',
      (e, item: IDownloadItem) => {
        const index = this.downloads.findIndex((x) => x.id === item.id);
        if (index === -1) return;
        this.downloads[index].openWhenDone = item.openWhenDone;
      },
    );

    // 主进程子线程校验出的「文件已不存在」集合(全量下发)。
    ipcRenderer.on('download-file-missing-change', (e, ids: string[]) => {
      this.applyFileMissing(ids);
    });

    // 弹窗打开即校验一次;停留期间低频复查,用户在资源管理器里删文件也能及时反映。
    ipcRenderer.send('download-check-files');
    setInterval(() => ipcRenderer.send('download-check-files'), 5000);

    ipcRenderer.on('max-height', (e, height) => {
      this.maxHeight = height;
    });
  }

  public async init() {
    const snapshot: IDownloadItem[] = await ipcRenderer.invoke('get-downloads');
    if (!Array.isArray(snapshot)) return;

    // init 与 IPC 推送并行：实时事件的顺序优先，快照只补充尚未收到事件的记录。
    // 否则快照重排会让刚创建的下载在弹窗倒序显示时落到本批任务末尾。
    const snapshotById = new Map(snapshot.map((item) => [item.id, item]));
    const currentIds = new Set<IDownloadItem['id']>();
    const merged = this.downloads.map((current) => {
      currentIds.add(current.id);
      const latest = snapshotById.get(current.id);
      // 实时状态优先；快照仅补齐事件未携带的字段。
      return latest ? {...latest, ...current} : current;
    });

    for (const item of snapshot) {
      if (!currentIds.has(item.id)) merged.push(item);
    }
    this.downloads = merged;
  }

  @action
  private applyFileMissing(ids: string[]) {
    const missing = new Set(ids || []);
    this.downloads = this.downloads.map((item) => {
      const next = !!item.completed && missing.has(item.id);
      return !!item.fileMissing === next ? item : {...item, fileMissing: next};
    });
  }

  private isTerminal(item: IDownloadItem): boolean {
    return !!item.completed || !!item.canceled || !!item.failed;
  }

  // 清空已结束的下载记录，保留仍在进行中的任务（与 Chrome 下载列表一致）。
  @action
  public async clearFinished() {
    const hasFinished = this.downloads.some((item) => this.isTerminal(item));
    if (!hasFinished) return;

    // 先更新弹窗，避免等待主进程清理时界面短暂显示旧记录。
    this.downloads = this.downloads.filter((item) => !this.isTerminal(item));
    try {
      await ipcRenderer.invoke('download-clear-history');
    } catch {
      // 主进程失败时重新读取，避免本地列表与实际记录不一致。
      await this.init();
    }
  }
}

export default new Store();
