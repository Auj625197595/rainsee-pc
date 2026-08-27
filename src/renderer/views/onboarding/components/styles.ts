import styled, { createGlobalStyle, css, keyframes } from 'styled-components';

// —— 设计稿色板（tailwind config 翻译）——
export const C = {
  primary: '#3452FF',
  primaryDeep: '#2A3FCC',
  primarySoft: '#EEF2FF',
  bgLight: '#F5F7FD',
  chromeLine: '#E8ECF7',
  textMain: '#161B2D',
  textSub: '#75809A',
  textMute: '#A8B2C7',
  border: '#EAEEFB',
  white: '#ffffff',
};

const SHADOW = {
  shell: '0 6px 20px rgba(23, 35, 79, 0.08)',
  float: '0 3px 10px rgba(60, 93, 255, 0.10)',
  soft: '0 1px 2px rgba(20, 32, 72, 0.04)',
  cta: '0 4px 12px rgba(52, 82, 255, 0.18)',
};

export const FONT_STACK =
  "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif";

// —— 动画 ——
const floaty = keyframes`
  0%, 100% { transform: translateY(0) rotate(-6deg); }
  50% { transform: translateY(-10px) rotate(-6deg); }
`;
// 全局进入动画：App.tsx 的 anim() 内联 style 按名字引用（createGlobalStyle 注入 document，
// 名字固定为 onbFadeUp，可被内联 style 的 animation 属性识别）。
export const OnboardingKeyframes = createGlobalStyle`
  @keyframes onbFadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

// —— 整屏容器：冷白径向渐变背景 ——
export const Root = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  font-family: ${FONT_STACK};
  color: ${C.textMain};
  user-select: none;
  overflow: hidden;
  background:
    radial-gradient(circle at 10% 12%, rgba(152, 177, 255, 0.38), transparent 26%),
    radial-gradient(circle at 88% 16%, rgba(183, 216, 255, 0.52), transparent 24%),
    radial-gradient(circle at 78% 82%, rgba(211, 224, 255, 0.40), transparent 28%),
    linear-gradient(145deg, #f8faff 0%, #f2f6ff 48%, #eef3fb 100%);
`;

// —— 顶栏 ——
export const Header = styled.header`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 56px;
  z-index: 20;
  -webkit-app-region: drag;
`;
export const LogoBox = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  -webkit-app-region: no-drag;
`;
export const LogoMark = styled.img`
  width: 40px;
  height: 40px;
  border-radius: 13px;
  box-shadow: ${SHADOW.float};
  transform: rotate(-6deg);
  object-fit: contain;
`;
export const BrandText = styled.span`
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: ${C.textMain};
`;
export const SkipButton = styled.button`
  -webkit-app-region: no-drag;
  padding: 8px 20px;
  border-radius: 9999px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  color: ${C.textSub};
  transition: transform 0.15s ease, background 0.2s ease, color 0.2s ease;
  &:hover {
    background: rgba(52, 82, 255, 0.08);
    color: ${C.primary};
  }
  &:active {
    transform: scale(0.96);
  }
`;

// —— 滑动主体 ——
export const Main = styled.main`
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
`;
export const SliderTrack = styled.div<{$page: number}>`
  display: flex;
  height: 100%;
  will-change: transform;
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  transform: translateX(${({$page}) => `-${$page * 100}%`});
`;
export const Slide = styled.section`
  width: 100%;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

// —— 第 1 页 ——
export const Page1Wrap = styled.div`
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 16px 32px 140px;
  box-sizing: border-box;
  text-align: center;
`;
export const Page1Content = styled.div`
  width: min(100%, 560px);
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 auto;
`;
export const HeroIcon = styled.div`
  width: 112px;
  height: 112px;
  background: ${C.primary};
  border-radius: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: ${SHADOW.shell};
  color: #fff;
  animation: ${floaty} 5s ease-in-out infinite;
`;
export const HeroTitle = styled.h1`
  width: 100%;
  font-size: 48px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: ${C.textMain};
  margin: 32px 0 16px;
`;
export const HeroSubtitle = styled.p`
  width: 100%;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.7;
  color: ${C.textSub};
  margin: 0;
`;
export const PrivacyCard = styled.div`
  background: rgba(255, 255, 255, 0.9);
  border-radius: 24px;
  padding: 20px;
  margin-top: 40px;
  width: 100%;
  margin-left: auto;
  margin-right: auto;
  max-width: 560px;
  text-align: left;
  border: 1px solid ${C.chromeLine};
  box-shadow: ${SHADOW.soft};
  box-sizing: border-box;
`;
export const PrivacyTitle = styled.h3`
  font-size: 14px;
  font-weight: 800;
  color: ${C.textMain};
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
`;
export const PrivacyText = styled.p`
  font-size: 13px;
  line-height: 1.7;
  color: ${C.textSub};
  margin: 0;
`;
export const LinkA = styled.a`
  color: ${C.primary};
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

// —— 第 2 / 3 页标题 ——
export const PageHead = styled.div`
  text-align: center;
  margin-bottom: 28px;
