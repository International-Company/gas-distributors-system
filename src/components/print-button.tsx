"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/** يفتح نافذة الطباعة تلقائيًا مرة واحدة، ويبقي زرًا لإعادة الطباعة أو الحفظ PDF. */
export function PrintButton() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-gray-400 px-4 py-2 text-sm">
      <Printer className="size-4" /> طباعة / حفظ PDF
    </button>
  );
}
