import * as React from 'react';
import {observer} from 'mobx-react-lite';
import {ipcRenderer} from 'electron';
import type {MessageKey} from '~/common/i18n';

import store from '../../store';
import { getShellTranslator } from '../../utils/i18n';
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

// 阶段 → 文案 key。
const PHASE_LABEL: Record<string, MessageKey> = {
  history: 'pvItemHistory',
  searchHistory: 'wbSearchHistory',
  cache: 'pvItemCache',
  cookies: 'wbCookie',
  finalize: 'shellPhaseFinalize',
};

const ClearExitOverlay = observer(() => {
  const t = getShellTranslator();
  const {clearExitOverlay: o} = store;

  if (!o.visible) return null;

  const phaseLabel = PHASE_LABEL[o.phase] ? t(PHASE_LABEL[o.phase]) : '';
  const title = o.done ? t('shellCleanupDone') : t('shellCleaning');
  // 完成态不再显示「正在清理 XXX」副标题。
  const subtitle = o.done
    ? t('shellClosingSoon')
    : t('shellCleaningPhase', {phase: phaseLabel});

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
          <span>{o.done ? t('shellCleanupDone') : phaseLabel}</span>
          <span>{Math.max(0, Math.min(100, o.percent))}%</span>
        </MetaRow>

        {/* exit 模式下提供「立即退出」兜底:清理卡死时可强制退出(绕过清理)。 */}
        {o.mode === 'exit' && (
          <ForceQuitLink onClick={() => ipcRenderer.send('force-quit')}>
            {t('shellExitNow')}
          </ForceQuitLink>
        )}
      </Card>
    </Overlay>
  );
});

export default ClearExitOverlay;
