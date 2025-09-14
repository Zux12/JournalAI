import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useProjectState } from './app/state.js';
import './app/styles.css';

export default function App() {
  const { project, setStyleId } = useProjectState();
  const loc = useLocation();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">IgniteJournal</div>
        <nav>
          <Link to="/">Landing</Link>
          <Link to="/metadata">Metadata</Link>
          <Link to="/planner">Section Planner</Link>
          <Link to="/qa">Guided Q&A</Link>
          <Link to="/figures">Figures & Tables</Link>
          <Link to="/references">References</Link>
          <Link to="/declarations">Declarations</Link>
          <Link to="/preview">Preview & Export</Link>
        </nav>
        <div className="picker">
          <label>Style</label>
          <select value={project.styleId} onChange={(e)=>setStyleId(e.target.value)}>
            <option value="ieee">IEEE (numeric)</option>
            <option value="icheme-harvard">IChemE (author-date)</option>
            <option value="apa-7">APA 7th</option>
            <option value="vancouver">Vancouver / ICMJE</option>
            <option value="acs">ACS</option>
            <option value="acm">ACM</option>
            <option value="nature">Nature (superscript)</option>
            <option value="ama">AMA</option>
            <option value="chicago-ad">Chicago Author-Date</option>
          </select>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <strong>{project.metadata.title || 'Untitled project'}</strong>
            <div className="sub">Saved locally • {project.articleType} • {project.styleId}</div>
          </div>
          <Link to="/preview" className="btn">Export</Link>
        </header>
        <div className="page"><Outlet key={loc.key} /></div>
      </main>
    </div>
  );
}
