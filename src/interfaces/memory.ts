export type MemoryProcessCategory =
  | 'browser'
  | 'tab'
  | 'extension'
  | 'gpu'
  | 'utility'
  | 'other';

export interface IMemoryTabReference {
  id: number;
  title: string;
  url: string;
  selected: boolean;
}

export interface IMemoryProcessItem {
  pid: number;
  type: string;
  typeLabel: string;
  category: MemoryProcessCategory;
  name: string;
  description: string;
  serviceName: string;
  memoryBytes: number;
  privateBytes: number;
  cpuPercent: number;
  tabs: IMemoryTabReference[];
  contentLabels: string[];
}

export interface IMemorySnapshot {
  timestamp: number;
  totalBytes: number;
  totalPrivateBytes: number;
  processCount: number;
  tabProcessCount: number;
  tabCount: number;
  processes: IMemoryProcessItem[];
}

export interface ITabMemorySnapshot {
  available: boolean;
  pid: number;
  memoryBytes: number;
  privateBytes: number;
  sharedTabCount: number;
}
