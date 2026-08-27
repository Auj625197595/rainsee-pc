import * as React from 'react';
import {observer} from 'mobx-react-lite';

import store from '../../store';
import { isImmersiveHeaderWindow } from '../../utils/windows';
import {realurl} from '~/utils';
import {extractSearchQuery, getExternalProtocol} from '~/utils/url';
import {callViewMethod} from '~/utils/view';
import {notifyDualEngineSearch} from '../../utils/dual-engine';
import {getWebUIURL} from '~/common/webui';
import {clipboard, ipcRenderer} from 'electron';
import {ToolbarButton} from '../ToolbarButton';
import {StyledAddressBar, InputContainer, Input, Text} from './style';
import {ICON_SEARCH} from '~/renderer/constants';
import {SiteButtons} from '../SiteButtons';
import {SearchEngineSwitcher} from '../SearchEngineSwitcher';
import {getAddressBarSearchAnchor} from '../../utils/dialogs';
import MyInput from "./input";
import * as remote from "@electron/remote";

const MIN_ADDRESSBAR_WIDTH = 120;
const ADDRESSBAR_DRAG_THRESHOLD = 3;

let addressbarMouseGesture: {
  startX: number;
  startY: number;
  dragged: boolean;
} | null = null;

const getAddressBarCompactLevel = (width: number) => {
  if (width <= 900) return 9;
  if (width <= 950) return 8;
  if (width <= 1000) return 7;
  if (width <= 1050) return 6;
  if (width <= 1100) return 5;
  if (width <= 1150) return 4;
  if (width <= 1200) return 3;
  if (width <= 1250) return 2;
  if (width <= 1300) return 1;
  return 0;
};

const onMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
  e.stopPropagation();

  if (e.button === 0) {
    addressbarMouseGesture = {
      startX: e.clientX,
      startY: e.clientY,
      dragged: false,
    };
  }

  if (!store.isCompact) return;

  store.addressbarTextVisible = false;
  store.addressbarFocused = true;
};

const onMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
  if (!addressbarMouseGesture || (e.buttons & 1) === 0) return;

  const deltaX = Math.abs(e.clientX - addressbarMouseGesture.startX);
  const deltaY = Math.abs(e.clientY - addressbarMouseGesture.startY);
  if (deltaX > ADDRESSBAR_DRAG_THRESHOLD || deltaY > ADDRESSBAR_DRAG_THRESHOLD) {
    addressbarMouseGesture.dragged = true;
  }
};

const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
  store.addressbarTextVisible = false;
  store.addressbarFocused = true;

  if (store.tabs.selectedTab) {
    store.tabs.selectedTab.addressbarFocused = true;
  }

  // 鼠标按下触发聚焦时不能提前全选，否则会破坏随后进行的原生拖选。
  // 紧凑模式下仅为键盘快捷键等程序化聚焦保留自动全选。
  if (store.isCompact && !addressbarMouseGesture) {
    // ipcRenderer.send(`window-fix-dragging-${store.windowId}`);
    e.currentTarget.select();
  }

  // gosearch 等程序化聚焦请求弹出面板:消费一次性标志位。
  // 新标签页的程序化聚焦不置位,故不会自动弹面板(需求 1)。
  if (store.addressbarShowSuggestionsOnFocus) {
    store.addressbarShowSuggestionsOnFocus = false;
    const val = e.currentTarget.value;
    changeText(val, val.length, true, store.addressbarOpenInNewTab);
  }
};

const onSelect = (e: React.MouseEvent<HTMLInputElement>) => {
  if (store.tabs.selectedTab) {
    store.tabs.selectedTab.addressbarSelectionRange = [
      e.currentTarget.selectionStart,
      e.currentTarget.selectionEnd,
    ];
  }
};

const onMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
  const input = e.currentTarget;
  const mouseGesture = addressbarMouseGesture;
  addressbarMouseGesture = null;

  if (e.button !== 0) return;

  const dragged =
    mouseGesture?.dragged ||
    (mouseGesture &&
      (Math.abs(e.clientX - mouseGesture.startX) > ADDRESSBAR_DRAG_THRESHOLD ||
        Math.abs(e.clientY - mouseGesture.startY) > ADDRESSBAR_DRAG_THRESHOLD));

  // 按住拖拽时保留浏览器原生文本选择，不唤起联想弹框。
  if (dragged) {
    store.mouseUpped = true;
    return;
  }

  // 普通点击地址栏时全选当前内容，并把同样的全选状态传给搜索弹框。
  input.select();
  const val = input.value;
  changeText(val, val.length, true, true);
  store.mouseUpped = true;
};

const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  // Enter confirms an IME candidate. It must not navigate the page.
  if (e.nativeEvent.isComposing || e.keyCode === 229) return;

  if (e.key === 'Escape') {
    store.tabs.selectedTab.addressbarValue = null;
  }

  if (e.key === 'Escape') {
    const target = e.currentTarget;
    requestAnimationFrame(() => {
      target.select();
    });
  }

  if (e.key === 'Enter') {
    enterNow(e.currentTarget.value, e.currentTarget);
  }
};

const normalizeInternalInputUrl = (value: string) => {
  const trimmed = (value || '').trim();
  const match = /^(chrome:\/\/flags|yjllq:\/\/flags|ktllq:\/\/flags)([/?#].*)?$/i.exec(
    trimmed,
  );

  if (match) {
    return `${getWebUIURL('flags')}${match[2] || ''}`;
  }

  return realurl(trimmed, store.settings.searchEngine.url);
};

const enterNow = (value: string, target: any) => {
  if (!store.tabs.selectedTab || !target) return;
  const url = normalizeInternalInputUrl(value);
  // 外部协议(motrixnext://、thunder://、magnet:、mailto: 等)→ 唤起系统默认应用,
  // 不在页内加载也不当搜索词。须在改写地址栏值/导航之前拦截,以免地址栏被改成协议串。
  if (getExternalProtocol(url)) {
    ipcRenderer.send('open-external-url', url);
    blurNow(target);
    return;
  }
  const query = extractSearchQuery(store.settings.searchEngine.url, url);
  if (
    query &&
    store.settings.object.efficiencySearchMode === 'multi-tab'
  ) {
    store.openMultiSearchTabs(query);
    blurNow(target);
    return;
  }
  store.tabs.selectedTab.addressbarValue = url;
  if (store.addressbarOpenInNewTab) {
    store.tabs.addTab({url, active: true}).then((tab) => {
      if (
        query &&
        tab &&
        store.settings.object.efficiencySearchMode === 'dual'
      ) {
        notifyDualEngineSearch(query, tab.id);
      }
    });
  } else {
    callViewMethod(store.tabs.selectedTabId, 'loadURL', url);
    if (query && store.settings.object.efficiencySearchMode === 'dual') {
      notifyDualEngineSearch(query);
    }
  }
  blurNow(target);
}

const pasteAndGo = (value: string, target: HTMLInputElement | null) => {
  if (!target) return;
  const text = value == null ? '' : value;
  changeText(text, text.length, false);
  enterNow(text, target);
};

let addressbarRef: HTMLDivElement;

const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const inputType = String((e.nativeEvent as InputEvent).inputType || '');

  changeText(
    e.currentTarget.value,
    e.currentTarget.selectionStart,
    true,
    false,
    inputType.startsWith('delete'),
  );
};

