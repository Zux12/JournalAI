import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * Render a PDF page to a canvas and return the canvas element.
 */
async function renderPdfPageToCanvas(pdf, pageNumber, scale = 1.5) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * OCR a PDF by rendering each page and recognizing with Tesseract.
 * onProgress is called with a number [0..1].
 */
export async function ocrPdf(file, onProgress) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;

  const worker = await createWorker({
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof onProgress === 'function') {
        // m.progress is [0..1] for a single page; we’ll convert to overall later
      }
    }
  });
  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  let text = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const canvas = await renderPdfPageToCanvas(pdf, p, 1.7);
    const { data: { text: t } } = await worker.recognize(canvas);
    text += t + '\n';
    if (typeof onProgress === 'function') onProgress(p / pdf.numPages);
  }

  await worker.terminate();
  return text.trim();
}
