import App from './components/App';
import ImmersiveHeaderOverlay from './components/ImmersiveHeaderOverlay';
import { renderUI } from '~/utils/ui-entry';
import { isImmersiveHeaderWindow } from './utils/windows';

renderUI(isImmersiveHeaderWindow() ? ImmersiveHeaderOverlay : App);
