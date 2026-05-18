// ============================================================
// ui.js - Interface utilisateur : navigation, formulaires, modals
// ============================================================

// ── Initialisation ──
window.onload = () => {
  const now = new Date();
  document.getElementById('gen-mois').value  = now.toISOString().slice(0,7);
  document.getElementById('fiche-mois').value = now.toISOString().slice(0,7);
  document.getElementById('ferie-yr').value  = now.getFullYear();
  currentMonth = now.toISOString().slice(0,7);
  load();
  renderAll();
  renderRules();
  renderFeries();
  updateMonthLabels();
};

function renderAll(){
  renderEducGrid();
  renderPlageList();
  renderAbsList();
  renderAbsEduc();
  renderFicheEduc();
  document.getElementById('nb-educ').textContent  = educs.length;
  document.getElementById('nb-plages').textContent = plages.length;
}

// ── Navigation principale ──
function nav(el, page){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('page-'+page).classList.add('active');
  if(page==='horaire')  renderHoraire();
  if(page==='fiche')    renderFiche();
  if(page==='soldes')   renderSoldes();
  if(page==='stats')    renderStats();
  if(page==='feries')   renderFeries();
  if(page==='absences') renderAbsList();
}

// ── Onglets internes ──
function itab(el, id){
  el.parentElement.querySelectorAll('.itab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  ['rl-legal','rl-intern','rl-custom'].forEach(i=>{
    const d=document.getElementById(i); if(d) d.style.display='none';
  });
  document.getElementById(id).style.display = '';
}

// ── Pills (cases à cocher stylisées) ──
function togglePill(el){
  const cb = el.querySelector('input[type=checkbox]');
  if(!cb) return;
  cb.checked = !cb.checked;
  el.classList.toggle('on', cb.checked);
}
function pickColor(el){
  el.closest('.swatches').querySelectorAll('.swatch').forEach(s=>s.classList.remove('on'));
  el.classList.add('on');
  const hid = el.closest('.card, .modal').querySelector('input[type=hidden]');
  if(hid) hid.value = el.dataset.c;
}
function updateHField(){
  const v = document.getElementById('me-contrat').value;
  document.getElementById('me-h-field').style.display = v==='perso' ? '' : 'none';
}

// ── Modals ──
function openModal(id, initFn){ if(initFn) initFn(); document.getElementById(id).style.display='flex'; }
function closeModal(id){ document.getElementById(id).style.display='none'; }
function bgClose(e, id){ if(e.target===e.currentTarget) closeModal(id); }
function showAlert(id, t, m){
  const ic = {ok:'✅',warn:'⚠️',err:'❌',info:'ℹ️'};
  document.getElementById(id).innerHTML = `<div class="alert a-${t}">${ic[t]} ${m}</div>`;
}

// ================================================================
// ÉDUCATEURS
// ================================================================
function renderDemandesForm(demandes){
  demandes = demandes || [];
  [1,2].forEach(i=>{
    const dem = demandes[i-1] || {};
    const jourSel   = document.getElementById(`me-dem-jour-${i}`);
    const typeSel   = document.getElementById(`me-dem-type-${i}`);
    const plagesGrp = document.getElementById(`me-dem-plages-${i}`);
    // Si les éléments n'existent pas encore dans le DOM, on ignore
    if(!jourSel || !typeSel || !plagesGrp) return;
    jourSel.value = (dem.jour !== undefined && dem.jour !== null) ? dem.jour : -1;
    typeSel.value = dem.type || 'eviter';
    // Plages sous forme de checkboxes
    plagesGrp.innerHTML = plages.map(p=>{
      const checked = (dem.plageIds||[]).includes(p.id);
      return `<label class="chk-pill ${checked?'on':''}" onclick="togglePill(this)">
        <input type="checkbox" class="dem-plage-${i}" value="${p.id}" ${checked?'checked':''}>${p.nom}
      </label>`;
    }).join('');
  });
}

