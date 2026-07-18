import * as React from 'react';

import HistoryItem from '../HistoryItem';
import { IHistorySection } from '~/interfaces';
import {
  Section,
  DateHeader,
  DateTitle,
  DateSub,
  CountPill,
  ListCard,
} from './style';
import { getSectionTitle, getSectionSubtitle } from '../../utils';
import { observer } from 'mobx-react-lite';

export const HistorySection = observer(
  ({ data }: { data: IHistorySection }) => {
    return (
      <Section>
        <DateHeader>
          <div>
            <DateTitle>{getSectionTitle(data.date)}</DateTitle>
            <DateSub>{getSectionSubtitle(data.date)}</DateSub>
          </div>
          <CountPill>{data.items.length} 条记录</CountPill>
        </DateHeader>
        <ListCard>
          {data.items.map((item) => (
            <HistoryItem key={item._id} data={item} />
          ))}
        </ListCard>
      </Section>
    );
  },
);
