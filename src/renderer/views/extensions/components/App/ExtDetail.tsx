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
import { useI18n } from '~/renderer/components/I18n';

const permissionLabels: Record<string, string> = {
  activeTab:  'permActiveTab',
  bookmarks:  'permBookmarks',
  clipboardRead:  'permClipboardRead',
  clipboardWrite:  'permClipboardWrite',
  contentSettings:  'permContentSettings',
  contextMenus:  'permContextMenus',
  cookies:  'permCookies',
  declarativeNetRequest:  'permDnr',
  downloads:  'permDownloads',
  geolocation:  'xpermGeolocation',
  history:  'permHistory',
  idle:  'permIdle',
  management:  'permManagement',
  nativeMessaging:  'permNativeMessaging',
  notifications:  'xpermNotifications',
  privacy:  'permPrivacy',
  scripting:  'permScripting',
  storage:  'permStorage',
  tabs:  'permTabs',
  topSites:  'permTopSites',
  unlimitedStorage:  'permUnlimitedStorage',
  userScripts:  'permUserScripts',
  webNavigation:  'permWebNavigation',
  webRequest:  'permWebRequest',
};

const permissionLabel = (
  permission: string,
  t: (key: string) => string,
) => {
  const key = permissionLabels[permission];
  return key ? t(key) : permission;
};

const hostPermissionLabel = (
  permission: string,
  t: (key: string) => string,
) => {
  if (permission === '<all_urls>' || permission === '*://*/*') {
    return t('extAllSites');
  }
  return permission;
};

const PermissionList = ({
  items,
  host,
  t,
}: {
  items: string[];
  host?: boolean;
  t: (key: string, params?: any) => string;
}) =>
  items?.length ? (
    <DetailPermissionList>
      {items.map((permission) => (
        <li key={permission}>
          {host
            ? hostPermissionLabel(permission, t)
            : permissionLabel(permission, t)}
        </li>
      ))}
    </DetailPermissionList>
  ) : (
    <DetailText>{t('extNoPermsNeeded')}</DetailText>
  );

export const ExtDetail = observer(({ item }: { item: IExtItem }) => {
  const t = useI18n();
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
          aria-label={t('extBackToListAria')}
          title={t('extBack')}
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
          {t('extInstalledOf', { name: item.name })}
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
              <span>{t('extVersion', { version: item.version || '?' })}</span>
              <span>
                {item.type === 'theme'
                  ? t('extChromeTheme')
                  : `Manifest V${item.manifestVersion}`}
              </span>
            </DetailMeta>
          </DetailIdentity>
          <Switch
            clickable
            value={item.enabled}
            onClick={() => store.setEnabled(item, !item.enabled)}
          />
        </DetailHero>

        <DetailSection>
          <DetailSectionTitle>{t('extDescSection')}</DetailSectionTitle>
          <DetailText>
            {item.description || t('extNoDescProvided')}
          </DetailText>
        </DetailSection>

        {item.type !== 'theme' && (
          <DetailSection>
            <DetailSectionTitle>{t('extPermsSection')}</DetailSectionTitle>
            <PermissionList items={item.permissions} t={t} />
          </DetailSection>
        )}

        {item.hostPermissions?.length > 0 && (
          <DetailSection>
            <DetailSectionTitle>{t('extSiteAccessSection')}</DetailSectionTitle>
            <DetailText>{t('extSiteAccessIntro')}</DetailText>
            <PermissionList host items={item.hostPermissions} t={t} />
          </DetailSection>
        )}

        {item.optionalPermissions?.length > 0 && (
          <DetailSection>
            <DetailSectionTitle>{t('extOptionalPermsSection')}</DetailSectionTitle>
            <PermissionList items={item.optionalPermissions} t={t} />
          </DetailSection>
        )}

        {allowsUserScripts && (
          <DetailSetting>
            <DetailSettingBody>
              <DetailSettingTitle>{t('extUserScriptsTitle')}</DetailSettingTitle>
            </DetailSettingBody>
            <DetailAllowed>{t('extAllowed')}</DetailAllowed>
          </DetailSetting>
        )}

        {item.type !== 'theme' && <DetailSetting>
          <DetailSettingBody>
            <DetailSettingTitle>{t('extIncognitoTitle')}</DetailSettingTitle>
            <DetailSettingText>
              {t('extIncognitoDesc')}
            </DetailSettingText>
          </DetailSettingBody>
          <Switch
            clickable
            value={!!item.incognitoAllowed}
            onClick={() => store.setIncognitoAllowed(item, !item.incognitoAllowed)}
          />
        </DetailSetting>}

        {item.optionsUrl && (
          <DetailSetting>
            <DetailSettingBody>
              <DetailSettingTitle>{t('extOptionsTitle')}</DetailSettingTitle>
              <DetailSettingText>{t('extOptionsDesc')}</DetailSettingText>
            </DetailSettingBody>
            <DetailButton
              type="button"
              disabled={!item.enabled}
              onClick={() => store.openOptions(item)}
            >
              {t('extOpen')}
            </DetailButton>
          </DetailSetting>
        )}

        {item.homepageUrl && (
          <DetailSetting>
            <DetailSettingBody>
              <DetailSettingTitle>{t('extHomePageTitle')}</DetailSettingTitle>
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
                <DetailSettingTitle>{t('extInstallPathTitle')}</DetailSettingTitle>
              </DetailSettingBody>
              <DetailValue>{item.path}</DetailValue>
            </DetailSetting>
            {item.enabled && store.inspectViews.length > 0 && (
              <DetailSetting>
                <DetailSettingBody>
                  <DetailSettingTitle>{t('extInspectViewsTitle')}</DetailSettingTitle>
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
              {t('extReload')}
            </DetailButton>
          )}
          <DetailButton
            type="button"
            danger
            onClick={() => store.uninstall(item)}
          >
            {t('extDelete')}
          </DetailButton>
        </DetailActions>
      </DetailCard>
    </Detail>
  );
});