function resetEducForm(){
  var g=function(id){return document.getElementById(id);};
  if(g('me-id'))      g('me-id').value='';
  if(g('me-title'))   g('me-title').textContent='Nouvel éducateur';
  ['me-prenom','me-nom','me-notes'].forEach(function(id){var el=g(id);if(el)el.value='';});
  if(g('me-contrat')) g('me-contrat').value='temps-plein';
  if(g('me-heures'))  g('me-heures').value='';
  if(g('me-h-field')) g('me-h-field').style.display='none';
  const pEl=document.getElementById('me-pause'); if(pEl) pEl.checked=false;
  document.querySelectorAll('#me-jours-grp .chk-pill').forEach((p,i)=>{
    const cb = p.querySelector('input');
    cb.checked = [0,1,2,3,4].includes(i);
    p.classList.toggle('on', cb.checked);
  });
  renderPlageCheckboxes([],[]);
  // renderDemandesForm appelé après que la modal est visible
  setTimeout(()=>renderDemandesForm([]), 10);
}

function renderPlageCheckboxes(prefs, excls){
  const pEl = document.getElementById('me-prefs');
  const eEl = document.getElementById('me-excls');
  if(!plages.length){
    pEl.innerHTML = '<span style="font-size:.78rem;color:var(--ink3)">Définissez d\'abord des plages.</span>';
    eEl.innerHTML = '';
    return;
  }
  pEl.innerHTML = plages.map(p=>`
    <label class="chk-pill ${prefs.includes(p.id)?'on':''}" onclick="togglePill(this)">
      <input type="checkbox" class="ep" value="${p.id}" ${prefs.includes(p.id)?'checked':''}>${p.nom}
    </label>`).join('');
  eEl.innerHTML = plages.map(p=>`
    <label class="chk-pill ${excls.includes(p.id)?'on':''}" onclick="togglePill(this)" style="--accent:#c02a2a;--accent-l:#fdeaea">
      <input type="checkbox" class="ee" value="${p.id}" ${excls.includes(p.id)?'checked':''}>${p.nom}
    </label>`).join('');
}

function openEditEduc(id){
  const e = educs.find(x=>x.id===id); if(!e) return;
  document.getElementById('me-id').value = id;
  document.getElementById('me-title').textContent = `Modifier ${e.prenom} ${e.nom}`;
  document.getElementById('me-prenom').value = e.prenom;
  document.getElementById('me-nom').value = e.nom;
  document.getElementById('me-contrat').value = e.contrat;
  document.getElementById('me-heures').value = e.heuresPerso||'';
  document.getElementById('me-h-field').style.display = e.contrat==='perso' ? '' : 'none';
  const pauseEl = document.getElementById('me-pause');
  if(pauseEl) pauseEl.checked = e.acceptePause||false;
  document.getElementById('me-notes').value = e.notes||'';
  document.querySelectorAll('#me-jours-grp .chk-pill').forEach(p=>{
    const cb = p.querySelector('input');
    cb.checked = (e.jours||[]).includes(+cb.value);
    p.classList.toggle('on', cb.checked);
  });
  renderPlageCheckboxes(e.prefs||[], e.excls||[]);
  openModal('modal-educ', null);
  setTimeout(()=>renderDemandesForm(e.demandes||[]), 10);
}

