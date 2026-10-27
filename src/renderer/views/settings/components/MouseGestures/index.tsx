import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { observer } from 'mobx-react-lite';
import styled, { css } from 'styled-components';
import {
  ArrowsOutCardinal,
  CursorClick,
  GearSix,
  HandPalm,
  Mouse,
  PaintBrush,
  Path,
  SlidersHorizontal,
  SquaresFour,
  X,
} from '@phosphor-icons/react';

import { ipcRenderer } from '~/common/renderer-ipc';
import { ITheme, TabWheelBehavior } from '~/interfaces';
import { Switch } from '~/renderer/components/Switch';
import store from '../../store';
import { getPalette } from '../../utils/palette';
import { onSwitchChange, getSettingsTranslator } from '../../utils/settings';
import type { MessageKey } from '~/common/i18n';

interface GestureActionDTO {
  id: string;
  label: string;
  category: string;
}

interface GestureCategoryDTO {
  id: string;
  label: string;
}

interface PresetShapeDTO {
  code: string;
  label: string;
}

interface LeftActionDTO {
  id: string;
  label: string;
}

type GestureModal = 'left-drag' | 'side-buttons' | 'mappings' | null;
type IconTone = 'purple' | 'cyan' | 'orange' | 'blue' | 'pink' | 'green';

const Group = styled.section`
  margin-top: 26px;
`;

const GroupLabel = styled.h3`
  margin: 0 0 9px;
  padding: 0 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Note = styled.p`
  margin: 5px 4px 12px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.55;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Card = styled.div`
  overflow: hidden;
  border-radius: 12px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.surface};
      border: 1px solid ${p.line};
    `;
  }}
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 70px;
  padding: 12px 14px;

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

const IconBox = styled.span<{ $tone: IconTone }>`
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;

  ${({ $tone, theme }: { $tone: IconTone; theme?: ITheme }) => {
    const p = getPalette(theme);
    const tones: Record<IconTone, [string, string]> = {
      purple: ['#7c5ce5', '#eeeaff'],
      cyan: ['#0891b2', '#e3f8fb'],
      orange: ['#d97706', '#fff2dd'],
      blue: [p.primary, p.primarySoft],
      pink: ['#db2777', '#fce7f3'],
      green: ['#16a34a', '#e7f8ed'],
    };
    return css`
      color: ${tones[$tone][0]};
      background-color: ${tones[$tone][1]};
    `;
  }}
`;

const RowCopy = styled.div`
  flex: 1;
  min-width: 0;
`;

const RowTitle = styled.div`
  font-size: 14px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMain};
  `}
`;

const RowDescription = styled.div`
  margin-top: 3px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  min-height: 34px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.16s ease, border-color 0.16s ease,
    color 0.16s ease;

  ${({ $primary, theme }: { $primary?: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${$primary ? '#fff' : p.textMain};
      background-color: ${$primary ? p.primary : p.surface};
      border: 1px solid ${$primary ? p.primary : p.line};

      &:hover {
        color: ${$primary ? '#fff' : p.primary};
        background-color: ${$primary ? p.primary : p.primarySoft};
        border-color: ${p.primary};
      }
    `;
  }}
`;

const ColorControl = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-family: 'SF Mono', 'Roboto Mono', ui-monospace, monospace;
  font-size: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const ColorInput = styled.input`
  width: 32px;
  height: 32px;
  padding: 3px;
  border-radius: 9px;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).surface};
    border: 1px solid ${getPalette(theme).line};
  `}
`;

const ModalLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  background: rgba(24, 27, 42, 0.28);
  backdrop-filter: blur(2px);
`;

const Modal = styled.section`
  width: min(790px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      box-shadow: 0 24px 60px -28px rgba(26, 34, 76, 0.42);
    `;
  }}
`;

const ModalHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 17px 20px;

  ${({ theme }: { theme?: ITheme }) => css`
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

const ModalTitle = styled.h3`
  margin: 0;
  font-size: 17px;
  font-weight: 600;
`;

const CloseButton = styled.button`
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      &:hover {
        color: ${p.primary};
        background-color: ${p.primarySoft};
      }
    `;
  }}
`;

const ModalBody = styled.div`
  overflow-y: auto;
  padding: 0 20px 22px;
