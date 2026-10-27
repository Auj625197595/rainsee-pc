import * as React from 'react';
import styled, { css } from 'styled-components';
import { observer } from 'mobx-react-lite';
import { PaintBrushHousehold } from '@phosphor-icons/react';

import { NormalButton } from '../App';
import { Switch } from '~/renderer/components/Switch';
import { Dropdown } from '~/renderer/components/Dropdown';
import store from '../../store';
import { getPalette } from '../../utils/palette';
import { getSettingsTranslator } from '../../utils';
import { ITheme } from '~/interfaces';
import { ipcRenderer } from '~/common/renderer-ipc';
import type { Translator } from '~/common/i18n';
import {
  CHROME_PANEL_SECTIONS,
  IChromePanelField,
  IChromePanelValues,
  buildChromePanelCss,
  countChromePanelCustomized,
  getChromePanelFieldDefault,
  sanitizeChromePanelValues,
} from '~/common/chrome-style-panel';

const emitChromeStyleHover = (key: string | null) => {
  ipcRenderer.send('chrome-style-hover', key);
};

const chromeStyleHoverProps = (key: string) => ({
  onMouseEnter: () => emitChromeStyleHover(key),
  onMouseLeave: () => emitChromeStyleHover(null),
});

// ===== 布局骨架 =====

const PanelShell = styled.section`
  width: 100%;
  margin-top: 10px;
`;

const PanelHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
`;

const PanelTitle = styled.h4`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 700;
`;

const PanelDesc = styled.p`
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  font-weight: 500;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const PanelActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
`;

const SectionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const SectionCard = styled.section`
  overflow: hidden;
  border-radius: 14px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      box-shadow: inset 0 0 0 1px ${p.line};
    `;
  }}
`;

const SectionHead = styled.h4`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 13px 16px 9px;
  font-size: 12.5px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  padding: 11px 16px 13px;

  & + & {
    ${({ theme }: { theme?: ITheme }) => css`
      border-top: 1px solid ${getPalette(theme).line};
    `}
  }

  ${({ theme }: { theme?: ITheme }) => css`
    &:hover {
      background-color: ${getPalette(theme).hover};
    }
  `}
`;

const FieldHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const FieldLabel = styled.span`
  font-size: 13.5px;
  font-weight: 600;
`;

const FieldValue = styled.span`
  font-family: 'SF Mono', 'Roboto Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const ResetFieldButton = styled.button`
  height: 22px;
  padding: 0 7px;
  border: none;
  border-radius: 6px;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  visibility: hidden;

  ${FieldRow}:hover & {
    visibility: visible;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: ${p.primarySoft};

      &:hover {
        color: ${p.primary};
      }
    `;
  }}
`;

const ResetFieldButtonVisible = styled(ResetFieldButton)`
  visibility: visible;
`;

// ===== 控件 =====

const SliderInput = styled.input`
  width: 100%;
  margin: 4px 0 0;

  ${({ theme }: { theme?: ITheme }) => css`
    accent-color: ${getPalette(theme).primary};
  `}
`;

const ColorSwatch = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
`;

const ColorInput = styled.input`
  width: 34px;
  height: 30px;
  padding: 3px;
  border-radius: 9px;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
    border: 1px solid ${getPalette(theme).line};
  `}
`;

const ColorClearButton = styled.button`
  height: 26px;
  padding: 0 9px;
  border: none;
  border-radius: 7px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textSub};
      background-color: ${p.hover};

      &:hover {
        color: ${p.textMain};
      }
    `;
  }}
`;

const ColorHexText = styled.span`
  font-family: 'SF Mono', 'Roboto Mono', ui-monospace, monospace;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

// ===== 面板本体 =====

// 预览节流间隔:拖动/取色每秒最多广播 ~30 次。滑条 input 逐像素触发,
// 不节流会让主窗口每帧整段重解析 <style> 并重算整个顶部栏样式(掉帧主源)。
const PREVIEW_THROTTLE_MS = 32;

