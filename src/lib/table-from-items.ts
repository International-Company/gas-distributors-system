// يبني جدولًا من كلمات لها مواضع على الصفحة (نص PDF أو نتيجة قراءة ضوئية).
// الصفوف: تجميع حسب الإحداثي الرأسي. الأعمدة: مراسي من صف العناوين (أو أكثر الصفوف خلايا)،
// وكل كلمة تُسند لأقرب مرسى. الاتجاه من اليمين لليسار.

export type TextItem = { text: string; x: number; y: number; w: number; h: number; page: number };

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
function lineCells(line: TextItem[]): { text: string; center: number }[] {
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

export function itemsToTable(items: TextItem[], headerHint?: (cells: string[]) => boolean): string[][] {
  const lines = groupLines(items).map(lineCells);
  if (!lines.length) return [];
  // المراسي: صف العناوين إن عُرف، وإلا الصف ذو أكبر عدد من الخلايا.
  let anchorLine = headerHint ? lines.find((l) => headerHint(l.map((c) => c.text))) : undefined;
  if (!anchorLine) anchorLine = lines.reduce((a, b) => (b.length > a.length ? b : a));
  const anchors = anchorLine.map((c) => c.center).sort((a, b) => b - a); // يمين ← يسار
  return lines.map((line) => {
    const row: string[] = anchors.map(() => "");
    for (const c of line) {
      let best = 0;
      let bestDist = Infinity;
      anchors.forEach((a, i) => {
        const d = Math.abs(a - c.center);
        if (d < bestDist) [bestDist, best] = [d, i];
      });
      row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
    }
    return row;
  });
}
