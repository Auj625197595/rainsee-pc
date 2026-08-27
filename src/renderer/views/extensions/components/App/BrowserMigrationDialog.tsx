import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  BrowsersIcon,
  CheckIcon,
  FolderOpenIcon,
  PuzzlePieceIcon,
  XIcon,
} from '@phosphor-icons/react';

import store from '../../store';
import {
  MigrationMask,
  MigrationDialog,
  MigrationHeader,
  MigrationTitle,
  MigrationClose,
  MigrationSources,
  MigrationSource,
  MigrationToolbar,
  MigrationSelectAll,
  MigrationCheckbox,
  MigrationChooseDirectory,
  MigrationBody,
  MigrationState,
  MigrationSpinner,
  MigrationList,
  MigrationRow,
  MigrationIcon,
  MigrationInfo,
  MigrationName,
  MigrationMeta,
  MigrationDescription,
  MigrationFooter,
  MigrationFooterStatus,
  MigrationActions,
  MigrationButton,
  MigrationResponsiveStyle,
} from './style';

export const BrowserMigrationDialog = observer(() => {
  const selected = new Set(store.migrationSelectedKeys);
  const allSelected =
    store.migrationItems.length > 0 &&
    store.migrationSelectedKeys.length === store.migrationItems.length;
  const partiallySelected =
    store.migrationSelectedKeys.length > 0 && !allSelected;

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') store.closeBrowserMigration();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <MigrationMask>
      <MigrationResponsiveStyle />
      <MigrationDialog
        role="dialog"
        aria-modal="true"
        aria-label="从本地浏览器迁移扩展"
      >
        <MigrationHeader>
          <BrowsersIcon size={22} weight="duotone" />
          <MigrationTitle>从本地浏览器迁移扩展</MigrationTitle>
          <MigrationClose
            type="button"
            title="关闭"
            aria-label="关闭"
            disabled={store.migrationImporting}
            onClick={() => store.closeBrowserMigration()}
          >
            <XIcon size={18} />
          </MigrationClose>
        </MigrationHeader>

        {store.migrationSources.length > 0 && (
          <MigrationSources>
            {store.migrationSources.map((source) => (
              <MigrationSource key={source.path} title={source.path}>
                {source.browserName} · {source.profileName}
              </MigrationSource>
            ))}
          </MigrationSources>
        )}

        <MigrationToolbar>
          <MigrationSelectAll
            role="checkbox"
            aria-checked={partiallySelected ? 'mixed' : allSelected}
            onClick={() => store.toggleAllBrowserMigrationItems()}
          >
            <MigrationCheckbox $checked={allSelected || partiallySelected}>
              {allSelected ? (
                <CheckIcon size={13} weight="bold" />
              ) : partiallySelected ? (
                <span />
              ) : null}
            </MigrationCheckbox>
            全选
          </MigrationSelectAll>
          <MigrationChooseDirectory
            type="button"
            disabled={store.migrationLoading || store.migrationImporting}
            onClick={() => store.scanBrowserImports(true)}
          >
            <FolderOpenIcon size={17} />
            选择其他目录
          </MigrationChooseDirectory>
        </MigrationToolbar>

        <MigrationBody>
          {store.migrationLoading ? (
            <MigrationState>
              <MigrationSpinner />
              <span>正在读取浏览器扩展…</span>
            </MigrationState>
          ) : store.migrationItems.length === 0 ? (
            <MigrationState $error={!!store.migrationError}>
              <PuzzlePieceIcon size={42} weight="duotone" />
              <span>{store.migrationError || '没有可导入的扩展'}</span>
            </MigrationState>
          ) : (
            <MigrationList>
              {store.migrationItems.map((item) => {
                const checked = selected.has(item.key);
                return (
                  <MigrationRow
                    key={item.key}
                    $checked={checked}
                    role="checkbox"
                    aria-checked={checked}
                    tabIndex={0}
                    onClick={() => store.toggleBrowserMigrationItem(item.key)}
                    onKeyDown={(event) => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        store.toggleBrowserMigrationItem(item.key);
                      }
                    }}
                  >
                    <MigrationCheckbox $checked={checked}>
                      {checked && <CheckIcon size={13} weight="bold" />}
                    </MigrationCheckbox>
                    <MigrationIcon>
                      {item.icon ? (
                        <img src={item.icon} alt="" />
                      ) : (
                        <PuzzlePieceIcon size={22} weight="duotone" />
                      )}
                    </MigrationIcon>
                    <MigrationInfo>
                      <MigrationName title={item.name}>
                        {item.name}
                      </MigrationName>
                      <MigrationMeta>
                        {item.browserName} · {item.profileName} · v
                        {item.version}
                      </MigrationMeta>
                      {item.description && (
                        <MigrationDescription title={item.description}>
                          {item.description}
                        </MigrationDescription>
                      )}
                    </MigrationInfo>
                  </MigrationRow>
                );
              })}
            </MigrationList>
          )}
        </MigrationBody>

        <MigrationFooter>
          <MigrationFooterStatus $error={!!store.migrationError}>
            {store.migrationError ||
              (store.migrationDuplicateCount > 0
                ? `已过滤 ${store.migrationDuplicateCount} 个重复扩展`
                : `已选择 ${store.migrationSelectedKeys.length} 个扩展`)}
          </MigrationFooterStatus>
          <MigrationActions>
            <MigrationButton
              type="button"
              disabled={store.migrationImporting}
              onClick={() => store.closeBrowserMigration()}
            >
              取消
            </MigrationButton>
            <MigrationButton
              type="button"
              $primary
              disabled={
                store.migrationLoading ||
                store.migrationImporting ||
                store.migrationSelectedKeys.length === 0
              }
              onClick={() => store.importSelectedBrowserExtensions()}
            >
              {store.migrationImporting
                ? '正在导入…'
                : `导入 (${store.migrationSelectedKeys.length})`}
            </MigrationButton>
          </MigrationActions>
        </MigrationFooter>
      </MigrationDialog>
    </MigrationMask>
  );
});
