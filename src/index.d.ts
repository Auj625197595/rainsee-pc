declare module '*.svg';
declare module '*.png';
declare module '*.woff2';

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: {readOnly?: boolean});
    prepare(sql: string): any;
    close(): void;
  }
}
