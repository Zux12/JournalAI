import { createWorker } from 'tesseract.js';

export async function ocrImageFiles(files, onProgress){
  const worker = await createWorker({
    logger: m => { if(m.status==='recognizing text' && onProgress) onProgress(m.progress); }
  });
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  let text = '';
  for(const f of files){
    const { data: { text: t } } = await worker.recognize(f);
    text += t + '\n';
  }
  await worker.terminate();
  return text.trim();
}
