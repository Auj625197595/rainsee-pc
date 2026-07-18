import * as React from 'react';
import styled, { css } from 'styled-components';

import { Dropdown } from '~/renderer/components/Dropdown';
import { Switch } from '~/renderer/components/Switch';
import { Title, Row, Control, Header, SecondaryText } from '../App/style';
import store from '../../store';
import { onSwitchChange } from '../../utils';
import { observer } from 'mobx-react-lite';
import { TopBarVariant, TabsLayout } from '~/interfaces';

const onThemeChange = (value: string) => {
  if (value === 'auto') {
    store.settings.themeAuto = true;
  } else {
    store.settings.themeAuto = false;
    store.settings.theme = value;
  }

  store.save();
};

const ThemeVariant = observer(() => {
  const defaultValue = store.settings.theme;

  return (
    <Row>
      <Title>主题颜色</Title>
      <Control>
        <Dropdown
          defaultValue={store.settings.themeAuto ? 'auto' : defaultValue}
          onChange={onThemeChange}
        >
          <Dropdown.Item value="auto">自动</Dropdown.Item>
          <Dropdown.Item value="wexond-light">浅色</Dropdown.Item>
          <Dropdown.Item value="wexond-dark">深色</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const onTopBarChange = (value: TopBarVariant) => {
  store.settings.topBarVariant = value;
  store.save();
};

const TopBarVariant = observer(() => {
  return (
    <Row>
      <Title>顶部标题栏</Title>
      <Control>
        <Dropdown
          defaultValue={store.settings.topBarVariant}
          onChange={onTopBarChange}
        >
          <Dropdown.Item value="default">分离显示</Dropdown.Item>
          <Dropdown.Item value="compact">融合显示</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const onTabsLayoutChange = (value: TabsLayout) => {
  store.settings.tabsLayout = value;
  store.save();
};

const TabsLayoutVariant = observer(() => {
  return (
    <Row>
      <Title>标签栏位置</Title>
      <Control>
        <Dropdown
          defaultValue={store.settings.tabsLayout || 'top'}
          onChange={onTabsLayoutChange}
        >
          <Dropdown.Item value="top">顶部</Dropdown.Item>
          <Dropdown.Item value="left">左侧边栏</Dropdown.Item>
          <Dropdown.Item value="right">右侧边栏</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const WarnQuit = observer(() => {
  const { warnOnQuit } = store.settings;

  return (
    <Row onClick={onSwitchChange('warnOnQuit')}>
      <Title>当关闭多个标签时显示警告弹窗</Title>
      <Control>
        <Switch value={warnOnQuit} />
      </Control>
    </Row>
  );
});

const CloseTabOnDoubleClick = observer(() => {
  const { closeTabOnDoubleClick } = store.settings;

  return (
    <Row onClick={onSwitchChange('closeTabOnDoubleClick')}>
      <Title>双击关闭标签页</Title>
      <Control>
        <Switch value={closeTabOnDoubleClick} />
      </Control>
    </Row>
  );
});

const MemorySaver = observer(() => {
  const { memorySaver } = store.settings;

  return (
    <Row onClick={onSwitchChange('memorySaver')}>
      <Title>内存节省</Title>
      <Control>
        <Switch value={memorySaver} />
      </Control>
    </Row>
  );
});

const MenuAnimations = observer(() => {
  const { animations } = store.settings;

  return (
    <Row onClick={onSwitchChange('animations')}>
      <Title>菜单动画</Title>
      <Control>
        <Switch value={animations} />
      </Control>
    </Row>
  );
});

const BookmarksBar = observer(() => {
  const { bookmarksBar } = store.settings;

  return (
    <Row onClick={onSwitchChange('bookmarksBar')}>
      <Title>显示书签栏</Title>
      <Control>
        <Switch value={bookmarksBar} />
      </Control>
    </Row>
  );
});

const onBookmarksBarRowsChange = (value: string) => {
  store.settings.bookmarksBarRows = parseInt(value, 10);
  store.save();
};

const BookmarksBarRows = observer(() => {
  const { bookmarksBarRows } = store.settings;

  return (
    <Row>
      <Title>书签栏行数</Title>
      <Control>
        <Dropdown
          defaultValue={String(bookmarksBarRows ?? 1)}
          onChange={onBookmarksBarRowsChange}
        >
          <Dropdown.Item value="1">1 行</Dropdown.Item>
          <Dropdown.Item value="2">2 行</Dropdown.Item>
          <Dropdown.Item value="3">3 行</Dropdown.Item>
        </Dropdown>
      </Control>
    </Row>
  );
});

const ImmersiveBrowsing = observer(() => {
  const { immersiveBrowsing } = store.settings;

  const onImmersiveBrowsingChange = () => {
    const enabling = !store.settings.immersiveBrowsing;
    const verticalTabs = (store.settings.tabsLayout || 'top') !== 'top';

    if (enabling && verticalTabs) {
      alert('沉浸模式暂时不支持垂直标签页，请先关闭垂直标签页；');
      return;
    }

    store.settings.immersiveBrowsing = !store.settings.immersiveBrowsing;
    store.save();
  };

  return (
    <Row onClick={onImmersiveBrowsingChange}>
      <div>
        <Title>沉浸浏览</Title>
        <SecondaryText>
          网页尽量铺满窗口，鼠标移到顶部边缘时再显示头部；当前主要用于顶部标签布局。
        </SecondaryText>
      </div>
      <Control>
        <Switch value={immersiveBrowsing} />
      </Control>
    </Row>
  );
});

export const Appearance = observer(() => {
  return (
    <>
      <Header>个性化</Header>
      {/* <MenuAnimations /> */}
      <ImmersiveBrowsing />
      <BookmarksBar />
      {/* 书签栏隐藏时,行数设置失去意义,一并隐藏 */}
      {store.settings.bookmarksBar && <BookmarksBarRows />}
      <WarnQuit />
      <ThemeVariant />
      <TopBarVariant />
      <TabsLayoutVariant />
      <CloseTabOnDoubleClick />
      <MemorySaver />
    </>
  );
});
