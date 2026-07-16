// file_name: qr-panel.js
/* ============================================================
   QR Panel — dynamic QR code generator for selected/focused text
   ============================================================ */
const QRPanel = (() => {
  'use strict';

  /* ── helpers ────────────────────────────────────────────── */
  function _readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      try { localStorage.removeItem(key); } catch {}
      return fallback;
    }
  }
  function _storageGet(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function _storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* quota or private mode */ }
  }

  /* ── state ─────────────────────────────────────────────── */
  let _panel = null;
  let _isOpen = false;
  let _ta = null;                 // current focused textarea
  let _pages = [];                // [{bytes: Uint8Array, text: string}]
  let _currentPage = 0;
  let _updateTimer = null;
  let _lastText = '\x00';
  let _lastSelStart = -1;
  let _lastSelEnd = -1;
  let _generationId = 0;          // prevents stale async results
  let _previewText = '';          // text shown in current QR preview
  let _previewSource = '';        // source label for current QR preview

  /* settings (persisted, validated) */
  const VALID_STYLES = ['classic', 'dotted', 'rounded', 'diamond'];
  const VALID_EC = ['L', 'M', 'Q', 'H'];
  let _style = VALID_STYLES.includes(_storageGet('qr-style')) ? _storageGet('qr-style') : 'classic';
  let _moduleSize = Math.max(4, Math.min(12, parseInt(_storageGet('qr-module-size', '6'), 10))) || 6;
  let _fg = /^#[0-9a-fA-F]{6}$/.test(_storageGet('qr-fg')) ? _storageGet('qr-fg') : '#000000';
  let _bg = /^#[0-9a-fA-F]{6}$/.test(_storageGet('qr-bg')) ? _storageGet('qr-bg') : '#FFFFFF';
  let _ec = VALID_EC.includes(_storageGet('qr-ec')) ? _storageGet('qr-ec') : 'L';
  let _compress = _storageGet('qr-compress') !== 'false';
  let _padding = _storageGet('qr-padding') !== 'false';
  const VALID_TABS = ['preview', 'style', 'export', 'history'];
  let _activeTab = VALID_TABS.includes(_storageGet('qr-panel-tab')) ? _storageGet('qr-panel-tab') : 'preview';

  /* drag state */
  let _dragging = false;
  let _dragOffset = { x: 0, y: 0 };

  /* resize state */
  let _resizing = false;
  let _resizeOffset = { x: 0, y: 0, w: 0, h: 0 };

  /* color picker */
  let _pickerOpen = false;
  let _pickerTarget = null;       // 'fg' or 'bg'
  let _pickerHue = 0;
  let _pickerSat = 0;
  let _pickerVal = 0;

  /* history */
  const HISTORY_KEY = 'qr-history';
  const HISTORY_MAX = 20;
  let _history = [];
  { const stored = _readJSON(HISTORY_KEY, []);
    _history = Array.isArray(stored)
      ? stored.filter(e => e && typeof e === 'object' && typeof e.text === 'string' && typeof e.ts === 'number').slice(0, HISTORY_MAX)
      : []; }

  /* ── constants ─────────────────────────────────────────── */
  const PANEL_DEFAULT_W = 360;
  const PANEL_DEFAULT_H = 480;
  const PANEL_MIN_W = 300;
  const PANEL_MIN_H = 400;
  const MAX_QR_BYTES = 2953;      // version 40, EC=L
  const DEBOUNCE_SEL = 150;
  const DEBOUNCE_INPUT = 300;

  /* ── QR code generator (minimal inline) ────────────────── */
  // Uses qrcode-generator algorithm (kazuhikoarase) — embedded for zero dependencies
  // Supports versions 1-40, EC levels L/M/Q/H
  const _QR = (() => {
    // QR code mode indicators
    const MODE_BYTE = 1 << 2;
    // EC ordinal for table lookup (L=0,M=1,Q=2,H=3)
    const EC_ORDINAL = { L: 0, M: 1, Q: 2, H: 3 };
    // EC format bits for FORMAT_INFO (L=1,M=0,Q=3,H=2)
    const EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

    // GF(256) operations for Reed-Solomon
    const EXP = new Uint8Array(256);
    const LOG = new Uint8Array(256);
    let initialized = false;

    function initGF() {
      if (initialized) return;
      initialized = true;
      let x = 1;
      for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
      }
      EXP[255] = EXP[0];
    }

    function polyMul(a, b) {
      const r = new Uint8Array(a.length + b.length - 1);
      for (let i = 0; i < a.length; i++) {
        if (a[i] === 0) continue;
        for (let j = 0; j < b.length; j++) {
          if (b[j] === 0) continue;
          r[i + j] ^= EXP[(LOG[a[i]] + LOG[b[j]]) % 255];
        }
      }
      return r;
    }

    function polyMod(data, generator) {
      const ecSize = generator.length - 1;
      const remainder = new Uint8Array(ecSize);
      for (const value of data) {
        const factor = value ^ remainder[0];
        remainder.copyWithin(0, 1);
        remainder[ecSize - 1] = 0;
        for (let i = 0; i < ecSize; i++) {
          if (factor && generator[i + 1]) {
            remainder[i] ^= EXP[(LOG[factor] + LOG[generator[i + 1]]) % 255];
          }
        }
      }
      return remainder;
    }

    function generatorPoly(nsym) {
      let g = new Uint8Array([1]);
      for (let i = 0; i < nsym; i++)
        g = polyMul(g, new Uint8Array([1, EXP[i]]));
      return g;
    }

    // Version info
    const TOTAL_CODEWORDS = [
      0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,
      1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706
    ];
    // ECC codewords per block — indexed by [ordinal][version], ordinals: L=0,M=1,Q=2,H=3
    const ECC_CODEWORDS_PER_BLOCK = [
      [-1, 7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],  // L
      [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],  // M
      [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],  // Q
      [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],  // H
    ];
    // Number of ECC blocks — indexed by [ordinal][version]
    const NUM_ECC_BLOCKS = [
      [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],  // L
      [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],  // M
      [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],  // Q
      [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81],  // H
    ];
    const ALIGN_POS = [
      0,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],
      [6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],
      [6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],
      [6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],
      [6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],
      [6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
      [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],
      [6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],
      [6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],
      [6,30,58,86,114,142,170]
    ];

    function getVersion(dataLen, ecLevel) {
      const ordinal = EC_ORDINAL[ecLevel];
      for (let v = 1; v <= 40; v++) {
        const dataCW = TOTAL_CODEWORDS[v] - ECC_CODEWORDS_PER_BLOCK[ordinal][v] * NUM_ECC_BLOCKS[ordinal][v];
        // byte mode: 4 bits mode + 8/16 bits count + data + terminator
        const countBits = v <= 9 ? 8 : 16;
        const maxBytes = Math.floor((dataCW * 8 - 4 - countBits) / 8);
        if (dataLen <= maxBytes) return v;
      }
      return -1;
    }

    /* ── mask helpers ──────────────────────────────────────── */
    function cloneMatrix(matrix) {
      return matrix.map(row => new Uint8Array(row));
    }

    function applyMask(matrix, reserved, maskFn) {
      const size = matrix.length;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!reserved[r][c] && maskFn(r, c)) {
            matrix[r][c] ^= 1;
          }
        }
      }
    }

    function placeFormatInfo(matrix, formatBits) {
      const size = matrix.length;
      const bit = i => (formatBits >> i) & 1;

      // First copy: around upper-left finder pattern
      for (let i = 0; i < 6; i++) {
        matrix[8][i] = bit(14 - i);
        matrix[5 - i][8] = bit(i);
      }
      matrix[8][7] = bit(8);
      matrix[8][8] = bit(7);
      matrix[7][8] = bit(6);

      // Second copy: lower-left and upper-right areas
      for (let i = 0; i < 7; i++) {
        matrix[size - 1 - i][8] = bit(i);
      }
      for (let i = 7; i < 15; i++) {
        matrix[8][size - 15 + i] = bit(i);
      }
    }

    const FORMAT_INFO = [
      0x5412,0x5125,0x5E7C,0x5B4B,0x45F9,0x40CE,0x4F97,0x4AA0,
      0x77C4,0x72F3,0x7DAA,0x789D,0x662F,0x6318,0x6C41,0x6976,
      0x1689,0x13BE,0x1CE7,0x19D0,0x0762,0x0255,0x0D0C,0x083B,
      0x355F,0x3068,0x3F31,0x3A06,0x24B4,0x2183,0x2EDA,0x2BED
    ];

    function penaltyN1(matrix) {
      const size = matrix.length;
      let score = 0;
      function scoreLine(get) {
        let runColor = get(0), runLength = 1;
        for (let i = 1; i < size; i++) {
          const color = get(i);
          if (color === runColor) { runLength++; }
          else {
            if (runLength >= 5) score += 3 + runLength - 5;
            runColor = color; runLength = 1;
          }
        }
        if (runLength >= 5) score += 3 + runLength - 5;
      }
      for (let r = 0; r < size; r++) scoreLine(c => matrix[r][c]);
      for (let c = 0; c < size; c++) scoreLine(r => matrix[r][c]);
      return score;
    }

    function penaltyN2(matrix) {
      const size = matrix.length;
      let score = 0;
      for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
          const v = matrix[r][c];
          if (matrix[r][c+1] === v && matrix[r+1][c] === v && matrix[r+1][c+1] === v) score += 3;
        }
      }
      return score;
    }

    function penaltyN3(matrix) {
      const size = matrix.length;
      let score = 0;
      const left = [1,0,1,1,1,0,1,0,0,0,0];
      const right = [0,0,0,0,1,0,1,1,1,0,1];
      function matches(get, start, pat) {
        for (let i = 0; i < pat.length; i++) if (get(start + i) !== pat[i]) return false;
        return true;
      }
      function scoreLine(get) {
        for (let s = 0; s <= size - 11; s++) {
          if (matches(get, s, left)) score += 40;
          if (matches(get, s, right)) score += 40;
        }
      }
      for (let r = 0; r < size; r++) scoreLine(i => matrix[r][i]);
      for (let c = 0; c < size; c++) scoreLine(i => matrix[i][c]);
      return score;
    }

    function penaltyN4(matrix) {
      const size = matrix.length;
      const total = size * size;
      let dark = 0;
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++) if (matrix[r][c]) dark++;
      const percent = dark * 100 / total;
      return Math.floor(Math.abs(percent - 50) / 5) * 10;
    }

    function calculatePenalty(matrix) {
      return penaltyN1(matrix) + penaltyN2(matrix) + penaltyN3(matrix) + penaltyN4(matrix);
    }

    function encode(data, ecLevel) {
      initGF();
      const ordinal = EC_ORDINAL[ecLevel];
      const version = getVersion(data.length, ecLevel);
      if (version < 1) return null;
      const size = version * 4 + 17;
      const numBlocks = NUM_ECC_BLOCKS[ordinal][version];
      const ecCW = ECC_CODEWORDS_PER_BLOCK[ordinal][version];
      const totalCW = TOTAL_CODEWORDS[version];
      const dataCW = totalCW - ecCW * numBlocks;
      const gen = generatorPoly(ecCW);

      // Build data codewords
      const bits = [];
      const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
      pushBits(MODE_BYTE, 4);
      pushBits(data.length, version <= 9 ? 8 : 16);
      for (let i = 0; i < data.length; i++) pushBits(data[i], 8);
      // Terminator
      const termLen = Math.min(4, dataCW * 8 - bits.length);
      pushBits(0, termLen);
      // Pad to byte boundary
      while (bits.length % 8) bits.push(0);
      // Pad bytes
      const padBytes = [0xEC, 0x11];
      let padIdx = 0;
      while (bits.length < dataCW * 8) {
        pushBits(padBytes[padIdx], 8);
        padIdx = (padIdx + 1) % 2;
      }

      // Convert to codewords
      const dataCodewords = [];
      for (let i = 0; i < bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
        dataCodewords.push(b);
      }

      // Split into blocks
      const blockSizes = [];
      const totalDataCW = dataCW;
      const baseSize = Math.floor(totalDataCW / numBlocks);
      const extraBlocks = totalDataCW % numBlocks;
      for (let i = 0; i < numBlocks; i++) {
        blockSizes.push(baseSize + (i < extraBlocks ? 1 : 0));
      }

      // Generate EC for each block
      const dataBlocks = [];
      const ecBlocks = [];
      let offset = 0;
      for (let i = 0; i < numBlocks; i++) {
        const block = dataCodewords.slice(offset, offset + blockSizes[i]);
        offset += blockSizes[i];
        dataBlocks.push(block);
        const ec = polyMod(block, gen);
        ecBlocks.push(Array.from(ec));
      }

      // Interleave data
      const result = [];
      const maxDataLen = Math.max(...blockSizes);
      for (let i = 0; i < maxDataLen; i++) {
        for (let j = 0; j < numBlocks; j++) {
          if (i < dataBlocks[j].length) result.push(dataBlocks[j][i]);
        }
      }
      // Interleave EC
      for (let i = 0; i < ecCW; i++) {
        for (let j = 0; j < numBlocks; j++) {
          result.push(ecBlocks[j][i]);
        }
      }

      // Convert to matrix
      const matrix = Array.from({ length: size }, () => new Uint8Array(size));
      const reserved = Array.from({ length: size }, () => new Uint8Array(size));

      // Place finder patterns
      const placeFinder = (row, col) => {
        for (let r = -1; r <= 7; r++) {
          for (let c = -1; c <= 7; c++) {
            const mr = row + r, mc = col + c;
            if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
            if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
              matrix[mr][mc] = 1;
            }
            reserved[mr][mc] = 1;
          }
        }
      };
      placeFinder(0, 0);
      placeFinder(0, size - 7);
      placeFinder(size - 7, 0);

      // Timing patterns
      for (let i = 8; i < size - 8; i++) {
        matrix[6][i] = i % 2 === 0 ? 1 : 0;
        matrix[i][6] = i % 2 === 0 ? 1 : 0;
        reserved[6][i] = 1;
        reserved[i][6] = 1;
      }

      // Alignment patterns
      const alignPos = ALIGN_POS[version];
      for (let i = 0; i < alignPos.length; i++) {
        for (let j = 0; j < alignPos.length; j++) {
          const r = alignPos[i], c = alignPos[j];
          if (reserved[r][c]) continue;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              matrix[r + dr][c + dc] = (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) ? 1 : 0;
              reserved[r + dr][c + dc] = 1;
            }
          }
        }
      }

      // Dark module
      matrix[size - 8][8] = 1;
      reserved[size - 8][8] = 1;

      // Reserve format info areas
      // First copy: around upper-left finder
      for (let i = 0; i < 6; i++) {
        reserved[8][i] = 1;
        reserved[5 - i][8] = 1;
      }
      reserved[8][7] = 1;
      reserved[8][8] = 1;
      reserved[7][8] = 1;
      // Second copy: lower-left (7 modules)
      for (let i = 0; i < 7; i++) {
        reserved[size - 1 - i][8] = 1;
      }
      // Second copy: upper-right (8 modules)
      for (let i = 7; i < 15; i++) {
        reserved[8][size - 15 + i] = 1;
      }
      // Reserve version areas
      if (version >= 7) {
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 3; j++) {
            reserved[i][size - 11 + j] = 1;
            reserved[size - 11 + j][i] = 1;
          }
        }
      }

      // Place data
      let bitIdx = 0;
      const allBits = [];
      for (let i = 0; i < result.length; i++) {
        for (let b = 7; b >= 0; b--) allBits.push((result[i] >> b) & 1);
      }
      let col = size - 1;
      let upward = true;
      while (col >= 0) {
        if (col === 6) col--;
        const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
        for (const row of rows) {
          for (let dc = 0; dc <= 1; dc++) {
            const c = col - dc;
            if (c < 0 || reserved[row][c]) continue;
            matrix[row][c] = bitIdx < allBits.length ? allBits[bitIdx] : 0;
            bitIdx++;
          }
        }
        upward = !upward;
        col -= 2;
      }

      // Select best mask per QR spec (penalty N1-N4)
      const masks = [
        (r, c) => (r + c) % 2 === 0,
        (r, c) => r % 2 === 0,
        (r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
        (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
        (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
      ];

      let bestMaskIdx = 0;
      let bestScore = Infinity;
      let bestMatrix = null;

      for (let candidateMaskIdx = 0; candidateMaskIdx < masks.length; candidateMaskIdx++) {
        const candidate = cloneMatrix(matrix);
        applyMask(candidate, reserved, masks[candidateMaskIdx]);
        placeFormatInfo(candidate, FORMAT_INFO[EC_FORMAT_BITS[ecLevel] * 8 + candidateMaskIdx]);
        const score = calculatePenalty(candidate);
        if (score < bestScore) {
          bestScore = score;
          bestMaskIdx = candidateMaskIdx;
          bestMatrix = candidate;
        }
      }

      if (!bestMatrix) return null;
      for (let r = 0; r < size; r++) matrix[r] = bestMatrix[r];

      return { matrix, size, reserved };
    }

    function getMaxDataBytes(ecLevel) {
      const ordinal = EC_ORDINAL[ecLevel] ?? 0;
      const version = 40;
      const dataCW = TOTAL_CODEWORDS[version] - ECC_CODEWORDS_PER_BLOCK[ordinal][version] * NUM_ECC_BLOCKS[ordinal][version];
      const countBits = 16;
      return Math.floor((dataCW * 8 - 4 - countBits) / 8);
    }

    return { encode, getMaxDataBytes };
  })();

  /* ── QR encode cache ───────────────────────────────────── */
  const _qrCache = new Map();
  function _getEncodedQR(page) {
    const key = `${_ec}:${Array.from(page.bytes).join(',')}`;
    if (!_qrCache.has(key)) _qrCache.set(key, _QR.encode(page.bytes, _ec));
    return _qrCache.get(key);
  }

  /* ── deflate (CompressionStream API) ───────────────────── */
  const _hasCompression = typeof CompressionStream !== 'undefined';

  async function _deflate(text) {
    if (!_hasCompression) return new TextEncoder().encode(text);
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(new TextEncoder().encode(text));
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }

  /* ── text helpers ──────────────────────────────────────── */
  function _getSelectedText() {
    if (!_ta) return '';
    const s = _ta.selectionStart;
    const e = _ta.selectionEnd;
    if (s !== e) return _ta.value.substring(s, e);
    return '';
  }

  function _getBlockText() {
    if (!_ta) return '';
    return _ta.value || '';
  }

  function _getText() {
    const sel = _getSelectedText();
    if (sel) return { text: sel, source: 'selection' };
    return { text: _getBlockText(), source: 'block' };
  }

  function _getBlockTitle() {
    if (!_ta) return '';
    const block = _ta.closest('.block');
    const titleEl = block?.querySelector('.block-title');
    return titleEl?.textContent?.trim() || '';
  }

  /* ── QR generation + split ─────────────────────────────── */
  async function _splitText(text) {
    let useCompress = _compress && _hasCompression;
    let bytes;
    if (useCompress) {
      try {
        bytes = await _deflate(text);
      } catch {
        useCompress = false;
        bytes = new TextEncoder().encode(text);
      }
    } else {
      bytes = new TextEncoder().encode(text);
    }

    const headerSize = 4; // version(1) + page(1) + total(1) + flags(1)
    const qrCapacity = _QR.getMaxDataBytes(_ec);

    if (bytes.length + headerSize <= qrCapacity) {
      const header = new Uint8Array([1, 0, 1, useCompress ? 1 : 0]);
      const full = new Uint8Array(header.length + bytes.length);
      full.set(header);
      full.set(bytes, header.length);
      return [{ bytes: full, text, compressed: useCompress, page: 0, total: 1 }];
    }

    const chunkSize = qrCapacity - headerSize;
    const rawPages = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      rawPages.push(bytes.slice(i, i + chunkSize));
    }
    if (rawPages.length > 255) {
      throw new Error('Текст слишком длинный для QR-кода');
    }
    return rawPages.map((chunk, idx) => {
      const header = new Uint8Array([1, idx, rawPages.length, useCompress ? 1 : 0]);
      const full = new Uint8Array(header.length + chunk.length);
      full.set(header);
      full.set(chunk, header.length);
      return { bytes: full, text: '', compressed: useCompress, page: idx, total: rawPages.length };
    });
  }

  /* ── rebuild preview (for settings changes) ────────────── */
  async function _rebuildCurrentPreview() {
    if (!_previewText || !_previewText.trim()) {
      _pages = [];
      _currentPage = 0;
      _renderPreview();
      return;
    }
    const id = ++_generationId;
    _panel?.classList.add('qr-panel-loading');
    try {
      const pages = await _splitText(_previewText);
      if (id !== _generationId) return;
      _pages = pages;
      _currentPage = 0;
      _qrCache.clear();
      _renderPreview();
    } catch (err) {
      _showToast(err.message || 'Не удалось подготовить QR-код');
    } finally {
      _panel?.classList.remove('qr-panel-loading');
    }
  }

  async function _generateQR({ addHistory = true } = {}) {
    const genId = ++_generationId;
    const { text, source } = _getText();
    if (!text || !text.trim()) {
      _pages = [];
      _currentPage = 0;
      _renderPreview();
      return;
    }
    if (text === _lastText && _ta?.selectionStart === _lastSelStart && _ta?.selectionEnd === _lastSelEnd) return;

    _panel?.classList.add('qr-panel-loading');
    let pages;
    try {
      pages = await _splitText(text);
    } catch (err) {
      _lastText = '\x00'; // invalidate cache on error
      _showToast(err.message || 'Не удалось подготовить QR-код');
      _panel?.classList.remove('qr-panel-loading');
      return;
    }
    _panel?.classList.remove('qr-panel-loading');
    if (!_isOpen || genId !== _generationId) return; // stale or closed
    _lastText = text;
    _lastSelStart = _ta?.selectionStart ?? -1;
    _lastSelEnd = _ta?.selectionEnd ?? -1;
    _pages = pages;
    _currentPage = 0;
    _previewText = text;
    _previewSource = source;
    _qrCache.clear();
    _renderPreview();
    if (addHistory) _addToHistory(text, source);
  }

  /* ── history ───────────────────────────────────────────── */
  function _addToHistory(text, source) {
    if (!text || !text.trim()) return;
    const entry = {
      text,                              // store full text
      source,
      ts: Date.now(),
    };
    // Deduplicate by exact text
    _history = _history.filter(h => h.text !== entry.text);
    _history.unshift(entry);
    if (_history.length > HISTORY_MAX) _history.length = HISTORY_MAX;
    try { _storageSet(HISTORY_KEY, JSON.stringify(_history)); } catch { /* quota */ }
    _renderHistory();
  }

  function _renderHistory() {
    const list = _panel?.querySelector('.qr-history-list');
    if (!list) return;
    list.textContent = '';
    if (!_history.length) {
      const empty = document.createElement('div');
      empty.className = 'qr-history-empty';
      empty.textContent = 'Пока нет записей';
      list.appendChild(empty);
      return;
    }
    for (const entry of _history) {
      const item = document.createElement('div');
      item.className = 'qr-history-item';
      const preview = document.createElement('span');
      preview.className = 'qr-history-preview';
      const len = entry.text.length;
      preview.textContent = entry.text.substring(0, 80) + (len > 80 ? '...' : '');
      const meta = document.createElement('span');
      meta.className = 'qr-history-meta';
      const date = new Date(entry.ts);
      meta.textContent = `${len} симв. · ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      item.append(preview, meta);
      item.onclick = async () => {
        const id = ++_generationId;
        let pages;
        try {
          pages = await _splitText(entry.text);
        } catch (err) {
          _showToast(err.message || 'Не удалось подготовить QR-код');
          return;
        }
        if (id !== _generationId) return;
        _pages = pages;
        _currentPage = 0;
        _previewText = entry.text;
        _previewSource = 'history';
        _lastText = entry.text;
        _lastSelStart = -1;
        _lastSelEnd = -1;
        _renderPreview();
        _switchTab('preview');
      };
      list.appendChild(item);
    }
  }

  /* ── canvas rendering ──────────────────────────────────── */
  function _renderPreview() {
    const canvas = _panel?.querySelector('.qr-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pageEl = _panel?.querySelector('.qr-page-info');
    const statsEl = _panel?.querySelector('.qr-stats');
    const sourceEl = _panel?.querySelector('.qr-source-label');
    const navPrev = _panel?.querySelector('.qr-nav-prev');
    const navNext = _panel?.querySelector('.qr-nav-next');
    const infoRow = _panel?.querySelector('.qr-info-row');

    if (!_pages.length) {
      canvas.width = 1;
      canvas.height = 1;
      if (statsEl) statsEl.textContent = 'Нет данных';
      if (sourceEl) sourceEl.textContent = '';
      if (pageEl) pageEl.textContent = '';
      if (navPrev) navPrev.disabled = true;
      if (navNext) navNext.disabled = true;
      if (infoRow) infoRow.innerHTML = '';
      return;
    }

    const page = _pages[_currentPage];
    const qr = _getEncodedQR(page);
    if (!qr) {
      canvas.width = 1;
      canvas.height = 1;
      if (statsEl) statsEl.textContent = 'Ошибка: данные слишком велики';
      return;
    }

    const modSize = _moduleSize;
    const quiet = _padding ? 4 : 0; // quiet zone
    const totalSize = (qr.size + quiet * 2) * modSize;
    canvas.width = totalSize;
    canvas.height = totalSize;

    // Background
    ctx.fillStyle = _bg;
    ctx.fillRect(0, 0, totalSize, totalSize);

    // Draw modules — function modules use classic style, data modules use selected style
    ctx.fillStyle = _fg;
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (!qr.matrix[r][c]) continue;
        const x = (c + quiet) * modSize;
        const y = (r + quiet) * modSize;
        _drawModule(ctx, x, y, modSize, qr.reserved[r][c] ? 'classic' : _style);
      }
    }

    // Update UI
    if (pageEl) pageEl.textContent = _pages.length > 1 ? `Стр. ${_currentPage + 1} из ${_pages.length}` : '1 / 1';
    if (navPrev) navPrev.disabled = _currentPage <= 0;
    if (navNext) navNext.disabled = _currentPage >= _pages.length - 1;

    if (statsEl) statsEl.textContent = `${_previewText.length} символов · ${_pages.length} стр.`;
    if (sourceEl) {
      if (_previewSource === 'selection') sourceEl.textContent = 'Выделенный текст';
      else if (_previewSource === 'history') sourceEl.textContent = 'Из истории';
      else {
        const title = _getBlockTitle();
        sourceEl.textContent = title ? `Блок: ${title}` : 'Весь блок';
      }
    }
    if (infoRow) {
      infoRow.textContent = '';
      const badges = [];
      if (page.compressed) badges.push('deflate');
      badges.push(`v1-${_ec}`);
      badges.push(`${page.bytes.length} байт`);
      if (_pages.length > 1) badges.push(`${_currentPage + 1} из ${_pages.length}`);
      for (const b of badges) {
        const el = document.createElement('span');
        el.className = 'qr-info-badge';
        el.textContent = b;
        infoRow.appendChild(el);
      }
    }
  }

  function _drawModule(ctx, x, y, size, style) {
    switch (style) {
      case 'dotted':
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'rounded':
        ctx.beginPath();
        const r = size * 0.3;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + size - r, y);
        ctx.arcTo(x + size, y, x + size, y + r, r);
        ctx.lineTo(x + size, y + size - r);
        ctx.arcTo(x + size, y + size, x + size - r, y + size, r);
        ctx.lineTo(x + r, y + size);
        ctx.arcTo(x, y + size, x, y + size - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.fill();
        break;
      case 'diamond':
        ctx.save();
        ctx.translate(x + size / 2, y + size / 2);
        ctx.rotate(Math.PI / 4);
        const s = size / 2.8;
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.restore();
        break;
      default: // classic
        ctx.fillRect(x, y, size, size);
    }
  }

  /* ── build panel DOM ───────────────────────────────────── */
  function _buildPanel() {
    if (_panel) return;

    const p = document.createElement('div');
    p.className = 'qr-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'QR-код');

    // Restore position/size
    const savedPos = _readJSON('qr-panel-pos', null);
    const savedSize = _readJSON('qr-panel-size', null);
    const w = Number.isFinite(savedSize?.w) ? Math.max(PANEL_MIN_W, Math.min(500, savedSize.w)) : PANEL_DEFAULT_W;
    const h = Number.isFinite(savedSize?.h) ? Math.max(PANEL_MIN_H, Math.min(700, savedSize.h)) : PANEL_DEFAULT_H;
    p.style.width = w + 'px';
    p.style.height = h + 'px';
    if (Number.isFinite(savedPos?.left) && Number.isFinite(savedPos?.top)) {
      p.style.left = savedPos.left + 'px';
      p.style.top = savedPos.top + 'px';
    } else {
      p.style.left = Math.max(0, (window.innerWidth - w) / 2) + 'px';
      p.style.top = Math.max(0, (window.innerHeight - h) / 2) + 'px';
    }

    // Header
    const header = document.createElement('div');
    header.className = 'qr-header';
    const title = document.createElement('span');
    title.className = 'qr-title';
    title.textContent = 'QR-код';
    const stats = document.createElement('span');
    stats.className = 'qr-stats';
    stats.textContent = 'Нет данных';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qr-close-btn';
    closeBtn.title = 'Закрыть';
    closeBtn.setAttribute('aria-label', 'Закрыть панель QR-кода');
    closeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>';
    closeBtn.onclick = () => close();
    header.append(title, stats, closeBtn);
    p.appendChild(header);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'qr-tabs';
    tabs.setAttribute('role', 'tablist');
    const tabDefs = [
      { id: 'preview', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="3" height="3" rx="0.5"/></svg>', title: 'Просмотр' },
      { id: 'style', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5"/><path d="M8 3v10M3 8h10"/></svg>', title: 'Стиль' },
      { id: 'export', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 12h10"/></svg>', title: 'Экспорт' },
      { id: 'history', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.5l2.5 1.5"/></svg>', title: 'История' },
    ];
    for (const def of tabDefs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qr-tab' + (def.id === _activeTab ? ' active' : '');
      btn.dataset.tab = def.id;
      btn.title = def.title;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-label', def.title);
      btn.setAttribute('aria-selected', def.id === _activeTab ? 'true' : 'false');
      btn.innerHTML = def.icon;
      btn.onclick = () => _switchTab(def.id);
      tabs.appendChild(btn);
    }
    p.appendChild(tabs);

    // Tab content
    const content = document.createElement('div');
    content.className = 'qr-tab-content';

    // ── Preview pane ──
    const previewPane = document.createElement('div');
    previewPane.className = 'qr-tab-pane' + (_activeTab === 'preview' ? ' active' : '');
    previewPane.dataset.tab = 'preview';

    const sourceLabel = document.createElement('div');
    sourceLabel.className = 'qr-source-label';

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'qr-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'qr-canvas';
    canvasWrap.appendChild(canvas);

    const nav = document.createElement('div');
    nav.className = 'qr-nav';
    const navPrev = document.createElement('button');
    navPrev.type = 'button';
    navPrev.className = 'qr-nav-btn qr-nav-prev';
    navPrev.title = 'Предыдущая страница';
    navPrev.textContent = '\u25C0';
    navPrev.disabled = true;
    navPrev.onclick = () => { if (_currentPage > 0) { _currentPage--; _renderPreview(); } };
    const pageInfo = document.createElement('span');
    pageInfo.className = 'qr-page-info';
    pageInfo.textContent = '';
    const navNext = document.createElement('button');
    navNext.type = 'button';
    navNext.className = 'qr-nav-btn qr-nav-next';
    navNext.title = 'Следующая страница';
    navNext.textContent = '\u25B6';
    navNext.disabled = true;
    navNext.onclick = () => { if (_currentPage < _pages.length - 1) { _currentPage++; _renderPreview(); } };
    nav.append(navPrev, pageInfo, navNext);

    const infoRow = document.createElement('div');
    infoRow.className = 'qr-info-row';

    previewPane.append(sourceLabel, canvasWrap, nav, infoRow);
    content.appendChild(previewPane);

    // ── Style pane ──
    const stylePane = document.createElement('div');
    stylePane.className = 'qr-tab-pane' + (_activeTab === 'style' ? ' active' : '');
    stylePane.dataset.tab = 'style';

    // Style grid
    stylePane.appendChild(_buildSectionLabel('Формат точек'));
    const styleGrid = document.createElement('div');
    styleGrid.className = 'qr-style-grid';
    const styles = [
      { id: 'classic', name: 'Классический' },
      { id: 'dotted', name: 'Точечный' },
      { id: 'rounded', name: 'Скруглённый' },
      { id: 'diamond', name: 'Ромбы' },
    ];
    for (const s of styles) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qr-style-btn' + (s.id === _style ? ' active' : '');
      btn.dataset.style = s.id;
      btn.title = s.name;
      const icon = document.createElement('div');
      icon.className = 'qr-style-icon';
      for (let i = 0; i < 9; i++) icon.appendChild(document.createElement('span'));
      const name = document.createElement('span');
      name.className = 'qr-style-name';
      name.textContent = s.name;
      btn.append(icon, name);
      btn.onclick = () => {
        _style = s.id;
        _storageSet('qr-style', s.id);
        styleGrid.querySelectorAll('.qr-style-btn').forEach(b => b.classList.toggle('active', b.dataset.style === s.id));
        _renderPreview();
      };
      styleGrid.appendChild(btn);
    }
    stylePane.appendChild(styleGrid);

    // Module size slider
    stylePane.appendChild(_buildSectionLabel('Размер модуля'));
    const sliderRow = document.createElement('div');
    sliderRow.className = 'qr-slider-row';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'qr-slider';
    slider.min = '4';
    slider.max = '12';
    slider.value = String(_moduleSize);
    const sliderVal = document.createElement('span');
    sliderVal.className = 'qr-slider-val';
    sliderVal.textContent = _moduleSize + ' px';
    slider.oninput = () => {
      _moduleSize = parseInt(slider.value, 10);
      _storageSet('qr-module-size', String(_moduleSize));
      sliderVal.textContent = _moduleSize + ' px';
      _renderPreview();
    };
    sliderRow.append(slider, sliderVal);
    stylePane.appendChild(sliderRow);

    // Colors
    stylePane.appendChild(_buildSectionLabel('Цвет'));
    const fgRow = _buildColorRow('Передний план', 'fg', _fg, '#000000');
    const bgRow = _buildColorRow('Фон', 'bg', _bg, '#FFFFFF');
    stylePane.append(fgRow, bgRow);

    // Contrast warning
    const contrastWarn = document.createElement('div');
    contrastWarn.className = 'qr-contrast-warn';
    contrastWarn.id = 'qr-contrast-warn';
    stylePane.appendChild(contrastWarn);
    _updateContrastWarning();

    // Color picker popup
    const pickerPopup = _buildColorPicker();
    stylePane.appendChild(pickerPopup);

    // EC level
    stylePane.appendChild(_buildSectionLabel('Коррекция ошибок'));
    const ecGroup = document.createElement('div');
    ecGroup.className = 'qr-ec-group';
    const ecLevels = [
      { id: 'L', label: 'L', desc: '7%' },
      { id: 'M', label: 'M', desc: '15%' },
      { id: 'Q', label: 'Q', desc: '25%' },
      { id: 'H', label: 'H', desc: '30%' },
    ];
    for (const ec of ecLevels) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qr-ec-btn' + (ec.id === _ec ? ' active' : '');
      btn.dataset.ec = ec.id;
      btn.title = `Коррекция ошибок: ${ec.desc}`;
      btn.textContent = `${ec.label} ${ec.desc}`;
      btn.onclick = () => {
        _ec = ec.id;
        _storageSet('qr-ec', ec.id);
        ecGroup.querySelectorAll('.qr-ec-btn').forEach(b => b.classList.toggle('active', b.dataset.ec === ec.id));
        _rebuildCurrentPreview();
      };
      ecGroup.appendChild(btn);
    }
    const ecNote = document.createElement('span');
    ecNote.className = 'qr-ec-note';
    ecNote.textContent = 'авто';
    stylePane.append(ecGroup, ecNote);

    content.appendChild(stylePane);

    // ── Export pane ──
    const exportPane = document.createElement('div');
    exportPane.className = 'qr-tab-pane' + (_activeTab === 'export' ? ' active' : '');
    exportPane.dataset.tab = 'export';

    const exportBtns = [
      { label: 'Копировать в буфер', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 014.5 2H11"/></svg>', action: _copyToClipboard },
      { label: 'Скачать PNG', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 12h10"/></svg>', action: () => _download('png') },
      { label: 'Скачать SVG', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 12h10"/></svg>', action: () => _download('svg') },
    ];
    for (const def of exportBtns) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qr-export-btn';
      btn.innerHTML = def.icon + ' ' + def.label;
      btn.onclick = def.action;
      exportPane.appendChild(btn);
    }

    // Export options
    const opts = document.createElement('div');
    opts.className = 'qr-export-opts';

    const compressToggle = _buildToggle('Deflate-сжатие', _compress, v => {
      _compress = v;
      _storageSet('qr-compress', String(v));
      _rebuildCurrentPreview();
    });
    const paddingToggle = _buildToggle('Padding 4px', _padding, v => {
      _padding = v;
      _storageSet('qr-padding', String(v));
      _renderPreview();
    });
    opts.append(compressToggle, paddingToggle);
    exportPane.appendChild(opts);

    content.appendChild(exportPane);

    // ── History pane ──
    const historyPane = document.createElement('div');
    historyPane.className = 'qr-tab-pane' + (_activeTab === 'history' ? ' active' : '');
    historyPane.dataset.tab = 'history';

    const historyHeader = document.createElement('div');
    historyHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const historyLabel = document.createElement('span');
    historyLabel.className = 'qr-section-label';
    historyLabel.textContent = 'История';
    const historyClear = document.createElement('button');
    historyClear.type = 'button';
    historyClear.className = 'qr-export-btn';
    historyClear.style.cssText = 'padding:4px 8px;font-size:11px;';
    historyClear.textContent = 'Очистить';
    historyClear.onclick = () => { _history = []; try { localStorage.removeItem(HISTORY_KEY); } catch {} _renderHistory(); };
    historyHeader.append(historyLabel, historyClear);
    historyPane.appendChild(historyHeader);

    const historyList = document.createElement('div');
    historyList.className = 'qr-history-list';
    historyPane.appendChild(historyList);

    content.appendChild(historyPane);
    p.appendChild(content);

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'qr-resize-handle';
    resizeHandle.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2L2 10M10 6L6 10M10 10L10 10"/></svg>';
    p.appendChild(resizeHandle);

    // Store refs
    _panel = p;
    _panel._resizeHandle = resizeHandle;
    _panel._header = header;

    // Attach drag/resize start listeners
    header.addEventListener('mousedown', _onDragStart);
    resizeHandle.addEventListener('mousedown', _onResizeStart);

    document.body.appendChild(p);
    _clampPanelToViewport();
  }

  function _buildSectionLabel(text) {
    const el = document.createElement('span');
    el.className = 'qr-section-label';
    el.textContent = text;
    return el;
  }

  function _buildColorRow(label, target, currentColor, defaultColor) {
    const row = document.createElement('div');
    row.className = 'qr-color-row';
    const lbl = document.createElement('span');
    lbl.className = 'qr-section-label';
    lbl.style.minWidth = '100px';
    lbl.textContent = label;
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'qr-color-swatch-btn';
    swatch.dataset.target = target;
    swatch.style.background = currentColor;
    swatch.title = 'Выбрать цвет';
    swatch.onclick = (e) => {
      e.stopPropagation();
      _openColorPicker(target, swatch);
    };
    const hex = document.createElement('span');
    hex.className = 'qr-color-hex';
    hex.textContent = currentColor;
    hex.id = `qr-color-hex-${target}`;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'qr-color-reset';
    reset.title = 'Сбросить';
    reset.textContent = '\u21BA';
    reset.onclick = (e) => {
      e.stopPropagation();
      if (target === 'fg') _fg = defaultColor;
      else _bg = defaultColor;
      _storageSet(`qr-${target}`, target === 'fg' ? _fg : _bg);
      swatch.style.background = target === 'fg' ? _fg : _bg;
      hex.textContent = target === 'fg' ? _fg : _bg;
      _renderPreview();
      _updateContrastWarning();
    };
    row.append(lbl, swatch, hex, reset);
    return row;
  }

  function _buildToggle(label, checked, onChange) {
    const labelEl = document.createElement('label');
    labelEl.className = 'qr-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.onchange = () => onChange(input.checked);
    const track = document.createElement('span');
    track.className = 'qr-toggle-track';
    const text = document.createTextNode(label);
    labelEl.append(input, track, text);
    return labelEl;
  }

  /* ── color picker ──────────────────────────────────────── */
  function _buildColorPicker() {
    const popup = document.createElement('div');
    popup.className = 'qr-picker-popup';
    popup.id = 'qr-picker-popup';

    // Hue ring canvas
    const hueArea = document.createElement('div');
    hueArea.className = 'qr-picker-area';
    const hueCanvas = document.createElement('canvas');
    hueCanvas.className = 'qr-picker-hue-ring';
    hueCanvas.width = 200;
    hueCanvas.height = 200;
    hueArea.appendChild(hueCanvas);

    const hueCursor = document.createElement('div');
    hueCursor.className = 'qr-picker-hue-cursor';
    hueArea.appendChild(hueCursor);

    // SB square canvas
    const sbArea = document.createElement('div');
    sbArea.className = 'qr-picker-sb';
    const sbCanvas = document.createElement('canvas');
    sbCanvas.width = 140;
    sbCanvas.height = 140;
    sbArea.appendChild(sbCanvas);

    const sbCursor = document.createElement('div');
    sbCursor.className = 'qr-picker-sb-cursor';
    sbArea.appendChild(sbCursor);

    hueArea.appendChild(sbArea);
    popup.appendChild(hueArea);

    // Hex row
    const hexRow = document.createElement('div');
    hexRow.className = 'qr-picker-hex-row';
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'qr-picker-hex-input';
    hexInput.maxLength = 7;
    hexInput.placeholder = '#000000';
    hexInput.onchange = () => {
      const v = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        _applyPickerColor(v);
      }
    };
    const pipette = document.createElement('button');
    pipette.type = 'button';
    pipette.className = 'qr-picker-pipette';
    pipette.title = 'Пипетка';
    pipette.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 2l1 1-2 2-1-1-8 8-2 1 1-2 8-8-1-1z"/></svg>';
    pipette.onclick = async () => {
      if (!window.EyeDropper) { _showToast('Пипетка не поддерживается в этом браузере'); return; }
      try {
        const dropper = new EyeDropper();
        const result = await dropper.open();
        _applyPickerColor(result.sRGBHex);
        hexInput.value = result.sRGBHex;
      } catch (_) {}
    };
    hexRow.append(hexInput, pipette);
    popup.appendChild(hexRow);

    // Swatches
    const swatches = document.createElement('div');
    swatches.className = 'qr-picker-swatches';
    const swatchColors = ['#000000', '#FFFFFF', '#4F8EF7', '#E74C3C', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C', '#E67E22'];
    for (const c of swatchColors) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'qr-picker-swatch';
      sw.style.background = c;
      sw.title = c;
      sw.onclick = () => _applyPickerColor(c);
      swatches.appendChild(sw);
    }
    popup.appendChild(swatches);

    // Draw hue ring
    _drawHueRing(hueCanvas);

    // Hue ring interaction
    let hueDragging = false;
    const _onHueMove = (e) => {
      const rect = hueArea.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const dx = e.clientX - rect.left - cx;
      const dy = e.clientY - rect.top - cy;
      _pickerHue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      _updateSBSquare(sbCanvas, _pickerHue);
      _updatePickerCursors(hueCursor, sbCursor, hueArea, sbArea);
      _applyPickerFromHSV();
    };
    hueArea.addEventListener('mousedown', (e) => {
      if (e.target === sbCanvas || sbArea.contains(e.target)) return;
      hueDragging = true;
      _onHueMove(e);
    });
    document.addEventListener('mousemove', (e) => {
      if (hueDragging) _onHueMove(e);
    });
    document.addEventListener('mouseup', () => { hueDragging = false; });

    // SB square interaction
    let sbDragging = false;
    const _onSBMove = (e) => {
      const rect = sbArea.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      _pickerSat = x;
      _pickerVal = 1 - y;
      _updatePickerCursors(hueCursor, sbCursor, hueArea, sbArea);
      _applyPickerFromHSV();
    };
    sbArea.addEventListener('mousedown', (e) => {
      sbDragging = true;
      _onSBMove(e);
    });
    document.addEventListener('mousemove', (e) => {
      if (sbDragging) _onSBMove(e);
    });
    document.addEventListener('mouseup', () => { sbDragging = false; });

    // Click outside to close
    document.addEventListener('mousedown', (e) => {
      if (_pickerOpen && !popup.contains(e.target) && !e.target.closest('.qr-color-swatch-btn')) {
        _closeColorPicker();
      }
    });

    return popup;
  }

  function _drawHueRing(canvas) {
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const outerR = canvas.width / 2 - 2;
    const innerR = outerR - 20;

    for (let angle = 0; angle < 360; angle += 1) {
      const startAngle = (angle - 1) * Math.PI / 180;
      const endAngle = (angle + 1) * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
      ctx.fill();
    }

    // Clear center
    ctx.beginPath();
    ctx.arc(cx, cy, innerR - 1, 0, Math.PI * 2);
    const centerBg = getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() || '#1e1e2e';
    ctx.fillStyle = centerBg;
    ctx.fill();
  }

  function _updateSBSquare(canvas, hue) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = x / w;
        const v = 1 - y / h;
        ctx.fillStyle = _hsvToHex(hue, s, v);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function _updatePickerCursors(hueCursor, sbCursor, hueArea, sbArea) {
    const hueR = 90; // distance from center to hue ring
    const hueAngle = _pickerHue * Math.PI / 180;
    const hueCx = hueArea.offsetWidth / 2;
    const hueCy = hueArea.offsetHeight / 2;
    hueCursor.style.left = (hueCx + hueR * Math.cos(hueAngle)) + 'px';
    hueCursor.style.top = (hueCy + hueR * Math.sin(hueAngle)) + 'px';
    hueCursor.style.background = `hsl(${_pickerHue}, 100%, 50%)`;

    sbCursor.style.left = (_pickerSat * 100) + '%';
    sbCursor.style.top = ((1 - _pickerVal) * 100) + '%';
    sbCursor.style.background = _hsvToHex(_pickerHue, _pickerSat, _pickerVal);
  }

  function _applyPickerFromHSV() {
    const hex = _hsvToHex(_pickerHue, _pickerSat, _pickerVal);
    _applyPickerColor(hex);
  }

  function _applyPickerColor(hex) {
    if (_pickerTarget === 'fg') _fg = hex;
    else _bg = hex;
    _storageSet(`qr-${_pickerTarget}`, hex);

    const swatch = _panel?.querySelector(`.qr-color-swatch-btn[data-target="${_pickerTarget}"]`);
    const hexEl = document.getElementById(`qr-color-hex-${_pickerTarget}`);
    if (swatch) swatch.style.background = hex;
    if (hexEl) hexEl.textContent = hex;

    const hexInput = _panel?.querySelector('.qr-picker-hex-input');
    if (hexInput) hexInput.value = hex;

    _renderPreview();
    _updateContrastWarning();
  }

  function _hsvToHex(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function _hexToHSV(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
  }

  function _openColorPicker(target, anchorEl) {
    _pickerTarget = target;
    const currentHex = target === 'fg' ? _fg : _bg;
    const hsv = _hexToHSV(currentHex);
    _pickerHue = hsv.h;
    _pickerSat = hsv.s;
    _pickerVal = hsv.v;

    const popup = _panel?.querySelector('.qr-picker-popup');
    if (!popup) return;

    // Position near the anchor
    const anchorRect = anchorEl.getBoundingClientRect();
    const panelRect = _panel.getBoundingClientRect();
    popup.style.left = (anchorRect.left - panelRect.left) + 'px';
    popup.style.top = (anchorRect.bottom - panelRect.top + 4) + 'px';

    // Update hex input
    const hexInput = popup.querySelector('.qr-picker-hex-input');
    if (hexInput) hexInput.value = currentHex;

    // Draw SB square
    const sbCanvas = popup.querySelector('.qr-picker-sb canvas');
    if (sbCanvas) _updateSBSquare(sbCanvas, _pickerHue);

    // Update cursors
    const hueCursor = popup.querySelector('.qr-picker-hue-cursor');
    const sbCursor = popup.querySelector('.qr-picker-sb-cursor');
    const hueArea = popup.querySelector('.qr-picker-area');
    const sbArea = popup.querySelector('.qr-picker-sb');
    if (hueCursor && sbCursor && hueArea && sbArea) {
      _updatePickerCursors(hueCursor, sbCursor, hueArea, sbArea);
    }

    popup.classList.add('open');
    _pickerOpen = true;
  }

  /* ── contrast warning ──────────────────────────────────── */
  function _contrastRatio(fg, bg) {
    const luminance = hex => {
      const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
      const linear = rgb.map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const a = luminance(fg), b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function _updateContrastWarning() {
    const el = document.getElementById('qr-contrast-warn');
    if (!el) return;
    const ratio = _contrastRatio(_fg, _bg);
    if (ratio < 3) {
      el.textContent = `Низкий контраст (${ratio.toFixed(1)}:1) — QR может не сканироваться`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  function _closeColorPicker() {
    const popup = _panel?.querySelector('.qr-picker-popup');
    if (popup) popup.classList.remove('open');
    _pickerOpen = false;
    _pickerTarget = null;
  }

  /* ── tabs ──────────────────────────────────────────────── */
  function _switchTab(tabId) {
    _activeTab = tabId;
    _storageSet('qr-panel-tab', tabId);
    _panel?.querySelectorAll('.qr-tab').forEach(t => {
      const active = t.dataset.tab === tabId;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    _panel?.querySelectorAll('.qr-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.tab === tabId));
  }

  /* ── drag ──────────────────────────────────────────────── */
  function _onDragStart(e) {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('canvas')) return;
    _dragging = true;
    _dragOffset.x = e.clientX - _panel.offsetLeft;
    _dragOffset.y = e.clientY - _panel.offsetTop;
    document.body.style.userSelect = 'none';
  }
  function _onDragMove(e) {
    if (!_dragging) return;
    _panel.style.left = (e.clientX - _dragOffset.x) + 'px';
    _panel.style.top = (e.clientY - _dragOffset.y) + 'px';
  }
  function _onDragEnd() {
    if (!_dragging) return;
    _dragging = false;
    document.body.style.userSelect = '';
    _storageSet('qr-panel-pos', JSON.stringify({ left: _panel.offsetLeft, top: _panel.offsetTop }));
  }

  /* ── resize ────────────────────────────────────────────── */
  function _onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    _resizing = true;
    _resizeOffset.x = e.clientX;
    _resizeOffset.y = e.clientY;
    _resizeOffset.w = _panel.offsetWidth;
    _resizeOffset.h = _panel.offsetHeight;
    document.body.style.userSelect = 'none';
  }
  function _onResizeMove(e) {
    if (!_resizing) return;
    const w = Math.max(PANEL_MIN_W, Math.min(500, _resizeOffset.w + e.clientX - _resizeOffset.x));
    const h = Math.max(PANEL_MIN_H, Math.min(700, _resizeOffset.h + e.clientY - _resizeOffset.y));
    _panel.style.width = w + 'px';
    _panel.style.height = h + 'px';
  }
  function _onResizeEnd() {
    if (!_resizing) return;
    _resizing = false;
    document.body.style.userSelect = '';
    _storageSet('qr-panel-size', JSON.stringify({ w: _panel.offsetWidth, h: _panel.offsetHeight }));
  }

  function _clampPanelToViewport() {
    if (!_panel) return;
    const r = _panel.getBoundingClientRect();
    const w = window.innerWidth, h = window.innerHeight;
    let left = _panel.offsetLeft, top = _panel.offsetTop;
    if (left + r.width > w) left = Math.max(0, w - r.width);
    if (top + r.height > h) top = Math.max(0, h - r.height);
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    _panel.style.left = left + 'px';
    _panel.style.top = top + 'px';
  }

  /* ── events ────────────────────────────────────────────── */
  function _onContextMenu(e) {
    if (!_isOpen) return;
    if (_panel && !_panel.contains(e.target)) {
      e.preventDefault();
      close();
    }
  }

  function _onLeftClickOutside(e) {
    if (!_isOpen) return;
    if (_panel && !_panel.contains(e.target)) {
      // Don't close — user is selecting text
      // But switch to new block if clicked on different textarea
      const newTa = e.target.closest?.('.block')?.querySelector('textarea.block-textarea');
      if (newTa && newTa !== _ta) {
        _ta = newTa;
        _lastText = '\x00';
        _scheduleUpdate();
      }
    }
  }

  function _onFocusIn(e) {
    if (!_isOpen) return;
    let newTa = e.target;
    if (!newTa.classList?.contains('block-textarea')) {
      const isNotepad = newTa.tagName === 'TEXTAREA' && newTa.closest('.notepad-body');
      if (!isNotepad) {
        const block = newTa.closest?.('.block');
        newTa = block?.querySelector('textarea.block-textarea') || null;
        if (!newTa) return;
      }
    }
    if (newTa === _ta) return;
    _ta = newTa;
    _lastText = '\x00';
    _scheduleUpdate();
  }

  function _onSelectionChange() {
    if (!_isOpen || !_ta) return;
    const s = _ta.selectionStart;
    const e = _ta.selectionEnd;
    if (s !== _lastSelStart || e !== _lastSelEnd) {
      _scheduleUpdate();
    }
  }

  function _onInput(e) {
    if (!_isOpen || !_ta || e.target !== _ta) return;
    _scheduleUpdate();
  }

  function _onKeydown(e) {
    if (e.key === 'Escape' && _isOpen) {
      e.preventDefault();
      close();
    }
  }

  function _scheduleUpdate() {
    clearTimeout(_updateTimer);
    _updateTimer = setTimeout(_generateQR, DEBOUNCE_SEL);
  }

  function _attachListeners() {
    document.addEventListener('contextmenu', _onContextMenu);
    document.addEventListener('mousedown', _onLeftClickOutside);
    document.addEventListener('focusin', _onFocusIn);
    document.addEventListener('selectionchange', _onSelectionChange);
    document.addEventListener('input', _onInput);
    document.addEventListener('keydown', _onKeydown);
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup', _onDragEnd);
    document.addEventListener('mousemove', _onResizeMove);
    document.addEventListener('mouseup', _onResizeEnd);
  }

  function _detachListeners() {
    document.removeEventListener('contextmenu', _onContextMenu);
    document.removeEventListener('mousedown', _onLeftClickOutside);
    document.removeEventListener('focusin', _onFocusIn);
    document.removeEventListener('selectionchange', _onSelectionChange);
    document.removeEventListener('input', _onInput);
    document.removeEventListener('keydown', _onKeydown);
    document.removeEventListener('mousemove', _onDragMove);
    document.removeEventListener('mouseup', _onDragEnd);
    document.removeEventListener('mousemove', _onResizeMove);
    document.removeEventListener('mouseup', _onResizeEnd);
  }

  /* ── export helpers ────────────────────────────────────── */
  async function _copyToClipboard() {
    const canvas = _panel?.querySelector('.qr-canvas');
    if (!canvas || !_pages.length) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      _showToast('Копирование изображений не поддерживается');
      return;
    }
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('No blob');
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      _showToast('QR скопирован в буфер обмена');
    } catch {
      _showToast('Не удалось скопировать');
    }
  }

  function _download(format) {
    const canvas = _panel?.querySelector('.qr-canvas');
    if (!canvas || !_pages.length) return;

    if (format === 'png') {
      const link = document.createElement('a');
      link.download = 'qr-code.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } else if (format === 'svg') {
      const page = _pages[_currentPage];
      const qr = _getEncodedQR(page);
      if (!qr) return;
      const modSize = _moduleSize;
      const quiet = _padding ? 4 : 0;
      const totalSize = (qr.size + quiet * 2) * modSize;
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">`;
      svg += `<rect width="${totalSize}" height="${totalSize}" fill="${_bg}"/>`;
      for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
          if (!qr.matrix[r][c]) continue;
          const x = (c + quiet) * modSize;
          const y = (r + quiet) * modSize;
          const style = qr.reserved[r][c] ? 'classic' : _style;
          if (style === 'dotted') {
            svg += `<circle cx="${x + modSize / 2}" cy="${y + modSize / 2}" r="${modSize / 2}" fill="${_fg}"/>`;
          } else if (style === 'rounded') {
            const rad = modSize * 0.3;
            svg += `<rect x="${x}" y="${y}" width="${modSize}" height="${modSize}" rx="${rad}" fill="${_fg}"/>`;
          } else if (style === 'diamond') {
            const cx = x + modSize / 2, cy = y + modSize / 2;
            const s = modSize / 2.8;
            svg += `<rect x="${cx - s}" y="${cy - s}" width="${s * 2}" height="${s * 2}" fill="${_fg}" transform="rotate(45 ${cx} ${cy})"/>`;
          } else {
            svg += `<rect x="${x}" y="${y}" width="${modSize}" height="${modSize}" fill="${_fg}"/>`;
          }
        }
      }
      svg += '</svg>';
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const link = document.createElement('a');
      link.download = 'qr-code.svg';
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    }
  }

  function _showToast(msg) {
    let toast = document.querySelector('.qr-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'qr-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2500);
  }

  /* ── public API ────────────────────────────────────────── */
  function open(ta) {
    _ta = ta;
    _buildPanel();
    _panel.style.display = 'flex';
    _clampPanelToViewport();
    _isOpen = true;
    _lastText = '\x00';
    _lastSelStart = -1;
    _lastSelEnd = -1;
    _generateQR();
    _renderHistory();
    _attachListeners();
  }

  function close() {
    ++_generationId; // invalidate any pending async generation
    if (_panel) _panel.style.display = 'none';
    _isOpen = false;
    _closeColorPicker();
    clearTimeout(_updateTimer);
    _updateTimer = null;
    _detachListeners();
  }

  function toggle(ta) {
    if (_isOpen && _ta === ta) { close(); return; }
    open(ta);
  }

  function setupButton(btn, ta) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle(ta);
    });
  }

  return { open, close, toggle, setupButton };
})();

window.QRPanel = QRPanel;