const ChromeStylePanel = observer(() => {
  const t = getSettingsTranslator();
  const savedValues = sanitizeChromePanelValues(
    store.settings.chromeStylePanel || {},
  );
  // 本地草稿是滑条拖动的唯一受控源:拖动时立即改草稿 + 广播预览。
  // savedValues 每次 render 都是新对象,绝不能直接用它重置 draft(旧版
  // 滑条拖不动的根因);只在外部改动(内容与本地最近一次写入不同)时同步。
  const [draft, setDraft] = React.useState<IChromePanelValues>(savedValues);
  const draftRef = React.useRef(draft);
  const lastAppliedRef = React.useRef(savedValues);
  const flushTimer = React.useRef<number | null>(null);
  const previewTimer = React.useRef<number | null>(null);
  const pendingPreviewRef = React.useRef<IChromePanelValues | null>(null);

  React.useEffect(() => {
    if (
      JSON.stringify(savedValues) !== JSON.stringify(lastAppliedRef.current)
    ) {
      // 变化不是本地发起的(另一窗口/恢复默认/重启加载)→ 采纳。
      lastAppliedRef.current = savedValues;
      draftRef.current = savedValues;
      setDraft(savedValues);
    }
  }, [savedValues]);

  // 卸载时把未发出的预览与未落盘的值立即补发/补写,否则关弹窗丢最后一次调整
  // 或其它窗口停留在陈旧预览。
  React.useEffect(
    () => () => {
      if (previewTimer.current !== null) {
        window.clearTimeout(previewTimer.current);
        previewTimer.current = null;
        if (pendingPreviewRef.current) {
          ipcRenderer.send('chrome-style-preview', pendingPreviewRef.current);
          pendingPreviewRef.current = null;
        }
      }
      if (flushTimer.current !== null) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
        store.settings.chromeStylePanel = lastAppliedRef.current;
        store.save();
      }
    },
    [],
  );

  const customized = countChromePanelCustomized(draft);

  // 预览:首个值立即广播,后续值按间隔合并。不能用防抖:持续拖动会反复
  // 重置计时器,导致视觉效果一直等到松手才更新。
  const preview = (next: IChromePanelValues) => {
    pendingPreviewRef.current = next;
    if (previewTimer.current !== null) return;

    const sendPreview = () => {
      if (!pendingPreviewRef.current) return;
      ipcRenderer.send('chrome-style-preview', pendingPreviewRef.current);
      pendingPreviewRef.current = null;
    };

    sendPreview();
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      sendPreview();
    }, PREVIEW_THROTTLE_MS);
  };

  // 持久化:防抖 400ms,拖动过程中不写盘(save 会触发全应用 update-settings
  // 广播,逐事件落盘会让整个浏览器跟着每个像素重渲染)。
  const persist = (next: IChromePanelValues) => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current);
    }
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      store.settings.chromeStylePanel = next;
      store.save();
    }, 400);
  };

  const apply = (next: IChromePanelValues) => {
    draftRef.current = next;
    lastAppliedRef.current = next;
    setDraft(next);
    preview(next);
    persist(next);
  };

  // 全部走 ref,回调引用稳定 → 行级 React.memo 只重渲染值变化的一行,
  // 拖动时不再整面板 34 行重渲染。
  const setField = React.useCallback(
    (field: IChromePanelField, value: string | number | boolean | null) => {
      const next = { ...draftRef.current };
      if (
        value === null ||
        value === '' ||
        (field.type === 'slider' &&
          value === getChromePanelFieldDefault(field.key)) ||
        (field.type === 'toggle' && value === true) ||
        (field.type === 'select' && value === getChromePanelFieldDefault(field.key))
      ) {
        // 恢复默认 → 移除键,让 CSS 生成器回到「不覆盖」。
        delete next[field.key];
      } else {
        next[field.key] = value;
      }
      apply(next);
    },
    [],
  );

  const resetAll = () => {
    apply({});
  };

  const copyAsCss = async () => {
    const cssText =
      buildChromePanelCss(draft) || `/* ${t('chromePanelNoAdjustments')} */`;
    try {
      await navigator.clipboard.writeText(cssText);
    } catch {
      // 剪贴板不可用时静默;此按钮只是辅助导出。
    }
  };

  return (
    <PanelShell>
      <PanelHead>
        <div>
          <PanelTitle>
            <PaintBrushHousehold size={16} weight="fill" />
            {t('chromePanelTitle')}
          </PanelTitle>
          <PanelDesc>{t('chromePanelDescription', { count: customized })}</PanelDesc>
        </div>
      </PanelHead>
      <SectionList>
        {CHROME_PANEL_SECTIONS.map((section) => (
          <SectionCard key={section.id}>
            <SectionHead>{t(section.labelKey)}</SectionHead>
            {section.fields.map((field) => (
              <ChromePanelFieldRow
                key={field.key}
                field={field}
                value={draft[field.key]}
                onChange={setField}
                t={t}
              />
            ))}
          </SectionCard>
        ))}
      </SectionList>
      <PanelActions>
        <NormalButton variant="soft" onClick={copyAsCss}>
          {t('chromePanelCopyCss')}
        </NormalButton>
        <NormalButton variant="soft" disabled={!customized} onClick={resetAll}>
          {t('resetToDefault')}
        </NormalButton>
      </PanelActions>
    </PanelShell>
  );
});

