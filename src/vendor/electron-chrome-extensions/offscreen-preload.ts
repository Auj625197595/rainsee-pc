// Keep a distinct preload file for offscreen documents. Electron includes the
// preload identity in renderer reuse decisions; using a separate bundle keeps
// an offscreen renderer from being co-sited with an action popup while still
// sharing the exact same Chrome API bridge implementation.
import './preload'