`;

const ModalIntro = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 2px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 2px 16px;

  label {
    min-width: 72px;
    font-size: 13.5px;
    font-weight: 600;
  }

  input {
    flex: 1;
    accent-color: ${({ theme }: { theme?: ITheme }) =>
      getPalette(theme).primary};
  }
`;

const SliderValue = styled.output`
  min-width: 43px;
  text-align: right;
  font-family: 'SF Mono', 'Roboto Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).primary};
  `}
`;

const DirectionList = styled.div`
  overflow: hidden;
  border-radius: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    border: 1px solid ${getPalette(theme).line};
  `}
`;

const DirectionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 58px;
  padding: 10px 14px;

  & + & {
    ${({ theme }: { theme?: ITheme }) => css`
      border-top: 1px solid ${getPalette(theme).line};
    `}
  }
`;

const Direction = styled.span`
  width: 66px;
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 600;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Select = styled.select`
  min-width: 0;
  height: 34px;
  padding: 0 8px;
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

const SegmentedControl = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, auto));
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  flex-shrink: 0;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
    `;
  }}
`;

const SegmentButton = styled.button<{ $active: boolean }>`
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
  white-space: nowrap;
  cursor: pointer;

  ${({ $active, theme }: { $active: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${$active ? p.primary : p.textSub};
      background-color: ${$active ? p.surface : 'transparent'};
      box-shadow: ${$active ? `0 1px 3px ${p.line}` : 'none'};

      &:hover {
        color: ${$active ? p.primary : p.textMain};
      }
    `;
  }}
`;

const Workspace = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 164px;
  gap: 14px;
  margin-top: 2px;
`;

const WorkspaceTitle = styled.span`
  display: block;
  font-size: 14px;
  font-weight: 600;
`;

const WorkspaceDescription = styled.span`
  display: block;
  margin-top: 3px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const Stats = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`;

const Stat = styled.div`
  min-height: 69px;
  padding: 11px;
  border-radius: 10px;

  b {
    display: block;
    font-size: 18px;
    font-weight: 600;
  }
  span {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    font-weight: 500;
  }

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      background-color: ${p.bg};
      border: 1px solid ${p.line};
      b {
        color: ${p.primary};
      }
      span {
        color: ${p.textSub};
      }
    `;
  }}
`;

const Editor = styled.div`
  margin-top: 16px;
  overflow: hidden;
  border-radius: 12px;

  ${({ theme }: { theme?: ITheme }) => css`
    border: 1px solid ${getPalette(theme).line};
  `}
`;

const EditorTools = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).bg};
    border-bottom: 1px solid ${getPalette(theme).line};
  `}
`;

const FilterInput = styled.input`
  flex: 1;
  min-width: 0;
  height: 33px;
  padding: 0 10px;
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 12px;
  font-weight: 500;

  ${({ theme }: { theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${p.textMain};
      background-color: ${p.surface};
      border: 1px solid ${p.line};
      &:focus {
        border-color: ${p.primary};
        box-shadow: 0 0 0 3px ${p.primary}1f;
      }
    `;
  }}
`;

const Tabs = styled.div`
  display: inline-flex;
  padding: 3px;
  border-radius: 8px;

  ${({ theme }: { theme?: ITheme }) => css`
    background-color: ${getPalette(theme).hover};
  `}
