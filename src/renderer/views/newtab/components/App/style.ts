import styled from 'styled-components';

export const Frame = styled.iframe`
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  border: none;
  margin: 0;
  padding: 0;
`;

// 无痕专用 newtab(本地页,不加载任何第三方 iframe)。深色基调对标 Chrome 无痕起始页。
export const IncognitoPage = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 24px;
  background-color: #202124;
  color: #e8eaed;
`;

export const IncognitoLogo = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;

  img {
    width: 44px;
    height: 44px;
    filter: invert(70%);
  }

  span {
    font-size: 24px;
    font-weight: 300;
    letter-spacing: 0;
  }
`;

export const IncognitoHint = styled.div`
  font-size: 13px;
  color: #9aa0a6;
  max-width: 520px;
  text-align: center;
  line-height: 1.7;
`;

export const IncognitoSearch = styled.form`
  display: flex;
  width: min(560px, 86vw);

  input {
    flex: 1;
    height: 46px;
    border: 1px solid #5f6368;
    border-radius: 24px;
    background-color: #303134;
    color: #e8eaed;
    padding: 0 22px;
    font-size: 16px;
    outline: none;
    transition: border-color 0.15s;

    &:focus {
      border-color: #8ab4f8;
      background-color: #28292c;
    }

    &::placeholder {
      color: #9aa0a6;
    }
  }
`;
