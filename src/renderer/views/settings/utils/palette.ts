import { ITheme } from '~/interfaces';

export interface IPalette {
  primary: string;
  primarySoft: string;
  bg: string;
  line: string;
  surface: string;
  hover: string;
  textMain: string;
  textSub: string;
  textMute: string;
  danger: string;
}

const lightPalette: IPalette = {
  primary: '#4A5AE9',
  primarySoft: '#EEF0FF',
  bg: '#F5F5FA',
  line: '#F0F1F6',
  surface: '#FFFFFF',
  hover: '#FBFCFE',
  textMain: '#1A1A24',
  textSub: '#8A8A93',
  textMute: '#B0B0BA',
  danger: '#F53F3F',
};

const darkPalette: IPalette = {
  primary: '#7583FF',
  primarySoft: 'rgba(117, 131, 255, 0.16)',
  bg: '#1C1C1E',
  line: 'rgba(255, 255, 255, 0.08)',
  surface: '#262629',
  hover: 'rgba(255, 255, 255, 0.035)',
  textMain: '#FFFFFF',
  textSub: 'rgba(255, 255, 255, 0.62)',
  textMute: 'rgba(255, 255, 255, 0.40)',
  danger: '#FF6C7A',
};

export const getPalette = (theme?: ITheme): IPalette =>
  theme && theme['pages.lightForeground'] ? darkPalette : lightPalette;
