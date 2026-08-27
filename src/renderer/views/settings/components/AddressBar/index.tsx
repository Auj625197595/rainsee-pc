import * as React from 'react';

import { Dropdown } from '~/renderer/components/Dropdown';
import { Switch } from '~/renderer/components/Switch';
import {
  Title,
  Control,
  Header,
  Back,
  Row,
  SecondaryText,
  SettingIcon,
} from '../App/style';
import {
  HighlightRow,
  Group,
  GroupTitle,
  GroupRow,
  GroupRowStatic,
  Chevron,
} from './style';
import store from '../../store';
import { onSwitchChange } from '../../utils';
import { observer } from 'mobx-react-lite';
import {
  EnginesTable,
  TableRow,
  TableCell,
  TableHeader,
  DragHandle,
  EditButton,
  EngineOption,
  EngineIcon,
  EfficiencySearchCard,
  ModeSelector,
  ModeButton,
  EngineChoices,
  EngineChoice,
  ChoiceMark,
  ChoiceHelp,
  SuggestionGrid,
  SuggestionItem,
} from './style';
import { NormalButton } from '../App';
import { EfficiencySearchMode, ISearchEngine } from '~/interfaces';
import { Check, MagnifyingGlass, Sparkle } from '@phosphor-icons/react';

// 导航行右侧的 > 箭头(跟随 currentColor)
const ChevronIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);

// 搜索引擎 AI 建议面板开关:高亮显示,突出这是个新能力。
const SearchAnnotatorToggle = observer(() => {
  const value = (store.settings as any).searchAnnotator as boolean;

  return (
    <GroupRow onClick={onSwitchChange('searchAnnotator')}>
      <SettingIcon tone="purple">
        <Sparkle size={19} weight="fill" />
      </SettingIcon>
      <div>
        <Title>搜索引擎 AI 建议面板</Title>
        <SecondaryText>在搜索结果中提供相关性提示与答案建议。</SecondaryText>
      </div>
      <Control>
        <Switch value={value} />
      </Control>
    </GroupRow>
  );
});

const SuggestionsToggle = observer(() => {
  const { suggestions } = store.settings;

  return (
    <GroupRow onClick={onSwitchChange('suggestions')}>
      <SettingIcon tone="cyan">
        <MagnifyingGlass size={19} weight="fill" />
      </SettingIcon>
      <div>
        <Title>展示搜索和网站建议</Title>
        <SecondaryText>
          在地址栏输入时显示标签页、历史记录和书签等联想。
        </SecondaryText>
      </div>
      <Control>
        <Switch value={suggestions} />
      </Control>
    </GroupRow>
  );
});

// 各联想来源开关(总开关关闭时禁用并置灰)。indent 体现其为总开关的下级项。
const SuggestSourceRow = observer(
  ({ settingKey, title }: { settingKey: string; title: string }) => {
    const { suggestions } = store.settings;
    const value = (store.settings as any)[settingKey] as boolean;

    return (
      <SuggestionItem
        disabled={!suggestions}
        onClick={suggestions ? onSwitchChange(settingKey) : undefined}
      >
        <Title>{title}</Title>
        <Control>
          <Switch value={value} />
        </Control>
      </SuggestionItem>
    );
  },
);

const onSearchEngineChange = (value: string) => {
  const { searchEngines } = store.settings;
  store.settings.searchEngine = searchEngines.indexOf(
    searchEngines.find((x) => x.name === value),
  );
  store.save();
};

// 切换副搜索引擎(双引擎搜索右侧边栏用)。按下标写入 secondarySearchEngine。
const onSecondarySearchEngineChange = (value: string) => {
  const { searchEngines } = store.settings;
  store.settings.secondarySearchEngine = searchEngines.indexOf(
    searchEngines.find((x) => x.name === value),
  );
  store.save();
};
const SearchEngineRow = observer(() => {
  const se = store.searchEngine;

  return (
    <GroupRowStatic>
      <Title>搜索引擎</Title>
      <Control>
        <Dropdown defaultValue={se.name} onChange={onSearchEngineChange}>
          {Object.values(store.settings.searchEngines).map((item, key) => (
            <Dropdown.Item key={key} value={item.name}>
              <EngineOption>
                <EngineIcon icon={item.icon} />
                {item.name}
              </EngineOption>
            </Dropdown.Item>
          ))}
        </Dropdown>
      </Control>
    </GroupRowStatic>
  );
});

const EFFICIENCY_MODES: Array<{
  value: EfficiencySearchMode;
  label: string;
}> = [
  { value: 'normal', label: '正常' },
  { value: 'dual', label: '双列搜索' },
  { value: 'multi-tab', label: '多开标签' },
];

