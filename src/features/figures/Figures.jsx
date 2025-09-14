import React from 'react';

export default function Figures(){
  const [items, setItems] = React.useState([]);
  function onFiles(e){
    const files = Array.from(e.target.files||[]);
    const mapped = files.map(f=>({ id:crypto.randomUUID(), name:f.name, file:f, caption:'', kind: f.type.includes('csv')?'table':'figure' }));
    setItems(prev=>[...prev, ...mapped]);
  }
  function setCaption(id, v){ setItems(prev=>prev.map(x=>x.id===id?{...x, caption:v}:x)); }

  return (
    <div className="card">
      <h2>Figures & Tables</h2>
      <input type="file" multiple onChange={onFiles}/>
      <div style={{marginTop:12}}>
        {items.map((it, idx)=>(
          <div key={it.id} className="card">
            <div><strong>{it.kind==='table'?'Table':'Figure'} {idx+1}:</strong> {it.name}</div>
            <label>Caption</label>
            <input className="input" value={it.caption} onChange={e=>setCaption(it.id, e.target.value)} placeholder="Enter caption"/>
          </div>
        ))}
      </div>
    </div>
  );
}
