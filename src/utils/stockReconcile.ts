// src/utils/stockReconcile.ts
// ✅ Đối soát tồn thực tế (file Excel) với tồn hệ thống.
//  - Đọc file: tự dò dòng tiêu đề + cột Mã / Tên / Số lượng (người dùng chỉnh lại được)
//  - Ghép: (1) trùng mã  (2) trùng tên  (3) gần giống (mã hoặc tên giống >= ngưỡng) -> nhóm vàng
//  - Còn lại: không khớp -> đỏ (có trong file mà không có trong hệ thống, hoặc ngược lại)
// Thuần JS, không gọi API: trang chỉ đọc, không ghi gì vào kho.

export type SysItem = {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  kind: string; // MACHINE | PART
  qty: number;
};

export type FileRow = {
  rowNo: number; // khoá duy nhất của dòng (đọc nhiều sheet: sheet thứ k cộng thêm k*1.000.000)
  rowNos: number[]; // mọi dòng trong file có cùng mã/tên (đã cộng dồn)
  refs: string[]; // nhãn hiển thị: "TKM dòng 5" / "dòng 5"
  kind?: string; // "MACHINE" | "PART" theo sheet (TKM = máy, TKLK = linh kiện); rỗng = không giới hạn
  code: string;
  name: string;
  qty: number;
};

export type MatchStatus = "MANUAL" | "EXACT_BOTH" | "EXACT_NAME" | "EXACT_CODE" | "FUZZY" | "FILE_ONLY" | "SYSTEM_ONLY";

export type ReconRow = {
  key: string;
  status: MatchStatus;
  file?: FileRow;
  sys?: SysItem;
  score?: number; // độ giống (0..1) cho FUZZY
  fuzzyBy?: "code" | "name";
  diff: number; // thực tế - hệ thống
};

/* ============ chuẩn hoá ============ */
export function stripVN(s: string) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}
/** mã: bỏ dấu, chữ thường, chỉ giữ chữ + số ("AB-12 / x" -> "ab12x") */
export function normCode(s: string) {
  return stripVN(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}
/** tên: bỏ dấu, chữ thường, dấu câu -> khoảng trắng, gộp khoảng trắng */
export function normName(s: string) {
  return stripVN(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Tên trong hệ thống hay kèm mã ở cuối: "Máy rửa siêu âm[may-rua-sieu-am]".
 *  Bỏ các đoạn [ ... ] để so tên cho đúng; mã trong ngoặc trả riêng để so như mã. */
export function splitName(s: string): { name: string; codes: string[] } {
  const codes: string[] = [];
  const name = String(s ?? "")
    .replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
      if (inner.trim()) codes.push(inner.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { name, codes };
}
/** khoá so tên tuyệt đối: bỏ ngoặc vuông, bỏ dấu, bỏ hết khoảng trắng / gạch ("Dây curoa B-45" = "day curoa b45") */
export function nameKey(s: string) {
  return normCode(splitName(s).name);
}

/* ============ độ giống (Dice trên cặp ký tự) ============ */
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  if (t.length < 2) {
    if (t) m.set(t, 1);
    return m;
  }
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}
function dice(a: Map<string, number>, b: Map<string, number>, na: number, nb: number) {
  if (!na || !nb) return 0;
  let inter = 0;
  for (const [g, c] of a) {
    const d = b.get(g);
    if (d) inter += Math.min(c, d);
  }
  return (2 * inter) / (na + nb);
}
const sizeOf = (m: Map<string, number>) => {
  let n = 0;
  for (const c of m.values()) n += c;
  return n;
};
export function similarity(a: string, b: string) {
  const A = bigrams(a);
  const B = bigrams(b);
  return dice(A, B, sizeOf(A), sizeOf(B));
}

/* ============ đọc bảng từ Excel ============ */
const CODE_KEYS = ["ma hang", "ma vt", "ma vat tu", "ma sp", "ma san pham", "ma hh", "ma may", "ma linh kien", "model", "ky hieu", "part no", "sku", "code", "ma"];
const NAME_KEYS = ["ten hang", "ten vat tu", "ten san pham", "ten hh", "hang hoa", "ten", "name", "dien giai", "mo ta"];
const QTY_KEYS = ["ton thuc te", "thuc te", "so luong thuc te", "sl thuc te", "kiem ke", "so luong", "ton cuoi", "ton kho", "ton", "sl", "qty", "quantity"];

function scoreHeader(cell: string, keys: string[]) {
  const c = normName(cell);
  if (!c) return 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (c === k) return 100 - i;
    if (c.startsWith(k + " ") || c.endsWith(" " + k) || c.includes(" " + k + " ")) return 60 - i;
  }
  return 0;
}

export type ColumnGuess = { headerRow: number; code: number; name: number; qty: number };

/** Dò dòng tiêu đề trong 15 dòng đầu, rồi đoán cột Mã / Tên / Số lượng. -1 = không thấy. */
export function guessColumns(aoa: string[][]): ColumnGuess {
  let best: ColumnGuess & { s: number } = { headerRow: 0, code: -1, name: -1, qty: -1, s: -1 };
  const limit = Math.min(aoa.length, 15);
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] || [];
    const pick = (keys: string[], taken: number[]) => {
      let bi = -1;
      let bs = 0;
      row.forEach((cell, i) => {
        if (taken.includes(i)) return;
        const s = scoreHeader(String(cell ?? ""), keys);
        if (s > bs) {
          bs = s;
          bi = i;
        }
      });
      return { i: bi, s: bs };
    };
    // số lượng trước (vì "ma" quá ngắn, dễ dính nhầm), rồi mã, rồi tên
    const q = pick(QTY_KEYS, []);
    const c = pick(CODE_KEYS, [q.i]);
    const n = pick(NAME_KEYS, [q.i, c.i]);
    const s = (q.s ? 3 : 0) + (c.s ? 2 : 0) + (n.s ? 2 : 0) + (q.s + c.s + n.s) / 1000;
    if (s > best.s) best = { headerRow: r, code: c.i, name: n.i, qty: q.i, s };
  }
  return { headerRow: best.headerRow, code: best.code, name: best.name, qty: best.qty };
}

