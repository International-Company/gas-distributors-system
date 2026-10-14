"use client";

// القراءة الضوئية في متصفح الموزّع (tesseract.js). الصور لا تُرسل إلى الخادم ولا تُخزن.
// تُحمّل المكتبات عند الحاجة فقط لتقليل حجم الصفحات.
// ملاحظة: tesseract.js يجلب ملفات المحرك واللغة من شبكة CDN عند أول استخدام.

import type { TextItem } from "./table-from-items";
import { extractNationalIds } from "./national-id";

export type Progress = (stage: string, ratio: number) => void;

type Word = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
type Block = { paragraphs: { lines: { words: Word[] }[] }[] };

function wordsOf(blocks: Block[] | null | undefined): Word[] {
  return (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
}

/** يقرأ رقم الهوية من صورة. يرجع الأرقام الصالحة فقط (رقم التحقق صحيح)، ولا يبحث قبل تأكيد المستخدم. */
export async function readIdNumbersFromImage(file: File, onProgress?: Progress): Promise<{ ids: string[]; raw: string }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
  });
  try {
    await worker.setParameters({ tessedit_char_whitelist: "0123456789 " });
    const { data } = await worker.recognize(file);
    return { ids: extractNationalIds(data.text), raw: data.text };
  } finally {
    await worker.terminate();
  }
}

/** يحوّل صفحات PDF ممسوحة ضوئيًا إلى كلمات بمواضعها لبناء الجدول على الخادم. */
export async function ocrPdf(data: ArrayBuffer, onProgress?: Progress): Promise<{ items: TextItem[]; confidence: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const { createWorker } = await import("tesseract.js");
  let page = 0;
  const worker = await createWorker(["ara", "eng"], 1, {
    logger: (m: { status: string; progress: number }) => onProgress?.(`الصفحة ${page} من ${pdf.numPages}: ${m.status}`, (page - 1 + m.progress) / pdf.numPages),
  });
  const items: TextItem[] = [];
  let confSum = 0;
  let confN = 0;
  try {
    for (page = 1; page <= pdf.numPages; page++) {
      const p = await pdf.getPage(page);
      const scale = 2.5; // دقة أعلى تحسن القراءة
      const viewport = p.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await p.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      const { data: res } = await worker.recognize(canvas, {}, { blocks: true });
      for (const w of wordsOf(res.blocks as unknown as Block[])) {
        if (!w.text.trim()) continue;
        items.push({ text: w.text, x: w.bbox.x0 / scale, y: w.bbox.y0 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, h: (w.bbox.y1 - w.bbox.y0) / scale, page });
        confSum += w.confidence;
        confN++;
      }
      canvas.width = canvas.height = 0;
    }
  } finally {
    await worker.terminate();
  }
  return { items, confidence: confN ? Math.round(confSum / confN) : 0 };
}