const changeText = (
  t: string,
  cursorPos: any,
  showSearch: boolean,
  selectAll = false,
  suppressAutocomplete = false,
) => {
  if (store.tabs.selectedTab) {
    store.tabs.selectedTab.addressbarValue = t;
  }

  const anchor = getAddressBarSearchAnchor(addressbarRef);
  if (!anchor) return;

  // 即使输入为空也发送:搜索对话框会在空输入时展示历史搜索词。
  if (showSearch) {
    if (isImmersiveHeaderWindow()) {
      store.immersiveSearchActive = true;
    }
    ipcRenderer.send(`search-show-${store.windowId}`, {
      text: t,
      cursorPos: cursorPos,
      selectAll,
      suppressAutocomplete,
      ...anchor,
      openInNewTab: store.addressbarOpenInNewTab,
    });
    store.addressbarEditing = true;
  }
}
const blurNow = (target: any) => {
  //console.log("blurNow", target);
  target.blur();
  window.getSelection().removeAllRanges();
  store.addressbarTextVisible = true;
  store.addressbarFocused = false;
  store.mouseUpped = false;
  store.addressbarOpenInNewTab = false;

  // if (store.isCompact && !store.addressbarEditing)
  //   ipcRenderer.send(`window-fix-dragging-${store.windowId}`);

  const {selectedTab} = store.tabs;

  if (selectedTab) {
    selectedTab.addressbarFocused = false;
  }
};

const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
  if (isImmersiveHeaderWindow() && store.immersiveSearchActive) return;
  blurNow(e.currentTarget);
};

const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
  const menu = remote.Menu.buildFromTemplate([
    {
      label: '复制',
      click: () => {
        clipboard.clear();
        clipboard.writeText(store.addressbarValue);
      },
    },
    {
      label: '粘贴',
      click: () => {
        let t = clipboard.readText();
        if (t == null) {
          t = "";
        }
        changeText(t, t.length, true);
      },
    },
    {
      label: '粘贴并转到',
      click: () => {
        pasteAndGo(clipboard.readText(), store.inputRef || null);
      },
    },
  ]);

  menu.popup();
};

export const AddressBar = observer(() => {
  const [compactLevel, setCompactLevel] = React.useState(() =>
    getAddressBarCompactLevel(window.innerWidth),
  );

  const setRootRef = React.useCallback((node: HTMLDivElement | null) => {
    addressbarRef = node;
  }, []);

  React.useEffect(() => {
    const handlePasteAndGo = () => {
      pasteAndGo(clipboard.readText(), store.inputRef || null);
    };

    ipcRenderer.on('addressbar-paste-and-go', handlePasteAndGo);

    return () => {
      ipcRenderer.removeListener('addressbar-paste-and-go', handlePasteAndGo);
    };
  }, []);

  React.useEffect(() => {
    const updateCompactLevel = () => {
      setCompactLevel(getAddressBarCompactLevel(window.innerWidth));
    };

    window.addEventListener('resize', updateCompactLevel);
    return () => window.removeEventListener('resize', updateCompactLevel);
  }, []);

  const inputTextVisible =
    !store.addressbarTextVisible || store.addressbarValue === '';

  return (
    <StyledAddressBar
      data-rainsee-part="address-bar"
      id="addressbar"
      ref={setRootRef}
      focus={store.addressbarFocused}
      $compactLevel={compactLevel}
      $minWidth={MIN_ADDRESSBAR_WIDTH}
    >
      <SearchEngineSwitcher />
      <InputContainer
        data-addressbar-input
        data-rainsee-part="address-input-container"
      >
        <MyInput
          data-rainsee-part="address-input"
          data-rainsee-input-visible={inputTextVisible ? 'true' : 'false'}
          ref={(r) => (store.inputRef = r)}
          spellCheck={false}
          onKeyDown={onKeyDown}
          onMouseDown={onMouseDown}
          onSelect={onSelect}
          onBlur={onBlur}
          onFocus={onFocus}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onChange={onChange}
          placeholder="搜索或输入网址"
          onContextMenu={onContextMenu}
          visible={inputTextVisible}
          value={store.addressbarValue}
        ></MyInput>
        <Text
          visible={store.addressbarTextVisible && store.addressbarValue !== ''}
        >
          {store.addressbarUrlSegments.map((item, key) => (
            <div
              key={key}
              style={{
                opacity: item.grayOut ? 0.54 : 1,
              }}
            >
              {item.value}
            </div>
          ))}
        </Text>
      </InputContainer>
      {!store.isCompact && <SiteButtons/>}
    </StyledAddressBar>
  );
});
