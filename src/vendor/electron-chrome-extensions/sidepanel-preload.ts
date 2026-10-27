// Keep a distinct preload file for extension side panels. Electron includes the
// preload path in renderer reuse decisions; sharing crx-preload with the
// service-worker registration co-sites the panel in the worker's renderer, so
// the panel dies (blank) whenever the worker idles out or crashes.
import './preload'
