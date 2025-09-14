// Replace {fig:<id>} -> "Figure N" and {tab:<id>} -> "Table M"
// Build numbering by first appearance across all sections (raw drafts with markers if present).

export function collectFigureTableMaps(sections, figures = [], tables = []) {
  const figIds = new Set(figures.map(f => String(f.id || f.figId || '').toLowerCase()).filter(Boolean));
  const tabIds = new Set(tables.map(t => String(t.id || t.tabId || '').toLowerCase()).filter(Boolean));

  const figMap = new Map(); // idLower -> number
  const tabMap = new Map(); // idLower -> number
  let f = 1, t = 1;

  const eachText = [];
  Object.entries(sections || {}).forEach(([id, sec]) => {
    const raw = sec?.draftRaw || sec?.draft || '';
    eachText.push(String(raw));
  });

  const figRe = /\{fig:([a-z0-9\-_]+)\}/gi;
  const tabRe = /\{tab:([a-z0-9\-_]+)\}/gi;

  for (const txt of eachText) {
    let m;
    while ((m = figRe.exec(txt))) {
      const k = m[1].toLowerCase();
      if (figIds.size && !figIds.has(k)) continue;
      if (!figMap.has(k)) figMap.set(k, f++);
    }
    while ((m = tabRe.exec(txt))) {
      const k = m[1].toLowerCase();
      if (tabIds.size && !tabIds.has(k)) continue;
      if (!tabMap.has(k)) tabMap.set(k, t++);
    }
  }
  return { figMap, tabMap };
}

export function applyFigTabTokens(text, figMap, tabMap) {
  let out = String(text || '');
  if (figMap && figMap.size) {
    out = out.replace(/\{fig:([a-z0-9\-_]+)\}/gi, (_, id) => {
      const n = figMap.get(String(id).toLowerCase());
      return n ? `Figure ${n}` : 'Figure ?';
    });
  }
  if (tabMap && tabMap.size) {
    out = out.replace(/\{tab:([a-z0-9\-_]+)\}/gi, (_, id) => {
      const n = tabMap.get(String(id).toLowerCase());
      return n ? `Table ${n}` : 'Table ?';
    });
  }
  return out;
}

export function buildLists(figMap, tabMap, figures = [], tables = []) {
  const figById = new Map(figures.map(f => [String(f.id || f.figId || '').toLowerCase(), f]));
  const tabById = new Map(tables.map(t => [String(t.id || t.tabId || '').toLowerCase(), t]));

  const figLines = Array.from(figMap.entries())
    .sort((a,b)=>a[1]-b[1])
    .map(([k, n]) => {
      const f = figById.get(k) || {};
      const cap = f.caption || f.name || '(no caption)';
      return `${n}. ${cap}`;
    });

  const tabLines = Array.from(tabMap.entries())
    .sort((a,b)=>a[1]-b[1])
    .map(([k, n]) => {
      const t = tabById.get(k) || {};
      const cap = t.caption || t.name || '(no caption)';
      return `${n}. ${cap}`;
    });

  return {
    listOfFigures: figLines.join('\n'),
    listOfTables:  tabLines.join('\n')
  };
}
