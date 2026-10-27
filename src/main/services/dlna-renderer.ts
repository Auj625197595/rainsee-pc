import {app} from 'electron';
import {EventEmitter} from 'events';
import {randomBytes} from 'crypto';
import * as dgram from 'dgram';
import {existsSync, readFileSync, writeFileSync} from 'fs';
import * as http from 'http';
import {AddressInfo, Socket} from 'net';
import {networkInterfaces} from 'os';
import {join} from 'path';

// 超级投屏：DLNA/UPnP MediaRenderer 接收端(零依赖，Node dgram + http)。
// SSDP 负责让局域网控制端(手机视频 App、BubbleUPnP 等)发现本机；HTTP 提供设备描述、
// SCPD、SOAP 控制(AVTransport/RenderingControl/ConnectionManager)与 GENA 事件订阅。
// 真正的播放由智能播放器页面完成：控制命令经 'command' 事件交给播放器窗口，页面再把
// 播放状态回报给 updatePlayback，供 GetPositionInfo 等同步查询与事件推送。

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const PREFERRED_HTTP_PORT = 49352;
const ALIVE_INTERVAL_MS = 30 * 1000;
const MAX_AGE = 1800;
const MAX_BODY_BYTES = 256 * 1024;
const SERVER_HEADER = 'Windows/10.0 UPnP/1.0 RainseeCast/1.0';

const DEVICE_TYPE = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const RCS = 'urn:schemas-upnp-org:service:RenderingControl:1';
const CMS = 'urn:schemas-upnp-org:service:ConnectionManager:1';

type ServiceKey = 'AVTransport' | 'RenderingControl' | 'ConnectionManager';

const SERVICES: Record<ServiceKey, {type: string; id: string}> = {
  AVTransport: {type: AVT, id: 'urn:upnp-org:serviceId:AVTransport'},
  RenderingControl: {type: RCS, id: 'urn:upnp-org:serviceId:RenderingControl'},
  ConnectionManager: {type: CMS, id: 'urn:upnp-org:serviceId:ConnectionManager'},
};

const SINK_PROTOCOL_INFO = [
  'http-get:*:video/mp4:*',
  'http-get:*:video/x-mp4:*',
  'http-get:*:video/mpeg:*',
  'http-get:*:video/webm:*',
  'http-get:*:video/quicktime:*',
  'http-get:*:video/x-matroska:*',
  'http-get:*:video/x-flv:*',
  'http-get:*:video/mp2t:*',
  'http-get:*:video/MP2T:*',
  'http-get:*:video/x-ms-wmv:*',
  'http-get:*:video/*:*',
  'http-get:*:application/vnd.apple.mpegurl:*',
  'http-get:*:application/x-mpegurl:*',
  'http-get:*:audio/mpeg:*',
  'http-get:*:audio/mp4:*',
  'http-get:*:audio/aac:*',
  'http-get:*:audio/*:*',
  'http-get:*:*:*',
].join(',');

export type DlnaTransportState =
  | 'NO_MEDIA_PRESENT'
  | 'STOPPED'
  | 'PLAYING'
  | 'PAUSED_PLAYBACK'
  | 'TRANSITIONING';

export type DlnaCommand =
  | {type: 'load'; url: string; title: string; mimeType: string}
  | {type: 'play'}
  | {type: 'pause'}
  | {type: 'stop'}
  | {type: 'seek'; seconds: number}
  | {type: 'volume'; volume: number}
  | {type: 'mute'; muted: boolean};

export interface DlnaPlaybackReport {
  url?: string;
  state?: DlnaTransportState;
  position?: number;
  duration?: number;
  volume?: number;
  muted?: boolean;
}

export interface DlnaInfo {
  running: boolean;
  name: string;
  addresses: string[];
  port: number;
}

interface Subscription {
  sid: string;
  service: ServiceKey;
  callback: string;
  expiresAt: number;
  seq: number;
}

class UpnpError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

// ---------- XML 工具 ----------

const escapeXml = (value: unknown) =>
  String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const unescapeXml = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

// 读取 SOAP 参数(忽略命名空间前缀)，支持 CDATA 与自闭合空值。
const readArg = (body: string, name: string): string => {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`);
  const match = body.match(re);
  if (!match || match[1] === undefined) return '';
  const raw = match[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : unescapeXml(raw);
};

const formatTime = (seconds: number) => {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

const parseTime = (value: string): number => {
  const text = (value || '').trim();
  if (!text) return NaN;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

const metadataTitle = (metadata: string) => {
  const match = (metadata || '').match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  return match ? unescapeXml(match[1]).trim() : '';
};

const metadataMime = (metadata: string) => {
  const match = (metadata || '').match(/protocolInfo="[^:"]*:[^:"]*:([^:"]+):/i);
  return match ? match[1] : '';
};

// ---------- SCPD ----------

type ArgDef = [string, 'in' | 'out', string];
type VarDef = [string, string, boolean, string[]?];

const buildScpd = (actions: Record<string, ArgDef[]>, vars: VarDef[]) => {
  const actionXml = Object.entries(actions).map(([name, args]) =>
    `<action><name>${name}</name><argumentList>${args.map(([argName, dir, rel]) =>
      `<argument><name>${argName}</name><direction>${dir}</direction><relatedStateVariable>${rel}</relatedStateVariable></argument>`,
    ).join('')}</argumentList></action>`,
  ).join('');
  const varXml = vars.map(([name, type, events, allowed]) =>
    `<stateVariable sendEvents="${events ? 'yes' : 'no'}"><name>${name}</name><dataType>${type}</dataType>${
      allowed ? `<allowedValueList>${allowed.map((v) => `<allowedValue>${v}</allowedValue>`).join('')}</allowedValueList>` : ''
    }</stateVariable>`,
  ).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList>${actionXml}</actionList><serviceStateTable>${varXml}</serviceStateTable></scpd>`;
};