function saveEduc(){
  const prenom = document.getElementById('me-prenom').value.trim();
  const nom    = document.getElementById('me-nom').value.trim();
  if(!prenom||!nom){ alert('Prénom et nom requis.'); return; }
  const jours      = [...document.querySelectorAll('#me-jours-grp input:checked')].map(c=>+c.value);
  const prefs      = [...document.querySelectorAll('.ep:checked')].map(c=>+c.value);
  const excls      = [...document.querySelectorAll('.ee:checked')].map(c=>+c.value);
  var g2=function(id){return document.getElementById(id);};
  const contrat     = g2('me-contrat') ? g2('me-contrat').value : 'temps-plein';
  const heuresPerso = g2('me-heures')  ? (+g2('me-heures').value || null) : null;
  const pauseEl2    = g2('me-pause');
  const acceptePause= pauseEl2 ? pauseEl2.checked : false;
  const notes       = g2('me-notes')   ? g2('me-notes').value.trim() : '';
  const editId      = g2('me-id')      ? (+g2('me-id').value || null) : null;

  // Lire les demandes structurées (max 2) - un jour + plusieurs plages
  const demandes = [];
  [1,2].forEach(function(i){
    var jourEl = document.getElementById('me-dem-jour-'+i);
    var typeEl = document.getElementById('me-dem-type-'+i);
    if(!jourEl || !typeEl) return;
    var jour = +jourEl.value;
    var type = typeEl.value;
    var plageIds = [...document.querySelectorAll('.dem-plage-'+i+':checked')].map(function(c){return +c.value;});
    if(!isNaN(jour) && jour !== -1 && plageIds.length > 0){
      demandes.push({jour:jour, type:type, plageIds:plageIds});
    }
  });

  if(editId){
    const idx = educs.findIndex(e=>e.id===editId);
    if(idx>=0) educs[idx] = {...educs[idx], prenom, nom, contrat, heuresPerso, acceptePause, jours, prefs, excls, notes, demandes};
  } else {
    educs.push({id:Date.now(), prenom, nom, contrat, heuresPerso, acceptePause, jours, prefs, excls, notes, demandes, color:COLORS[educs.length%COLORS.length]});
  }
  save(); renderAll(); closeModal('modal-educ');
}

function delEduc(id){
  if(!confirm('Supprimer cet éducateur ?')) return;
  educs = educs.filter(e=>e.id!==id);
  save(); renderAll();
}

function renderEducGrid(){
  const g = document.getElementById('educ-grid');
  document.getElementById('nb-educ').textContent = educs.length;
  if(!educs.length){
    g.innerHTML = '<div class="empty"><div class="icon">👤</div><p>Aucun éducateur.<br>Cliquez sur "+ Nouvel éducateur".</p></div>';
    return;
  }
  g.innerHTML = educs.map(e=>{
    const ini   = (e.prenom[0]+e.nom[0]).toUpperCase();
    const hS    = e.contrat==='perso' ? (e.heuresPerso||'?')+'h/sem' : CONTRAT_H[e.contrat]+'h/sem';
    const jours = (e.jours||[]).map(j=>JOURS[j]).join(' ');
    const prefs = (e.prefs||[]).map(id=>{ const p=plages.find(x=>x.id===id); return p?`<span class="badge b-blue">${p.nom}</span>`:''; }).join('');
    const excls = (e.excls||[]).map(id=>{ const p=plages.find(x=>x.id===id); return p?`<span class="badge b-red">✗ ${p.nom}</span>`:''; }).join('');
    const demandesHtml = (e.demandes||[]).map(d=>{
      const plageNames = (d.plageIds||[]).map(id=>{ const p=plages.find(x=>x.id===id); return p?p.nom:''; }).filter(Boolean).join('+');
      const jourLabel = JOURS[d.jour] !== undefined ? JOURS[d.jour] : '';
      const icon = d.type==='prefere' ? '⭐' : '⚠️';
      const color = d.type==='prefere' ? 'b-green' : 'b-orange';
      return plageNames ? `<span class="badge ${color}">${icon} ${jourLabel} : ${plageNames}</span>` : '';
    }).join('');
    return `<div class="educ-card">
      <div class="educ-top">
        <div class="avatar" style="background:${e.color||COLORS[0]}">${ini}</div>
        <div style="flex:1;min-width:0">
          <div class="educ-name">${e.prenom} ${e.nom}</div>
          <div class="educ-sub">${e.contrat} - ${hS} - ${jours}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-outline btn-sm" onclick="openEditEduc(${e.id})">✏️</button>
          <button class="btn btn-red btn-sm" onclick="delEduc(${e.id})">🗑️</button>
        </div>
      </div>
      <div class="educ-tags">${prefs}${excls}${demandesHtml}</div>
      ${e.notes?`<div style="font-size:.72rem;color:var(--ink3);margin-top:6px;font-style:italic">"${e.notes}"</div>`:''}
    </div>`;
  }).join('');
}

