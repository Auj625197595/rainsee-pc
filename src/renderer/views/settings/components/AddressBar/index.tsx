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
import { onSwitchChange, getSettingsTranslator } from '../../utils';
import { observer } from 'mobx-react-lite';
import type { MessageKey } from '~/common/i18n';
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
import { resolveEngineShortcuts } from '~/utils/search-shortcut';

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
  const t = getSettingsTranslator();
  const value = (store.settings as any).searchAnnotator as boolean;

  return (
    <GroupRow onClick={onSwitchChange('searchAnnotator')}>
      <SettingIcon tone="purple">
        <Sparkle size={19} weight="fill" />
      </SettingIcon>
      <div>
        <Title>{t('searchAiSuggestionsPanel')}</Title>
        <SecondaryText>{t('abAiSuggestionsDesc')}</SecondaryText>
      </div>
      <Control>
        <Switch value={value} />
      </Control>
    </GroupRow>
  );
});

const SuggestionsToggle = observer(() => {
  const t = getSettingsTranslator();
  const { suggestions } = store.settings;

  return (
    <GroupRow onClick={onSwitchChange('suggestions')}>
      <SettingIcon tone="cyan">
        <MagnifyingGlass size={19} weight="fill" />
      </SettingIcon>
      <div>
        <Title>{t('searchSuggestions')}</Title>
        <SecondaryText>{t('abSuggestionsDesc')}</SecondaryText>
      </div>
      <Control>
        <Switch value={suggestions} />
      </Control>
    </GroupRow>
  );
});

// 各联想来源开关(总开关关闭时禁用并置灰)。indent 体现其为总开关的下级项。
const SuggestSourceRow = observer(
  ({
    settingKey,
    labelKey,
  }: {
    settingKey: string;
    labelKey: MessageKey;
  }) => {
    const t = getSettingsTranslator();
    const { suggestions } = store.settings;
    const value = (store.settings as any)[settingKey] as boolean;

    return (
      <SuggestionItem
        disabled={!suggestions}
        onClick={suggestions ? onSwitchChange(settingKey) : undefined}
      >
        <Title>{t(labelKey)}</Title>
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
  const t = getSettingsTranslator();
  const se = store.searchEngine;

  return (
    <GroupRowStatic>
      <Title>{t('abSearchEngine')}</Title>
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
  labelKey: MessageKey;
}> = [
  { value: 'normal', labelKey: 'abEfficiencyNormal' },
  { value: 'dual', labelKey: 'abEfficiencyDual' },
  { value: 'multi-tab', labelKey: 'abEfficiencyMultiTab' },
];

const EfficiencySearchSetting = observer(() => {
  const t = getSettingsTranslator();
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
      <ModeSelector role="radiogroup" aria-label={t('abEfficiencyModeAria')}>
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
              {t(item.labelKey)}
            </ModeButton>
          );
        })}
      </ModeSelector>
    </EfficiencySearchCard>
  );
});

// 副搜索引擎选择(双引擎关闭时禁用并置灰)。
const SecondaryEngineRow = observer(() => {
  const t = getSettingsTranslator();
  const se = store.secondarySearchEngine;

  return (
    <GroupRowStatic>
      <Title>{t('searchSecondaryEngine')}</Title>
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
  const t = getSettingsTranslator();
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
        <ChoiceHelp>{t('abMultiEngineHelp')}</ChoiceHelp>
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
                title={disabled ? t('abMultiEngineMinTwo') : undefined}
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

export const SearchEngine = observer(
  ({ data, shortcut }: { data: ISearchEngine; shortcut: string }) => {
  const t = getSettingsTranslator();
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
        <div title={data.keyword}>{shortcut}</div>
      </TableCell>
      <DragHandle
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title={t('dragToSort')}
      />
      <EditButton onClick={onEditMenuClick(data)} title={t('edit')} />
    </TableRow>
  );
  },
);

const onAddClick = () => {
  store.dialogVisible = true;
  store.dialogContent = 'add-search-engine';
  store.searchEngineInputRef.current.value = '';
  store.searchEngineKeywordInputRef.current.value = '';
  store.searchEngineUrlInputRef.current.value = '';
  store.searchEngineShortcutInputRef.current.value = '';
  store.searchEngineShortcutPlaceholder = '';
  store.searchEngineShortcutError = '';
};

export const ManageSearchEngines = observer(() => {
  const t = getSettingsTranslator();
  const shortcuts = resolveEngineShortcuts(store.settings.searchEngines);

  return (
    <>
      <Header>
        <Back onClick={onBackClick} />
        {t('manageSearchEngines')}
      </Header>
      <SecondaryText style={{ margin: '0 0 8px' }}>
        {t('abShortcutIntro')}
      </SecondaryText>
      <Row>
        <Title>{t('abSearchEngine')}</Title>
        <Control>
          <NormalButton onClick={onAddClick}>{t('add')}</NormalButton>
        </Control>
      </Row>
      <EnginesTable>
        <TableRow>
          <TableHeader>{t('abSearchEngine')}</TableHeader>
          <TableHeader>{t('sdlgShortcut')}</TableHeader>
          <TableHeader></TableHeader>
          <TableHeader></TableHeader>
        </TableRow>
        {store.settings.searchEngines.map((item, key) => (
          <SearchEngine
            key={item.keyword}
            data={item}
            shortcut={shortcuts[key]}
          />
        ))}
      </EnginesTable>
    </>
  );
});

const onManageSearchEngines = () => {
  store.selectedSection = 'search-engines';
};

export const AddressBar = observer(() => {
  const t = getSettingsTranslator();
  const efficiencyMode = store.settings.efficiencySearchMode;

  return (
    <>
      <GroupTitle>{t('abSuggestionsSection')}</GroupTitle>
      <Group>
        <SuggestionsToggle />
      </Group>

      <GroupTitle>{t('abSuggestSourcesSection')}</GroupTitle>
      <SuggestionGrid>
        <SuggestSourceRow settingKey="suggestTabs" labelKey="abSuggestTabs" />
        <SuggestSourceRow
          settingKey="suggestSearchHistory"
          labelKey="abSuggestSearchHistory"
        />
        <SuggestSourceRow
          settingKey="suggestBookmarks"
          labelKey="abSuggestBookmarks"
        />
        <SuggestSourceRow
          settingKey="suggestHistory"
          labelKey="abSuggestHistory"
        />
        <SuggestSourceRow
          settingKey="suggestEngine"
          labelKey="abSuggestEngine"
        />
        <SuggestSourceRow
          settingKey="suggestClipboard"
          labelKey="abSuggestClipboard"
        />
      </SuggestionGrid>

      {/* 搜索引擎:默认引擎下拉 + 管理入口(箭头示意可跳转) */}
      <GroupTitle>{t('abSearchEngine')}</GroupTitle>
      <Group>
        <SearchEngineRow />
        <GroupRow onClick={onManageSearchEngines}>
          <Title>{t('manageSearchEngines')}</Title>
          <Chevron>
            <ChevronIcon />
          </Chevron>
        </GroupRow>
      </Group>

      <GroupTitle>{t('abEfficiencySection')}</GroupTitle>
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

      <GroupTitle>{t('abSmartSection')}</GroupTitle>
      <Group>
        <SearchAnnotatorToggle />
      </Group>
    </>
  );
});