const EfficiencySearchSetting = observer(() => {
  const mode = store.settings.efficiencySearchMode;
  // 渲染期读取以订阅变化(effect 才能在 highlightedSetting 改变后重跑)。
  const highlight = store.highlightedSetting;
  const [flashing, setFlashing] = React.useState(false);
  // 去重:同一 highlight 值只处理一次,避免反复滚动。
  const handledRef = React.useRef<string | null>(null);

  // 告知条「设置」按钮跳转来时(highlightedSetting 命中),滚动入视 + 短暂脉冲。
  // 注意:不能在此 effect 里回写 highlightedSetting——它在依赖数组中,回写会立刻
  // 触发 cleanup,清掉滚动用的 setTimeout,导致永远滚不到。改用 ref 去重。
  React.useEffect(() => {
    if (highlight !== 'efficiencySearch' && highlight !== 'dualEngineSearch')
      return;
    if (handledRef.current === highlight) return;
    handledRef.current = highlight;

    const doScroll = () =>
      document
        .getElementById('setting-efficiency-search')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setFlashing(true);
    // 冷启动挂载时元素可能尚未稳定布局,多试几次确保滚到位。
    doScroll();
    const t1 = setTimeout(doScroll, 140);
    const t2 = setTimeout(doScroll, 450);
    const t3 = setTimeout(() => setFlashing(false), 3400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [highlight]);

  return (
    <EfficiencySearchCard id="setting-efficiency-search" flashing={flashing}>
      <ModeSelector role="radiogroup" aria-label="效率搜索模式">
        {EFFICIENCY_MODES.map((item) => {
          return (
            <ModeButton
              key={item.value}
              type="button"
              role="radio"
              aria-checked={mode === item.value}
              selected={mode === item.value}
              onClick={() => {
                store.settings.efficiencySearchMode = item.value;
                store.save();
              }}
            >
              {item.label}
            </ModeButton>
          );
        })}
      </ModeSelector>
    </EfficiencySearchCard>
  );
});

// 副搜索引擎选择(双引擎关闭时禁用并置灰)。
const SecondaryEngineRow = observer(() => {
  const se = store.secondarySearchEngine;

  return (
    <GroupRowStatic>
      <Title>副搜索引擎</Title>
      <Control>
        <Dropdown
          defaultValue={se?.name}
          onChange={onSecondarySearchEngineChange}
        >
          {Object.values(store.settings.searchEngines).map((item, key) => (
            <Dropdown.Item key={key} value={item.name}>
              <EngineOption>
                <EngineIcon icon={item.icon} />
                {item.name}
              </EngineOption>
            </Dropdown.Item>
          ))}
        </Dropdown>
      </Control>
    </GroupRowStatic>
  );
});

const MultiEngineRows = observer(() => {
  const selected = new Set(store.settings.efficiencySearchEngineKeywords || []);

  const toggle = (keyword: string) => {
    const next = new Set(selected);
    if (next.has(keyword)) {
      if (next.size <= 2) return;
      next.delete(keyword);
    } else {
      next.add(keyword);
    }
    store.settings.efficiencySearchEngineKeywords = Array.from(next);
    store.save();
  };

  return (
    <GroupRowStatic>
      <div style={{ width: '100%' }}>
        <ChoiceHelp>
          至少选择两个搜索引擎；此选择不受默认搜索引擎影响。
        </ChoiceHelp>
        <EngineChoices>
          {store.settings.searchEngines.map((engine) => {
            const checked = selected.has(engine.keyword);
            const disabled = checked && selected.size <= 2;
            return (
              <EngineChoice
                key={engine.keyword}
                type="button"
                role="checkbox"
                aria-checked={checked}
                selected={checked}
                disabled={disabled}
                onClick={() => toggle(engine.keyword)}
                title={disabled ? '多开标签至少需要两个搜索引擎' : undefined}
              >
                <ChoiceMark selected={checked}>
                  {checked && <Check size={12} weight="bold" />}
                </ChoiceMark>
                <EngineIcon icon={engine.icon} />
                {engine.name}
              </EngineChoice>
            );
          })}
        </EngineChoices>
      </div>
    </GroupRowStatic>
  );
});

const onBackClick = () => {
  store.selectedSection = 'address-bar';
};

const onEditMenuClick =
  (data: ISearchEngine) => (e: React.MouseEvent<HTMLDivElement>) => {
    const { top, left } = e.currentTarget.getBoundingClientRect();
    store.menuInfo.left = left - store.menuRef.current.offsetWidth;
    store.menuInfo.top = top;

    store.editedSearchEngine = data;
    store.menuVisible = true;
  };

const reorderEngines = (fromKeyword: string, toKeyword: string) => {
  if (fromKeyword === toKeyword) return;

  const engines = store.settings.searchEngines.slice();
  const fromIndex = engines.findIndex((x) => x.keyword === fromKeyword);
  const toIndex = engines.findIndex((x) => x.keyword === toKeyword);
  if (fromIndex === -1 || toIndex === -1) return;

  // 记录当前默认引擎，移动后按 keyword 重新定位它的索引
  const defaultKeyword = store.searchEngine.keyword;

  const [moved] = engines.splice(fromIndex, 1);
  engines.splice(toIndex, 0, moved);

  store.settings.searchEngines = engines;
  store.settings.searchEngine = engines.findIndex(
    (x) => x.keyword === defaultKeyword,
  );
  store.save();
};

export const SearchEngine = observer(({ data }: { data: ISearchEngine }) => {
  const isDefault = store.searchEngine.keyword === data.keyword;
  const dragging = store.draggedEngineKeyword === data.keyword;

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    store.draggedEngineKeyword = data.keyword;
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (store.draggedEngineKeyword) {
      reorderEngines(store.draggedEngineKeyword, data.keyword);
    }
    store.draggedEngineKeyword = null;
  };

  const onDragEnd = () => {
    store.draggedEngineKeyword = null;
  };

  return (
    <TableRow
      bold={isDefault}
      dragging={dragging}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <TableCell>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <EngineIcon icon={data.icon} />
          {data.name} {isDefault && '(Default)'}
        </div>
      </TableCell>
      <TableCell>
        <div>{data.keyword}</div>
      </TableCell>
      <DragHandle
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="拖动排序"
      />
      <EditButton onClick={onEditMenuClick(data)} title="编辑" />
    </TableRow>
  );
});

const onAddClick = () => {
  store.dialogVisible = true;
  store.dialogContent = 'add-search-engine';
  store.searchEngineInputRef.current.value = '';
  store.searchEngineKeywordInputRef.current.value = '';
  store.searchEngineUrlInputRef.current.value = '';
};

export const ManageSearchEngines = observer(() => {
  return (
    <>
      <Header>
        <Back onClick={onBackClick} />
        管理搜索引擎
      </Header>
      <Row>
        <Title>搜索引擎</Title>
        <Control>
          <NormalButton onClick={onAddClick}>添加</NormalButton>
        </Control>
      </Row>
      <EnginesTable>
        <TableRow>
          <TableHeader>搜索引擎</TableHeader>
          <TableHeader>关键词</TableHeader>
          <TableHeader></TableHeader>
          <TableHeader></TableHeader>
        </TableRow>
        {store.settings.searchEngines.map((item, key) => (
          <SearchEngine key={item.keyword} data={item} />
        ))}
      </EnginesTable>
    </>
  );
});

const onManageSearchEngines = () => {
  store.selectedSection = 'search-engines';
};

export const AddressBar = observer(() => {
  const efficiencyMode = store.settings.efficiencySearchMode;

  return (
    <>
      <GroupTitle>搜索建议</GroupTitle>
      <Group>
        <SuggestionsToggle />
      </Group>

      <GroupTitle>建议来源</GroupTitle>
      <SuggestionGrid>
        <SuggestSourceRow settingKey="suggestTabs" title="打开的标签页" />
        <SuggestSourceRow
          settingKey="suggestSearchHistory"
          title="历史搜索词"
        />
        <SuggestSourceRow settingKey="suggestBookmarks" title="书签" />
        <SuggestSourceRow settingKey="suggestHistory" title="历史记录" />
        <SuggestSourceRow settingKey="suggestEngine" title="搜索引擎建议词" />
        <SuggestSourceRow settingKey="suggestClipboard" title="剪贴板内容" />
      </SuggestionGrid>

      {/* 搜索引擎:默认引擎下拉 + 管理入口(箭头示意可跳转) */}
      <GroupTitle>搜索引擎</GroupTitle>
      <Group>
        <SearchEngineRow />
        <GroupRow onClick={onManageSearchEngines}>
          <Title>管理搜索引擎</Title>
          <Chevron>
            <ChevronIcon />
          </Chevron>
        </GroupRow>
      </Group>

      <GroupTitle>效率搜索</GroupTitle>
      <EfficiencySearchSetting />
      {efficiencyMode !== 'normal' && (
        <Group>
          {efficiencyMode === 'dual' ? (
            <SecondaryEngineRow />
          ) : (
            <MultiEngineRows />
          )}
        </Group>
      )}

      <GroupTitle>智能</GroupTitle>
      <Group>
        <SearchAnnotatorToggle />
      </Group>
    </>
  );
});
