// Extension tabs need the ordinary tab bridge as well as chrome.* APIs.
//
// The CRX preload is also registered on the session as a frame preload, but
// Electron 43 can drop registered frame preloads when an extension document
// is placed in the same renderer process as an extension background context
// (`binding.startupData === null`). Loading the same idempotent CRX bridge as
// the tab's classic webPreferences.preload keeps every chrome-extension://
// document functional even when that Electron delivery path is unavailable.
import '../vendor/electron-chrome-extensions/preload';
import './view-preload';
