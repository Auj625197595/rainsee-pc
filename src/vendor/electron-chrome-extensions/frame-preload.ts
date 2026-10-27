// Keep frame and service-worker preload identities distinct. Electron includes
// the preload path in renderer reuse decisions; sharing one path can co-site an
// extension page in a service-worker renderer, where frame startupData is null.
// Both entry points still execute the exact same Chrome API bridge.
import './preload'
