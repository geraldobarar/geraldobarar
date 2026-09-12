#!/usr/bin/env node
/**
 * Composes the tech-stack card into a single self-contained SVG per theme.
 *
 * Brand-coloured badges with their own background colours turn the section
 * into confetti. Here every logo sits on one shared card that matches
 * assets/stats-*.svg, so the profile reads as one design.
 *
 * Logo geometry comes from simple-icons at generation time and is inlined
 * into the output, so the rendered card makes no external requests.
 *
 * Run: node scripts/generate-tech.mjs   Output: assets/tech-{dark,light}.svg
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@15/icons';

const GROUPS = [
  {
    label: 'Languages',
    items: [
      { name: 'TypeScript', slug: 'typescript', brand: '#3178C6' },
      { name: 'JavaScript', slug: 'javascript', brand: '#F7DF1E' },
      { name: 'Python', slug: 'python', brand: '#3776AB' },
      { name: 'C', slug: 'c', brand: '#A8B9CC' },
    ],
  },
  {
    label: 'Front end',
    items: [
      { name: 'React', slug: 'react', brand: '#61DAFB' },
      { name: 'Next.js', slug: 'nextdotjs', brand: '#000000' },
      { name: 'Tailwind CSS', slug: 'tailwindcss', brand: '#06B6D4' },
      { name: 'Node.js', slug: 'nodedotjs', brand: '#5FA04E' },
    ],
  },
  {
    label: 'Platform & data',
    items: [
      { name: 'Supabase', slug: 'supabase', brand: '#3FCF8E' },
      { name: 'PostgreSQL', slug: 'postgresql', brand: '#4169E1' },
      { name: 'Vercel', slug: 'vercel', brand: '#000000' },
      { name: 'Apps Script', slug: 'googleappsscript', brand: '#4285F4' },
    ],
  },
  {
    label: 'AI & tooling',
    items: [
      { name: 'Claude', slug: 'claude', brand: '#D97757' },
      { name: 'Gemini', slug: 'googlegemini', brand: '#8E75B2' },
      { name: 'scikit-learn', slug: 'scikitlearn', brand: '#F7931E' },
      { name: 'Git', slug: 'git', brand: '#F05032' },
    ],
  },
];

const THEMES = {
  dark: { bg: '#0d1117', border: '#30363d', value: '#e6edf3', accent: '#58a6ff' },
  light: { bg: '#ffffff', border: '#d0d7de', value: '#1f2328', accent: '#0969da' },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** sRGB relative luminance, per WCAG. */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, ratio) => rgb(a).map((v, i) => v + (rgb(b)[i] - v) * ratio);

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Some brand colours disappear into the card — Next.js and Vercel black on
 * the dark theme, JavaScript yellow on the light one. Rather than dropping
 * the brand colour entirely, blend it towards the theme's text colour just
 * far enough to clear the WCAG 3:1 non-text contrast target, so the logo
 * keeps its hue and stays legible in both themes.
 */
function logoColor(brand, t) {
  for (let ratio = 0; ratio <= 1; ratio += 0.05) {
    const candidate = toHex(mix(brand, t.value, ratio));
    if (contrast(candidate, t.bg) >= 3) return candidate;
  }
  return t.value;
}

async function fetchIconPath(slug) {
  const res = await fetch(`${ICON_CDN}/${slug}.svg`);
  if (!res.ok) throw new Error(`simple-icons ${slug}: HTTP ${res.status}`);
  const svg = await res.text();
  const d = svg.match(/ d="([^"]+)"/)?.[1];
  if (!d) throw new Error(`simple-icons ${slug}: no path found`);
  return d;
}

const W = 860;
const PAD = 32;
const COL_W = (W - PAD * 2) / 4;
const GROUP_H = 62;
const ICON = 22;
const H = 40 + GROUPS.length * GROUP_H + 4;

function render(paths, theme) {
  const t = THEMES[theme];

  const groups = GROUPS.map((group, gi) => {
    const top = 40 + gi * GROUP_H;

    const items = group.items
      .map((item, ci) => {
        const x = PAD + ci * COL_W;
        const cy = top + 26;
        const scale = ICON / 24;
        return `    <g transform="translate(${x}, ${cy - ICON / 2})">
      <path transform="scale(${scale.toFixed(4)})" d="${paths[item.slug]}" fill="${logoColor(item.brand, t)}"/>
      <text x="${ICON + 10}" y="${ICON / 2 + 4.5}" font-size="12.5" fill="${t.value}">${esc(item.name)}</text>
    </g>`;
      })
      .join('\n');

    return `  <g>
    <text x="${PAD}" y="${top}" font-size="11" font-weight="600" fill="${t.accent}" letter-spacing="0.4">${esc(group.label.toUpperCase())}</text>
${items}
  </g>`;
  }).join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tech stack">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }</style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
${groups}
</svg>
`;
}

const slugs = GROUPS.flatMap((g) => g.items.map((i) => i.slug));
const paths = Object.fromEntries(
  await Promise.all(slugs.map(async (slug) => [slug, await fetchIconPath(slug)])),
);

await mkdir(resolve(ROOT, 'assets'), { recursive: true });

for (const theme of Object.keys(THEMES)) {
  const out = resolve(ROOT, `assets/tech-${theme}.svg`);
  await writeFile(out, render(paths, theme), 'utf8');
  console.log(`wrote ${out}`);
}
