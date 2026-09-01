import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';
import { TextT, Translate } from '@phosphor-icons/react';

import { ipcRenderer } from '~/common/renderer-ipc';
import {getWebUIContext} from '~/common/webui-context';
import store from '../../store';
import { Title, SecondaryText, SettingIcon } from '../App/style';
import { getSettingsTranslator } from '../../utils';
import { Switch } from '~/renderer/components/Switch';
import { LANGUAGES } from '~/renderer/views/translate/languages';
import { getPalette } from '../../utils/palette';
import { ITheme, ISettings } from '~/interfaces';

// ===========================================================================
// styled(克隆 MouseGestures/index.tsx 的原子)
// ===========================================================================

const OptionsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 6px;
  margin-bottom: 8px;
  padding: 14px 18px;
  border-radius: 16px;
  flex-wrap: wrap;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line}, 0 1px 2px rgba(20, 27, 45, 0.04);
    `;
  }}
`;

const OptionGroupBlock = styled.section`
  margin-top: 26px;
`;

const OptionGroupLabel = styled.div`
  padding: 0 4px 9px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const OptionGroup = styled.div`
  overflow: hidden;
  border-radius: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      ${OptionsRow} {
        margin: 0;
        border-radius: 0;
        box-shadow: none;
      }
      ${OptionsRow} + ${OptionsRow},
      & > div > ${OptionsRow} + ${OptionsRow} {
        border-top: 1px solid ${p.line};
      }
    `;
  }}
`;

const OptionItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const OptionCopy = styled.div`
  min-width: 220px;
  flex: 1;
`;

const OptionControls = styled.div`
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
`;

const ShapeSelect = styled.select`
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

// 自定义 LLM 配置子卡(纵向字段堆叠)。
const ConfigCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  margin-top: 4px;
  padding: 14px 16px;
  border-radius: 12px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const FieldColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 220px;
`;

const FieldLabel = styled.label`
  font-size: 12.5px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const FieldHint = styled.span`
  font-size: 11.5px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const inputCss = (theme?: ITheme) => {
  const p = getPalette(theme);
  return css`
    height: 36px;
    padding: 0 12px;
    border-radius: 10px;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
    color: ${p.textMain};
    background-color: ${p.surface};
    border: 1px solid ${p.line};
    &:hover {
      border-color: ${p.primary}66;
    }
    &:focus {
      border-color: ${p.primary};
      box-shadow: 0 0 0 3px ${p.primary}1f;
    }
  `;
};

const TextInput = styled.input`
  ${({ theme }: { theme?: ITheme }) => inputCss(theme)}
`;

const TextArea = styled.textarea`
  min-height: 64px;
  padding: 8px 12px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
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

const KeyRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const EyeBtn = styled.button`
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  height: 26px;
  padding: 0 8px;
  border-radius: 7px;
  border: 0;
  cursor: pointer;
  font-size: 11.5px;
  font-family: inherit;
  background: transparent;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
    &:hover {
      background-color: ${getPalette(theme).surface};
      color: ${getPalette(theme).primary};
    }
  `}
`;

const FieldsGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`;

// ===========================================================================
// 组件
// ===========================================================================

const DEFAULT_CFG: ISettings['customLlmConfig'] = {
  baseUrl: 'https://api.openai.com/',
  apiKey: '',
  model: 'gpt-4o-mini',
  apiType: 'chat',
  systemPrompt: '',
};

export const SelectionTranslate = observer(() => {
  const t = getSettingsTranslator();
  const panelEnabled = store.settings.selectionPanelEnabled !== false;
  const wordCountEnabled = store.settings.selectionWordCountEnabled !== false;
  const enabled = store.settings.selectionTranslateEnabled !== false;
  const target = store.settings.selectionTranslateTarget || 'zh-CN';
  const engine = store.settings.translateEngine || 'microsoft';
  const wordCountSettingRef = React.useRef<HTMLDivElement>(null);
  const handledHighlightRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (store.highlightedSetting !== 'selectionWordCount') return;
    if (handledHighlightRef.current === store.highlightedSetting) return;
    handledHighlightRef.current = store.highlightedSetting;

    const scrollToSetting = () =>
      wordCountSettingRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

    scrollToSetting();
    const firstRetry = window.setTimeout(scrollToSetting, 140);
    const secondRetry = window.setTimeout(scrollToSetting, 450);
    return () => {
      window.clearTimeout(firstRetry);
      window.clearTimeout(secondRetry);
    };
  }, [store.highlightedSetting]);

  const setOption = (
    key:
      | 'panelEnabled'
      | 'wordCountEnabled'
      | 'enabled'
      | 'target'
      | 'engine'
      | 'customLlmConfig',
    value: any,
  ) => ipcRenderer.invoke('set-selection-translate-option', key, value);

  // 自定义 LLM 配置:本地 state + 300ms 防抖落盘(避免逐键 IPC)。
  const [cfg, setCfg] = React.useState<ISettings['customLlmConfig']>(
    store.settings.customLlmConfig || DEFAULT_CFG,
  );
  const [showKey, setShowKey] = React.useState(false);
  const saveTimer = React.useRef<number | null>(null);

  const updateCfg = (patch: Partial<ISettings['customLlmConfig']>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      ipcRenderer.invoke(
        'set-selection-translate-option',
        'customLlmConfig',
        next,
      );
    }, 300);
  };

  return (
    <>
      <OptionGroupBlock>
        <OptionGroupLabel>{t('stSection')}</OptionGroupLabel>
        <OptionGroup>
          <OptionsRow>
            <SettingIcon tone="blue">
              <TextT size={19} weight="fill" />
            </SettingIcon>
            <OptionCopy>
              <Title>{t('searchTextMenu')}</Title>
              <SecondaryText>{t('stMenuDesc')}</SecondaryText>
            </OptionCopy>
            <Switch
              clickable
              value={panelEnabled}
              onClick={() => setOption('panelEnabled', !panelEnabled)}
            />
          </OptionsRow>

          <OptionsRow>
            <SettingIcon tone="purple">
              <Translate size={19} weight="fill" />
            </SettingIcon>
            <OptionCopy>
              <Title>{t('searchSelectionTranslate')}</Title>
              <SecondaryText>{t('stTranslateDesc')}</SecondaryText>
            </OptionCopy>
            <Switch
              clickable
              value={enabled}
              onClick={() => setOption('enabled', !enabled)}
            />
          </OptionsRow>

          <OptionsRow id="setting-selection-word-count" ref={wordCountSettingRef}>
            <SettingIcon tone="blue">
              <TextT size={19} weight="fill" />
            </SettingIcon>
            <OptionCopy>
              <Title>{t('searchWordCount')}</Title>
              <SecondaryText>{t('stWordCountDesc')}</SecondaryText>
            </OptionCopy>
            <Switch
              clickable
              value={wordCountEnabled}
              onClick={() =>
                setOption('wordCountEnabled', !wordCountEnabled)
              }
            />
          </OptionsRow>
        </OptionGroup>
      </OptionGroupBlock>

      <OptionGroupBlock>
        <OptionGroupLabel>{t('stTranslateSection')}</OptionGroupLabel>
        <OptionGroup>
          <OptionsRow>
            <OptionCopy>
              <Title>{t('stTargetLanguage')}</Title>
            </OptionCopy>
            <ShapeSelect
              value={target}
              onChange={(e) => setOption('target', e.target.value)}
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </ShapeSelect>
          </OptionsRow>
          <div
            style={{
              opacity: enabled ? 1 : 0.45,
              pointerEvents: enabled ? 'auto' : 'none',
            }}
          >
            <OptionsRow>
              <OptionCopy>
                <Title>{t('searchTranslateEngine')}</Title>
              </OptionCopy>
              <ShapeSelect
                value={engine}
                onChange={(e) => setOption('engine', e.target.value)}
              >
                <option value="microsoft">{t('stEngineMicrosoft')}</option>
                <option value="custom-llm">{t('stEngineCustom')}</option>
              </ShapeSelect>
            </OptionsRow>

            {engine === 'custom-llm' && (
              <OptionsRow
                style={{ flexDirection: 'column', alignItems: 'stretch' }}
              >
                <SecondaryText>{t('stLlmIntro')}</SecondaryText>
                <ConfigCard>
                  <FieldsGrid>
                    <FieldColumn style={{ flex: 2 }}>
                      <FieldLabel>{t('stBaseUrl')}</FieldLabel>
                      <TextInput
                        value={cfg.baseUrl}
                        placeholder="https://api.openai.com/"
                        onChange={(e) => updateCfg({ baseUrl: e.target.value })}
                      />
                      <FieldHint>{t('stBaseUrlHint')}</FieldHint>
                    </FieldColumn>
                    <FieldColumn>
                      <FieldLabel>{t('stApiType')}</FieldLabel>
                      <ShapeSelect
                        value={cfg.apiType}
                        onChange={(e) =>
                          updateCfg({
                            apiType: e.target.value as 'chat' | 'responses',
                          })
                        }
                      >
                        <option value="chat">Chat Completions</option>
                        <option value="responses">Responses</option>
                      </ShapeSelect>
                    </FieldColumn>
                  </FieldsGrid>

                  <FieldColumn>
                    <FieldLabel>{t('stModel')}</FieldLabel>
                    <TextInput
                      value={cfg.model}
                      placeholder="gpt-4o-mini"
                      onChange={(e) => updateCfg({ model: e.target.value })}
                    />
                  </FieldColumn>

                  <FieldColumn>
                    <FieldLabel>API Key</FieldLabel>
                    <KeyRow>
                      <TextInput
                        style={{ width: '100%', paddingRight: 64 }}
                        type={showKey ? 'text' : 'password'}
                        value={cfg.apiKey}
                        placeholder="sk-..."
                        onChange={(e) => updateCfg({ apiKey: e.target.value })}
                      />
                      <EyeBtn onClick={() => setShowKey((v) => !v)}>
                        {showKey ? t('hide') : t('show')}
                      </EyeBtn>
                    </KeyRow>
                    <FieldHint>{t('stKeyHint')}</FieldHint>
                  </FieldColumn>

                  <FieldColumn>
                    <FieldLabel>{t('stSystemPrompt')}</FieldLabel>
                    <TextArea
                      value={cfg.systemPrompt || ''}
                      placeholder={t('stSystemPromptPlaceholder')}
                      maxLength={500}
                      onChange={(e) =>
                        updateCfg({ systemPrompt: e.target.value })
                      }
                    />
                  </FieldColumn>
                </ConfigCard>
              </OptionsRow>
            )}
          </div>
        </OptionGroup>
      </OptionGroupBlock>
    </>
  );
});
