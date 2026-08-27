import * as React from 'react';

import { IFormFillData } from '~/interfaces';
import store from '../../../store';
import {
  StyledSection,
  Header,
  Icon,
  Label,
  DropIcon,
  Container,
} from './styles';

interface Props {
  label: string;
  icon: any;
  children?: any;
  style?: any;
  defaultExpanded?: boolean;
}

export const onMoreClick =
  (data: IFormFillData) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();

    const { left, top } = e.currentTarget.getBoundingClientRect();

    store.autoFill.selectedItem = data;
    store.autoFill.menuTop = top;
    store.autoFill.menuLeft = left;
    store.autoFill.menuVisible = true;
  };

export const Section = (props: Props) => {
  const { label, icon, children, style, defaultExpanded = false } = props;
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  const onClick = () => {
    setExpanded(!expanded);
  };

  return (
    <StyledSection>
      <Header onClick={onClick}>
        <Icon icon={icon} />
        <Label>{label}</Label>
        <DropIcon expanded={expanded} />
      </Header>
      <Container expanded={expanded} style={style}>
        {children}
      </Container>
    </StyledSection>
  );
};