`;

const Tab = styled.button<{ $active: boolean }>`
  min-height: 27px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;

  ${({ $active, theme }: { $active: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${$active ? p.primary : p.textSub};
      background-color: ${$active ? p.surface : 'transparent'};
      box-shadow: ${$active ? '0 1px 3px rgba(40, 50, 120, 0.1)' : 'none'};
    `;
  }}
`;

const CategoryName = styled.div`
  padding: 15px 15px 7px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textSub};
  `}
`;

const MappingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 58px;
  padding: 9px 14px;

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

const MappingName = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 600;
`;

const ShapeToken = styled.span<{ $active?: boolean }>`
  min-width: 31px;
  height: 26px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: 7px;
  font-family: Consolas, 'SF Mono', monospace;
  font-size: 12px;
  font-weight: 700;

  ${({ $active, theme }: { $active?: boolean; theme?: ITheme }) => {
    const p = getPalette(theme);
    return css`
      color: ${$active ? p.primary : p.textMain};
      background-color: ${$active ? p.primarySoft : p.bg};
    `;
  }}
`;

const MapSelect = styled(Select)`
  width: 172px;
  max-width: 42%;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-top: 15px;
`;

const Empty = styled.div`
  padding: 38px 0;
  text-align: center;
  font-size: 13px;

  ${({ theme }: { theme?: ITheme }) => css`
    color: ${getPalette(theme).textMute};
  `}
`;

const directionLabels: Record<string, MessageKey> = {
  U: 'mgUp',
  D: 'mgDown',
  L: 'mgLeft',
  R: 'mgRight',
};

export const MouseGestures = observer(() => {
  const t = getSettingsTranslator();
  const [actions, setActions] = React.useState<GestureActionDTO[]>([]);
  const [categories, setCategories] = React.useState<GestureCategoryDTO[]>([]);
  const [presets, setPresets] = React.useState<PresetShapeDTO[]>([]);
  const [defaults, setDefaults] = React.useState<Record<string, string | null>>(
    {},
  );
  const [leftActions, setLeftActions] = React.useState<LeftActionDTO[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [modal, setModal] = React.useState<GestureModal>(null);
  const [filter, setFilter] = React.useState('');
  const [filterTab, setFilterTab] = React.useState<'all' | 'bound' | 'empty'>(
    'all',
  );

  React.useEffect(() => {
    let alive = true;
    ipcRenderer
      .invoke('get-gesture-actions')
      .then((result: any) => {
        if (!alive) return;
        if (!result) {
          setLoaded(true);
          return;
        }
        setActions(result.actions || []);
        setCategories(result.categories || []);
        setPresets(result.presets || []);
        setLeftActions(result.leftActions || []);
        setDefaults(
          (result.bindings || []).reduce(
            (
              value: Record<string, string | null>,
              binding: { id: string; defaultShape: string | null },
            ) => {
              value[binding.id] = binding.defaultShape;
              return value;
            },
            {},
          ),
        );
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!modal) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal]);

  const overrides = store.settings.mouseGestures || {};
  const effective = (id: string): string | null => {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      return overrides[id] ?? null;
    }
    const defaultShape = defaults[id] ?? null;
    return defaultShape && actions.some(
      (action) => action.id !== id && overrides[action.id] === defaultShape,
    ) ? null : defaultShape;
  };
  const usedByOther = (id: string, shape: string | null) =>
    !!shape &&
    actions.some(
      (action) => action.id !== id && effective(action.id) === shape,
    );
  const setOption = (
    key: 'enabled' | 'leftEnabled' | 'color' | 'leftOpenInBackground',
    value: unknown,
  ) => ipcRenderer.invoke('set-gesture-option', key, value);
  const setLeftGesture = (direction: string, actionId: string) =>
    ipcRenderer.invoke('set-gesture-option', 'leftGesture', {
      direction,
      actionId: actionId || null,
    });
  const setSideButton = (button: string, actionId: string) =>
    ipcRenderer.invoke('set-gesture-option', 'sideButton', {
      button,
      actionId: actionId || null,
    });

  const leftEnabled = store.settings.mouseLeftGesturesEnabled !== false;
  const rightEnabled = store.settings.mouseGesturesEnabled !== false;
  const threshold = store.settings.mouseLeftGestureThreshold || 24;
  const leftOpenInBackground =
    store.settings.mouseLeftGestureOpenInBackground !== false;
  const color = store.settings.mouseGestureColor || '#3b82f6';
  const left = store.settings.mouseLeftGestures || {};
  const side = store.settings.mouseSideButtons || {};
  const tabWheelBehavior = store.settings.tabWheelBehavior || 'auto';
  const leftSummary = t('mgLeftSummary', {
    threshold,
    up:
      leftActions.find((item) => item.id === left.U)?.label ||
      t('mgUnassigned'),
    down:
      leftActions.find((item) => item.id === left.D)?.label ||
      t('mgUnassigned'),
  });
  const sideActionName = (id: string | null | undefined) =>
    actions.find((action) => action.id === id)?.label ||
    t('mgUnassignedNoAction');
  const boundCount = actions.filter((action) => effective(action.id)).length;

  const filteredActions = (categoryId: string) =>
    actions.filter((action) => {
      const bound = !!effective(action.id);
      return (
        action.category === categoryId &&
        action.label.toLowerCase().includes(filter.trim().toLowerCase()) &&
        (filterTab === 'all' ||
          (filterTab === 'bound' && bound) ||
          (filterTab === 'empty' && !bound))
      );
    });

  const modalTitle =
    modal === 'left-drag'
      ? t('mgLeftDragModal')
      : modal === 'side-buttons'
      ? t('mgSideButtonsModal')
      : t('mgMappingsModal');

  const renderModalContent = () => {
    if (modal === 'left-drag') {
      return (
        <>
          <ModalIntro>
            <IconBox $tone="purple">
              <CursorClick size={18} weight="fill" />
            </IconBox>
            {t('mgLeftDragIntro')}
          </ModalIntro>
          <SliderRow>
            <label htmlFor="left-gesture-threshold">
              {t('searchDragThreshold')}
            </label>
            <input
              id="left-gesture-threshold"
              type="range"
              min="8"
              max="200"
              step="1"
              value={threshold}
              onChange={(event) =>
                ipcRenderer.invoke(
                  'set-gesture-option',
                  'leftThreshold',
                  Number(event.target.value),
                )
              }
            />
            <SliderValue>{threshold}px</SliderValue>
          </SliderRow>
          <SettingRow>
            <IconBox $tone="cyan">
              <CursorClick size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('mgOpenModeTitle')}</RowTitle>
              <RowDescription>{t('mgOpenModeDesc')}</RowDescription>
            </RowCopy>
            <SegmentedControl
              role="group"
              aria-label={t('mgOpenModeTitle')}
            >
              <SegmentButton
                type="button"
                $active={!leftOpenInBackground}
                aria-pressed={!leftOpenInBackground}
                onClick={() => setOption('leftOpenInBackground', false)}
              >
                {t('mgForeground')}
              </SegmentButton>
              <SegmentButton
                type="button"
                $active={leftOpenInBackground}
                aria-pressed={leftOpenInBackground}
                onClick={() => setOption('leftOpenInBackground', true)}
              >
                {t('mgBackground')}
              </SegmentButton>
            </SegmentedControl>
          </SettingRow>
          <DirectionList>
            {(['U', 'D', 'L', 'R'] as const).map((direction) => (
              <DirectionRow key={direction}>
                <Direction>{t(directionLabels[direction])}</Direction>
                <Select
                  value={left[direction] || ''}
                  onChange={(event) =>
                    setLeftGesture(direction, event.target.value)
                  }
                >
                  <option value="">{t('mgUnassignedNoAction')}</option>
                  {leftActions.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.label}
                    </option>
                  ))}
                </Select>
              </DirectionRow>
            ))}
          </DirectionList>
        </>
      );
    }
    if (modal === 'side-buttons') {
      return (
        <>
          <ModalIntro>
            <IconBox $tone="orange">
              <Mouse size={18} weight="fill" />
            </IconBox>
            {t('mgSideIntro')}
          </ModalIntro>
          <DirectionList>
            {[
              { button: '3', labelKey: 'mgBackButton' as MessageKey, fallback: 'back' },
              { button: '4', labelKey: 'mgForwardButton' as MessageKey, fallback: 'forward' },
            ].map((item) => (
              <DirectionRow key={item.button}>
                <Direction>{t(item.labelKey)}</Direction>
                <Select
                  value={
                    Object.prototype.hasOwnProperty.call(side, item.button)
                      ? side[item.button] || ''
                      : item.fallback
                  }
                  onChange={(event) =>
                    setSideButton(item.button, event.target.value)
                  }
                >
                  <option value="">{t('mgUnassignedNoAction')}</option>
                  {categories.map((category) => (
                    <optgroup key={category.id} label={category.label}>
                      {actions
                        .filter((action) => action.category === category.id)
                        .map((action) => (
                          <option key={action.id} value={action.id}>
                            {action.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              </DirectionRow>
            ))}
          </DirectionList>
        </>
      );
    }
    return (
      <>
        <ModalIntro>
          <IconBox $tone="blue">
            <HandPalm size={18} weight="fill" />
          </IconBox>
          {t('mgMappingIntro')}
        </ModalIntro>
        <Workspace>
          <div>
            <WorkspaceTitle>{t('mgMappingTitle')}</WorkspaceTitle>
            <WorkspaceDescription>
              {t('mgMappingDesc')}
            </WorkspaceDescription>
          </div>
          <Stats>
            <Stat>
              <b>{boundCount}</b>
              <span>{t('mgBound')}</span>
            </Stat>
            <Stat>
              <b>{Math.max(0, presets.length - boundCount)}</b>
              <span>{t('mgAvailableShapes')}</span>
            </Stat>
          </Stats>
        </Workspace>
        <Editor>
          <EditorTools>
            <FilterInput
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('mgFilterActions')}
              aria-label={t('mgFilterActions')}
            />
            <Tabs role="tablist">
              {(
                [
                  ['all', 'mgFilterAll'],
                  ['bound', 'mgBound'],
                  ['empty', 'mgUnbound'],
                ] as const
              ).map(([id, labelKey]) => (
                <Tab
                  key={id}
                  type="button"
                  $active={filterTab === id}
                  onClick={() => setFilterTab(id)}
                >
                  {t(labelKey)}
                </Tab>
              ))}
            </Tabs>
          </EditorTools>
          {categories.map((category, index) => {
            const entries = filteredActions(category.id);
            if (!entries.length) return null;
            const tones: IconTone[] = ['blue', 'purple', 'green', 'orange'];
            return (
              <div key={category.id}>
                <CategoryName>{category.label}</CategoryName>
                {entries.map((action, actionIndex) => {
                  const current = effective(action.id);
                  return (
                    <MappingRow key={action.id}>
                      <IconBox
                        $tone={tones[(index + actionIndex) % tones.length]}
                      >
                        <Path size={16} weight="fill" />
                      </IconBox>
                      <MappingName>{action.label}</MappingName>
                      <ShapeToken $active={!!current}>
                        {current || '—'}
                      </ShapeToken>
                      <MapSelect
                        value={current || ''}
                        onChange={(event) =>
                          ipcRenderer.invoke(
                            'set-gesture',
                            action.id,
                            event.target.value || null,
                          )
                        }
                        aria-label={t('mgGestureAria', { label: action.label })}
                      >
                        <option value="">{t('mgUnbound')}</option>
                        {presets
                          .filter(
                            (preset) =>
                              preset.code === current ||
                              !usedByOther(action.id, preset.code),
                          )
                          .map((preset) => (
                            <option key={preset.code} value={preset.code}>
                              {preset.label}
                            </option>
                          ))}
                      </MapSelect>
                    </MappingRow>
                  );
                })}
              </div>
            );
          })}
          {!categories.some(
            (category) => filteredActions(category.id).length,
          ) && <Empty>{t('mgNoMatches')}</Empty>}
        </Editor>
        <ModalFooter>
          <ActionButton
            type="button"
            onClick={() => ipcRenderer.invoke('reset-gesture')}
          >
            {t('mgResetRecommended')}
          </ActionButton>
        </ModalFooter>
      </>
    );
  };

  if (!loaded) return <Empty>{t('mgLoading')}</Empty>;

  const setTabWheelBehavior = (value: TabWheelBehavior) => {
    store.settings.tabWheelBehavior = value;
    store.save();
  };

  return (
    <>
      <Note>{t('mgTopNote')}</Note>
      <Group>
        <GroupLabel>{t('mgTabWheelSection')}</GroupLabel>
        <Card>
          <SettingRow>
            <IconBox $tone="blue">
              <Mouse size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('searchTabWheel')}</RowTitle>
              <RowDescription>{t('mgTabWheelDesc')}</RowDescription>
            </RowCopy>
            <SegmentedControl
              role="group"
              aria-label={t('searchTabWheel')}
            >
              <SegmentButton
                type="button"
                $active={tabWheelBehavior === 'auto'}
                aria-pressed={tabWheelBehavior === 'auto'}
                onClick={() => setTabWheelBehavior('auto')}
              >
                {t('permOptDefault')}
              </SegmentButton>
              <SegmentButton
                type="button"
                $active={tabWheelBehavior === 'always-switch'}
                aria-pressed={tabWheelBehavior === 'always-switch'}
                onClick={() => setTabWheelBehavior('always-switch')}
              >
                {t('mgAlwaysSwitch')}
              </SegmentButton>
            </SegmentedControl>
          </SettingRow>
        </Card>
      </Group>
      <Group>
        <GroupLabel>{t('mgLeftDragSection')}</GroupLabel>
        <Card>
          <SettingRow>
            <IconBox $tone="purple">
              <CursorClick size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('searchLeftDragGestures')}</RowTitle>
              <RowDescription>{t('mgLeftDragRowDesc')}</RowDescription>
            </RowCopy>
            <Switch
              clickable
              value={leftEnabled}
              onClick={() => setOption('leftEnabled', !leftEnabled)}
            />
          </SettingRow>
          <SettingRow>
            <IconBox $tone="cyan">
              <ArrowsOutCardinal size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('mgDirectionActions')}</RowTitle>
              <RowDescription>{leftSummary}</RowDescription>
            </RowCopy>
            <ActionButton type="button" onClick={() => setModal('left-drag')}>
              <SlidersHorizontal size={15} />
              {t('mgConfigure')}
            </ActionButton>
          </SettingRow>
        </Card>
      </Group>
      <Group>
        <GroupLabel>{t('mgSideSection')}</GroupLabel>
        <Card>
          <SettingRow>
            <IconBox $tone="orange">
              <Mouse size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('mgMouseSideButtons')}</RowTitle>
              <RowDescription>
                {t('mgSideSummary', {
                  back: sideActionName(
                    Object.prototype.hasOwnProperty.call(side, '3')
                      ? side['3']
                      : 'back',
                  ),
                  forward: sideActionName(
                    Object.prototype.hasOwnProperty.call(side, '4')
                      ? side['4']
                      : 'forward',
                  ),
                })}
              </RowDescription>
            </RowCopy>
            <ActionButton
              type="button"
              onClick={() => setModal('side-buttons')}
            >
              <GearSix size={15} />
              {t('mgConfigure')}
            </ActionButton>
          </SettingRow>
        </Card>
      </Group>
      <Group>
        <GroupLabel>{t('mgRightSection')}</GroupLabel>
        <Card>
          <SettingRow>
            <IconBox $tone="blue">
              <HandPalm size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('searchRightButtonGestures')}</RowTitle>
              <RowDescription>{t('mgRightRowDesc')}</RowDescription>
            </RowCopy>
            <Switch
              clickable
              value={rightEnabled}
              onClick={() => setOption('enabled', !rightEnabled)}
            />
          </SettingRow>
          <SettingRow>
            <IconBox $tone="pink">
              <PaintBrush size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('mgTrailColor')}</RowTitle>
              <RowDescription>{t('mgTrailColorDesc')}</RowDescription>
            </RowCopy>
            <ColorControl>
              <ColorInput
                type="color"
                value={color}
                onChange={(event) => setOption('color', event.target.value)}
                aria-label={t('mgTrailColor')}
              />
              <span>{color.toUpperCase()}</span>
            </ColorControl>
          </SettingRow>
          <SettingRow>
            <IconBox $tone="green">
              <Path size={17} weight="fill" />
            </IconBox>
            <RowCopy>
              <RowTitle>{t('mgActionMappings')}</RowTitle>
              <RowDescription>
                {t('mgMappingsSummary', {
                  count: boundCount,
                  color: color.toUpperCase(),
                })}
              </RowDescription>
            </RowCopy>
            <ActionButton
              type="button"
              $primary
              onClick={() => setModal('mappings')}
            >
              <SquaresFour size={15} />
              {t('mgManageMappings')}
            </ActionButton>
          </SettingRow>
        </Card>
      </Group>
      {modal &&
        ReactDOM.createPortal(
          <ModalLayer
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setModal(null);
            }}
          >
            <Modal
              role="dialog"
              aria-modal="true"
              aria-labelledby="gesture-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <ModalHead>
                <ModalTitle id="gesture-modal-title">{modalTitle}</ModalTitle>
                <CloseButton
                  type="button"
                  onClick={() => setModal(null)}
                  title={t('close')}
                  aria-label={t('close')}
                >
                  <X size={18} />
                </CloseButton>
              </ModalHead>
              <ModalBody>{renderModalContent()}</ModalBody>
            </Modal>
          </ModalLayer>,
          document.querySelector('[data-settings-main]') || document.body,
        )}
    </>
  );
});