// ================================================================
// PLAGES HORAIRES
// ================================================================
function addPlage(){
  const nom = document.getElementById('p-nom').value.trim();
  if(!nom){ alert('Donnez un nom à la plage.'); return; }
  const debut = document.getElementById('p-debut').value;
  const fin   = document.getElementById('p-fin').value;
  if(!debut||!fin){ alert('Heures requises.'); return; }
  const jours = [...document.querySelectorAll('#p-jours-grp input:checked')].map(c=>+c.value);
  if(!jours.length){ alert('Sélectionnez au moins un jour.'); return; }
  const min    = +document.getElementById('p-min').value || 1;
  const max    = +document.getElementById('p-max').value || min;
  const tous   = document.getElementById('p-tous').checked;
  const color  = document.getElementById('p-color').value || '#2a5fc8';
  const type   = document.getElementById('p-type').value;
  const groupe = document.getElementById('p-groupe').value || 'auto';
  const [dh,dm] = debut.split(':').map(Number);
  const [fh,fm] = fin.split(':').map(Number);
  let dureeMin = (fh*60+fm) - (dh*60+dm);
  if(dureeMin<=0) dureeMin += 1440;
  plages.push({id:Date.now(), nom, type, groupe, debut, fin, dureeH:dureeMin/60, jours, min, max, tous, color});
  save(); renderAll();
  document.getElementById('p-nom').value = '';
  document.getElementById('p-groupe').value = 'auto';
  document.querySelectorAll('#p-jours-grp .chk-pill').forEach(p=>{ p.querySelector('input').checked=false; p.classList.remove('on'); });
  document.getElementById('p-tous').checked = false;
  document.getElementById('p-tous-pill').classList.remove('on');
}

function delPlage(id){
  if(!confirm('Supprimer cette plage ?')) return;
  plages = plages.filter(p=>p.id!==id);
  save(); renderAll();
}

function renderPlageList(){
  const el = document.getElementById('plage-list');
  document.getElementById('nb-plages').textContent = plages.length;
  if(!plages.length){ el.innerHTML='<div class="empty"><div class="icon">🕐</div><p>Aucune plage.</p></div>'; return; }
  el.innerHTML = plages.map(p=>{
    const jours = p.jours.map(j=>JOURS[j]).join(', ');
    const grpLabel = (p.groupe && p.groupe !== 'auto') ? GROUPE_LABELS[p.groupe] || p.groupe : null;
    const grpBadge = grpLabel
      ? `<span class="badge b-blue" style="font-size:.65rem">${p.groupe} · ${grpLabel}</span>`
      : `<span class="badge" style="font-size:.65rem;background:var(--border);color:var(--ink3)">auto</span>`;
    return `<div class="plage-row">
      <div class="plage-dot" style="background:${p.color}"></div>
      <div class="plage-info">
        <div class="plage-name">${p.nom} ${p.tous?'<span class="badge b-orange">Tous requis</span>':''} ${grpBadge}</div>
        <div class="plage-detail">${p.debut} → ${p.fin} - ${p.dureeH.toFixed(1)}h - min ${p.min} éduc - ${jours}</div>
      </div>
      <button class="btn btn-red btn-sm" onclick="delPlage(${p.id})">Suppr.</button>
    </div>`;
  }).join('');
}

