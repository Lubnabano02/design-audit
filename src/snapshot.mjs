/**
 * Collects a style snapshot from a live page.
 *
 * The function below is stringified and evaluated inside the browser, so it
 * must not reference anything from this module's scope.
 */

export const collectStyles = () => {
  const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'slider', 'textbox']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'NOSCRIPT', 'TITLE', 'SVG', 'PATH']);

  /**
   * A short, readable path — enough to find the element again by eye.
   * Siblings of the same tag get an :nth-of-type, otherwise several distinct
   * elements describe identically and the report looks like it is repeating itself.
   */
  const describe = el => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`${part}#${node.id}`); break; }

      const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');

      const parent = node.parentElement;
      if (parent) {
        const twins = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
      }

      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };

  const isTransparent = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\s*\)$/.test(c);

  /** Walk up until something actually paints a background. Contrast depends on this. */
  const effectiveBackground = el => {
    let node = el;
    while (node && node.nodeType === 1) {
      const bg = getComputedStyle(node).backgroundColor;
      if (!isTransparent(bg)) return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };

  /** Only the text this element owns, not its descendants'. */
  const ownText = el => Array.from(el.childNodes)
    .filter(n => n.nodeType === 3)
    .map(n => n.textContent.trim())
    .join(' ')
    .trim();

  const px = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const out = [];

  for (const el of document.querySelectorAll('*')) {
    if (SKIP.has(el.tagName)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;

    const role = el.getAttribute('role') || '';
    const interactive = INTERACTIVE_TAGS.has(el.tagName)
      || INTERACTIVE_ROLES.has(role)
      || el.hasAttribute('onclick')
      || el.tabIndex >= 0;

    const text = ownText(el) || (el.tagName === 'INPUT' ? (el.getAttribute('placeholder') || '') : '');

    out.push({
      selector: describe(el),
      tag: el.tagName.toLowerCase(),
      role: role || null,
      text: text || null,
      interactive,
      // Document-absolute, so markers line up on a full-page screenshot
      // regardless of where the page happened to be scrolled.
      rect: { x: +(rect.x + window.scrollX).toFixed(1), y: +(rect.y + window.scrollY).toFixed(1),
              width: +rect.width.toFixed(1), height: +rect.height.toFixed(1) },
      styles: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        effectiveBackground: effectiveBackground(el),
        borderColor: px(cs.borderTopWidth) > 0 ? cs.borderTopColor : null,
        fontFamily: cs.fontFamily,
        fontSize: px(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        paddingTop: px(cs.paddingTop), paddingRight: px(cs.paddingRight),
        paddingBottom: px(cs.paddingBottom), paddingLeft: px(cs.paddingLeft),
        marginTop: px(cs.marginTop), marginRight: px(cs.marginRight),
        marginBottom: px(cs.marginBottom), marginLeft: px(cs.marginLeft),
      },
    });
  }
  return out;
};
