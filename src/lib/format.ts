// تنسيق موحّد للتواريخ: يوم/شهر/سنة بأرقام لاتينية وبتوقيت غزة.
// الصيغة نص لاتيني خالص (بلا فواصل عربية أو علامات اتجاه) حتى لا يضطرب ترتيبه داخل نص عربي.
export const TIME_ZONE = "Asia/Gaza";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const toDate = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? new Date(d) : d) : null);

function parts(x: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(x).map((q) => [q.type, q.value]));
  return { date: `${p.day}/${p.month}/${p.year}`, time: `${p.hour}:${p.minute}` };
}

/** نص التاريخ دون علامات اتجاه (لملفات Excel). */
export function plainDate(d: Date | string | null | undefined, fallback = "") {
  const x = toDate(d);
  return x ? parts(x).date : fallback;
}

export function plainDateTime(d: Date | string | null | undefined, fallback = "") {
  const x = toDate(d);
  if (!x) return fallback;
  const p = parts(x);
  return `${p.date} ${p.time}`;
}

// علامتا العزل LRI/PDI تجعلان النص اللاتيني (تاريخ، رقم جرة «501-1») يُعرض من اليسار لليمين داخل جملة عربية فلا ينقلب.
export const isolate = (s: string) => `⁦${s}⁩`;

export function formatDate(d: Date | string | null | undefined, fallback = "—") {
  return toDate(d) ? isolate(plainDate(d)) : fallback;
}

export function formatDateTime(d: Date | string | null | undefined, fallback = "—") {
  return toDate(d) ? isolate(plainDateTime(d)) : fallback;
}

/** مبلغ بمنزلتين عشريتين وفواصل آلاف، معزول الاتجاه. القيمة نص عشري أو Decimal (لا تحويل لعدد عائم). */
export function formatMoney(v: { toString(): string } | string | number | null | undefined, symbol = "") {
  if (v === null || v === undefined) return "—";
  const [int, frac = ""] = String(v).split(".");
  const neg = int.startsWith("-");
  const digits = (neg ? int.slice(1) : int).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const s = `${neg ? "-" : ""}${digits}.${(frac + "00").slice(0, 2)}`;
  return isolate(symbol ? `${s} ${symbol}` : s);
}

/** قيمة مناسبة لحقل <input type="date"> بتوقيت غزة. */
export function toDateInput(d: Date | string | null | undefined) {
  const x = toDate(d);
  if (!x) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
}

/** يحوّل تاريخًا من حقل إدخال إلى نهاية ذلك اليوم (حتى يبقى الحساب صالحًا طوال يوم الانتهاء). */
export function endOfDayIso(dateInput: string) {
  return dateInput ? new Date(`${dateInput}T23:59:59`).toISOString() : null;
}