/** "1.234,5" | "1,234.5" | "12" | "" -> số (rỗng / chữ = NaN) */
export function parseQty(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // dấu nào đứng sau là dấu thập phân
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    // "1,5" thập phân ; "1,234" hàng nghìn
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.234" kiểu VN = 1234
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const TOTAL_WORDS = new Set(["tong", "cong", "tong cong", "cong tong", "tong so", "tong so luong", "tong ton", "total", "grand total", "sum"]);
/** dòng tổng ở cuối bảng: không có mã, tên đúng là chữ tổng / cộng (có thể kèm dấu ":") */
function isTotalRow(code: string, name: string) {
  if (normCode(code) && !TOTAL_WORDS.has(normName(code))) return false;
  const n = normName(name || code);
  return TOTAL_WORDS.has(n) || /^tong cong\b/.test(n);
}

/** Đoán loại hàng của 1 sheet: máy / linh kiện, theo tên sheet và tiêu đề cột tên ("TÊN MÁY").
 *  Không chắc thì trả "" (không giới hạn loại). */
export function guessSheetKind(sheet: string, aoa: string[][], cols: ColumnGuess): "" | "MACHINE" | "PART" {
  const sn = normName(sheet);
  const head = cols.name >= 0 ? normName(String(aoa[cols.headerRow]?.[cols.name] ?? "")) : "";
  const isPart = /\b(lk|tklk|linh kien|phu tung|vat tu|part|parts)\b/.test(sn) || /linh kien|phu tung|vat tu/.test(head);
  const isMachine = /\b(tkm|may|may moc|thiet bi|machine|machines)\b/.test(sn) || /\bten may\b|may moc|thiet bi/.test(head);
  if (isPart && !isMachine) return "PART";
  if (isMachine && !isPart) return "MACHINE";
  return "";
}

export type ReadResult = { rows: FileRow[]; skipped: number; merged: number };

/** Lấy các dòng hàng từ bảng theo cột đã chọn.
 *  Chỉ cộng dồn khi trùng CẢ mã lẫn tên: cùng mã mà khác tên (vd DHZ550 "cao su" / "PU") là 2 mặt hàng khác nhau. */
export function readFileRows(aoa: string[][], cols: ColumnGuess, sheet = "", rowBase = 0, kind = ""): ReadResult {
  const ref = (r: number) => (sheet ? `${sheet} dòng ${r + 1}` : `dòng ${r + 1}`);
  const out = new Map<string, FileRow>();
  let skipped = 0;
  let merged = 0;
  for (let r = cols.headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const code = cols.code >= 0 ? String(row[cols.code] ?? "").trim() : "";
    const name = cols.name >= 0 ? String(row[cols.name] ?? "").trim() : "";
    if (!code && !name) continue; // dòng trống
    const q = cols.qty >= 0 ? parseQty(row[cols.qty]) : NaN;
    // dòng tổng cộng / tiêu đề phụ: không có số lượng hoặc chữ "tổng"
    // ⚠️ chỉ bỏ ĐÚNG dòng tổng: "Tổng", "Cộng", "Tổng cộng", "Total"... (bỏ dấu "Công tắc" cũng ra "cong tac"
    //    nên không được bắt theo chữ đầu)
    if (!Number.isFinite(q) || isTotalRow(code, name)) {
      skipped++;
      continue;
    }
    const key = `c:${normCode(code)}|n:${nameKey(name)}`;
    const cur = out.get(key);
    if (cur) {
      cur.qty += q;
      cur.rowNos.push(rowBase + r + 1);
      cur.refs.push(ref(r));
      if (!cur.name && name) cur.name = name;
      merged++;
    } else {
      out.set(key, { rowNo: rowBase + r + 1, rowNos: [rowBase + r + 1], refs: [ref(r)], code, name, qty: q, ...(kind ? { kind } : {}) });
    }
  }
  return { rows: Array.from(out.values()), skipped, merged };
}

/* ============ ghép ============ */
export const FUZZY_MIN = 0.72;

/** khoá nhớ ghép tay của 1 dòng file: theo mã nếu có, không thì theo tên (đã chuẩn hoá) */
export function aliasKey(f: { code: string; name: string }) {
  const c = normCode(f.code);
  return c ? `c:${c}` : `n:${normName(f.name)}`;
}

export function reconcile(
  fileRows: FileRow[],
  sysItems: SysItem[],
  opts: {
    rejected?: Set<string>;
    fuzzyMin?: number;
    manual?: Map<number, string>; // dòng file (rowNo) -> itemId, ghép tay trong lần này
    aliases?: Map<string, string>; // aliasKey -> itemId, ghép tay đã lưu từ lần trước
  } = {}
): ReconRow[] {
  const fuzzyMin = opts.fuzzyMin ?? FUZZY_MIN;
  const rejected = opts.rejected ?? new Set<string>();
  const manual = opts.manual ?? new Map<number, string>();
  const aliases = opts.aliases ?? new Map<string, string>();
  const sysById = new Map(sysItems.map((it) => [it.itemId, it]));
  const out: ReconRow[] = [];
  const usedSys = new Set<string>();
  const usedFile = new Set<number>();

  const sysByCode = new Map<string, SysItem[]>();
  const sysByName = new Map<string, SysItem[]>();
  const sysBySlug = new Map<string, SysItem[]>();
  const add = (m: Map<string, SysItem[]>, k: string, it: SysItem) => {
    if (!k) return;
    const arr = m.get(k) || [];
    if (!arr.includes(it)) arr.push(it);
    m.set(k, arr);
  };
  for (const it of sysItems) {
    const sp = splitName(it.name);
    add(sysByName, normCode(sp.name), it); // tên đã bỏ [mã]
    add(sysByCode, normCode(it.sku), it);
    for (const c of sp.codes) add(sysByCode, normCode(c), it); // mã trong [ ] của tên
    add(sysBySlug, normCode(it.sku), it); // mã kiểu "may-rua-sieu-am" = tên viết liền không dấu
  }
  const fileKey = (f: FileRow) => `${f.rowNo}`;
  const pairKey = (f: FileRow, s: SysItem) => `${fileKey(f)}|${s.itemId}`;

  const push = (status: MatchStatus, f: FileRow, s: SysItem, extra: Partial<ReconRow> = {}) => {
    usedSys.add(s.itemId);
    usedFile.add(f.rowNo);
    out.push({ key: pairKey(f, s), status, file: f, sys: s, diff: round(f.qty - s.qty), ...extra });
  };
  // ✅ dòng của sheet máy chỉ ghép với hàng loại máy, sheet linh kiện chỉ với linh kiện
  const sameKind = (f: FileRow, s: SysItem) => !f.kind || !s.kind || f.kind === s.kind;
  const ofKind = (f: FileRow, list: SysItem[] | undefined) => (list || []).filter((s) => sameKind(f, s));
  const free = (f: FileRow, list: SysItem[] | undefined) =>
    ofKind(f, list).filter((s) => !usedSys.has(s.itemId) && !rejected.has(pairKey(f, s)));
  const codesOf = (f: FileRow) => [f.code, ...splitName(f.name).codes].map(normCode).filter(Boolean);
  const sysCodes = (s: SysItem) => [s.sku, ...splitName(s.name).codes].map(normCode).filter(Boolean);
  const cleanNorm = (s: string) => normName(splitName(s).name);

  /** file có thêm dòng trùng (tên / mã) mà hệ thống chỉ có ĐÚNG 1 mặt hàng như vậy (vd 1 hàng để 2 kệ)
   *  -> cộng dồn vào dòng đã ghép, không báo dư */
  const mergeInto = (f: FileRow, all0: SysItem[] | undefined, sameCodeOnly = false) => {
    const list = ofKind(f, all0);
    if (list.length !== 1 || !usedSys.has(list[0].itemId) || rejected.has(pairKey(f, list[0]))) return false;
    const row = out.find((r) => r.status !== "MANUAL" && r.sys?.itemId === list[0].itemId);
    if (!row || !row.file) return false;
    if (sameCodeOnly) {
      // gộp theo tên: dòng có mã khác (vd "Máy cắt rau quả" 5 mã khác nhau) là hàng khác, không cộng dồn
      const fc = codesOf(f);
      const known = [...codesOf(row.file), ...sysCodes(list[0])];
      if (fc.length && !fc.some((c) => known.includes(c))) return false;
    }
    const merged: FileRow = {
      ...row.file,
      qty: row.file.qty + f.qty,
      rowNos: [...row.file.rowNos, ...f.rowNos].sort((a, b) => a - b),
      refs: [...row.file.refs, ...f.refs],
    };
    row.file = merged;
    row.diff = round(merged.qty - list[0].qty);
    usedFile.add(f.rowNo);
    return true;
  };

  // (0) ghép tay: chọn trong lần này trước, rồi tới cặp đã lưu
  for (const f of fileRows) {
    const id = manual.get(f.rowNo);
    const s = id ? sysById.get(id) : undefined;
    if (s && !usedSys.has(s.itemId)) push("MANUAL", f, s);
  }
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    const id = aliases.get(aliasKey(f));
    const s = id ? sysById.get(id) : undefined;
    if (s && !usedSys.has(s.itemId)) push("MANUAL", f, s);
  }

  // (1) TÊN TRƯỚC (tên đã bỏ phần [xxx], bỏ dấu, khoảng trắng, gạch)
  // (1a) trùng CẢ tên lẫn mã: chắc chắn nhất, tách được các hàng trùng tên ("Máy cắt rau quả" có 5 mã)
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    const n = nameKey(f.name);
    const fc = codesOf(f);
    if (!n || !fc.length) continue;
    const hit = free(f, sysByName.get(n)).find((s) => sysCodes(s).some((c) => fc.includes(c)));
    if (hit) push("EXACT_BOTH", f, hit);
  }
  // (1b) chỉ trùng tên: ghép thẳng khi tên đó KHÔNG mơ hồ (hệ thống còn đúng 1 hàng tên đó,
  //      file còn đúng 1 dòng tên đó). Mơ hồ thì để xuống nhóm "gần giống" cho người xem lại.
  const fileByName = new Map<string, FileRow[]>();
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    const n = nameKey(f.name);
    const k = `${f.kind || ""}|${n}`;
    if (n) fileByName.set(k, [...(fileByName.get(k) || []), f]);
  }
  for (const [k, group] of fileByName) {
    const n = k.slice(k.indexOf("|") + 1);
    const cand = group.length ? free(group[0], sysByName.get(n)) : [];
    if (cand.length !== 1) continue;
    const s0 = cand[0];
    if (group.length === 1) {
      if (!rejected.has(pairKey(group[0], s0))) push("EXACT_NAME", group[0], s0);
      continue;
    }
    // file có nhiều dòng cùng tên: nếu không dòng nào ghi mã khác nhau -> cùng 1 hàng (để nhiều kệ), ghép + cộng dồn
    const codes = new Set(group.map((f) => normCode(f.code)).filter(Boolean));
    if (codes.size <= 1 && !rejected.has(pairKey(group[0], s0))) push("EXACT_NAME", group[0], s0);
  }
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    const n = nameKey(f.name);
    if (n) mergeInto(f, sysByName.get(n), true);
  }

  // (2) SAU ĐÓ MỚI TỚI MÃ (cột mã trong file, hoặc mã trong [ ] ở tên trong file).
  //     Nhiều mặt hàng cùng mã (vd DHZ-550 cao su / PU) -> chọn mặt hàng có tên giống nhất.
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    const nn = cleanNorm(f.name);
    for (const c of codesOf(f)) {
      const cand = free(f, sysByCode.get(c));
      if (!cand.length) continue;
      const best =
        cand.length === 1 || !nn
          ? cand[0]
          : cand.map((s) => ({ s, k: similarity(nn, cleanNorm(s.name)) })).sort((a, b) => b.k - a.k)[0].s;
      push("EXACT_CODE", f, best);
      break;
    }
  }
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    for (const c of codesOf(f)) if (mergeInto(f, sysByCode.get(c))) break;
  }
  //     tên trong file viết liền không dấu trùng mã dạng "may-rua-sieu-am"
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    const cand = free(f, sysBySlug.get(nameKey(f.name)));
    if (cand.length) push("EXACT_CODE", f, cand[0]);
  }
  // (3) gần giống: chấm điểm mọi cặp còn lại (lọc nhanh bằng từ chung / đầu mã chung), lấy cặp tốt nhất trước
  const restSys = sysItems.filter((s) => !usedSys.has(s.itemId));
  const sysPre = restSys.map((s) => {
    const nc = normCode(s.sku);
    const nn = normName(splitName(s.name).name);
    // từ của tên + từ của mã dạng "may-rua-sieu-am" (để lọc nhanh)
    const toks = Array.from(new Set([...tokens(nn), ...tokens(normName(s.sku))]));
    return { s, nc, nn, bc: bigrams(nc), bn: bigrams(nn), toks, nums: numsOf(nn), sc: 0, sn: 0 };
  });
  sysPre.forEach((p) => {
    p.sc = sizeOf(p.bc);
    p.sn = sizeOf(p.bn);
  });
  const byTok = new Map<string, number[]>();
  const byPre = new Map<string, number[]>();
  sysPre.forEach((p, i) => {
    for (const t of p.toks) byTok.set(t, [...(byTok.get(t) || []), i]);
    if (p.nc.length >= 3) byPre.set(p.nc.slice(0, 3), [...(byPre.get(p.nc.slice(0, 3)) || []), i]);
  });

  type Cand = { f: FileRow; si: number; score: number; tie: number; by: "code" | "name" };
  const cands: Cand[] = [];
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    const sp = splitName(f.name);
    const nc = normCode(f.code || sp.codes[0] || "");
    const nn = normName(sp.name);
    const nums = numsOf(nn);
    const bc = bigrams(nc);
    const bn = bigrams(nn);
    const sc = sizeOf(bc);
    const sn = sizeOf(bn);
    const bSlug = bigrams(normCode(sp.name)); // tên file viết liền, so với mã kiểu slug
    const sSlugN = sizeOf(bSlug);
    const idx = new Set<number>();
    for (const t of tokens(nn)) for (const i of byTok.get(t) || []) idx.add(i);
    if (nc.length >= 3) for (const i of byPre.get(nc.slice(0, 3)) || []) idx.add(i);
    for (const i of idx) {
      const p = sysPre[i];
      if (rejected.has(pairKey(f, p.s)) || !sameKind(f, p.s)) continue;
      const sCode = Math.max(
        nc && p.nc ? dice(bc, p.bc, sc, p.sc) : 0,
        sSlugN && p.nc.length >= 6 ? dice(bSlug, p.bc, sSlugN, p.sc) : 0
      );
      const sName = nn && p.nn ? dice(bn, p.bn, sn, p.sn) : 0;
      let score = Math.max(sCode, sName);
      // khác số (9 khay / 6 khay, 2HP / 3HP, DZ-400 / DZ-500) thì gần như chắc chắn là 2 mặt hàng khác nhau
      if (nums.length && p.nums.length && nums.join() !== p.nums.join()) score *= 0.8;
      // điểm phụ (tên + mã) để tách các hàng trùng tên: cùng tên thì hàng có mã giống hơn được chọn trước
      if (score >= fuzzyMin) cands.push({ f, si: i, score, tie: sCode + sName, by: sCode >= sName ? "code" : "name" });
    }
  }
  cands.sort((a, b) => b.score - a.score || b.tie - a.tie);
  for (const c of cands) {
    const s = sysPre[c.si].s;
    if (usedFile.has(c.f.rowNo) || usedSys.has(s.itemId)) continue;
    push("FUZZY", c.f, s, { score: round(c.score, 2), fuzzyBy: c.by });
  }

  // (4) không khớp
  for (const f of fileRows) {
    if (usedFile.has(f.rowNo)) continue;
    out.push({ key: `f${fileKey(f)}`, status: "FILE_ONLY", file: f, diff: round(f.qty) });
  }
  for (const s of sysItems) {
    if (usedSys.has(s.itemId)) continue;
    out.push({ key: `s${s.itemId}`, status: "SYSTEM_ONLY", sys: s, diff: round(-s.qty) });
  }
  return out;
}

function numsOf(nn: string) {
  return Array.from(new Set(nn.match(/\d+/g) || [])).sort();
}
function tokens(nn: string) {
  return Array.from(new Set(nn.split(" ").filter((t) => t.length >= 3 || /\d/.test(t))));
}
function round(n: number, d = 4) {
  const k = 10 ** d;
  return Math.round(n * k) / k;
}