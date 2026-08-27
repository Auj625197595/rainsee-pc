import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {ipcRenderer} from 'electron';

import store from '../../store';
import {
  Overlay,
  Card,
  TitleRow,
  Spinner,
  Title,
  Subtitle,
  ProgressWrap,
  ProgressBar,
  MetaRow,
  ForceQuitLink,
} from './style';

// 阶段 → 中文文案。
const PHASE_LABEL: Record<string, string> = {
  history: '历史记录',
  searchHistory: '搜索历史',
  cache: '网页缓存',
  cookies: 'Cookie',
  finalize: '完成',
};

const ClearExitOverlay = observer(() => {
  const {clearExitOverlay: o} = store;

  if (!o.visible) return null;

  const phaseLabel = PHASE_LABEL[o.phase] || '';
  const title = o.done ? '清理完成' : '正在清理…';
  // 完成态不再显示「正在清理 XXX」副标题。
  const subtitle = o.done ? '即将关闭窗口。' : `正在清理${phaseLabel}`;

  return (
    <Overlay>
      <Card>
        <TitleRow>
          <Spinner done={o.done} />
          <Title>{title}</Title>
        </TitleRow>
        <Subtitle>{subtitle}</Subtitle>

        <ProgressWrap>
          <ProgressBar percent={o.percent} done={o.done} />
        </ProgressWrap>
        <MetaRow>
          <span>{o.done ? '清理完成' : phaseLabel}</span>
          <span>{Math.max(0, Math.min(100, o.percent))}%</span>
        </MetaRow>

        {/* exit 模式下提供「立即退出」兜底:清理卡死时可强制退出(绕过清理)。 */}
        {o.mode === 'exit' && (
          <ForceQuitLink onClick={() => ipcRenderer.send('force-quit')}>
            立即退出
          </ForceQuitLink>
        )}
      </Card>
    </Overlay>
  );
});

export default ClearExitOverlay;
