import { WebContents, WebFrameMain } from 'electron'

const isDisposedFrameError = (error: any) => {
  try {
    return String(error?.message || error).includes(
      'Render frame was disposed before WebFrameMain could be accessed',
    )
  } catch {
    return false
  }
}

const isFrameUnavailable = (frame: WebFrameMain | undefined) => {
  if (!frame) return true
  try {
    return frame.isDestroyed() || frame.detached
  } catch {
    return true
  }
}

/**
 * Sends to a live frame without surfacing the expected navigation /
 * teardown race. Electron's public WebFrameMain.send() logs before swallowing
 * every native send error, so use its synchronous native entry point when
 * available and preserve logging only for unexpected failures.
 */
export const sendToLiveFrame = (
  frame: WebFrameMain | undefined,
  channel: string,
  ...args: any[]
): boolean => {
  if (!frame || isFrameUnavailable(frame)) return false

  const nativeSend = (frame as any)._send
  if (typeof nativeSend !== 'function') {
    frame.send(channel, ...args)
    return true
  }

  try {
    nativeSend.call(frame, false, channel, args)
    return true
  } catch (error) {
    if (isFrameUnavailable(frame) || isDisposedFrameError(error)) return false
    console.error('Error sending from webFrameMain: ', error)
    return false
  }
}

export const sendToLiveMainFrame = (
  host: WebContents,
  channel: string,
  ...args: any[]
): boolean => {
  if (host.isDestroyed()) return false

  try {
    return sendToLiveFrame(host.mainFrame, channel, ...args)
  } catch {
    return false
  }
}
