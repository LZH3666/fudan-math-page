// Treat whitespace-only parent pages as empty while preserving any visible
// text or non-text content detected in the embedded reader.
export function hasVisibleReaderContent(text, hasVisibleMedia = false) {
 const normalized = String(text ?? '').replace(/[\s\u00a0\u200b\u2060\ufeff]+/gu, '');
 return normalized.length > 0 || hasVisibleMedia === true;
}

export function shouldAutoCollapseReaderSidebar(isReadParent, hasVisibleContent, isCourseHome = false) {
 return isReadParent === true && (isCourseHome === true || hasVisibleContent === false);
}
