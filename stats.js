// ============================================================
// stats.js - Soldes heures et statistiques prestations v2
// ============================================================

// ── Helpers locaux ──
function _isNuit(p){ return p.type==='nuit'||p.debut>='22:00'||(p.fin<='07:00'&&p.fin>'00:00'); }
function _isReunion(p){ return p.type==='reunion'||(p.nom||'').toLowerCase().includes('reunion')||(p.nom||'').toLowerCase().includes('réunion'); }
function _dureeH(p){
  if(p.dureeH&&p.dureeH>0) return p.dureeH;
  const [dh,dm]=p.debut.split(':').map(Number);
  const [fh,fm]=p.fin.split(':').map(Number);
  let h=(fh*60+fm)-(dh*60+dm); if(h<=0)h+=1440; return h/60;
}
function _ratio(e){ return getTargetH(e)/38; }
function _norm(val,e){ return val/Math.max(0.01,_ratio(e)); }
function _moyPond(arr,fn){ return arr.reduce((s,x)=>s+fn(x)/Math.max(0.01,_ratio(x)),0)/Math.max(1,arr.length); }

// Cellule équité : couleur selon écart normalisé
function _cellEq(val, avg, seuil, ratio){
  const n = _norm(val, {contrat:'temps-plein', heuresPerso:null}); // absolu ici
  const diff = val - avg;
  const bg = Math.abs(diff) < seuil ? '' : diff > 0 ? 'rgba(212,128,10,.12)' : 'rgba(192,42,42,.08)';
  return {diff, bg};
}

// ================================================================
// SOLDES HEURES
// ================================================================
function renderSoldes(){
  updateMonthLabels();
  const horizon = +document.getElementById('sol-horizon').value || 3;
  const el = document.getElementById('sol-content');
  if(!educs.length){
    el.innerHTML='<div class="empty"><div class="icon">⏱️</div><p>Aucun éducateur.</p></div>';
    return;
  }
  const [yr,mo] = currentMonth.split('-').map(Number);
  const moisDispo=[];
  for(let i=0;i<horizon;i++){
    const key=moisKey(yr,mo-i);
    if(horaire[key]&&Object.keys(horaire[key]).length>0){
      const [ky,km]=key.split('-').map(Number);
      moisDispo.push({key,yr:ky,mo:km});
    }
  }
  if(!moisDispo.length){
    el.innerHTML='<div class="empty"><div class="icon">⏱️</div><p>Aucun horaire généré.<br>Allez dans "Générer".</p></div>';
    return;
  }

  const cards=educs.map(e=>{
    let totalTrav=0, targetTotal=0;
    moisDispo.forEach(({key,yr:ky,mo:km})=>{
      const plan=horaire[key];
      const ratio=getTargetH(e)/38;
      const joursOuv=getDays(ky,km).filter(day=>{
        const dw=day.getDay(); return dw>=1&&dw<=5&&!isFerie(dayStr(day));
      });
      targetTotal+=joursOuv.length*7.6*ratio;
      getDays(ky,km).forEach(day=>{
        const ds=dayStr(day); if(isAbsent(e.id,ds)) return;
        plages.forEach(p=>{
          const ids=((plan[ds]||{})[p.id]||[]);
          if(ids.map(x=>+x).includes(e.id)) totalTrav+=_dureeH(p);
        });
      });
    });
    const solde=totalTrav-targetTotal;
    const ok=Math.abs(solde)<=getRule('tol_heures',15);
    const ratio=Math.min(1.2,totalTrav/Math.max(1,targetTotal));
    const ini=(e.prenom[0]+e.nom[0]).toUpperCase();
    return `<div class="balance-card">
      <div class="balance-top">
        <div class="avatar" style="background:${e.color||COLORS[0]};width:36px;height:36px;font-size:.8rem">${ini}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.88rem">${e.prenom} ${e.nom}</div>
          <div style="font-size:.72rem;color:var(--ink3)">${e.contrat} · cible ${targetTotal.toFixed(0)}h / ${moisDispo.length} mois</div>
        </div>
        <span class="badge ${ok?'b-green':solde>0?'b-orange':'b-red'}">${solde>=0?'+':''}${solde.toFixed(1)}h</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--ink3);margin-bottom:4px">
        <span>Travaillées: <strong>${totalTrav.toFixed(1)}h</strong></span>
        <span>Cible: <strong>${targetTotal.toFixed(0)}h</strong></span>
      </div>
      <div class="balance-bar"><div class="balance-fill" style="width:${Math.min(100,ratio*100).toFixed(0)}%;background:${ok?'var(--green)':solde>0?'var(--orange)':'var(--red)'}"></div></div>
    </div>`;
  }).join('');
  el.innerHTML=`<div class="balance-grid">${cards}</div>`;
}