// ================================================================
// RÈGLES
// ================================================================
function renderRules(){
  renderRuleList('rules-legal',  reglesL, 'legal');
  renderRuleList('rules-intern', reglesI, 'internal');
  renderRuleList('rules-custom', reglesC, 'custom');
}
function renderRuleList(elId, arr, cat){
  const el = document.getElementById(elId);
  if(!arr.length && cat==='custom'){
    el.innerHTML='<div class="empty"><div class="icon">✏️</div><p>Aucune règle personnalisée.</p></div>';
    return;
  }
  el.innerHTML = arr.map(r=>`<div class="rule-row">
    <span style="font-size:1.1rem">${r.active?'✅':'⬜'}</span>
    <div class="rule-info"><div class="rule-name">${r.nom}</div><div class="rule-desc">${r.desc}</div></div>
    <input type="number" value="${r.value}" min="0" max="200" style="width:65px" onchange="updateRule('${cat}','${r.id}',this.value)">
    <span style="font-size:.72rem;color:var(--ink3);width:40px">${r.unit}</span>
    <input type="checkbox" ${r.active?'checked':''} onchange="toggleRule('${cat}','${r.id}',this.checked)" style="width:16px;height:16px">
    ${cat==='custom'?`<button class="btn btn-red btn-sm" onclick="delRule('${r.id}')">✕</button>`:''}
  </div>`).join('');
}
function getArr(cat){ return cat==='legal'?reglesL : cat==='internal'?reglesI : reglesC; }
function updateRule(cat,id,v){ getArr(cat).find(r=>r.id===id).value=+v; save(); }
function toggleRule(cat,id,v){ getArr(cat).find(r=>r.id===id).active=v; save(); }
function delRule(id){ reglesC=reglesC.filter(r=>r.id!==id); save(); renderRules(); }
function saveRule(){
  const nom = document.getElementById('r-nom').value.trim();
  if(!nom){ alert('Nom requis'); return; }
  reglesC.push({id:'c'+Date.now(), nom, desc:document.getElementById('r-desc').value,
    type:document.getElementById('r-type').value, value:+document.getElementById('r-val').value, unit:'', active:true});
  save(); renderRules(); closeModal('modal-rule');
}

// ================================================================
// ABSENCES
// ================================================================
function renderAbsEduc(){
  const s = document.getElementById('abs-educ'); if(!s) return;
  s.innerHTML = '<option value="">-- Choisir --</option>' +
    educs.map(e=>`<option value="${e.id}">${e.prenom} ${e.nom}</option>`).join('');
}
function addAbsence(){
  const educId = +document.getElementById('abs-educ').value;
  const debut  = document.getElementById('abs-debut').value;
  const fin    = document.getElementById('abs-fin').value;
  const type   = document.getElementById('abs-type').value;
  const note   = document.getElementById('abs-note').value.trim();
  if(!educId||!debut||!fin){ alert('Complétez tous les champs.'); return; }
  if(debut>fin){ alert('La date de début doit être avant la fin.'); return; }
  absences.push({id:Date.now(), educId, debut, fin, type, note});
  save(); renderAbsList();
}
function delAbsence(id){ absences=absences.filter(a=>a.id!==id); save(); renderAbsList(); }
function renderAbsList(){
  const el = document.getElementById('abs-list'); if(!el) return;
  const icons = {conge:'🌴',maladie:'🤒',recup:'🔄',formation:'📚',autre:'📌'};
  if(!absences.length){ el.innerHTML='<div class="empty"><div class="icon">✅</div><p>Aucune absence.</p></div>'; return; }
  el.innerHTML = absences.map(a=>{
    const e = educs.find(x=>x.id===a.educId);
    return `<div class="plage-row">
      <span style="font-size:1.1rem">${icons[a.type]||'📌'}</span>
      <div class="plage-info">
        <div class="plage-name">${e?e.prenom+' '+e.nom:'Inconnu'} - ${a.type}</div>
        <div class="plage-detail">${a.debut} → ${a.fin}${a.note?' - '+a.note:''}</div>
      </div>
      <button class="btn btn-red btn-sm" onclick="delAbsence(${a.id})">Suppr.</button>
    </div>`;
  }).join('');
}

