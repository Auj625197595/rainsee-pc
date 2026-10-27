import * as React from 'react';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';
import { ImageIcon, Trash } from '@phosphor-icons/react';

import { ipcRenderer } from '~/common/renderer-ipc';
import store from '../../store';
import { Title, SecondaryText, SettingIcon } from '../App/style';
import { getSettingsTranslator } from '../../utils';
import { Switch } from '~/renderer/components/Switch';
import { getPalette } from '../../utils/palette';
import { ITheme } from '~/interfaces';

const GroupBlock = styled.section`
  margin-top: 26px;
`;

const GroupLabel = styled.div`
  padding: 0 4px 9px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Group = styled.div`
  overflow: hidden;
  border-radius: 18px;
  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `;
  }}
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 14px 18px;
  flex-wrap: wrap;
  ${({ theme }: { theme?: ITheme }) => css`
    & + & {
      border-top: 1px solid ${getPalette(theme).line};
    }
  `}
`;

const Copy = styled.div`
  min-width: 220px;
  flex: 1;
`;

const fieldCss = (theme?: ITheme) => {
  const p = getPalette(theme);
  return css`
    height: 36px;
    padding: 0 12px;
    border-radius: 10px;
    font-family: inherit;
    font-size: 13px;
    outline: none;
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
};

const Select = styled.select`
  cursor: pointer;
  ${({ theme }: { theme?: ITheme }) => fieldCss(theme)}
`;

const NumberInput = styled.input`
  width: 110px;
  box-sizing: border-box;
  ${({ theme }: { theme?: ITheme }) => fieldCss(theme)}
`;

const Unit = styled.span`
  font-size: 13px;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const SiteRow = styled(Row)`
  padding: 10px 18px;
  font-size: 13.5px;
`;

const SiteName = styled.div`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const RemoveButton = styled.button`
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: transparent;
  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      &:hover {
        color: #e5484d;
        background-color: ${p.bg};
      }
    `;
  }}
`;

const setOption = (key: string, value: unknown) =>
  ipcRenderer.invoke('set-image-upload-option', key, value);

// 数值输入:本地 state,失焦/回车时落盘,避免每个按键都写设置。
const useCommittedNumber = (value: number, key: string) => {
  const [draft, setDraft] = React.useState(String(value || ''));
  React.useEffect(() => setDraft(String(value || '')), [value]);
  const commit = () => {
    const n = Math.round(Number(draft) || 0);
    if (n !== value) setOption(key, n);
  };
  return { draft, setDraft, commit };
};

export const ImageUpload = observer(() => {
  const t = getSettingsTranslator();
  const s = store.settings;
  const enabled = s.imageUploadInterceptEnabled !== false;
  const sites = Array.isArray(s.imageUploadBypassSites) ? s.imageUploadBypassSites : [];
  const target = useCommittedNumber(s.imageUploadTargetKB || 500, 'targetKB');
  const edge = useCommittedNumber(s.imageUploadMaxEdge || 0, 'maxEdge');

  return (
    <>
      <GroupBlock>
        <GroupLabel>{t('iuSettingsSection')}</GroupLabel>
        <Group>
          <Row>
            <SettingIcon tone="blue">
              <ImageIcon size={19} weight="fill" />
            </SettingIcon>
            <Copy>
              <Title>{t('iuSettingsEnable')}</Title>
              <SecondaryText>{t('iuSettingsEnableDesc')}</SecondaryText>
            </Copy>
            <Switch
              clickable
              value={enabled}
              onClick={() => setOption('enabled', !enabled)}
            />
          </Row>
        </Group>
      </GroupBlock>

      <div
        style={{
          opacity: enabled ? 1 : 0.45,
          pointerEvents: enabled ? 'auto' : 'none',
        }}
      >
        <GroupBlock>
          <GroupLabel>{t('iuSettingsDefaults')}</GroupLabel>
          <Group>
            <Row>
              <Copy>
                <Title>{t('iuSettingsDefaultMode')}</Title>
              </Copy>
              <Select
                value={
                  s.imageUploadDefaultMode && s.imageUploadDefaultMode !== 'original'
                    ? s.imageUploadDefaultMode
                    : 'lossless'
                }
                onChange={(e) => setOption('defaultMode', e.target.value)}
              >
                <option value="lossless">{t('iuModeLossless')}</option>
                <option value="target">{t('iuModeTarget')}</option>
                <option value="crop">{t('iuModeCrop')}</option>
              </Select>
            </Row>
            <Row>
              <Copy>
                <Title>{t('iuSettingsTargetKB')}</Title>
                <SecondaryText>{t('iuSettingsTargetKBDesc')}</SecondaryText>
              </Copy>
              <NumberInput
                type="number"
                min={10}
                value={target.draft}
                onChange={(e) => target.setDraft(e.target.value)}
                onBlur={target.commit}
                onKeyDown={(e) => e.key === 'Enter' && target.commit()}
              />
              <Unit>KB</Unit>
            </Row>
            <Row>
              <Copy>
                <Title>{t('iuSettingsMaxEdge')}</Title>
                <SecondaryText>{t('iuSettingsMaxEdgeDesc')}</SecondaryText>
              </Copy>
              <NumberInput
                type="number"
                min={0}
                placeholder={t('iuNoLimit')}
                value={edge.draft}
                onChange={(e) => edge.setDraft(e.target.value)}
                onBlur={edge.commit}
                onKeyDown={(e) => e.key === 'Enter' && edge.commit()}
              />
              <Unit>px</Unit>
            </Row>
          </Group>
        </GroupBlock>

        <GroupBlock>
          <GroupLabel>{t('iuSettingsBypass')}</GroupLabel>
          <Group>
            {sites.length === 0 ? (
              <Row>
                <SecondaryText>{t('iuSettingsBypassEmpty')}</SecondaryText>
              </Row>
            ) : (
              sites.map((site) => (
                <SiteRow key={site}>
                  <SiteName>{site}</SiteName>
                  <RemoveButton
                    title={t('remove')}
                    aria-label={`${t('remove')} ${site}`}
                    onClick={() =>
                      setOption(
                        'bypassSites',
                        sites.filter((x) => x !== site),
                      )
                    }
                  >
                    <Trash size={16} />
                  </RemoveButton>
                </SiteRow>
              ))
            )}
          </Group>
        </GroupBlock>
      </div>
    </>
  );
});
