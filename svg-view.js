// Keep live SVG elements connected so CSS/Web Animations retain their timelines.
// Repeated shapes use explicit keys; unique shapes can use their tag and class.
export function syncSvgChildren(parent, children) {
  const keyed = elements => {
    const counts = new Map();
    return Array.from(elements, element => {
      const explicit = element.getAttribute("data-view-key") ?? element.getAttribute("id");
      const base = `${element.localName}:${explicit ?? element.getAttribute("class") ?? ""}`;
      const ordinal = counts.get(base) ?? 0;
      counts.set(base, ordinal + 1);
      return [`${base}:${ordinal}`, element];
    });
  };
  const desired = keyed(children), wanted = new Set(desired.map(([key]) => key));
  const existing = new Map(keyed(parent.children));
  // Remove obsolete siblings first: otherwise a stale cursor would needlessly
  // move every surviving element after a disappearing hover/impact overlay.
  for (const [key, element] of existing) if (!wanted.has(key)) {
    element.remove(); existing.delete(key);
  }
  let cursor = parent.firstElementChild;
  for (const [key, next] of desired) {
    const current = existing.get(key);
    const element = current ?? next;
    if (current) {
      existing.delete(key);
      for (const attribute of Array.from(current.attributes)) {
        // Stone effects set their transform origin at runtime, outside markup.
        if (attribute.name !== "style" && !next.hasAttributeNS(attribute.namespaceURI, attribute.localName)) {
          current.removeAttributeNS(attribute.namespaceURI, attribute.localName);
        }
      }
      for (const attribute of next.attributes) {
        if (current.getAttributeNS(attribute.namespaceURI, attribute.localName) !== attribute.value) {
          current.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        }
      }
      if (next.children.length || current.children.length) syncSvgChildren(current, next.children);
      else if (current.textContent !== next.textContent) current.textContent = next.textContent;
    }
    if (element !== cursor) parent.insertBefore(element, cursor);
    cursor = element.nextElementSibling;
  }
  for (const element of existing.values()) element.remove();
}
