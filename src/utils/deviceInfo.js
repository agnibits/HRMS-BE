import { sha256 } from './password.js';

/**
 * Derives a stable device descriptor from the request for session/device
 * tracking. A lightweight UA parse avoids adding a dependency; the fingerprint
 * is a hash of UA + accept-language which is stable per browser/device.
 */
export function extractDeviceInfo(req) {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ip = req.ip || req.socket?.remoteAddress || null;
  const acceptLang = req.headers['accept-language'] || '';

  const { platform, browser } = parseUserAgent(userAgent);

  return {
    userAgent,
    ip,
    platform,
    browser,
    name: req.body?.deviceName || `${browser} on ${platform}`,
    fingerprint: sha256(`${userAgent}|${acceptLang}`),
  };
}

function parseUserAgent(ua) {
  const platform =
    /windows/i.test(ua) ? 'Windows'
    : /android/i.test(ua) ? 'Android'
    : /iphone|ipad|ios/i.test(ua) ? 'iOS'
    : /mac os/i.test(ua) ? 'macOS'
    : /linux/i.test(ua) ? 'Linux'
    : 'Unknown';
  const browser =
    /edg/i.test(ua) ? 'Edge'
    : /chrome/i.test(ua) ? 'Chrome'
    : /firefox/i.test(ua) ? 'Firefox'
    : /safari/i.test(ua) ? 'Safari'
    : 'Unknown';
  return { platform, browser };
}

export default extractDeviceInfo;
