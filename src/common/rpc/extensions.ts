import { RendererToMainChannel } from './electron';

export interface ActionAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExtensionMainService {
  uninstall(id: string): Promise<boolean>;
  inspectBackgroundPage(id: string): void;
  /**
   * Fire a browser-action left-click for the extension. Opens the declared
   * popup (anchored under the toolbar icon via `anchorRect`) or fires
   * chrome.action.onClicked for a no-popup extension. `anchorRect` is the
   * icon's rect in the toolbar renderer's client coordinates; omit/zero to let
   * the popup fall back to default placement.
   */
  dispatchActionClick(id: string, tabId: number, anchorRect?: ActionAnchorRect): void;
}

export const extensionMainChannel = new RendererToMainChannel<ExtensionMainService>(
  'ExtensionMainService',
);