`;
export const PageTitle = styled.h2`
  font-size: 38px;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: ${C.textMain};
  margin: 0;
`;
export const PageSubtitle = styled.p`
  font-size: 15px;
  font-weight: 600;
  color: ${C.textSub};
  margin: 6px 0 0;
`;

// —— 第 2 页：特性网格 ——
export const Page2Wrap = styled.div`
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 16px 56px 140px;
  max-width: 1180px;
  margin: 0 auto;
  box-sizing: border-box;
`;
export const FeaturesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 16px;
`;
export const FeatureCard = styled.div`
  background: #fff;
  border: 1px solid ${C.border};
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  transition: border-color 0.2s ease, transform 0.2s ease;
  &:hover {
    border-color: #d5dfff;
    transform: translateY(-2px);
  }
`;
export const FeatureIconWrap = styled.div<{$bg: string; $fg: string}>`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({$bg}) => $bg};
  color: ${({$fg}) => $fg};
  margin-bottom: 16px;
`;
export const FeatureTitle = styled.h3`
  font-size: 16px;
  font-weight: 800;
  color: ${C.textMain};
  margin: 0;
`;
export const FeatureTag = styled.p<{$color: string}>`
  font-size: 12.5px;
  font-weight: 700;
  color: ${({$color}) => $color};
  margin: 4px 0 0;
`;
export const FeatureDesc = styled.p`
  font-size: 12.5px;
  line-height: 1.6;
  color: ${C.textSub};
  margin: 8px 0 0;
`;

// —— 第 3 页：浏览数据迁移 ——
export const MigrationPageWrap = styled.div`
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 16px 38px 120px;
  max-width: 1100px;
  margin: 0 auto;
  box-sizing: border-box;
`;
export const MigrationCards = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
`;
export const MigrationCard = styled.div`
  min-width: 0;
  min-height: 250px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 22px;
  box-sizing: border-box;
  border: 1px solid ${C.border};
  border-radius: 18px;
  background: #fff;
  box-shadow: ${SHADOW.soft};
`;
export const MigrationCardIcon = styled.div<{$bg: string; $fg: string}>`
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 15px;
  color: ${({$fg}) => $fg};
  background: ${({$bg}) => $bg};
`;
export const MigrationCardBody = styled.div`
  flex: 1;
  width: 100%;
  margin-top: 20px;
`;
export const MigrationCardTitle = styled.h3`
  margin: 0;
  font-size: 19px;
  font-weight: 900;
  color: ${C.textMain};
`;
export const MigrationCardText = styled.p`
  margin: 7px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: ${C.textSub};
`;
export const MigrationBrowserTags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 15px;
  span {
    padding: 5px 9px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    color: ${C.textSub};
    background: ${C.bgLight};
  }
`;
export const MigrationAction = styled.button`
  max-width: 100%;
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 14px;
  border: 1px solid rgba(52, 82, 255, 0.24);
  border-radius: 8px;
  color: ${C.primaryDeep};
  background: ${C.primarySoft};
  font: 800 13px ${FONT_STACK};
  cursor: pointer;
  overflow-wrap: anywhere;
  transition: border-color 0.18s ease, background 0.18s ease;
  &:hover { border-color: ${C.primary}; background: #e4e9ff; }
`;

// —— 迁移弹窗 ——
export const ImportOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  box-sizing: border-box;
  background: rgba(20, 27, 45, 0.48);
  -webkit-app-region: no-drag;
