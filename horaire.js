// ============================================================
// horaire.js — Affichage horaire mensuel, fiche individuelle
// ============================================================

// Helper : nombre de jours ouvrables (lun-ven hors feries) d'un mois
function getJoursOuvrables(yr, mo){
  return getDays(yr, mo).filter(d => {
    const dw = d.getDay();
    return dw >= 1 && dw <= 5 && !isFerie(dayStr(d));
  }).length;
}

// Cible heures d'un mois pour un educ : 7.6h x jours ouvrables x ratio contrat
// On déduit les jours d'absence CP (ils comptent comme travaillés pour la cible)
function getCibleMois(educ, yr, mo){
  return getJoursOuvrables(yr, mo) * 7.6 * (getTargetH(educ) / 38);
}

// ── Navigation mois ──
function chgMonth(delta){
  currentMonth = moisKeyDelta(currentMonth, delta);
  updateMonthLabels();
  if(document.getElementById('page-horaire').classList.contains('active'))  renderHoraire();
  else if(document.getElementById('page-soldes').classList.contains('active')) renderSoldes();
  else if(document.getElementById('page-stats').classList.contains('active'))  renderStats();
}

function updateMonthLabels(){
  const lbl = monthLabel(currentMonth);
  ['hor-label','sol-label','stats-label'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = lbl;
  });
  const exists = horaire[currentMonth] && Object.keys(horaire[currentMonth]).length>0;
  const badge  = exists
    ? `<span class="badge b-green" style="margin-left:8px;font-size:.7rem">✅ Horaire généré</span>`
    : `<span class="badge b-orange" style="margin-left:8px;font-size:.7rem">⚠️ Pas d'horaire</span>`;
  ['hor-label','sol-label','stats-label'].forEach(id=>{
    const el = document.getElementById(id+'_badge');
    if(el) el.innerHTML = badge;
  });
}

