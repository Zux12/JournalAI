import React from 'react';
import axios from 'axios';
import * as pdfjsLib from 'pdfjs-dist';
import { useProjectState } from '../../app/state.jsx';
import { ocrPdf } from '../../lib/ocr.js';
import { extractTextFromPDF } from '../../lib/pdf.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function Sources(){
  const { project, setSources, setSectionNotes } = useProjectState();
  const [queue, setQueue] = React.useState([]);
  const [error, setError] = React.useState('');
  const [busySumm, setBusySumm] = React.useState({}); // id -> boolean
  const sections = (project.planner?.sections || []).filter(s => !s.skipped && s.id !== 'refs');

  function addToSources(entry){
    const next = [...(project.sources || []), entry];
    setSources(next);
  }

  async function handleFiles(e){
    setError('');
    const files = Array.from(e.target.files || []);
    for(const f of files){
      if (!/\.pdf$/i.test(f.name)) { setError('Only PDF supported at MVP'); continue; }
      const id = crypto.randomUUID();
      setQueue(prev=>[...prev, { id, name: f.name, progress: 0, status: 'extracting' }]);

      try {
        const text = await extractTextFromPDF(f);
        const ok = text && text.replace(/\s+/g,' ').trim().length > 120;
        if (ok) {
          addToSources({ id, name: f.name, bytes: f.size, ocrUsed: false, text });
          setQueue(prev=>prev.map(x=>x.id===id?{...x, progress:1, status:'done'}:x));
          continue;
        }
        setQueue(prev=>prev.map(x=>x.id===id?{...x, status:'ocr'}:x));
        const ocrText = await ocrPdf(f, (p)=> setQueue(prev=>prev.map(x=>x.id===id?{...x, progress:p}:x)));
        addToSources({ id, name: f.name, bytes: f.size, ocrUsed: true, text: ocrText });
        setQueue(prev=>prev.map(x=>x.id===id?{...x, progress:1, status:'done'}:x));
      } catch (err) {
        console.error(err);
        setQueue(prev=>prev.map(x=>x.id===id?{...x, status:'error'}:x));
        setError('Failed to parse one or more PDFs.');
      }
    }
  }

  function removeSource(id){
    setSources((project.sources||[]).filter(s=>s.id!==id));
  }

  function copyText(t){
    navigator.clipboard.writeText(t||'');
    alert('Copied to clipboard.');
  }

  async function summarizeAndInsert(srcId, sectionId){
    try{
      const src = (project.sources || []).find(s => s.id === srcId);
      if (!src || !sectionId) return;
      setBusySumm(prev=>({ ...prev, [srcId]: true }));
      const { data } = await axios.post('/api/ai/summarize', {
        text: src.text,
        maxWords: 240,
        focus: `${project.metadata?.title || ''} – ${sectionId}`
      });
      const bullets = (data.summary || '').trim();
      if (!bullets) return;
      const existing = project.sections?.[sectionId]?.notes || '';
      const spacer = existing ? '\n' : '';
      setSectionNotes(sectionId, existing + spacer + bullets);
      alert('Summary inserted into Notes.');
    } catch(e){
      alert('Summarize failed.');
    } finally {
      setBusySumm(prev=>({ ...prev, [srcId]: false }));
    }
  }

  return (
    <div className="card">
      <h2>Sources (PDF / OCR)</h2>
      <p>Upload articles. We’ll extract or OCR text in-browser. Then you can summarize any source and insert the bullets into a section’s Notes.</p>
      <input type="file" accept="application/pdf" multiple onChange={handleFiles} />
      {error && <div className="warn" style={{marginTop:12}}>{error}</div>}

      {queue.length>0 && (
        <div style={{marginTop:12}}>
          <h3>In progress</h3>
          {queue.map(item=>(
            <div key={item.id} className="card" style={{padding:'12px'}}>
              <div><strong>{item.name}</strong> — {item.status==='extracting'?'Extracting text…':item.status==='ocr'?'OCR running…':'Done'}</div>
              <div style={{height:8, background:'#eee', borderRadius:6, overflow:'hidden', marginTop:8}}>
                <div style={{height:'100%', width:`${Math.round((item.progress||0)*100)}%`, background:'linear-gradient(90deg,#93c5fd,#3b82f6)'}} />
              </div>
              <div style={{fontSize:12, color:'#667', marginTop:4}}>{Math.round((item.progress||0)*100)}%</div>
            </div>
          ))}
        </div>
      )}

      <div style={{marginTop:16}}>
        <h3>Saved ({(project.sources||[]).length})</h3>
        {(project.sources||[]).map(src=>(
          <div key={src.id} className="card">
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <strong>{src.name}</strong>
              {src.ocrUsed ? <span className="badge">OCR</span> : <span className="badge">Text</span>}
              <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                <button onClick={()=>copyText(src.text)}>Copy Text</button>
                <button onClick={()=>removeSource(src.id)}>Remove</button>
              </div>
            </div>

            <details style={{marginTop:8}}>
              <summary>Show extracted text</summary>
              <div style={{whiteSpace:'pre-wrap', marginTop:8, background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:12, maxHeight:240, overflow:'auto'}}>
                {src.text}
              </div>
            </details>

            <div className="row cols-2" style={{marginTop:8, alignItems:'end'}}>
              <div>
                <label>Insert summary into section</label>
                <select id={`sec-${src.id}`} className="input" defaultValue="">
                  <option value="" disabled>Select section…</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{display:'flex', gap:8}}>
                <button
                  className="btn"
                  disabled={!!busySumm[src.id]}
                  onClick={()=>{
                    const sel = document.getElementById(`sec-${src.id}`);
                    summarizeAndInsert(src.id, sel?.value);
                  }}
                >
                  {busySumm[src.id] ? 'Summarizing…' : 'Summarize → Insert'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
