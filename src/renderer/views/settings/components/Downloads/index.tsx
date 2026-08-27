import * as React from 'react';
import styled, { css } from 'styled-components';
import {
  ArrowSquareOut,
  FilmStrip,
  FolderSimple,
  Minus,
  Plus,
  Question,
} from '@phosphor-icons/react';

import { Switch } from '~/renderer/components/Switch';
import {
  Title,
  Row,
  Control,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingGroupLabel,
  SettingIcon,
} from '../App/style';
import store from '../../store';
import { onSwitchChange } from '../../utils';
import { ipcRenderer } from '~/common/renderer-ipc';
import { observer } from 'mobx-react-lite';
import { NormalButton } from '../App';
import { getPalette } from '../../utils/palette';
import { ITheme } from '~/interfaces';
import {
  MAX_M3U8_DOWNLOAD_THREADS,
  MIN_M3U8_DOWNLOAD_THREADS,
} from '~/constants';

const AskToggle = observer(() => {
  const { downloadsDialog } = store.settings;

  return (
    <Row onClick={onSwitchChange('downloadsDialog')}>
      <SettingIcon tone="blue">
        <Question size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>下载前询问</Title>
        <SecondaryText>
          下载开始前确认文件名、存储位置和下载方式。
        </SecondaryText>
      </SettingCopy>
      <Control>
        <Switch value={downloadsDialog} />
      </Control>
    </Row>
  );
});

const onChangeClick = () => {
  ipcRenderer.send('downloads-path-change');
};

const Location = observer(() => {
  return (
    <Row>
      <SettingIcon tone="orange">
        <FolderSimple size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>下载位置</Title>
        <SecondaryText>{store.settings.downloadsPath}</SecondaryText>
      </SettingCopy>

      <Control>
        <NormalButton variant="soft" onClick={onChangeClick}>
          修改
        </NormalButton>
      </Control>
    </Row>
  );
});

// ===== 外部下载器(克隆 SelectionTranslate 的下拉/输入原子)=====

// 非 clickable 行:覆盖 Row 的 cursor:pointer,避免整行误导(仅控件可点)。
const PlainRow = styled(Row)`
  cursor: default;
`;

const Select = styled.select`
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &:hover {
        border-color: ${p.primary}66;
      }

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

const ArgsInput = styled.input`
  width: 260px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-family: 'SF Mono', 'Roboto Mono', monospace;
  font-size: 12.5px;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};

      &::placeholder {
        color: ${p.textMute};
      }

      &:hover {
        border-color: ${p.primary}66;
      }

      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

const ThreadsInput = styled(ArgsInput)`
  width: 42px;
  height: 32px;
  padding: 0;
  border-width: 0 1px;
  border-radius: 0;
  font-family: inherit;
  font-size: 13px;
  text-align: center;
`;

const Stepper = styled.div`
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      button {
        width: 30px;
        height: 32px;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: ${p.textMain};
        background: transparent;
        cursor: pointer;
        &:hover {
          color: ${p.primary};
          background-color: ${p.primarySoft};
        }
      }
    `;
  }}
