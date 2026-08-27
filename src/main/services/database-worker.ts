import '../util-compat';
import * as Datastore from 'nedb';
import { parentPort, workerData } from 'worker_threads';

interface DatabaseRequest {
  id: number;
  operation:
    | 'find'
    | 'findOne'
    | 'insert'
    | 'insertMany'
    | 'remove'
    | 'update'
    | 'updateMany';
  query?: Record<string, unknown>;
  item?: unknown;
  items?: unknown[];
  value?: Record<string, unknown>;
  multi?: boolean;
  updates?: Array<{
    query: Record<string, unknown>;
    value: Record<string, unknown>;
    multi?: boolean;
  }>;
}

const database = new Datastore({
  filename: String(workerData.filename),
  autoload: false,
});

const ready = new Promise<void>((resolve, reject) => {
  database.loadDatabase((error) => (error ? reject(error) : resolve()));
});

const execute = async (message: DatabaseRequest) => {
  await ready;
  return new Promise<unknown>((resolve, reject) => {
    const callback = (error: Error | null, result: unknown) => {
      if (error) reject(error);
      else resolve(result);
    };

    switch (message.operation) {
      case 'find':
        database.find(message.query || {}, callback);
        break;
      case 'findOne':
        database.findOne(message.query || {}, callback);
        break;
      case 'insert':
        database.insert(message.item, callback);
        break;
      case 'insertMany':
        database.insert(message.items || [], callback);
        break;
      case 'remove':
        database.remove(
          message.query || {},
          { multi: message.multi },
          callback,
        );
        break;
      case 'update': {
        const { _id, ...setValue } = message.value || {};
        database.update(
          message.query || {},
          { $set: setValue },
          { multi: message.multi },
          callback,
        );
        break;
      }
      case 'updateMany': {
        const updates = message.updates || [];
        let index = 0;
        let changed = 0;
        const updateNext = () => {
          if (index >= updates.length) {
            resolve(changed);
            return;
          }
          const update = updates[index++];
          const { _id, ...setValue } = update.value || {};
          database.update(
            update.query || {},
            { $set: setValue },
            { multi: update.multi },
            (error, replaced) => {
              if (error) {
                reject(error);
                return;
              }
              changed += replaced || 0;
              updateNext();
            },
          );
        };
        updateNext();
        break;
      }
      default:
        reject(
          new Error(`unsupported database operation: ${message.operation}`),
        );
    }
  });
};

let requestQueue = Promise.resolve();

parentPort?.on('message', (message: DatabaseRequest) => {
  requestQueue = requestQueue.then(async () => {
    try {
      const result = await execute(message);
      parentPort?.postMessage({ id: message.id, result });
    } catch (error) {
      parentPort?.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});
