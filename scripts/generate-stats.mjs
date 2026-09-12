#!/usr/bin/env node
/**
 * Generates the profile stat cards as self-contained SVGs.
 *
 * Public stat services (github-readme-stats & friends) go down or start
 * returning 402/503 without warning, which silently breaks the profile.
 * This script pulls the numbers straight from the GitHub GraphQL API and
 * commits the rendered SVGs, so the README never depends on a third party.
 *
 * Token: GH_STATS_TOKEN (classic PAT with `read:user` + `repo` to include
 * private work) or GITHUB_TOKEN. Output: assets/stats-{dark,light}.svg
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_STATS_TOKEN || process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('Missing GH_STATS_TOKEN / GITHUB_TOKEN.');
  process.exit(1);
}

const QUERY = `{
  viewer {
    login
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar { totalContributions }
    }
    repositoriesContributedTo(contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]) { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes {
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchStats() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'geraldobarar-profile-stats',
    },
    body: JSON.stringify({ query: QUERY }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);

  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));

  const v = body.data.viewer;
  const c = v.contributionsCollection;

  const bytes = new Map();
  for (const repo of v.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const prev = bytes.get(node.name);
      bytes.set(node.name, { size: (prev?.size ?? 0) + size, color: node.color || '#8b949e' });
    }
  }

  const total = [...bytes.values()].reduce((sum, l) => sum + l.size, 0) || 1;
  const ranked = [...bytes.entries()]
    .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  const languages = ranked.slice(0, 6);

  return {
    login: v.login,
    contributions: c.contributionCalendar.totalContributions + c.restrictedContributionsCount,
    commits: c.totalCommitContributions,
    pullRequests: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    repos: v.repositories.totalCount,
    followers: v.followers.totalCount,
    contributedTo: v.repositoriesContributedTo.totalCount,
    languageCount: ranked.length,
    languages,
  };
}

const THEMES = {
  dark: { bg: '#0d1117', border: '#30363d', title: '#e6edf3', value: '#e6edf3', muted: '#8b949e', accent: '#58a6ff', track: '#21262d' },
  light: { bg: '#ffffff', border: '#d0d7de', title: '#1f2328', value: '#1f2328', muted: '#59636e', accent: '#0969da', track: '#eaeef2' },
};

const W = 860;
const H = 260;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(stats, theme) {
  const t = THEMES[theme];

  const tiles = [
    ['Contributions', stats.contributions, 'past 12 months'],
    ['Commits', stats.commits, 'past 12 months'],
    ['Repositories', stats.repos, 'public + private'],
    ['Languages', stats.languageCount, `${stats.languages[0]?.name ?? '—'} leads`],
  ];

  const tileW = 186;
  const tileGap = 14;
  const tileCards = tiles
    .map(([label, value, hint], i) => {
      const x = 32 + i * (tileW + tileGap);
      return `
    <g transform="translate(${x}, 70)">
      <rect width="${tileW}" height="78" rx="10" fill="${t.track}" opacity="0.55"/>
      <text x="16" y="30" font-size="24" font-weight="600" fill="${t.value}">${esc(value)}</text>
      <text x="16" y="48" font-size="11" font-weight="600" fill="${t.accent}" letter-spacing="0.4">${esc(label.toUpperCase())}</text>
      <text x="16" y="65" font-size="10.5" fill="${t.muted}">${esc(hint)}</text>
    </g>`;
    })
    .join('');

  // Single stacked bar: each language gets a slice proportional to its share.
  const barX = 32;
  const barW = W - 64;
  let cursor = barX;
  const slices = stats.languages
    .map((l, i) => {
      const w = Math.max((l.pct / 100) * barW, 2);
      const first = i === 0;
      const last = i === stats.languages.length - 1;
      const r = first || last ? 5 : 0;
      const seg = `<rect x="${cursor.toFixed(1)}" y="188" width="${w.toFixed(1)}" height="10" rx="${r}" fill="${l.color}"/>`;
      cursor += w;
      return seg;
    })
    .join('\n    ');

  const legend = stats.languages
    .map((l, i) => {
      const x = barX + (i % 3) * 270;
      const y = 222 + Math.floor(i / 3) * 20;
      return `<g transform="translate(${x}, ${y})">
      <circle cx="5" cy="-4" r="5" fill="${l.color}"/>
      <text x="17" y="0" font-size="12" fill="${t.value}">${esc(l.name)}</text>
      <text x="130" y="0" font-size="12" fill="${t.muted}">${l.pct.toFixed(1)}%</text>
    </g>`;
    })
    .join('\n    ');

  const height = H + (stats.languages.length > 3 ? 20 : 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="GitHub statistics for ${esc(stats.login)}">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }</style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="14" fill="${t.bg}" stroke="${t.border}"/>
  <text x="32" y="42" font-size="16" font-weight="600" fill="${t.title}">${esc(stats.login)} · GitHub activity</text>
  <text x="${W - 32}" y="42" text-anchor="end" font-size="11" fill="${t.muted}">${esc(stats.pullRequests)} PRs · ${esc(stats.issues)} issues · ${esc(stats.contributedTo)} ${stats.contributedTo === 1 ? 'repo' : 'repos'} contributed to</text>
  ${tileCards}
  <text x="32" y="176" font-size="11" font-weight="600" fill="${t.accent}" letter-spacing="0.4">MOST USED LANGUAGES</text>
  ${slices}
  ${legend}
</svg>
`;
}

const stats = await fetchStats();
await mkdir(resolve(ROOT, 'assets'), { recursive: true });

for (const theme of Object.keys(THEMES)) {
  const out = resolve(ROOT, `assets/stats-${theme}.svg`);
  await writeFile(out, render(stats, theme), 'utf8');
  console.log(`wrote ${out}`);
}

console.log(
  `contributions=${stats.contributions} commits=${stats.commits} repos=${stats.repos} langs=${stats.languages.map((l) => l.name).join(',')}`,
);
