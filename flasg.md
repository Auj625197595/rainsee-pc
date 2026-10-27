Available

Temporarily unexpire M147 flags.
Temporarily unexpire flags that expired as of M147. These flags will be removed soon. – Mac, Windows, Linux, ChromeOS, Android

#temporary-unexpire-flags-m147

Default
Temporarily unexpire M148 flags.
Temporarily unexpire flags that expired as of M148. These flags will be removed soon. – Mac, Windows, Linux, ChromeOS, Android

#temporary-unexpire-flags-m148

Default
Enable benchmarking
Sets all features to a fixed state; that is, disables randomization for feature states. If '(Default Feature States)' is selected, sets all features to their default state. If '(Match Field Trial Testing Config)' is selected, sets all features to the state configured in the field trial testing config. This is used by developers and testers to diagnose whether an observed problem is caused by a non-default base::Feature configuration. This flag is automatically reset after 3 restarts and will be off from the 4th restart. On the 3rd restart, the flag will appear to be off but the effect is still active. – Mac, Windows, Linux, ChromeOS, Android

#enable-benchmarking

Disabled
Override software rendering list
Overrides the built-in software rendering list and enables GPU-acceleration on unsupported system configurations. – Mac, Windows, Linux, ChromeOS, Android

#ignore-gpu-blocklist

Disabled
Accelerated 2D canvas
Enables the use of the GPU to perform 2d canvas rendering instead of using software rendering. – Mac, Windows, Linux, ChromeOS, Android

#disable-accelerated-2d-canvas

Enabled
Select HW overlay strategies
Select strategies used to promote quads to HW overlays. Note that strategies other than Default may break playback of protected content. – Mac, Windows, Linux, ChromeOS, Android

#overlay-strategies

Default
Tint composited content
Tint contents composited using Viz with a shade of red to help debug and study overlay support. – Mac, Windows, Linux, ChromeOS, Android

#tint-composited-content

Disabled
Show overdraw feedback
Visualize overdraw by color-coding elements based on if they have other elements drawn underneath. – Mac, Windows, Linux, ChromeOS, Android

#show-overdraw-feedback

Disabled
Partial swap
Sets partial swap behavior. – Mac, Windows, Linux, ChromeOS, Android

#ui-disable-partial-swap

Enabled
WebRTC PQC for DTLS
Support in WebRTC to enable PQC for DTLS – Mac, Windows, Linux, ChromeOS, Android

#webrtc-pqc-for-dtls

Default
Allow WebRTC to adjust the input volume.
Allow the Audio Processing Module in WebRTC to adjust the input volume during a real-time call. Disable if microphone muting or clipping issues are observed when the browser is running and used for a real-time call. This flag is experimental and may be removed at any time. – Mac, Windows, Linux

#enable-webrtc-allow-input-volume-adjustment

Default
WebRTC downmix capture audio method.
Override the method that the Audio Processing Module in WebRTC uses to downmix the captured audio to mono (when needed) during a real-time call. This flag is experimental and may be removed at any time. – Mac, Windows, Linux, ChromeOS

#enable-webrtc-apm-downmix-capture-audio-method

Default
Anonymize local IPs exposed by WebRTC.
Conceal local IP addresses with mDNS hostnames. – Mac, Windows, Linux, ChromeOS

#enable-webrtc-hide-local-ips-with-mdns

Default
Web HID in WebView
Enable WebViews to access Web HID upon embedder's permission. – Mac, Windows, Linux, ChromeOS, Android

#web-hid-in-web-view

Default
Extensions on chrome:// URLs
Enables running extensions on chrome:// URLs, where extensions explicitly request this permission. – Mac, Windows, Linux, ChromeOS, Android

#extensions-on-chrome-urls

Disabled
Extensions on chrome-extension:// URLs
Enables running extensions on chrome-extension:// URLs, where extensions explicitly request this permission. – Mac, Windows, Linux, ChromeOS, Android

#extensions-on-extension-urls

Disabled
Extension Telemetry Enterprise Short Reporting Interval
When enabled, reduces the extension telemetry service's enterprise telemetry reporting interval to 30 seconds. – Mac, Windows, Linux, ChromeOS

#extension-telemetry-enterprise-short-reporting-interval

Default
Optimize WebRequest proxying
Enables optimization for WebRequest proxying by skipping unnecessary proxy evaluations when possible. – Mac, Windows, Linux, ChromeOS

#optimize-web-request-proxy

Default
Enable SecurityInfo in WebRequest API
Enables SecurityInfo in WebRequest API for extensions, allowing listeners to retrieve certificate details of web requests. – Mac, Windows, Linux, ChromeOS

#web-request-security-info

Default
Show Autofill predictions
Annotates web forms with Autofill field type predictions as placeholder text. – Mac, Windows, Linux, ChromeOS, Android

#show-autofill-type-predictions

Default
Smooth Scrolling
Animate smoothly when scrolling page content. – Windows, Linux, ChromeOS, Android

#smooth-scrolling

Default
Overlay Scrollbars
Adjust scrollbar style to overlay web content and fade out. – Windows, Linux, ChromeOS

#overlay-scrollbars

Default
Flash Overlay Scrollbars When Mouse Enter
Flash Overlay Scrollbars When Mouse Enter a scrollable area. You must also enable Overlay Scrollbars. – Windows, Linux, ChromeOS

#overlay-scrollbars-flash-when-mouse-enter

Default
Flash Overlay Scrollbars Once When Visible
Flash Overlay Scrollbars only once per scrollbar and when they become visible on the viewport. You must also enable Overlay Scrollbars. – Windows, Linux, ChromeOS

#overlay-scrollbars-flash-once-visible-on-viewport

Default
Enable JXL image format
Adds image/jxl to the Accept header and enables decoding of JPEG XL (JXL) images. – Mac, Windows, Linux, ChromeOS, Android

#enable-jxl-image-format

Default
Rust-based BMP image handling
When enabled, uses Rust `image` crate to decode BMP images. – Mac, Windows, Linux, ChromeOS, Android

#enable-rusty-bmp

Default
Enable split view link opening shortcut
When enabled, adds a Ctrl+Alt+Click (Cmd+Alt+Click on macOS) shortcut to open a link in split view alongside the current tab. – Mac, Windows, Linux, ChromeOS

#split-view-link-open

Default
Soft Navigation Heuristics
Enables the soft navigation heuristics, including support for PerformanceObserver. See the documentation at https://developer.chrome.com/docs/web-platform/soft-navigations-experiment. – Mac, Windows, Linux, ChromeOS, Android

#soft-navigation-heuristics

Default
Blocking Focus Without User Activation
When enabled, the focus-without-user-activation permissions policy can be used by embedders to block programmatic focus calls (element.focus(), window.focus(), autofocus) from iframes unless triggered by a user gesture. – Mac, Windows, Linux, ChromeOS, Android

#blocking-focus-without-user-activation

Default
Experimental QUIC protocol
Enable experimental QUIC protocol support. – Mac, Windows, Linux, ChromeOS, Android

#enable-quic

Default
WebTransport Developer Mode
When enabled, removes the requirement that all certificates used for WebTransport over HTTP/3 are issued by a known certificate root. – Mac, Windows, Linux, ChromeOS, Android

#webtransport-developer-mode

Disabled
Structured DNS Errors
When enabled, signals support for Structured DNS Errors when sending DNS requests, renders Extended DNS Error codes on the net error page when applicable, and interprets filtering details provided via draft-nottingham-public-resolver-errors-02 – Mac, Windows, Linux, ChromeOS, Android

#structured-dns-errors

Default
Latest stable JavaScript features
Some web pages use legacy or non-standard JavaScript extensions that may conflict with the latest JavaScript features. This flag allows disabling support of those features for compatibility with such pages. – Mac, Windows, Linux, ChromeOS, Android

#disable-javascript-harmony-shipping

Enabled
Experimental JavaScript
Enable web pages to use experimental JavaScript features. – Mac, Windows, Linux, ChromeOS, Android

#enable-javascript-harmony

Disabled
Experimental WebAssembly
Enable web pages to use experimental WebAssembly features. – Mac, Windows, Linux, ChromeOS, Android

#enable-experimental-webassembly-features

Disabled
Experimental WebAssembly Shared-Everything Threads
Enable web pages to use the experimental WebAssembly Shared-Everything Threads feature. Note that this only covers a subset of the proposal. – Mac, Windows, Linux, ChromeOS, Android

#enable-experimental-webassembly-shared-everything

Default
WebAssembly stack switching
Enables WasmFX. – Mac, Windows, Linux, ChromeOS, Android

#enable-experimental-webassembly-stack-switching

Default
WebAssembly baseline compiler
Enables WebAssembly baseline compilation and tier up. – Mac, Windows, Linux, ChromeOS, Android

#enable-webassembly-baseline

Default
WebAssembly lazy compilation
Enables lazy (JIT on first call) compilation of WebAssembly modules. – Mac, Windows, Linux, ChromeOS, Android

#enable-webassembly-lazy-compilation