`;

const M3u8DownloadThreads = observer(() => {
  const configured = store.settings.m3u8DownloadThreads;
  const [value, setValue] = React.useState(String(configured));

  React.useEffect(() => {
    setValue(String(configured));
  }, [configured]);

  const commit = () => {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed)
      ? Math.max(
          MIN_M3U8_DOWNLOAD_THREADS,
          Math.min(MAX_M3U8_DOWNLOAD_THREADS, Math.round(parsed)),
        )
      : configured;
    setValue(String(normalized));
    if (normalized === configured) return;
    store.settings.m3u8DownloadThreads = normalized;
    store.save();
  };

  const step = (delta: number) => {
    const next = Math.max(
      MIN_M3U8_DOWNLOAD_THREADS,
      Math.min(
        MAX_M3U8_DOWNLOAD_THREADS,
        (Number(value) || configured) + delta,
      ),
    );
    setValue(String(next));
    store.settings.m3u8DownloadThreads = next;
    store.save();
  };

  return (
    <PlainRow>
      <SettingIcon tone="cyan">
        <FilmStrip size={19} weight="fill" />
      </SettingIcon>
      <SettingCopy>
        <Title>M3U8 下载线程数</Title>
        <SecondaryText>同时下载的分片数量（1-32）</SecondaryText>
      </SettingCopy>
      <Control>
        <Stepper>
          <button type="button" title="减少线程" onClick={() => step(-1)}>
            <Minus size={15} />
          </button>
          <ThreadsInput
            aria-label="M3U8 下载线程数"
            type="number"
            min={MIN_M3U8_DOWNLOAD_THREADS}
            max={MAX_M3U8_DOWNLOAD_THREADS}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <button type="button" title="增加线程" onClick={() => step(1)}>
            <Plus size={15} />
          </button>
        </Stepper>
      </Control>
    </PlainRow>
  );
});

const DownloaderType = observer(() => {
  const { downloaderType } = store.settings;
  return (
    <PlainRow>
      <Title>下载器类型</Title>
      <Control>
        <Select
          value={downloaderType}
          onChange={(e) => {
            store.settings.downloaderType = e.target.value;
            store.save();
          }}
        >
          <option value="idm">IDM</option>
          <option value="thunder">迅雷</option>
          <option value="aria2">aria2</option>
          <option value="custom">自定义</option>
        </Select>
      </Control>
    </PlainRow>
  );
});

const DownloaderPath = observer(() => {
  const { downloaderType, downloaderPath } = store.settings;
  // 迅雷走 thunder:// 协议,无需可执行文件路径。
  if (downloaderType === 'thunder') return null;
  // aria2 / 自定义通常无注册表项,自动检测多半仅对 IDM 有意义;但统一保留按钮,
  // 失败时主进程会弹提示引导手动选择。
  return (
    <PlainRow>
      <div>
        <Title>可执行文件路径</Title>
        <SecondaryText>{downloaderPath || '未设置'}</SecondaryText>
      </div>
      <Control>
        <NormalButton
          variant="soft"
          onClick={() => ipcRenderer.send('downloader-path-autodetect')}
        >
          自动检测
        </NormalButton>
        <div style={{ width: 8 }} />
        <NormalButton
          onClick={() => ipcRenderer.send('downloader-path-change')}
        >
          修改
        </NormalButton>
      </Control>
    </PlainRow>
  );
});

const DownloaderArgs = observer(() => {
  const { downloaderType, downloaderArgs } = store.settings;
  // 仅自定义类型需要参数模板;预置类型内置命令行。
  if (downloaderType !== 'custom') return null;
  return (
    <PlainRow>
      <div>
        <Title>启动参数</Title>
        <SecondaryText>
          占位符:{'{url}'} {'{path}'} {'{filename}'},空白分隔。例:-d {'{path}'}{' '}
          -o {'{filename}'} {'{url}'}
        </SecondaryText>
      </div>
      <Control>
        <ArgsInput
          value={downloaderArgs}
          placeholder="-d {path} {url}"
          onChange={(e) => {
            store.settings.downloaderArgs = e.target.value;
          }}
          onBlur={() => store.save()}
        />
      </Control>
    </PlainRow>
  );
});

const AutoIntercept = observer(() => {
  const { downloaderAutoIntercept } = store.settings;
  return (
    <Row onClick={onSwitchChange('downloaderAutoIntercept')}>
      <div>
        <Title>自动接管所有下载</Title>
        <SecondaryText>
          开启后浏览器不再下载文件,全部交给外部下载器(迅雷需已安装)。
        </SecondaryText>
      </div>
      <Control>
        <Switch value={downloaderAutoIntercept} />
      </Control>
    </Row>
  );
});

const DownloaderSection = observer(() => {
  const enabled = store.settings.downloaderEnabled;
  return (
    <>
      <Row onClick={onSwitchChange('downloaderEnabled')}>
        <SettingIcon tone="purple">
          <ArrowSquareOut size={19} weight="fill" />
        </SettingIcon>
        <SettingCopy>
          <Title>使用外部下载器</Title>
          <SecondaryText>
            开启后右键链接可"使用 IDM/迅雷 下载";可附加自动接管。
          </SecondaryText>
        </SettingCopy>
        <Control>
          <Switch value={enabled} />
        </Control>
      </Row>
      {enabled && (
        <>
          <DownloaderType />
          <DownloaderPath />
          <DownloaderArgs />
          <AutoIntercept />
        </>
      )}
    </>
  );
});

export const Downloads = () => {
  return (
    <>
      <SettingGroupBlock>
        <SettingGroup>
          <Location />
        </SettingGroup>
      </SettingGroupBlock>
      <SettingGroupBlock>
        <SettingGroupLabel>下载行为</SettingGroupLabel>
        <SettingGroup>
          <AskToggle />
          <DownloaderSection />
        </SettingGroup>
      </SettingGroupBlock>
      <SettingGroupBlock>
        <SettingGroupLabel>流媒体下载</SettingGroupLabel>
        <SettingGroup>
          <M3u8DownloadThreads />
        </SettingGroup>
      </SettingGroupBlock>
    </>
  );
};