const IID: ArgDef = ['InstanceID', 'in', 'A_ARG_TYPE_InstanceID'];

const AVT_SCPD = buildScpd({
  SetAVTransportURI: [IID, ['CurrentURI', 'in', 'AVTransportURI'], ['CurrentURIMetaData', 'in', 'AVTransportURIMetaData']],
  SetNextAVTransportURI: [IID, ['NextURI', 'in', 'NextAVTransportURI'], ['NextURIMetaData', 'in', 'NextAVTransportURIMetaData']],
  GetMediaInfo: [IID,
    ['NrTracks', 'out', 'NumberOfTracks'], ['MediaDuration', 'out', 'CurrentMediaDuration'],
    ['CurrentURI', 'out', 'AVTransportURI'], ['CurrentURIMetaData', 'out', 'AVTransportURIMetaData'],
    ['NextURI', 'out', 'NextAVTransportURI'], ['NextURIMetaData', 'out', 'NextAVTransportURIMetaData'],
    ['PlayMedium', 'out', 'PlaybackStorageMedium'], ['RecordMedium', 'out', 'RecordStorageMedium'],
    ['WriteStatus', 'out', 'RecordMediumWriteStatus']],
  GetTransportInfo: [IID,
    ['CurrentTransportState', 'out', 'TransportState'], ['CurrentTransportStatus', 'out', 'TransportStatus'],
    ['CurrentSpeed', 'out', 'TransportPlaySpeed']],
  GetPositionInfo: [IID,
    ['Track', 'out', 'CurrentTrack'], ['TrackDuration', 'out', 'CurrentTrackDuration'],
    ['TrackMetaData', 'out', 'CurrentTrackMetaData'], ['TrackURI', 'out', 'CurrentTrackURI'],
    ['RelTime', 'out', 'RelativeTimePosition'], ['AbsTime', 'out', 'AbsoluteTimePosition'],
    ['RelCount', 'out', 'RelativeCounterPosition'], ['AbsCount', 'out', 'AbsoluteCounterPosition']],
  GetDeviceCapabilities: [IID,
    ['PlayMedia', 'out', 'PossiblePlaybackStorageMedia'], ['RecMedia', 'out', 'PossibleRecordStorageMedia'],
    ['RecQualityModes', 'out', 'PossibleRecordQualityModes']],
  GetTransportSettings: [IID, ['PlayMode', 'out', 'CurrentPlayMode'], ['RecQualityMode', 'out', 'CurrentRecordQualityMode']],
  GetCurrentTransportActions: [IID, ['Actions', 'out', 'CurrentTransportActions']],
  Stop: [IID],
  Play: [IID, ['Speed', 'in', 'TransportPlaySpeed']],
  Pause: [IID],
  Seek: [IID, ['Unit', 'in', 'A_ARG_TYPE_SeekMode'], ['Target', 'in', 'A_ARG_TYPE_SeekTarget']],
  Next: [IID],
  Previous: [IID],
}, [
  ['TransportState', 'string', false, ['STOPPED', 'PLAYING', 'PAUSED_PLAYBACK', 'TRANSITIONING', 'NO_MEDIA_PRESENT']],
  ['TransportStatus', 'string', false, ['OK', 'ERROR_OCCURRED']],
  ['PlaybackStorageMedium', 'string', false, ['NONE', 'NETWORK']],
  ['RecordStorageMedium', 'string', false, ['NOT_IMPLEMENTED']],
  ['PossiblePlaybackStorageMedia', 'string', false],
  ['PossibleRecordStorageMedia', 'string', false],
  ['CurrentPlayMode', 'string', false, ['NORMAL']],
  ['TransportPlaySpeed', 'string', false, ['1']],
  ['RecordMediumWriteStatus', 'string', false, ['NOT_IMPLEMENTED']],
  ['CurrentRecordQualityMode', 'string', false, ['NOT_IMPLEMENTED']],
  ['PossibleRecordQualityModes', 'string', false],
  ['NumberOfTracks', 'ui4', false],
  ['CurrentTrack', 'ui4', false],
  ['CurrentTrackDuration', 'string', false],
  ['CurrentMediaDuration', 'string', false],
  ['CurrentTrackMetaData', 'string', false],
  ['CurrentTrackURI', 'string', false],
  ['AVTransportURI', 'string', false],
  ['AVTransportURIMetaData', 'string', false],
  ['NextAVTransportURI', 'string', false],
  ['NextAVTransportURIMetaData', 'string', false],
  ['RelativeTimePosition', 'string', false],
  ['AbsoluteTimePosition', 'string', false],
  ['RelativeCounterPosition', 'i4', false],
  ['AbsoluteCounterPosition', 'i4', false],
  ['CurrentTransportActions', 'string', false],
  ['LastChange', 'string', true],
  ['A_ARG_TYPE_SeekMode', 'string', false, ['REL_TIME', 'ABS_TIME', 'TRACK_NR']],
  ['A_ARG_TYPE_SeekTarget', 'string', false],
  ['A_ARG_TYPE_InstanceID', 'ui4', false],
]);

