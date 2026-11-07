// src/pages/StockReconcilePage.tsx
// ✅ Đối soát tồn thực tế (file Excel) với tồn hệ thống — CHỈ XEM, không ghi gì vào kho.
//  - Tải file kiểm kê (xlsx / xls / csv) -> tự dò cột Mã / Tên / Số lượng (chỉnh lại được)
//  - Trùng mã / trùng tên: ghép thẳng; gần giống: nền vàng (bỏ ghép được); không khớp: nền đỏ
//  - Chênh lệch = HỆ THỐNG − THỰC TẾ (+ = hệ thống thừa, − = hệ thống thiếu); xuất Excel giữ nguyên màu
//  - Chọn được ngày lấy tồn hệ thống (tồn cuối ngày, tính từ báo cáo nhập – xuất – tồn)
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import {
  type ColumnGuess,
  type FileRow,
  type MatchStatus,
  type ReconRow,
  type SysItem,
  aliasKey,
  guessColumns,
  guessSheetKind,
  normName,
  readFileRows,
  reconcile,
} from "../utils/stockReconcile";

type KindFilter = "" | "MACHINE" | "PART";
type View = "ALL" | "MATCHED" | "FUZZY" | "UNMATCHED" | "DIFF";

const STATUS_LABEL: Record<MatchStatus, string> = {
  MANUAL: "Ghép tay",
  EXACT_BOTH: "Khớp tên + mã",
  EXACT_CODE: "Khớp mã",
  EXACT_NAME: "Khớp tên",
  FUZZY: "Gần giống",
  FILE_ONLY: "Chỉ có trong file",
  SYSTEM_ONLY: "Không thấy trong file",
};
const ROW_BG: Record<MatchStatus, string> = {
  MANUAL: "",
  EXACT_BOTH: "",
  EXACT_CODE: "",
  EXACT_NAME: "",
  FUZZY: "bg-amber-50",
  FILE_ONLY: "bg-rose-50",
  SYSTEM_ONLY: "bg-rose-50",
};
const BADGE: Record<MatchStatus, string> = {
  MANUAL: "bg-sky-100 text-sky-800",
  EXACT_BOTH: "bg-emerald-100 text-emerald-800",
  EXACT_CODE: "bg-emerald-100 text-emerald-800",
  EXACT_NAME: "bg-emerald-100 text-emerald-800",
  FUZZY: "bg-amber-200 text-amber-900",
  FILE_ONLY: "bg-rose-200 text-rose-900",
  SYSTEM_ONLY: "bg-rose-200 text-rose-900",
};
// dòng có trong file lên trước (vàng, đỏ, rồi đã khớp); hàng hệ thống không thấy trong file để cuối
const ORDER: Record<MatchStatus, number> = { FUZZY: 0, FILE_ONLY: 1, MANUAL: 2, EXACT_NAME: 3, EXACT_CODE: 4, EXACT_BOTH: 5, SYSTEM_ONLY: 6 };

const fmt = (n: number) => Number(n || 0).toLocaleString("vi-VN", { maximumFractionDigits: 3 });
const colName = (i: number) => XLSX.utils.encode_col(i);
const PAGE = 300;

type Book = { names: string[]; aoa: Record<string, string[][]> };

// ✅ phiên đối soát lưu trên máy chủ; máy này nhớ phiên đang làm để F5 tự mở lại
const LAST_SESSION_LS = "stock_reconcile_last_session_v1";
type SessionMeta = { id: string; name: string; fileName?: string | null; createdBy?: string | null; updatedBy?: string | null; updatedAt: string };
type SaveState = "idle" | "saving" | "saved" | "error";
function lsGet(k: string) {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* trình duyệt chặn lưu: bỏ qua */
  }
}
/** phần "nhẹ" của phiên (tự lưu mỗi lần ghép / bỏ ghép). Thứ tự khoá cố định để so sánh JSON. */
function makeLight(p: {
  sheet: string;
  useAll: boolean;
  colsMap: Record<string, ColumnGuess>;
  kindMap: Record<string, KindFilter>;
  kind: KindFilter;
  asOf: string;
  hideZeroSys: boolean;
  manual: Map<number, string>;
  rejected: Set<string>;
}) {
  return {
    v: 1,
    sheet: p.sheet,
    useAll: p.useAll,
    colsMap: p.colsMap,
    kindMap: p.kindMap,
    kind: p.kind,
    asOf: p.asOf,
    hideZeroSys: p.hideZeroSys,
    manual: [...p.manual.entries()],
    rejected: [...p.rejected],
  };
}

/** hôm nay theo giờ VN, dạng YYYY-MM-DD (cho ô chọn ngày) */
function todayVN() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
const fmtYmd = (ymd: string) => ymd.split("-").reverse().join("/");

