import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';

import { Title, Row, Header, Control } from '../App/style';
import { RadioButton } from '~/renderer/components/RadioButton';
import { NormalButton } from '../App';
import { ITheme } from '~/interfaces';
import { isURL } from '~/utils';
import { getPalette } from '../../utils/palette';
import store from '../../store';

type StartupType = 'continue' | 'urls' | 'empty';

// 现代风格网址输入框:对齐设置页 SeInput 视觉(圆角、聚焦光环、主题配色)。
const URLInput = styled.input`
  width: 320px;
  height: 38px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease,
    background-color 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme!);
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
        background-color: ${p.surface};
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

// 保存结果内联提示:成功绿 / 失败红。成功提示 2.5s 后自动消失。
const Status = styled.span<{ tone: 'ok' | 'err' }>`
  font-size: 12.5px;
  font-weight: 500;

  ${({ tone, theme }: { tone: 'ok' | 'err'; theme?: ITheme }) => css`
    color: ${tone === 'err' ? getPalette(theme!).danger : '#16a34a'};
  `}
`;

interface Props {
  initialValue: StartupType;
  initialURL: string;
}

interface State {
  value: StartupType;
  url: string;
  statusText: string;
  statusTone: 'ok' | 'err';
}

class StartupControl extends React.PureComponent<Props, State> {
  public state: State = {
    value: this.props.initialValue,
    url: this.props.initialURL || '',
    statusText: '',
    statusTone: 'ok',
  };

  private statusTimer?: number;

  // 点击单选项:立即切换并持久化 type(网址输入与保存按钮单独提交)。
  private select = (value: StartupType) => () => {
    this.setState({ value, statusText: '' });
    store.settings.startupBehavior.type = value;
    store.save();
  };

  private onURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 编辑即清除上次保存结果提示。
    this.setState({ url: e.target.value, statusText: '' });
  };

  // 阻止点击输入框触发行的 radio 切换 / 抢走输入焦点。
  private stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  private setStatus = (tone: 'ok' | 'err', text: string) => {
    if (this.statusTimer) {
      window.clearTimeout(this.statusTimer);
    }
    this.setState({ statusTone: tone, statusText: text });
    // 成功提示短暂展示后自动消失;错误提示保留到下次编辑/保存。
    if (tone === 'ok') {
      this.statusTimer = window.setTimeout(() => {
        this.setState({ statusText: '' });
      }, 2500);
    }
  };

  private onSave = () => {
    const raw = (this.state.url || '').trim();

    if (!raw) {
      this.setStatus('err', '请输入网址');
      return;
    }

    if (!isURL(raw)) {
      this.setStatus('err', '网址格式不正确，请检查');
      return;
    }

    // 存原始输入;启动恢复 / 新建标签页打开时各自按需补 http://。
    store.settings.startupBehavior.type = 'urls';
    store.settings.startupBehavior.url = raw;
    store.save();
    this.setStatus('ok', '已保存');
  };

  public render() {
    const titleStyle = {
      marginLeft: 8,
    };

    const rowStyle = {
      cursor: 'pointer',
    };

    const showURLInput = this.state.value === 'urls';

    return (
      <>
        <Header>启动时</Header>
        <Row style={rowStyle} onClick={this.select('empty')}>
          <RadioButton selected={this.state.value === 'empty'} />
          <Title style={titleStyle}>打开新标签页</Title>
        </Row>
        <Row style={rowStyle} onClick={this.select('continue')}>
          <RadioButton selected={this.state.value === 'continue'} />
          <Title style={titleStyle}>恢复标签页</Title>
        </Row>
        <Row style={rowStyle} onClick={this.select('urls')}>
          <RadioButton selected={this.state.value === 'urls'} />
          <Title style={titleStyle}>打开特定页面</Title>
          {showURLInput && (
            <Control onClick={this.stopPropagation}>
              <URLInput
                value={this.state.url}
                onChange={this.onURLChange}
                onClick={this.stopPropagation}
                placeholder="https://example.com"
                spellCheck={false}
              />
            </Control>
          )}
        </Row>
        {showURLInput && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              marginTop: 16,
            }}
          >
            <NormalButton variant="soft" onClick={this.onSave}>
              保存
            </NormalButton>
            {this.state.statusText && (
              <Status tone={this.state.statusTone}>
                {this.state.statusText}
              </Status>
            )}
          </div>
        )}
      </>
    );
  }
}

export const OnStartup = observer(() => {
  const { type, url } = store.settings.startupBehavior;
  return <StartupControl initialValue={type} initialURL={url || ''} />;
});
