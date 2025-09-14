import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectState } from '../../app/state.js';

export default function Landing(){
  const nav = useNavigate();
  const { project } = useProjectState();
  return (
    <div className="card">
      <h2>Welcome to IgniteJournal (MVP)</h2>
      <p>AI-assisted academic writing, saved locally. You can skip sections (with warnings), upload PDFs for OCR, manage references, and export clean text.</p>
      <div className="warn" style={{marginTop:12}}>Note: Everything is stored in your browser (localStorage). No signup required.</div>
      <div style={{marginTop:16, display:'flex', gap:12}}>
        <button className="btn" onClick={()=>nav('/metadata')}>Start New Project</button>
        <button onClick={()=>nav('/preview')}>Open Current Project</button>
      </div>
      <div style={{marginTop:16}}><span className="badge">Style</span> {project.styleId}</div>
    </div>
  );
}
