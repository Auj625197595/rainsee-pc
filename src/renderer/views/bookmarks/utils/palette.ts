import { ITheme } from '~/interfaces';

export interface IPalette {
  primary: string;
  primarySoft: string;
  bg: string;
  line: string;
  surface: string;
  textMain: string;
  textSub: string;
  textMute: string;
  danger: string;
}

const lightPalette: IPalette = {
  primary: '#3452FF',
  primarySoft: '#EEF2FF',
  bg: '#F5F7FD',
  line: '#E8ECF7',
  surface: '#FFFFFF',
  textMain: '#161B2D',
  textSub: '#75809A',
  textMute: '#A8B2C7',
  danger: '#FF6C7A',
};

const darkPalette: IPalette = {
  primary: '#5B72FF',
  primarySoft: 'rgba(91, 114, 255, 0.16)',
  bg: '#1c1c1e',
  line: 'rgba(255, 255, 255, 0.08)',
  surface: '#262629',
  textMain: '#ffffff',
  textSub: 'rgba(255, 255, 255, 0.62)',
  textMute: 'rgba(255, 255, 255, 0.40)',
  danger: '#FF6C7A',
};

export const getPalette = (theme: ITheme): IPalette =>
  theme && theme['pages.lightForeground'] ? darkPalette : lightPalette;
