import * as React from 'react';
import { observer } from 'mobx-react-lite';

import {
  StyledMultiLink,
  MultiLinkTag,
  MultiLinkText,
  MultiLinkAnchor,
  LinkCount,
} from './style';
import store from '../../store';
import { Clipboard } from '@phosphor-icons/react';
import { useI18n } from '~/renderer/components/I18n';

interface Props {
  visible: boolean;
}

// 阻止点击区块导致输入框失焦(对齐 Suggestions 组件做法)。
const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  e.stopPropagation();
};

const onLinkClick = (url: string) => (
  e: React.MouseEvent<HTMLAnchorElement>,
) => {
  // 必须 preventDefault:否则 Electron 渲染进程里 <a> 会顶层导航,
  // 绕过 store.navigate 且弹窗不关。
  e.preventDefault();
  e.stopPropagation();
  store.navigate(url);
  store.hide();
};

// 多链接助手:剪贴板是一段夹杂链接的文本时,替代原剪贴板置顶建议项。
// 高亮文本中的链接,点击在当前标签页打开并关闭弹窗。
export const MultiLink = observer(({ visible }: Props) => {
  const t = useI18n();
  const ml = store.multiLink;
  const ref = React.useRef<HTMLDivElement>(null);

  // paint 前同步测量真实高度回传,窗口高度贴合内容、无留白。
  // visible 关闭或组件卸载后复位为 0。
  React.useLayoutEffect(() => {
    if (!visible) {
      store.setMultiLinkHeight(0);
      return;
    }
    const el = ref.current;
    if (el) {
      store.setMultiLinkHeight(Math.round(el.getBoundingClientRect().height));
    }
  }, [visible, ml]);

  if (!visible || !ml) return null;

  return (
    <StyledMultiLink ref={ref} onMouseDown={onMouseDown}>
      <MultiLinkTag title={t('svMultiLinkTagTitle')}>
        <Clipboard size={12} weight="regular" color="#fff" />
        {t('svMultiLink')}
      </MultiLinkTag>
      <MultiLinkText>
        {ml.segments.map((seg, i) =>
          seg.isLink ? (
            <MultiLinkAnchor
              key={i}
              href={seg.url}
              onClick={onLinkClick(seg.url)}
              title={seg.url}
            >
              {seg.value}
            </MultiLinkAnchor>
          ) : (
            <React.Fragment key={i}>{seg.value}</React.Fragment>
          ),
        )}
      </MultiLinkText>
      <LinkCount>{t('svLinkCount', { count: ml.count })}</LinkCount>
    </StyledMultiLink>
  );
});
