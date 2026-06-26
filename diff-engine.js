// file_name: diff-engine.js

const DiffEngine = (() => {
  'use strict';

  /* ── LCS diff algorithm ──────────────────────────────────────────────── */

  function splitLinesPreserveBreaks(text) {
    const source = String(text ?? '');
    if (!source) return [];
    return source.match(/[^\n]*\n|[^\n]+/g) || [];
  }

  function mergeAdjacentOps(ops) {
    const merged = [];
    for (const op of ops) {
      if (!op.text) continue;
      const prev = merged[merged.length - 1];
      if (prev && prev.type === op.type) prev.text += op.text;
      else merged.push({ ...op });
    }
    return merged;
  }

  function trimCommonEdgesFallback(oldText, newText) {
    const a = String(oldText ?? '');
    const b = String(newText ?? '');
    let start = 0;
    const minLen = Math.min(a.length, b.length);
    while (start < minLen && a[start] === b[start]) start++;

    let oldEnd = a.length;
    let newEnd = b.length;
    while (oldEnd > start && newEnd > start && a[oldEnd - 1] === b[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    const ops = [];
    if (start > 0) ops.push({ type: 'eq', text: a.slice(0, start) });
    if (oldEnd > start) ops.push({ type: 'del', text: a.slice(start, oldEnd) });
    if (newEnd > start) ops.push({ type: 'ins', text: b.slice(start, newEnd) });
    if (oldEnd < a.length) ops.push({ type: 'eq', text: a.slice(oldEnd) });
    return ops;
  }

  function computeByLine(oldText, newText) {
    const oldLines = splitLinesPreserveBreaks(oldText);
    const newLines = splitLinesPreserveBreaks(newText);
    const m = oldLines.length;
    const n = newLines.length;

    if (!m && !n) return [];
    if (m * n > 80_000) {
      return trimCommonEdgesFallback(oldText, newText);
    }

    const dp = Array.from({ length: m + 1 }, () => new Int16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          oldLines[i - 1] === newLines[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        ops.push({ type: 'eq', text: oldLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ type: 'ins', text: newLines[j - 1] });
        j--;
      } else {
        ops.push({ type: 'del', text: oldLines[i - 1] });
        i--;
      }
    }
    ops.reverse();
    return mergeAdjacentOps(ops);
  }

  function computeDiff(oldText, newText) {
    const a = oldText == null ? '' : String(oldText);
    const b = newText == null ? '' : String(newText);

    if (a === b) return a.length === 0 ? [] : [{ type: 'eq', text: a }];

    const oldToks = a.split(/(\s+)/);
    const newToks = b.split(/(\s+)/);
    const m = oldToks.length;
    const n = newToks.length;

    if (m * n > 150_000) {
      return computeByLine(a, b);
    }

    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          oldToks[i - 1] === newToks[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldToks[i - 1] === newToks[j - 1]) {
        ops.push({ type: 'eq', text: oldToks[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ type: 'ins', text: newToks[j - 1] });
        j--;
      } else {
        ops.push({ type: 'del', text: oldToks[i - 1] });
        i--;
      }
    }
    ops.reverse();
    return mergeAdjacentOps(ops);
  }

  /* ── Text extraction from snapshot data ───────────────────────────────── */

  function extractTextFromSnapshot(data) {
    if (!data || !data.blocks) return '';
    const sep = data.separator ?? '\n\n';
    const parts = [];

    function walk(blocks) {
      for (const b of blocks) {
        if (b.type === 'text') {
          const activeIdx = b.activeSubtab ?? 0;
          const val = (b.subtabs?.[activeIdx]?.value || '').trim();
          if (val) parts.push((b.title || 'Блок') + ':\n' + val);
        } else if (b.type === 'group' && b.children) {
          walk(b.children);
        }
      }
    }

    walk(data.blocks);
    return parts.join(sep);
  }

  /* ── HTML rendering ──────────────────────────────────────────────────── */

  const escHtml = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  function renderInlineDiff(ops) {
    if (!ops || !ops.length) return '<span class="snap-diff-empty">Нет отличий</span>';
    let html = '';
    for (const op of ops) {
      const t = escHtml(op.text);
      if (op.type === 'del')      html += `<span class="diff-del">${t}</span>`;
      else if (op.type === 'ins') html += `<span class="diff-ins">${t}</span>`;
      else                        html += `<span class="diff-eq">${t}</span>`;
    }
    return html;
  }

  function renderStats(ops) {
    let ins = 0, del = 0;
    for (const op of ops) {
      if (op.type === 'ins') ins += op.text.length;
      else if (op.type === 'del') del += op.text.length;
    }
    return { ins, del, total: ins + del };
  }

  return { computeDiff, extractTextFromSnapshot, renderInlineDiff, renderStats };
})();

window.DiffEngine = DiffEngine;
