import * as React from 'react';
import { ipcRenderer } from '~/common/renderer-ipc';
import styled, { css } from 'styled-components';
import { Browser, CaretRight } from '@phosphor-icons/react';

import { ITheme } from '~/interfaces';
import {
  Row,
  SecondaryText,
  SettingCopy,
  SettingGroup,
  SettingGroupBlock,
  SettingGroupLabel,
  SettingIcon,
  Title,
} from '../App/style';
import store from '~/renderer/views/settings/store';
import { getPalette } from '../../utils/palette';

const APP_ICON = require('!!file-loader?esModule=false&outputPath=res!../../../../../../static/icons/icon.png');

const openUrl = (url: string) => {
  window.location.href = url;
};

const Svg = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  />
);

const IconChat = () => (
  <Svg>
    <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z" />
  </Svg>
);

const IconAuthor = () => (
  <Svg>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx={12} cy={7} r={4} />
  </Svg>
);

const IconGithub = () => (
  <Svg>
    <path d="M9 18c-3.5 1.1-3.5-1.9-5-2" />
    <path d="M15 21v-3.9a3.4 3.4 0 0 0-1-2.6c3.3-.4 6.8-1.6 6.8-7.1a5.5 5.5 0 0 0-1.5-3.8 5.1 5.1 0 0 0-.1-3.8s-1.2-.4-4 1.5a13.7 13.7 0 0 0-7.2 0C5.2-.6 4 .8 4 .8a5.1 5.1 0 0 0-.1 3.8 5.5 5.5 0 0 0-1.5 3.8c0 5.4 3.4 6.7 6.8 7.1a3.4 3.4 0 0 0-1 2.6V21" />
  </Svg>
);

const IconAndroid = () => (
  <Svg>
    <path d="M6 18V10a6 6 0 0 1 12 0v8M6 18h12M9 18v3M15 18v3M8.5 7l-1.5-2M15.5 7l1.5-2" />
    <circle cx={9.5} cy={11} r={0.6} fill="currentColor" stroke="none" />
    <circle cx={14.5} cy={11} r={0.6} fill="currentColor" stroke="none" />
  </Svg>
);

const IconHarmony = () => (
  <Svg>
    <path d="M12 3c4 4 6 6 6 9a6 6 0 0 1-12 0c0-3 2-5 6-9z" />
    <path d="M12 21v-6" />
  </Svg>
);

const IconApple = () => (
  <Svg>
    <path d="M16 13c0 3 2 4 2 4-.3.9-1.5 3-3 3-1 0-1.4-.6-2.5-.6S10.5 20 9.5 20C8 20 6 17 6 13.5 6 10 8 9 9.5 9c1 0 1.7.6 2.5.6S13 9 14.5 9c.8 0 2.2.3 3 1.6-1.3.8-1.5 1.6-1.5 2.4z" />
    <path d="M13 5c.6-.7 1-1.6 1-2.5-.9.1-1.9.6-2.5 1.3-.5.6-1 1.5-.9 2.4 1 .1 1.8-.4 2.4-1.2z" />
  </Svg>
);

// 开源版：外部链接仅保留 GitHub 仓库与 Issues。
const APP_LINKS = [
  {
    title: 'Auj625197595/rainsee-pc',
    meta: '开源地址',
    actionLabel: '查看仓库',
    icon: <IconGithub />,
    onClick: () => openUrl('https://github.com/Auj625197595/rainsee-pc'),
  },
  {
    title: '问题反馈 (Issues)',
    meta: 'GitHub Issues',
    actionLabel: '提交反馈',
    icon: <IconChat />,
    onClick: () =>
      openUrl('https://github.com/Auj625197595/rainsee-pc/issues'),
  },
];

