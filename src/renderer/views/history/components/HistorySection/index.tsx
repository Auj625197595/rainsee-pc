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
import store from '../../store';
import { useI18n } from '~/renderer/components/I18n';

export const HistorySection = observer(
  ({ data }: { data: IHistorySection }) => {
    const t = useI18n();
    return (
      <Section>
        <DateHeader>
          <div>
            <DateTitle>{getSectionTitle(data.date, store.settings.language)}</DateTitle>
            <DateSub>{getSectionSubtitle(data.date, store.settings.language)}</DateSub>
          </div>
          <CountPill>{t('histCountPill', { count: data.items.length })}</CountPill>
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
