import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { DownloadRow } from '../DownloadRow';
import { IDownloadGroup } from '../../store';
import store from '../../store';
import {
  Section,
  SectionHeader,
  SectionTitle,
  PulseDot,
  CountPill,
  ListCard,
} from './style';
import { useI18n } from '~/renderer/components/I18n';

export const DownloadSection = observer(
  ({ data }: { data: IDownloadGroup }) => {
    const t = useI18n();
    const isActive = data.key === 'active';

    return (
      <Section>
        <SectionHeader>
          <SectionTitle accent={isActive}>
            {isActive && <PulseDot />}
            {data.title}
          </SectionTitle>
          <CountPill>{t('dlvCountPill', { count: data.items.length })}</CountPill>
        </SectionHeader>
        <ListCard>
          {data.items.map((item) => (
            <DownloadRow key={item.id} data={item} />
          ))}
        </ListCard>
      </Section>
    );
  },
);