const PRODUCT_LINKS = [
  {
    title: '雨见浏览器安卓版',
    subtitle: 'Android',
    meta: '首发推荐',
    actionLabel: '获取方式',
    icon: <IconAndroid />,
    message: '开源版暂不提供安卓版下载渠道。',
  },
  {
    title: '雨见浏览器鸿蒙版',
    subtitle: 'HarmonyOS',
    meta: '应用市场',
    actionLabel: '获取方式',
    icon: <IconHarmony />,
    message: '请前往华为应用商店搜索“雨见”下载鸿蒙版。',
  },
  {
    title: '雨见浏览器苹果端',
    subtitle: 'iPhone / iPad',
    meta: 'App Store',
    actionLabel: '获取方式',
    icon: <IconApple />,
    message: '请前往 App Store 搜索“雨见”下载苹果端。',
  },
];

const detectChromeVersion = () => {
  try {
    const matches = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    if (matches) {
      return matches[1];
    }
  } catch (error) {
    console.log(error);
  }

  return navigator.userAgent;
};

export const About = () => {
  const chromeVersion = detectChromeVersion();
  const [notice, setNotice] = React.useState('');

  React.useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(''), 2600);

    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <Page>
      <SettingGroupBlock>
        <SettingGroup>
          <Row style={{ cursor: 'default' }}>
            <SettingIcon tone="blue">
              <Browser size={19} weight="fill" />
            </SettingIcon>
            <SettingCopy>
              <Title>雨见浏览器</Title>
              <SecondaryText>
                RainPC · APP 版本 {store.appVersion} · Chromium {chromeVersion}
              </SecondaryText>
            </SettingCopy>
          </Row>
        </SettingGroup>
      </SettingGroupBlock>

      <SettingGroupBlock>
        <SettingGroupLabel>支持与反馈</SettingGroupLabel>
        <SettingGroup>
          {APP_LINKS.map((item) => (
            <Row key={item.title} onClick={item.onClick}>
              <AboutItemIcon tone="blue">{item.icon}</AboutItemIcon>
              <SettingCopy>
                <Title>{item.meta}</Title>
                <SecondaryText>{item.title}</SecondaryText>
              </SettingCopy>
              <CaretRight size={17} color="#B0B0BA" />
            </Row>
          ))}
        </SettingGroup>
      </SettingGroupBlock>

      <SettingGroupBlock>
        <SettingGroupLabel>其他作品</SettingGroupLabel>
        <SettingGroup>
          {PRODUCT_LINKS.map((item) => (
            <Row
              key={item.title}
              onClick={() => {
                if (item.message) {
                  setNotice(item.message);
                }
              }}
            >
              <AboutItemIcon tone="blue">{item.icon}</AboutItemIcon>
              <SettingCopy>
                <Title>{item.title}</Title>
                <SecondaryText>{item.subtitle}</SecondaryText>
              </SettingCopy>
              <CaretRight size={17} color="#B0B0BA" />
            </Row>
          ))}
        </SettingGroup>
      </SettingGroupBlock>

      <SettingGroupBlock>
        <SettingGroup>
          <Row onClick={() => ipcRenderer.invoke('show-onboarding')}>
            <SettingCopy>
              <Title>查看引导页</Title>
            </SettingCopy>
            <CaretRight size={17} color="#B0B0BA" />
          </Row>
          <Row onClick={() => ipcRenderer.invoke('open-log-dir')}>
            <SettingCopy>
              <Title>打开日志目录</Title>
            </SettingCopy>
            <CaretRight size={17} color="#B0B0BA" />
          </Row>
        </SettingGroup>
      </SettingGroupBlock>

      <Toast visible={Boolean(notice)}>{notice}</Toast>
    </Page>
  );
};

const Page = styled.div`
  position: relative;
  padding-bottom: 24px;
`;

const AboutItemIcon = styled(SettingIcon)`
  svg {
    width: 19px;
    height: 19px;
  }
`;

const FooterNote = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 28px;
`;

const FooterLink = styled.button`
  border: none;
  background: transparent;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: opacity 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).primary};

    &:hover {
      opacity: 0.7;
    }
  `}
`;

const FooterDivider = styled.span`
  width: 1px;
  height: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    background: ${getPalette(theme).line};
  `}
