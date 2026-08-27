import styled, { css } from 'styled-components';

export const StyledSuggestions = styled.div`
  width: 100%;
  max-height: 380px;
  overflow-y: auto;
  overflow-x: hidden;
  ${({ visible }: { visible: boolean }) => css`
    display: ${visible ? 'block' : 'none'};
  `};
`;
