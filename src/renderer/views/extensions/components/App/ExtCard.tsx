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

export const ExtCard = observer(({ item }: { item: IExtItem }) => {
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
              {item.type === 'theme' ? '主题' : `MV${item.manifestVersion}`}
            </Badge>
            {!item.enabled && <span>已停用</span>}
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
        <ExtDesc>自定义浏览器框架与新标签页外观</ExtDesc>
      ) : (
        <ExtDesc style={{ opacity: 0.5 }}>暂无描述</ExtDesc>
      )}

      {store.devMode && <ExtId>ID: {item.id}</ExtId>}

      <CardFoot>
        <TextButton onClick={() => store.select(item.id)}>
          {store.selectedId === item.id ? '收起详情' : '详情'}
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
          卸载
        </TextButton>
      </CardFoot>
    </Card>
  );
});