// 行级 memo:onChange 引用稳定 + value 未变的行跳过渲染。
// 拖动一条滑条时其余 33 行不重渲染。t 经 getSettingsTranslator 按 locale
// 缓存(引用稳定),只有语言切换才会让全部行重渲染。
const ChromePanelFieldRow = React.memo(
  ({
    field,
    value,
    onChange,
    t,
  }: {
    field: IChromePanelField;
    value: string | number | boolean | undefined;
    onChange: (field: IChromePanelField, v: string | number | boolean | null) => void;
    t: Translator;
  }) => {
    // 滑条显示值:未设置时回落 schema 默认,保证拖把从默认位置开始。
    const sliderDefault = Number(getChromePanelFieldDefault(field.key));
    const sliderCurrent =
      typeof value === 'number'
        ? value
        : Number.isFinite(parseFloat(String(value)))
        ? parseFloat(String(value))
        : sliderDefault;

    if (field.type === 'color') {
      return (
        <FieldRow {...chromeStyleHoverProps(field.key)}>
          <FieldHead>
            <FieldLabel>{t(field.labelKey)}</FieldLabel>
            <ColorSwatch>
              <ColorHexText>
                {typeof value === 'string' && value
                  ? value.toUpperCase()
                  : t('chromePanelDefault')}
              </ColorHexText>
              {typeof value === 'string' && value && (
                <ColorClearButton
                  type="button"
                  title={t('resetToDefault')}
                  onClick={() => onChange(field, null)}
                >
                  {t('chromePanelDefault')}
                </ColorClearButton>
              )}
              <ColorInput
                type="color"
                value={typeof value === 'string' && value ? value : '#ffffff'}
                onChange={(event) => onChange(field, event.target.value)}
                aria-label={t(field.labelKey)}
              />
            </ColorSwatch>
          </FieldHead>
        </FieldRow>
      );
    }

    if (field.type === 'select') {
      const selected =
        typeof value === 'string'
          ? value
          : String(getChromePanelFieldDefault(field.key));
      return (
        <FieldRow {...chromeStyleHoverProps(field.key)}>
          <FieldHead>
            <FieldLabel>{t(field.labelKey)}</FieldLabel>
            <Dropdown defaultValue={selected} onChange={(next) => onChange(field, next)}>
              {field.options?.map((option) => (
                <Dropdown.Item key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </Dropdown.Item>
              ))}
            </Dropdown>
          </FieldHead>
        </FieldRow>
      );
    }

    // 开关行:缺省 = 默认开启;拨回开由 setField 删键回到「不覆盖」。
    if (field.type === 'toggle') {
      const on = value !== false;
      return (
        <FieldRow style={{ cursor: 'pointer' }} onClick={() => onChange(field, !on)} {...chromeStyleHoverProps(field.key)}>
          <FieldHead>
            <FieldLabel>{t(field.labelKey)}</FieldLabel>
            <Switch value={on} />
          </FieldHead>
        </FieldRow>
      );
    }

    return (
      <ChromePanelSliderFieldRow
        field={field}
        value={sliderCurrent}
        defaultValue={sliderDefault}
        onChange={onChange}
        t={t}
      />
    );
  },
);

