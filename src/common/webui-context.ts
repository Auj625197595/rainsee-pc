import type {ISettings} from '~/interfaces';
import type {WebUIContext} from './webui-bridge-policy';

export type WebUIContextSnapshot = Omit<WebUIContext, 'settings'> & {
  settings: Partial<ISettings>;
};

const EMPTY_CONTEXT: WebUIContextSnapshot = Object.freeze({
  settings: {},
  windowId: -1,
});

/** Read the preload bootstrap snapshot without relying on ad-hoc window globals. */
export const getWebUIContext = (): WebUIContextSnapshot => {
  const bridge = (globalThis as any).rainseeWebUI;
  if (!bridge || typeof bridge.getContext !== 'function') return EMPTY_CONTEXT;
  try {
    return (bridge.getContext() || EMPTY_CONTEXT) as WebUIContextSnapshot;
  } catch {
    return EMPTY_CONTEXT;
  }
};

