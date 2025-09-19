import React from 'react';

const DEFAULT_PROJECT = {
  id: 'local',
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  styleId: 'ieee',
  articleType: 'research',
  metadata: { title: '', discipline: '', keywords: [], authors: [] },
  planner: {
    sections: [
      { id:'abs', name:'Abstract', status:'todo', skipped:false },
      { id:'intro', name:'Introduction', status:'todo', skipped:false },
      { id:'methods', name:'Methods', status:'todo', skipped:false },
      { id:'results', name:'Results', status:'todo', skipped:false },
      { id:'discussion', name:'Discussion', status:'todo', skipped:false },
      { id:'conclusion', name:'Conclusion', status:'todo', skipped:false },
      { id:'acks', name:'Acknowledgements', status:'todo', skipped:true },
      { id:'compliance', name:'Compliance', status:'todo', skipped:false },
      { id:'refs', name:'References', status:'system', skipped:false }
    ]
  },
  sections: {},
  figures: [],
  tables: [],
  visualProposals: [], // proposed figures/tables (persisted)
  visualPlacements: {}, // per-item placement suggestions { [id]: { placement, paragraphs } }
  generatedTableProposals: [], // AI-generated table proposals (persisted)

  sources: [], // <— NEW: uploaded article PDFs after extraction/OCR
  declarations: { ethicsIRB:'', consent:'', dataAvailability:'', codeAvailability:'', conflicts:'' },
  references: { styleId:'ieee', items:[], unresolved:[] },
  settings: { humanize:'off', warnOnSkip:true }
};

function freshProject(){
  // Deep clone DEFAULT_PROJECT and refresh timestamps
  const base = JSON.parse(JSON.stringify(DEFAULT_PROJECT));
  const now = new Date().toISOString();
  base.createdAt = now;
  base.updatedAt = now;
  return base;
}


const KEY = 'journalai.project';

function readProject(){
  try { return JSON.parse(localStorage.getItem(KEY)) || DEFAULT_PROJECT; }
  catch { return DEFAULT_PROJECT; }
}
function writeProject(p){
  const updated = { ...p, updatedAt:new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(updated));
  return updated;
}

const Ctx = React.createContext(null);

export function ProjectProvider({ children }){
  const [project, setProject] = React.useState(readProject());
  const update = React.useCallback(fn => setProject(prev => writeProject(fn(prev))), []);
  const setStyleId = (styleId)=>update(p=>({ ...p, styleId }));
  const setMetadata = (metadata)=>update(p=>({ ...p, metadata }));
  const resetProject = ()=> setProject(writeProject(freshProject()));
  const setPlanner = (planner)=>update(p=>({ ...p, planner }));
  const setSectionDraft = (id, draft)=>update(p=>({ ...p, sections: { ...p.sections, [id]: { ...(p.sections[id]||{}), draft } } }));
  const setSectionDraftRaw = (id, draftRaw)=>update(p=>({ ...p, sections: { ...p.sections, [id]: { ...(p.sections[id]||{}), draftRaw } } }));
  const setSectionNotes = (id, notes)=>update(p=>({ ...p, sections: { ...p.sections, [id]: { ...(p.sections[id]||{}), notes } } }));
  const setSectionCitedKeys = (id, citedKeys)=>update(p=>({ ...p, sections: { ...p.sections, [id]: { ...(p.sections[id]||{}), citedKeys } } }));
  const setFigures = (figures)=>update(p=>({ ...p, figures }));
  const setTables  = (tables)=>update(p=>({ ...p, tables }));
  const setVisualProposals = (visualProposals)=>update(p=>({ ...p, visualProposals }));
  const setVisualPlacements = (visualPlacements)=>update(p=>({ ...p, visualPlacements }));
  const setGeneratedTableProposals = (generatedTableProposals)=>update(p=>({ ...p, generatedTableProposals }));
  const setReferences = (refs)=>update(p=>({ ...p, references: refs }));
  const setSources = (sources)=>update(p=>({ ...p, sources })); // <— NEW   
  const value = { project, update, resetProject, setStyleId, setMetadata, setPlanner, setSectionDraft, setSectionDraftRaw, setSectionNotes, setSectionCitedKeys, setFigures, setTables, setVisualProposals, setVisualPlacements, setGeneratedTableProposals, setSources, setReferences };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectState(){ return React.useContext(Ctx); }