const ChromePanelSliderFieldRow = React.memo(
  ({
    field,
    value,
    defaultValue,
    onChange,
    t,
  }: {
    field: IChromePanelField;
    value: number;
    defaultValue: number;
    onChange: (field: IChromePanelField, v: string | number | null) => void;
    t: Translator;
  }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const frameRef = React.useRef<number | null>(null);
    const pendingValueRef = React.useRef<number | null>(null);
    const pointerDownRef = React.useRef(false);
    const [liveValue, setLiveValue] = React.useState(value);

    // 外部恢复默认或其它窗口修改设置时同步原生控件。拖动期间不回写 DOM,
    // 避免父层晚到一帧的值把已经移动的 thumb 拉回去。
    React.useEffect(() => {
      if (pointerDownRef.current) return;
      setLiveValue(value);
      if (inputRef.current && inputRef.current.valueAsNumber !== value) {
        inputRef.current.valueAsNumber = value;
      }
    }, [value]);

    React.useEffect(
      () => () => {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
        }
      },
      [],
    );

    const flushPendingValue = () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (pendingValueRef.current === null) return;
      const next = pendingValueRef.current;
      pendingValueRef.current = null;
      onChange(field, next);
    };

    const scheduleValue = (next: number) => {
      pendingValueRef.current = next;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        if (pendingValueRef.current === null) return;
        const pending = pendingValueRef.current;
        pendingValueRef.current = null;
        onChange(field, pending);
      });
    };

    const isCustomized = liveValue !== defaultValue;
    const ResetBtn = isCustomized ? ResetFieldButtonVisible : ResetFieldButton;

    return (
      <FieldRow {...chromeStyleHoverProps(field.key)}>
        <FieldHead>
          <FieldLabel>{t(field.labelKey)}</FieldLabel>
          <FieldValue>
            {liveValue}
            {field.unit}
          </FieldValue>
          <ResetBtn
            type="button"
            title={t('resetToDefault')}
            onClick={() => onChange(field, null)}
          >
            {t('chromePanelDefault')}
          </ResetBtn>
        </FieldHead>
        {/* 不传 value,让 Chromium 原生绘制的 thumb 完全跟随指针;React 状态与
            外壳预览每动画帧同步一次,松手时再强制提交最终值。 */}
        <SliderInput
          ref={inputRef}
          type="range"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          defaultValue={value}
          onPointerDown={() => {
            pointerDownRef.current = true;
          }}
          onPointerUp={() => {
            pointerDownRef.current = false;
            flushPendingValue();
          }}
          onPointerCancel={() => {
            pointerDownRef.current = false;
            flushPendingValue();
          }}
          onLostPointerCapture={() => {
            pointerDownRef.current = false;
            flushPendingValue();
          }}
          onInput={(event) => {
            const next = event.currentTarget.valueAsNumber;
            setLiveValue(next);
            scheduleValue(next);
          }}
          onBlur={flushPendingValue}
          aria-label={t(field.labelKey)}
        />
      </FieldRow>
    );
  },
);

export default ChromeStylePanel;