const CHANNEL: ArgDef = ['Channel', 'in', 'A_ARG_TYPE_Channel'];

const RCS_SCPD = buildScpd({
  ListPresets: [IID, ['CurrentPresetNameList', 'out', 'PresetNameList']],
  SelectPreset: [IID, ['PresetName', 'in', 'A_ARG_TYPE_PresetName']],
  GetVolume: [IID, CHANNEL, ['CurrentVolume', 'out', 'Volume']],
  SetVolume: [IID, CHANNEL, ['DesiredVolume', 'in', 'Volume']],
  GetMute: [IID, CHANNEL, ['CurrentMute', 'out', 'Mute']],
  SetMute: [IID, CHANNEL, ['DesiredMute', 'in', 'Mute']],
}, [
  ['PresetNameList', 'string', false],
  ['Volume', 'ui2', false],
  ['Mute', 'boolean', false],
  ['LastChange', 'string', true],
  ['A_ARG_TYPE_Channel', 'string', false, ['Master']],
  ['A_ARG_TYPE_InstanceID', 'ui4', false],
  ['A_ARG_TYPE_PresetName', 'string', false, ['FactoryDefaults']],
]);

const CMS_SCPD = buildScpd({
  GetProtocolInfo: [['Source', 'out', 'SourceProtocolInfo'], ['Sink', 'out', 'SinkProtocolInfo']],
  GetCurrentConnectionIDs: [['ConnectionIDs', 'out', 'CurrentConnectionIDs']],
  GetCurrentConnectionInfo: [['ConnectionID', 'in', 'A_ARG_TYPE_ConnectionID'],
    ['RcsID', 'out', 'A_ARG_TYPE_RcsID'], ['AVTransportID', 'out', 'A_ARG_TYPE_AVTransportID'],
    ['ProtocolInfo', 'out', 'A_ARG_TYPE_ProtocolInfo'], ['PeerConnectionManager', 'out', 'A_ARG_TYPE_ConnectionManager'],
    ['PeerConnectionID', 'out', 'A_ARG_TYPE_ConnectionID'], ['Direction', 'out', 'A_ARG_TYPE_Direction'],
    ['Status', 'out', 'A_ARG_TYPE_ConnectionStatus']],
}, [
  ['SourceProtocolInfo', 'string', true],
  ['SinkProtocolInfo', 'string', true],
  ['CurrentConnectionIDs', 'string', true],
  ['A_ARG_TYPE_ConnectionStatus', 'string', false, ['OK', 'ContentFormatMismatch', 'InsufficientBandwidth', 'UnreliableChannel', 'Unknown']],
  ['A_ARG_TYPE_ConnectionManager', 'string', false],
  ['A_ARG_TYPE_Direction', 'string', false, ['Input', 'Output']],
  ['A_ARG_TYPE_ProtocolInfo', 'string', false],
  ['A_ARG_TYPE_ConnectionID', 'i4', false],
  ['A_ARG_TYPE_AVTransportID', 'i4', false],
  ['A_ARG_TYPE_RcsID', 'i4', false],
]);

const SCPD: Record<string, string> = {
  '/AVTransport.xml': AVT_SCPD,
  '/RenderingControl.xml': RCS_SCPD,
  '/ConnectionManager.xml': CMS_SCPD,
};

// ---------- 网卡 ----------

interface LocalInterface {
  name: string;
  address: string;
  netmask: string;
}

const VIRTUAL_ADAPTER_RE = /vmware|virtual|vethernet|vbox|hyper-v|wsl|docker|loopback|tap|tun|zerotier|tailscale|npcap/i;

const listInterfaces = (): LocalInterface[] => {
  const result: LocalInterface[] = [];
  const all = networkInterfaces();
  for (const name of Object.keys(all)) {
    for (const info of all[name] || []) {
      // Node 18 起 family 可能是数字 4。
      const family = String((info as any).family);
      if ((family !== 'IPv4' && family !== '4') || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      result.push({name, address: info.address, netmask: info.netmask});
    }
  }
  // 物理网卡排前，展示给用户的首个地址更可能是手机所在网段。
  return result.sort((a, b) =>
    Number(VIRTUAL_ADAPTER_RE.test(a.name)) - Number(VIRTUAL_ADAPTER_RE.test(b.name)));
};

const ipToInt = (ip: string) =>
  ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);

const sameSubnet = (a: string, b: string, mask: string) => {
  try {
    const m = ipToInt(mask);
    return (ipToInt(a) & m) === (ipToInt(b) & m);
  } catch (e) {
    return false;
  }
};

const normalizeRemote = (address: string | undefined) =>
  (address || '').replace(/^::ffff:/i, '');

const generateUuid = () => {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// 设备 UUID 持久化：控制端按 UDN 记忆设备，每次启动换 UUID 会出现重复设备。
const loadDeviceUuid = () => {
  const file = join(app.getPath('userData'), 'dlna-device.json');
  try {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data && typeof data.uuid === 'string' && /^[0-9a-f-]{36}$/i.test(data.uuid)) return data.uuid;
    }
  } catch (e) {
  }
  const uuid = generateUuid();
  try {
    writeFileSync(file, JSON.stringify({uuid}), 'utf8');
  } catch (e) {
    console.log('[dlna] failed to persist device uuid', e);
  }
  return uuid;
};