Default
WebAssembly tiering
Enables tiered compilation of WebAssembly (will tier up to TurboFan if #enable-webassembly-baseline is enabled). – Mac, Windows, Linux, ChromeOS, Android

#enable-webassembly-tiering

Default
Future V8 VM features
This enables upcoming and experimental V8 VM features. This flag does not enable experimental JavaScript features. – Mac, Windows, Linux, ChromeOS, Android

#enable-future-v8-vm-features

Default
GPU rasterization
Use GPU to rasterize web content. – Mac, Windows, Linux, ChromeOS, Android

#enable-gpu-rasterization

Default
Fallback to software if GLES3 is not supported
Controls whether the GPU process falls back to software if GLES3 is not supported. – Mac, Windows, Linux, ChromeOS, Android

#fallback-to-sw-if-gles3-not-supported

Default
Experimental Web Platform features
Enables experimental Web Platform features that are in development. – Mac, Windows, Linux, ChromeOS, Android

#enable-experimental-web-platform-features

Disabled
Touch UI Layout
Enables touch UI layout in the browser's top chrome. – Mac, Windows, Linux, ChromeOS

#top-chrome-touch-ui

Default
Hardware-accelerated video decode
Hardware-accelerated video decode where available. – Mac, Windows, Linux, ChromeOS, Android

#disable-accelerated-video-decode

Enabled
Hardware-accelerated video encode
Hardware-accelerated video encode where available. – Mac, Windows, ChromeOS, Android

#disable-accelerated-video-encode

Enabled
Hardware Secure Decryption
Enable/Disable the use of hardware secure Content Decryption Module (CDM) for protected content playback. – Windows

#enable-hardware-secure-decryption

Default
Hardware Secure Decryption Fallback
Allows automatically disabling hardware secure Content Decryption Module (CDM) after failures or crashes. Subsequent playback may use software secure CDMs. If this feature is disabled, the fallback will never happen and users could be stuck with playback failures. – Windows

#enable-hardware-secure-decryption-fallback

Default
Media Foundation Camera Usage Monitoring
Enables the use of Media Foundation for camera usage monitoring. This allows detecting if a camera is being used by another application. – Windows

#enable-media-foundation-camera-usage-monitoring

Default
Enable Zero-Copy Video Capture
Camera produces a gpu friendly buffer on capture and, if there is, hardware accelerated video encoder consumes the buffer – Windows

#zero-copy-video-capture

Default
Show autofill signatures.
Annotates web forms with Autofill signatures as HTML attributes. Also marks password fields suitable for password generation. – Mac, Windows, Linux, ChromeOS, Android

#enable-show-autofill-signatures

Disabled
Wallet API Private Passes
Enables the Wallet API for private passes. – Mac, Windows, Linux, ChromeOS, Android

#wallet-api-private-passes-enabled

Default
Use Google Payments sandbox servers
For developers: use the sandbox service for Google Payments API calls. – Mac, Windows, Linux, ChromeOS, Android

#wallet-service-use-sandbox

Default
Use the new permissions backend for Web Bluetooth
Enables the new permissions backend for Web Bluetooth. This will enable persistent storage of device permissions and Web Bluetooth features such as BluetoothDevice.watchAdvertisements() and Bluetooth.getDevices() – Mac, Windows, Linux, ChromeOS, Android

#enable-web-bluetooth-new-permissions-backend

Default
Automatic detection of WebUSB-compatible devices
When enabled, the user will be notified when a device which advertises support for WebUSB is connected. Disable if problems with USB devices are observed when the browser is running. – Mac, Windows, Linux, ChromeOS

#enable-webusb-device-detection

Default
WebGL Developer Extensions
Enabling this option allows web applications to access WebGL extensions intended only for use during development time. – Mac, Windows, Linux, ChromeOS, Android

#enable-webgl-developer-extensions

Disabled
WebGL Draft Extensions
Enabling this option allows web applications to access the WebGL extensions that are still in draft status. – Mac, Windows, Linux, ChromeOS, Android

#enable-webgl-draft-extensions

Disabled
Zero-copy rasterizer
Raster threads write directly to GPU memory associated with tiles. – Mac, Windows, Linux, ChromeOS, Android

#enable-zero-copy

Default
In-Product Help Demo Mode
Selects the In-Product Help demo mode. – Mac, Windows, Linux, ChromeOS, Android

#in-product-help-demo-mode-choice

Default
Enable Isolated Web Apps
Enables experimental support for Isolated Web Apps. See https://github.com/reillyeon/isolated-web-apps for more information. – Mac, Windows, Linux, ChromeOS

#enable-isolated-web-apps

Default
Direct Sockets API in Service Workers
Enables access to the Direct Sockets API in service workers. See https://github.com/WICG/direct-sockets for details. – Mac, Windows, Linux, ChromeOS

#direct-sockets-in-service-workers

Default
Direct Sockets API in Shared Workers
Enables access to the Direct Sockets API in shared workers. See https://github.com/WICG/direct-sockets for details. – Mac, Windows, Linux, ChromeOS

#direct-sockets-in-shared-workers

Default
Enable an allowlist for Isolated Web Apps
Enables an allowlist for Isolated Web Apps, restricting installation and updates to only those apps that are allowlisted. – Mac, Windows, Linux, ChromeOS

#enable-isolated-web-app-allowlist

Default
Enable Isolated Web App Developer Mode
Enables the installation of unverified Isolated Web Apps – Mac, Windows, Linux, ChromeOS

#enable-isolated-web-app-dev-mode

Default
Enable Process Isolation UI
Shows the Enable Process Isolation toggle in chrome://settings/system. – Windows

#enable-process-isolation-ui

Default
Experimental cohort for the Iwa Key Distribution component
Specifies the experimental cohort for the Iwa Key Distribution component. – Mac, Windows, Linux, ChromeOS

#iwa-key-distribution-component-exp-cohort

Disabled
Unframed display mode for Isolated Web Apps
Enables the unframed display mode for Isolated Web Apps. – Mac, Windows, Linux, ChromeOS

#enable-unframed-iwa

Default
Isolate additional origins
Requires dedicated processes for an additional set of origins, specified as a comma-separated list. – Mac, Windows, Linux, ChromeOS, Android

#isolate-origins

Disabled
Disable site isolation
Disables site isolation (SitePerProcess, IsolateOrigins, etc). Intended for diagnosing bugs that may be due to out-of-process iframes. Opt-out has no effect if site isolation is force-enabled using a command line switch or using an enterprise policy. Caution: this disables important mitigations for the Spectre CPU vulnerability affecting most computers. – Mac, Windows, Linux, ChromeOS, Android

#site-isolation-trial-opt-out

Default
Tab Strip Declutter
Enables the Tab Strip Declutter feature on Desktop. – Mac, Windows, Linux, ChromeOS

#tab-strip-declutter

Default
Desktop PWA tab strips
Tabbed application mode - enables the `tabbed` display mode which allows web apps to add a tab strip to their app. – Mac, Windows, Linux, ChromeOS

#enable-desktop-pwas-tab-strip

Default
Desktop PWA tab strips settings
Experimental UI for selecting whether a PWA should open in tabbed mode. – Mac, Windows, Linux, ChromeOS

#enable-desktop-pwas-tab-strip-settings

Default
Desktop PWA tab strip customizations
Enable PWAs to customize their tab strip when in tabbed mode by adding the `tab_strip` manifest field. – Mac, Windows, Linux, ChromeOS

#enable-desktop-pwas-tab-strip-customizations

Default
Sub Apps for Isolated Web Apps
Enable IWAs to install sub apps that have their own manifest and can integrate with the OS, in many ways as if it were a separate app. – Mac, Windows, Linux, ChromeOS

#enable-sub-apps

Default
Desktop PWA Borderless
Enable web app manifests to declare borderless mode as a display override. Prototype implementation of: go/borderless-mode. – Mac, Windows, Linux, ChromeOS

#enable-desktop-pwas-borderless

Default
Desktop PWA Additional Windowing Controls
Enable PWAs to: (1) manually recreate the minimize, maximize and restore window functionalities, (2) set windows (non-/)resizable and (3) listen to window's move events with respective APIs. – Mac, Windows, Linux, ChromeOS

#enable-desktop-pwas-additional-windowing-controls

Default
Record web app debug info
Enables recording additional web app related debugging data to be displayed in: chrome://web-app-internals – Mac, Windows, Linux, ChromeOS

#record-web-app-debug-info

Default
Use Chrome Sync sandbox
Connects to the testing server for Chrome Sync. – Mac, Windows, Linux, ChromeOS, Android

#use-sync-sandbox

Disabled
Connect to Cast devices on all IP addresses
Have the Media Router connect to Cast devices on all IP addresses, not just RFC1918/RFC4193 private addresses. – Mac, Windows, Linux, ChromeOS

#media-router-cast-allow-all-ips

Default
Allow all sites to initiate mirroring
When enabled, allows all websites to request to initiate tab mirroring via Presentation API. Requires #cast-media-route-provider to also be enabled – Mac, Windows, Linux, ChromeOS

#allow-all-sites-to-initiate-mirroring

Default
Enables logging of all Cast messages.
Enables logging of all messages exchanged between websites, Chrome, and Cast receivers in chrome://media-router-internals. – Mac, Windows, Linux, ChromeOS

#cast-message-logging

Default
Cast Streaming Exponential Video Bitrate Algorithm
Enables the exponential video bitrate algorithm for Cast Streaming. This algorithm uses an exponential increase and decrease factor to adjust the bitrate based on network conditions. – Mac, Windows, Linux, ChromeOS

#cast-streaming-exponential-video-bitrate-algorithm

Default
Toggle hardware accelerated H.264 video encoding for Cast Streaming
The default is to allow hardware H.264 encoding when recommended for the platform. If enabled, hardware H.264 encoding will always be allowed when supported by the platform. If disabled, hardware H.264 encoding will never be used. – Mac, Windows, Linux, ChromeOS

#cast-streaming-hardware-h264

Default
Toggle hardware accelerated HEVC video encoding for Cast Streaming
The default is to allow hardware HEVC encoding when recommended for the platform. If enabled, hardware HEVC encoding will always be allowed when supported by the platform. If disabled, hardware HEVC encoding will never be used. – Mac, Windows, Linux, ChromeOS

#cast-streaming-hardware-hevc

Default
Toggle hardware accelerated VP8 video encoding for Cast Streaming
The default is to allow hardware VP8 encoding when recommended for the platform. If enabled, hardware VP8 encoding will always be allowed when supported by the platform (regardless of recommendation). If disabled, hardware VP8 encoding will never be used. – Mac, Windows, Linux, ChromeOS

#cast-streaming-hardware-vp8

Default
Toggle hardware accelerated VP9 video encoding for Cast Streaming
The default is to allow hardware VP9 encoding when recommended for the platform. If enabled, hardware VP9 encoding will always be allowed when supported by the platform (regardless of recommendation). If disabled, hardware VP9 encoding will never be used. – Mac, Windows, Linux, ChromeOS

#cast-streaming-hardware-vp9

Default
Toggles using the media::VideoEncoder implementation for Cast Streaming
When enabled, the media base VideoEncoder implementation is used instead of the media cast implementation. – Mac, Windows, Linux, ChromeOS

#cast-streaming-media-video-encoder

Default
Toggle a performance metrics overlay while Cast Streaming
When enabled, a text overlay is rendered on top of each frame sent while Cast Streaming that includes frame duration, resolution, timestamp, low latency mode, capture duration, target playout delay, target bitrate, and encoder utilization. – Mac, Windows, Linux, ChromeOS

#cast-streaming-performance-overlay

Default
Enable AV1 video encoding for Cast Streaming
Offers the AV1 video codec when negotiating Cast Streaming, and uses AV1 if selected for the session. – Mac, Windows, Linux, ChromeOS

#enable-cast-streaming-av1

Default
Enable hardware H264 video encoding on for Cast Streaming on Windows
Offers the H264 video codec when negotiating Cast Streaming, and uses hardware-accelerated H264 encoding if selected for the session – Windows

#enable-cast-streaming-win-hardware-h264

Default
Enables Cast Streaming to offer only hardware accelerated codecs first
When enabled, the Cast Streaming session negotiates only the hardware accelerated codecs first, and only offers software encoding if the receiver rejects the initial offer. – Mac, Windows, Linux, ChromeOS

#enable-cast-streaming-offer-hardware-first

Default
Enable VP8 video encoding for Cast Streaming
Offers the VP8 video codec when negotiating Cast Streaming, and uses VP8 if selected for the session. If true, software VP8 encoding will be offered and hardware VP8 encoding may be offered if enabled and available on this platform. If false, software VP8 will not be offered and hardware VP8 will only be offered if #cast-streaming-hardware-vp8 is explicitly set to true. – Mac, Windows, Linux, ChromeOS

#enable-cast-streaming-vp8

Default
Enable VP9 video encoding for Cast Streaming
Offers the VP9 video codec when negotiating Cast Streaming, and uses VP9 if selected for the session. – Mac, Windows, Linux, ChromeOS

#enable-cast-streaming-vp9

Default
HiDPI tab capture support for Cast Streaming
Enables HiDPI tab capture during Cast Streaming mirroring sessions. May reduce performance on some platforms and also improve quality of video frames. – Mac, Windows, Linux, ChromeOS

#enable-cast-streaming-with-hidpi

Default
OpenXR Spatial Entities
Allows the OpenXR runtime to use the spatial entities set of extensions to understand the environment. – Windows, Android

#openxr-spatial-entities

Default
Spatial Entities Depth-based Hit Test
Controls whether the spatial entities framework is allowed to use depth-based hit tests or only plane-based ones. – Windows, Android

#spatial-entities-depth-hit-test

Default
WebXR Layers
Enables use of WebXR Layers. – Windows, Android

#webxr-projection-layers

Default
WebXR/WebGPU Binding
Enables rendering with WebGPU for WebXR sessions. WebXR Projection Layers must be also be enabled to use this feature. – Windows, Android

#webxr-webgpu-binding

Default
WebXR Incubations
Enables experimental features for WebXR. – Mac, Windows, Linux, ChromeOS, Android

#webxr-incubations

Default
WebXR Internals Debugging Page
Enables the webxr-internals developer page which can be used to help debug issues with the WebXR Device API. – Mac, Windows, Linux, ChromeOS, Android

#webxr-internals

Default
WebXR Plane Detection
Enables access to the WebXR plane-detection feature. – Windows, Android

#webxr-plane-detection

Default
WebXR Mesh Detection
Enables access to the WebXR mesh-detection feature. – Windows, Android

#webxr-mesh-detection

Default
Force WebXr Runtime
Force the browser to use a particular runtime, even if it would not usually be enabled or would otherwise not be selected based on the attached hardware. – Mac, Windows, Linux, ChromeOS, Android

#webxr-runtime

Default
WebXr Hand Anonymization Strategy
Force the browser to use a particular strategy for anonymizing hand data, the default order has a hierarchy of strategies to try and if all of them fail, then no data will be returned, while this choice does allow the (not recommended) alternative of bypassing these algorithms all together. – Mac, Windows, Linux, ChromeOS, Android

#webxr-hand-anonymization

Default
Experimental system keyboard lock
Enables websites to use the keyboard.lock() API to intercept system keyboard shortcuts and have the events routed directly to the website when in fullscreen mode. – Mac, Windows, Linux, ChromeOS

#system-keyboard-lock

Default
Block scripts loaded via document.write
Disallows fetches for third-party parser-blocking scripts inserted into the main frame via document.write. – Mac, Windows, Linux, ChromeOS, Android

#disallow-doc-written-script-loads

Default
Use Windows Runtime MIDI API
Use Windows Runtime MIDI API for WebMIDI (effective only on Windows 10 or later). – Windows

#use-winrt-midi-api

Default
Border around WGC captures
When using WGC to capture a window or a screen, draw a border around the captured surface. – Windows

#webrtc-wgc-require-border

Default
Enable offering upload of Autofilled credit cards
Enables a new option to upload credit cards to Google Payments for sync to all Chrome devices. – Mac, Windows, Linux, ChromeOS, Android

#enable-autofill-credit-card-upload

Default
Force UI direction
Explicitly force the UI to left-to-right (LTR) or right-to-left (RTL) mode, overriding the default direction of the UI language. – Mac, Windows, Linux, ChromeOS, Android

#force-ui-direction

Default
Force text direction
Explicitly force the per-character directionality of UI text to left-to-right (LTR) or right-to-left (RTL) mode, overriding the default direction of the character language. – Mac, Windows, Linux, ChromeOS, Android

#force-text-direction

Default
TLS 1.3 Early Data
This option enables TLS 1.3 Early Data, allowing GET requests to be sent during the handshake when resuming a connection to a compatible TLS 1.3 server. – Mac, Windows, Linux, ChromeOS, Android

#enable-tls13-early-data

Default
Ignore SCTs from OCSP
When enabled, SCTs delivered via OCSP responses are not used for satisfying Chrome's CT policy. – Mac, Windows, Linux, ChromeOS, Android

#ct-ignore-scts-from-ocsp

Default
TLS Trust Anchor IDs
This option configures TLS Trust Anchor IDs, allowing compatible servers to select between available certificates issued by different CAs. – Mac, Windows, Linux, ChromeOS, Android

#tls-trust-anchor-ids

Default
Auto Dark Mode for Web Contents
Automatically render all web contents using a dark theme. – Mac, Windows, Linux, ChromeOS, Android

#enable-force-dark

Default
Experimental Web Payments API features
Enable experimental Web Payments API features – Mac, Windows, Linux, ChromeOS, Android

#enable-web-payments-experimental-features

Default
Web Payments App Store Billing Debug Mode
App-store purchases (e.g., Google Play Store) within a TWA can be requested using the Payment Request API. This flag removes the restriction that the TWA has to be installed from the app-store. – Mac, Windows, Linux, ChromeOS, Android

#enable-debug-for-store-billing

Default
Fill passwords on account selection
Filling of passwords when an account is explicitly selected by the user rather than autofilling credentials on page load. – Mac, Windows, Linux, ChromeOS, Android

#fill-on-account-select

Default
First Run Desktop Choice Screen Refresh
Enables the visually refreshed first run and profile creation flows, including the choice screen (FRE and dialog versions), for users in search engine choice screen regions. It is no-op if `first-run-desktop-refresh` is disabled. – Mac, Windows, Linux

#first-run-desktop-choice-screen-refresh

Default
First Run Desktop Refresh
Enables the visually refreshed first run and profile creation flows in users outside of search engine choice screen regions. To enable the refresh in search engine choice screen regions, enable `first-run-desktop-choice-screen-refresh` as well. – Mac, Windows, Linux

#first-run-desktop-refresh

Default
First Run Desktop Revamp
Enables the first run revamp (new UI and additional effects). It is no-op if `first-run-desktop-refresh` is disabled. – Mac, Windows, Linux

#first-run-desktop-revamp

Default
Most Visited Tile: New scoring function
When showing MV tiles, use a new scoring function to compute the score of each segment. – Mac, Windows, Linux, ChromeOS, Android

#most-visited-tiles-new-scoring

Default
Omnibox Zero Prefix Suggest Prefetch Request Debouncing
Enables the use of a request debouncer to throttle the volume of ZPS prefetch requests issued to the remote Suggest service. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-zero-suggest-prefetch-debouncing

Default
Omnibox Zero Prefix Suggestion Prefetching on SRP
Enables prefetching of the zero prefix suggestions for eligible users on the Search Results page. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-zero-suggest-prefetching-on-srp

Default
Omnibox Zero Prefix Suggestion Prefetching on the Web
Enables prefetching of the zero prefix suggestions for eligible users on the Web (i.e. non-NTP and non-SRP URLs). – Mac, Windows, Linux, ChromeOS, Android

#omnibox-zero-suggest-prefetching-on-web

Default
Log Omnibox URL Scoring Signals
Enables Omnibox to log scoring signals of URL suggestions. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-ml-log-url-scoring-signals

Default
Omnibox ML URL Score Caching
Enables in-memory caching of ML URL scores. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-ml-url-score-caching

Default
Omnibox ML URL Scoring
Enables ML-based relevance scoring for Omnibox URL Suggestions. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-ml-url-scoring

Default
Omnibox URL Scoring Model
Enables ML scoring model for Omnibox URL suggestions. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-ml-url-scoring-model

Default
Contextual search box uses contextual search provider
Enables the contextual search box to use the ContextualSearchProvider instead of the ZeroSuggestProvider as the source for suggestions. – Mac, Windows, Linux, ChromeOS

#contextual-search-box-uses-contextual-search-provider

Default
Contextual search open Lens action uses thumbnail
Enables web content thumbnail image to override the Lens icon for the omnibox entry point action match. – Mac, Windows, Linux, ChromeOS

#contextual-search-open-lens-action-uses-thumbnail

Default
Contextual suggestions ablate others when present
Makes contextual search suggestions exclusive in zero suggest. – Mac, Windows, Linux, ChromeOS

#contextual-suggestions-ablate-others-when-present

Default
Enable forced download to OneDrive
Enables forced download to OneDrive for enterprise users. – Mac, Windows, Linux, ChromeOS

#enable-force-download-to-onedrive

Default
Omnibox contextual search on focus suggestions
Enables omnibox contextual search suggestions in zero prefix suggest. – Mac, Windows, Linux, ChromeOS

#omnibox-contextual-search-on-focus-suggestions

Default
Searchbox embedded permission dialogue
Enables embedded permission dialogues for New Tab Page, omnibox popup, and contextual tasks' permission requests. – Mac, Windows, Linux, ChromeOS

#searchbox-embedded-permission

Default
Lens Overlay Omnibox entrypoint
Enables icon button for Lens entrypoint in the Omnibox. – Mac, Windows, Linux, ChromeOS

#lens-overlay-omnibox-entry-point

Default
AI Mode Omnibox entrypoint
Enables icon button for AI Mode entrypoint in the Omnibox. – Mac, Windows, Linux, ChromeOS

#ai-mode-omnibox-entry-point

Default
AI Entrypoint Disabled on User Input
Hide the Omnibox entrypoint for AI Mode while user is typing. – Mac, Windows, Linux, ChromeOS

#hide-aim-omnibox-entrypoint-on-user-input

Default
Omnibox Allow AI Mode Matches
Allow showing AI mode matches if returned from the search server. – Mac, Windows, Linux, ChromeOS

#omnibox-allow-ai-mode-matches

Default
Omnibox on-focus suggestions on web and SRP
Enables zero-prefix suggestions on web and SRP when the omnibox is focused, subject to the same conditions and restrictions as on-clobber suggestions. – Mac, Windows, Linux, ChromeOS

#omnibox-focus-triggers-web-and-srp-zero-suggest

Default
Show omnibox suggestions popup on mouse released
Enables delaying presentation of the omnibox suggestions popup until the mouse is released. – Mac, Windows, Linux, ChromeOS

#omnibox-show-popup-on-mouse-released

Default
Hide suggestion group headers in the Omnibox popup
If enabled, suggestion group headers will be hidden in the Omnibox popup (e.g. to minimize visual clutter in the zero-prefix state) – Mac, Windows, Linux, ChromeOS

#omnibox-hide-suggestion-group-headers

Default
Hide contextual suggestion group headers in the Omnibox popup
If enabled, contextual suggestion group headers will be hidden in the Omnibox popup (e.g. to minimize visual clutter in the zero-prefix state) – Mac, Windows, Linux, ChromeOS

#omnibox-hide-contextual-group-headers

Default
Omnibox on-focus URL suggestions on web and SRP
Enables zero-prefix URL suggestions on web and SRP when the omnibox is focused. – Mac, Windows, Linux, ChromeOS

#omnibox-url-suggestions-on-focus

Default
Omnibox suggestion limit for zero prefix suggestions
Enables limits on the total number of suggestions, as well as separate limits for search and URL suggestions in the omnibox. – Mac, Windows, Linux, ChromeOS

#omnibox-zps-suggestion-limit

Default
Omnibox contextual suggestions
Enables omnibox contextual suggestions. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-contextual-suggestions

Default
Omnibox toolbelt
Adds a row of buttons at the bottom of the omnibox. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-toolbelt

Default
AIM Server Eligibility
Enable AIM server eligibility checks. – Mac, Windows, Linux, ChromeOS, Android

#aim-server-eligibility

Default
Zero suggest prefetching for composebox
Enables prefetching of the zero prefix suggestions for composebox contexts. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-zero-suggest-prefetching-for-composebox

Default
AIM Server Eligibility: Include Client Locale
Configures whether to include the client locale in the AIM eligibility request. – Mac, Windows, Linux, ChromeOS, Android

#aim-server-eligibility-include-client-locale

Default
Use PEC API
When enabled, all composebox context menus will use the `SearchboxConfig` from the PEC API. – Mac, Windows, Linux, ChromeOS, Android

#aim-use-pec-api

Default
Omnibox on device head suggestions (non-incognito only)
Google head non personalized search suggestions provided by a compact on device model for non-incognito. Turn off this feature if you have other apps running which affects local file access (e.g. anti-virus software) and are experiencing searchbox typing lag. – Windows

#omnibox-on-device-head-suggestions

Default
Omnibox on device head suggestions (incognito only)
Google head non personalized search suggestions provided by a compact on device model for incognito. Turn off this feature if you have other apps running which affects local file access (e.g. anti-virus software) and are experiencing searchbox typing lag. – Windows

#omnibox-on-device-head-suggestions-incognito

Default
Omnibox on device tail suggestions
Google tail non personalized search suggestions provided by a compact on device model. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-on-device-tail-suggestions

Default
Force color profile
Forces Chrome to use a specific color profile instead of the color of the window's current monitor, as specified by the operating system. – Mac, Windows, Linux, ChromeOS, Android

#force-color-profile

Default
Forced Colors
Enables forced colors mode for web content. – Mac, Windows, Linux, ChromeOS, Android

#forced-colors

Default
Adaptive global tone mapping
Enables parsing and rendering of adaptive global tone mapping (AGTM) aka SMTPE ST 2094-50 HDR metadata – Mac, Windows, Linux, ChromeOS, Android

#hdr-agtm

Default
Chrome heap profiler start mode.
Starts heap profiling service that records sampled memory allocation profile having each sample attributed with a callstack. The sampling resolution is controlled with --memlog-sampling-rate flag. Recorded heap dumps can be obtained at chrome://tracing [category:memory-infra] and chrome://memory-internals. This setting controls which processes will be profiled since their start. To profile any given process at a later time use chrome://memory-internals page. – Mac, Windows, Linux, ChromeOS, Android

#memlog

Disabled
Heap profiling sampling interval (in bytes).
Heap profiling service uses Poisson process to sample allocations. Default value for the interval between samples is 1000000 (1MB). This results in low noise for large and/or frequent allocations [size * frequency >> 1MB]. This means that aggregate numbers [e.g. total size of malloc-ed objects] and large and/or frequent allocations can be trusted with high fidelity. Lower intervals produce higher samples resolution, but come at a cost of higher performance overhead. – Mac, Windows, Linux, ChromeOS, Android

#memlog-sampling-rate

Default
Heap profiling stack traces type.
By default heap profiling service records native stacks. A post-processing step is required to symbolize the stacks. 'Native with thread names' adds the thread name as the first frame of each native stack. It's also possible to record a pseudo stack using trace events as identifiers. It's also possible to do a mix of both. – Mac, Windows, Linux, ChromeOS, Android

#memlog-stack-mode

Default
NTP Searchbox (Realbox) Voice Search Coherence
Enables the voice search coherence experiment (new recording animation, new metrics, added stop/submit button) for the New Tab Page searchbox, with option for live transcription. – Mac, Windows, Linux, ChromeOS

#ntp-searchbox-voice-search-coherence

Default
Omnibox Grouping Framework for Typed Suggestions
Enables an alternative grouping implementation for omnibox autocompletion. – Mac, Windows, Linux, ChromeOS, Android

#omnibox-grouping-framework-non-zps

Default
Enable optimization guide debug logs
Enables the optimization guide to log and save debug messages that can be shown in the internals page. – Mac, Windows, Linux, ChromeOS, Android

#optimization-guide-debug-logs

Disabled
Enables optimization guide on device
Enables the optimization guide to execute models on device. – Mac, Windows, Linux, ChromeOS

#optimization-guide-on-device-model

Default
Text Safety Classifier
Enables text safety classifier for on-device models – Mac, Windows, Linux, ChromeOS

#text-safety-classifier

Default
Organic repeatable queries in Most Visited tiles
Enables showing the most repeated queries, from the device browsing history, organically among the most visited sites in the MV tiles. – Mac, Windows, Linux, ChromeOS, Android

#organic-repeatable-queries

Default
Composebox Voice Search Coherence
Enables the voice search coherence (new recording animation, new metrics, new stop/submit button, no live transcription) for all the composeboxes by default. Options include cobrowsing only. – Mac, Windows, Linux, ChromeOS

#composebox-voice-search-coherence

Default
Page content annotations
Enables page content to be annotated on-device. – Mac, Windows, Linux, ChromeOS, Android

#page-content-annotations

Default
Page content annotations - Remote page metadata
Enables fetching of page load metadata to be persisted on-device. – Mac, Windows, Linux, ChromeOS, Android

#page-content-annotations-remote-page-metadata

Default
Tab Groups Focusing
When a tab group is focused, the tabstrip constrains visiblity to the tabs in that group. – Mac, Windows, Linux, ChromeOS

#tab-groups-focusing

Default
Vertical Tabs
Enables an option for showing tabs to the side. – Mac, Windows, Linux, ChromeOS

#vertical-tabs

Default
Vertical Tabs Expand On Hover
Vertical tabs (when enabled and collapsed) will expand on mouse hover. – Mac, Windows, Linux, ChromeOS

#vertical-tabs-expand-on-hover

Default
Side Panel Flyover Animation
Simplifies contents animations while animating vertical tabstrip and side panels, reducing jank on most platforms. When enabled, the animating elements will appear to float over the contents, which resize at the beginning or end of the animation. – Mac, Windows, Linux, ChromeOS

#side-panel-flyover-animation

Default
Composebox Drive Context Menu Option
Enables Google Drive option in the Composebox context menu. – Mac, Windows, Linux, ChromeOS

#composebox-drive-context-menu-option

Default
Composebox uses chrome-compose client
Composebox will use chrome-compose client when querying suggest for unimodal typed inputs instead of chrome-omni. – Mac, Windows, Linux, ChromeOS, Android

#composebox-uses-chrome-compose-client

Default
Context management in the Composebox
Enables an updated tab context management UI in the plus button and composebox context menu. – Mac, Windows, Linux, ChromeOS

#context-management-in-composebox

Default
Tab favicon chips to coins
Removes existing tab chips from the composebox and instead adds favicon coins next to the "+" button. – Mac, Windows, Linux, ChromeOS

#tab-favicon-chips-to-coins

Default
NTP Calendar Module
Shows the Google Calendar module on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-calendar-module

Default
NTP Composebox
Shows the Composebox on the New Tab Page Searchbox upon clicking the entrypoint. – Mac, Windows, Linux, ChromeOS

#ntp-composebox

Default
NTP Realbox Next
Enables the Realbox 'Next' experience. – Mac, Windows, Linux, ChromeOS

#ntp-realbox-next

Default
NTP Customize Chrome Auto Promo
Shows the Customize Chrome on the New Tab Page automatically. – Mac, Windows, Linux, ChromeOS

#ntp-customize-chrome-auto-open

Default
NTP Feature Optimization Module Removal
Enables auto-removal of stale modules from the NTP. – Mac, Windows, Linux, ChromeOS

#ntp-feature-optimization-module-removal

Default
NTP Feature Optimization Shortcuts Removal
Enables auto-removal of stale shortcuts from the NTP. – Mac, Windows, Linux, ChromeOS

#ntp-feature-optimization-shortcuts-removal

Default
NTP Simplification Bookmark Bar
Auto-removes the bookmark bar on the New Tab Page and updates bookmark bar visbility settings. – Mac, Windows, Linux, ChromeOS

#ntp-simplification-bookmark-bar

Default
NTP Feature Optimization Dismiss Modules Removal
Removes the dismiss module buttons from the NTP modules. – Mac, Windows, Linux, ChromeOS

#ntp-feature-optimization-dismiss-modules-removal

Default
NTP Animated Doodles
Enables animated Doodles on the NTP. – Mac, Windows, Linux, ChromeOS

#ntp-animated-doodles

Default
NTP Doodle Murals
Enables Doodle Murals on the NTP. – Mac, Windows, Linux, ChromeOS

#ntp-doodle-murals

Default
NTP Next Features
Enables features (e.g., AI action chips) in NTP Next – Mac, Windows, Linux, ChromeOS

#ntp-next-features

Default
NTP OneGoogleBar Async Bar Parts
Enables the OneGoogleBar async bar parts API on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-ogb-async-bar-parts

Default
NTP Outlook Calendar Module
Shows the Outlook Calendar module on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-outlook-calendar-module

Default
NTP Sharepoint Module
Shows the Sharepoint module on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-sharepoint-module

Default
NTP Tab Groups Module
Shows the Tab Groups module on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-tab-groups-module

Default
NTP Tab Groups Zero State Card
Enables the zero-state card for the Tab Groups Module on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-tab-groups-module-zero-state

Default
NTP Microsoft Authentication Module
Shows the Microsoft Authentication Module on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-microsoft-authentication-module

Default
NTP Shortcuts Redesign
Enables the redesigned shortcuts on the New Tab Page. – Mac, Windows, Linux, ChromeOS

#ntp-shortcuts-redesign

Default
Chrome-wide echo cancellation
Run WebRTC capture audio processing in the audio process instead of the renderer processes, thereby cancelling echoes from more audio sources. – Mac, Windows, Linux

#chrome-wide-echo-cancellation

Default
Enable pixel canvas recording
Pixel canvas recording allows the compositor to raster contents aligned with the pixel and improves text rendering. This should be enabled when a device is using fractional scale factor. – Mac, Windows, Linux, ChromeOS

#enable-pixel-canvas-recording

Default
Parallel downloading
Enable parallel downloading to accelerate download speed. – Mac, Windows, Linux, ChromeOS, Android

#enable-parallel-downloading

Default
Enable network logging to file
Enables network logging to a file named netlog.json in the user data directory. The file can be imported into chrome://net-internals. – Mac, Windows, Linux, ChromeOS, Android

#enable-network-logging-to-file

Disabled
Web Authentication Enterprise Attestation
Permit a set of origins to request a uniquely identifying enterprise attestation statement from a security key when creating a Web Authentication credential. – Mac, Windows, Linux, ChromeOS, Android

#web-authentication-permit-enterprise-attestation

Disabled
Exclude Picture-in-Picture windows from screen capture
When enabled, Picture-in-Picture windows will be excluded from screen captures. – Mac, Windows, Linux, ChromeOS, Android

#exclude-pip-from-screen-capture

Default
OOPIF for PDF Viewer
Use an OOPIF for the PDF Viewer, instead of a GuestView. – Mac, Windows, Linux, ChromeOS

#pdf-oopif

Default
Use Skia Renderer
Use Skia as the PDF renderer. This flag will have no effect if the renderer choice is controlled by an enterprise policy. – Mac, Windows, Linux, ChromeOS

#pdf-use-skia-renderer

Default
PDF Ink Signatures
Enables the ability to annotate PDFs using a new ink library. – Mac, Windows, Linux, ChromeOS

#pdf-ink2

Default
Save PDF to Drive
Enables the ability to save PDFs to Google Drive. – Mac, Windows, Linux, ChromeOS

#pdf-save-to-drive

Default
Gamepad Raw Input Change Event
Enables raw input change events in Gamepad API. – Windows

#gamepad-raw-input-change-event

Default
Windows 11 Mica titlebar
Use the DWM system-drawn Mica titlebar on Windows 11, version 22H2 (build 22621) and above. – Windows

#windows11-mica-titlebar

Default
Gemini Antiscam Protection
Enables querying Gemini for antiscam protection signals and collecting metrics. – Mac, Windows, Linux, ChromeOS, Android

#gemini-antiscam-protections-metrics-only

Default
Report Unsafe Site
Enables the 'Report Unsafe Site' menu item in the app Help menu, which enables users to report the webpage in the active tab as unsafe. – Mac, Windows, Linux, ChromeOS

#report-unsafe-site

Default
Insecure origins treated as secure
Treat given (insecure) origins as secure origins. Multiple origins can be supplied as a comma-separated list. Origins must have their protocol specified e.g. "http://example.com". For the definition of secure contexts, see https://w3c.github.io/webappsec-secure-contexts/ – Mac, Windows, Linux, ChromeOS, Android

#unsafely-treat-insecure-origin-as-secure

Disabled
Disable subframe process reuse
Prevents out-of-process iframes from reusing compatible processes from unrelated tabs. This is an experimental mode that will result in more processes being created. – Mac, Windows, Linux, ChromeOS

#disable-process-reuse

Default
Stylus Handwriting for Windows.
Enables an experimental feature that lets users handwrite into text fields using a compatible stylus. Only supported on Windows builds 22621 (patch 5126 and newer), 22631 (patch 5126 and newer) and all builds equal to or newer than 26100.3624 – Windows

#stylus-handwriting-win

Default
Headless Live Captions
Enable features related to headless captions exploration. These are very likely unstable. – Mac, Windows, Linux, ChromeOS

#enable-headless-live-caption

Default
Headless Caption Early Start
Start headless captioning as soon as a profile is loaded. – Mac, Windows, Linux, ChromeOS

#enable-headless-live-caption-early-start

Default
Input protection
Enables input protection by blocking interaction with views that are currently or were recently obscured by always-on-top windows, and prevents unintended events on security-sensitive UI that appears and activates unexpectedly. – Mac, Windows, Linux, ChromeOS

#enable-input-protection

Default
Reading Mode Read Aloud Phrase Highlighting
Enables the experimental Reading Mode feature that highlights by phrases when reading aloud, when the phrase option is selected from the highlight menu. – Mac, Windows, Linux, ChromeOS

#read-anything-read-aloud-phrase-highlighting

Default
Reading Mode with images added via algorithm
Have Reading Mode use a local rules based algorithm to include images from webpages. – Mac, Windows, Linux, ChromeOS

#read-anything-images-via-algorithm

Default
Reading Mode Google Docs Integration
Allows Reading Mode to work on Google Docs. – Mac, Windows, Linux, ChromeOS

#read-anything-docs-integration

Default
Reading Mode Google Docs Load More Button
Adds a button to the end of the Reading Mode UI. When clicked, the main page scrolls to show the next page's content. – Mac, Windows, Linux, ChromeOS

#read-anything-docs-load-more-button

Default
Use alternative route for image descriptions.
When adding automatic captions to images, use a different route to acquire descriptions. – Mac, Windows, Linux, ChromeOS, Android

#image-descriptions-alternative-routing

Default
Boundary Event Dispatch Tracks Node Removal
Mouse and Pointer boundary event dispatch (i.e. dispatch of enter, leave, over, out events) tracks DOM node removal to fix event pairing on ancestor nodes. – Mac, Windows, Linux, ChromeOS, Android

#boundary-event-dispatch-tracks-node-removal

Default
Enable experimental prediction for scroll events
Predicts the scroll amount after the vsync time to more closely match when the frame is visible. – Mac, Windows, Linux, ChromeOS, Android

#enable-resampling-scroll-events-experimental-prediction

Default
Happiness Tracking Surveys Demo
Enable showing Happiness Tracking Surveys Demo to users on Desktop – Mac, Windows, Linux, ChromeOS

#happiness-tracking-surveys-for-desktop-demo

Default
Choose ANGLE graphics backend
Choose the graphics backend for ANGLE. D3D11 is used on most Windows computers by default. – Windows

#use-angle

Default
Gamepad Multitouch
Enables the ability to receive input from multitouch surface on the gamepad object. – Windows

#enable-gamepad-multitouch

Default
Enable GameInput data fetcher
Enables Gamepad API to use GameInput for gamepad access. – Windows

#enable-windows-gameinput-data-fetcher

Default
Enable gpu service logging
Enable printing the actual GL driver calls. – Mac, Windows, Linux, ChromeOS, Android

#enable-gpu-service-logging

Disabled
Hardware Media Key Handling
Enables using media keys to control the active media session. This requires MediaSessionService to be enabled too – Mac, Windows, Linux, ChromeOS

#hardware-media-key-handling

Default
Strict-Origin-Isolation
Experimental security mode that strengthens the site isolation policy. Controls whether site isolation should use origins instead of scheme and eTLD+1. – Mac, Windows, Linux, ChromeOS, Android

#strict-origin-isolation

Default
Enable the `FencedFrameConfig` constructor.
The `FencedFrameConfig` constructor allows you to test the <fencedframe> element without running an ad auction, as you can manually supply a URL to navigate the fenced frame to. – Mac, Windows, Linux, ChromeOS, Android

#enable-fenced-frames-developer-mode

Default
Unsafe WebGPU Support
Convenience flag for WebGPU development. Enables best-effort WebGPU support on unsupported configurations and more! Note that this flag could expose security issues to websites so only use it for your own development. – Mac, Windows, Linux, ChromeOS, Android

#enable-unsafe-webgpu

Disabled
Force High Performance GPU
Forces use of high performance GPU if available. Warning: this flag may increase power consumption leading to shorter battery time. – Windows

#force-high-performance-gpu

Disabled
WebGPU Developer Features
Enables web applications to access WebGPU features intended only for use during development. – Mac, Windows, Linux, ChromeOS, Android

#enable-webgpu-developer-features

Disabled
Elastic Overscroll
Enables Elastic Overscrolling on touchscreens and precision touchpads. – Windows, Android

#elastic-overscroll

Default
Element Capture cross-tab
Allows the Element Capture API to be used cross-tab. (Only has an effect if Element Capture is generally enabled.) – Mac, Windows, Linux, ChromeOS

#element-capture-cross-tab

Default
Enable location provider manager for Geolocation API
Enables usage of the location provider manager to select between the operating system's location API or the network-based provider as the data source for Geolocation API. – Mac, Windows

#enable-location-provider-manager

Default
Notification one-tap unsubscribe on Desktop
Enables an experimental UX on Desktop that replaces the [Site settings]button on web push notifications with an [Unsubscribe] button. – Mac, Windows, Linux, ChromeOS

#notification-one-tap-unsubscribe-on-desktop

Default
Heavy ad privacy mitigations
Enables privacy mitigations for the heavy ad intervention. Disabling this makes the intervention deterministic. Defaults to enabled. – Mac, Windows, Linux, ChromeOS, Android

#heavy-ad-privacy-mitigations

Default
Run video capture service in browser
Run the video capture service in the browser process. – Windows, ChromeOS

#run-video-capture-service-in-browser

Default
MediaFoundation Video Capture
Enable/Disable the usage of MediaFoundation for video capture. Fall back to DirectShow if disabled. – Windows

#enable-media-foundation-video-capture

Default
Enable experimental cookie features
Enable new features that affect setting, sending, and managing cookies. The enabled features are subject to change at any time. – Mac, Windows, Linux, ChromeOS, Android

#enable-experimental-cookie-features

Default
Enable Extension Install Policy Fetching
Enables fetching of extension install policies from the cloud for the ExtensionInstallCloudPolicyChecksEnabled policy. – Mac, Windows, Linux, ChromeOS

#enable-extension-install-policy-fetching

Default
Enables WebNN API
Enables the Web Machine Learning Neural Network (WebNN) API. Spec at https://www.w3.org/TR/webnn/ – Mac, Windows, Linux, ChromeOS, Android

#web-machine-learning-neural-network

Default
Enables experimental WebNN API features
Enables additional, experimental features in Web Machine Learning Neural Network (WebNN) API. Requires the "WebNN API" flag to be enabled. – Mac, Windows, Linux, ChromeOS, Android

#experimental-web-machine-learning-neural-network

Default
LiteRT backend for WebNN
Enables the LiteRT backend for WebNN. Disabling this flag enables a fallback to TFLite. – Mac, Windows, Linux, ChromeOS, Android

#webnn-litert

Default
ONNX Runtime backend for WebNN
Enables using ONNX Runtime for CPU, GPU and NPU inference with the WebNN API. Disabling this flag enables a fallback to TFLite. – Windows

#webnn-onnxruntime

Default
Enables Out-of-Process Printer Drivers
Enables printing interactions with the operating system to be performed out-of-process. – Mac, Windows, Linux, ChromeOS

#enable-oop-print-drivers

Default
Privacy Sandbox Internals Page
Enables the chrome://privacy-sandbox-internals debugging page. – Mac, Windows, Linux, ChromeOS, Android

#privacy-sandbox-internals

Default
Trees in viz
Enables the renderer to send a CC LayerTree to the viz/gpu process instead of a CompositorFrame. This allows viz to generate and submit the CompositorFrame directly. – Mac, Windows, Linux, ChromeOS, Android

#trees-in-viz

Default
Omnibox prefetch Search
Allows omnibox to prefetch likely search suggestions provided by the Default Search Engine – Mac, Windows, Linux, ChromeOS, Android

#omnibox-search-prefetch

Default
Omnibox client prefetch Search
Allows omnibox to prefetch search suggestions provided by the Default Search Engine that the client thinks are likely to be navigated. Requires chrome://flags/#omnibox-search-prefetch – Mac, Windows, Linux, ChromeOS, Android

#omnibox-search-client-prefetch

Default
PDF XFA support
Enables support for XFA forms in PDFs. Has no effect if Chrome was not built with XFA support, or if controlled by an enterprise policy. – Mac, Windows, Linux, ChromeOS

#pdf-xfa-forms

Default
Debugging tools for UI
Enables additional keyboard shortcuts to help debugging. – Mac, Windows, Linux

#ui-debug-tools

Default
FedCmAutofill
Allows RPs to enhance autofill with FedCM. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-autofill

Default
FedCm Ambient UI
Enables FedCM ambient UI in the omnibox. – Mac, Windows, Linux, ChromeOS

#fedcm-ambient-ui

Default
FedCM with delegation support
Enables IdPs to delegate presentation to the browser. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-delegation

Default
Email Verification Protocol
Enables the Email Verification Protocol in Autofill. – Mac, Windows, Linux, ChromeOS, Android

#email-verification-protocol

Default
FedCmErrorAttribute
Enables the spec-compliant 'error' attribute in IdentityCredentialError while deprecating the legacy 'code' attribute. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-error-attribute

Default
FedCM with IdP Registration support
Enables RPs to get identity credentials from registered IdPs. – Mac, Windows, Linux, ChromeOS

#fedcm-idp-registration

Default
FedCM in Authenticator
Enables support for FedCM requests through the Authenticator interface. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-in-authenticator

Default
FedCmLightweightMode
Enables IdPs to store user profile information using the login status API. – Mac, Windows, Linux, ChromeOS

#fedcm-lightweight-mode

Default
FedCmMetricsEndpoint
Allows the FedCM API to send performance measurement to the metrics endpoint on the identity provider side. Requires FedCM to be enabled. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-metrics-endpoint

Default
FedCmNonceInParams
Removes nonce as an explicit parameter of the FedCM API. When enabled, a nonce may be passed in params. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-nonce-in-params

Default
FedCmWellKnownEndpointValidation
When enabled, accounts_endpoint and login_url must be present in .well-known/web-identity if client_metadata is used. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-well-known-endpoint-validation

Default
FedCmWithoutWellKnownEnforcement
Supports configURL that's not in the IdP's .well-known file. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-without-well-known-enforcement

Default
FedCmSegmentationPlatform
Enables the segmentation platform service to provide UI volume recommendations to FedCM. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-segmentation-platform

Default
FedCmNavigationInterception
Allows IdP to intercept navigations by initiating a FedCM request. – Mac, Windows, Linux, ChromeOS, Android

#fedcm-navigation-interception

Default
DigitalCredentials
Enables the three-party verifier/holder/issuer identity model. – Mac, Windows, Linux, ChromeOS, Android

#web-identity-digital-credentials

Default
DigitalCredentialsCreation
Enables the Digital Credentials Creation API. – Mac, Windows, Linux, ChromeOS, Android

#web-identity-digital-credentials-creation

Default
Lens enable send raw file media types
Enables sending raw file media types in the Lens overlay. – Mac, Windows, Linux, ChromeOS, Android

#lens-enable-raw-file-media-types

Default
Lens enable send urls in composeboxes
Enables sending urls in AIM composeboxes. – Mac, Windows, Linux, ChromeOS, Android

#lens-enable-urls-in-composeboxes

Default
Bind cookies to their setting origin's port
If enabled, cookies will only be accessible by origins with the same port as the one that originally set the cookie. – Mac, Windows, Linux, ChromeOS, Android

#bind-cookies-to-port

Default
Bind cookies to their setting origin's scheme
If enabled, cookies will only be accessible by origins with the same scheme as the one that originally set the cookie – Mac, Windows, Linux, ChromeOS, Android

#bind-cookies-to-scheme

Default
Use primary and tonal buttons for promos
Use consistent primary and tonal buttons for sign-in promos and intercepts. – Mac, Windows, Linux, ChromeOS

#use-primary-and-tonal-buttons-for-promos

Default
Enable unsafe SwiftShader fallback
Allow SwiftShader to be used as a fallback for software WebGL. Using this flag is unsafe and should only be used for local development. – Mac, Windows, Linux, ChromeOS, Android

#enable-unsafe-swiftshader

Disabled
Prerendering
If enabled, browser features and the speculation rules API can trigger prerendering. If disabled, all prerendering APIs still exist, but a prerender will never successfully take place. – Mac, Windows, Linux, ChromeOS, Android

#prerender2

Default
Prerender2 Cross-Origin Iframes
Enable Prerender2 for cross-origin iframes. – Mac, Windows, Linux, ChromeOS, Android

#prerender2-cross-origin-iframes

Default
Prerender Until Script
Prerenders pages until a script is about to be executed. The script execution and the page parsing will be deferred until action. – Mac, Windows, Linux, ChromeOS, Android

#prerender-until-script

Default
Prerender Activation By Form Submission
Allow Prerender activations by form submission. – Mac, Windows, Linux, ChromeOS, Android

#prerender-activation-by-form-submission

Default
Test Third Party Cookie Phaseout
Enable to test third-party cookie phaseout. Learn more: https://goo.gle/3pcd-flags – Mac, Windows, Linux, ChromeOS, Android

#test-third-party-cookie-phaseout

Disabled
Dialog UI for HTTPS-First Modes
Use a dialog-based UI for HFM – Mac, Windows, Linux, ChromeOS, Android

#https-first-dialog-ui

Default
Enable extension permission omnibox.directInput
Allows extensions to request permission omnibox.directInput, which enables unscoped mode in the Omnibox – Mac, Windows, Linux, ChromeOS, Android

#experimental-omnibox-labs

Default
Extensions Menu Access Control
Enables a redesigned extensions menu that allows the user to control extensions site access. – Mac, Windows, Linux, ChromeOS

#extensions-menu-access-control

Default
IPH Extensions Menu
Enables In-Product-Help that appears when at least one extension has access to the current page. This feature is gated by extensions-menu-access-control. – Mac, Windows, Linux, ChromeOS

#iph-extensions-menu-feature

Default
IPH Extensions Request Access Button Feature
Enables In-Product-Help that appears when at least one extension is requesting access to the current page. This feature is gated by extensions-menu-access-control. – Mac, Windows, Linux, ChromeOS

#iph-extensions-request-access-button-feature

Default
Extension Tab Context Menu
Allowing extensions to add custom items when right-clicking a tab. – Mac, Windows, Linux, ChromeOS

#extension-tab-context-menu

Default
Region Capture cross-tab
Allows the Region Capture API to be used cross-tab. (Only has an effect if Region Capture is generally enabled.) – Mac, Windows, Linux, ChromeOS

#region-capture-cross-tab

Default
Skia Graphite
Enable Skia Graphite. This will use the Dawn backend by default, but can be overridden with command line flags for testing on non-official developer builds. See --skia-graphite-dawn-backend flag in gpu_switches.h. – Mac, Windows, Linux, ChromeOS, Android

#skia-graphite

Default
Tab audio muting UI control
When enabled, the audio indicators in the tab strip double as tab audio mute controls. – Mac, Windows, Linux, ChromeOS

#enable-tab-audio-muting

Default
Enable delegated compositing
When enabled and applicable, the act of compositing is delegated to the system compositor. – Mac, Windows, Linux, ChromeOS, Android

#enable-delegated-compositing

Default
Auto picture in picture for video playback
Enables auto picture in picture for video playback – Mac, Windows, Linux, ChromeOS

#auto-picture-in-picture-for-video-playback

Default
Auto picture in picture on window occluded
Allows auto picture-in-picture to trigger when the window is occluded by another window. – Mac, Windows, Linux, ChromeOS

#auto-picture-in-picture-on-window-occluded

Default
Document Picture-in-Picture Animate Resize
Use an animation when programmatically resizing a documentpicture-in-picture window – Mac, Windows, Linux, ChromeOS

#document-picture-in-picture-animate-resize

Default
Browser initiated automatic picture in picture
When enabled, allows the browser to automatically enter picture in picture when a series of conditions are met. – Mac, Windows, Linux, ChromeOS

#browser-initiated-automatic-picture-in-picture

Default
Browser launch metadata reporting
Enables the collection and reporting of browser launch-related metadata for Chrome Enterprise, including CLI switches and launch timestamp – Mac, Windows, Linux

#browser-launch-metadata-reporting

Default
Picture-in-Picture Mute Control
Adds a mute/unmute button to the Video Picture-in-Picture window. – Mac, Windows, Linux, ChromeOS

#picture-in-picture-mute-control

Default
Picture-in-Picture show window animation
When enabled, Picture-in-Picture windows will use a fade-in show animation. On Windows OS this is a no-op. – Mac, Windows, Linux, ChromeOS

#picture-in-picture-show-window-animation

Default
Document patching
Allow out-of-order streaming of HTML content using <template patchfor> and node.streamHTMLUnsafe(). See https://github.com/WICG/declarative-partial-updates – Mac, Windows, Linux, ChromeOS, Android

#document-patching

Default
Route matching
Allow definition of routes as e.g. URLPattern. Special CSS rules can be used to match active routes. See https://github.com/WICG/declarative-partial-updates/blob/main/route-matching-explainer.md – Mac, Windows, Linux, ChromeOS, Android

#route-matching

Default
Use custom disk cache backend for HTTP Cache
Enables the experimental disk cache backend for HTTP Cache. This flag is overridden by the CacheEncryptionEnabled enterprise policy on supported platforms. – Mac, Windows, Linux, ChromeOS, Android

#http-cache-custom-backend

Default
Audio Ducking
Allows Chrome to duck (attenuate) audio from other tabs. – Mac, Windows, Linux, ChromeOS

#audio-ducking

Default
Origin-keyed Processes by default
Enables origin-keyed process isolation for most pages (i.e., those assigned to an origin-keyed agent cluster by default). This improves security but also increases the number of processes created. Note: enabling this feature also enables 'Origin-keyed Agent Clusters by default'. – Mac, Windows, Linux, ChromeOS, Android

#origin-keyed-processes-by-default

Default
Collaboration Messaging
Enables the messaging framework within the collaboration feature, including features such as recent activity, dirty dots, and description action chips. – Mac, Windows, Linux, ChromeOS, Android

#collaboration-messaging

Default
Approximate Geolocation Permission
Enables the approximate geolocation permission prompt, with options to control prompt arm variations. – Mac, Windows, Linux, ChromeOS

#approximate-geolocation-permission

Default
Omit TLS client certificates if credential mode disallows
Strictly conform the Fetch spec to omit TLS client certificates if credential mode disallows. Without this flag enabled, Chrome will always try sending client certificates regardless of the credential mode. – Mac, Windows, Linux, ChromeOS, Android

#omit-cors-client-cert

Default
XSLT
Toggles whether or not XSLT is supported by the browser. – Mac, Windows, Linux, ChromeOS, Android

#xslt

Default
Symphonia Audio Decoding
Enables using the experimental Symphonia audio decoder instead of using FFMPEG for decoding audio. – Mac, Windows, Linux, ChromeOS, Android

#symphonia-audio-decoding

Default
Web Bluetooth confirm pairing support
Enable confirm-only and confirm-pin pairing mode support for Web Bluetooth – Mac, Windows, Linux, ChromeOS

#enable-web-bluetooth-confirm-pairing-support

Default
Background Resource Fetch
Process resource requests in a background thread inside Blink. – Mac, Windows, Linux, ChromeOS, Android

#background-resource-fetch

Default
Renderer-side content decoding
Enables renderer-side content decoding (decompression). When enabled, the network service sends compressed HTTP response bodies to the renderer process. – Mac, Windows, Linux, ChromeOS, Android

#renderer-side-content-decoding

Default
AI Mode Omnibox Entrypoint always navigates
If enabled, clicking aim button in omnibox always navigates directly to google.com/aimode. – Mac, Windows, Linux, ChromeOS

#aim-entry-point-direct-navigation

Default
Omnibox AI Mode Space Does Not Activate
If enabled, pressing space when the AI mode button has focus will insert a space into the omnibox instead of activating the button. – Mac, Windows, Linux, ChromeOS

#omnibox-ai-mode-space-does-not-activate

Default
Dynamic Aim Submit
Enables dynamic aim button submission variants. – Mac, Windows, Linux, ChromeOS

#omnibox-dynamic-aim-submit

Default
WebUI Omnibox AIM Popup
If enabled, using certain trigger operations the omnibox suggestions popup transition to showing the AI-Mode compose-box input and suggestions. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-aim-popup

Default
WebUI Omnibox AIM Popup Disable Animation
If enabled, there will no longer be animation in the WebUI Omnibox AIM popup. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-aim-popup-disable-animation

Default
WebUI Omnibox Hide AIM URL
If enabled, hides the AIM button when the default suggestion is a URL. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-hide-aim-url

Default
WebUI Omnibox Full Popup
If enabled, shows the omnibox suggestions and the search input in the popup in WebUI. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-full-popup

Default
WebUI Omnibox Full Popup V2
If enabled, then both the input row and suggestions dropdown (in the Omnibox) will be rendered using the WebUI stack (i.e. the cutout for the location bar will be removed). NOTE: This flag is intended to control the next-gen Omnibox experience and will eventually supersede the 'WebUI Omnibox Full Popup' feature flag. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-full-popup-v2

Default
WebUI Omnibox Popup
If enabled, shows the omnibox suggestions in the popup in WebUI. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-popup

Default
WebUI Omnibox Popup Debug Mode
Enables the WebUI for omnibox suggestions without modifying the popup UI. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-popup-debug

Default
WebUI Omnibox Popup Selection Control
If enabled, the WebUI omnibox popup will control its own selection state. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-popup-selection-control

Default
WebUI Omnibox Simplification
If enabled, the WebUI omnibox popup will have a different UX for the entrypoint to composebox. – Mac, Windows, Linux, ChromeOS

#webui-omnibox-simplification

Default
Group Promo Prototype
Enables prototype for group promo. – Mac, Windows, Linux, ChromeOS, Android

#group-promo-prototype

Default
Sync account settings
Enables syncing account settings to the server. – Mac, Windows, Linux, ChromeOS, Android

#sync-account-settings

Default
Sync autofill valuable metadata
Enables syncing valuable metadata for autofill to the server. – Mac, Windows, Linux, ChromeOS, Android

#sync-autofill-valuable-metadata

Default
Sync wallet flight reservations
Enables syncing flight reservations in the wallet to the server. – Mac, Windows, Linux, ChromeOS, Android

#sync-wallet-flight-reservations

Default
Sync wallet vehicle registrations
Enables syncing vehicle registrations in the wallet to the server. – Mac, Windows, Linux, ChromeOS, Android

#sync-wallet-vehicle-registrations

Default
Compression dictionary transport
Enables compression dictionary transport. – Mac, Windows, Linux, ChromeOS, Android

#enable-compression-dictionary-transport

Default
Compression dictionary transport ttl
Enables support for the 'ttl' parameter in the 'use-as-dictionary' HTTP response header. – Mac, Windows, Linux, ChromeOS, Android

#enable-compression-dictionary-ttl

Default
Changes the target playout delay for Cast mirroring.
Choose a target playout delay for Cast mirroring. A lower delay will decrease latency, but may impact other quality indicators. – Mac, Windows, Linux, ChromeOS

#cast-mirroring-target-playout-delay

Default (200ms)
getDisplayMedia() confers transient activation.
When getDisplay() is invoked by the application, the user is shown a dialog which allows them to share a tab, a window or a screen. If this flag is enabled, then after the user chooses what to share, transient activation is conferred on the Web application. – Mac, Windows, Linux, ChromeOS

#get-display-media-confers-activation

Default
Toolbar Glow Up
Enables the Toolbar Glow Up feature. – Mac, Windows, Linux, ChromeOS

#toolbar-glow-up

Default
Rounded Icons
Enables rounded icons. – Mac, Windows, Linux, ChromeOS

#rounded-icons

Default
Tab Group Color Refresh
Update the color selection for tab groups. – Mac, Windows, Linux, ChromeOS

#tab-group-color-refresh

Default
Menu Simplification
Enables the menu simplification feature. – Mac, Windows, Linux, ChromeOS

#menu-simplification

Default
WebUI Refresh 2026
Enables the WebUI Refresh 2026 feature. – Mac, Windows, Linux, ChromeOS

#webui-refresh-2026

Default
Enable RenderDocument
Enable swapping RenderFrameHosts on same-site navigations – Mac, Windows, Linux, ChromeOS, Android

#render-document

Default
Default SiteInstanceGroups
Put sites that don't need isolation in their own SiteInstance in a defaultSiteInstanceGroup (per BrowsingContextGroup) instead of in a default SiteInstance. – Mac, Windows, Linux, ChromeOS, Android

#default-site-instance-groups

Default
CWS Info Fast Check
When enabled, Chrome checks and fetches metadata for installed extensions more frequently. – Mac, Windows, Linux, ChromeOS

#cws-info-fast-check

Default
Dynamic Profile Country
When enabled, Chrome updates the country associated with the profile on open – Mac, Windows, Linux, ChromeOS, Android

#rcaps-dynamic-profile-country

Default
Desktop PWA Link Capturing
Enables opening links from Chrome in an installed PWA. Currently under reimplementation. – Mac, Windows, Linux, ChromeOS

#enable-user-navigation-capturing-pwa

Default
Protected Audiences Consented Debug Token
Enables Protected Audience Consented Debugging with the provided token. Protected Audience auctions running on a Bidding and Auction API trusted server with a matching token will be able to log information about the auction to enable debugging. Note that this logging may include information about the user's browsing history normally kept private. – Mac, Windows, Linux, ChromeOS, Android

#protected-audience-debug-token

Disabled
Deprecate the unload event
Controls the default for Permissions-Policy unload. If enabled, unload handlers are deprecated and will not receive the unload event unless a Permissions-Policy to enable them has been explicitly set. If disabled, unload handlers will continue to receive the unload event unless explicitly disabled by Permissions-Policy, even during the gradual rollout of their deprecation. – Mac, Windows, Linux, ChromeOS, Android

#deprecate-unload

Default
Enable risk-based authentication for FPAN retrieval
When enabled, server card retrieval will begin with a risk-based check instead of jumping straight to CVC or biometric auth. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-fpan-risk-based-authentication

Default
Ack CopyOutputRequest early for View Transition
If enabled, send acks for CopyOutputRequest completion immediately to unblock navigation for ViewTransitions while CopyOutputRequests are in progress. This is a fast-path for ViewTransitions. – Mac, Windows, Linux, ChromeOS, Android

#ack-copy-output-request-early-for-view-transition

Default
Device Bound Session Credentials with software keys
Enables mock software-backed cryptographic keys for Google session credentials binding and Chrome refresh tokens binding (not secure). This is intended to be used for manual testing only. – Mac, Windows, Linux

#enable-bound-session-credentials-software-keys-for-manual-testing

Default
Show permission grants from Related Website Sets
Shows permission grants created by Related Website Sets in Chrome Settings UI and Page Info Bubble, default is hidden – Mac, Windows, Linux, ChromeOS, Android

#related-website-sets-permission-grants

Default
Enable Isolated Web Apps to bypass USB restrictions
When enabled, allows Isolated Web Apps to access blocklisted devices and protected interfaces through WebUSB API. – Mac, Windows, Linux, ChromeOS, Android

#enable-unrestricted-usb

Default
Enable 3DS authentication for virtual cards
When enabled, Chrome will trigger 3DS authentication during a virtual card retrieval if a challenge is required, 3DS authentication is available for the card, and FIDO is not. – Mac, Windows, Linux, ChromeOS

#autofill-enable-vcn-3ds-authentication

Default
Send Tab To Self enhanced handoff
Enables an enhanced version of Send Tab To Self that propagates more information, such as form fields and scroll position. – Mac, Windows, Linux, ChromeOS, Android

#send-tab-to-self-enhanced-handoff

Default
Enable data sharing debug logs
Enables the data sharing infrastructure to log and save debug messages that can be shown in the internals page. – Mac, Windows, Linux, ChromeOS, Android

#data-sharing-debug-logs

Disabled
Device Bound Session Credentials (Standard)
Enables the official version of Device Bound Session Credentials. For more information see https://github.com/WICG/dbsc. – Mac, Windows, Linux

#enable-standard-device-bound-session-credentials

Default
Device Bound Session Credentials (Standard) Persistence
Enables session persistence for the official version of Device Bound Session Credentials. – Mac, Windows, Linux

#enable-standard-device-bound-session-persistence

Default
Device Bound Session Credentials (Standard) - Federated Registrations
Enables federated session registration for the official version of Device Bound Session Credentials. – Mac, Windows, Linux

#enable-standard-device-bound-session-credentials-federated-sessions

Default
Device Bound Session Credentials (Standard) DevTools Debugging
Enables DevTools debugging for the official version of Device Bound Session Credentials. – Mac, Windows, Linux

#enable-standard-device-bound-session-devtools-debugging

Default
Device Bound Session Credentials (Standard) on Google
Enables Device Bound Session Credentials (Standard) to register sessions on Google sites – Mac, Windows, Linux

#enable-standard-device-bound-session-google

Default
Experiment ID for Device Bound Session Credentials (Standard) on Google
Sets the experiment ID sent when Device Bound Session Credentials (Standard) registers sessions on Google sites – Mac, Windows, Linux

#enable-standard-device-bound-session-google-experiment-id

Default
Responsive Iframes
Enable responsively-sized iframes. – Mac, Windows, Linux, ChromeOS, Android

#responsive-iframes

Default
Replace all sync-related UI with sign-in ones
When enabled, all sync-related UIs will be replaced by sign-in ones. – Mac, Windows, Linux, ChromeOS

#replace-sync-promos-with-sign-in-promos-desktop

Default
Replace sync promos with sign-in promos (New Sign-in events)
When enabled, all sync-related UIs will be replaced by sign-in ones. Similar to #replace-sync-promos-with-sign-in-promos-desktop but only enables extensions and bookmarks sync on new signin events. – Mac, Windows, Linux, ChromeOS

#replace-sync-promos-with-signin-promos-new-signin

Default
Uno phase 2 follow-up
UI tweaks for signin surfaces – Mac, Windows, Linux, ChromeOS

#uno-phase-2-follow-up

Default
Showing password suggestions on autofocused password forms
Enables showing password suggestions without requiring the user to click on the already focused field if the field was autofocused on the page load. – Mac, Windows, Linux, ChromeOS, Android

#pwm-show-suggestions-on-autofocus

Default
In-flow resolution of errors during password saving
Starts the password manager error resolution flow after offering to save a password. – Mac, Windows, Linux, ChromeOS

#password-save-in-context-error-resolution-on-desktop

Default
Enable optimization guide dogfood logging
If this client is a Google-internal dogfood client, overrides enterprise policy to enable model quality logs. Googlers: See go/chrome-mqls-debug-logging for details. – Mac, Windows, Linux, ChromeOS, Android

#optimization-guide-enable-dogfood-logging

Disabled
Prompt API for Gemini Nano
Enables the exploratory Prompt API, allowing you to send natural language instructions to a built-in large language model (Gemini Nano in Chrome). Exploratory APIs are designed for local prototyping to help discover potential use cases, and may never launch. These explorations will inform the built-in AI roadmap [1]. This API is primarily intended for natural language processing tasks such as summarizing, classifying, or rephrasing text. It is NOT suitable for use cases that require factual accuracy (e.g. answering knowledge questions). You must comply with our Prohibited Use Policy [2] which provides additional details about appropriate use of Generative AI. – Mac, Windows, Linux, ChromeOS

https://goo.gle/chrome-ai-dev-preview
https://policies.google.com/terms/generative-ai/use-policy
#prompt-api-for-gemini-nano

Default
Prompt API for Gemini Nano with Multimodal Input
Extends the exploratory Prompt API with image and audio input types. Allows you to supplement natural language instructions for a built-in large language model (Gemini Nano in Chrome) with image and audio inputs. Exploratory APIs are designed for local prototyping to help discover potential use cases, and may never launch. These explorations will inform the built-in AI roadmap [1]. This API enhancement is primarily intended for natural language processing tasks associated with visual and auditory data, such as generating rough descriptions of pictures and sounds. It is NOT suitable for use cases that require factual accuracy (e.g. answering knowledge questions). You must comply with our Prohibited Use Policy [2] which provides additional details about appropriate use of Generative AI. – Mac, Windows, Linux, ChromeOS

https://goo.gle/chrome-ai-dev-preview
https://policies.google.com/terms/generative-ai/use-policy
#prompt-api-for-gemini-nano-multimodal-input

Default
Writer API for Gemini Nano
Enables the Writer API, allowing you to write a piece of text with a built-in large language model (Gemini Nano in Chrome).The API may be subject to changes including the supported options.Please refer to the built-in AI article [1] for details. You must comply with our Prohibited Use Policy [2] which provides additional details about appropriate use of Generative AI. – Mac, Windows, Linux, ChromeOS

https://goo.gle/chrome-ai-dev-preview
https://policies.google.com/terms/generative-ai/use-policy
#writer-api-for-gemini-nano

Default
Rewriter API for Gemini Nano
Enables the Rewriter API, allowing you to rewrite a piece of text with a built-in large language model (Gemini Nano in Chrome).The API may be subject to changes including the supported options.Please refer to the built-in AI article [1] for details. You must comply with our Prohibited Use Policy [2] which provides additional details about appropriate use of Generative AI. – Mac, Windows, Linux, ChromeOS

https://goo.gle/chrome-ai-dev-preview
https://policies.google.com/terms/generative-ai/use-policy
#rewriter-api-for-gemini-nano

Default
Proofreader API for Gemini Nano
Enables the Proofreader API, allowing you to proofread a piece of textwith a built-in large language model (Gemini Nano in Chrome).The API may be subject to changes including the supported options.Please refer to the built-in AI article [1] for details. You must comply with our Prohibited Use Policy [2] which provides additional details about appropriate use of Generative AI. – Mac, Windows, Linux, ChromeOS

https://goo.gle/chrome-ai-dev-preview
https://policies.google.com/terms/generative-ai/use-policy
#proofreader-api-for-gemini-nano

Default
Classifier API for Tiny Model
Enables the Classifier API, allowing you to classify a piece of text with a built-in tiny model in Chrome. The API may be subject to changes including the supported options. Please refer to the built-in AI article [1] for details. You must comply with our Prohibited Use Policy [2] which provides additional details about appropriate use of Generative AI. – Mac, Windows, Linux, ChromeOS

https://goo.gle/chrome-ai-dev-preview
https://policies.google.com/terms/generative-ai/use-policy
#classifier-api-for-tiny-model

Default
Summarizer API with Performance Preference
Adds the "preference" create option to the Summarizer API. Allows the developer to choose between "capability", "speed", and "auto" to hint at the desired balance between performance and capability. We're rapidly iterating on the training set for the smaller expert model used with the 'speed' preference, and welcome your feedback here: https://issues.chromium.org/issues/new?component=1617227 – Mac, Windows, Linux, ChromeOS

https://chromestatus.com/feature/6309243756085248
#summarizer-api-performance-preference

Default
Summarizer API for Gemini Nano
Enables the Summarizer API, allowing you to summarize a piece of text with a built-in large language model (Gemini Nano in Chrome). The API may be subject to changes including the supported options. Please refer to the built-in AI article [1] for details. You must comply with our Prohibited Use Policy [2] which provides additional details about appropriate use of Generative AI. – Mac, Windows, Linux, ChromeOS

https://goo.gle/chrome-ai-dev-preview
https://policies.google.com/terms/generative-ai/use-policy
#summarizer-api-for-gemini-nano

Default
On-device category classifier
Enables the on-device category classifier. – Mac, Windows, Linux, ChromeOS, Android

#on-device-category-classifier

Default
LiteRT-LM for On-Device AI
Use LiteRT-LM runtime for on-device model service inference. – Mac, Windows, Linux, ChromeOS

#on-device-model-litert-lm-backend

Default
CSS Grid Lanes Layout
Enable experimental CSS Grid Lanes Layout implementation. Simple layouts with grid-lanes are supported. Subgrid and fragmentation are not supported yet. The syntax to use CSS Grid Lanes is `display: grid-lanes` together with grid properties (i.e. `grid-column`, `grid-row`, etc.). More details on grid-lanes syntax can be found at https://www.w3.org/TR/css-grid-3/#masonry-model. – Mac, Windows, Linux, ChromeOS, Android

#css-grid-lanes-layout

Default
Adjust feature reports received with WebHID
Enable/Disable a fix for a bug that caused feature reports to be offset by one byte when received from devices that do not use numbered reports. – Windows

#hid-get-feature-report-fix

Default
Lens AIM M3 Side Panel Suggestions
Enables suggestions in the Lens composebox. This will have an effect only when the Lens search AIM M3 flag is also enabled. – Mac, Windows, Linux, ChromeOS

#lens-aim-suggestions

Default
Lens AIM M3 Side Panel Suggestions Gradient Background
Enables a gradient background for the Lens composebox dropdown that does not cover the entire side panel. – Mac, Windows, Linux, ChromeOS, Android

#lens-aim-gradient-suggest-background

Default
Data Controls drag-and-drop enforcement
Enables Data Controls drag-and-drop enforcement. – Mac, Windows, Linux, ChromeOS, Android

#data-controls-drag-enforcement

Default
Data Controls enforcement for search context menu item
Enables the Enterprise Data Controls for restricting data exfiltration with the "Search with..." context menu item. – Mac, Windows, Linux, ChromeOS, Android

#data-controls-search-with

Default
Data Sharing
Enabled all Data Sharing related UI and features. – Mac, Windows, Linux, ChromeOS, Android

#data-sharing

Default
Collaboration Entreprise V2
Enables the collaboration feature for entreprise users within the same domain. – Mac, Windows, Linux, ChromeOS, Android

#collaboration-entreprise-v2

Default
Shared Tab Group messaging sync
Enable the messaging sync backend for shared tab groups. – Mac, Windows, Linux, ChromeOS, Android

#collaboration-shared-tab-group-account-data

Default
Data Sharing Join Only
Enabled Data Sharing Joining flow related UI and features. – Mac, Windows, Linux, ChromeOS, Android

#data-sharing-join-only

Default
Data Sharing server environment
Sets data sharing server environment. – Mac, Windows, Linux, ChromeOS, Android

#data-sharing-non-production-environment

Default
Data Sharing Versioning Test Scenarios
Testing multiple scenarios for versioning. – Mac, Windows, Linux, ChromeOS, Android

#shared-data-types-kill-switch

Default
Enable JavaScript live editing in DevTools
Re-enable the deprecated feature in DevTools' Sources panel to apply code edits to the target page live. – Mac, Windows, Linux, ChromeOS, Android

#devtools-live-edit

Default
PermissionsAIv4
Use the Permission Predictions Service and the AIv4 model to surface permission notification requests using a quieter UI when the likelihood of the user granting the permission is predicted to be low. Requires `Make Searches and Browsing Better` to be enabled. – Mac, Windows, Linux, ChromeOS, Android

#permissions-ai-v4

Default
PermissionsAIP92
Use the Permission Predictions Service and with P92 adjustments to surface permission notification requests using a quieter UI when the likelihood of the user granting the permission is predicted to be low. Requires `Make Searches and Browsing Better` to be enabled. – Mac, Windows, Linux, ChromeOS, Android

#permissions-ai-p92

Default
Permissions Gesture Gated Prompts
Mute non-user-initiated permission requests. – Mac, Windows, Linux, ChromeOS, Android

#permissions-gesture-gated-prompts

Default
Lens Side Panel Unification
Unifies the Lens and Contextual Tasks side panels into a single panel. – Mac, Windows, Linux, ChromeOS

#enable-lens-side-panel-unification

Default
Enable buy now pay later on Autofill
When enabled, users will have the option to pay with buy now pay later on specific merchant webpages. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-buy-now-pay-later

Default
Enable syncing buy now pay later user data.
When enabled, Chrome will sync user data related to buy now pay later. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-buy-now-pay-later-syncing

Default
Enable CVC storage and filling standalone form enhancement for payments autofill
When enabled, this will enhance the CVV storage project. The enhancement will enable CVV storage suggestions for standalone CVC fields. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-cvc-storage-and-filling-standalone-form-enhancement

Default
Translation API streaming split by sentence
Enables sentence-split streaming for on-device translation API. – Mac, Windows, Linux, ChromeOS

#translation-api-streaming-by-sentence

Default
Grouped affiliation password suggestions
Enables offering credentials coming from grouped domains for filling – Mac, Windows, Linux, ChromeOS, Android

#password-form-grouped-affiliations

Default
Contextual cueing
Enables the contextual cueing system to support showing actions. – Mac, Windows, Linux, ChromeOS, Android

#contextual-cueing

Default
Contextual cueing V2
Enables the contextual cueing system version 2. – Mac, Windows, Linux, ChromeOS, Android

#contextual-cueing-v2

Default
PartitionAlloc with Advanced Checks
Enables an extra security layer on PartitionAlloc. – Mac, Windows, Linux, ChromeOS, Android

#partition-alloc-with-advanced-checks

Default
Partition the Visited Link Database, including 'self-links'
Style links as visited only if they have been clicked from this top-level site and frame origin before. Additionally, style links pointing to the same URL as the page it is displayed on, which have been :visited from any top-level site and frame origin, if they are displayed in a top-level frame or same-origin subframe. – Mac, Windows, Linux, ChromeOS, Android

#partition-visited-link-database-with-self-links

Default
Predictable Reported Quota
Enables reporting of a predictable quota from the StorageManager's estimate API. This flag is intended only for validating if this change caused an unforeseen bug. – Mac, Windows, Linux, ChromeOS, Android

#predictable-reported-quota

Default
BookmarkBarPrefetch
If enabled, bookmarkbar can trigger prefetch – Mac, Windows, Linux, ChromeOS

#prefetch-bookmarkbar-trigger

Default
NewTabPagePrefetch
If enabled, NewTabPage can trigger prefetch – Mac, Windows, Linux, ChromeOS

#prefetch-new-tab-page-trigger

Default
Glic
Enables glic – Mac, Windows, Linux, ChromeOS

#glic

Default
Glic actor
Enables the Glic actor. – Mac, Windows, Linux, ChromeOS

#glic-actor

Default
Glic experimental triggering
Enables GLIC experimental triggering – Mac, Windows, Linux, ChromeOS

#glic-experimental-triggering

Default
Glic actor autofill
Enables autofill actions for the Glic actor. Specific fillable types may also need to be enabled. – Mac, Windows, Linux, ChromeOS

#glic-actor-autofill

Default
Glic actor cursor
Enables the Glic actor cursor – Mac, Windows, Linux, ChromeOS

#glic-actor-cursor

Default
Glic actor script tools
Enables script tools for the Glic actor. – Mac, Windows, Linux, ChromeOS

#glic-actor-script-tools

Default
Glic actor transient tasks
Support for transient tasks in actor. If enabled, all tasks will use the transient actor UI. – Mac, Windows, Linux, ChromeOS

#glic-actor-transient-tasks

Default
Glic actor skip screenshots
If enabled, Glic actor will skip capturing and uploading screenshots when an actor turn is completed. – Mac, Windows, Linux, ChromeOS

#glic-actor-skip-screenshot

Default
Glic detached-only mode
Detach only mode forces the Glic UI to always be floating – Mac, Windows, Linux, ChromeOS

#glic-detached

Default
Glic Tab Restoration
Enables Glic instance restore when tabs are restored. – Mac, Windows, Linux, ChromeOS

#glic-tab-restoration

Default
Glic Print Menu Item
Enables showing the Glic print contextual menu item. – Mac, Windows, Linux

#glic-print-menu-item

Default
Glic Pre-Warming
Enables the pre-warming of the Glic panel's web client. – Mac, Windows, Linux, ChromeOS

#glic-pre-warming

Default
Glic contextual cue bubble
Show glic contextual cues in a bubble UI. – Mac, Windows, Linux, ChromeOS

#glic-contextual-cue-bubble

Default
Glic Default To Last Active Conversation
Enables the last active conversation as the default conversation when opening a new Glic side panel instance. – Mac, Windows, Linux, ChromeOS

#glic-default-to-last-active-conversation

Default
Glic Bind a Shared Tab If Unbound
When a tab is shared with conversation and not yet bound to any conversation, bind it to the current one – Mac, Windows, Linux, ChromeOS

#glic-bind-pinned-unbound-tab

Default
Glic Button Alt Label
Enables an alternative label for the Glic button. – Mac, Windows, Linux, ChromeOS

#glic-button-alt-label

Default
Glic Button Auto Summarize
Automatically triggers a summary when the Glic button is clicked on a certain page (ex. PDF). – Mac, Windows, Linux, ChromeOS

#glic-button-auto-summarize

Default
Glic Button Pressed State
Enables visual changes to the Glic entry button when Glic is open. – Mac, Windows, Linux, ChromeOS

#glic-button-pressed-state

Default
Glic Capture Region
Enables Glic to capture a region of the screen. – Mac, Windows, Linux, ChromeOS

#glic-capture-region

Default
Glic Client Zoom Control
Enables the use of Chrome zoom keyboard controls in the Glic UI. – Mac, Windows, Linux, ChromeOS

#glic-client-zoom-control

Default
Glic Daisy chain new tabs
Daisy chains new tabs if the active tab when the new tab was create has an open glic side panel – Mac, Windows, Linux, ChromeOS

#glic-daisy-chain-new-tabs

Default
Glic Use Toolbar Height Side Panel
Enables Glic to use the toolbar height side panel instead of content height side panel when enabled to use side panel – Mac, Windows, Linux, ChromeOS

#glic-toolbar-height-side-panel

Default
Glic Live Mode Only Glow
The Gemini glow around the web contents will only appear when in live mode, rather than being always on the current page. – Mac, Windows, Linux, ChromeOS

#glic-live-mode-only-glow

Default
Glic Multi-Instance Tab Context Menu
Enables the Glic context menu for the tabs in the tabstrip. – Mac, Windows, Linux, ChromeOS

#glic-mi-tab-context-menu

Default
Glic Share Image
Enables the Create Image with Gemini context menu item – Mac, Windows, Linux, ChromeOS

#glic-share-image

Default
Glic Default Tab Context Setting
Controls whether tab context is enabled by default within new Glic sessions. Required for Side Panel. – Mac, Windows, Linux, ChromeOS

#glic-default-tab-context-setting

Default
Glic guest URL presets
Overrides the Bluebird environment URL used for Glic with user-configured values. Intended for manual testing only. – Mac, Windows, Linux, ChromeOS

#glic-guest-url-presets

Default
Glic Selection Prompt
Enables the Glic prompt suggestion when text is selected. – Mac, Windows, Linux, ChromeOS

#glic-selection-prompt

Default
Glic disable actor safety checks
Disables actor safety checks in Glic. Use with extreme caution, intended for testing only. – Mac, Windows, Linux, ChromeOS

#glic-disable-actor-safety-checks

Disabled
Enable toolbar Gemini button on horizontal tab strip
Enables the toolbar Gemini button when the horizontal tab strip is enabled, and disables the tab strip Gemini button. – Mac, Windows, Linux, ChromeOS

#glic-horizontal-tab-toolbar-button

Default
Glic Toolbar Button Location
Specifies the location of the toolbar Gemini button. – Mac, Windows, Linux, ChromeOS

#glic-toolbar-button-location

Default
Glic Contextual Cueing v2 Auto Submit
Enable automatically submitting a suggested prompt when the v2 contextual cue UI for Glic is clicked. – Mac, Windows, Linux, ChromeOS

#glic-contextual-cueing-v2-auto-submit

Default
Skills
Enables Skills in Gemini in Chrome – Mac, Windows, Linux, ChromeOS

#skills

Default
Enable Save and Fill
When enabled, show an option to offer saving and filling a credit card with a single click when users don't have any cards saved in Autofill. – Mac, Windows, Linux, ChromeOS

#autofill-enable-save-and-fill

Default
Happy Eyeballs Version 3
Enables the Happy Eyeballs Version 3 algorithm. See https://datatracker.ietf.org/doc/draft-pauly-v6ops-happy-eyeballs-v3/ – Mac, Windows, Linux, ChromeOS, Android

#happy-eyeballs-v3

Default
Enable OAuthMultilogin Cookies Binding
Enables binding of cookies returned from OAuthMultilogin to cryptographic keys. – Mac, Windows, Linux

#enable-oauth-multilogin-cookies-binding

Default
Enable OAuthMultilogin Cookies Binding Server Experiment
When enabled, Chrome will send will send a specific URL parameter to Gaia to trigger the server-side experiment for binding the OAuthMultilogin cookies to cryptographic keys. This flag is meant to be used in conjunction with the 'Enable OAuthMultilogin Cookies Binding' flag. – Mac, Windows, Linux

#enable-oauth-multilogin-cookies-binding-server-experiment

Default
Three Button Password Save Dialog
Provides a 'not now' button alongside the 'never' button on the save password dialog. – Mac, Windows, Linux, ChromeOS

#three-button-password-save-dialog

Default
throttle-main-thread-to-60hz
Throttle main thread updates to 60fps, even when VSync rate is higher. – Mac, Windows, Linux, ChromeOS, Android

#throttle-main-thread-to-60hz

Default
System tracing
When enabled, the system tracing service is started along with Chrome's tracing service (if the system tracing service is registered). – Windows

#windows-system-tracing

Default
Enable checkout amount extraction.
When enabled, Chrome will extract the checkout amount from the checkout page of the allowlisted merchant websites. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-amount-extraction

Default
AXTree Fixing
When enabled, allows Chrome to dynamically fix the AXTree of sites. This is experimental and may cause breaking changes to users of assistive technology. – Mac, Windows, Linux, ChromeOS

#enable-ax-tree-fixing

Default
DevTools Project Settings
If enabled, DevTools will try to fetch project settings in the form of a `com.chrome.devtools.json` file from a well-known URI on local debugging targets. – Mac, Windows, Linux, ChromeOS

#devtools-project-settings

Default
Drop input events while paint-holding is active
Drop input events at the browser process until the process receives the first signal that the renderer has sent a frame to GPU. This prevents accidental interaction with a page the user has not seen yet. – Mac, Windows, Linux, ChromeOS, Android

#drop-input-events-while-paint-holding

Default
Default Browser Changed OS Notification
Enables the framework to show OS Notification when Chrome is no longer the default browser. – Mac, Windows, Linux, ChromeOS

#default-browser-changed-os-notification

Default
Default Browser Framework
Enables the default browser framework. – Mac, Windows, Linux, ChromeOS

#default-browser-framework

Default
Default Browser Prompt Surfaces
Enables using various default browser prompt surfaces. – Mac, Windows, Linux, ChromeOS

#default-browser-prompt-surfaces

Default
Chrome Web Store navigation throttle
When enabled, passes DM Token to the Chrome Web Store. – Mac, Windows, Linux

#chrome-web-store-navigation-throttle

Default
Align PDF default print settings with HTML
Align the default print settings for PDFs with those for HTML, including scaling and centering. – Mac, Windows, Linux, ChromeOS, Android

#align-pdf-default-print-settings-with-html

Default
Enable URL filter interstitial V3
Enables URL filter interstitial V3 for Family Link users. – Mac, Windows, Linux, ChromeOS, Android

#supervised-user-block-interstitial-v3

Default
Emit device log record separately
Emits one log record per each supervision type, instead of a single combined value. No user-visible effect on other platforms than Android. – Mac, Windows, Linux, ChromeOS, Android

#supervised-user-emit-log-record-separately

Default
Merge device parental controls and Family Link prefs
Merges non-web filtering device parental controls settings with Family Link settings in the SupervisedUserPrefStore. No user-visible effect on other platforms than Android. – Mac, Windows, Linux, ChromeOS, Android

#supervised-user-merge-device-parental-controls-and-family-link-prefs

Default
Use URL filtering service
Use the SupervisedUserUrlFilteringService to get URL filtering settings directly from supervision services instead of using PrefService. No user-visible effect on other platforms than Android. – Mac, Windows, Linux, ChromeOS, Android

#supervised-user-use-url-filtering-service

Default
Enable amount extraction testing
Enables testing of the result of checkout amount extraction. This flag will allow amount extraction to run on any website when a CC form is clicked. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-amount-extraction-testing

Default
Make scrollbar follow theme
If enabled makes the root scrollbar follow the browser's theme color. – Windows, Linux

#root-scrollbar-follows-browser-theme

Default
Local Network Access Checks
Enables Local Network Access checks. See: https://chromestatus.com/feature/5152728072060928 – Mac, Windows, Linux, ChromeOS, Android

#local-network-access-check

Default
Local Network Access Checks for WebRTC
Enable Local Network Access checks for WebRTC. Requires the #local-network-access-check flag to also be enabled See: https://chromestatus.com/feature/5065884686876672 – Mac, Windows, Linux, ChromeOS, Android

#local-network-access-check-webrtc

Default
Local Network Access Checks for WebSockets
Enable Local Network Access checks for WebSockets. Requires the #local-network-access-check flag to also be enabled See: https://chromestatus.com/feature/5197681148428288 – Mac, Windows, Linux, ChromeOS, Android

#local-network-access-check-websockets

Default
Local Network Access Checks for WebTransport
Enable Local Network Access checks for WebTransport. Requires the #local-network-access-check flag to also be enabled See: https://chromestatus.com/feature/5126430912544768 – Mac, Windows, Linux, ChromeOS, Android

#local-network-access-check-webtransport

Default
Navigation links in the tab-sharing bar
Enables quick-navigation links to the captured and capturing tab in the tab-sharing bar. – Mac, Windows, Linux, ChromeOS

#tab-capture-infobar-links

Default
Bundled Security Settings
Enables new Bundled Security Settings UI on chrome://settings/security. This new UI bundles all security settings into either an enhanced or standard bundle which should simplify the security settings page and also help simplify the user's decision. – Mac, Windows, Linux, ChromeOS

#bundled-security-settings

Default
Enable immediate mediation for WebAuthn get requests
Enables immediate mediation for WebAuthn and passwords for a navigator.credentials.get() request. This will return a NotAllowedError if there are no credentials for a given get request. The request can also request passwords. – Mac, Windows, Linux, ChromeOS, Android

#web-authentication-immediate-get

Default
Open Dragged Links in the Same Tab
Allows users to drag a single link to a tab to open in that tab. – Mac, Windows, Linux, ChromeOS

#open-dragged-links-same-tab

Default
Discount Autofill
Enable discount autofill experiment. – Mac, Windows, Linux, ChromeOS

#discount-autofill

Default
UI Automation
Enables native support of the UI Automation provider. – Windows

#ui-automation-provider

Default
Change scrolling scheduling to reduce checkerboarding
If enabled, scrolling that would generate blank frames will now prioritize the new content over scrolling with the intention of decreasing the amount of checkerboarded frames. – Mac, Windows, Linux, ChromeOS, Android

#new-content-for-checkerboarded-scrolls

Default
Enable launching Chrome on Windows startup
When enabled, Launch Chrome on Startup can be turned on from Settings – Windows

#startup-launch

Default
Page actions migration
Enables a new internal framework for driving page actions behavior. – Mac, Windows, Linux, ChromeOS

#page-actions-migration

Default
Disable the Autofill strike system
When enabled, the Autofill strike system will not block a feature from being offered. – Mac, Windows, Linux, ChromeOS, Android

#disable-autofill-strike-system

Default
Web App Install Element
Enables the <install> HTML element which allows web apps to be installed declaratively. – Mac, Windows, Linux, ChromeOS

#web-app-install-element

Default
Web App Installation API
Enables the Web App Installation API which allows web apps to be installed programmatically using navigator.install(). – Mac, Windows, Linux, ChromeOS

#web-app-installation-api

Default
Web App Migration API
Enables the API for same-site web app migrations. – Mac, Windows, Linux, ChromeOS

#web-app-migration-api

Default
Enable buy now pay later on Autofill for Klarna
When enabled, users will have the option to pay with buy now pay later with Klarna on specific merchant webpages. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-buy-now-pay-later-for-klarna

Default
Customize tab group color palette
Enables parsing of the `tab_group_color_palette` key in the manifest.json file, which allows customization of the tab group color palette. Disabling this flag will cause the key to be ignored. – Mac, Windows, Linux, ChromeOS

#customize-tab-group-color-palette

Default
Enable showing in-product help UI for downstream card awareness
When enabled, in-product help UI will be shown the first time a card added outside of Chrome appears in Autofill card suggestions. – Mac, Windows, Linux, ChromeOS

#autofill-enable-downstream-card-awareness-iph

Default
Enable new tab page browser feature suggestions
Shows suggestions to explore browser capabilities (eg. signing in) on the new tab page. – Mac, Windows, Linux, ChromeOS

#enable-ntp-browser-promos

Default
Extensibility API support for deep-links within DevTools
Extends console.timestamp to support adding deep-links into the DevTools Performance Panel, which (when clicked) call into a DevTools extension – Mac, Windows, Linux, ChromeOS

#enable-devtools-deep-link-via-extensibility-api

Default
Enable buy now pay later for externally linked BNPL issuer
When enabled, users will have the option to pay with buy now pay later with externally linked issuer on specific merchant webpages. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-buy-now-pay-later-for-externally-linked

Default
Safety Hub - unused permission revocation from all surfaces
Enables autorevoking of unused permissions granted from all UI surfaces. – Mac, Windows, Linux, ChromeOS, Android

#safety-hub-unused-permission-revocation-for-all-surfaces

Default
Bookmark and tab group conversion
Enable conversion between bookmark and tab group – Mac, Windows, Linux, ChromeOS

#bookmark-tab-group-conversion

Default
Default search engine prewarm
Performance optimization to prewarm the default search engine used in the Omnibox – Mac, Windows, Linux, ChromeOS

#default-search-engine-prewarm

Default
Apply clientside model predictions for password forms.
Enable using clientside model predictions to fill password forms. – Mac, Windows, Linux, ChromeOS, Android

#apply-clientside-model-predictions-for-password-types

Default
HTML-in-Canvas
Enables the Canvas 2D drawElement API and the WebGL texElement2D API for drawing HTML content into a canvas. See: https://github.com/WICG/html-in-canvas – Mac, Windows, Linux, ChromeOS, Android

#canvas-draw-element

Default
Lens overlay force empty CSB query
Forces Lens overlay to issue an empty CSB query on invocation. – Mac, Windows, Linux, ChromeOS

#enable-lens-overlay-force-empty-csb-query

Default
Browsing History Actor Integration M3
Enables the browsing history glic actor integration M3. Requires browsing-history-actor-integration-M2 to be enabled as well. – Mac, Windows, Linux, ChromeOS

#browsing-history-actor-integration-M3

Default
Browsing History Grouping Improvements
Enables improvements to grouping of similar browsing history on the history page. – Mac, Windows, Linux, ChromeOS

#browsing-history-similar-visits-grouping

Default
Add new tabs to active tab group.
If enabled, and there is a tab group is focused, then new tabs will be added to the focused tab group. – Mac, Windows, Linux, ChromeOS

#new-tab-adds-to-active-group

Default
Support for name and email addresses in Autofill
When enabled, a name and email profile with data comming from the account will be created for autofilling. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-support-for-name-and-email-profile

Default
Force iOS Promo Type
Force the iOS promo to be a specific type (QRCode or Reminder) for testing purposes. – Mac, Windows, Linux, ChromeOS, Android

#mobile-promo-on-desktop-force-promo-type

Default
Mobile Promo On Desktop - QRCode
When enabled, shows a mobile promo with a QR code on desktop for eligible users. – Mac, Windows, Linux, ChromeOS, Android

#mobile-promo-on-desktop-with-qr-code

Default
Mobile Promo On Desktop - Reminder
When enabled, shows a mobile promo with a reminder flow on desktop for eligible users. – Mac, Windows, Linux, ChromeOS, Android

#mobile-promo-on-desktop-with-reminder

Default
Reintroduce hybrid passkey entry point
Reintroduces the hybrid passkey entry point to the Autofill dropdown menu. – Mac, Windows, Linux, ChromeOS

#reintroduce-hybrid-passkey-entry-point

Default
Make options menus to include more tab group actions
Add options to menus to facilitate tab group creation and interaction – Mac, Windows, Linux, ChromeOS

#tab-group-more-entry-points

Default
Tab group header hover cards
Enables hover cards for tab group headers in the tab strip. – Mac, Windows, Linux, ChromeOS

#tab-group-hover-cards

Default
Enable SecurityInfo in WebRequest API for ControlledFrame
Enables SecurityInfo in WebRequest API for ControlledFrames, allowing listeners to retrieve certificate details of web requests. – Mac, Windows, Linux, ChromeOS

#controlled-frame-web-request-security-info

Default
Source-Specific Multicast in Direct Sockets API
Enables Source-Specific Multicast support in Direct Sockets API. See https://github.com/WICG/direct-sockets/blob/main/docs/multicast-explainer.md for details. – Mac, Windows, Linux, ChromeOS

#source-specific-multicast-in-direct-sockets

Default
Enable Cross-Device Pref Tracker
Enables the tracking and sharing of select non-syncing preference values across a user's signed-in devices. – Mac, Windows, Linux, ChromeOS, Android

#enable-cross-device-pref-tracker

Default
Use D3D12 video encoder
Enables D3D12 video encoding. The system might still fall back to Media Foundation video encoder if D3D12 encoder is not available or fails to initialize. – Windows

#enable-d3d12-video-encoder

Default
Contextual suggestions UI improvements
Enables UI improvements for contextual suggestions (e.g. icon and animation). – Mac, Windows, Linux, ChromeOS

#contextual-suggestion-ui-improvements

Default
Verify QWACs
Enables verification of qualified certificates for website authentication as described in ETSI TS 119 411-5 V2.1.1 (2025-02). – Mac, Windows, Linux, ChromeOS, Android

#verify-qwacs

Default
Prefer blocklists instead of allowlists for Payments Autofill Buy Now Pay Later (BNPL)
When enabled, Payments Autofill Buy Now Pay Later (BNPL) will use each corresponding issuer's blocklist instead of allowlist to check for website eligibility. – Mac, Windows, Linux, ChromeOS, Android

#autofill-prefer-buy-now-pay-later-blocklists

Default
Enable AI-based checkout amount extraction on Chrome
When enabled, Chrome will extract the checkout amount from the checkout page using server-side AI. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-ai-based-amount-extraction

Default
Contextual Tasks
Enable the contextual tasks feature. – Mac, Windows, Linux, ChromeOS

#contextual-tasks

Default
Omnibox debug logs
Enables logging that can be read from an internals page. – Mac, Windows, Linux, ChromeOS

#omnibox-debug-logs

Default
Contextual Tasks Context
Enables relevant context determination for contextual tasks. – Mac, Windows, Linux, ChromeOS

#contextual-tasks-context

Default
Contextual Tasks Suggestions Enabled
Enables suggestions for contextual tasks. – Mac, Windows, Linux, ChromeOS

#contextual-tasks-suggestions-enabled

Default
Contextual Tasks Context Library
Enables integration with the server side context library. – Mac, Windows, Linux, ChromeOS

#contextual-tasks-context-library

Default
Contextual Tasks Back Button Expands Side Panel
Enables expanding the side panel on back navigations. – Mac, Windows, Linux, ChromeOS

#contextual-tasks-back-button-expands-side-panel

Default
Contextual Tasks Cookie Prefetch
Enables prefetching of cookies for contextual tasks. – Mac, Windows, Linux, ChromeOS, Android

#contextual-tasks-cookie-prefetch

Default
Create new tab group menu option at the top level of the app menu
In the app menu, add an option to create a new tab group at the top level – Mac, Windows, Linux, ChromeOS

#create-new-tab-group-app-menu-top-level

Default
Enable issuer names in the second line of a BNPL suggestion
When enabled, the second line of a BNPL suggestion is updated to include the issuer names for better brand recognition. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-buy-now-pay-later-updated-suggestion-second-line-string

Default
Cryptography Compliance (CNSA)
If enabled, Chrome will configure its preferred algorithms for TLS to prefer algorithms that satisfy the requirements of the Commercial National Security Algorithm Suite (CNSA) versions 1.0 and 2.0. Enabling this flag does not guarantee that any specific algorithms will be negotiated. This flag is not required for security. – Mac, Windows, Linux, ChromeOS, Android

#cryptography-compliance-cnsa

Default
Lens search reinvocation affordance
Enables the Lens button in the AIM Searchbox for reinvocation of selection overlay. – Mac, Windows, Linux, ChromeOS

#lens-reinvocation-affordance

Default
Lens updated feedback entrypoint
Enables an updated feedback entry point in the Lens side panel. – Mac, Windows, Linux, ChromeOS

#lens-updated-feedback-entrypoint

Default
Lens video citations
Enables special handling for video citations in Lens. – Mac, Windows, Linux, ChromeOS

#lens-video-citations

Default
Prioritize save card bubble over mandatory re-auth
When enabled, this flag prioritizes showing the save card bubble over the mandatory re-auth bubble when both are applicable. – Mac, Windows, Android

#autofill-prioritize-save-card-over-mandatory-reauth

Default
Variations seed corpus
The value of the 'corpus' parameter in the variations seed request. If unspecified, the 'corpus' parameter is omitted from the request. – Mac, Windows, Linux, ChromeOS, Android

#variations-seed-corpus

Disabled
Passkey Unlock Manager
Enables the Passkey Unlock Manager, which tracks the state of passkeys and publishes the corresponding metrics. – Mac, Windows, Linux, ChromeOS

#passkey-unlock-manager

Default
Passkey Unlock Error UI
Enables showing the passkey unlock error UI to passkey users in case when their access to passkeys is “locked” and when they have an available user verification mechanism (either a system UV or a GPM PIN). This flag requires the flag `PasskeyUnlockManager` to be active. – Mac, Windows, Linux, ChromeOS

#passkey-unlock-error-ui

Default
Mdm error handling for dasher accounts
Enables the mdm error handling feature for dasher accounts – Mac, Windows, Linux, ChromeOS, Android

#mdm-errors-for-dasher-accounts-handling

Default
Disable U18 Feedback Desktop
Disables the feedback for U18 users on desktop platforms. – Mac, Windows, Linux

#disable-u18-feedback-desktop

Default
Enable CTA experiment for sign-in level up
As part of the Sign In Level Up experiment, changes the decline sign in CTA string in profile creation entry points – Mac, Windows, Linux

#profile-creation-decline-signin-cta-experiment

Default
Search Settings Update
Enables refactoring of the search settings pages in chrome://settings/search – Mac, Windows, Linux, ChromeOS

#search-settings-update

Default
Show profile picker to all users
As part of the Growth experiments, show the profile picker to users who only have one profile – Mac, Windows, Linux

#show-profile-picker-to-all-users-experiment

Default
Profile Signals Reporting Enabled
Enables the profile signals reporting flow for Chrome Enterprise. – Mac, Windows, Linux, ChromeOS, Android

#profile-signals-reporting-enabled

Default
Projects Panel
Enables the Projects Panel. – Mac, Windows, Linux, ChromeOS

#projects-panel

Default
Sync AI Threads
Acquire AI Threads via sync. – Mac, Windows, Linux, ChromeOS

#sync-ai-threads

Default
Sync Gemini Threads
Acquire Gemini Threads via sync. – Mac, Windows, Linux, ChromeOS

#sync-gemini-threads

Default
Enable UnexportableKeyService mojo service in the browser process.
When enabled, the browser process will create an Unexportable Key Service which can be used by other, less privileged processes. This enables DBSC in platforms where access to TPM-like features is privileged. – Mac, Windows, Linux

#use-unexportable-key-service-in-browser-process

Default
Profile Picker Text Variations
As part of the Profile experiments, enables variations of the profile picker text. – Mac, Windows, Linux

#profile-picker-text-variations

Default
Lens Overlay optimization filter
Enables using the optimization filter for triggering the action chip. – Mac, Windows, Linux, ChromeOS

#lens-overlay-optimization-filter

Default
Migrate preinstalled Chat app
When enabled, the preinstalled Chat web app will be migrated from its old URL to a new URL. This migration only applies to users who have not manually installed the Chat app. – Mac, Windows, Linux, ChromeOS

#web-app-migrate-preinstalled-chat

Default
Web App install dialog
Enables the new web app install dialog. – Mac, Windows, Linux, ChromeOS

#web-app-install-dialog

Default
Connection Allowlists
Enables a prototype implementation of `Connection-Allowlist` header parsing and enforcement. See https://github.com/mikewest/anti-exfil/ – Mac, Windows, Linux, ChromeOS, Android

#connection-allowlists

Default
Reading Mode Experimental Webpage Distilation
Enables the experimental text webpage distillation using readability.js method for reading mode. – Mac, Windows, Linux, ChromeOS

#read-anything-with-readability-enabled

Default
Reading Mode Omnibox Chip
Enables the omnibox chip entry point for Reading mode – Mac, Windows, Linux, ChromeOS

#read-anything-omnibox-chip

Default
Disable the country check for BNPL testing
Enables testing BNPL in countries where it would otherwise be disabled. – Mac, Windows, Linux, ChromeOS, Android

#autofill-disable-bnpl-country-check-for-testing

Default
Infobar Prioritization
Shows the infobars by priority starting by critical ones by respecting a given caps. – Mac, Windows, Linux, ChromeOS

#infobar-prioritization

Default
Infobar Refresh
Renders infobars with a refreshed UI. – Mac, Windows, Linux, ChromeOS

#infobar-refresh

Default
Reading Mode Experimental Immersive Mode
Enables the infrastructure for Immersive Reading Mode. – Mac, Windows, Linux, ChromeOS

#read-anything-immersive-reading-mode

Default
Lens overlay non-blocking privacy notice
Enables non-blocking privacy notice in the Lens overlay. – Mac, Windows, Linux, ChromeOS

#lens-overlay-non-blocking-privacy-notice

Default
Lens overlay non-blocking privacy notice for image search
Enables non-blocking privacy notice in the Lens overlay when invoked from the image context menu. – Mac, Windows, Linux, ChromeOS

#lens-overlay-non-blocking-privacy-notice-for-image-search

Default
Migrate syncing user to signed in state
When enabled, a syncing user is migrated to the signed in non-syncing state on the next browser startup. – Mac, Windows, Linux

#migrate-syncing-user-to-signed-in

Default
Undo the migration of syncing users to signed-in state
When enabled, reverts the migration of syncing users who were previously migrated to the signed-in, non-syncing state. – Mac, Windows, Linux

#undo-migration-of-syncing-user-to-signed-in

Default
DOM Storage SQLite Backend
Uses a SQLite-powered backing store for local and session storage. No data is migrated from existing backing stores, including LevelDB stores or SQLite stores with older schemas; use at your own peril. – Mac, Windows, Linux, ChromeOS, Android

#dom-storage-sqlite

Default
IDB SQLite Backing Store
Uses a SQLite-powered backing store for IndexedDB. No data is migrated from existing backing stores, including LevelDB stores or SQLite stores with older schemas; use at your own peril. – Mac, Windows, Linux, ChromeOS, Android

#idb-sqlite-backing-store

Default
Overscroll effect on non-root scrollers
Enables elastic overscroll effect on scrollers other than the root document (e.g. iframes and overflow areas). – Mac, Windows, Android

#overscroll-effect-on-non-root-scrollers

Default
Enable Chrome Web Store Promotion Banner
Enables showing the promotion banner on chromewebstore page. – Mac, Windows, Linux, ChromeOS

#cws-promotion-banner-flag

Default
Update Google Pay branding to Wallet where applicable
When enabled, certain strings and logos referencing Google Account, Google Payments, and Google Pay will instead reference Google Wallet. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-wallet-branding

Default
Arabic-Indic Digit Input
Enable/Disable Arabic-Indic digit input while holding right alt or ctrl+alt on Arabic 101 keyboard layout. – Windows

#enable-arabic-indic-digit-input

Default
Enable ignore AI-based Amount Extraction Terms Acknowledgement
When enabled, the BNPL flow acts as if the user has not yet seen or the AI terms. This allows the AI terms to be shown repeatedly for testing purposes, regardless of the actual stored user preference. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-based-amount-extraction-ignore-seen-terms-for-testing

Default
Autofill AI always trigger server model
Queries the server model for every form encountered, ignoring server-side instructions. Intended for testing only. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-always-trigger-server-model

Default
Autofill AI available by default
Makes Autofill AI available by default, with the enable toggle controlling online model runs and logging. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-available-by-default

Default
Autofill AI create entity data manager
Ensures the EntityDataManager for Autofill AI is created regardless of other feature states. Useful for data cleanup. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-create-entity-data-manager

Default
Autofill AI dedupe entities
Enables periodic deduplication of Autofill AI entities. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-dedupe-entities

Default
Autofill AI no filling icons experiment
If enabled, Autofill AI filling suggestions do not have an icon. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-no-filling-icons-experiment

Default
Autofill AI re-authentication required
Requires re-authentication when filling or viewing sensitive fields with Autofill AI. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-reauth-required

Default
Autofill AI server model
Allows the client to trigger the server model for Autofill AI type predictions. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-server-model

Default
IPH Autofill AI Valuables
Enables the In-Product Help for Autofill AI valuables. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-valuables-iph

Default
Autofill AI Google Wallet flight reservations
Enables Autofill AI support for flight reservation entities from Google Wallet. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-wallet-flight-reservation

Default
Autofill AI Google Wallet private passes
Enables Autofill AI support for private passes from Google Wallet. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-wallet-private-passes

Default
Autofill AI Google Wallet private passes deep link
Enables Autofill AI support for deep linking to private passes from Google Wallet. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-wallet-private-passes-deep-link

Default
Autofill AI Google Wallet vehicle registration
Enables Autofill AI support for vehicle registration entities from Google Wallet. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-wallet-vehicle-registration

Default
Autofill AI with data schema
Enables the second iteration of Autofill AI, which uses a more advanced data schema. – Mac, Windows, Linux, ChromeOS, Android

#autofill-ai-with-data-schema

Default
Reading Mode Line Focus
Enables the experimental line focus mode for Reading mode. – Mac, Windows, Linux, ChromeOS

#read-anything-line-focus

Default
Verify MTCs
Enables verification of Merkle Tree Certificates as described in https://datatracker.ietf.org/doc/draft-davidben-tls-merkle-tree-certs/. Requires #tls-trust-anchor-ids. – Mac, Windows, Linux, ChromeOS, Android

#verify-mtcs

Default
Password Upload UI Update
Adds new entry points for uploading passwords to account storage and updates existing ones. – Mac, Windows, Linux

#password-upload-ui-update

Default
Saas Usage Reporting
Enable reporting of SaaS usage. This feature only takes effect if a related enterprise policy is also configured by an administrator. – Mac, Windows, Linux

#saas-usage-reporting

Default
Enable Pay Now Pay Later tabs UI for payments autofill on Chrome
When enabled, Chrome will use the Pay Now Pay Later tabs UI for payments autofill when buy now pay later options are available for the merchant webpage. – Mac, Windows, Linux, ChromeOS

#autofill-enable-pay-now-pay-later-tabs

Default
Enable Ambient sign-in for WebAuthn get requests
Enables ambient sign-in for passkeys and passwords from a navigator.credentials.get() request. This is similar to conditional UI with the main difference being it does not use autofill UI. – Mac, Windows, Linux, ChromeOS

#web-authentication-ambient-signin

Default
Enable protocol monitor in DevTools
Enables the protocol monitor panel, which displays the Chrome DevTools Protocol (CDP) traffic between DevTools and the browser. – Mac, Windows, Linux, ChromeOS, Android

#devtools-protocol-monitor

Default
WebMCP support in DevTools
Enables WebMCP support in DevTools. – Mac, Windows, Linux, ChromeOS, Android

#devtools-webmcp-support

Default
Bundled Security Settings Secure Dns V2
Enables Secure DNS V2 setting in the bundles on the chrome://settings/security page. The setting will move from the advanced section to the bundled section. – Mac, Windows, Linux, ChromeOS

#bundled-security-settings-secure-dns-v2

Default
Stop resending LaunchParams on user reload
Disables the Launch Queue re-sending LaunchParams on reloads. – Mac, Windows, Linux, ChromeOS, Android

#launch-queue-stop-sending-on-reload

Default
Credential Management Unified UI
Enables the Unified UI for the credential management password APIs. – Mac, Windows, Linux, ChromeOS

#credential-management-unified-ui

Default
Use explicit-choice dialog confirming new search engine overrides
When enabled, web searches with a newly-installed search engine-overriding extension will be deferred until a new explicit-choice dialog confirms the change is intentional. – Mac, Windows

#search-engine-explicit-choice-dialog

Default
Always show confirmation dialog for new search engine overrides
When enabled, all newly-installed search engine-overriding extensions encounter the confirmation dialog (exceptions for some extensions are removed). – Mac, Windows

#search-engine-unconditional-dialog

Default
WebMCP for testing
Enables the WebMCP API and its associated testing interfaces. – Mac, Windows, Linux, ChromeOS, Android

#enable-webmcp-testing

Default
Enable new American Express network art
When enabled, updates the American Express network art in Autofill. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-new-amex-network-art

Default
Chrome Finds Internals
Enables the chrome://chrome-finds-internals page. – Mac, Windows, Linux, ChromeOS, Android

#chrome-finds-internals

Default
Preserve HTTP message bodies across navigations for DevTools
Enables a durable message storing mechanism, which allows preserving HTTP message bodies for debugging. – Mac, Windows, Linux, ChromeOS, Android

#devtools-enable-durable-messages

Default
Unthrottle async touch moves
When enabled, touch move events to javascript handlers are unthrottled if they are sent as async to Renderer. – Mac, Windows, Linux, ChromeOS, Android

#unthrottle-async-touch-moves

Default
Horizontal Tab Strip Combo Button
Enables the combo button in the horizontal tab strip. – Mac, Windows, Linux, ChromeOS

#horizontal-tab-strip-combo-button

Default
Mobile NTP Promo on Desktop
Enables the Mobile NTP Promo on Desktop. – Mac, Windows, Linux, ChromeOS

#mobile-ntp-promo-on-desktop

Default
Sign in promo on avatar pill
Feature that shows a Sign in promo on the avatar pill at startup – Mac, Windows, Linux

#signin-promo-on-avatar-pill

Default
Mobile Promo On Desktop - QR Code (Wave 1)
When enabled, shows a mobile promo with a QR code on desktop for eligible users. This version highlights features not included in the existing Mobile promos. – Mac, Windows, Linux, ChromeOS, Android

#mobile-promo-on-desktop-with-qr-code-wave-1

Default
Mobile Promo On Desktop - Reminder (Wave 1)
When enabled, shows a mobile promo with a reminder flow on desktop for eligible users. This version highlights features not included in the existing mobile promos. – Mac, Windows, Linux, ChromeOS, Android

#mobile-promo-on-desktop-with-reminder-wave-1

Default
Enable Omnibox Autofill chip for payments
When enabled, an Autofill payments omnibox chip will appear for relevant payment checkout forms. – Mac, Windows, Linux, ChromeOS

#autofill-enable-omnibox-autofill

Default
Further update Google Pay and Google Wallet branding where applicable
When enabled, further brings certain strings and images referencing Google Pay and Google Wallet into consistency with branding requirements. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-wallet-branding-v2

Default
WebCrypto PQC
Enables Post-Quantum Cryptography (PQC) algorithms (ML-DSA and ML-KEM) and ChaCha20-Poly1305 in WebCrypto. – Mac, Windows, Linux, ChromeOS, Android

#webcrypto-pqc

Default
Defer OS Clipboard Read Call To GetType
Defers Async Clipboard Read API data retrieval from the OS until ClipboardItem.getType() is called, instead of eagerly fetching all formats at read() time. – Mac, Windows, Linux, ChromeOS, Android

#defer-os-clipboard-read-call-to-get-type

Default
Import and export flags
Enables importing and exporting flags from chrome://flags. – Mac, Windows, Linux, ChromeOS, Android

#import-export-flags

Default
Use PersistentCache for Code Cache
Use PersistentCache backend for code cache for JavaScript and WebAssembly. – Mac, Windows, Linux, ChromeOS, Android

#use-persistent-cache-for-code-cache

Default
Inline Script Cache
Enables caching of inline scripts. This flag only works if #use-persistent-cache-for-code-cache is enabled. – Mac, Windows, Linux, ChromeOS, Android

#inline-script-cache

Default
Migrate Enhanced Safe Browsing User to Enhanced Bundle
Enables the migration of enhanced Safe Browsing users to the enhanced bundle. Requires chrome://flags#bundled-security-settings to be enabled. – Mac, Windows, Linux, ChromeOS

#migrate-enhanced-sb-user-to-enhanced-bundle

Default
Bookmarks Encryption
Enable encryption for bookmarks – Mac, Windows, Linux, ChromeOS, Android

#bookmarks-encryption

Default
Require a week between offers to save credit cards
When enabled, users should not see offers to save the same credit card twice in a week, as the strike database enforces a 7-day delay between strikes. – Mac, Windows, Linux, ChromeOS, Android

#autofill-upstream-enforce-strike-delay

Default
Enable Extensions Menu Teardown Fix
Enables a fix that defers extensions menu closure when an action is triggered from the menu. – Mac, Windows, Linux, ChromeOS, Android

#enable-extensions-menu-teardown-fix

Default
Tabs from other devices side panel
Enables the tabs from other devices side panel. – Mac, Windows, Linux, ChromeOS, Android

#tabs-from-other-devices-side-panel

Default
UserMediaElement
Enables the <usermedia> element, allowing sites to embed a camera/microphone permission request directly in the page. – Mac, Windows, Linux, Android

#user-media-element

Default
Reading Mode Select Text with Readability
Enables the select text feature for readability distillation – Mac, Windows, Linux, ChromeOS

#read-anything-readability-select-text

Default
Energy Effect
Enables the Energy Effect for the Realbox. – Mac, Windows, Linux, ChromeOS

#energy-effect

Default
Energy Effect Animation
Enables animations for the Energy Effect for the Realbox. – Mac, Windows, Linux, ChromeOS

#energy-effect-animation

Default
Ask-Before-HTTP in Bundled Security Settings
Includes Ask-Before-HTTP (HTTPS-First Mode) in the Enhanced security bundle. – Mac, Windows, Linux, ChromeOS

#bundled-security-settings-ask-before-http

Default
Enable travel category and merchant benefits from Curinos
When enabled, travel category and merchant benefits sourced from Curinos will be shown in Autofill. – Mac, Windows, Linux, ChromeOS, Android

#autofill-enable-travel-category-and-merchant-benefits-from-curinos

Default
Cancel file uploads on content analysis
Allows users to cancel file uploads while content analysis is in progress. – Mac, Windows, Linux, ChromeOS, Android

#enable-cancel-upload-on-content-analysis

Default
Reject Payment Request in small windows
Reject Payment Request and Payment Handler dialogs if the browser window is too small to contain them. – Mac, Windows, Linux, ChromeOS, Android

#payment-request-reject-too-small-windows



Unavailable
WebRTC hardware video decoding
Support in WebRTC for decoding video streams using platform hardware. – ChromeOS, Android

#webrtc-hw-decoding
Not available on your platform.
WebRTC hardware video encoding
Support in WebRTC for encoding video streams using platform hardware. – ChromeOS, Android

#webrtc-hw-encoding
Not available on your platform.
Web Bluetooth
Enables the Web Bluetooth API on platforms without official support – Linux

#enable-web-bluetooth
Not available on your platform.
Vulkan
Use vulkan as the graphics backend. – Linux, Android

#enable-vulkan
Not available on your platform.
Force enable WebGPU interop
Force enable the WebGPU on vulkan via GL compositing interop. – Linux

#force-enable-webgpu-interop
Not available on your platform.
Default ANGLE Vulkan
Use the Vulkan backend for ANGLE by default. – Linux, Android

#default-angle-vulkan
Not available on your platform.
Vulkan from ANGLE
Initialize Vulkan from inside ANGLE and share the instance with Chrome. – Linux, Android

#vulkan-from-angle
Not available on your platform.
Enables optimization guide on device on Android
Enables the optimization guide to execute models on device on Android. – Android

#optimization-guide-on-device-model-android
Not available on your platform.
Omnibox: Recent Searches on new tab page ZPS
Controls presence/volume of Recent Searches shown in zero-prefix context on the New Tab Page – Android

#omnibox-num-ntp-zps-recent-searches
Not available on your platform.
Omnibox: Trending Searches on new tab page ZPS
Controls presence/volume of Trending Searches shown in zero-prefix context on the New Tab Page – Android

#omnibox-num-ntp-zps-trending-searches
Not available on your platform.
Omnibox: Recent Searches on the web ZPS
Controls presence/volume of Recent Searches shown in zero-prefix context on the Web – Android

#omnibox-num-web-zps-recent-searches
Not available on your platform.
Omnibox: Related Searches on the web ZPS
Controls presence/volume of Related Searches shown in zero-prefix context on the Web – Android

#omnibox-num-web-zps-related-searches
Not available on your platform.
Omnibox: Most Visited URLs on the web ZPS
Controls presence/volume of Most Visited URLs shown in zero-prefix context on the Web – Android

#omnibox-num-web-zps-most-visited-urls
Not available on your platform.
Omnibox: Recent Searches on the SRP ZPS
Controls presence/volume of Recent Searches shown in zero-prefix context on the Search Results Page – Android

#omnibox-num-srp-zps-recent-searches
Not available on your platform.
Omnibox: Related Searches on the SRP ZPS
Controls presence/volume of Related Searches shown in zero-prefix context on the Search Results Page – Android

#omnibox-num-srp-zps-related-searches
Not available on your platform.
Enables annotated page content extraction
Enables annotated page content to be extracted – Android

#annotated-page-content-extraction
Not available on your platform.
Page content cache
Enables caching of the annotated page content and screenshot – Android

#page-content-cache
Not available on your platform.
Notification scheduler
Enable notification scheduler feature. – Android

#notification-scheduler
Not available on your platform.
Double buffered compositing
Use double buffer for compositing (instead of triple-buffering). Latency should be reduced in some cases. On the other hand, more skipped frames are expected. – ChromeOS

#double-buffer-compositing
Not available on your platform.
Enable Perfetto system tracing
When enabled, Chrome will attempt to connect to the system tracing service – Linux, Android

#enable-perfetto-system-tracing
Not available on your platform.
Glass Frame
Enables a glass effect on the browser frame. – Mac

#glass-frame
Not available on your platform.
Device Bound Session Credentials
Enables Google session credentials binding to cryptographic keys. – Mac, Linux

#enable-bound-session-credentials
Not available on your platform.
Glic Android Side Panel
Enables the Glic side panel on Android. – Android

#glic-android-side-panel
Not available on your platform.
Glic Chrome Status Icon
Use the Chrome logo as glic OS status bar icon on Mac. – Mac

#glic-chrome-status-icon
Not available on your platform.
Glic OS Status Icon Variant
Select the variant of the Glic OS status bar icon on Mac. – Mac

#glic-os-icon-variant
Not available on your platform.
Chrome Refresh Token Binding
Enables binding of Chrome refresh tokens to cryptographic keys. – Mac, Linux

#enable-chrome-refresh-token-binding
Not available on your platform.