import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { UserCircle } from '@phosphor-icons/react';

import store from '../../store';
import { useI18n } from '~/renderer/components/I18n';
import { IFormFillMenuItem } from '~/interfaces';
import {
  StyledList,
  StyledItem,
  ItemIcon,
  ItemBody,
  Text,
  Details,
  PasswordMask,
  Host,
} from './styles';

const Item = observer(({ data }: { data: IFormFillMenuItem }) => {
  const t = useI18n();
  return (
    <StyledItem onClick={() => void store.fill(data)} title={data.host || ''}>
    <ItemIcon>
      <UserCircle size={18} weight="regular" />
    </ItemIcon>
    <ItemBody>
      <Text>
        {data.text || t('ffNoUsername')}
      </Text>
      <Details>
        <PasswordMask>{data.passwordMask || ''}</PasswordMask>
        {data.host && <Host>{data.host}</Host>}
      </Details>
    </ItemBody>
    </StyledItem>
  );
});

export default observer(() => (
  <StyledList>
    {store.items.map((item) => (
      <Item key={item._id} data={item} />
    ))}
  </StyledList>
));
