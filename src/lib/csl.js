import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';

const STYLE_MAP = {
  'ieee': 'ieee.csl',
  'vancouver': 'vancouver.csl',
  'ama': 'american-medical-association.csl',
  'nature': 'nature.csl',
  'acm': 'acm-sig-proceedings.csl',
  'acs': 'acs-nano.csl',
  'apa-7': 'apa.csl',
  'chicago-ad': 'chicago-author-date.csl',
  'icheme-harvard': 'harvard-cite-them-right.csl'
};

const loaded = new Set();

async function ensureStyle(styleId) {
  if (loaded.has(styleId)) return;
  const file = STYLE_MAP[styleId];
  if (!file) throw new Error(`No CSL mapping for styleId: ${styleId}`);
  const res = await fetch(`/csl/${file}`);
  if (!res.ok) throw new Error(`Missing CSL file: ${file}`);
  const xml = await res.text();
  const csl = plugins.config.get('@csl');
  csl.templates.add(styleId, xml);
  loaded.add(styleId);
}

/**
 * Format a bibliography for the given CSL-JSON items using a CSL style.
 * Returns a single plain-text string (lines separated by \n).
 */
export async function formatCSLBibliography(styleId, items) {
  try {
    await ensureStyle(styleId);
    const cite = new Cite(items);
    const out = cite.format('bibliography', {
      template: styleId,
      format: 'text',     // plain text (not HTML)
      lang: 'en-US'
    });
    return String(out).trim();
  } catch (e) {
    console.warn('CSL format failed (fallback to simple formatter):', e?.message || e);
    return '';
  }
}
