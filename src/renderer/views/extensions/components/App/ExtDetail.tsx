import * as React from 'react';
import { observer } from 'mobx-react-lite';

import store from '../../store';
import { IExtItem } from '~/interfaces';
import { Switch } from '~/renderer/components/Switch';
import { IconPuzzle } from './icons';
import {
  Detail,
  DetailPageHead,
  DetailBack,
  DetailPageTitle,
  DetailCard,
  DetailHero,
  DetailIcon,
  DetailIdentity,
  DetailName,
  DetailMeta,
  DetailSection,
  DetailSectionTitle,
  DetailText,
  DetailPermissionList,
  DetailSetting,
  DetailSettingBody,
  DetailSettingTitle,
  DetailSettingText,
  DetailValue,
  DetailAllowed,
  DetailActions,
  DetailButton,
  DetailLink,
  DetailInspectList,
  DetailInspectFeedback,
} from './card';

const permissionLabels: Record<string, string> = {
  activeTab: '在您点击此扩展时读取和更改当前网站上的数据',
  bookmarks: '读取和修改您的书签',
  clipboardRead: '读取您复制和粘贴的数据',
  clipboardWrite: '修改您复制和粘贴的数据',
  contentSettings: '更改用于控制网站功能访问权限的设置',
  contextMenus: '在右键菜单中添加项目',
  cookies: '读取和修改 Cookie 及网站数据',
  declarativeNetRequest: '拦截网站上的内容',
  downloads: '管理您的下载内容',
  geolocation: '获取您的位置信息',
  history: '读取和修改您的浏览历史记录',
  idle: '检测您何时停止使用设备',
  management: '管理您的应用、扩展程序和主题背景',
  nativeMessaging: '与协作的原生应用通信',
  notifications: '显示通知',
  privacy: '更改与隐私相关的设置',
  scripting: '在您访问的网站上运行脚本',
  storage: '在您的设备上存储数据',
  tabs: '读取您的浏览历史记录',
  topSites: '读取您最常访问的网站列表',
  unlimitedStorage: '存储无限量的客户端数据',
  userScripts: '允许用户脚本',
  webNavigation: '读取您的浏览活动',
  webRequest: '读取和更改您在网站上收发的数据',
};

const permissionLabel = (permission: string) =>
  permissionLabels[permission] || permission;

const hostPermissionLabel = (permission: string) => {
  if (permission === '<all_urls>' || permission === '*://*/*') {
    return '在所有网站上';
  }
  return permission;
};

const PermissionList = ({ items, host }: { items: string[]; host?: boolean }) =>
  items?.length ? (
    <DetailPermissionList>
      {items.map((permission) => (
        <li key={permission}>
          {host ? hostPermissionLabel(permission) : permissionLabel(permission)}
        </li>
      ))}
    </DetailPermissionList>
  ) : (
    <DetailText>此扩展不需要额外权限</DetailText>
  );

