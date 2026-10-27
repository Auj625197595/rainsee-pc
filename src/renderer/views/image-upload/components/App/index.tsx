import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import {
  ArrowsInSimple,
  Crop,
  GearSix,
  ImageIcon,
  Sparkle,
  UploadSimple,
  DownloadSimple,
  X,
} from '@phosphor-icons/react';

import store, { CropAspect } from '../../store';
import { UIStyle } from '~/renderer/mixins/default-styles';
import { useI18n } from '~/renderer/components/I18n';
import { ProcessMode, formatBytes } from '../../utils/process';
import { Cropper, fitAspect } from '../Cropper';
import * as S from './style';

const TARGET_PRESETS = [200, 500, 1024, 2048];
const ASPECTS: CropAspect[] = ['free', 'original', '1:1', '4:3', '3:4', '16:9'];

const aspectValue = (a: CropAspect, w: number, h: number) => {
  if (a === 'free') return 0;
  if (a === 'original') return w / h;
  const [x, y] = a.split(':').map(Number);
  return x / y;
};

const presetLabel = (kb: number) => (kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`);

export const App = observer(() => {
  const t = useI18n();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const item = store.item;
  const mode = store.mode;
  const standalone = store.standalone;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!store.visible) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        store.cancel();
      } else if (
        e.key === 'Enter' &&
        !(e.target instanceof HTMLInputElement && e.target.type === 'number')
      ) {
        e.preventDefault();
        store.submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allModes: {
    id: ProcessMode;
    icon: React.ReactNode;
    title: string;
    desc: string;
  }[] = [
    {
      id: 'original',
      icon: <UploadSimple size={16} weight="bold" />,
      title: t('iuModeOriginal'),
      desc: t('iuModeOriginalDesc'),
    },
    {
      id: 'lossless',
      icon: <Sparkle size={16} weight="fill" />,
      title: t('iuModeLossless'),
      desc: t('iuModeLosslessDesc'),
    },
    {
      id: 'target',
      icon: <ArrowsInSimple size={16} weight="bold" />,
      title: t('iuModeTarget'),
      desc: t('iuModeTargetDesc'),
    },
    {
      id: 'crop',
      icon: <Crop size={16} weight="bold" />,
      title: t('iuModeCrop'),
      desc: t('iuModeCropDesc'),
    },
  ];

  // 本地压缩没有"直接上传"选项。
  const modes = standalone ? allModes.filter((m) => m.id !== 'original') : allModes;

  const result = item?.result;
  const after = result ? result.blob.size : item?.blob.size ?? 0;
  const before = item?.blob.size ?? 0;
  const saved = before > 0 && mode !== 'original' ? 1 - after / before : 0;

  const onAspect = (a: CropAspect) => {
    store.setOption({ cropAspect: a });
    store.items.forEach((it, i) => {
      if (!it.width) return;
      store.setCrop(i, fitAspect(it.width, it.height, aspectValue(a, it.width, it.height)));
    });
  };

  const renderExtra = (id: ProcessMode) => {
    if (id === 'target' && mode === 'target') {
      return (
        <S.ModeExtra onClick={(e) => e.stopPropagation()}>
          <S.FieldRow>
            {t('iuTargetSize')}
            <S.NumberInput
              type="number"
              min={10}
              value={store.targetKB}
              onChange={(e) =>
                store.setOption({ targetKB: Math.max(10, Number(e.target.value) || 0) })
              }
            />
            KB
          </S.FieldRow>
          <S.Chips>
            {TARGET_PRESETS.map((kb) => (
              <S.Chip
                key={kb}
                active={store.targetKB === kb}
                onClick={() => store.setOption({ targetKB: kb })}
              >
                {presetLabel(kb)}
              </S.Chip>
            ))}
          </S.Chips>
          <S.FieldRow>
            {t('iuMaxEdge')}
            <S.NumberInput
              type="number"
              min={0}
              placeholder={t('iuNoLimit')}
              value={store.maxEdge || ''}
              onChange={(e) =>
                store.setOption({ maxEdge: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            px
          </S.FieldRow>
        </S.ModeExtra>
      );
    }
    if (id === 'crop' && mode === 'crop') {
      return (
        <S.ModeExtra onClick={(e) => e.stopPropagation()}>
          <S.Chips>
            {ASPECTS.map((a) => (
              <S.Chip
                key={a}
                active={store.cropAspect === a}
                onClick={() => onAspect(a)}
              >
                {a === 'free'
                  ? t('iuAspectFree')
                  : a === 'original'
                  ? t('iuAspectOriginal')
                  : a}
              </S.Chip>
            ))}
          </S.Chips>
          <S.CheckRow>
            <input
              type="checkbox"
              checked={store.cropCompress}
              onChange={(e) => store.setOption({ cropCompress: e.target.checked })}
            />
            {t('iuCropCompress', { size: presetLabel(store.targetKB) })}
          </S.CheckRow>
          {store.cropCompress && (
            <S.FieldRow>
              {t('iuTargetSize')}
              <S.NumberInput
                type="number"
                min={10}
                value={store.targetKB}
                onChange={(e) =>
                  store.setOption({ targetKB: Math.max(10, Number(e.target.value) || 0) })
                }
              />
              KB
            </S.FieldRow>
          )}
        </S.ModeExtra>
      );
    }
    return null;
  };

  const count = store.items.length;
  const totalAfter = store.totalAfter;

  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <UIStyle />
      <S.StyledApp ref={rootRef} style={{ display: store.visible ? 'flex' : 'none' }}>
        <S.Header>
          <S.HeaderIcon>
            <ImageIcon size={20} weight="fill" />
          </S.HeaderIcon>
          <S.HeaderText>
            <S.Title>{standalone ? t('iuCompressTitle') : t('iuTitle')}</S.Title>
            <S.Subtitle>
              {standalone
                ? store.items.length === 1
                  ? store.items[0].name
                  : t('iuCompressSubtitle', { count })
                : store.host
                ? t('iuSubtitle', { host: store.host, count })
                : t('iuSubtitleLocal', { count })}
            </S.Subtitle>
          </S.HeaderText>
          {!standalone && (
            <S.IconButton
              title={t('iuSettings')}
              aria-label={t('iuSettings')}
              onClick={() => store.openSettings()}
            >
              <GearSix size={18} weight="bold" />
            </S.IconButton>
          )}
          <S.IconButton
            title={t('iuCancel')}
            aria-label={t('iuCancel')}
            onClick={() => store.cancel()}
          >
            <X size={18} weight="bold" />
          </S.IconButton>
        </S.Header>

        <S.Body>
          <S.PreviewColumn>
            <S.Preview>
              {item &&
                (mode === 'crop' && item.crop && item.width ? (
                  <Cropper
                    src={item.url}
                    imgWidth={item.width}
                    imgHeight={item.height}
                    crop={item.crop}
                    aspect={aspectValue(store.cropAspect, item.width, item.height)}
                    onChange={(c) => store.setCrop(store.current, c)}
                  />
                ) : (
                  <img src={result?.url || item.url} alt={item.name} />
                ))}
              {store.processing && <S.Spinner />}
            </S.Preview>
            {item && (
              <S.Stats>
                <span>
                  {formatBytes(before)} · {item.width}×{item.height}
                </span>
                {mode !== 'original' && result && (
                  <>
                    <span>→</span>
                    <S.StatStrong tone={saved > 0.005 ? 'good' : undefined}>
                      {formatBytes(after)} · {result.width}×{result.height}
                    </S.StatStrong>
                    {!result.reached ? (
                      <S.Badge tone="warn">{t('iuNotReached')}</S.Badge>
                    ) : result.untouched ? (
                      <S.Badge>{t('iuAlreadyOptimal')}</S.Badge>
                    ) : saved > 0.005 ? (
                      <S.Badge>-{Math.round(saved * 100)}%</S.Badge>
                    ) : null}
                  </>
                )}
                {item.error && <S.Badge tone="warn">{t('iuDecodeFailed')}</S.Badge>}
              </S.Stats>
            )}
            {count > 1 && (
              <S.Thumbs>
                {store.items.map((it, i) => (
                  <S.Thumb
                    key={it.url}
                    active={i === store.current}
                    onClick={() => store.setCurrent(i)}
                    title={it.name}
                  >
                    <img src={it.result?.url || it.url} alt={it.name} />
                  </S.Thumb>
                ))}
              </S.Thumbs>
            )}
          </S.PreviewColumn>

          <S.Options role="radiogroup" aria-label={t('iuTitle')}>
            {modes.map((m) => (
              <S.ModeCard
                key={m.id}
                role={m.id === 'original' ? 'button' : 'radio'}
                aria-checked={m.id === 'original' ? undefined : mode === m.id}
                tabIndex={0}
                active={mode === m.id}
                onClick={(e) => {
                  // 「直接上传」不是一种处理状态,点击即上传原图。
                  if (m.id === 'original') {
                    store.uploadOriginal();
                    return;
                  }
                  if (mode === m.id) return;
                  store.setMode(m.id);
                  // 展开的附加选项可能落在可视区外,滚动到可见。
                  const card = e.currentTarget;
                  requestAnimationFrame(() =>
                    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ') {
                    e.preventDefault();
                    if (m.id === 'original') store.uploadOriginal();
                    else store.setMode(m.id);
                  }
                }}
              >
                <S.ModeHead>
                  <S.ModeIcon active={mode === m.id}>{m.icon}</S.ModeIcon>
                  <div>
                    <S.ModeTitle>{m.title}</S.ModeTitle>
                    <S.ModeDesc>{m.desc}</S.ModeDesc>
                  </div>
                </S.ModeHead>
                {renderExtra(m.id)}
              </S.ModeCard>
            ))}
          </S.Options>
        </S.Body>

        <S.Footer>
          {standalone ? (
            <S.FooterHint>{t('iuSaveHint')}</S.FooterHint>
          ) : (
            <>
              <S.CheckRow>
                <input
                  type="checkbox"
                  checked={store.rememberSite}
                  onChange={(e) => store.setRememberSite(e.target.checked)}
                />
                {t('iuRememberSite')}
              </S.CheckRow>
              <S.LinkButton onClick={() => store.disable()}>{t('iuDisable')}</S.LinkButton>
            </>
          )}
          <S.Spacer />
          <S.Button onClick={() => store.cancel()}>{t('iuCancel')}</S.Button>
          {!standalone && (
            <S.Button
              disabled={store.downloading || !count}
              title={t('iuDownloadTitle')}
              onClick={() => store.download()}
            >
              <DownloadSimple size={15} weight="bold" />
              {t('iuDownload')}
            </S.Button>
          )}
          <S.Button
            primary
            disabled={store.submitting || !count}
            onClick={() => store.submit()}
          >
            {standalone ? (
              <>
                <DownloadSimple size={15} weight="bold" />
                {t('iuSaveWithSize', { size: formatBytes(totalAfter) })}
              </>
            ) : (
              <>
                <UploadSimple size={15} weight="bold" />
                {mode === 'original'
                  ? t('iuUpload')
                  : t('iuUploadWithSize', { size: formatBytes(totalAfter) })}
              </>
            )}
          </S.Button>
        </S.Footer>
      </S.StyledApp>
    </ThemeProvider>
  );
});
