import * as React from 'react';
import {observer} from 'mobx-react-lite';

import store from '../../store';
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

  if (!store.isCompact) return;

  store.addressbarTextVisible = false;
  store.addressbarFocused = true;
};

const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
  store.addressbarTextVisible = false;
  store.addressbarFocused = true;

  if (store.tabs.selectedTab) {
    store.tabs.selectedTab.addressbarFocused = true;
  }

  if (store.isCompact) {
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
  const shouldSelectAll =
    !store.isCompact &&
    input.selectionStart === input.selectionEnd &&
    !store.mouseUpped;

  if (
    shouldSelectAll
  ) {
    input.select();
  }

  // 仅保留原生选择交互:鼠标选中文本后不立刻切到搜索弹层。
  // 真正进入弹层的时机改为「程序化聚焦要求展示联想」或「用户开始输入」。
  store.mouseUpped = true;
};

const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
  store.tabs.selectedTab.addressbarValue = url;
  if (store.addressbarOpenInNewTab) {
    store.tabs.addTab({url, active: true});
  } else {
    callViewMethod(store.tabs.selectedTabId, 'loadURL', url);
  }
  // 双引擎搜索:若解析出的是主引擎搜索结果页,取搜索词触发副引擎侧边栏。
  const query = extractSearchQuery(store.settings.searchEngine.url, url);
  if (query) notifyDualEngineSearch(query);
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
  changeText(e.currentTarget.value, e.currentTarget.selectionStart, true);
};

const changeText = (
  t: string,
  cursorPos: any,
  showSearch: boolean,
  selectAll = false,
) => {
  if (store.tabs.selectedTab) {
    store.tabs.selectedTab.addressbarValue = t;
  }

  const anchor = getAddressBarSearchAnchor(addressbarRef);
  if (!anchor) return;

  // 即使输入为空也发送:搜索对话框会在空输入时展示历史搜索词。
  if (showSearch) {
    ipcRenderer.send(`search-show-${store.windowId}`, {
      text: t,
      cursorPos: cursorPos,
      selectAll,
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

  return (
    <StyledAddressBar
      id="addressbar"
      ref={setRootRef}
      focus={store.addressbarFocused}
      $compactLevel={compactLevel}
      $minWidth={MIN_ADDRESSBAR_WIDTH}
    >
      <SearchEngineSwitcher />
      <InputContainer data-addressbar-input>
        <MyInput
          ref={(r) => (store.inputRef = r)}
          spellCheck={false}
          onKeyDown={onKeyDown}
          onMouseDown={onMouseDown}
          onSelect={onSelect}
          onBlur={onBlur}
          onFocus={onFocus}
          onMouseUp={onMouseUp}
          onChange={onChange}
          placeholder="搜索或输入网址"
          onContextMenu={onContextMenu}
          visible={!store.addressbarTextVisible || store.addressbarValue === ''}
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
