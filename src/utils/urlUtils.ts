/**
 * URL Utilities for Connexa
 * Provides robust URL normalization, extraction, domain parsing,
 * and reliable cross-platform external link opening (handling iframes, PWAs, and WebViews).
 */

/**
 * Strips trailing punctuation often caught by regex in conversational text
 */
export function cleanTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]>"']+$/, '');
}

/**
 * Ensures URL starts with https:// or http:// and has clean formatting
 */
export function normalizeUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  let url = cleanTrailingPunctuation(rawUrl.trim());
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url;
}

/**
 * Extracts a readable domain/hostname from a URL (e.g. "youtube.com")
 */
export function getDomainFromUrl(rawUrl: string): string {
  if (!rawUrl) return 'Web Link';
  try {
    const normalized = normalizeUrl(rawUrl);
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    const clean = rawUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    return clean || 'Web Link';
  }
}

/**
 * Regex for matching URLs: https?://, www., or domain names with common TLDs
 */
export const URL_REGEX = /(?:(?:https?:\/\/|www\.)[^\s<>()]+|(?:\b[a-zA-Z0-9-]+\.(?:com|org|net|io|co|app|dev|edu|gov|me|ai|info|tv|in|uk|de|ca|xyz|be)(?:\/[^\s<>()]*)?))(?:\([^\s<>()]+\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’])/gi;

/**
 * Extracts all valid URLs from a block of text
 */
export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return Array.from(new Set(matches.map(m => normalizeUrl(m)).filter(Boolean)));
}

/**
 * Safely opens a link in a new browser tab/window.
 * Prevents event bubbling so that clicking a link never triggers parent container
 * click handlers (like message selection, user avatars, or chat navigation).
 * 
 * NOTE: When called from an <a> tag, do NOT preventDefault so that native browser
 * navigation takes priority and is never blocked by popup blockers or iframe sandboxes.
 */
export function openUrlInBrowser(rawUrl: string, e?: { preventDefault?: () => void; stopPropagation?: () => void } | Event): void {
  if (e) {
    if (typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
  }

  const url = normalizeUrl(rawUrl);
  if (!url) return;

  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win) {
      win.focus?.();
      return;
    }
  } catch (err) {
    console.warn('window.open blocked or failed, attempting simulated click:', err);
  }

  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 200);
  } catch (err) {
    console.warn('Error opening link in new tab:', err);
  }
}
