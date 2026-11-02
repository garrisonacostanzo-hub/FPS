// Small flat SVG art used by the menus.

/** Small flat portrait for an operator outfit (the 3D preview shows the real model). */
export function outfitArt(o) {
  const l = o.look;
  const head = { helmet: '<path d="M22 20 Q32 6 42 20 Z" fill="#7d8a99"/>', cap: '<rect x="22" y="12" width="20" height="8" rx="3" fill="#7d8a99"/><rect x="18" y="18" width="14" height="3" fill="#7d8a99"/>',
    beret: '<ellipse cx="33" cy="15" rx="12" ry="5" fill="#7d8a99"/>', boonie: '<rect x="23" y="11" width="18" height="8" fill="#7d8a99"/><rect x="15" y="18" width="34" height="3" fill="#7d8a99"/>',
    hood: '<path d="M19 30 Q19 8 32 8 Q45 8 45 30 Z" fill="#7d8a99"/>' }[l.head] || '';
  return `<svg class="m-outfit" viewBox="0 0 64 64">
    <rect x="18" y="34" width="28" height="30" rx="5" fill="#5d6b79"/>
    <rect x="22" y="38" width="20" height="16" rx="3" fill="${l.vest}"/>
    ${l.pads ? `<rect x="12" y="34" width="10" height="6" rx="2" fill="${l.pads}"/><rect x="42" y="34" width="10" height="6" rx="2" fill="${l.pads}"/>` : ''}
    <circle cx="32" cy="23" r="9" fill="${l.mask || '#8a6a55'}"/>
    ${head}
    <rect x="25" y="${l.bigVisor ? 19 : 21}" width="14" height="${l.bigVisor ? 6 : 3}" rx="1.5" fill="${l.shades ? '#0c0c0e' : l.visor}"/>
    ${l.skull ? '<rect x="27" y="26" width="10" height="4" fill="#e6e2d8"/>' : ''}
    ${l.trim ? `<rect x="22" y="38" width="20" height="2" fill="${l.trim}"/>` : ''}
  </svg>`;
}
