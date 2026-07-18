import * as React from 'react';
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { ipcRenderer } from '~/common/renderer-ipc';
import * as S from './styles';
import { C } from './styles';

// 应用图标：内联 file-loader 加载（与 Titlebar/About 一致，!! 前缀绕过 webpack5 asset module）
const APP_ICON = require('!!file-loader?esModule=false&outputPath=res!../../../../../static/icons/icon.png');
import {
  CompassTool,
  ShieldCheck,
  MagnifyingGlass,
  PlayCircle,
  DeviceMobile,
  Sparkle,
  Sun,
  Moon,
  Monitor,
  Rectangle,
  SidebarSimple,
  RocketLaunch,
  HandPointing,
  ArrowLeft,
  ArrowRight,
  Check,
  CaretDown,
  GearSix,
  X,
} from '@phosphor-icons/react';

type ThemeChoice = 'system' | 'light' | 'dark';
type TabChoice = 'left' | 'top';
type StartupChoice = 'continue' | 'empty';

const TOTAL = 3;

// 第 2 页 5 张特性卡（图标 / 配色 / 文案 1:1 对照设计稿）
const FEATURES = [
  {
    Icon: MagnifyingGlass, bg: '#3452FF', fg: '#fff',
    title: '搜索引擎标注', tag: '一眼获得你想要的答案',
    tagColor: '#3452FF', desc: 'AI 标注搜索结果，关键答案直达眼前。',
  },
  {
    Icon: ShieldCheck, bg: '#DCFCE7', fg: '#16A34A',
    title: '广告过滤', tag: '干净纯粹的阅读',
    tagColor: '#16A34A', desc: '强效拦截广告与追踪，告别弹窗。',
  },
  {
    Icon: PlayCircle, bg: '#F3E8FF', fg: '#9333EA',
    title: '智能播放器', tag: '支持 m3u8 下载',
    tagColor: '#9333EA', desc: '视频弹出独立播放器，一键下载。',
  },
  {
    Icon: DeviceMobile, bg: '#FFEDD5', fg: '#EA580C',
    title: '移动互联', tag: '共享书签、历史',
    tagColor: '#EA580C', desc: '扫码连接手机，多端实时同步。',
  },
  {
    Icon: Sparkle, bg: '#FCE7F3', fg: '#DB2777',
    title: 'AI 深度结合', tag: '右键问 AI · 网页总结',
    tagColor: '#DB2777', desc: '智能搜索推荐，浏览与创作提效。',
  },
];

