import { join } from 'path';
import { Worker } from 'worker_threads';

interface DatabaseResponse {
  id: number;
  result?: unknown;
  error?: string;
}

export class DatabaseWorker {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (result: any) => void;
      reject: (error: Error) => void;
    }
  >();

  public constructor(private filename: string) {}

  public request<T>(
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, operation, ...payload });
    });
  }

  private ensureWorker() {
    if (this.worker) return this.worker;

    const worker = new Worker(join(__dirname, 'database-worker.bundle.js'), {
      workerData: { filename: this.filename },
    });
    worker.unref();
    worker.on('message', (message: DatabaseResponse) => {
      const task = this.pending.get(Number(message?.id));
      if (!task) return;
      this.pending.delete(Number(message.id));
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    });
    worker.on('error', (error) => this.handleFailure(worker, error));
    worker.on('exit', (code) => {
      this.handleFailure(
        worker,
        new Error(`database worker exited with code ${code}`),
      );
    });
    this.worker = worker;
    return worker;
  }

  private handleFailure(worker: Worker, error: Error) {
    if (this.worker !== worker) return;
    this.worker = null;
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }
}
