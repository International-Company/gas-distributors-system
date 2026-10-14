// يبني جدولًا من كلمات لها مواضع على الصفحة (نص PDF أو نتيجة قراءة ضوئية).
// الصفوف: تجميع حسب الإحداثي الرأسي. الأعمدة: مراسي من صف العناوين (أو أكثر الصفوف خلايا)،
// وكل كلمة تُسند لأقرب مرسى. الاتجاه من اليمين لليسار.
// الخلايا الملتفة على عدة أسطر (اسم طويل) تُدمج في صفها: السطر الذي لا يحمل رقم هوية
// في عمود الهوية يُلحق بأقرب سطر يحمله إن كان قريبًا رأسيًا.

export type TextItem = { text: string; x: number; y: number; w: number; h: number; page: number };

type Cell = { text: string; center: number };
type Line = { cells: Cell[]; y: number; page: number };

const isBlank = (s: string) => !s.replace(/[\s​-‏]/g, "");

/** تجميع الكلمات إلى أسطر. y يزداد للأسفل. */
function groupLines(items: TextItem[]): TextItem[][] {
  const sorted = items.filter((i) => !isBlank(i.text)).sort((a, b) => a.page - b.page || a.y - b.y);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const ref = last?.[0];
    const tol = Math.max(3, (ref?.h ?? it.h) * 0.5);
    if (ref && ref.page === it.page && Math.abs(ref.y - it.y) <= tol) last.push(it);
    else lines.push([it]);
  }
  return lines;
}

/** دمج الكلمات المتجاورة في السطر إلى خلايا (فجوة صغيرة = الخلية نفسها). */
function lineCells(line: TextItem[]): Cell[] {
  const items = [...line].sort((a, b) => b.x + b.w - (a.x + a.w)); // من اليمين لليسار
  const cells: { items: TextItem[]; left: number; right: number }[] = [];
  for (const it of items) {
    const cur = cells[cells.length - 1];
    const gap = cur ? cur.left - (it.x + it.w) : Infinity;
    const avgH = it.h || 8;
    if (cur && gap < avgH * 1.2) {
      cur.items.push(it);
      cur.left = Math.min(cur.left, it.x);
    } else cells.push({ items: [it], left: it.x, right: it.x + it.w });
  }
  return cells.map((c) => ({
    text: c.items.map((i) => i.text.trim()).filter(Boolean).join(" "),
    center: (c.left + c.right) / 2,
  }));
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function itemsToTable(items: TextItem[], headerHint?: (cells: string[]) => boolean): string[][] {
  const lines: Line[] = groupLines(items).map((l) => ({ cells: lineCells(l), y: l.reduce((a, i) => a + i.y, 0) / l.length, page: l[0].page }));
  if (!lines.length) return [];
  // المراسي: صف العناوين إن عُرف، وإلا الصف ذو أكبر عدد من الخلايا.
  let anchorLine = headerHint ? lines.find((l) => headerHint(l.cells.map((c) => c.text))) : undefined;
  if (!anchorLine) anchorLine = lines.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
  const anchors = anchorLine.cells.map((c) => c.center).sort((a, b) => b - a); // يمين ← يسار

  const toRow = (cells: Cell[]) => {
    const row: string[][] = anchors.map(() => []);
    for (const c of cells) {
      let best = 0;
      let bestDist = Infinity;
      anchors.forEach((a, i) => {
        const d = Math.abs(a - c.center);
        if (d < bestDist) [bestDist, best] = [d, i];
      });
      row[best].push(c.text);
    }
    return row;
  };
  const rows = lines.map((l) => ({ line: l, cols: toRow(l.cells) }));
  return mergeWrappedLines(rows, anchorLine).map((r) => r.cols.map((parts) => parts.join(" ")));
}

/**
 * عمود المفتاح = العمود الذي تحمل أكثر الأسطر فيه رقمًا من 9 خانات (رقم الهوية).
 * السطر دون مفتاح يُلحق بأقرب سطر مفتاح في الصفحة نفسها إن كانت المسافة أقل من
 * 0.6 من المسافة المعتادة بين صفوف البيانات؛ وإلا يبقى سطرًا مستقلًا (عناوين وما شابه).
 */
function mergeWrappedLines(rows: { line: Line; cols: string[][] }[], header: Line) {
  const ncols = rows[0]?.cols.length ?? 0;
  const isId = (parts: string[]) => /^\d{9}$/.test(parts.join("").replace(/\s/g, ""));
  let keyCol = -1;
  let bestCount = 0;
  for (let c = 0; c < ncols; c++) {
    const n = rows.filter((r) => isId(r.cols[c])).length;
    if (n > bestCount) [bestCount, keyCol] = [n, c];
  }
  if (keyCol < 0 || bestCount < 3) return rows;

  const keyed = rows.filter((r) => isId(r.cols[keyCol]));
  const gaps: number[] = [];
  for (let i = 1; i < keyed.length; i++) {
    if (keyed[i].line.page === keyed[i - 1].line.page) gaps.push(keyed[i].line.y - keyed[i - 1].line.y);
  }
  const threshold = median(gaps) * 0.6;
  if (!threshold) return rows;

  // أجزاء كل سطر مفتاح مرتبة رأسيًا: [y، أعمدة].
  const attached = new Map<(typeof rows)[number], { y: number; cols: string[][] }[]>();
  for (const k of keyed) attached.set(k, [{ y: k.line.y, cols: k.cols }]);
  const out: typeof rows = [];
  for (const r of rows) {
    if (attached.has(r)) {
      out.push(r);
      continue;
    }
    if (r.line === header) {
      out.push(r);
      continue;
    }
    let nearest: (typeof rows)[number] | null = null;
    let dist = Infinity;
    for (const k of keyed) {
      if (k.line.page !== r.line.page) continue;
      const d = Math.abs(k.line.y - r.line.y);
      if (d < dist) [dist, nearest] = [d, k];
    }
    if (nearest && dist <= threshold) attached.get(nearest)!.push({ y: r.line.y, cols: r.cols });
    else out.push(r);
  }
  return out.map((r) => {
    const parts = attached.get(r);
    if (!parts || parts.length === 1) return r;
    parts.sort((a, b) => a.y - b.y);
    return { line: r.line, cols: r.cols.map((_, c) => parts.flatMap((p) => p.cols[c])) };
  });
}