// ================================================================
// STATS PRESTATIONS — Vue mensuelle/trimestrielle
// ================================================================
function renderStats(){
  updateMonthLabels();
  const horizon=+document.getElementById('stats-horizon').value||3;
  const el=document.getElementById('stats-content');
  if(!educs.length||!plages.length){
    el.innerHTML='<div class="empty"><div class="icon">📊</div><p>Configurez éducateurs et plages d\'abord.</p></div>';
    return;
  }
  const [yr,mo]=currentMonth.split('-').map(Number);

  // ── Initialiser compteurs ──
  const stats={};
  educs.forEach(e=>{
    stats[e.id]={
      totalH:0, nuits:0, we:0, ferie:0,
      // WE détaillés
      samJour:0, samNuit:0, dimJour:0, dimNuit:0,
      weCoupes:0, weBlocs:0, weNuitsWE:0,
      plages:{}
    };
    plages.forEach(p=>{stats[e.id].plages[p.id]=0;});
  });

  let moisTrouves=0;
  for(let i=0;i<horizon;i++){
    const key=moisKey(yr,mo-i);
    const plan=horaire[key];
    if(!plan||!Object.keys(plan).length) continue;
    moisTrouves++;
    const [ky,km]=key.split('-').map(Number);
    const joursMois=getDays(ky,km);

    // ── Analyser les blocs WE de ce mois ──
    // Grouper jours WE par numéro de WE
    const weMap={};
    let weNum=0, lastSatDate=-1;
    joursMois.forEach(d=>{
      if(d.getDay()===6){weNum++;lastSatDate=d.getDate();}
      if(d.getDay()===0&&lastSatDate<0)weNum++;
      if(d.getDay()===0||d.getDay()===6) weMap[dayStr(d)]=weNum;
    });
    const weNums=[...new Set(Object.values(weMap))];

    // Pour chaque WE, analyser le bloc de chaque educ
    weNums.forEach(wn=>{
      const joursWE=joursMois.filter(d=>weMap[dayStr(d)]===wn);
      educs.forEach(e=>{
        let travSam=false, travDim=false, nuitSam=false, nuitDim=false;
        joursWE.forEach(d=>{
          const ds=dayStr(d), dow=d.getDay();
          plages.forEach(p=>{
            const ids=((plan[ds]||{})[p.id]||[]).map(x=>+x);
            if(!ids.includes(e.id)) return;
            if(dow===6){travSam=true; if(_isNuit(p))nuitSam=true;}
            if(dow===0){travDim=true; if(_isNuit(p))nuitDim=true;}
          });
        });
        if(travSam&&travDim){
          stats[e.id].weBlocs++;
        } else if(travSam||travDim){
          stats[e.id].weCoupes++;
        }
        if(nuitSam) stats[e.id].samNuit++;
        if(nuitDim) stats[e.id].dimNuit++;
        if(nuitSam||nuitDim) stats[e.id].weNuitsWE++;
      });
    });

    // ── Comptage jour par jour ──
    joursMois.forEach(day=>{
      const ds=dayStr(day);
      const dow=day.getDay(); // 0=dim, 6=sam
      const we=dow===0||dow===6;
      const ferie=isFerie(ds);
      Object.entries(plan[ds]||{}).forEach(([pid,ids])=>{
        if(pid.startsWith('_')||!Array.isArray(ids)) return;
        const p=plages.find(x=>x.id===+pid); if(!p) return;
        const nuit=_isNuit(p);
        ids.forEach(eid=>{
          const id=+eid; if(stats[id]===undefined) return;
          stats[id].totalH+=_dureeH(p);
          stats[id].plages[p.id]=(stats[id].plages[p.id]||0)+1;
          if(we)    stats[id].we++;
          if(ferie) stats[id].ferie++;
          if(nuit)  stats[id].nuits++;
          // Sam/dim jour/nuit
          if(dow===6&&!nuit) stats[id].samJour++;
          if(dow===0&&!nuit) stats[id].dimJour++;
        });
      });
    });
  }

  if(!moisTrouves){
    el.innerHTML='<div class="empty"><div class="icon">📊</div><p>Aucun horaire généré.</p></div>';
    return;
  }

  // ── Moyennes globales ──
  const avgH    =educs.reduce((s,e)=>s+stats[e.id].totalH,0)/Math.max(1,educs.length);
  const avgNuits=educs.reduce((s,e)=>s+stats[e.id].nuits,0)/Math.max(1,educs.length);
  const avgWe   =educs.reduce((s,e)=>s+stats[e.id].we,0)/Math.max(1,educs.length);
  const avgFerie=educs.reduce((s,e)=>s+stats[e.id].ferie,0)/Math.max(1,educs.length);
  const avgSamJ =educs.reduce((s,e)=>s+stats[e.id].samJour,0)/Math.max(1,educs.length);
  const avgSamN =educs.reduce((s,e)=>s+stats[e.id].samNuit,0)/Math.max(1,educs.length);
  const avgDimJ =educs.reduce((s,e)=>s+stats[e.id].dimJour,0)/Math.max(1,educs.length);
  const avgDimN =educs.reduce((s,e)=>s+stats[e.id].dimNuit,0)/Math.max(1,educs.length);
  const avgBlocs=educs.reduce((s,e)=>s+stats[e.id].weBlocs,0)/Math.max(1,educs.length);
  const avgCoup =educs.reduce((s,e)=>s+stats[e.id].weCoupes,0)/Math.max(1,educs.length);

  function cell(val, avg, seuil=0.5){
    const diff=val-avg;
    const bg=Math.abs(diff)<seuil?'':diff>0?'rgba(212,128,10,.12)':'rgba(192,42,42,.08)';
    const col=Math.abs(diff)<seuil?'var(--ink)':diff>0?'var(--orange)':'var(--red)';
    return `<td style="padding:6px 8px;text-align:center;font-weight:600;background:${bg};color:${col}">
      ${val}<div style="font-size:.62rem;color:var(--ink3);font-weight:400">${diff>=0?'+':''}${diff.toFixed(1)}</div>
    </td>`;
  }

  const thStyle=`style="background:var(--ink);color:#fff;padding:8px 6px;text-align:center;font-size:.7rem;font-weight:600;border:1px solid rgba(255,255,255,.1);white-space:nowrap"`;
  const thStyleWE=`style="background:#2e2b28;color:#fff;padding:8px 6px;text-align:center;font-size:.7rem;font-weight:600;border:1px solid rgba(255,255,255,.1);white-space:nowrap"`;

  let html=`<div class="card" style="margin-bottom:14px">
  <div class="card-hd"><div class="card-title">📊 Stats prestations — ${moisTrouves} mois</div></div>
  <div class="sch-wrap"><table style="border-collapse:collapse;width:100%;font-size:.76rem">
    <thead>
      <tr>
        <th ${thStyle} rowspan="2" style="text-align:left;min-width:130px">Éducateur</th>
        <th ${thStyle} rowspan="2">Total H</th>
        <th ${thStyle} rowspan="2">🌙 Nuits</th>
        <th ${thStyleWE} colspan="6">📅 Week-ends</th>
        <th ${thStyle} rowspan="2">🎉 Fériés</th>
        ${plages.map(p=>`<th style="background:${p.color};color:#fff;padding:8px 4px;text-align:center;font-size:.65rem;max-width:70px;border:1px solid rgba(255,255,255,.1)" rowspan="2">${p.nom}</th>`).join('')}
      </tr>
      <tr>
        <th ${thStyleWE}>Sam Jour</th>
        <th ${thStyleWE}>Sam 🌙</th>
        <th ${thStyleWE}>Dim Jour</th>
        <th ${thStyleWE}>Dim 🌙</th>
        <th ${thStyleWE}>Blocs</th>
        <th ${thStyleWE}>Coupés</th>
      </tr>
    </thead>
    <tbody>`;

  educs.forEach((e,i)=>{
    const s=stats[e.id];
    const diffH=s.totalH-avgH;
    const hCol=Math.abs(diffH)<5?'var(--green)':diffH>0?'var(--orange)':'var(--red)';
    html+=`<tr style="background:${i%2===0?'var(--surface)':'var(--surface2)'}">
      <td style="padding:7px 10px">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="avatar" style="background:${e.color};width:26px;height:26px;font-size:.65rem">${(e.prenom[0]+e.nom[0]).toUpperCase()}</div>
          <span style="font-weight:600;font-size:.82rem">${e.prenom} ${e.nom}</span>
        </div>
        <div style="font-size:.68rem;color:var(--ink3);margin-left:33px">${e.contrat}</div>
      </td>
      <td style="padding:6px 8px;text-align:center;font-weight:700;color:${hCol}">
        ${s.totalH.toFixed(1)}h
        <div style="font-size:.62rem;color:var(--ink3);font-weight:400">${diffH>=0?'+':''}${diffH.toFixed(1)}</div>
      </td>
      ${cell(s.nuits,avgNuits,0.5)}
      ${cell(s.samJour,avgSamJ,0.5)}
      ${cell(s.samNuit,avgSamN,0.3)}
      ${cell(s.dimJour,avgDimJ,0.5)}
      ${cell(s.dimNuit,avgDimN,0.3)}
      ${cell(s.weBlocs,avgBlocs,0.5)}
      ${cell(s.weCoupes,avgCoup,0.5)}
      ${cell(s.ferie,avgFerie,0.5)}
      ${plages.map(p=>{
        const cnt=s.plages[p.id]||0;
        const avgCnt=educs.reduce((sum,ex)=>sum+(stats[ex.id]?.plages[p.id]||0),0)/Math.max(1,educs.length);
        return cell(cnt,avgCnt,0.5);
      }).join('')}
    </tr>`;
  });

  // Ligne moyennes
  html+=`<tr style="background:var(--ink);color:#fff;font-weight:700">
    <td style="padding:7px 10px;font-size:.8rem">Moyenne équipe</td>
    <td style="padding:6px 8px;text-align:center">${avgH.toFixed(1)}h</td>
    <td style="padding:6px 8px;text-align:center">${avgNuits.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgSamJ.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgSamN.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgDimJ.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgDimN.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgBlocs.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgCoup.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgFerie.toFixed(1)}</td>
    ${plages.map(p=>{
      const avg=educs.reduce((s,e)=>s+(stats[e.id].plages[p.id]||0),0)/Math.max(1,educs.length);
      return `<td style="padding:6px 8px;text-align:center">${avg.toFixed(1)}</td>`;
    }).join('')}
  </tr>`;

  html+=`</tbody></table></div></div>`;

  // ── Vue annuelle WE ──
  html+=renderStatsAnnuelWE(yr);

  el.innerHTML=html;
}

