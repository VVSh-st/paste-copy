// file_name: diff-engine.js

const DiffEngine = (() => {
  'use strict';

  /* ── LCS diff algorithm ──────────────────────────────────────────────── */

  function normalizeLineBreaks(text) {
    return String(text ?? '').replace(/\r\n?/g, '\n');
  }

  function splitLinesPreserveBreaks(text) {
    const source = normalizeLineBreaks(text);
    if (!source) return [];
    return source.match(/[^\n]*\n|[^\n]+/g) || [];
  }

  function mergeAdjacentOps(ops) {
    const merged = [];
    for (const op of ops) {
      if (!op.text) continue;
      const prev = merged[merged.length - 1];
      if (prev && prev.type === op.type && prev.type === 'eq') {
        const combined = prev.text + op.text;
        if (prev.text.includes('\n') || op.text.includes('\n')) {
          merged.push({ ...op });
        } else {
          prev.text = combined;
        }
      } else if (prev && prev.type === op.type) {
        prev.text += op.text;
      } else {
        merged.push({ ...op });
      }
    }
    return merged;
  }

  // Internal: assumes LF-normalized input from caller
  function _trimFallback(oldText, newText, depth) {
    const d = depth | 0;
    let start = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (start < minLen && oldText[start] === newText[start]) start++;

    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    const midA = oldText.slice(start, oldEnd);
    const midB = newText.slice(start, newEnd);

    if (midA && midB && d < 1) {
      const la = midA.split('\n');
      const lb = midB.split('\n');
      if (la.length * lb.length <= 80_000) {
        const innerOps = _lineDiff(midA, midB, d + 1);
        const ops = [];
        if (start > 0) ops.push({ type: 'eq', text: oldText.slice(0, start) });
        if (innerOps.length) ops.push(...innerOps);
        if (oldEnd < oldText.length) ops.push({ type: 'eq', text: oldText.slice(oldEnd) });
        return ops;
      }
    }

    const ops = [];
    if (start > 0) ops.push({ type: 'eq', text: oldText.slice(0, start) });
    if (midA) ops.push({ type: 'del', text: midA });
    if (midB) ops.push({ type: 'ins', text: midB });
    if (oldEnd < oldText.length) ops.push({ type: 'eq', text: oldText.slice(oldEnd) });
    return ops;
  }

  // Internal: line-level LCS diff, assumes LF-normalized input
  function _lineDiff(oldText, newText, depth = 0) {
    const d = depth | 0;
    const oldLines = splitLinesPreserveBreaks(oldText);
    const newLines = splitLinesPreserveBreaks(newText);
    const m = oldLines.length;
    const n = newLines.length;

    if (!m && !n) return [];
    if (m * n > 80_000) {
      return _trimFallback(oldText, newText, d);
    }

    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
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
      } else if (j > 0 && (i === 0 || dp[i][j - 1] > dp[i - 1][j])) {
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
    if (Array.isArray(oldText)) oldText = oldText.join('');
    if (Array.isArray(newText)) newText = newText.join('');
    const a = normalizeLineBreaks(oldText == null ? '' : String(oldText));
    const b = normalizeLineBreaks(newText == null ? '' : String(newText));

    if (a === b) return a.length === 0 ? [] : [{ type: 'eq', text: a }];

    const collapse = t => /\s+/.test(t) ? ' ' : t;
    const oldToks = a.split(/(\s+)/).map(collapse).filter(Boolean);
    const newToks = b.split(/(\s+)/).map(collapse).filter(Boolean);
    const m = oldToks.length;
    const n = newToks.length;

    if (m * n > 150_000) {
      return _lineDiff(a, b);
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
      } else if (j > 0 && (i === 0 || dp[i][j - 1] > dp[i - 1][j])) {
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
    const sep = typeof data.separator === 'string'
      ? normalizeLineBreaks(data.separator)
      : '\n\n';
    const parts = [];
    const visited = new WeakSet();

    function walk(blocks) {
      for (const b of blocks) {
        if (visited.has(b)) continue;
        visited.add(b);
        if (b.type === 'text') {
          const activeIdx = b.activeSubtab ?? 0;
          const raw = normalizeLineBreaks(
            typeof b.subtabs?.[activeIdx]?.value === 'string'
              ? b.subtabs[activeIdx].value
              : ''
          );
          const title = normalizeLineBreaks(String(b.title ?? 'Блок'));
          if (/\S/.test(raw)) parts.push(title + ':\n' + raw);
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
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, c => '&#' + c.charCodeAt(0) + ';');

  const EMPTY_RUN_THRESHOLD = 3;

  function renderInlineDiff(ops) {
    if (!ops || !ops.length) return '<span class="snap-diff-empty">Нет отличий</span>';
    const parts = [];
    let i = 0;
    while (i < ops.length) {
      const op = ops[i];
      const t = op.text ?? '';

      if ((op.type === 'del' || op.type === 'ins') && /^[ \t\n\r]*$/.test(t)) {
        let totalLines = (t.match(/\n/g) || []).length;
        let j = i + 1;
        while (j < ops.length
               && ops[j].type === op.type
               && /^[ \t\n\r]*$/.test(ops[j].text ?? '')
               && ops[j].text) {
          totalLines += (ops[j].text.match(/\n/g) || []).length;
          j++;
        }
        const groupSize = j - i;
        const cls = op.type === 'del' ? 'diff-del' : 'diff-ins';
        if (groupSize >= EMPTY_RUN_THRESHOLD) {
          const first = escHtml(t);
          parts.push(
            `<span class="${cls} diff-run-summary" title="Скрыто ${groupSize - 1} подряд идущих пустых строк" data-collapsed="${groupSize}">` +
              first +
              `<span class="diff-run-count">…${totalLines} строк…</span>` +
            `</span>`
          );
        } else {
          for (let k = i; k < j; k++) parts.push(`<span class="${cls}">${escHtml(ops[k].text ?? "")}</span>`);
        }
        i = j;
        continue;
      }

      const cls = op.type === 'del' ? 'diff-del'
                : op.type === 'ins' ? 'diff-ins'
                : 'diff-eq';
      parts.push(`<span class="${cls}">${escHtml(t)}</span>`);
      i++;
    }
    return parts.join('');
  }


  function renderStats(ops) {
    let ins = 0, del = 0;
    for (const op of ops) {
      const len = Array.from(op.text ?? '').length;
      if (op.type === 'ins') ins += len;
      else if (op.type === 'del') del += len;
    }
    return { ins, del, total: ins + del };
  }

  return { computeDiff, extractTextFromSnapshot, renderInlineDiff, renderStats };
})();

if (typeof window !== 'undefined') window.DiffEngine = DiffEngine;
if (typeof module !== 'undefined') module.exports = DiffEngine;
