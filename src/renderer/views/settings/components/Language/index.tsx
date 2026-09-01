import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Globe } from '@phosphor-icons/react';
import styled, { css } from 'styled-components';

import store from '../../store';
import {
  APP_LANGUAGES,
  resolveAppLanguage,
} from '~/common/i18n';
import { useI18n } from '~/renderer/components/I18n';
import { ITheme } from '~/interfaces';
import {
  Row,
  Title,
  Control,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingIcon,
} from '../App/style';
import { getPalette } from '../../utils/palette';

const Select = styled.select`
  min-width: 176px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  outline: none;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: ${p.bg};
      border: 1px solid ${p.line};
      &:hover,
      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

export const Language = observer(() => {
  const t = useI18n();
  const preference = store.settings.language || 'auto';
  const locale = resolveAppLanguage(
    preference,
    typeof navigator === 'undefined' ? undefined : navigator.language,
  );
  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    store.settings.language = event.target.value as typeof preference;
    store.save();
  };

  return (
    <SettingGroupBlock>
      <SettingGroup>
        <Row style={{ cursor: 'default' }}>
          <SettingIcon tone="cyan">
            <Globe size={19} weight="fill" />
          </SettingIcon>
          <SettingCopy>
            <Title>{t('languageTitle')}</Title>
            <SecondaryText>{t('languageDescription')}</SecondaryText>
          </SettingCopy>
          <Control>
            <Select
              value={preference}
              onChange={onChange}
              aria-label={t('languageTitle')}
            >
              {APP_LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {locale === 'en-US' ? option.nativeLabel : option.label}
                </option>
              ))}
            </Select>
          </Control>
        </Row>
        <Row style={{ cursor: 'default' }}>
          <SettingIcon tone="green">
            <Globe size={19} weight="regular" />
          </SettingIcon>
          <SettingCopy>
            <SecondaryText>
              {preference === 'auto'
                ? t('languageAutoHint')
                : t('languageRestartHint')}
            </SecondaryText>
          </SettingCopy>
        </Row>
      </SettingGroup>
    </SettingGroupBlock>
  );
});