`;
export const ImportDialog = styled.div`
  width: min(680px, 100%);
  max-height: min(680px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(20, 27, 45, 0.3);
`;
export const ImportHeader = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 58px;
  padding: 0 18px 0 22px;
  border-bottom: 1px solid ${C.chromeLine};
`;
export const ImportHeading = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 17px;
  font-weight: 900;
`;
export const ImportIconButton = styled.button`
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  color: ${C.textSub};
  background: transparent;
  cursor: pointer;
  &:hover:not(:disabled) { color: ${C.textMain}; background: ${C.bgLight}; }
  &:disabled { opacity: 0.45; cursor: default; }
`;
export const ImportBody = styled.div`
  min-height: 250px;
  padding: 22px;
  box-sizing: border-box;
  overflow-y: auto;
`;
export const BrowserList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 9px;
`;
export const BrowserOption = styled.button`
  width: 100%;
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border: 1px solid ${C.border};
  border-radius: 8px;
  color: ${C.textMain};
  background: #fff;
  font: 800 14px ${FONT_STACK};
  cursor: pointer;
  &:hover:not(:disabled) { border-color: ${C.primary}; background: #fbfcff; }
  &:disabled { opacity: 0.52; cursor: default; }
`;
export const BrowserDot = styled.span<{$color: string}>`
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({$color}) => $color};
`;
export const BrowserState = styled.span`
  margin-left: auto;
  font-size: 12px;
  color: ${C.textMute};
`;
export const ImportConfirm = styled.div`
  min-height: 210px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: ${C.primary};
`;
export const ImportConfirmTitle = styled.h3`
  margin: 13px 0 0;
  color: ${C.textMain};
  font-size: 18px;
`;
export const ImportConfirmText = styled.p`
  margin: 7px 0 0;
  color: ${C.textSub};
  font-size: 13px;
`;
export const ImportToolbar = styled.div`
  flex-shrink: 0;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid ${C.chromeLine};
`;
export const SelectAllButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  color: ${C.textMain};
  background: transparent;
  font: 800 13px ${FONT_STACK};
  cursor: pointer;
  &:disabled { opacity: 0.45; cursor: default; }
`;
export const SelectDirectoryButton = styled(SelectAllButton)`
  color: ${C.primary};
`;
export const ImportCheckbox = styled.span<{$checked: boolean}>`
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px solid ${({$checked}) => $checked ? C.primary : '#cbd3e4'};
  border-radius: 4px;
  color: #fff;
  background: ${({$checked}) => $checked ? C.primary : '#fff'};
`;
export const ExtensionList = styled.div`
  min-height: 260px;
  max-height: 410px;
  overflow-y: auto;
  padding: 8px 12px;
`;
export const ExtensionRow = styled.button<{$checked: boolean}>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 9px 10px;
  border: 0;
  border-bottom: 1px solid ${C.chromeLine};
  text-align: left;
  color: ${C.textMain};
  background: ${({$checked}) => $checked ? '#f8faff' : '#fff'};
  cursor: pointer;
  &:hover { background: ${C.bgLight}; }
`;
export const ExtensionIcon = styled.div`
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${C.textSub};
  img { width: 30px; height: 30px; object-fit: contain; }
`;
export const ExtensionInfo = styled.div`
  min-width: 0;
  flex: 1;
`;
export const ExtensionName = styled.div`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 800;
`;
export const ExtensionMeta = styled.div`
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: ${C.textSub};
`;
export const ImportEmpty = styled.div`
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: ${C.textSub};
  font-size: 13px;
`;
export const ImportSpinner = styled.span`
  width: 24px;
  height: 24px;
  border: 3px solid #dce3f3;
  border-top-color: ${C.primary};
  border-radius: 50%;
  animation: onbSpin 0.8s linear infinite;
  @keyframes onbSpin { to { transform: rotate(360deg); } }
`;
export const ImportFooter = styled.div`
  flex-shrink: 0;
  min-height: 66px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
  box-sizing: border-box;
  border-top: 1px solid ${C.chromeLine};
`;
export const ImportStatus = styled.div<{$error: boolean}>`
  min-width: 0;
  flex: 1;
  font-size: 12px;
  line-height: 1.45;
  color: ${({$error}) => $error ? '#c2413b' : C.textSub};
`;
export const ImportActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;
export const ImportButton = styled.button<{$primary?: boolean}>`
  min-width: 74px;
  min-height: 36px;
  padding: 8px 13px;
  border: 1px solid ${({$primary}) => $primary ? C.primary : C.border};
  border-radius: 7px;
  color: ${({$primary}) => $primary ? '#fff' : C.textMain};
  background: ${({$primary}) => $primary ? C.primary : '#fff'};
  font: 800 13px ${FONT_STACK};
  cursor: pointer;
  &:disabled { opacity: 0.45; cursor: default; }
`;

// —— 第 3 页 ——
export const Page3Wrap = styled.div`
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px 56px 140px;
  max-width: 920px;
  margin: 0 auto;
  box-sizing: border-box;
`;
export const SettingsList = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;
export const SectionHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 4px;
`;
export const SectionLabel = styled.h3`
  font-size: 16px;
  font-weight: 800;
  color: ${C.textMain};
  margin: 0;
`;
export const SectionHint = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: ${C.textMute};
`;

// 可选卡片网格（主题 / 标签位置）
export const PickGrid = styled.div<{$cols: number}>`
  display: grid;
  grid-template-columns: repeat(${({$cols}) => $cols}, 1fr);
  gap: 16px;
`;
export const PickCard = styled.div<{$active?: boolean; $row?: boolean}>`
  position: relative;
  cursor: pointer;
  border: 2px solid ${({$active}) => ($active ? C.primary : C.border)};
  background: ${({$active}) => ($active ? C.primarySoft : '#FBFCFF')};
  border-radius: 16px;
  padding: ${({$row}) => ($row ? '16px' : '14px')};
  display: flex;
  ${({$row}) =>
    $row
      ? 'flex-direction: row; align-items: center; gap: 16px;'
      : 'flex-direction: column; align-items: center;'}
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s;
  &:hover {
    border-color: ${({$active}) => ($active ? C.primary : '#C7D3FF')};
    transform: translateY(-2px);
  }
`;
export const CheckBadge = styled.span<{$active?: boolean}>`
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${C.primary};
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: ${({$active}) => ($active ? 1 : 0)};
  transform: ${({$active}) => ($active ? 'scale(1)' : 'scale(0.6)')};
  transition: opacity 0.2s ease, transform 0.2s ease;
`;
export const PickPreview = styled.div<{$variant: string}>`
  width: 100%;
  border-radius: 8px;
  border: 1px solid ${C.chromeLine};
  overflow: hidden;
  background: ${({$variant}) =>
    $variant === 'dark' ? '#1f2937' : $variant === 'half' ? '#fff' : '#fff'};
  ${({$variant}) =>
    $variant === 'half' &&
    css`
      display: flex;
      & > div {
        width: 50%;
      }
    `}
`;
export const PickLabel = styled.span<{$active?: boolean; $mt?: boolean}>`
  font-size: 14px;
  font-weight: 800;
  color: ${({$active}) => ($active ? C.primaryDeep : C.textMain)};
  margin-top: ${({$mt}) => ($mt ? '10px' : '0')};
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

// 通用设置面板行（启动行为 / 广告拦截 / 手势）
export const Panel = styled.div`
  background: #fff;
  border: 1px solid ${C.border};
  border-radius: 22px;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;
export const PanelLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;
export const PanelIconBox = styled.div<{$bg: string; $fg: string}>`
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({$bg}) => $bg};
  color: ${({$fg}) => $fg};
  flex-shrink: 0;
`;
export const PanelTitle = styled.span`
  display: block;
  font-size: 15px;
  font-weight: 800;
  color: ${C.textMain};
`;
export const PanelSub = styled.span`
  display: block;
  font-size: 12px;
  color: ${C.textSub};
  margin-top: 2px;
`;

// 启动行为下拉
export const SelectWrap = styled.div`
  position: relative;
`;
export const StartupSelect = styled.select`
  appearance: none;
  background: ${C.primarySoft};
  color: ${C.primaryDeep};
  font-family: inherit;
  font-weight: 800;
  font-size: 14px;
  padding: 10px 36px 10px 16px;
  border-radius: 12px;
  border: 2px solid rgba(52, 82, 255, 0.2);
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  &:hover {
    border-color: rgba(52, 82, 255, 0.45);
  }
  &:focus {
    border-color: ${C.primary};
    box-shadow: 0 0 0 3px rgba(52, 82, 255, 0.15);
  }
`;
export const SelectCaret = styled.span`
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: ${C.primary};
  pointer-events: none;
  display: flex;
  align-items: center;
`;

// 开关
export const Toggle = styled.div<{$active?: boolean}>`
  position: relative;
  width: 48px;
  height: 28px;
  border-radius: 9999px;
  background: ${({$active}) => ($active ? C.primary : '#D3D8E6')};
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.3s;
  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    transform: ${({$active}) => ($active ? 'translateX(20px)' : 'translateX(0)')};
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
`;

// 手势插画区
export const GesturePanel = styled(Panel)`
  flex-direction: column;
  align-items: stretch;
  padding: 20px;
`;
export const GesturePanelTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;
export const GestureRow = styled.div`
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
`;
export const GestureItem = styled.div`
  background: #fffbeb;
  border-radius: 12px;
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;
export const GestureName = styled.span`
  font-size: 11px;
  font-weight: 800;
  color: ${C.textMain};
`;
export const GestureNote = styled.p`
  font-size: 11px;
  color: ${C.textMute};
  margin: 10px 0 0;
  display: flex;
  align-items: center;
  gap: 4px;
`;

// —— 悬浮主按钮 ——
export const FloatingCTAWrap = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 64px;
  display: flex;
  justify-content: center;
  z-index: 30;
  padding: 0 32px;
  box-sizing: border-box;
  pointer-events: none;
`;
export const PrimaryButton = styled.button`
  pointer-events: auto;
  min-width: 280px;
  padding: 16px 48px;
  border: none;
  border-radius: 18px;
  background: linear-gradient(135deg, #3452ff 0%, #2a3fcc 100%);
  box-shadow: ${SHADOW.cta};
  color: #fff;
  font-family: inherit;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: transform 0.15s ease, filter 0.2s ease;
  &:hover {
    transform: translateY(-1px);
    filter: brightness(1.04);
  }
  &:active {
    transform: translateY(0) scale(0.99);
  }
`;

// —— 底栏 ——
export const Footer = styled.footer`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 32px 24px;
  position: relative;
  z-index: 20;
`;
export const FooterCenter = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 280px;
  text-align: center;
`;
export const BackButton = styled.button<{$visible?: boolean}>`
  position: absolute;
  left: 56px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 9999px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  color: ${C.textSub};
  opacity: ${({$visible}) => ($visible ? 1 : 0)};
  pointer-events: ${({$visible}) => ($visible ? 'auto' : 'none')};
  transition: opacity 0.3s ease, background 0.2s ease, color 0.2s ease;
  &:hover {
    background: rgba(52, 82, 255, 0.08);
    color: ${C.primary};
  }
`;
export const Dots = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;
export const Dot = styled.div<{$active?: boolean}>`
  cursor: pointer;
  border-radius: 9999px;
  background: ${({$active}) => ($active ? C.primary : 'rgba(168,178,199,0.5)')};
  width: ${({$active}) => ($active ? '28px' : '8px')};
  height: 8px;
  transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1);
`;
export const ExitButton = styled.button`
  -webkit-app-region: no-drag;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  color: ${C.textMute};
  transition: color 0.2s ease;
  &:hover {
    color: ${C.textSub};
  }
`;

// —— 协议弹窗（iframe 加载协议页，不跳转）——
export const AgreementOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(20, 27, 45, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  -webkit-app-region: no-drag;
`;
export const AgreementDialog = styled.div`
  width: 100%;
  max-width: 880px;
  height: 100%;
  max-height: 82vh;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(20, 27, 45, 0.3);
`;
export const AgreementHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid ${C.chromeLine};
  flex-shrink: 0;
`;
export const AgreementTitle = styled.span`
  font-size: 15px;
  font-weight: 800;
  color: ${C.textMain};
`;
export const AgreementClose = styled.button`
  border: none;
  background: transparent;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${C.textSub};
  transition: background 0.15s ease, color 0.15s ease;
  &:hover {
    background: ${C.bgLight};
    color: ${C.textMain};
  }
`;
export const AgreementFrame = styled.iframe`
  flex: 1;
  width: 100%;
  border: none;
  background: #fff;
`;