// ✅ ghép tay đã lưu: mã / tên trong file -> mặt hàng hệ thống (lần sau tải file là tự ghép)
const ALIAS_LS = "stock_reconcile_alias_v1";
function loadAliases(): Map<string, string> {
  try {
    const o = JSON.parse(localStorage.getItem(ALIAS_LS) || "{}");
    return new Map(Object.entries(o && typeof o === "object" ? (o as Record<string, string>) : {}));
  } catch {
    return new Map();
  }
}
function saveAliases(m: Map<string, string>) {
  try {
    localStorage.setItem(ALIAS_LS, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* trình duyệt chặn lưu: vẫn ghép được trong lần này */
  }
}
const isMatched = (st: MatchStatus) => st === "EXACT_BOTH" || st === "EXACT_CODE" || st === "EXACT_NAME" || st === "MANUAL";

function errMsg(e: unknown, fallback: string) {
  const r = (e as { response?: { data?: { message?: string } }; message?: string }) || {};
  return r.response?.data?.message || r.message || fallback;
}

const StockReconcilePage: React.FC = () => {
  const { toasts, push, remove } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ---- tồn hệ thống
  const [kind, setKind] = useState<KindFilter>("");
  const [sys, setSys] = useState<SysItem[]>([]);
  const [sysLoading, setSysLoading] = useState(false);
  const [sysAt, setSysAt] = useState<Date | null>(null);

  // ---- file
  const [fileName, setFileName] = useState("");
  // bảng Excel đã đọc (tên sheet + dữ liệu từng sheet) — dạng thuần để lưu được vào phiên
  const [book, setBook] = useState<Book | null>(null);
  const [sheet, setSheet] = useState(""); // sheet đang xem / chỉnh cột
  const [useAll, setUseAll] = useState(true); // ✅ đọc mọi sheet có đủ cột (vd TKM = máy, TKLK = linh kiện)
  const [colsMap, setColsMap] = useState<Record<string, ColumnGuess>>({});
  const [kindMap, setKindMap] = useState<Record<string, KindFilter>>({}); // ✅ sheet nào là máy / linh kiện

  // ---- xem
  const [view, setView] = useState<View>("ALL");
  const [q, setQ] = useState("");
  const [hideZeroSys, setHideZeroSys] = useState(true);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [manual, setManual] = useState<Map<number, string>>(new Map());
  const [aliases, setAliases] = useState<Map<string, string>>(() => loadAliases());
  const [picker, setPicker] = useState<{ file: FileRow; currentId?: string } | null>(null);
  const [filePicker, setFilePicker] = useState<SysItem | null>(null); // hàng hệ thống không thấy trong file -> tìm dòng trong file
  const [createFor, setCreateFor] = useState<FileRow | null>(null); // ✅ dòng file chưa có mã trên hệ thống -> tạo mã hàng
  const { user: authUser } = useAuth();
  const isAdmin = String(authUser?.role || "") === "admin";
  // ✅ ngày lấy tồn hệ thống: "" = tồn hiện tại; có ngày = tồn cuối ngày đó (vd ngày kiểm kê)
  const [asOf, setAsOf] = useState("");
  // ✅ phiên đối soát
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const lastSavedRef = useRef(""); // JSON phần nhẹ đã lưu gần nhất -> không lưu trùng
  const [sysAsOf, setSysAsOf] = useState(""); // ngày của bộ tồn đang hiển thị

  const loadSys = useCallback(async () => {
    setSysLoading(true);
    try {
      const res = await api.get("/stocks/summary-by-item", {
        params: { kind: kind || undefined, page: 1, pageSize: 100000 },
      });
      const rows: Array<Record<string, unknown>> = res?.data?.data || [];
      let list: SysItem[] = rows.map((r) => ({
        itemId: String(r.itemId ?? r.id ?? ""),
        sku: String(r.sku ?? ""),
        name: String(r.name ?? ""),
        unit: String(r.unitName || r.unit || ""),
        kind: String(r.kind ?? ""),
        qty: Number(r.totalQty ?? 0),
      }));

      // ngày trong quá khứ: lấy TỒN CUỐI NGÀY từ báo cáo nhập – xuất – tồn (tính lùi từ phiếu nhập / xuất đã ghi sổ)
      const day = asOf && asOf < todayVN() ? asOf : "";
      if (day) {
        const r2 = await api.get("/reports/stock-inout", { params: { from: day, to: day } });
        const closing = new Map<string, number>();
        for (const x of (r2?.data?.rows || []) as Array<{ itemId: string; closingQty: number }>) {
          closing.set(String(x.itemId), Number(x.closingQty ?? 0));
        }
        list = list.map((it) => ({ ...it, qty: closing.get(it.itemId) ?? 0 }));
      }
      setSys(list);
      setSysAsOf(day);
      setSysAt(new Date());
    } catch (e) {
      push({ type: "error", message: errMsg(e, "Không tải được tồn hệ thống.") });
    } finally {
      setSysLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, asOf]);

  useEffect(() => {
    loadSys();
  }, [loadSys]);

  const aoaMap: Record<string, string[][]> = useMemo(() => book?.aoa ?? {}, [book]);
  const aoa: string[][] = useMemo(() => aoaMap[sheet] || [], [aoaMap, sheet]);
  const EMPTY_COLS: ColumnGuess = { headerRow: 0, code: -1, name: -1, qty: -1 };
  const cols: ColumnGuess = colsMap[sheet] || EMPTY_COLS;
  const setCols = (c: ColumnGuess) => setColsMap((m) => ({ ...m, [sheet]: c }));
  const okCols = (c?: ColumnGuess) => !!c && c.qty >= 0 && (c.code >= 0 || c.name >= 0);
  // các sheet dùng được (dò ra đủ cột)
  const usable = useMemo(
    () => (book ? book.names.filter((n) => (aoaMap[n]?.length || 0) > 1 && okCols(colsMap[n])) : []),
    [book, aoaMap, colsMap]
  );

  const width = useMemo(() => aoa.slice(0, 50).reduce((m, r) => Math.max(m, r.length), 0), [aoa]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const nb: Book = { names: [], aoa: {} };
      for (const n of wb.SheetNames) {
        const ws = wb.Sheets[n];
        if (!ws) continue;
        // bỏ dòng trống cuối bảng cho phiên lưu gọn
        const a = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "", blankrows: true });
        let end = a.length;
        while (end > 0 && !(a[end - 1] || []).some((c) => String(c ?? "").trim())) end--;
        nb.names.push(n);
        nb.aoa[n] = a.slice(0, end).map((row) => row.map((c) => String(c ?? "")));
      }
      // sheet có nhiều dòng nhất
      const best = nb.names.reduce((b, n) => ((nb.aoa[n]?.length || 0) > (nb.aoa[b]?.length || 0) ? n : b), nb.names[0] || "");
      // dò cột + loại (máy / linh kiện) cho từng sheet
      const guesses: Record<string, ColumnGuess> = {};
      const kinds: Record<string, KindFilter> = {};
      for (const n of nb.names) {
        const a = nb.aoa[n];
        if (!a?.length) continue;
        guesses[n] = guessColumns(a);
        kinds[n] = guessSheetKind(n, a, guesses[n]);
      }
      // file mới = phiên mới (phiên cũ vẫn còn trên máy chủ, mở lại được)
      setSessionId(null);
      setSessionName("");
      setColsMap(guesses);
      setKindMap(kinds);
      setUseAll(true);
      setBook(nb);
      setFileName(f.name);
      setSheet(best);
      setRejected(new Set());
      setManual(new Map());
      setLimit(PAGE);
      setView("ALL");
    } catch (e) {
      push({ type: "error", message: errMsg(e, "Không đọc được file. Hãy dùng .xlsx, .xls hoặc .csv.") });
    }
  };

  // đọc 1 sheet hoặc mọi sheet dùng được; nhiều sheet thì ghi tên sheet vào số dòng ("TKM dòng 5")
  const usedSheets = useMemo(
    () => {
      const list = useAll && usable.length > 1 ? usable : okCols(colsMap[sheet]) ? [sheet] : [];
      // "So với tồn" chỉ máy / chỉ linh kiện -> bỏ sheet loại kia
      return kind ? list.filter((n) => !kindMap[n] || kindMap[n] === kind) : list;
    },
    [useAll, usable, colsMap, sheet, kind, kindMap]
  );
  const read = useMemo(() => {
    if (!usedSheets.length) return null;
    const multi = usedSheets.length > 1;
    const res = { rows: [] as FileRow[], skipped: 0, merged: 0 };
    usedSheets.forEach((n) => {
      const k = book ? book.names.indexOf(n) : 0;
      const r = readFileRows(aoaMap[n] || [], colsMap[n], multi ? n : "", (k + 1) * 1_000_000, kindMap[n] || "");
      res.rows.push(...r.rows);
      res.skipped += r.skipped;
      res.merged += r.merged;
    });
    return res;
  }, [usedSheets, aoaMap, colsMap, book, kindMap]);
  const ready = !!read;

  const all: ReconRow[] = useMemo(() => {
    if (!ready || !read) return [];
    return reconcile(read.rows, sys, { rejected, manual, aliases });
  }, [ready, read, sys, rejected, manual, aliases]);

  // mặt hàng hệ thống đang ghép với dòng file nào (để báo trong hộp chọn)
  const pairedWith = useMemo(() => {
    const m = new Map<string, FileRow>();
    for (const r of all) if (r.sys && r.file) m.set(r.sys.itemId, r.file);
    return m;
  }, [all]);

  const pickItem = (f: FileRow, itemId: string, remember: boolean) => {
    // 1 mặt hàng chỉ ghép với 1 dòng: bỏ ghép tay / cặp đã lưu cũ đang trỏ vào mặt hàng này
    setManual((m) => {
      const n = new Map([...m].filter(([, id]) => id !== itemId));
      return n.set(f.rowNo, itemId);
    });
    const key = aliasKey(f);
    const next = new Map([...aliases].filter(([k, id]) => id !== itemId && k !== key));
    if (remember) next.set(key, itemId);
    if (next.size !== aliases.size || remember) {
      setAliases(next);
      persistAliases(aliases, next);
    }
    setPicker(null);
    push({ type: "success", message: remember ? "Đã ghép và lưu cho lần đối soát sau." : "Đã ghép." });
  };

  const unpairManual = (f: FileRow) => {
    setManual((m) => {
      const n = new Map(m);
      n.delete(f.rowNo);
      return n;
    });
    const k = aliasKey(f);
    if (aliases.has(k)) {
      const next = new Map(aliases);
      next.delete(k);
      setAliases(next);
      persistAliases(aliases, next);
    }
  };

  // hàng hệ thống tồn 0 mà không có trong file: không phải lệch, mặc định ẩn
  const base = useMemo(
    () => (hideZeroSys ? all.filter((r) => !(r.status === "SYSTEM_ONLY" && Math.abs(r.sys?.qty || 0) < 1e-9)) : all),
    [all, hideZeroSys]
  );

  const stats = useMemo(() => {
    const c = (f: (r: ReconRow) => boolean) => base.filter(f).length;
    const matched = (r: ReconRow) => isMatched(r.status);
    return {
      all: base.length,
      matched: c(matched),
      matchedOk: c((r) => matched(r) && Math.abs(r.diff) < 1e-9),
      fuzzy: c((r) => r.status === "FUZZY"),
      fileOnly: c((r) => r.status === "FILE_ONLY"),
      sysOnly: c((r) => r.status === "SYSTEM_ONLY"),
      diff: c((r) => Math.abs(r.diff) > 1e-9),
      plus: base.filter((r) => r.diff > 1e-9).reduce((t, r) => t + r.diff, 0),
      minus: base.filter((r) => r.diff < -1e-9).reduce((t, r) => t + r.diff, 0),
    };
  }, [base]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    let rows = base.filter((r) => {
      if (view === "MATCHED") return isMatched(r.status);
      if (view === "FUZZY") return r.status === "FUZZY";
      if (view === "UNMATCHED") return r.status === "FILE_ONLY" || r.status === "SYSTEM_ONLY";
      if (view === "DIFF") return Math.abs(r.diff) > 1e-9;
      return true;
    });
    if (k)
      rows = rows.filter((r) =>
        [r.file?.code, r.file?.name, r.sys?.sku, r.sys?.name].some((v) => String(v || "").toLowerCase().includes(k))
      );
    // vàng, đỏ lên đầu; trong nhóm: lệch nhiều trước
    return rows.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status] || Math.abs(b.diff) - Math.abs(a.diff));
  }, [base, view, q]);

  const unpair = (key: string) => setRejected((s) => new Set(s).add(key));

  /* ===================== NHỚ CẶP dùng chung (máy chủ) ===================== */
  // lưu trên máy này + gửi phần thay đổi lên máy chủ để cả công ty dùng chung
  const persistAliases = (prev: Map<string, string>, next: Map<string, string>) => {
    saveAliases(next);
    const set: Record<string, string> = {};
    const remove: string[] = [];
    for (const [k, v] of next) if (prev.get(k) !== v) set[k] = v;
    for (const k of prev.keys()) if (!next.has(k)) remove.push(k);
    if (!Object.keys(set).length && !remove.length) return;
    api.put("/stock-reconcile/aliases", { set, remove }).catch(() => {
      push({ type: "error", message: "Chưa lưu được cặp ghép lên máy chủ (vẫn nhớ trên máy này)." });
    });
  };
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/stock-reconcile/aliases");
        const server = new Map(Object.entries((res?.data?.data || {}) as Record<string, string>));
        const local = loadAliases();
        // cặp chỉ có trên máy này (lưu từ trước khi có máy chủ) -> đẩy lên cho mọi người dùng
        const up: Record<string, string> = {};
        for (const [k, v] of local) if (!server.has(k)) up[k] = v;
        if (Object.keys(up).length) api.put("/stock-reconcile/aliases", { set: up }).catch(() => undefined);
        const merged = new Map([...local, ...server]);
        setAliases(merged);
        saveAliases(merged);
      } catch {
        /* máy chủ chưa có bảng / lỗi mạng: dùng cặp trên máy này */
      }
    })();
  }, []);

  /* ===================== PHIÊN ĐỐI SOÁT ===================== */
  const light = useMemo(
    () => makeLight({ sheet, useAll, colsMap, kindMap, kind, asOf, hideZeroSys, manual, rejected }),
    [sheet, useAll, colsMap, kindMap, kind, asOf, hideZeroSys, manual, rejected]
  );

  // tự lưu (1,2 giây sau lần sửa cuối) khi đang ở trong 1 phiên
  useEffect(() => {
    if (!sessionId || !book) return;
    const str = JSON.stringify(light);
    if (str === lastSavedRef.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await api.put(`/stock-reconcile/sessions/${sessionId}`, { data: light });
        lastSavedRef.current = str;
        setSaveState("saved");
        setSavedAt(new Date());
      } catch {
        setSaveState("error");
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [light, sessionId, book]);

  const createSession = async (name: string) => {
    if (!book) return;
    try {
      setSaveState("saving");
      const res = await api.post("/stock-reconcile/sessions", { name, fileName, data: { ...light, book } });
      const row = res?.data?.data;
      lastSavedRef.current = JSON.stringify(light);
      setSessionId(String(row.id));
      setSessionName(String(row.name));
      lsSet(LAST_SESSION_LS, String(row.id));
      setSaveState("saved");
      setSavedAt(new Date());
      setNameOpen(false);
      push({ type: "success", message: "Đã lưu phiên. Từ giờ mỗi lần ghép / bỏ ghép tự lưu, F5 tự mở lại." });
    } catch (e) {
      setSaveState("error");
      push({ type: "error", message: errMsg(e, "Không lưu được phiên đối soát.") });
    }
  };

  const renameSession = async (name: string) => {
    if (!sessionId) return;
    try {
      await api.put(`/stock-reconcile/sessions/${sessionId}`, { name });
      setSessionName(name);
      setNameOpen(false);
    } catch (e) {
      push({ type: "error", message: errMsg(e, "Không đổi được tên phiên.") });
    }
  };

  const openSession = useCallback(
    async (id: string, silent = false) => {
      try {
        const res = await api.get(`/stock-reconcile/sessions/${id}`);
        const row = res?.data?.data;
        const d = (row?.data || {}) as Record<string, unknown>;
        const b = d.book as Book | undefined;
        if (!b?.names?.length) throw new Error("Phiên không có dữ liệu file.");
        const m = new Map<number, string>(((d.manual as [number, string][]) || []).map(([k, v]) => [Number(k), String(v)]));
        const rj = new Set<string>(((d.rejected as string[]) || []).map(String));
        const restored = makeLight({
          sheet: String(d.sheet || b.names[0]),
          useAll: d.useAll !== false,
          colsMap: (d.colsMap as Record<string, ColumnGuess>) || {},
          kindMap: (d.kindMap as Record<string, KindFilter>) || {},
          kind: (d.kind as KindFilter) || "",
          asOf: String(d.asOf || ""),
          hideZeroSys: d.hideZeroSys !== false,
          manual: m,
          rejected: rj,
        });
        lastSavedRef.current = JSON.stringify(restored); // mở lại không tính là sửa -> không tự lưu lại
        setBook(b);
        setFileName(String(row.fileName || ""));
        setSheet(restored.sheet);
        setUseAll(restored.useAll);
        setColsMap(restored.colsMap);
        setKindMap(restored.kindMap);
        setKind(restored.kind);
        setAsOf(restored.asOf);
        setHideZeroSys(restored.hideZeroSys);
        setManual(m);
        setRejected(rj);
        setSessionId(String(row.id));
        setSessionName(String(row.name));
        setSaveState("saved");
        setSavedAt(row.updatedAt ? new Date(row.updatedAt) : null);
        setLimit(PAGE);
        setView("ALL");
        setListOpen(false);
        lsSet(LAST_SESSION_LS, String(row.id));
        if (!silent) push({ type: "success", message: `Đã mở phiên "${row.name}".` });
      } catch (e) {
        if (silent) lsSet(LAST_SESSION_LS, null);
        else push({ type: "error", message: errMsg(e, "Không mở được phiên đối soát.") });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // F5 / mở lại trang: tự mở phiên đang làm dở trên máy này
  useEffect(() => {
    const last = lsGet(LAST_SESSION_LS);
    if (last) openSession(last, true);
  }, [openSession]);

  const newSession = () => {
    setSessionId(null);
    setSessionName("");
    setBook(null);
    setFileName("");
    setManual(new Map());
    setRejected(new Set());
    setSaveState("idle");
    setSavedAt(null);
    lastSavedRef.current = "";
    lsSet(LAST_SESSION_LS, null);
  };

  const exportExcel = async () => {
    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet("Đối soát tồn");
    ws.columns = [
      { header: "Trạng thái", key: "st", width: 20 },
      { header: "Độ giống", key: "score", width: 10 },
      { header: "Dòng file", key: "row", width: 16 },
      { header: "Mã (file)", key: "fc", width: 18 },
      { header: "Tên (file)", key: "fn", width: 38 },
      { header: "SL thực tế", key: "fq", width: 12 },
      { header: "Mã (hệ thống)", key: "sc", width: 18 },
      { header: "Tên (hệ thống)", key: "sn", width: 38 },
      { header: "ĐVT", key: "u", width: 8 },
      { header: "Tồn hệ thống", key: "sq", width: 13 },
      { header: "Chênh lệch (HT − thực tế)", key: "d", width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
    for (const r of shown) {
      const row = ws.addRow({
        st: STATUS_LABEL[r.status],
        score: r.score != null ? `${Math.round(r.score * 100)}%` : "",
        row: r.file ? r.file.refs.join(", ") : "",
        fc: r.file?.code ?? "",
        fn: r.file?.name ?? "",
        fq: r.file ? r.file.qty : null,
        sc: r.sys?.sku ?? "",
        sn: r.sys?.name ?? "",
        u: r.sys?.unit ?? "",
        sq: r.sys ? r.sys.qty : null,
        d: r.diff,
      });
      if (r.status === "FUZZY") row.eachCell({ includeEmpty: true }, (c) => (c.fill = fill("FFFEF3C7")));
      if (r.status === "FILE_ONLY" || r.status === "SYSTEM_ONLY")
        row.eachCell({ includeEmpty: true }, (c) => (c.fill = fill("FFFFE4E6")));
      const dc = row.getCell("d");
      dc.font = { bold: true, color: { argb: r.diff > 1e-9 ? "FFDC2626" : r.diff < -1e-9 ? "FF1D4ED8" : "FF059669" } };
    }
    ["fq", "sq", "d"].forEach((k) => (ws.getColumn(k).numFmt = "#,##0.###"));
    const buf = await book.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    saveAs(new Blob([buf]), `doi_soat_ton_${stamp}.xlsx`);
  };

  const colSelect = (label: string, field: "code" | "name" | "qty") => (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <select
        className="rounded-lg border px-2 py-1.5 text-sm text-slate-900"
        value={cols[field]}
        onChange={(e) => setCols({ ...cols, [field]: Number(e.target.value) })}
      >
        <option value={-1}>— Không có —</option>
        {Array.from({ length: width }, (_, i) => (
          <option key={i} value={i}>
            Cột {colName(i)}
            {aoa[cols.headerRow]?.[i] ? ` · ${String(aoa[cols.headerRow][i]).slice(0, 28)}` : ""}
          </option>
        ))}
      </select>
    </label>
  );

  const Chip: React.FC<{ v: View; label: string; n: number; tone: string }> = ({ v, label, n, tone }) => (
    <button
      type="button"
      onClick={() => {
        setView(v);
        setLimit(PAGE);
      }}
      className={`rounded-xl border px-3 py-2 text-left transition ${tone} ${view === v ? "ring-2 ring-slate-900" : ""}`}
    >
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{fmt(n)}</div>
    </button>
  );

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <ToastHost toasts={toasts} onClose={remove} />

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold">Đối soát tồn thực tế với hệ thống</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tải file kiểm kê (Excel) lên để so với tồn trong hệ thống. Trang chỉ để xem, không thay đổi tồn kho. Muốn
          chỉnh tồn theo kết quả, dùng <b>Kiểm kê kho</b>.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            So với tồn
            <select className="rounded-lg border px-2 py-1.5 text-sm text-slate-900" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
              <option value="">Tất cả (máy + linh kiện)</option>
              <option value="MACHINE">Chỉ máy móc</option>
              <option value="PART">Chỉ linh kiện</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Tồn hệ thống tại ngày
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={asOf}
                max={todayVN()}
                onChange={(e) => setAsOf(e.target.value)}
                className="rounded-lg border px-2 py-1 text-sm text-slate-900"
              />
              {asOf && (
                <button type="button" onClick={() => setAsOf("")} className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50" title="Về tồn hiện tại">
                  Hiện tại
                </button>
              )}
            </div>
          </label>
          <button type="button" onClick={loadSys} disabled={sysLoading} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60">
            {sysLoading ? "Đang tải tồn…" : "Tải lại tồn hệ thống"}
          </button>
          <span className="pb-1.5 text-xs text-slate-500">
            {sys.length ? `${fmt(sys.length)} mặt hàng` : ""}
            {sysLoading ? "" : sysAsOf ? (
              <b className="text-slate-700"> · tồn cuối ngày {fmtYmd(sysAsOf)}</b>
            ) : sysAt ? (
              ` · tồn hiện tại, lấy lúc ${sysAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
            ) : (
              ""
            )}
          </span>

          <div className="ml-auto flex flex-wrap items-end gap-2">
            <button type="button" onClick={() => setListOpen(true)} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
              Mở phiên đã lưu
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              {fileName ? "Chọn file khác" : "Tải file Excel kiểm kê"}
            </button>
          </div>
        </div>

        {/* ✅ phiên đối soát: lưu lên máy chủ, tự lưu khi ghép / bỏ ghép, F5 tự mở lại */}
        {book && (
          <div
            className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              sessionId ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            {sessionId ? (
              <>
                <span>
                  Phiên: <b>{sessionName}</b>
                </span>
                <span className="text-xs text-slate-600">
                  {saveState === "saving"
                    ? "· đang lưu…"
                    : saveState === "error"
                    ? "· ⚠ chưa lưu được, đang thử lại khi bạn sửa tiếp"
                    : savedAt
                    ? `· đã lưu lúc ${savedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} (tự lưu)`
                    : "· tự lưu"}
                </span>
                <button type="button" onClick={() => setNameOpen(true)} className="text-xs text-blue-700 hover:underline">
                  Đổi tên
                </button>
                <button type="button" onClick={newSession} className="ml-auto rounded-lg border bg-white px-3 py-1 text-xs hover:bg-slate-50">
                  Đóng phiên
                </button>
              </>
            ) : (
              <>
                <span className="text-amber-900">
                  Chưa lưu: F5 hoặc tải lại file sẽ mất các cặp đã ghép / bỏ ghép.
                </span>
                <button
                  type="button"
                  onClick={() => setNameOpen(true)}
                  className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Lưu phiên đối soát
                </button>
              </>
            )}
          </div>
        )}

        {book && (
          <div className="mt-4 rounded-lg border bg-slate-50 p-3">
            <div className="mb-2 text-sm">
              File: <b>{fileName}</b>
              {read && (
                <span className="text-slate-500">
                  {" "}
                  · đọc được {fmt(read.rows.length)} mặt hàng
                  {read.merged ? ` · ${read.merged} dòng trùng đã cộng dồn` : ""}
                  {read.skipped ? ` · bỏ qua ${read.skipped} dòng không có số lượng / dòng tổng` : ""}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {book.names.length > 1 && (
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  {useAll && usable.length > 1 ? "Chỉnh cột cho sheet" : "Sheet"}
                  <select className="rounded-lg border px-2 py-1.5 text-sm text-slate-900" value={sheet} onChange={(e) => setSheet(e.target.value)}>
                    {book.names.map((n) => (
                      <option key={n} value={n}>
                        {n}
                        {usable.includes(n) ? "" : " (chưa nhận ra cột)"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Dòng tiêu đề
                <select
                  className="rounded-lg border px-2 py-1.5 text-sm text-slate-900"
                  value={cols.headerRow}
                  onChange={(e) => setCols({ ...cols, headerRow: Number(e.target.value) })}
                >
                  {aoa.slice(0, 20).map((r, i) => (
                    <option key={i} value={i}>
                      Dòng {i + 1}: {r.filter(Boolean).slice(0, 4).join(" | ").slice(0, 40) || "(trống)"}
                    </option>
                  ))}
                </select>
              </label>
              {colSelect("Cột mã hàng", "code")}
              {colSelect("Cột tên hàng", "name")}
              {colSelect("Cột số lượng thực tế", "qty")}
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Sheet này là
                <select
                  className="rounded-lg border px-2 py-1.5 text-sm text-slate-900"
                  value={kindMap[sheet] || ""}
                  onChange={(e) => setKindMap((m) => ({ ...m, [sheet]: e.target.value as KindFilter }))}
                >
                  <option value="MACHINE">Máy móc (chỉ ghép với máy)</option>
                  <option value="PART">Linh kiện (chỉ ghép với linh kiện)</option>
                  <option value="">Không phân loại (ghép mọi loại)</option>
                </select>
              </label>
            </div>
            {book.names.length > 1 && (
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={useAll} onChange={(e) => setUseAll(e.target.checked)} />
                Đọc tất cả sheet cùng lúc
                <span className="text-slate-500">
                  ({usable.length ? usable.map((n) => {
                    const c = colsMap[n];
                    const L = (i: number) => (i >= 0 ? colName(i) : "—");
                    const kd = kindMap[n] === "MACHINE" ? "máy" : kindMap[n] === "PART" ? "linh kiện" : "mọi loại";
                    const off = !usedSheets.includes(n) ? " — bỏ qua theo ô So với tồn" : "";
                    return `${n} (${kd}): tên ${L(c.name)}, mã ${L(c.code)}, SL ${L(c.qty)}${off}`;
                  }).join(" · ") : "chưa sheet nào nhận ra cột"})
                </span>
              </label>
            )}
            {!okCols(cols) && (
              <div className="mt-2 text-sm text-rose-700">
                Sheet <b>{sheet}</b> chưa xác định được cột. Chọn cột <b>số lượng thực tế</b> và ít nhất một trong hai cột <b>mã</b> / <b>tên</b>
                {useAll && usable.length > 1 ? " (hoặc bỏ qua nếu sheet này không phải bảng tồn)." : "."}
              </div>
            )}
          </div>
        )}
      </div>

      {ready && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Chip v="ALL" label="Tất cả dòng" n={stats.all} tone="bg-white" />
            <Chip v="MATCHED" label={`Khớp mã / tên / ghép tay (${fmt(stats.matchedOk)} đúng số)`} n={stats.matched} tone="bg-emerald-50 border-emerald-200" />
            <Chip v="FUZZY" label="Gần giống — cần xem" n={stats.fuzzy} tone="bg-amber-50 border-amber-300" />
            <Chip v="UNMATCHED" label={`Không khớp (chỉ trong file ${fmt(stats.fileOnly)} · không thấy trong file ${fmt(stats.sysOnly)})`} n={stats.fileOnly + stats.sysOnly} tone="bg-rose-50 border-rose-300" />
            <Chip v="DIFF" label="Lệch số lượng" n={stats.diff} tone="bg-white" />
            <div className="rounded-xl border bg-white px-3 py-2">
              <div className="text-xs text-slate-500">Tổng chênh lệch</div>
              <div className="text-sm font-semibold tabular-nums">
                <span className="text-rose-600" title="Hệ thống thừa so với thực tế">+{fmt(stats.plus)}</span> /{" "}
                <span className="text-blue-700" title="Hệ thống thiếu so với thực tế">{fmt(stats.minus)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b p-3">
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }}
                placeholder="Tìm mã / tên (file hoặc hệ thống)"
                className="w-full max-w-xs rounded-lg border px-3 py-1.5 text-sm"
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={hideZeroSys} onChange={(e) => setHideZeroSys(e.target.checked)} />
                Ẩn hàng tồn hệ thống = 0 không có trong file
              </label>
              {rejected.size > 0 && (
                <button type="button" onClick={() => setRejected(new Set())} className="text-sm text-blue-700 hover:underline">
                  Ghép lại {rejected.size} cặp đã bỏ
                </button>
              )}
              <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded bg-amber-200" /> gần giống</span>
                <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded bg-rose-200" /> không khớp</span>
                <button type="button" onClick={exportExcel} className="rounded-lg border px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                  Xuất Excel
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium" rowSpan={2}>Trạng thái</th>
                    <th className="border-l px-3 py-1.5 text-center font-medium" colSpan={3}>File thực tế</th>
                    <th className="border-l px-3 py-1.5 text-center font-medium" colSpan={3}>Hệ thống</th>
                    <th className="border-l px-3 py-2 text-right font-medium" rowSpan={2}>
                      Chênh lệch
                      <div className="text-xs font-normal text-slate-400">HT − thực tế</div>
                    </th>
                    <th className="px-2 py-2" rowSpan={2} />
                  </tr>
                  <tr className="text-xs">
                    <th className="border-l px-3 py-1.5 text-left font-medium">Mã</th>
                    <th className="px-3 py-1.5 text-left font-medium">Tên</th>
                    <th className="px-3 py-1.5 text-right font-medium">SL thực tế</th>
                    <th className="border-l px-3 py-1.5 text-left font-medium">Mã</th>
                    <th className="px-3 py-1.5 text-left font-medium">Tên</th>
                    <th className="px-3 py-1.5 text-right font-medium">Tồn</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, limit).map((r) => (
                    <tr key={r.key} className={`border-t align-top ${ROW_BG[r.status]}`}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                        {r.status === "FUZZY" && r.score != null && (
                          <div className="mt-1 text-xs text-amber-800">
                            Giống {Math.round(r.score * 100)}% theo {r.fuzzyBy === "code" ? "mã" : "tên"}
                          </div>
                        )}
                        {r.file && <div className="mt-1 text-xs text-slate-400">{r.file.refs.join(", ")}</div>}
                      </td>
                      {r.file ? (
                        <>
                          <td className="border-l px-3 py-2 font-medium whitespace-nowrap">{r.file.code || "—"}</td>
                          <td className="px-3 py-2">{r.file.name || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(r.file.qty)}</td>
                        </>
                      ) : (
                        <>
                          <td className="border-l px-3 py-2 text-rose-700 italic" colSpan={2}>
                            Không có dòng nào trong file khớp với hàng này
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-rose-700" title="Không có trong file nên tính thực tế = 0">
                            0
                          </td>
                        </>
                      )}
                      <td className="border-l px-3 py-2 font-medium whitespace-nowrap">{r.sys?.sku || (r.sys ? "—" : "")}</td>
                      <td className="px-3 py-2">
                        {r.sys?.name}
                        {r.sys?.unit && <span className="text-xs text-slate-400"> · {r.sys.unit}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sys ? fmt(r.sys.qty) : ""}</td>
                      <td
                        className={`border-l px-3 py-2 text-right font-semibold tabular-nums ${
                          r.diff > 1e-9 ? "text-rose-600" : r.diff < -1e-9 ? "text-blue-700" : "text-emerald-600"
                        }`}
                      >
                        {Math.abs(r.diff) < 1e-9 ? "Khớp" : `${r.diff > 0 ? "+" : ""}${fmt(r.diff)}`}
                        {Math.abs(r.diff) > 1e-9 && (
                          <div className="text-xs font-normal whitespace-nowrap">{r.diff > 0 ? "HT thừa so với thực tế" : "HT thiếu so với thực tế"}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          {r.status === "FUZZY" && r.file && (
                            <button
                              type="button"
                              onClick={() => setPicker({ file: r.file!, currentId: r.sys?.itemId })}
                              title="Tìm đúng mặt hàng trong hệ thống (tên gọi khác)"
                              className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-100"
                            >
                              Chọn hàng khác
                            </button>
                          )}
                          {r.status === "FUZZY" && (
                            <button
                              type="button"
                              onClick={() => unpair(r.key)}
                              title="Hai dòng này không phải cùng một mặt hàng"
                              className="whitespace-nowrap rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                            >
                              Bỏ ghép
                            </button>
                          )}
                          {r.status === "FILE_ONLY" && r.file && (
                            <button
                              type="button"
                              onClick={() => setPicker({ file: r.file! })}
                              title="Hàng này có trong hệ thống nhưng tên / mã khác? Tìm để ghép"
                              className="whitespace-nowrap rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs text-rose-800 hover:bg-rose-100"
                            >
                              Tìm hàng để ghép
                            </button>
                          )}
                          {r.status === "FILE_ONLY" && r.file && (
                            <button
                              type="button"
                              onClick={() => setCreateFor(r.file!)}
                              title="Hệ thống chưa có hàng này: tạo mã hàng mới theo dòng trong file"
                              className="whitespace-nowrap rounded-lg border border-emerald-400 bg-white px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50"
                            >
                              + Tạo mã hàng
                            </button>
                          )}
                          {r.status === "SYSTEM_ONLY" && r.sys && (
                            <button
                              type="button"
                              onClick={() => setFilePicker(r.sys!)}
                              title="File có hàng này nhưng ghi tên / mã khác? Tìm dòng trong file để ghép"
                              className="whitespace-nowrap rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs text-rose-800 hover:bg-rose-100"
                            >
                              Tìm trong file
                            </button>
                          )}
                          {r.status === "MANUAL" && r.file && (
                            <button
                              type="button"
                              onClick={() => unpairManual(r.file!)}
                              title="Bỏ ghép tay (và xoá cặp đã lưu)"
                              className="whitespace-nowrap rounded-lg border border-sky-300 bg-white px-2 py-1 text-xs text-sky-800 hover:bg-sky-50"
                            >
                              Bỏ ghép tay
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-slate-400">Không có dòng nào.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {shown.length > limit && (
              <div className="border-t p-3 text-center">
                <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="rounded-lg border px-4 py-1.5 text-sm hover:bg-slate-50">
                  Xem thêm ({fmt(shown.length - limit)} dòng)
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {picker && (
        <ItemPicker
          file={picker.file}
          currentId={picker.currentId}
          items={sys}
          pairedWith={pairedWith}
          onPick={pickItem}
          onClose={() => setPicker(null)}
        />
      )}
      {filePicker && read && (
        <FileRowPicker
          item={filePicker}
          rows={read.rows}
          all={all}
          onPick={(f, remember) => {
            setFilePicker(null);
            pickItem(f, filePicker.itemId, remember);
          }}
          onClose={() => setFilePicker(null)}
        />
      )}
      {nameOpen && (
        <SessionNameModal
          initial={sessionName || `Đối soát ${fileName.replace(/\.[^.]+$/, "")} ${new Date().toLocaleDateString("vi-VN")}`}
          title={sessionId ? "Đổi tên phiên" : "Lưu phiên đối soát"}
          onClose={() => setNameOpen(false)}
          onSave={(n) => (sessionId ? renameSession(n) : createSession(n))}
        />
      )}
      {listOpen && (
        <SessionListModal
          currentId={sessionId}
          onOpen={(id) => openSession(id)}
          onDeleted={(id) => {
            if (id === sessionId) newSession();
          }}
          onClose={() => setListOpen(false)}
          onError={(m) => push({ type: "error", message: m })}
        />
      )}
      {createFor && (
        <CreateItemModal
          file={createFor}
          defaultKind={(createFor.kind as KindFilter) || kind || "PART"}
          isAdmin={isAdmin}
          onClose={() => setCreateFor(null)}
          onCreated={async (it) => {
            const f = createFor;
            setCreateFor(null);
            // ghép luôn dòng file với mã vừa tạo, rồi tải lại tồn để có mặt hàng mới
            setManual((m) => new Map(m).set(f.rowNo, it.id));
            await loadSys();
            push({ type: "success", message: `Đã tạo mã ${it.sku}. Tồn hệ thống đang là 0 — nhập tồn bằng phiếu kiểm kê hoặc phiếu nhập.` });
          }}
        />
      )}
    </div>
  );
};

/* ============ đặt tên phiên ============ */
const SessionNameModal: React.FC<{ initial: string; title: string; onClose: () => void; onSave: (name: string) => void }> = ({
  initial,
  title,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  const ok = () => name.trim() && onSave(name.trim());
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Lưu cả dữ liệu file, cột đã chọn, ngày lấy tồn và các cặp ghép tay / bỏ ghép. Admin và kế toán mở lại được trên mọi máy.
        </p>
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok()}
          className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">
            Huỷ
          </button>
          <button type="button" onClick={ok} disabled={!name.trim()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            Lưu
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============ danh sách phiên đã lưu ============ */
const SessionListModal: React.FC<{
  currentId: string | null;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}> = ({ currentId, onOpen, onDeleted, onClose, onError }) => {
  const [rows, setRows] = useState<SessionMeta[] | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  useEffect(() => {
    api
      .get("/stock-reconcile/sessions")
      .then((res) => setRows(res?.data?.data || []))
      .catch((e) => {
        setRows([]);
        onError(errMsg(e, "Không tải được danh sách phiên."));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const del = async (id: string) => {
    try {
      await api.delete(`/stock-reconcile/sessions/${id}`);
      setRows((rs) => (rs || []).filter((r) => r.id !== id));
      setConfirmDel(null);
      onDeleted(id);
    } catch (e) {
      onError(errMsg(e, "Không xoá được phiên."));
    }
  };
  const when = (v: string) =>
    new Date(v).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[8vh]" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold">Phiên đối soát đã lưu</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows === null && <div className="p-6 text-center text-sm text-slate-400">Đang tải…</div>}
          {rows?.length === 0 && <div className="p-6 text-center text-sm text-slate-400">Chưa có phiên nào được lưu.</div>}
          {rows?.map((r) => (
            <div key={r.id} className={`flex items-center justify-between gap-3 border-b px-4 py-3 text-sm ${r.id === currentId ? "bg-emerald-50" : ""}`}>
              <div className="min-w-0">
                <div className="font-medium">
                  {r.name} {r.id === currentId && <span className="text-xs font-normal text-emerald-700">(đang mở)</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {r.fileName || "—"} · sửa {when(r.updatedAt)}
                  {r.updatedBy ? ` bởi ${r.updatedBy}` : ""}
                  {r.createdBy && r.createdBy !== r.updatedBy ? ` · tạo bởi ${r.createdBy}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {confirmDel === r.id ? (
                  <>
                    <span className="text-xs text-rose-700">Xoá phiên này?</span>
                    <button type="button" onClick={() => del(r.id)} className="rounded-lg bg-rose-600 px-3 py-1 text-xs text-white">
                      Xoá
                    </button>
                    <button type="button" onClick={() => setConfirmDel(null)} className="rounded-lg border px-3 py-1 text-xs">
                      Không
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => onOpen(r.id)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
                      Mở
                    </button>
                    <button type="button" onClick={() => setConfirmDel(r.id)} className="rounded-lg border px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50">
                      Xoá
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ============ hộp tạo mã hàng từ 1 dòng trong file (chưa có trên hệ thống) ============ */
type UnitOpt = { id: string; code: string; name: string };
const CreateItemModal: React.FC<{
  file: FileRow;
  defaultKind: KindFilter;
  isAdmin: boolean;
  onClose: () => void;
  onCreated: (it: { id: string; sku: string; name: string }) => void;
}> = ({ file, defaultKind, isAdmin, onClose, onCreated }) => {
  const [sku, setSku] = useState(file.code.trim());
  const [name, setName] = useState(file.name.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim());
  const [itemKind, setItemKind] = useState<"PART" | "MACHINE">(defaultKind === "MACHINE" ? "MACHINE" : "PART");
  const [units, setUnits] = useState<UnitOpt[]>([]);
  const [unitId, setUnitId] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/items/units");
        const list: UnitOpt[] = res?.data?.data || [];
        setUnits(list);
        const pcs = list.find((u) => u.code === "pcs") || list.find((u) => normName(u.name) === "cai");
        setUnitId(pcs?.id || list[0]?.id || "");
      } catch {
        setErr("Không tải được danh sách đơn vị tính.");
      }
    })();
  }, []);

  const money = (v: string) => Number(v.replace(/[^\d]/g, "") || 0);
  const fmtInput = (v: string) => {
    const d = v.replace(/[^\d]/g, "");
    return d ? Number(d).toLocaleString("vi-VN") : "";
  };

  const save = async () => {
    if (!name.trim() && !sku.trim()) return setErr("Nhập ít nhất mã hoặc tên hàng.");
    setErr("");
    setSaving(true);
    try {
      const res = await api.post("/items", {
        sku: sku.trim(),
        name: name.trim(),
        kind: itemKind,
        unitId: unitId || undefined,
        sellPrice: money(sellPrice),
        ...(isAdmin && cost ? { price: money(cost) } : {}),
        note: `Tạo từ đối soát tồn (${file.refs.join(", ")})`,
      });
      const d = res?.data?.data || {};
      onCreated({ id: String(d.id), sku: String(d.sku || sku), name: String(d.name || name) });
    } catch (e) {
      setErr(errMsg(e, "Không tạo được mã hàng."));
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-lg border px-3 py-2 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[8vh]" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Tạo mã hàng mới</h2>
            <div className="mt-1 text-sm text-slate-600">
              Theo {file.refs.join(", ")} trong file · SL thực tế <b>{fmt(file.qty)}</b>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-600">
            Mã hàng
            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Để trống: tự sinh theo tên" className={field} />
          </label>
          <label className="text-xs text-slate-600">
            Loại
            <select value={itemKind} onChange={(e) => setItemKind(e.target.value as "PART" | "MACHINE")} className={field}>
              <option value="PART">Linh kiện</option>
              <option value="MACHINE">Máy móc</option>
            </select>
          </label>
          <label className="text-xs text-slate-600 sm:col-span-2">
            Tên hàng
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="text-xs text-slate-600">
            Đơn vị tính
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={field}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Giá bán đề xuất
            <input value={sellPrice} onChange={(e) => setSellPrice(fmtInput(e.target.value))} inputMode="numeric" placeholder="0" className={field} />
          </label>
          {isAdmin && (
            <label className="text-xs text-slate-600">
              Giá vốn
              <input value={cost} onChange={(e) => setCost(fmtInput(e.target.value))} inputMode="numeric" placeholder="0" className={field} />
            </label>
          )}
        </div>

        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          Tạo mã xong, tồn hệ thống của hàng này là <b>0</b>. Muốn đưa số lượng thực tế vào kho: thêm hàng vào phiếu kiểm kê
          (nút <b>Thêm vào phiếu</b>) rồi quản trị ghi sổ, hoặc lập phiếu nhập / hoá đơn mua.
        </p>

        {err && <div className="mt-2 text-sm text-rose-700">{err}</div>}

        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">
            Huỷ
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "Đang tạo…" : "Tạo mã hàng"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============ hộp tìm mặt hàng để ghép tay ============ */
const ItemPicker: React.FC<{
  file: FileRow;
  currentId?: string;
  items: SysItem[];
  pairedWith: Map<string, FileRow>;
  onPick: (f: FileRow, itemId: string, remember: boolean) => void;
  onClose: () => void;
}> = ({ file, currentId, items, pairedWith, onPick, onClose }) => {
  const [q, setQ] = useState(file.name || file.code);
  const [remember, setRemember] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // tìm không dấu, mọi từ đều phải có trong mã hoặc tên
  const found = useMemo(() => {
    const words = normName(q).split(" ").filter(Boolean);
    const list = items.filter((it) => {
      const hay = `${normName(it.sku)} ${normName(it.name)} ${it.sku.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      return words.every((w) => hay.includes(w));
    });
    return list.slice(0, 80);
  }, [q, items]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[8vh]" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Ghép với mặt hàng trong hệ thống</h2>
              <div className="mt-1 text-sm text-slate-600">
                {file.refs.join(", ")} trong file: <b>{file.code || "—"}</b> · {file.name || "—"} · SL thực tế{" "}
                <b>{fmt(file.qty)}</b>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng">
              ✕
            </button>
          </div>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Gõ tên gọi khác, mã hoặc một phần tên (không cần dấu)"
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Nhớ cặp này cho lần đối soát sau (trên máy này)
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {found.map((it) => {
            const other = pairedWith.get(it.itemId);
            const busy = other && other.rowNo !== file.rowNo;
            return (
              <button
                key={it.itemId}
                type="button"
                onClick={() => onPick(file, it.itemId, remember)}
                className={`flex w-full items-start justify-between gap-3 border-b px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${
                  it.itemId === currentId ? "bg-amber-50" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {it.sku || "—"} <span className="font-normal text-slate-700">· {it.name}</span>
                  </div>
                  {it.itemId === currentId && <div className="text-xs text-amber-800">Đang được ghép tự động (gần giống)</div>}
                  {busy && (
                    <div className="text-xs text-rose-700">
                      Đang ghép với {other!.refs.join(", ")} ({other!.code || other!.name}) — chọn sẽ chuyển sang dòng này
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular-nums">Tồn {fmt(it.qty)}</div>
                  {it.unit && <div className="text-xs text-slate-400">{it.unit}</div>}
                </div>
              </button>
            );
          })}
          {!found.length && <div className="p-8 text-center text-sm text-slate-400">Không tìm thấy mặt hàng nào. Thử gõ ngắn hơn.</div>}
          {found.length === 80 && <div className="p-2 text-center text-xs text-slate-400">Chỉ hiện 80 kết quả đầu, gõ cụ thể hơn để thu hẹp.</div>}
        </div>
      </div>
    </div>
  );
};

/* ============ hộp tìm dòng trong file cho 1 mặt hàng hệ thống ============ */
const FileRowPicker: React.FC<{
  item: SysItem;
  rows: FileRow[];
  all: ReconRow[];
  onPick: (f: FileRow, remember: boolean) => void;
  onClose: () => void;
}> = ({ item, rows, all, onPick, onClose }) => {
  const [q, setQ] = useState(() => item.name.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim());
  const [remember, setRemember] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // dòng file đang ghép với hàng nào (để báo)
  const pairOf = useMemo(() => {
    const m = new Map<number, ReconRow>();
    for (const r of all) if (r.file && r.sys) m.set(r.file.rowNo, r);
    return m;
  }, [all]);

  const found = useMemo(() => {
    const words = normName(q).split(" ").filter(Boolean);
    const list = rows.filter((f) => {
      const hay = `${normName(f.code)} ${normName(f.name)} ${f.code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      return words.every((w) => hay.includes(w));
    });
    // dòng chưa ghép lên trước
    list.sort((a, b) => Number(pairOf.has(a.rowNo)) - Number(pairOf.has(b.rowNo)) || a.rowNo - b.rowNo);
    return list.slice(0, 80);
  }, [q, rows, pairOf]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[8vh]" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Tìm dòng trong file cho mặt hàng này</h2>
              <div className="mt-1 text-sm text-slate-600">
                Hệ thống: <b>{item.sku || "—"}</b> · {item.name} · tồn <b>{fmt(item.qty)}</b>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Đóng">
              ✕
            </button>
          </div>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Gõ tên / mã như trong file (không cần dấu)"
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Nhớ cặp này cho lần đối soát sau (trên máy này)
          </label>
        </div>
        <div className="flex-1 overflow-y-auto">
          {found.map((f) => {
            const pr = pairOf.get(f.rowNo);
            return (
              <button
                key={f.rowNo}
                type="button"
                onClick={() => onPick(f, remember)}
                className="flex w-full items-start justify-between gap-3 border-b px-4 py-2.5 text-left text-sm hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {f.code || "—"} <span className="font-normal text-slate-700">· {f.name || "—"}</span>
                  </div>
                  <div className="text-xs text-slate-400">{f.refs.join(", ")}</div>
                  {pr && (
                    <div className="text-xs text-amber-800">
                      Đang ghép với {pr.sys?.sku || pr.sys?.name} ({STATUS_LABEL[pr.status]}) — chọn sẽ chuyển sang hàng này
                    </div>
                  )}
                </div>
                <div className="shrink-0 tabular-nums">SL thực tế {fmt(f.qty)}</div>
              </button>
            );
          })}
          {!found.length && (
            <div className="p-8 text-center text-sm text-slate-400">
              Không có dòng nào trong file khớp với chữ đã gõ. Thử gõ ngắn hơn, hoặc file thực sự không có hàng này.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StockReconcilePage;