`;

const HeroCard = styled.section`
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 44px 28px 34px;
  border-radius: 30px;
  margin-bottom: 26px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: radial-gradient(
          circle at top,
          rgba(91, 167, 255, 0.2),
          transparent 42%
        ),
        linear-gradient(145deg, ${p.surface} 0%, ${p.bg} 100%);
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const HeroGlow = styled.div`
  position: absolute;
  inset: -30% auto auto -10%;
  width: 240px;
  height: 240px;
  border-radius: 999px;
  pointer-events: none;
  background: radial-gradient(
    circle,
    rgba(104, 214, 209, 0.2) 0%,
    rgba(104, 214, 209, 0) 72%
  );
`;

const LogoWrap = styled.div`
  position: relative;
  z-index: 1;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 34px;
  margin-bottom: 18px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: linear-gradient(180deg, ${p.bg} 0%, ${p.surface} 100%);
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const LogoImage = styled.img`
  width: 96px;
  height: 96px;
  display: block;
  object-fit: contain;
`;

const BrandName = styled.h2`
  position: relative;
  z-index: 1;
  margin: 0;
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -0.04em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const BrandMeta = styled.div`
  position: relative;
  z-index: 1;
  margin-top: 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const VersionRow = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
`;

const VersionPill = styled.div`
  padding: 9px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const HeroDescription = styled.p`
  position: relative;
  z-index: 1;
  max-width: 560px;
  margin: 18px 0 0;
  line-height: 1.75;
  font-size: 14px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Section = styled.section`
  margin-top: 24px;
`;

const SectionTitle = styled.h3`
  margin: 0 0 14px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const BaseCard = styled.button`
  width: 100%;
  border: none;
  text-align: left;
  padding: 0;
  cursor: pointer;
  transition: transform 0.18s ease, background-color 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      color: ${p.textMain};

      &:hover {
        background-color: ${p.primarySoft};
        transform: translateY(-1px);
      }
    `;
  }}
`;

const ActionArrow = styled.span`
  font-size: 14px;
  line-height: 1;
`;

const SupportGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

const SupportCard = styled(BaseCard)`
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 92px;
  padding: 18px 20px;
  border-radius: 24px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};

      &:hover {
        background-color: ${p.surface};
        box-shadow: inset 0 0 0 1px ${p.primary};
        transform: translateY(-2px);
      }
    `;
  }}
`;

const SupportIcon = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 16px;

  svg {
    width: 22px;
    height: 22px;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `;
  }}
`;

const SupportBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const SupportMeta = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const SupportTitle = styled.div`
  margin-top: 6px;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const SupportCta = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).primary};
  `}
`;

const WorksGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const WorkCard = styled(BaseCard)`
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 200px;
  padding: 22px 22px 20px;
  border-radius: 26px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background: linear-gradient(160deg, ${p.surface} 0%, ${p.bg} 100%);
      box-shadow: inset 0 0 0 1px ${p.line};

      &:hover {
        background: linear-gradient(160deg, ${p.surface} 0%, ${p.bg} 100%);
        box-shadow: inset 0 0 0 1px ${p.primary};
        transform: translateY(-2px);
      }
    `;
  }}
`;

const WorkTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const WorkIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 15px;

  svg {
    width: 24px;
    height: 24px;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.primary};
      background-color: ${p.primarySoft};
    `;
  }}
`;

const WorkMeta = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const WorkBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin: 18px 0;
`;

const WorkTitle = styled.div`
  font-size: 20px;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: -0.02em;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const WorkSubtitle = styled.div`
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const WorkAction = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).primary};
  `}
`;

const Toast = styled.div<{ visible: boolean }>`
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%)
    ${({ visible }) => (visible ? 'translateY(0)' : 'translateY(12px)')};
  min-width: 280px;
  max-width: min(520px, calc(100vw - 40px));
  padding: 12px 16px;
  border-radius: 16px;
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
  pointer-events: none;
  opacity: ${({ visible }) => (visible ? 1 : 0)};
  transition: opacity 0.18s ease, transform 0.18s ease;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background: rgba(255, 255, 255, 0.88);
      box-shadow: inset 0 0 0 1px ${p.line},
        0 18px 38px -26px rgba(25, 49, 86, 0.45);
      backdrop-filter: blur(14px);
    `;
  }}
`;
