// Procedural textures: surface albedo + matching normal maps (from a height field) for the map, and the 50 weapon
// camos. Everything is drawn on canvases at runtime, so the game needs no image files.
import * as THREE from 'three';
import { camoById } from '../../shared/cosmetics.js';

export function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Normal map from a canvas, using the luminance as height (Sobel filter). */
export function normalMapFrom(source, strength = 2) {
  const size = source.width;
  const src = source.getContext('2d').getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) h[i] = (src[i * 4] * 0.3 + src[i * 4 + 1] * 0.59 + src[i * 4 + 2] * 0.11) / 255;
  const out = canvas(size);
  const g = out.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function finish(c, srgb = true, anisotropy = 8) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------------------------------------------
function noise(g, size, r, count, alpha, minS, maxS) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * alpha})` : `rgba(255,255,255,${r() * alpha * 0.8})`;
    const s = minS + r() * (maxS - minS);
    g.fillRect(r() * size, r() * size, s, s);
  }
}

function blotches(g, size, r, count, color, alpha, minR, maxR) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = minR + r() * (maxR - minR);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, color.replace('A', alpha.toFixed(3)));
    grad.addColorStop(1, color.replace('A', '0'));
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/**
 * Albedo + height canvases for a surface kind. Returns { map, normalMap, roughness }.
 */
const surfaceCache = new Map();

export function surfaceTextures(kind, color, size = 256) {
  const key = `${kind}:${color}:${size}`;
  if (!surfaceCache.has(key)) surfaceCache.set(key, drawSurface(kind, color, size));
  const t = surfaceCache.get(key);
  // Fresh texture objects (sharing the drawn canvases) so each user can set its own repeat.
  const map = t.map.clone(), normalMap = t.normalMap.clone();
  map.needsUpdate = true; normalMap.needsUpdate = true;
  return { map, normalMap, roughness: t.roughness };
}

function drawSurface(kind, color, size) {
  const a = canvas(size), h = canvas(size);
  const g = a.getContext('2d'), gh = h.getContext('2d');
  const r = rng(kind.length * 977 + size);
  g.fillStyle = color; g.fillRect(0, 0, size, size);
  gh.fillStyle = '#808080'; gh.fillRect(0, 0, size, size);
  const both = (fn) => { fn(g, true); fn(gh, false); };
  const line = (ctx, x0, y0, x1, y1, w, style) => { ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  let roughness = 0.88, normalStrength = 2.2;

  // Large soft variation + fine grain on everything.
  blotches(g, size, r, 18, 'rgba(0,0,0,A)', 0.12, size * 0.1, size * 0.35);
  blotches(g, size, r, 12, 'rgba(255,255,255,A)', 0.06, size * 0.08, size * 0.3);
  noise(g, size, r, size * 6, 0.09, 1, 3);
  noise(gh, size, rng(31), size * 8, 0.25, 1, 2);

  switch (kind) {
    case 'brick': case 'wall': {
      const rows = 10, bh = size / rows;
      for (let y = 0; y < rows; y++) {
        const off = (y % 2) * size / 8;
        for (let x = -1; x < 5; x++) {
          const bx = off + x * size / 4;
          const tint = (r() - 0.5) * 0.12;
          g.fillStyle = tint > 0 ? `rgba(255,255,255,${tint})` : `rgba(0,0,0,${-tint})`;
          g.fillRect(bx + 2, y * bh + 2, size / 4 - 4, bh - 4);
          gh.fillStyle = '#a0a0a0'; gh.fillRect(bx + 2, y * bh + 2, size / 4 - 4, bh - 4);
        }
        both((ctx, col) => line(ctx, 0, y * bh, size, y * bh, 4, col ? 'rgba(40,30,25,0.55)' : '#303030'));
        for (let x = 0; x < 5; x++) both((ctx, col) => line(ctx, off + x * size / 4, y * bh, off + x * size / 4, (y + 1) * bh, 4, col ? 'rgba(40,30,25,0.55)' : '#303030'));
      }
      break;
    }
    case 'crate': {
      for (let i = 0; i < 6; i++) {
        const y = (i * size) / 6;
        both((ctx, col) => line(ctx, 0, y, size, y, 3, col ? 'rgba(30,18,8,0.5)' : '#404040'));
      }
      noise(g, size, r, 300, 0.15, 6, 30);
      both((ctx, col) => { ctx.strokeStyle = col ? 'rgba(25,15,6,0.6)' : '#202020'; ctx.lineWidth = 16; ctx.strokeRect(8, 8, size - 16, size - 16); });
      both((ctx, col) => line(ctx, 8, 8, size - 8, size - 8, 14, col ? 'rgba(25,15,6,0.45)' : '#2a2a2a'));
      break;
    }
    case 'container': {
      roughness = 0.6;
      for (let x = 0; x < size; x += 16) {
        both((ctx, col) => line(ctx, x, 0, x, size, 7, col ? (x % 32 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.28)') : (x % 32 ? '#b0b0b0' : '#505050')));
      }
      blotches(g, size, r, 10, 'rgba(120,60,20,A)', 0.25, 6, 28); // rust
      break;
    }
    case 'metal': {
      roughness = 0.5; normalStrength = 1.4;
      for (let y = 0; y < size; y += 2) both((ctx, col) => line(ctx, 0, y, size, y, 1, col ? `rgba(255,255,255,${r() * 0.05})` : `rgba(${128 + r() * 30 | 0},128,128,1)`));
      for (let i = 0; i < 4; i++) both((ctx, col) => { ctx.fillStyle = col ? 'rgba(0,0,0,0.35)' : '#404040'; ctx.beginPath(); ctx.arc(16 + i * size / 4, 16, 4, 0, 7); ctx.fill(); });
      break;
    }
    case 'concrete': case 'floor': case 'boundary': {
      const cells = kind === 'floor' ? 4 : 2;
      for (let i = 0; i <= cells; i++) {
        both((ctx, col) => line(ctx, 0, (i * size) / cells, size, (i * size) / cells, 3, col ? 'rgba(0,0,0,0.3)' : '#404040'));
        both((ctx, col) => line(ctx, (i * size) / cells, 0, (i * size) / cells, size, 3, col ? 'rgba(0,0,0,0.3)' : '#404040'));
      }
      for (let i = 0; i < 6; i++) { // cracks
        let x = r() * size, y = r() * size;
        for (let k = 0; k < 8; k++) {
          const nx = x + (r() - 0.5) * 30, ny = y + (r() - 0.5) * 30;
          both((ctx, col) => line(ctx, x, y, nx, ny, 1.5, col ? 'rgba(0,0,0,0.35)' : '#505050'));
          x = nx; y = ny;
        }
      }
      break;
    }
    case 'sand': {
      for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
        both((ctx, col) => {
          ctx.fillStyle = col ? 'rgba(0,0,0,0.10)' : '#a8a8a8';
          ctx.beginPath(); ctx.ellipse((x + 0.5 + (y % 2) * 0.5) * size / 4, (y + 0.5) * size / 5, size / 9, size / 13, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = col ? 'rgba(0,0,0,0.25)' : '#505050'; ctx.lineWidth = 3; ctx.stroke();
        });
      }
      break;
    }
    case 'rock': {
      normalStrength = 3.5;
      blotches(gh, size, r, 40, 'rgba(255,255,255,A)', 0.5, 8, 40);
      blotches(gh, size, r, 30, 'rgba(0,0,0,A)', 0.4, 6, 30);
      noise(g, size, r, 600, 0.2, 2, 8);
      break;
    }
    case 'stairs': {
      for (let y = 0; y < size; y += 32) both((ctx, col) => line(ctx, 0, y, size, y, 6, col ? 'rgba(0,0,0,0.35)' : '#303030'));
      break;
    }
    case 'grass': {
      roughness = 0.95; normalStrength = 3;
      for (let i = 0; i < size * 14; i++) {
        const x = r() * size, y = r() * size, len = 2 + r() * 6;
        const shade = r();
        g.strokeStyle = shade < 0.5 ? `rgba(20,40,10,${0.25 + r() * 0.3})` : `rgba(140,180,80,${0.15 + r() * 0.25})`;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - len); g.stroke();
        gh.strokeStyle = `rgba(255,255,255,${0.2 + r() * 0.4})`;
        gh.beginPath(); gh.moveTo(x, y); gh.lineTo(x + (r() - 0.5) * 3, y - len); gh.stroke();
      }
      blotches(g, size, r, 14, 'rgba(90,70,40,A)', 0.3, 10, 40); // dirt patches
      break;
    }
    case 'dirt': {
      normalStrength = 2.6;
      noise(g, size, r, size * 10, 0.18, 1, 4);
      blotches(gh, size, r, 60, 'rgba(255,255,255,A)', 0.4, 2, 10);
      break;
    }
    case 'asphalt': {
      roughness = 0.92;
      noise(g, size, r, size * 20, 0.2, 1, 2);
      noise(gh, size, r, size * 20, 0.6, 1, 2);
      break;
    }
    default:
      break;
  }
  return { map: finish(a), normalMap: normalMapFrom(h, normalStrength), roughness };
}

// ---------------------------------------------------------------------------------------------------------------
// Weapon camos
// ---------------------------------------------------------------------------------------------------------------
const camoCache = new Map();

function drawCamo(c, def, size) {
  const g = c.getContext('2d');
  const [c0, c1 = c0, c2 = c1, c3 = c2] = def.colors;
  const r = rng(def.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  g.fillStyle = c0; g.fillRect(0, 0, size, size);
  const blob = (color, count, min, max, squash = 1) => {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = r() * size, y = r() * size, rad = min + r() * (max - min);
      g.beginPath();
      const pts = 9;
      for (let k = 0; k <= pts; k++) {
        const a = (k / pts) * Math.PI * 2, rr = rad * (0.6 + r() * 0.6);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * squash;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
      // wrap so the texture tiles
      if (x < max || y < max || x > size - max || y > size - max) {
        g.save(); g.translate(x < size / 2 ? size : -size, 0); g.fill(); g.restore();
        g.save(); g.translate(0, y < size / 2 ? size : -size); g.fill(); g.restore();
      }
    }
  };
  switch (def.pattern) {
    case 'solid': {
      for (let i = 0; i < size * 4; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.04})`; g.fillRect(r() * size, r() * size, 2, 2); }
      g.fillStyle = c1; g.globalAlpha = 0.25;
      for (let y = 0; y < size; y += 4) g.fillRect(0, y, size, 1);
      g.globalAlpha = 1;
      break;
    }
    case 'woodland': blob(c1, 26, size * 0.06, size * 0.16, 0.6); blob(c2, 20, size * 0.05, size * 0.12, 0.6); blob(c3, 14, size * 0.03, size * 0.07, 0.6); break;
    case 'digital': {
      const px = size / 32;
      for (const [col, n] of [[c1, 120], [c2, 90], [c3, 60]]) {
        g.fillStyle = col;
        for (let i = 0; i < n; i++) {
          const x = Math.floor(r() * 32), y = Math.floor(r() * 32), w = 1 + Math.floor(r() * 4), h = 1 + Math.floor(r() * 3);
          for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) if (r() < 0.8) g.fillRect(((x + a) % 32) * px, ((y + b) % 32) * px, px, px);
        }
      }
      break;
    }
    case 'splinter': {
      for (const [col, n] of [[c1, 22], [c2, 16], [c3, 10]]) {
        g.fillStyle = col;
        for (let i = 0; i < n; i++) {
          const x = r() * size, y = r() * size, l = size * (0.1 + r() * 0.25), a = -0.5 + r() * 0.3;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.lineTo(x + Math.cos(a) * l * 0.7 + 8, y + Math.sin(a) * l * 0.7 + 14); g.closePath(); g.fill();
        }
      }
      break;
    }
    case 'tiger': {
      g.fillStyle = c2; g.globalAlpha = 0.5; g.fillRect(0, 0, size, size); g.globalAlpha = 1;
      g.fillStyle = c1;
      for (let i = 0; i < 26; i++) {
        const y = r() * size, x = r() * size, len = size * (0.25 + r() * 0.4), th = 4 + r() * 10;
        g.beginPath(); g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y - th * 2, x + len * 0.6, y + th * 2, x + len, y);
        g.bezierCurveTo(x + len * 0.6, y + th * 3, x + len * 0.3, y - th, x, y + th);
        g.fill();
      }
      break;
    }
    case 'hex': {
      const s = size / 10;
      g.lineWidth = 2;
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
        const cx = x * s * 1.5, cy = y * s * 1.732 + (x % 2) * s * 0.866;
        g.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const px = cx + Math.cos(a) * s * 0.92, py = cy + Math.sin(a) * s * 0.92; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); }
        g.closePath();
        g.fillStyle = r() < 0.3 ? c1 : c0; g.fill();
        g.strokeStyle = c2; g.stroke();
      }
      break;
    }
    case 'carbon': {
      const s = size / 32;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const grad = g.createLinearGradient(x * s, y * s, x * s + s, y * s + s);
        const flip = (x + y) % 2;
        grad.addColorStop(0, flip ? c1 : c2); grad.addColorStop(1, flip ? c2 : c1);
        g.fillStyle = grad; g.fillRect(x * s, y * s, s, s);
      }
      break;
    }
    case 'topo': {
      g.strokeStyle = c1; g.lineWidth = 1.5;
      for (let ring = 0; ring < 5; ring++) {
        const cx = r() * size, cy = r() * size;
        for (let k = 1; k < 9; k++) {
          g.beginPath();
          for (let a = 0; a <= 40; a++) {
            const t = (a / 40) * Math.PI * 2, rr = k * 9 * (1 + 0.25 * Math.sin(t * 3 + ring));
            const px = cx + Math.cos(t) * rr, py = cy + Math.sin(t) * rr;
            if (a === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.stroke();
        }
      }
      break;
    }
    case 'marble': {
      g.lineWidth = 2;
      for (let i = 0; i < 30; i++) {
        g.strokeStyle = i % 3 ? c1 : c2; g.globalAlpha = 0.5;
        let x = r() * size, y = r() * size;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 12; k++) { x += (r() - 0.3) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); }
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'dazzle': {
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i % 2 ? c1 : (i % 3 ? c2 : c0);
        const x = r() * size, y = r() * size, w = size * (0.2 + r() * 0.5);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + w * 0.3); g.lineTo(x + w * 0.8, y + w * 0.9); g.lineTo(x - w * 0.2, y + w * 0.6); g.closePath(); g.fill();
      }
      break;
    }
    case 'waves': {
      for (let i = 0; i < 16; i++) {
        g.strokeStyle = i % 2 ? c1 : c2; g.lineWidth = 6 + (i % 3) * 3;
        g.beginPath();
        for (let x = 0; x <= size; x += 4) { const y = (i * size) / 16 + Math.sin((x / size) * Math.PI * 4 + i) * 10; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      break;
    }
    case 'circuit': {
      g.strokeStyle = c1; g.lineWidth = 2; g.fillStyle = c1;
      for (let i = 0; i < 40; i++) {
        let x = Math.floor(r() * 16) * size / 16, y = Math.floor(r() * 16) * size / 16;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 4; k++) { if (r() < 0.5) x += (r() < 0.5 ? -1 : 1) * size / 8; else y += (r() < 0.5 ? -1 : 1) * size / 8; g.lineTo(x, y); }
        g.stroke(); g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      }
      break;
    }
    case 'flame': {
      for (let i = 0; i < 22; i++) {
        const x = r() * size, base = size, h = size * (0.3 + r() * 0.6);
        const grad = g.createLinearGradient(x, base, x, base - h);
        grad.addColorStop(0, c2); grad.addColorStop(0.5, c1); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(x - 14, base);
        g.quadraticCurveTo(x - 20, base - h * 0.5, x + (r() - 0.5) * 20, base - h);
        g.quadraticCurveTo(x + 20, base - h * 0.5, x + 14, base); g.fill();
      }
      break;
    }
    case 'cracked': {
      g.strokeStyle = c1; g.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        let x = r() * size, y = r() * size;
        g.lineWidth = 1 + r() * 3;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
        g.stroke();
      }
      g.globalAlpha = 0.6; g.strokeStyle = c2; g.lineWidth = 1;
      for (let i = 0; i < 18; i++) { const x = r() * size, y = r() * size; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); g.stroke(); }
      g.globalAlpha = 1;
      break;
    }
    case 'stripes': {
      const n = 8;
      for (let i = 0; i < n * 2; i++) {
        g.fillStyle = i % 2 ? c1 : (def.colors[2] && i % 4 === 0 ? c2 : c0);
        g.beginPath(); const x = (i * size) / n - size;
        g.moveTo(x, 0); g.lineTo(x + size / n / 2, 0); g.lineTo(x + size / n / 2 + size, size); g.lineTo(x + size, size); g.closePath(); g.fill();
      }
      break;
    }
    case 'dots': {
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        g.fillStyle = (x + y) % 5 === 0 ? c2 : c1;
        g.beginPath(); g.arc(x * size / 10 + (y % 2) * size / 20, y * size / 10, size / 40 + r() * 3, 0, 7); g.fill();
      }
      break;
    }
    case 'rings': {
      for (let i = 0; i < 6; i++) {
        const cx = r() * size, cy = r() * size;
        for (let k = 5; k > 0; k--) { g.fillStyle = k % 2 ? c1 : c2; g.beginPath(); g.arc(cx, cy, k * 8, 0, 7); g.fill(); }
      }
      break;
    }
    case 'slash': {
      g.strokeStyle = c1; g.lineCap = 'round';
      for (let i = 0; i < 40; i++) {
        const x = r() * size, y = r() * size, l = 10 + r() * 40;
        g.lineWidth = 1 + r() * 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y - l * 0.6); g.stroke();
      }
      break;
    }
    case 'gradient': {
      const grad = g.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, c0); grad.addColorStop(1, c1);
      g.fillStyle = grad; g.fillRect(0, 0, size, size);
      break;
    }
    case 'brushed': {
      for (let y = 0; y < size; y++) { g.fillStyle = r() < 0.5 ? c1 : c2; g.globalAlpha = 0.15 + r() * 0.25; g.fillRect(0, y, size, 1); }
      g.globalAlpha = 1;
      break;
    }
    case 'gold': {
      const grad = g.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, c1); grad.addColorStop(0.45, c0); grad.addColorStop(0.55, c2); grad.addColorStop(1, c1);
      g.fillStyle = grad; g.fillRect(0, 0, size, size);
      for (let y = 0; y < size; y += 2) { g.fillStyle = `rgba(255,255,255,${r() * 0.08})`; g.fillRect(0, y, size, 1); }
      break;
    }
    case 'facet': {
      for (let i = 0; i < 70; i++) {
        g.fillStyle = [c0, c1, c2][i % 3]; g.globalAlpha = 0.5 + r() * 0.5;
        const x = r() * size, y = r() * size, s = 10 + r() * 30;
        g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.7, y); g.lineTo(x, y + s); g.lineTo(x - s * 0.7, y); g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'plasma': case 'aurora': case 'prism': case 'nebula': {
      const cols = def.colors;
      for (let i = 0; i < 40; i++) {
        const x = r() * size, y = r() * size, rad = size * (0.08 + r() * 0.2);
        const grad = g.createRadialGradient(x, y, 0, x, y, rad);
        const col = cols[1 + (i % (cols.length - 1))];
        grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = def.pattern === 'prism' ? 0.6 : 0.45;
        g.fillStyle = grad; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      g.globalAlpha = 1;
      if (def.pattern === 'nebula') for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`; g.fillRect(r() * size, r() * size, 1 + r() * 1.5, 1 + r() * 1.5); }
      if (def.pattern === 'prism') {
        g.globalCompositeOperation = 'overlay';
        for (let i = 0; i < 10; i++) { g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.3; g.fillRect(0, (i * size) / 10, size, size / 20); }
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      }
      break;
    }
    default:
      break;
  }
  // Subtle wear on all camos.
  for (let i = 0; i < size; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * size, r() * size, 1 + r() * 3, 1); }
}

/** Texture (and material hints) for a camo id. Cached; animated camos share one texture that the renderer scrolls. */
export function camoTexture(id, size = 256) {
  const key = id + ':' + size;
  if (camoCache.has(key)) return camoCache.get(key);
  const def = camoById(id);
  const c = canvas(size);
  drawCamo(c, def, size);
  const tex = finish(c, true, 4);
  const entry = { def, map: tex, canvas: c };
  camoCache.set(key, entry);
  return entry;
}

/** Small swatch image (data URL) for menus. */
export function camoSwatch(id, size = 96) {
  return camoTexture(id, 128).canvas.toDataURL('image/png');
}