export default function App() {
  const [page, setPage] = useState(0);
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [tabbar, setTabbar] = useState<TabChoice>('left');
  const [startup, setStartup] = useState<StartupChoice>('continue');
  const [adblock, setAdblock] = useState(true);
  const [gestures, setGestures] = useState(true);
  const [agreement, setAgreement] = useState<{url: string; title: string} | null>(null);

  const go = (i: number) => setPage(Math.max(0, Math.min(TOTAL - 1, i)));
  const next = () => go(page + 1);
  const prev = () => go(page - 1);

  // 完成（「开启浏览之旅」或顶栏「跳过引导」共用）：组装 partial 并通知主进程
  const finish = () => {
    const partial: Record<string, unknown> = {
      themeAuto: theme === 'system',
      tabsLayout: tabbar,
      startupBehavior: { type: startup },
      shield: adblock,
      mouseGesturesEnabled: gestures,
    };
    if (theme !== 'system') {
      partial.theme = theme === 'dark' ? 'wexond-dark' : 'wexond-light';
    }
    ipcRenderer.send('onboarding-complete', partial);
  };

  const ctaAction = () => {
    if (page < TOTAL - 1) next();
    else finish();
  };

  const exitApp = () => {
    ipcRenderer.send('onboarding-exit');
  };

  // 键盘左右导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(page + 1);
      else if (e.key === 'ArrowLeft') go(page - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [page]);

  // 协议链接：弹窗内 iframe 加载（不跳转、不开系统浏览器）
  const openAgreement = (url: string, title: string) => setAgreement({url, title});

  return (
    <S.Root>
      <S.OnboardingKeyframes />
      {/* 顶栏 */}
      <S.Header>
        <S.LogoBox>
          <S.LogoMark src={APP_ICON} alt="雨见浏览器" />
          <S.BrandText>雨见浏览器</S.BrandText>
        </S.LogoBox>
        <S.SkipButton onClick={finish}>跳过引导</S.SkipButton>
      </S.Header>

      {/* 滑动主体 */}
      <S.Main>
        <S.SliderTrack $page={page}>
          {/* —— 第 1 页：欢迎 + 隐私 —— */}
          <S.Slide>
            <S.Page1Wrap>
              <S.Page1Content>
                <S.HeroTitle style={anim(0.12)}>全新探索体验</S.HeroTitle>
                <S.HeroSubtitle style={anim(0.18)}>
                  快、纯粹、智能。
                  <br />
                  为你重新定义桌面浏览。
                </S.HeroSubtitle>
                <S.PrivacyCard style={anim(0.24)}>
                  <S.PrivacyTitle>
                    <ShieldCheck size={18} weight="fill" color={C.primary} />
                    隐私与安全
                  </S.PrivacyTitle>
                  <S.PrivacyText>
                    我们将严格保护您的数据安全。继续使用即表示您同意我们的
                    <S.LinkA onClick={() => openAgreement('https://www.zhso.org/post/2062', '用户协议')}>
                      《用户协议》
                    </S.LinkA>
                    与
                    <S.LinkA onClick={() => openAgreement('https://www.zhso.org/post/2065', '隐私政策')}>
                      《隐私政策》
                    </S.LinkA>
                    。
                  </S.PrivacyText>
                </S.PrivacyCard>
              </S.Page1Content>
            </S.Page1Wrap>
          </S.Slide>

          {/* —— 第 2 页：核心特性 —— */}
          <S.Slide>
            <S.Page2Wrap>
              <S.PageHead>
                <S.PageTitle style={anim(0.05)}>为您量身打造</S.PageTitle>
                <S.PageSubtitle style={anim(0.1)}>
                  每一个能力，都为更高效的桌面浏览而生
                </S.PageSubtitle>
              </S.PageHead>
              <S.FeaturesGrid>
                {FEATURES.map((f, i) => (
                  <S.FeatureCard key={f.title} style={anim(0.15 + i * 0.05)}>
                    <S.FeatureIconWrap $bg={f.bg} $fg={f.fg}>
                      <f.Icon size={24} weight="fill" />
                    </S.FeatureIconWrap>
                    <S.FeatureTitle>{f.title}</S.FeatureTitle>
                    <S.FeatureTag $color={f.tagColor}>{f.tag}</S.FeatureTag>
                    <S.FeatureDesc>{f.desc}</S.FeatureDesc>
                  </S.FeatureCard>
                ))}
              </S.FeaturesGrid>
            </S.Page2Wrap>
          </S.Slide>

          {/* —— 第 3 页：快速设置 —— */}
          <S.Slide>
            <S.Page3Wrap>
              <S.PageHead>
                <S.PageTitle style={{ ...anim(0.05), fontSize: '34px' }}>最后一步</S.PageTitle>
                <S.PageSubtitle style={anim(0.1)}>
                  根据您的喜好快速配置，随时可在设置中修改
                </S.PageSubtitle>
              </S.PageHead>

              <S.SettingsList>
                {/* 外观主题 */}
                <div style={anim(0.15)}>
                  <S.SectionHead>
                    <S.SectionLabel>外观主题</S.SectionLabel>
                    <S.SectionHint>跟随系统的明暗切换，护眼又省心</S.SectionHint>
                  </S.SectionHead>
                  <S.PickGrid $cols={3}>
                    {([
                      { key: 'light' as ThemeChoice, label: '浅色', Icon: Sun, variant: 'light' },
                      { key: 'dark' as ThemeChoice, label: '深色', Icon: Moon, variant: 'dark' },
                      { key: 'system' as ThemeChoice, label: '跟随系统', Icon: Monitor, variant: 'half' },
                    ]).map((o) => (
                      <S.PickCard key={o.key} $active={theme === o.key} onClick={() => setTheme(o.key)}>
                        <S.CheckBadge $active={theme === o.key}>
                          <Check size={11} weight="bold" />
                        </S.CheckBadge>
                        <S.PickPreview $variant={o.variant} style={{ aspectRatio: '16 / 10' }}>
                          {o.variant === 'light' && (
                            <>
                              <div style={{ height: 8, background: '#f3f4f6' }} />
                              <div style={{ padding: 8 }}>
                                <div style={{ height: 6, borderRadius: 99, background: 'rgba(52,82,255,0.3)', width: '70%' }} />
                              </div>
                            </>
                          )}
                          {o.variant === 'dark' && (
                            <>
                              <div style={{ height: 8, background: '#374151' }} />
                              <div style={{ padding: 8 }}>
                                <div style={{ height: 6, borderRadius: 99, background: 'rgba(52,82,255,0.5)', width: '70%' }} />
                              </div>
                            </>
                          )}
                          {o.variant === 'half' && (
                            <>
                              <div style={{ background: '#fff', height: '100%' }} />
                              <div style={{ background: '#1f2937', height: '100%' }} />
                            </>
                          )}
                        </S.PickPreview>
                        <S.PickLabel $active={theme === o.key} $mt>
                          <o.Icon size={15} weight="fill" />
                          {o.label}
                        </S.PickLabel>
                      </S.PickCard>
                    ))}
                  </S.PickGrid>
                </div>

                {/* 标签栏位置 */}
                <div style={anim(0.2)}>
                  <S.SectionHead>
                    <S.SectionLabel>标签栏位置</S.SectionLabel>
                    <S.SectionHint>本浏览器主打垂直标签，默认推荐左侧</S.SectionHint>
                  </S.SectionHead>
                  <S.PickGrid $cols={2}>
                    {([
                      { key: 'top' as TabChoice, label: '顶部', Icon: Rectangle, layout: 'top' },
                      { key: 'left' as TabChoice, label: '左侧（垂直）', Icon: SidebarSimple, layout: 'left' },
                    ]).map((o) => (
                      <S.PickCard key={o.key} $active={tabbar === o.key} $row onClick={() => setTabbar(o.key)}>
                        <S.CheckBadge $active={tabbar === o.key}>
                          <Check size={11} weight="bold" />
                        </S.CheckBadge>
                        <TabPreview layout={o.layout} />
                        <S.PickLabel $active={tabbar === o.key}>
                          <o.Icon size={16} weight="fill" />
                          {o.label}
                        </S.PickLabel>
                      </S.PickCard>
                    ))}
                  </S.PickGrid>
                </div>

                {/* 启动行为 */}
                <S.Panel style={anim(0.25)}>
                  <S.PanelLeft>
                    <S.PanelIconBox $bg="#EEF2FF" $fg="#3452FF">
                      <RocketLaunch size={18} weight="fill" />
                    </S.PanelIconBox>
                    <div>
                      <S.PanelTitle>启动行为</S.PanelTitle>
                      <S.PanelSub>决定每次打开浏览器最先看到什么</S.PanelSub>
                    </div>
                  </S.PanelLeft>
                  <S.SelectWrap>
                    <S.StartupSelect
                      value={startup}
                      onChange={(e) => setStartup(e.target.value as StartupChoice)}
                    >
                      <option value="continue">恢复上次标签</option>
                      <option value="empty">新标签页</option>
                    </S.StartupSelect>
                    <S.SelectCaret>
                      <CaretDown size={14} weight="bold" />
                    </S.SelectCaret>
                  </S.SelectWrap>
                </S.Panel>

                {/* 广告拦截 */}
                <S.Panel style={anim(0.3)}>
                  <S.PanelLeft>
                    <S.PanelIconBox $bg="#DCFCE7" $fg="#16A34A">
                      <ShieldCheck size={18} weight="fill" />
                    </S.PanelIconBox>
                    <div>
                      <S.PanelTitle>广告拦截</S.PanelTitle>
                      <S.PanelSub>杀手锏，默认开启</S.PanelSub>
                    </div>
                  </S.PanelLeft>
                  <S.Toggle $active={adblock} onClick={() => setAdblock(!adblock)} />
                </S.Panel>

                {/* 鼠标手势 */}
                <S.GesturePanel style={anim(0.35)}>
                  <S.GesturePanelTop>
                    <S.PanelLeft>
                      <S.PanelIconBox $bg="#FEF3C7" $fg="#D97706">
                        <HandPointing size={18} weight="fill" />
                      </S.PanelIconBox>
                      <div>
                        <S.PanelTitle>鼠标手势</S.PanelTitle>
                        <S.PanelSub>按住右键画轨迹即可操控页面</S.PanelSub>
                      </div>
                    </S.PanelLeft>
                    <S.Toggle $active={gestures} onClick={() => setGestures(!gestures)} />
                  </S.GesturePanelTop>
                  <S.GestureRow>
                    <S.GestureItem>
                      <GestureSvg variant="back" />
                      <S.GestureName>后退</S.GestureName>
                    </S.GestureItem>
                    <S.GestureItem>
                      <GestureSvg variant="forward" />
                      <S.GestureName>前进</S.GestureName>
                    </S.GestureItem>
                    <S.GestureItem>
                      <GestureSvg variant="reload" />
                      <S.GestureName>刷新</S.GestureName>
                    </S.GestureItem>
                  </S.GestureRow>
                  <S.GestureNote>
                    <GearSix size={12} />
                    以上为默认手势，可在设置中自定义 8 方向轨迹
                  </S.GestureNote>
                </S.GesturePanel>
              </S.SettingsList>
            </S.Page3Wrap>
          </S.Slide>
        </S.SliderTrack>
      </S.Main>

      {/* 悬浮主按钮 */}
      <S.FloatingCTAWrap>
        <S.PrimaryButton onClick={ctaAction}>
          {page === 2 && <RocketLaunch size={18} weight="fill" />}
          {page === 0 && '同意并继续'}
          {page === 1 && '继续设置'}
          {page === 2 && '开启浏览之旅'}
          {page === 1 && <ArrowRight size={16} weight="bold" />}
        </S.PrimaryButton>
      </S.FloatingCTAWrap>

      {/* 底栏 */}
      <S.Footer>
        <S.BackButton $visible={page > 0} onClick={prev}>
          <ArrowLeft size={14} weight="bold" />
          上一步
        </S.BackButton>
        <S.FooterCenter>
          <S.Dots>
            {[0, 1, 2].map((i) => (
              <S.Dot key={i} $active={page === i} onClick={() => go(i)} />
            ))}
          </S.Dots>
          <S.ExitButton onClick={exitApp}>退出</S.ExitButton>
        </S.FooterCenter>
      </S.Footer>

      {/* 协议弹窗（iframe 加载，点遮罩或关闭按钮关闭） */}
      {agreement && (
        <S.AgreementOverlay onClick={() => setAgreement(null)}>
          <S.AgreementDialog onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <S.AgreementHeader>
              <S.AgreementTitle>{agreement.title}</S.AgreementTitle>
              <S.AgreementClose onClick={() => setAgreement(null)}>
                <X size={18} />
              </S.AgreementClose>
            </S.AgreementHeader>
            <S.AgreementFrame src={agreement.url} />
          </S.AgreementDialog>
        </S.AgreementOverlay>
      )}
    </S.Root>
  );
}

