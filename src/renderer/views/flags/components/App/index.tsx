import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { ThemeProvider } from 'styled-components';
import { MagnifyingGlass as SearchIcon } from '@phosphor-icons/react';

import store, { IFlagItem, FlagSelection } from '../../store';
import { WebUIStyle } from '~/renderer/mixins/default-styles';
import {
  Topbar,
  SearchWrap,
  SearchInput,
  ResetButton,
  Content,
  Hero,
  HeroTitle,
  VersionText,
  WarningText,
  WarningLead,
  RestartBanner,
  Tabs,
  TabButton,
  List,
  FlagCard,
  FlagBody,
  FlagTitle,
  FlagDesc,
  FlagLink,
  SelectWrap,
  Select,
  EmptyState,
  HighlightTitle,
} from './style';

const selectionLabel = (value: FlagSelection) => {
  if (value === 'enabled') return 'Enabled';
  if (value === 'disabled') return 'Disabled';
  return 'Default';
};

const FlagRow = observer(({ item }: { item: IFlagItem }) => {
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const highlighted = store.highlightedKey === item.key;

  React.useEffect(() => {
    if (highlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'center' });
    }
  }, [highlighted]);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    store.setFlag(item.key, e.currentTarget.value as FlagSelection);
  };

  return (
    <FlagCard ref={rowRef} id={item.key}>
      <FlagBody>
        <FlagTitle>
          {highlighted ? (
            <HighlightTitle>{item.title}</HighlightTitle>
          ) : (
            item.title
          )}
        </FlagTitle>
        <FlagDesc>
          {item.description}
        </FlagDesc>
        <FlagLink href={item.permalink}>{item.permalink}</FlagLink>
      </FlagBody>
      <SelectWrap>
        <Select value={item.selected} onChange={onChange}>
          <option value="default">
            {selectionLabel(item.defaultSelection)}
          </option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </Select>
      </SelectWrap>
    </FlagCard>
  );
});

export default observer(() => {
  return (
    <ThemeProvider theme={{ ...store.theme }}>
      <>
        <WebUIStyle />
        <Topbar>
          <SearchWrap>
            <SearchIcon size={24} weight="regular" />
            <SearchInput
              placeholder="Search flags"
              value={store.search}
              onChange={(e) => store.setSearch(e.currentTarget.value)}
            />
          </SearchWrap>
          <ResetButton onClick={() => store.resetAll()}>Reset all</ResetButton>
        </Topbar>

        <Content>
          <Hero>
            <HeroTitle>Experiments</HeroTitle>
            <VersionText>
              {store.chromiumVersion || 'Unknown Chromium'}
            </VersionText>
          </Hero>

          <WarningText>
            <WarningLead>WARNING: EXPERIMENTAL FEATURES AHEAD!</WarningLead>{' '}
            By enabling these features, you could lose browser data or
            compromise your security or privacy. Enabled features apply to all
            users of this browser.
          </WarningText>

          {store.needsRestart && (
            <RestartBanner>
              Your changes are saved and will take effect after the app is
              restarted. Command-line flags are appended during the next launch.
            </RestartBanner>
          )}

          <Tabs>
            <TabButton
              selected={store.selectedTab === 'available'}
              onClick={() => store.setTab('available')}
            >
              Available
            </TabButton>
            <TabButton
              selected={store.selectedTab === 'unavailable'}
              onClick={() => store.setTab('unavailable')}
            >
              Unavailable
            </TabButton>
          </Tabs>

          <List>
            {store.visibleItems.length === 0 ? (
              <EmptyState>
                {store.loading ? 'Loading flags…' : 'No flags match your search.'}
              </EmptyState>
            ) : (
              store.visibleItems.map((item) => (
                <FlagRow item={item} key={item.key} />
              ))
            )}
          </List>
        </Content>
      </>
    </ThemeProvider>
  );
});