export const ExtDetail = observer(({ item }: { item: IExtItem }) => {
  const [iconError, setIconError] = React.useState(false);
  const showIcon = item.icon && !iconError;
  const allowsUserScripts = item.permissions.includes('userScripts');

  React.useEffect(() => setIconError(false), [item.id, item.icon]);

  React.useEffect(() => {
    if (!store.devMode || !item.enabled) return undefined;
    void store.loadInspectViews(item.id);
    const timer = window.setInterval(
      () => void store.loadInspectViews(item.id),
      2000,
    );
    return () => window.clearInterval(timer);
  }, [item.id, item.enabled, store.devMode]);

  return (
    <Detail>
      <DetailPageHead>
        <DetailBack
          type="button"
          aria-label="返回扩展列表"
          title="返回"
          onClick={() => store.select(null)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </DetailBack>
        <DetailPageTitle title={item.name}>
          已安装的扩展 / {item.name}
        </DetailPageTitle>
      </DetailPageHead>

      <DetailCard>
        <DetailHero>
          <DetailIcon>
            {showIcon ? (
              <img src={item.icon} alt="" onError={() => setIconError(true)} />
            ) : (
              <IconPuzzle />
            )}
          </DetailIcon>
          <DetailIdentity>
            <DetailName title={item.name}>{item.name}</DetailName>
            <DetailMeta>
              <span>版本 {item.version || '?'}</span>
              <span>Manifest V{item.manifestVersion}</span>
            </DetailMeta>
          </DetailIdentity>
          <Switch
            clickable
            value={item.enabled}
            onClick={() => store.setEnabled(item, !item.enabled)}
          />
        </DetailHero>

        <DetailSection>
          <DetailSectionTitle>描述</DetailSectionTitle>
          <DetailText>{item.description || '此扩展没有提供描述。'}</DetailText>
        </DetailSection>

        <DetailSection>
          <DetailSectionTitle>权限</DetailSectionTitle>
          <PermissionList items={item.permissions} />
        </DetailSection>

        {item.hostPermissions?.length > 0 && (
          <DetailSection>
            <DetailSectionTitle>网站访问权限</DetailSectionTitle>
            <DetailText>允许此扩展读取和更改您访问的网站上的数据：</DetailText>
            <PermissionList host items={item.hostPermissions} />
          </DetailSection>
        )}

        {item.optionalPermissions?.length > 0 && (
          <DetailSection>
            <DetailSectionTitle>可选权限</DetailSectionTitle>
            <PermissionList items={item.optionalPermissions} />
          </DetailSection>
        )}

        {allowsUserScripts && (
          <DetailSetting>
            <DetailSettingBody>
              <DetailSettingTitle>允许用户脚本</DetailSettingTitle>
            </DetailSettingBody>
            <DetailAllowed>已允许</DetailAllowed>
          </DetailSetting>
        )}

        <DetailSetting>
          <DetailSettingBody>
            <DetailSettingTitle>在无痕模式下启用</DetailSettingTitle>
            <DetailSettingText>
              允许此扩展读取和更改无痕窗口中的数据。雨见无法阻止扩展记录您的浏览活动。
            </DetailSettingText>
          </DetailSettingBody>
          <Switch
            clickable
            value={!!item.incognitoAllowed}
            onClick={() => store.setIncognitoAllowed(item, !item.incognitoAllowed)}
          />
        </DetailSetting>

        {item.optionsUrl && (
          <DetailSetting>
            <DetailSettingBody>
              <DetailSettingTitle>扩展选项</DetailSettingTitle>
              <DetailSettingText>打开此扩展提供的设置页面</DetailSettingText>
            </DetailSettingBody>
            <DetailButton
              type="button"
              disabled={!item.enabled}
              onClick={() => store.openOptions(item)}
            >
              打开
            </DetailButton>
          </DetailSetting>
        )}

        {item.homepageUrl && (
          <DetailSetting>
            <DetailSettingBody>
              <DetailSettingTitle>扩展程序主页</DetailSettingTitle>
              <DetailSettingText>
                <DetailLink
                  type="button"
                  onClick={() => store.installFromWeb(item.homepageUrl)}
                >
                  {item.homepageUrl}
                </DetailLink>
              </DetailSettingText>
            </DetailSettingBody>
          </DetailSetting>
        )}

        <DetailSetting>
          <DetailSettingBody>
            <DetailSettingTitle>ID</DetailSettingTitle>
          </DetailSettingBody>
          <DetailValue>{item.id}</DetailValue>
        </DetailSetting>

        {store.devMode && (
          <>
            <DetailSetting>
              <DetailSettingBody>
                <DetailSettingTitle>安装路径</DetailSettingTitle>
              </DetailSettingBody>
              <DetailValue>{item.path}</DetailValue>
            </DetailSetting>
            {item.enabled && store.inspectViews.length > 0 && (
              <DetailSetting>
                <DetailSettingBody>
                  <DetailSettingTitle>检查视图</DetailSettingTitle>
                  <DetailInspectList>
                    {store.inspectViews.map((view) => (
                      <DetailLink
                        key={view.id}
                        type="button"
                        title={view.url}
                        disabled={store.inspectingTargetId !== null}
                        onClick={() => store.inspect(item, view)}
                      >
                        {store.inspectingTargetId === view.id
                          ? `${view.label}…`
                          : view.label}
                      </DetailLink>
                    ))}
                  </DetailInspectList>
                  {store.inspectStatus && (
                    <DetailInspectFeedback error={store.inspectStatusError}>
                      {store.inspectStatus}
                    </DetailInspectFeedback>
                  )}
                </DetailSettingBody>
              </DetailSetting>
            )}
          </>
        )}

        <DetailActions>
          {store.devMode && (
            <DetailButton type="button" onClick={() => store.reload(item)}>
              重新加载
            </DetailButton>
          )}
          <DetailButton
            type="button"
            danger
            onClick={() => store.uninstall(item)}
          >
            删除扩展程序
          </DetailButton>
        </DetailActions>
      </DetailCard>
    </Detail>
  );
});