// ================================================================
// VUE ANNUELLE EQUITE WE (tous les mois de l'année)
// ================================================================
function renderStatsAnnuelWE(yr){
  const anneeStr=String(yr);
  const moisAnnee=Object.keys(horaire).filter(k=>k.startsWith(anneeStr)).sort();
  if(!moisAnnee.length) return '';

  // Compteurs annuels par educ
  const ann={};
  educs.forEach(e=>{ann[e.id]={samJour:0,samNuit:0,dimJour:0,dimNuit:0,weBlocs:0,weCoupes:0,nuits:0,ferie:0,we:0};});

  moisAnnee.forEach(mk=>{
    const plan=horaire[mk]; if(!plan) return;
    const [ky,km]=mk.split('-').map(Number);
    const joursMois=getDays(ky,km);

    // Blocs WE
    const weMap={};
    let weNum=0,lastSatDate=-1;
    joursMois.forEach(d=>{
      if(d.getDay()===6){weNum++;lastSatDate=d.getDate();}
      if(d.getDay()===0&&lastSatDate<0)weNum++;
      if(d.getDay()===0||d.getDay()===6) weMap[dayStr(d)]=weNum;
    });
    const weNums=[...new Set(Object.values(weMap))];
    weNums.forEach(wn=>{
      const joursWE=joursMois.filter(d=>weMap[dayStr(d)]===wn);
      educs.forEach(e=>{
        let tS=false,tD=false,nS=false,nD=false;
        joursWE.forEach(d=>{
          const ds=dayStr(d),dow=d.getDay();
          plages.forEach(p=>{
            const ids=((plan[ds]||{})[p.id]||[]).map(x=>+x);
            if(!ids.includes(e.id)) return;
            if(dow===6){tS=true;if(_isNuit(p))nS=true;}
            if(dow===0){tD=true;if(_isNuit(p))nD=true;}
          });
        });
        if(tS&&tD) ann[e.id].weBlocs++;
        else if(tS||tD) ann[e.id].weCoupes++;
        if(nS) ann[e.id].samNuit++;
        if(nD) ann[e.id].dimNuit++;
      });
    });

    joursMois.forEach(day=>{
      const ds=dayStr(day),dow=day.getDay();
      const we=dow===0||dow===6, ferie=isFerie(ds);
      Object.entries(plan[ds]||{}).forEach(([pid,ids])=>{
        if(pid.startsWith('_')||!Array.isArray(ids)) return;
        const p=plages.find(x=>x.id===+pid); if(!p) return;
        const nuit=_isNuit(p);
        ids.forEach(eid=>{
          const id=+eid; if(!ann[id]) return;
          if(nuit)  ann[id].nuits++;
          if(we)    ann[id].we++;
          if(ferie) ann[id].ferie++;
          if(dow===6&&!nuit) ann[id].samJour++;
          if(dow===0&&!nuit) ann[id].dimJour++;
        });
      });
    });
  });

  const avgSamJ =educs.reduce((s,e)=>s+ann[e.id].samJour,0)/Math.max(1,educs.length);
  const avgSamN =educs.reduce((s,e)=>s+ann[e.id].samNuit,0)/Math.max(1,educs.length);
  const avgDimJ =educs.reduce((s,e)=>s+ann[e.id].dimJour,0)/Math.max(1,educs.length);
  const avgDimN =educs.reduce((s,e)=>s+ann[e.id].dimNuit,0)/Math.max(1,educs.length);
  const avgBlocs=educs.reduce((s,e)=>s+ann[e.id].weBlocs,0)/Math.max(1,educs.length);
  const avgCoup =educs.reduce((s,e)=>s+ann[e.id].weCoupes,0)/Math.max(1,educs.length);
  const avgNuits=educs.reduce((s,e)=>s+ann[e.id].nuits,0)/Math.max(1,educs.length);
  const avgFerie=educs.reduce((s,e)=>s+ann[e.id].ferie,0)/Math.max(1,educs.length);

  function aCell(val,avg,seuil=1){
    const diff=val-avg;
    const bg=Math.abs(diff)<seuil?'':diff>0?'rgba(212,128,10,.15)':'rgba(192,42,42,.1)';
    const col=Math.abs(diff)<seuil?'var(--ink)':diff>0?'var(--orange)':'var(--red)';
    const icon=Math.abs(diff)<seuil?'':'⬤';
    return `<td style="padding:6px 8px;text-align:center;font-weight:700;background:${bg};color:${col}">
      ${val}<div style="font-size:.6rem;font-weight:400;color:${col}">${diff>=0?'+':''}${diff.toFixed(1)}</div>
    </td>`;
  }

  const thS=`style="background:#1c2235;color:#8fa0c0;padding:8px 6px;text-align:center;font-size:.68rem;font-weight:700;border:1px solid rgba(255,255,255,.08);white-space:nowrap"`;
  const thWE=`style="background:#2e2b28;color:#c8c4ba;padding:8px 6px;text-align:center;font-size:.68rem;font-weight:700;border:1px solid rgba(255,255,255,.08);white-space:nowrap"`;

  let html=`<div class="card">
  <div class="card-hd"><div class="card-title">📅 Équité annuelle WE — ${anneeStr} (${moisAnnee.length} mois générés)</div></div>
  <div class="alert a-info" style="margin-bottom:12px;font-size:.78rem">
    Les cellules en <span style="color:var(--orange);font-weight:700">orange</span> indiquent un surplus, en <span style="color:var(--red);font-weight:700">rouge</span> un déficit par rapport à la moyenne de l'équipe.
    Les mi-temps devraient avoir environ la moitié des valeurs des temps pleins.
  </div>
  <div class="sch-wrap"><table style="border-collapse:collapse;width:100%;font-size:.76rem">
    <thead>
      <tr>
        <th ${thS} rowspan="2" style="text-align:left;min-width:130px;background:#1c2235">Éducateur</th>
        <th ${thS} rowspan="2">🌙 Nuits</th>
        <th ${thWE} colspan="4">Week-ends détail</th>
        <th ${thWE} colspan="2">Blocs WE</th>
        <th ${thS} rowspan="2">🎉 Fériés</th>
      </tr>
      <tr>
        <th ${thWE}>Sam Jour</th>
        <th ${thWE}>Sam 🌙</th>
        <th ${thWE}>Dim Jour</th>
        <th ${thWE}>Dim 🌙</th>
        <th ${thWE}>Complets</th>
        <th ${thWE}>Coupés ⚠</th>
      </tr>
    </thead><tbody>`;

  educs.forEach((e,i)=>{
    const a=ann[e.id];
    const re=getTargetH(e)/38;
    // Cibles théoriques proratisées
    const cSamJ=(avgSamJ*re).toFixed(1), cSamN=(avgSamN*re).toFixed(1);
    const cDimJ=(avgDimJ*re).toFixed(1), cDimN=(avgDimN*re).toFixed(1);
    html+=`<tr style="background:${i%2===0?'var(--surface)':'var(--surface2)'}">
      <td style="padding:7px 10px">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="avatar" style="background:${e.color};width:26px;height:26px;font-size:.65rem">${(e.prenom[0]+e.nom[0]).toUpperCase()}</div>
          <div>
            <div style="font-weight:600;font-size:.82rem">${e.prenom} ${e.nom}</div>
            <div style="font-size:.65rem;color:var(--ink3)">${e.contrat} · ratio ${re.toFixed(2)}</div>
          </div>
        </div>
      </td>
      ${aCell(a.nuits, avgNuits*re, 1)}
      ${aCell(a.samJour, avgSamJ*re, 1)}
      ${aCell(a.samNuit, avgSamN*re, 0.5)}
      ${aCell(a.dimJour, avgDimJ*re, 1)}
      ${aCell(a.dimNuit, avgDimN*re, 0.5)}
      ${aCell(a.weBlocs, avgBlocs*re, 1)}
      <td style="padding:6px 8px;text-align:center;font-weight:700;color:${a.weCoupes>avgCoup*re+1?'var(--orange)':'var(--ink)'}">
        ${a.weCoupes}
        <div style="font-size:.6rem;color:var(--ink3)">${a.weCoupes>avgCoup*re+1?'⚠ trop':'OK'}</div>
      </td>
      ${aCell(a.ferie, avgFerie*re, 0.5)}
    </tr>`;
  });

  html+=`<tr style="background:var(--ink);color:#fff;font-weight:700">
    <td style="padding:7px 10px">Moyenne TP</td>
    <td style="padding:6px 8px;text-align:center">${avgNuits.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgSamJ.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgSamN.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgDimJ.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgDimN.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgBlocs.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgCoup.toFixed(1)}</td>
    <td style="padding:6px 8px;text-align:center">${avgFerie.toFixed(1)}</td>
  </tr>`;

  html+=`</tbody></table></div></div>`;
  return html;
}
