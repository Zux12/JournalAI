import React from 'react';

export default function Declarations(){
  const [vals, setVals] = React.useState({
    ethicsIRB:'', consent:'', dataAvailability:'', codeAvailability:'', conflicts:''
  });
  function setField(k,v){ setVals(prev=>({ ...prev, [k]:v })); }

  return (
    <div className="card">
      <h2>Declarations</h2>
      <div className="warn">Skipping these may cause rejection in some journals.</div>
      {['ethicsIRB','consent','dataAvailability','codeAvailability','conflicts'].map(k=>(
        <div key={k} style={{marginTop:12}}>
          <label>{k}</label>
          <textarea className="input" rows="3" value={vals[k]} onChange={e=>setField(k, e.target.value)} />
        </div>
      ))}
    </div>
  );
}