// ---------- 渲染器 ----------

class DlnaRenderer extends EventEmitter {
  private running = false;
  private starting: Promise<void> | null = null;
  private uuid = '';
  private friendlyName = '';
  private httpServer: http.Server | null = null;
  private httpSockets = new Set<Socket>();
  private port = 0;
  private ssdpSocket: dgram.Socket | null = null;
  private senders = new Map<string, dgram.Socket>();
  private memberships = new Set<string>();
  private interfaces: LocalInterface[] = [];
  private aliveTimer: NodeJS.Timeout | null = null;
  private subscriptions = new Map<string, Subscription>();
  private eventTimers = new Map<ServiceKey, NodeJS.Timeout>();

  // 传输状态
  private transportState: DlnaTransportState = 'NO_MEDIA_PRESENT';
  private currentUri = '';
  private currentMetadata = '';
  private position = 0;
  private duration = 0;
  private volume = 100;
  private muted = false;

  isRunning() {
    return this.running;
  }

  getInfo(): DlnaInfo {
    return {
      running: this.running,
      name: this.friendlyName,
      addresses: this.interfaces.map((i) => i.address),
      port: this.port,
    };
  }

  async start(friendlyName: string): Promise<void> {
    this.friendlyName = friendlyName;
    if (this.running) return;
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart() {
    this.uuid = this.uuid || loadDeviceUuid();
    this.interfaces = listInterfaces();
    if (!this.interfaces.length) {
      throw new Error('未检测到可用的局域网连接，请先连接 Wi-Fi 或网线');
    }

    const server = http.createServer((req, res) => this.handleHttp(req, res));
    server.on('connection', (socket) => {
      this.httpSockets.add(socket);
      socket.on('close', () => this.httpSockets.delete(socket));
    });
    server.on('error', (e) => console.log('[dlna] http error', e));
    this.port = await listenWithFallback(server, PREFERRED_HTTP_PORT);
    this.httpServer = server;

    const ssdp = dgram.createSocket({type: 'udp4', reuseAddr: true});
    ssdp.on('message', (msg, rinfo) => this.handleSsdp(msg, rinfo));
    ssdp.on('error', (e) => console.log('[dlna] ssdp error', e));
    try {
      await new Promise<void>((resolve, reject) => {
        ssdp.once('error', reject);
        ssdp.bind(SSDP_PORT, () => {
          ssdp.removeListener('error', reject);
          resolve();
        });
      });
    } catch (e) {
      try {
        ssdp.close();
      } catch (err) {
      }
      await this.closeHttp();
      throw new Error(`投屏发现端口 ${SSDP_PORT} 被占用：${(e as any)?.message || e}`);
    }
    this.ssdpSocket = ssdp;
    try {
      ssdp.setMulticastTTL(4);
    } catch (e) {
    }

    this.running = true;
    this.syncInterfaces();
    this.sendAlive();
    // 规范建议 alive 重复发送，防止 UDP 丢包。
    setTimeout(() => this.running && this.sendAlive(), 1000);
    this.aliveTimer = setInterval(() => {
      this.syncInterfaces();
      this.sendAlive();
      this.pruneSubscriptions();
    }, ALIVE_INTERVAL_MS);
    console.log('[dlna] started', this.friendlyName, this.interfaces.map((i) => `${i.name}=${i.address}`).join(','), 'port', this.port);
  }

  async stop(): Promise<void> {
    if (this.starting) {
      try {
        await this.starting;
      } catch (e) {
      }
    }
    if (!this.running) return;
    this.running = false;
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    this.aliveTimer = null;
    for (const timer of this.eventTimers.values()) clearTimeout(timer);
    this.eventTimers.clear();

    await this.sendByeBye();
    for (const socket of this.senders.values()) {
      try {
        socket.close();
      } catch (e) {
      }
    }
    this.senders.clear();
    if (this.ssdpSocket) {
      try {
        this.ssdpSocket.close();
      } catch (e) {
      }
    }
    this.ssdpSocket = null;
    this.memberships.clear();
    await this.closeHttp();
    this.subscriptions.clear();
    this.transportState = 'NO_MEDIA_PRESENT';
    this.currentUri = '';
    this.currentMetadata = '';
    this.position = 0;
    this.duration = 0;
    console.log('[dlna] stopped');
  }

  // 页面回报真实播放状态。url 不一致(旧视频的迟到回报)直接忽略。
  updatePlayback(report: DlnaPlaybackReport) {
    if (!this.running || !report) return;
    if (report.url && this.currentUri && report.url !== this.currentUri) return;
    let avtChanged = false;
    let rcsChanged = false;
    if (report.state && report.state !== this.transportState && this.currentUri) {
      this.transportState = report.state;
      avtChanged = true;
    }
    if (Number.isFinite(report.position)) this.position = Math.max(0, report.position as number);
    if (Number.isFinite(report.duration) && Math.floor(report.duration as number) !== Math.floor(this.duration)) {
      this.duration = Math.max(0, report.duration as number);
      avtChanged = true;
    }
    if (Number.isFinite(report.volume)) {
      const volume = Math.max(0, Math.min(100, Math.round(report.volume as number)));
      if (volume !== this.volume) {
        this.volume = volume;
        rcsChanged = true;
      }
    }
    if (typeof report.muted === 'boolean' && report.muted !== this.muted) {
      this.muted = report.muted;
      rcsChanged = true;
    }
    if (avtChanged) this.scheduleEvent('AVTransport');
    if (rcsChanged) this.scheduleEvent('RenderingControl');
  }

  // ---------- SSDP ----------

  private syncInterfaces() {
    const next = listInterfaces();
    if (next.length) this.interfaces = next;
    const addresses = new Set(next.map((i) => i.address));

    for (const [address, socket] of this.senders) {
      if (addresses.has(address)) continue;
      try {
        socket.close();
      } catch (e) {
      }
      this.senders.delete(address);
      this.memberships.delete(address);
    }

    for (const iface of next) {
      if (this.ssdpSocket && !this.memberships.has(iface.address)) {
        try {
          this.ssdpSocket.addMembership(SSDP_ADDRESS, iface.address);
          this.memberships.add(iface.address);
        } catch (e) {
          console.log('[dlna] addMembership failed', iface.address, (e as any)?.message || e);
        }
      }
      if (!this.senders.has(iface.address)) {
        // 每块网卡一个发送 socket，确保组播从对应网卡发出且 LOCATION 与之匹配。
        const sender = dgram.createSocket({type: 'udp4', reuseAddr: true});
        sender.on('error', (e) => console.log('[dlna] sender error', iface.address, (e as any)?.message || e));
        try {
          sender.bind({address: iface.address, port: 0}, () => {
            try {
              sender.setMulticastTTL(4);
              sender.setMulticastInterface(iface.address);
            } catch (e) {
            }
          });
          this.senders.set(iface.address, sender);
        } catch (e) {
          console.log('[dlna] sender bind failed', iface.address, e);
        }
      }
    }
  }

  private location(address: string) {
    return `http://${address}:${this.port}/description.xml`;
  }

  private notificationTargets(): Array<[string, string]> {
    const udn = `uuid:${this.uuid}`;
    return [
      ['upnp:rootdevice', `${udn}::upnp:rootdevice`],
      [udn, udn],
      [DEVICE_TYPE, `${udn}::${DEVICE_TYPE}`],
      [AVT, `${udn}::${AVT}`],
      [RCS, `${udn}::${RCS}`],
      [CMS, `${udn}::${CMS}`],
    ];
  }

  private sendAlive() {
    if (!this.running) return;
    for (const [address, sender] of this.senders) {
      for (const [nt, usn] of this.notificationTargets()) {
        const message = [
          'NOTIFY * HTTP/1.1',
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
          `CACHE-CONTROL: max-age=${MAX_AGE}`,
          `LOCATION: ${this.location(address)}`,
          `NT: ${nt}`,
          'NTS: ssdp:alive',
          `SERVER: ${SERVER_HEADER}`,
          `USN: ${usn}`,
          '', '',
        ].join('\r\n');
        sender.send(message, SSDP_PORT, SSDP_ADDRESS, () => undefined);
      }
    }
  }

  private sendByeBye() {
    const sends: Promise<void>[] = [];
    for (const sender of this.senders.values()) {
      for (const [nt, usn] of this.notificationTargets()) {
        const message = [
          'NOTIFY * HTTP/1.1',
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
          `NT: ${nt}`,
          'NTS: ssdp:byebye',
          `USN: ${usn}`,
          '', '',
        ].join('\r\n');
        sends.push(new Promise<void>((resolve) => {
          try {
            sender.send(message, SSDP_PORT, SSDP_ADDRESS, () => resolve());
          } catch (e) {
            resolve();
          }
        }));
      }
    }
    return Promise.race([
      Promise.all(sends).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  }

  private handleSsdp(msg: Buffer, rinfo: dgram.RemoteInfo) {
    if (!this.running || !this.ssdpSocket) return;
    const text = msg.toString('utf8');
    if (!/^M-SEARCH \* HTTP\/1\.1/i.test(text)) return;
    const headers: Record<string, string> = {};
    for (const line of text.split(/\r?\n/).slice(1)) {
      const index = line.indexOf(':');
      if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
    if ((headers.man || '').replace(/"/g, '') !== 'ssdp:discover') return;
    const st = headers.st || '';
    const targets = this.notificationTargets().filter(([nt]) => st === 'ssdp:all' || st === nt);
    if (!targets.length) return;

    const iface = this.interfaces.find((i) => sameSubnet(i.address, rinfo.address, i.netmask))
      || this.interfaces[0];
    if (!iface) return;
    const mx = Math.max(1, Math.min(5, Number(headers.mx) || 1));
    const delay = Math.floor(Math.random() * Math.min(mx * 1000, 1000));
    setTimeout(() => {
      if (!this.running || !this.ssdpSocket) return;
      for (const [nt, usn] of targets) {
        const response = [
          'HTTP/1.1 200 OK',
          `CACHE-CONTROL: max-age=${MAX_AGE}`,
          `DATE: ${new Date().toUTCString()}`,
          'EXT:',
          `LOCATION: ${this.location(iface.address)}`,
          `SERVER: ${SERVER_HEADER}`,
          `ST: ${nt}`,
          `USN: ${usn}`,
          '', '',
        ].join('\r\n');
        try {
          this.ssdpSocket.send(response, rinfo.port, rinfo.address, () => undefined);
        } catch (e) {
        }
      }
    }, delay);
  }

  // ---------- HTTP ----------

  private closeHttp() {
    const server = this.httpServer;
    this.httpServer = null;
    if (!server) return Promise.resolve();
    for (const socket of this.httpSockets) socket.destroy();
    this.httpSockets.clear();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private deviceDescription() {
    const services = (Object.keys(SERVICES) as ServiceKey[]).map((key) =>
      `<service><serviceType>${SERVICES[key].type}</serviceType><serviceId>${SERVICES[key].id}</serviceId><SCPDURL>/${key}.xml</SCPDURL><controlURL>/control/${key}</controlURL><eventSubURL>/event/${key}</eventSubURL></service>`,
    ).join('');
    return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>${DEVICE_TYPE}</deviceType><friendlyName>${escapeXml(this.friendlyName)}</friendlyName><manufacturer>Rainsee</manufacturer><manufacturerURL>https://www.yjllq.com/</manufacturerURL><modelDescription>Rainsee Browser DLNA Media Renderer</modelDescription><modelName>Rainsee Cast</modelName><modelNumber>1.0</modelNumber><serialNumber>${this.uuid}</serialNumber><UDN>uuid:${this.uuid}</UDN><dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC><serviceList>${services}</serviceList></device></root>`;
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const path = (req.url || '/').split('?')[0];
    const method = (req.method || 'GET').toUpperCase();
    const baseHeaders = {
      Server: SERVER_HEADER,
      Date: new Date().toUTCString(),
    };

    if (method === 'GET' || method === 'HEAD') {
      const body = path === '/description.xml' ? this.deviceDescription() : SCPD[path];
      if (!body) {
        res.writeHead(404, baseHeaders);
        res.end();
        return;
      }
      const data = Buffer.from(body, 'utf8');
      res.writeHead(200, {
        ...baseHeaders,
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': data.length,
      });
      res.end(method === 'HEAD' ? undefined : data);
      return;
    }

    const eventMatch = path.match(/^\/event\/(AVTransport|RenderingControl|ConnectionManager)$/);
    if (eventMatch && (method === 'SUBSCRIBE' || method === 'UNSUBSCRIBE')) {
      this.handleSubscription(method, eventMatch[1] as ServiceKey, req, res, baseHeaders);
      return;
    }

    const controlMatch = path.match(/^\/control\/(AVTransport|RenderingControl|ConnectionManager)$/);
    if (controlMatch && method === 'POST') {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413, baseHeaders);
          res.end();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks).toString('utf8');
        this.handleControl(controlMatch[1] as ServiceKey, req, body, res, baseHeaders);
      });
      return;
    }

    res.writeHead(path.startsWith('/control/') || path.startsWith('/event/') ? 405 : 404, baseHeaders);
    res.end();
  }

  private handleControl(
    service: ServiceKey,
    req: http.IncomingMessage,
    body: string,
    res: http.ServerResponse,
    baseHeaders: Record<string, string>,
  ) {
    const soapAction = String(req.headers.soapaction || '').replace(/"/g, '');
    let action = soapAction.includes('#') ? soapAction.split('#').pop() || '' : '';
    if (!action) {
      const match = body.match(/<(?:[\w-]+:)?Body[^>]*>\s*<(?:[\w-]+:)?([A-Za-z]+)[\s>/]/);
      action = match ? match[1] : '';
    }

    const send = (status: number, xml: string) => {
      const data = Buffer.from(xml, 'utf8');
      res.writeHead(status, {
        ...baseHeaders,
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': data.length,
        EXT: '',
      });
      res.end(data);
    };

    try {
      const out = this.runAction(service, action, body, normalizeRemote(req.socket.remoteAddress));
      const args = Object.entries(out).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('');
      send(200, `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action}Response xmlns:u="${SERVICES[service].type}">${args}</u:${action}Response></s:Body></s:Envelope>`);
    } catch (e) {
      const error = e instanceof UpnpError ? e : new UpnpError(501, 'Action Failed');
      if (!(e instanceof UpnpError)) console.log('[dlna] action failed', service, action, e);
      send(500, `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${error.code}</errorCode><errorDescription>${escapeXml(error.message)}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`);
    }
  }

  private emitCommand(command: DlnaCommand) {
    this.emit('command', command);
  }

  private runAction(service: ServiceKey, action: string, body: string, remote: string): Record<string, string | number> {
    if (service === 'AVTransport') {
      switch (action) {
        case 'SetAVTransportURI': {
          const uri = readArg(body, 'CurrentURI').trim();
          const metadata = readArg(body, 'CurrentURIMetaData');
          let protocol = '';
          try {
            protocol = new URL(uri).protocol;
          } catch (e) {
          }
          // 只接受网络地址：控制端不得借投屏让播放器读取本机文件。
          if (protocol !== 'http:' && protocol !== 'https:') {
            throw new UpnpError(714, 'Illegal MIME-type');
          }
          this.currentUri = uri;
          this.currentMetadata = metadata;
          this.position = 0;
          this.duration = 0;
          this.transportState = 'TRANSITIONING';
          console.log('[dlna] SetAVTransportURI from', remote, uri.slice(0, 200));
          this.emitCommand({
            type: 'load',
            url: uri,
            title: metadataTitle(metadata),
            mimeType: metadataMime(metadata),
          });
          this.scheduleEvent('AVTransport');
          return {};
        }
        case 'SetNextAVTransportURI':
          return {};
        case 'Play':
          if (!this.currentUri) throw new UpnpError(701, 'Transition not available');
          if (this.transportState !== 'PLAYING') {
            this.transportState = 'TRANSITIONING';
            this.scheduleEvent('AVTransport');
          }
          this.emitCommand({type: 'play'});
          return {};
        case 'Pause':
          if (!this.currentUri) throw new UpnpError(701, 'Transition not available');
          this.transportState = 'PAUSED_PLAYBACK';
          this.emitCommand({type: 'pause'});
          this.scheduleEvent('AVTransport');
          return {};
        case 'Stop':
          if (this.currentUri) {
            this.transportState = 'STOPPED';
            this.position = 0;
            this.scheduleEvent('AVTransport');
          }
          this.emitCommand({type: 'stop'});
          return {};
        case 'Seek': {
          if (!this.currentUri) throw new UpnpError(701, 'Transition not available');
          const unit = readArg(body, 'Unit').toUpperCase();
          if (unit !== 'REL_TIME' && unit !== 'ABS_TIME') throw new UpnpError(710, 'Seek mode not supported');
          const seconds = parseTime(readArg(body, 'Target'));
          if (!Number.isFinite(seconds) || seconds < 0) throw new UpnpError(711, 'Illegal seek target');
          this.position = seconds;
          this.emitCommand({type: 'seek', seconds});
          return {};
        }
        case 'Next':
        case 'Previous':
          throw new UpnpError(701, 'Transition not available');
        case 'GetTransportInfo':
          return {
            CurrentTransportState: this.transportState,
            CurrentTransportStatus: 'OK',
            CurrentSpeed: '1',
          };
        case 'GetPositionInfo':
          return {
            Track: this.currentUri ? 1 : 0,
            TrackDuration: formatTime(this.duration),
            TrackMetaData: this.currentMetadata || 'NOT_IMPLEMENTED',
            TrackURI: this.currentUri,
            RelTime: formatTime(this.position),
            AbsTime: formatTime(this.position),
            RelCount: 2147483647,
            AbsCount: 2147483647,
          };
        case 'GetMediaInfo':
          return {
            NrTracks: this.currentUri ? 1 : 0,
            MediaDuration: formatTime(this.duration),
            CurrentURI: this.currentUri,
            CurrentURIMetaData: this.currentMetadata,
            NextURI: '',
            NextURIMetaData: '',
            PlayMedium: this.currentUri ? 'NETWORK' : 'NONE',
            RecordMedium: 'NOT_IMPLEMENTED',
            WriteStatus: 'NOT_IMPLEMENTED',
          };
        case 'GetDeviceCapabilities':
          return {PlayMedia: 'NETWORK', RecMedia: 'NOT_IMPLEMENTED', RecQualityModes: 'NOT_IMPLEMENTED'};
        case 'GetTransportSettings':
          return {PlayMode: 'NORMAL', RecQualityMode: 'NOT_IMPLEMENTED'};
        case 'GetCurrentTransportActions':
          return {Actions: this.transportActions()};
      }
    }

    if (service === 'RenderingControl') {
      switch (action) {
        case 'GetVolume':
          return {CurrentVolume: this.volume};
        case 'SetVolume': {
          const volume = Number(readArg(body, 'DesiredVolume'));
          if (!Number.isFinite(volume)) throw new UpnpError(402, 'Invalid Args');
          this.volume = Math.max(0, Math.min(100, Math.round(volume)));
          this.emitCommand({type: 'volume', volume: this.volume});
          this.scheduleEvent('RenderingControl');
          return {};
        }
        case 'GetMute':
          return {CurrentMute: this.muted ? 1 : 0};
        case 'SetMute': {
          const value = readArg(body, 'DesiredMute').trim().toLowerCase();
          this.muted = value === '1' || value === 'true' || value === 'yes';
          this.emitCommand({type: 'mute', muted: this.muted});
          this.scheduleEvent('RenderingControl');
          return {};
        }
        case 'ListPresets':
          return {CurrentPresetNameList: 'FactoryDefaults'};
        case 'SelectPreset':
          return {};
      }
    }

    if (service === 'ConnectionManager') {
      switch (action) {
        case 'GetProtocolInfo':
          return {Source: '', Sink: SINK_PROTOCOL_INFO};
        case 'GetCurrentConnectionIDs':
          return {ConnectionIDs: '0'};
        case 'GetCurrentConnectionInfo':
          return {
            RcsID: 0,
            AVTransportID: 0,
            ProtocolInfo: '',
            PeerConnectionManager: '',
            PeerConnectionID: -1,
            Direction: 'Input',
            Status: 'OK',
          };
      }
    }

    throw new UpnpError(401, 'Invalid Action');
  }

  private transportActions() {
    if (!this.currentUri) return '';
    if (this.transportState === 'PLAYING') return 'Pause,Stop,Seek';
    return 'Play,Stop,Seek';
  }

  // ---------- GENA 事件 ----------

  private handleSubscription(
    method: string,
    service: ServiceKey,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseHeaders: Record<string, string>,
  ) {
    const sidHeader = String(req.headers.sid || '').trim();
    if (method === 'UNSUBSCRIBE') {
      const ok = this.subscriptions.delete(sidHeader);
      res.writeHead(ok ? 200 : 412, baseHeaders);
      res.end();
      return;
    }

    const timeoutMatch = String(req.headers.timeout || '').match(/Second-(\d+)/i);
    const timeout = Math.max(60, Math.min(3600, timeoutMatch ? Number(timeoutMatch[1]) : MAX_AGE));

    // 续订
    if (sidHeader) {
      const existing = this.subscriptions.get(sidHeader);
      if (!existing || req.headers.callback || req.headers.nt) {
        res.writeHead(existing ? 400 : 412, baseHeaders);
        res.end();
        return;
      }
      existing.expiresAt = Date.now() + timeout * 1000;
      res.writeHead(200, {...baseHeaders, SID: existing.sid, TIMEOUT: `Second-${timeout}`, 'Content-Length': 0});
      res.end();
      return;
    }

    const remote = normalizeRemote(req.socket.remoteAddress);
    const callbacks = String(req.headers.callback || '').match(/<([^>]+)>/g) || [];
    // 只回调订阅者自身地址，防止被当作向局域网任意主机发请求的跳板。
    const callback = callbacks
      .map((c) => c.slice(1, -1))
      .find((c) => {
        try {
          const parsed = new URL(c);
          return parsed.protocol === 'http:' && parsed.hostname === remote;
        } catch (e) {
          return false;
        }
      });
    if (String(req.headers.nt || '') !== 'upnp:event' || !callback) {
      res.writeHead(412, baseHeaders);
      res.end();
      return;
    }

    const sub: Subscription = {
      sid: `uuid:${generateUuid()}`,
      service,
      callback,
      expiresAt: Date.now() + timeout * 1000,
      seq: 0,
    };
    this.subscriptions.set(sub.sid, sub);
    res.writeHead(200, {...baseHeaders, SID: sub.sid, TIMEOUT: `Second-${timeout}`, 'Content-Length': 0});
    res.end();
    // 订阅后立即推送一次初始状态。
    setTimeout(() => this.notify(sub), 50);
  }

  private pruneSubscriptions() {
    const now = Date.now();
    for (const [sid, sub] of this.subscriptions) {
      if (sub.expiresAt < now) this.subscriptions.delete(sid);
    }
  }

  private scheduleEvent(service: ServiceKey) {
    if (!this.running || this.eventTimers.has(service)) return;
    this.eventTimers.set(service, setTimeout(() => {
      this.eventTimers.delete(service);
      this.pruneSubscriptions();
      for (const sub of this.subscriptions.values()) {
        if (sub.service === service) this.notify(sub);
      }
    }, 200));
  }

  private eventBody(service: ServiceKey) {
    const property = (name: string, value: string) =>
      `<e:property><${name}>${escapeXml(value)}</${name}></e:property>`;
    let properties = '';
    if (service === 'AVTransport') {
      const val = (name: string, value: string | number) => `<${name} val="${escapeXml(value)}"/>`;
      const lastChange = `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"><InstanceID val="0">${[
        val('TransportState', this.transportState),
        val('TransportStatus', 'OK'),
        val('CurrentPlayMode', 'NORMAL'),
        val('TransportPlaySpeed', '1'),
        val('PlaybackStorageMedium', this.currentUri ? 'NETWORK' : 'NONE'),
        val('NumberOfTracks', this.currentUri ? 1 : 0),
        val('CurrentTrack', this.currentUri ? 1 : 0),
        val('CurrentTrackDuration', formatTime(this.duration)),
        val('CurrentMediaDuration', formatTime(this.duration)),
        val('CurrentTrackURI', this.currentUri),
        val('AVTransportURI', this.currentUri),
        val('CurrentTrackMetaData', this.currentMetadata),
        val('AVTransportURIMetaData', this.currentMetadata),
        val('CurrentTransportActions', this.transportActions()),
      ].join('')}</InstanceID></Event>`;
      properties = property('LastChange', lastChange);
    } else if (service === 'RenderingControl') {
      const lastChange = `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/RCS/"><InstanceID val="0"><Volume channel="Master" val="${this.volume}"/><Mute channel="Master" val="${this.muted ? 1 : 0}"/></InstanceID></Event>`;
      properties = property('LastChange', lastChange);
    } else {
      properties = property('SourceProtocolInfo', '')
        + property('SinkProtocolInfo', SINK_PROTOCOL_INFO)
        + property('CurrentConnectionIDs', '0');
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">${properties}</e:propertyset>`;
  }

  private notify(sub: Subscription) {
    if (!this.running || !this.subscriptions.has(sub.sid)) return;
    const data = Buffer.from(this.eventBody(sub.service), 'utf8');
    const seq = sub.seq;
    sub.seq = sub.seq >= 4294967295 ? 1 : sub.seq + 1;
    try {
      const target = new URL(sub.callback);
      const request = http.request({
        method: 'NOTIFY',
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        timeout: 3000,
        headers: {
          HOST: target.host,
          'CONTENT-TYPE': 'text/xml; charset="utf-8"',
          'CONTENT-LENGTH': data.length,
          NT: 'upnp:event',
          NTS: 'upnp:propchange',
          SID: sub.sid,
          SEQ: seq,
        },
      });
      request.on('response', (response) => response.resume());
      request.on('timeout', () => request.destroy());
      request.on('error', () => undefined);
      request.end(data);
    } catch (e) {
    }
  }
}

const listenWithFallback = (server: http.Server, preferredPort: number) =>
  new Promise<number>((resolve, reject) => {
    const tryListen = (port: number) => {
      const onError = (e: any) => {
        server.removeListener('listening', onListening);
        if (port !== 0) tryListen(0);
        else reject(e);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve((server.address() as AddressInfo).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '0.0.0.0');
    };
    tryListen(preferredPort);
  });

export const dlnaRenderer = new DlnaRenderer();
