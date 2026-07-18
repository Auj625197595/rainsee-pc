import * as React from 'react';
import styled, {css} from 'styled-components';

import {Switch} from '~/renderer/components/Switch';
import {Title, Row, Control, Header, SecondaryText} from '../App/style';
import store from '../../store';
import {onSwitchChange} from '../../utils';
import {ipcRenderer} from '~/common/renderer-ipc';
import {observer} from 'mobx-react-lite';
import {NormalButton} from '../App';
import {getPalette} from '../../utils/palette';
import {ITheme} from '~/interfaces';

const AskToggle = observer(() => {
  const {downloadsDialog} = store.settings;

  return (
    <Row onClick={onSwitchChange('downloadsDialog')}>
      <Title>下载前询问</Title>
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
      <div>
        <Title>下载位置</Title>
        <SecondaryText>{store.settings.downloadsPath}</SecondaryText>
      </div>

      <Control>
        <NormalButton onClick={onChangeClick}>修改</NormalButton>
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

  ${({theme}: {theme?: ITheme}) => {
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

  ${({theme}: {theme?: ITheme}) => {
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

const DownloaderType = observer(() => {
  const {downloaderType} = store.settings;
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
  const {downloaderType, downloaderPath} = store.settings;
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
        <NormalButton variant="soft" onClick={() => ipcRenderer.send('downloader-path-autodetect')}>
          自动检测
        </NormalButton>
        <div style={{width: 8}} />
        <NormalButton onClick={() => ipcRenderer.send('downloader-path-change')}>
          修改
        </NormalButton>
      </Control>
    </PlainRow>
  );
});

const DownloaderArgs = observer(() => {
  const {downloaderType, downloaderArgs} = store.settings;
  // 仅自定义类型需要参数模板;预置类型内置命令行。
  if (downloaderType !== 'custom') return null;
  return (
    <PlainRow>
      <div>
        <Title>启动参数</Title>
        <SecondaryText>
          占位符:{'{url}'} {'{path}'} {'{filename}'},空白分隔。例:-d {'{path}'} -o {'{filename}'} {'{url}'}
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
  const {downloaderAutoIntercept} = store.settings;
  return (
    <Row onClick={onSwitchChange('downloaderAutoIntercept')}>
      <div>
        <Title>自动接管所有下载</Title>
        <SecondaryText>开启后浏览器不再下载文件,全部交给外部下载器(迅雷需已安装)。</SecondaryText>
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
        <div>
          <Title>使用外部下载器</Title>
          <SecondaryText>开启后右键链接可"使用 IDM/迅雷 下载";可附加自动接管。</SecondaryText>
        </div>
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
      <Header>下载</Header>
      <Location />
      <AskToggle />
      <DownloaderSection />
    </>
  );
};
