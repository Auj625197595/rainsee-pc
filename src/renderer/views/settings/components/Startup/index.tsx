import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';

import { Title, Row, Control, SettingGroup } from '../App/style';
import { RadioButton } from '~/renderer/components/RadioButton';
import { NormalButton } from '../App';
import { ITheme } from '~/interfaces';
import { isURL } from '~/utils';
import { getPalette } from '../../utils/palette';
import store from '../../store';
import { getSettingsTranslator } from '../../utils';
import type { MessageKey } from '~/common/i18n';

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

// 「应用到新标签页」勾选项:原生 checkbox + 主题色 accent-color。
const ApplyToNewTab = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;

  input {
    width: 15px;
    height: 15px;
    margin: 0;
    cursor: pointer;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme!);
    return css`
      color: ${p.textMain};
      input {
        accent-color: ${p.primary};
      }
    `;
  }}
`;

const StartupOptions = styled(SettingGroup)`
  margin-top: 24px;
`;

const StartupOption = styled(Row)<{ $selected: boolean }>`
  ${({ $selected, theme }: { $selected: boolean; theme?: ITheme }) => {
    const p = getPalette(theme!);
    return css`
      background-color: ${$selected ? p.primarySoft : p.surface};
      ${Title} {
        color: ${$selected ? p.primary : p.textMain};
      }
    `;
  }}
`;

interface Props {
  initialValue: StartupType;
  initialURL: string;
  initialApplyToNewTab: boolean;
}

interface State {
  value: StartupType;
  url: string;
  applyToNewTab: boolean;
  // 存消息 key 而非文案:语言切换后 render 重新翻译。
  statusKey: MessageKey | null;
  statusTone: 'ok' | 'err';
}

// 用 Component 而非 PureComponent:语言切换时 props 不变, PureComponent 会
// 跳过重渲染,状态提示/标题会停留在旧语言。
class StartupControl extends React.Component<Props, State> {
  public state: State = {
    value: this.props.initialValue,
    url: this.props.initialURL || '',
    applyToNewTab: this.props.initialApplyToNewTab,
    statusKey: null,
    statusTone: 'ok',
  };

  private statusTimer?: number;

  // 点击单选项:立即切换并持久化 type(网址输入与保存按钮单独提交)。
  private select = (value: StartupType) => () => {
    this.setState({ value, statusKey: null });
    store.settings.startupBehavior.type = value;
    store.save();
  };

  private onURLChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 编辑即清除上次保存结果提示。
    this.setState({ url: e.target.value, statusKey: null });
  };

  // 勾选即持久化,不依赖「保存」按钮(与单选项一致)。
  private onApplyToNewTabChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const applyToNewTab = e.target.checked;
    this.setState({ applyToNewTab });
    store.settings.startupBehavior.applyToNewTab = applyToNewTab;
    store.save();
  };

  // 阻止点击输入框触发行的 radio 切换 / 抢走输入焦点。
  private stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  private setStatus = (tone: 'ok' | 'err', key: MessageKey) => {
    if (this.statusTimer) {
      window.clearTimeout(this.statusTimer);
    }
    this.setState({ statusTone: tone, statusKey: key });
    // 成功提示短暂展示后自动消失;错误提示保留到下次编辑/保存。
    if (tone === 'ok') {
      this.statusTimer = window.setTimeout(() => {
        this.setState({ statusKey: null });
      }, 2500);
    }
  };

  private onSave = () => {
    const raw = (this.state.url || '').trim();

    if (!raw) {
      this.setStatus('err', 'suErrorEmptyUrl');
      return;
    }

    if (!isURL(raw)) {
      this.setStatus('err', 'suErrorInvalidUrl');
      return;
    }

    // 存原始输入;启动恢复 / 新建标签页打开时各自按需补 http://。
    store.settings.startupBehavior.type = 'urls';
    store.settings.startupBehavior.url = raw;
    store.save();
    this.setStatus('ok', 'suSaved');
  };

  public render() {
    const t = getSettingsTranslator();
    const titleStyle = {
      marginLeft: 8,
    };

    const rowStyle = {
      cursor: 'pointer',
    };

    const showURLInput = this.state.value === 'urls';

    return (
      <>
        <StartupOptions>
          <StartupOption
            $selected={this.state.value === 'empty'}
            style={rowStyle}
            onClick={this.select('empty')}
          >
            <RadioButton selected={this.state.value === 'empty'} />
            <Title style={titleStyle}>{t('searchOpenNewTabPage')}</Title>
          </StartupOption>
          <StartupOption
            $selected={this.state.value === 'continue'}
            style={rowStyle}
            onClick={this.select('continue')}
          >
            <RadioButton selected={this.state.value === 'continue'} />
            <Title style={titleStyle}>{t('searchRestoreTabs')}</Title>
          </StartupOption>
          <StartupOption
            $selected={this.state.value === 'urls'}
            style={rowStyle}
            onClick={this.select('urls')}
          >
            <RadioButton selected={this.state.value === 'urls'} />
            <Title style={titleStyle}>{t('searchOpenSpecificPages')}</Title>
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
          </StartupOption>
        </StartupOptions>
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
            <ApplyToNewTab>
              <input
                type="checkbox"
                checked={this.state.applyToNewTab}
                onChange={this.onApplyToNewTabChange}
              />
              {t('suApplyToNewTab')}
            </ApplyToNewTab>
            <NormalButton variant="soft" onClick={this.onSave}>
              {t('save')}
            </NormalButton>
            {this.state.statusKey && (
              <Status tone={this.state.statusTone}>
                {t(this.state.statusKey)}
              </Status>
            )}
          </div>
        )}
      </>
    );
  }
}

export const OnStartup = observer(() => {
  const { type, url, applyToNewTab } = store.settings.startupBehavior;
  return (
    <StartupControl
      initialValue={type}
      initialURL={url || ''}
      initialApplyToNewTab={applyToNewTab !== false}
    />
  );
});
