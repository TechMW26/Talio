'use strict';

function resolveAppNavigationUrl(appOrigin, fallbackUrl, candidateUrl) {
  try {
    if (candidateUrl && new URL(candidateUrl).origin === appOrigin) {
      return candidateUrl;
    }
  } catch (error) {
    // Fall back to the configured application URL.
  }

  return fallbackUrl;
}

function inspectRendererHealth() {
  var body = document.body;
  if (!body) {
    return { isBlank: true, reason: 'no-body' };
  }

  var root = document.getElementById('__next') || document.getElementById('root');
  var isLoading = body.querySelector(
    '.loader, .loading, [class*="spinner"], [role="progressbar"], [role="status"]'
  ) !== null;

  function isVisible(element) {
    var style = window.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity || '1') <= 0.01
    ) {
      return false;
    }

    var rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  var candidates = body.querySelectorAll(
    'main, header, nav, aside, section, button, a, input, textarea, video, canvas, img, h1, h2, h3, p, [role]'
  );
  var visibleElementCount = 0;

  for (var index = 0; index < candidates.length; index++) {
    if (isVisible(candidates[index])) {
      visibleElementCount++;
      break;
    }
  }

  var rootHasContent = Boolean(root && root.innerHTML.trim().length > 50);
  var rootIsVisible = Boolean(root && isVisible(root));
  var isBlank = !isLoading && visibleElementCount === 0 && (!rootHasContent || !rootIsVisible);

  return {
    isBlank: isBlank,
    reason: isBlank ? 'no-visible-ui' : null,
    hasRoot: Boolean(root),
    rootHasContent: rootHasContent,
    rootIsVisible: rootIsVisible,
    visibleElementCount: visibleElementCount,
    isLoading: isLoading
  };
}

module.exports = {
  inspectRendererHealth,
  resolveAppNavigationUrl
};
