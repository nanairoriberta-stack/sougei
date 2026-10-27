(()=>{const docs=new Map(),leases=new Map(),subs=new Set();let offline=false;window.__setOffline=v=>{offline=v};window.__docs=docs;
const wait=ms=>new Promise(r=>setTimeout(r,ms));const fire=()=>subs.forEach(f=>f());
const match=(d,fs)=>fs.every(([f,o,x])=>o==='>='?d[f]>=x:o==='<='?d[f]<=x:o==='<'?d[f]<x:o==='=='?d[f]===x:true);
function snap(col,fs){const out=[];for(const[p,v]of docs){const parts=p.split('/');if(parts.length!==2||parts[0]!==col)continue;const d=JSON.parse(v);if(match(d,fs))out.push({id:parts[1],exists:true,data:()=>JSON.parse(v),metadata:{}})}return{docs:out,size:out.length,empty:!out.length,docChanges:()=>[],metadata:{}}}
function q(col,fs){return{where(f,o,v){return q(col,fs.concat([[f,o,v]]))},orderBy(){return this},limit(){return this},async get(){await wait(20);if(offline)throw{code:'unavailable'};return snap(col,fs)},onSnapshot(n){const f=()=>{if(!offline)n(snap(col,fs))};subs.add(f);setTimeout(f,30);return()=>subs.delete(f)}}}
const db={collection:c=>q(c,[]),doc:p=>({
 async get(){await wait(25);if(offline)throw{code:'unavailable'};const v=docs.get(p);return{exists:!!v,data:()=>JSON.parse(v),metadata:{}}},
 async set(d){await wait(25);if(offline)throw{code:'unavailable'};docs.set(p,JSON.stringify(d));setTimeout(fire,5)},
 async delete(){await wait(20);if(offline)throw{code:'unavailable'};docs.delete(p);setTimeout(fire,5)},
 async acquire({holder,ttlMs}){await wait(15);if(offline)throw{code:'unavailable'};const l=leases.get(p),t=Date.now();if(!l||l.exp<=t||l.holder===holder){leases.set(p,{holder,exp:t+Math.max(1000,ttlMs)});return{acquired:true,expiresAt:new Date(t+ttlMs).toISOString()}}return{acquired:false,expiresAt:new Date(l.exp).toISOString()}},
 onSnapshot(n){let last=null;const f=()=>{if(offline)return;const v=docs.get(p)||null;if(v===last)return;last=v;n({exists:!!v,data:()=>JSON.parse(v),metadata:{}})};subs.add(f);setTimeout(f,30);return()=>subs.delete(f)},
 collection:(c)=>q(p+'/'+c,[])})};
const av='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="#888"/></svg>');
const user={id:async()=>'u_me000000000000000000000',can:async()=>true,canEdit:async()=>true,profiles:async ids=>Object.fromEntries([].concat(ids).map(i=>[i,{id:i,name:'山田 花子',avatarUrl:av,isMe:true}])),search:async()=>[],me:async()=>({id:'u_me000000000000000000000',name:'山田 花子'})};
window.__saved=[];
window.claude={use:async n=>n==='db'?db:n==='user'?user:n==='downloads'?{save:async(o)=>{window.__saved.push(o.filename);return{status:'saved'}}}:null};})();
