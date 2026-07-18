import * as React from 'react';
import { observer } from 'mobx-react-lite';

import {
  Row,
  IconBox,
  Favicon,
  RowText,
  Title,
  Site,
  Time,
  RowRemove,
} from './style';
import { IHistoryItem } from '~/interfaces';
import { formatTime } from '../../utils';
import store from '../../store';
import { getIconByUrlNet } from '~/utils/url';
import { setDraggedLinkData } from '~/renderer/views/app/utils/link-drop';

const onClick = (item: IHistoryItem) => () => {
  const index = store.selectedItems.indexOf(item._id);

  if (index === -1) {
    store.selectedItems.push(item._id);
  } else {
    store.selectedItems.splice(index, 1);
  }
};

const onRemoveClick = (item: IHistoryItem) => (
  e: React.MouseEvent<HTMLDivElement>,
) => {
  e.stopPropagation();
  store.removeItems([item._id]);
};

// 点标题打开:勾选「在新页面打开」时 preventDefault 改开新标签;
// 未勾选则放行 <a> 默认行为(当前页打开,即现状)。stopPropagation 始终保留,
// 避免冒泡触发行 onClick 的选中切换。
const onTitleClick = (item: IHistoryItem) => (
  e: React.MouseEvent<HTMLAnchorElement>,
) => {
  e.stopPropagation();
  if (store.openInNewTab) {
    e.preventDefault();
    if (item.url) window.open(item.url, '_blank');
  }
};

const onTitleDragStart = (item: IHistoryItem) => (
  e: React.DragEvent<HTMLAnchorElement>,
) => {
  if (!item.url) {
    e.preventDefault();
    return;
  }
  setDraggedLinkData(e.dataTransfer, {
    url: item.url,
    title: item.title,
  });
};

// 无 favicon 时使用的通用页面图标。
const IconPage = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5L12 4l9 6.5"></path>
    <path d="M6 10v9h12v-9"></path>
  </svg>
);

// 删除按钮的 X 图标。
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M18 6L6 18M6 6l12 12"></path>
  </svg>
);

export default observer(({ data }: { data: IHistoryItem }) => {
  const selected = store.selectedItems.includes(data._id);

  const hasFavicon = data.favicon != null && data.favicon.trim() !== '';
  const faviconData = hasFavicon
    ? data.favicon.startsWith('data:')
      ? data.favicon
      : store.favicons.get(data.favicon)
    : null;
  const iconUrl = faviconData || (data.url ? getIconByUrlNet(data.url) : null);

  return (
    <Row key={data._id} onClick={onClick(data)} selected={selected}>
      <IconBox>
        {iconUrl ? (
          <Favicon style={{ backgroundImage: `url(${iconUrl})` }} />
        ) : (
          <IconPage />
        )}
      </IconBox>
      <RowText>
        <Title
          draggable={!!data.url}
          onClick={onTitleClick(data)}
          onDragStart={onTitleDragStart(data)}
          href={data.url}
        >
          {data.title}
        </Title>
        <Site>{data.url.split('/')[2]}</Site>
      </RowText>
      <Time>{formatTime(new Date(data.date))}</Time>
      <RowRemove onClick={onRemoveClick(data)}>
        <IconClose />
      </RowRemove>
    </Row>
  );
});