// —— 进入动画 inline 样式辅助（仿 .slide-active .anim，按页激活时重播）——
function anim(delay: number): CSSProperties {
  return {
    animation: `onbFadeUp 0.55s cubic-bezier(0.22,1,0.36,1) ${delay}s both`,
  } as CSSProperties;
}

// —— 标签位置预览（顶部 / 左侧）——
function TabPreview({ layout }: { layout: 'top' | 'left' }) {
  const box: CSSProperties = {
    width: 80, height: 56, borderRadius: 6, background: '#fff',
    border: `1px solid ${C.chromeLine}`, overflow: 'hidden', flexShrink: 0,
  };
  const tab: CSSProperties = { height: 8, borderRadius: 2 };
  const line: CSSProperties = { height: 4, borderRadius: 2, background: '#f3f4f6' };
  if (layout === 'top') {
    return (
      <div style={{ ...box, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: '33%', background: C.bgLight, display: 'flex', gap: 2, padding: '0 4px', alignItems: 'center' }}>
          <div style={{ ...tab, flex: 1, background: 'rgba(52,82,255,0.4)' }} />
          <div style={{ ...tab, flex: 1, background: '#e5e7eb' }} />
          <div style={{ ...tab, flex: 1, background: '#e5e7eb' }} />
        </div>
        <div style={{ flex: 1, padding: 4 }}>
          <div style={{ ...line, width: '80%' }} />
          <div style={{ ...line, width: '55%', marginTop: 2 }} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...box, display: 'flex' }}>
      <div style={{ width: '33%', background: C.bgLight, display: 'flex', flexDirection: 'column', gap: 2, padding: 4 }}>
        <div style={{ ...tab, background: 'rgba(52,82,255,0.4)' }} />
        <div style={{ ...tab, background: '#e5e7eb' }} />
        <div style={{ ...tab, background: '#e5e7eb' }} />
      </div>
      <div style={{ flex: 1, padding: 4 }}>
        <div style={{ ...line, width: '80%' }} />
        <div style={{ ...line, width: '55%', marginTop: 2 }} />
      </div>
    </div>
  );
}

// —— 手势插画（搬设计稿的 3 段 SVG path）——
function GestureSvg({ variant }: { variant: 'back' | 'forward' | 'reload' }) {
  const stroke = '#D97706';
  const common = {
    stroke, strokeWidth: 3.2, strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const, fill: 'none',
  };
  return (
    <svg width="38" height="20" viewBox="0 0 38 20" fill="none">
      {variant === 'back' && (
        <>
          <path d="M31 10 L9 10" {...common} strokeDasharray="1 5" />
          <path d="M15 5 L8 10 L15 15" {...common} />
        </>
      )}
      {variant === 'forward' && (
        <>
          <path d="M7 10 L29 10" {...common} strokeDasharray="1 5" />
          <path d="M23 5 L30 10 L23 15" {...common} />
        </>
      )}
      {variant === 'reload' && (
        <>
          <path d="M19 3 L19 17" {...common} strokeDasharray="1 5" />
          <path d="M14 7 L19 3 L24 7" {...common} />
          <path d="M14 13 L19 17 L24 13" {...common} />
        </>
      )}
    </svg>
  );
}
