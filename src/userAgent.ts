/** Best-effort detection of in-app browsers (Instagram, WhatsApp, ...), which often block the camera. Never a guarantee. */
export function inAppBrowserName(ua: string = navigator.userAgent): string | null {
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'Facebook'
  if (/WhatsApp/i.test(ua)) return 'WhatsApp'
  if (/musical_ly|BytedanceWebview|TikTok|\btrill_/i.test(ua)) return 'TikTok'
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn'
  if (/Snapchat/i.test(ua)) return 'Snapchat'
  if (/\bLine\//.test(ua)) return 'LINE'
  if (/\bTwitter(Android)?\b/i.test(ua)) return 'X'
  if (/\bGSA\//.test(ua) && /iPhone|iPad|iPod/.test(ua)) return 'Google'
  return null
}

export function isIOS(ua: string = navigator.userAgent): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)
}

export function isAndroid(ua: string = navigator.userAgent): boolean {
  return /Android/i.test(ua)
}

export const isPhone = () => isIOS() || isAndroid()

/** The browser to suggest for camera access on this device. */
export const recommendedBrowser = () => (isIOS() ? 'Safari' : 'Chrome')
