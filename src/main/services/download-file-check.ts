import { join } from 'path';
import { Worker } from 'worker_threads';

interface CheckResponse {
  id: number;
  missing?: string[];
  error?: string;
}

// 已完成下载的文件存在性校验:实际 stat 在 download-file-check-worker 子线程执行。
// 子线程空闲时 unref,不阻止应用退出;崩溃后下次调用自动重建。
export class DownloadFileChecker {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (missing: string[]) => void; reject: (error: Error) => void }
  >();

  // 返回不存在(或不是普通文件)的下载 id 列表。
  public check(entries: { id: string; path: string }[]): Promise<string[]> {
    if (entries.length === 0) return Promise.resolve([]);
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise<string[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, entries });
    });
  }

  private ensureWorker() {
    if (this.worker) return this.worker;

    const worker = new Worker(
      join(__dirname, 'download-file-check-worker.bundle.js'),
    );
    worker.unref();
    worker.on('message', (message: CheckResponse) => {
      const task = this.pending.get(Number(message?.id));
      if (!task) return;
      this.pending.delete(Number(message.id));
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.missing || []);
    });
    worker.on('error', (error) => this.handleFailure(worker, error));
    worker.on('exit', (code) => {
      this.handleFailure(
        worker,
        new Error(`download file check worker exited with code ${code}`),
      );
    });
    this.worker = worker;
    return worker;
  }

  private handleFailure(worker: Worker, error: Error) {
    if (this.worker !== worker) return;
    this.worker = null;
    const tasks = [...this.pending.values()];
    this.pending.clear();
    tasks.forEach((task) => task.reject(error));
  }
}
