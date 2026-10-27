export function logBookmarkHoverDebug(...args: any[]) {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_BOOKMARK_HOVER === '1'
  ) {
    console.log('[bookmark-hover-debug]', ...args);
  }
}