// ── Horaire mensuel ──
function renderHoraire(){
  updateMonthLabels();

  const moisGen = Object.keys(horaire).filter(k=>Object.keys(horaire[k]).length>0).sort();
  const mgEl = document.getElementById('mois-generes');
  if(mgEl){
    mgEl.innerHTML = moisGen.length
      ? '📋 Mois : ' + moisGen.map(m=>`<span onclick="currentMonth='${m}';renderHoraire()"
          style="cursor:pointer;margin:0 3px;padding:2px 8px;border-radius:10px;
          background:${m===currentMonth?'var(--accent)':'var(--border)'};
          color:${m===currentMonth?'#fff':'var(--ink2)'};font-weight:${m===currentMonth?700:400}">${monthLabel(m)}</span>`).join('')
      : 'Aucun horaire généré.';
  }

  const [yr,mo] = currentMonth.split('-').map(Number);
  const jours   = getDays(yr, mo);
  const plan    = horaire[currentMonth] || {};

  let totalA=0, totalM=0, totalN=0;
  jours.forEach(d=>{
    const ds = dayStr(d);
    plages.forEach(p=>{
      const ids = (plan[ds]||{})[p.id] || [];
      totalA += ids.length;
      if(ids.length < p.min) totalM += p.min - ids.length;
      if(p.type==='nuit')    totalN += ids.length;
    });
  });

  document.getElementById('hor-stats').innerHTML = `
    <div class="stat"><div class="stat-val" style="color:var(--accent)">${educs.length}</div><div class="stat-lbl">Éducateurs</div></div>
    <div class="stat"><div class="stat-val" style="color:var(--blue)">${jours.length}</div><div class="stat-lbl">Jours</div></div>
    <div class="stat"><div class="stat-val" style="color:var(--green)">${totalA}</div><div class="stat-lbl">Assignations</div></div>
    <div class="stat"><div class="stat-val" style="color:var(--purple)">${totalN}</div><div class="stat-lbl">Nuits</div></div>
    <div class="stat"><div class="stat-val" style="color:${totalM?'var(--red)':'var(--green)'}">${totalM}</div><div class="stat-lbl">Postes manquants</div></div>`;

  document.getElementById('hor-alerts').innerHTML = totalM>0
    ? `<div class="alert a-warn">⚠️ ${totalM} poste(s) non couvert(s) ce mois.</div>` : '';

  let forcedCount = 0;
  Object.values(plan).forEach(daySlots=>{
    Object.entries(daySlots).forEach(([k,v])=>{
      if(k.startsWith('_s_') && (v==='forced'||v==='dem_evite')) forcedCount++;
    });
  });

  document.getElementById('hor-legend').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:.75rem;margin-bottom:12px;padding:9px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <strong>Légende :</strong>
      <span><span style="display:inline-block;width:40px;height:16px;border-radius:4px;background:#2a5fc8;vertical-align:middle"></span> Préférence respectée</span>
      <span><span style="display:inline-block;width:40px;height:16px;border-radius:4px;background:#2a5fc818;border:1px solid #2a5fc833;vertical-align:middle"></span> Neutre</span>
      <span><span style="display:inline-block;width:40px;height:16px;border-radius:4px;background:#fdf3e0;border:1.5px solid #f0c878;vertical-align:middle;color:#d4800a;font-size:.65rem;text-align:center">⚠️</span> Demande à éviter non respectée</span>
      <span><span style="display:inline-block;width:40px;height:16px;border-radius:4px;background:#fdeaea;border:1.5px solid #f0b3b3;vertical-align:middle;color:#c02a2a;font-size:.65rem;text-align:center">✗</span> Plage refusée assignée</span>
      <span title="Bloc WE gravé automatiquement par Module 2"><span style="color:#2a5fc8;font-size:1rem">🔒</span> Bloc WE auto (sam+dim équipe identique)</span>
      <span class="badge ${forcedCount>0?'b-red':'b-green'}" style="margin-left:auto">
        ${forcedCount>0?`⚠️ ${forcedCount} demande(s) non respectée(s)`:'✅ Toutes les demandes respectées'}
      </span>
    </div>`;

  if(!plages.length || !educs.length){
    document.getElementById('sch-table').innerHTML = '<div class="empty"><p>Aucune donnée. Configurez éducateurs et plages, puis générez.</p></div>';
    return;
  }

  let html = `<table class="sch-table"><thead><tr><th style="min-width:90px">Date</th>`;
  plages.forEach(p=>{
    html += `<th style="background:${p.color};color:#fff;border:1px solid rgba(255,255,255,.2)">
      <div style="font-weight:700;font-size:.78rem">${p.nom}</div>
      <div style="font-size:.65rem;opacity:.85;font-weight:400">${p.debut}→${p.fin}</div>
    </th>`;
  });
  html += '</tr></thead><tbody>';

  jours.forEach(d=>{
    const ds     = dayStr(d);
    const dow    = d.getDay();
    const we     = dow===0 || dow===6;
    const dowIdx = dow===0 ? 6 : dow-1;
    const ferie  = isFerie(ds);

    html += `<tr><td class="day-cell ${we||ferie?'we':''}">
      <div class="day-name">${JOURS[dowIdx]}${ferie?' 🎉':''}</div>
      <div class="day-num">${d.getDate()}</div>
    </td>`;

    plages.forEach(p=>{
      const dowCheck = (ferie&&!we) ? 5 : dowIdx;
      if(!p.jours.includes(dowCheck)){
        html += `<td class="${we||ferie?'we-bg':''}"><div class="empty-slot">—</div></td>`;
        return;
      }
      const ids     = ((plan[ds]||{})[p.id]||[]).map(x=>+x);
      const absHere = educs.filter(e=>isAbsent(e.id,ds)&&(e.jours||[]).includes(dowIdx)&&!((e.excls||[]).includes(p.id)));

      let chips = ids.map(id=>{
        const e  = educs.find(x=>x.id===id); if(!e) return '';
        const statusKey = `_s_${id}_${p.id}`;
        const st = (plan[ds]||{})[statusKey] || 'neutral';
        let style, icon='', title='';
        if(st==='forced'){
          style = `background:#fdeaea;color:#c02a2a;border:1.5px solid #f0b3b3`;
          icon  = '✗ ';
          title = `title="Plage refusée assignée à ${e.prenom}"`;
        } else if(st==='dem_evite'){
          style = `background:#fdf3e0;color:#d4800a;border:1.5px solid #f0c878`;
          icon  = '⚠️ ';
          title = `title="${e.prenom} préférait éviter cette plage ce jour"`;
        } else if(st==='dem_pref'||st==='pref'){
          style = `background:${e.color};color:#fff;border:1px solid ${e.color}`;
          title = `title="Préférence respectée"`;
        } else {
          style = `background:${e.color}18;color:${e.color};border:1px solid ${e.color}33`;
        }
        return `<span class="name-chip" style="${style}" ${title}>${icon}${e.prenom}</span>`;
      }).join('');

      const miss = p.min - ids.length;
      for(let i=0;i<Math.max(0,miss);i++) chips += `<span class="missing-chip">⚠️ Poste libre</span>`;
      absHere.forEach(e=>{ chips += `<span class="abs-chip">🏥 ${e.prenom}</span>`; });

      // Module 2 — cadenas bleu si bloc WE gravé automatiquement
      const isWEAuto = (typeof isAutoLockWE === 'function') && isAutoLockWE(currentMonth, ds, p.id);
      const lockBadge = isWEAuto
        ? `<span class="we-auto-lock" title="Bloc WE gravé automatiquement par Module 2 — cliquez pour déverrouiller"
                 onclick="event.stopPropagation();unlockAutoWE('${ds}',${p.id})"
                 style="position:absolute;top:2px;right:4px;color:#2a5fc8;font-size:.95rem;cursor:pointer;opacity:.75">🔒</span>`
        : '';

      html += `<td class="${we||ferie?'we-bg':''}" onclick="openCellEdit('${ds}',${p.id})" style="cursor:pointer;position:relative">
        ${lockBadge}${chips || '<div class="empty-slot">Vide</div>'}
      </td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('sch-table').innerHTML = html;
}

// ── Déverrouiller un bloc WE auto ──
function unlockAutoWE(ds, plageId){
  if(!confirm('Déverrouiller ce bloc WE ? Il pourra être réassigné à la prochaine génération.')) return;
  const mo = ds.slice(0,7);
  if(horaire[mo] && horaire[mo][ds]){
    horaire[mo][ds]['_lock_'+plageId] = null;
  }
  if(typeof weAutoLocks !== 'undefined' && weAutoLocks[mo] && weAutoLocks[mo][ds]){
    weAutoLocks[mo][ds] = weAutoLocks[mo][ds].filter(p => p !== +plageId);
    if(typeof saveWeAutoLocks === 'function') saveWeAutoLocks();
  }
  save();
  renderHoraire();
}

// ── Modification manuelle d'une cellule ──
function openCellEdit(ds, plageId){
  const p = plages.find(x=>x.id===plageId); if(!p) return;
  cellCtx = {ds, plageId};
  document.getElementById('cell-title').textContent = `${p.nom} — ${new Date(ds+'T12:00').toLocaleDateString('fr-BE',{weekday:'long',day:'numeric',month:'long'})}`;
  document.getElementById('cell-sub').textContent   = `Minimum requis : ${p.min} éducateur(s)`;
  const plan     = (horaire[currentMonth]||{})[ds] || {};
  const assigned = (plan[plageId]||[]).map(x=>+x);
  const dow      = new Date(ds+'T12:00').getDay()===0 ? 6 : new Date(ds+'T12:00').getDay()-1;
  const avail    = educs.filter(e=>e.jours.includes(dow) && !isAbsent(e.id,ds));
  document.getElementById('cell-content').innerHTML = avail.map(e=>`
    <label class="chk-pill ${assigned.includes(e.id)?'on':''}" onclick="togglePill(this)" style="margin:3px;display:inline-flex">
      <input type="checkbox" class="cell-cb" value="${e.id}" ${assigned.includes(e.id)?'checked':''}>
      <span style="display:flex;align-items:center;gap:6px">
        <div style="width:8px;height:8px;border-radius:50%;background:${e.color}"></div>
        ${e.prenom} ${e.nom}
      </span>
    </label>`).join('');
  openModal('modal-cell', null);
}

function saveCellEdit(){
  const {ds, plageId} = cellCtx;
  const mo = ds.slice(0,7);
  if(!horaire[mo])     horaire[mo]    = {};
  if(!horaire[mo][ds]) horaire[mo][ds] = {};
  horaire[mo][ds][plageId] = [...document.querySelectorAll('.cell-cb:checked')].map(c=>+c.value);
  save(); closeModal('modal-cell'); renderHoraire();
}

// ================================================================
// FICHE INDIVIDUELLE
// ================================================================
function renderFicheEduc(){
  const sel = document.getElementById('fiche-educ'); if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- Choisir --</option>' +
    educs.map(e=>`<option value="${e.id}" ${+cur===e.id?'selected':''}>${e.prenom} ${e.nom}</option>`).join('');
}

function renderFiche(){
  const educId  = +document.getElementById('fiche-educ').value;
  const moisStr = document.getElementById('fiche-mois').value;
  const el      = document.getElementById('fiche-content');
  if(!educId||!moisStr){
    el.innerHTML='<div class="empty"><div class="icon">📋</div><p>Sélectionnez un éducateur et un mois.</p></div>';
    return;
  }
  const educ = educs.find(e=>e.id===educId); if(!educ) return;
  const [yr,mo] = moisStr.split('-').map(Number);
  const jours   = getDays(yr, mo);
  const plan    = horaire[moisStr] || {};

  const targetHMois = getCibleMois(educ, yr, mo);

  let totalTrav=0, totalCP=0;
  const rows = jours.map(d=>{
    const ds     = dayStr(d);
    const dow    = d.getDay()===0 ? 6 : d.getDay()-1;
    const we     = d.getDay()===0 || d.getDay()===6;
    const abs    = absences.find(a=>a.educId===educId && ds>=a.debut && ds<=a.fin);
    const myPlages = plages.filter(p=>{
      const ids = ((plan[ds]||{})[p.id]||[]).map(x=>+x);
      return ids.includes(educId);
    });
    const h = myPlages.reduce((s,p)=>s+p.dureeH, 0);
    if(abs && abs.type==='conge') totalCP += 7.6 * (getTargetH(educ) / 38);
    else totalTrav += h;

    const plageChips = abs
      ? `<span class="plage-tag" style="background:var(--orange-l);color:var(--orange)">${abs.type==='conge'?'🌴 CP':abs.type==='maladie'?'🤒 Mal.':'🔄 Récup.'}</span>`
      : myPlages.map(p=>`<span class="plage-tag" style="background:${p.color}22;color:${p.color};border:1px solid ${p.color}44">${p.nom} <small>${p.debut}–${p.fin}</small></span>`).join('');
    const hCell = h>0 ? `<span style="font-weight:700;color:var(--green)">${h.toFixed(1)}h</span>` : (abs?'':'—');
    return `<tr>
      <td class="day-col ${we?'we':''}">
        <div style="font-size:.68rem;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px">${JOURS[dow]}</div>
        <div style="font-weight:800;font-family:'Syne',sans-serif">${d.getDate()}</div>
      </td>
      <td style="text-align:left;padding:5px 8px">${plageChips||''}</td>
      <td>${hCell}</td>
      <td>${abs?.type==='conge'?'<span class="badge b-orange">CP</span>':''}</td>
      <td>${abs?.type==='recup'?'<span class="badge b-blue">Récup</span>':''}</td>
    </tr>`;
  }).join('');

  const solde = totalTrav + totalCP - targetHMois;
  const joursOuv = getJoursOuvrables(yr, mo);
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div class="avatar" style="background:${educ.color||COLORS[0]};width:44px;height:44px;font-size:1rem">${(educ.prenom[0]+educ.nom[0]).toUpperCase()}</div>
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800">${educ.prenom} ${educ.nom}</div>
          <div style="font-size:.78rem;color:var(--ink3)">${educ.contrat} · ${getTargetH(educ)}h/sem · ${monthLabel(moisStr)} · ${joursOuv} jours ouvrables</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:20px;flex-wrap:wrap;text-align:center">
          <div><div style="font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:var(--green)">${totalTrav.toFixed(1)}h</div><div style="font-size:.7rem;color:var(--ink3)">Travaillées</div></div>
          <div><div style="font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:var(--orange)">${totalCP.toFixed(1)}h</div><div style="font-size:.7rem;color:var(--ink3)">CP</div></div>
          <div><div style="font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:var(--blue)">${targetHMois.toFixed(1)}h</div><div style="font-size:.7rem;color:var(--ink3)">Cible mois</div></div>
          <div><div style="font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:${Math.abs(solde)<=15?'var(--green)':solde>0?'var(--orange)':'var(--red)'}">${solde>=0?'+':''}${solde.toFixed(1)}h</div><div style="font-size:.7rem;color:var(--ink3)">Solde</div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sch-wrap"><table class="sheet-table">
        <thead><tr><th>Jour</th><th>Prestations</th><th>H. trav.</th><th>CP</th><th>Récup</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="sheet-total">
          <td colspan="2" style="text-align:left;padding:8px">TOTAL ${monthLabel(moisStr)}</td>
          <td>${totalTrav.toFixed(1)}h</td><td>${totalCP.toFixed(1)}h</td><td>—</td>
        </tr></tfoot>
      </table></div>
    </div>`;
}
