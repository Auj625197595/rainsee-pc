export type ChromeThemeTint = [number, number, number];

// Chrome theme manifests are normalized in the main process before they are
// persisted or sent to renderers. Colors are CSS rgb/rgba strings and image
// values are restricted yjllq://theme-assets URLs.
export interface IChromeTheme {
  id: string;
  name: string;
  colors: { [key: string]: string };
  images: { [key: string]: string };
  tints: { [key: string]: ChromeThemeTint };
  properties: { [key: string]: string | number | boolean };
}
