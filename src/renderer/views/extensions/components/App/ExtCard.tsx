import * as React from 'react';
import { observer } from 'mobx-react-lite';

import store from '../../store';
import { IExtItem } from '~/interfaces';
import { Switch } from '~/renderer/components/Switch';
import { IconPuzzle, IconBug, IconRefresh } from './icons';
import {
  Card,
  CardHead,
  ExtIcon,
  CardTitle,
  ExtName,
  ExtMeta,
  Badge,
  ExtDesc,
  ExtId,
  CardFoot,
  Spacer,
  TextButton,
} from './card';
import { useI18n } from '~/renderer/components/I18n';

export const ExtCard = observer(({ item }: { item: IExtItem }) => {
  const t = useI18n();
  const [iconError, setIconError] = React.useState(false);
  const showIcon = item.icon && !iconError;

  return (
    <Card dimmed={!item.enabled}>
      <CardHead>
        <ExtIcon>
          {showIcon ? (
            <img src={item.icon} onError={() => setIconError(true)} />
          ) : (
            <IconPuzzle />
          )}
        </ExtIcon>
        <CardTitle>
          <ExtName title={item.name}>{item.name}</ExtName>
          <ExtMeta>
            <span>v{item.version || '?'}</span>
            <Badge>
              {item.type === 'theme'
                ? t('extTheme')
                : `MV${item.manifestVersion}`}
            </Badge>
            {!item.enabled && <span>{t('extDisabled')}</span>}
          </ExtMeta>
        </CardTitle>
        <Switch
          value={item.enabled}
          onClick={() => store.setEnabled(item, !item.enabled)}
        />
      </CardHead>

      {item.description ? (
        <ExtDesc>{item.description}</ExtDesc>
      ) : item.type === 'theme' ? (
        <ExtDesc>{t('extCardDescCustom')}</ExtDesc>
      ) : (
        <ExtDesc style={{ opacity: 0.5 }}>{t('extNoDesc')}</ExtDesc>
      )}

      {store.devMode && <ExtId>ID: {item.id}</ExtId>}

      <CardFoot>
        <TextButton onClick={() => store.select(item.id)}>
          {store.selectedId === item.id ? t('extHideDetails') : t('extDetails')}
        </TextButton>
        {store.devMode && (
          <>
            <TextButton onClick={() => store.reload(item)}>
              <IconRefresh />
            </TextButton>
            {item.hasBackground && item.enabled && (
              <TextButton onClick={() => store.inspect(item)}>
                <IconBug />
              </TextButton>
            )}
          </>
        )}
        <Spacer />
        <TextButton danger onClick={() => store.uninstall(item)}>
          {t('extUninstall')}
        </TextButton>
      </CardFoot>
    </Card>
  );
});
