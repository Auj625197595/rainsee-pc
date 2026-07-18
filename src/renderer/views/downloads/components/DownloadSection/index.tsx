import * as React from 'react';
import { observer } from 'mobx-react-lite';

import { DownloadRow } from '../DownloadRow';
import { IDownloadGroup } from '../../store';
import {
  Section,
  SectionHeader,
  SectionTitle,
  PulseDot,
  CountPill,
  ListCard,
} from './style';

export const DownloadSection = observer(
  ({ data }: { data: IDownloadGroup }) => {
    const isActive = data.key === 'active';

    return (
      <Section>
        <SectionHeader>
          <SectionTitle accent={isActive}>
            {isActive && <PulseDot />}
            {data.title}
          </SectionTitle>
          <CountPill>{data.items.length} 项</CountPill>
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
