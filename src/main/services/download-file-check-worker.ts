import { parentPort } from 'worker_threads';
import { statSync } from 'fs';

// 下载文件存在性校验子线程:批量 stat 已完成下载的保存路径,
// 避免记录多/文件位于网络盘或休眠移动硬盘时阻塞主进程事件循环。

interface WorkerRequest {
  id: number;
  entries: { id: string; path: string }[];
}

parentPort?.on('message', (message: WorkerRequest) => {
  const missing: string[] = [];
  try {
    for (const entry of message.entries || []) {
      let exists = false;
      try {
        exists = statSync(entry.path).isFile();
      } catch {
        exists = false;
      }
      if (!exists) missing.push(entry.id);
    }
    parentPort?.postMessage({ id: message.id, missing });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: String(error) });
  }
});