// ================================================================
// JOURS FÉRIÉS
// ================================================================
function feriesBelges(yr){
  const a=yr%19,b=Math.floor(yr/100),c=yr%100;
  const d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31);
  const day=((h+l-7*m+114)%31)+1;
  const paques=new Date(yr,month-1,day);
  const add=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
  const fmt=d=>`${yr}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return[
    {date:`${yr}-01-01`,nom:"Jour de l'an"},
    {date:fmt(add(paques,1)),nom:"Lundi de Pâques"},
    {date:`${yr}-05-01`,nom:"Fête du Travail"},
    {date:fmt(add(paques,39)),nom:"Ascension"},
    {date:fmt(add(paques,50)),nom:"Lundi de Pentecôte"},
    {date:`${yr}-07-21`,nom:"Fête Nationale"},
    {date:`${yr}-08-15`,nom:"Assomption"},
    {date:`${yr}-11-01`,nom:"Toussaint"},
    {date:`${yr}-11-11`,nom:"Armistice"},
    {date:`${yr}-12-25`,nom:"Noël"},
  ];
}

function renderFeries(){
  const yr = +document.getElementById('ferie-yr').value || new Date().getFullYear();
  const belges = feriesBelges(yr);
  const el = document.getElementById('ferie-list');
  el.innerHTML = belges.map(f=>{
    const existing = joursFeries.find(x=>x.date===f.date);
    const active   = existing ? existing.active : false;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <input type="checkbox" ${active?'checked':''} onchange="toggleFerie('${f.date}','${f.nom}',this.checked)" style="width:16px;height:16px">
      <span style="font-size:.85rem;flex:1"><strong>${f.date}</strong> - ${f.nom}</span>
      <span class="badge ${active?'b-green':'b-orange'}">${active?'Actif':'Inactif'}</span>
    </div>`;
  }).join('');
  const customs = joursFeries.filter(f=>!belges.find(b=>b.date===f.date));
  if(customs.length){
    el.innerHTML += `<div style="margin-top:12px;font-size:.72rem;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px">Personnalisés</div>`;
    el.innerHTML += customs.map(f=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:.85rem;flex:1"><strong>${f.date}</strong> - ${f.nom}</span>
      <button class="btn btn-red btn-sm" onclick="delFerie('${f.date}')">Suppr.</button>
    </div>`).join('');
  }
}
function toggleFerie(date,nom,active){
  const idx = joursFeries.findIndex(f=>f.date===date);
  if(idx>=0) joursFeries[idx].active=active;
  else joursFeries.push({date,nom,active});
  save(); renderFeries();
}
function addFerie(){
  const date = document.getElementById('ferie-date').value;
  const nom  = document.getElementById('ferie-nom').value.trim() || 'Férié';
  if(!date) return;
  if(!joursFeries.find(f=>f.date===date)) joursFeries.push({date,nom,active:true});
  save(); renderFeries();
  document.getElementById('ferie-date').value = '';
  document.getElementById('ferie-nom').value  = '';
}
function delFerie(date){ joursFeries=joursFeries.filter(f=>f.date!==date); save(); renderFeries(); }
function addAllFeries(){
  const yr = +document.getElementById('ferie-yr').value || new Date().getFullYear();
  feriesBelges(yr).forEach(f=>{
    const idx = joursFeries.findIndex(x=>x.date===f.date);
    if(idx>=0) joursFeries[idx].active=true;
    else joursFeries.push({...f,active:true});
  });
  save(); renderFeries();
}
function clearFeries(){ joursFeries.forEach(f=>f.active=false); save(); renderFeries(); }
