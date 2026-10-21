// ============================================================
// algo.js - PlanEduc Pro - Moteur v25
// ============================================================
// UN SEUL COUT, PAS DE SCORES QUI SE CONTREDISENT.
//
// 0. TOURNANTES (posées en premier, jamais cassées ensuite) :
//    - nuits jeudi + vendredi : un seul éducateur par semaine,
//      pas de réunion pour lui le vendredi, pas de WE cette semaine
//    - week-ends : chaque plage samedi+dimanche aux mêmes personnes
//    Ordre : moins de blocs faits (proratisé au contrat), puis tour
//    le plus ancien, puis ordre de la liste des éducateurs.
// 1. CONSTRUCTION jour par jour : chaque poste est donné à
//    l'éducateur dont le coût augmente le moins.
// 2. REEQUILIBRAGE : transferts, échanges, ajout/retrait (entre min
//    et max) acceptés seulement s'ils font baisser le coût total
//    ET restent légaux.
// 3. AUDIT LEGAL indépendant de tout le mois.
//
// LOI (jamais cassée) : repos 11h entre prestations terrain, repos
// après nuit, max nuits consécutives, max jours consécutifs, 50h/sem
// (réunions incluses), max h/jour, absences, jours de travail,
// pas de double sans accord "horaires à pause".
// Réunions = heures administratives : pas de repos 11h, seulement
// pas de chevauchement (>1h) avec une prestation terrain.
//
// COUT par éducateur :
//  - heures  : écart à l'objectif du mois (courbe continue), très
//              fort au-delà de ±(tolérance-3)h sur le mois
//  - équité  : matin/aprem/soir/nuit/sam/dim/fériés, depuis janvier,
//              proratisés au contrat
//  - récurrence : bonus si même prestation le même jour qu'il y a
//              1 semaine (ou 2 semaines = cycle)
//  - week-end : WE coupé pénalisé, 2 WE d'affilée pénalisés
//  - confort : >2 nuits d'affilée, >5 jours d'affilée
//  - préférences : plages préférées, demandes, plages refusées
// ============================================================

(function(){ try{ localStorage.removeItem('planeduc_v3_patterns'); localStorage.removeItem('planeduc_v3_annual'); }catch(e){} })();

// ── Réglages du moteur (ajustables) ──
const CFG={
  hA:0.5, hB:1.5, hBand:3, hMonth:25,
  tw:{matin:1.0,aprem:1.0,soir:1.0,nuit:2.0,journee:1.0,samJ:1.5,samN:1.5,dimJ:1.5,dimN:1.5,ferie:1.5},
  twMois:{matin:6,aprem:5,soir:6,nuit:8,journee:3,samJ:0,samN:0,dimJ:0,dimN:0,ferie:1},
  twPlage:5,
  rec7:14, rec14:8, recJour:2,
  cutWE:30, altWE:12, maxWE:35,
  nuit3:12, cons5:4, pauseDouble:2,
  prefPlage:3, demande:8, excl:150,
  maxSweeps:60, timeBudget:6000, minGain:0.5
};

const DAY_MS=86400000, HOUR_MS=3600000, OVERLAP_TOL=HOUR_MS;
const KEYS=['matin','aprem','soir','nuit','journee','samJ','samN','dimJ','dimN','ferie'];
const ABS_CREDIT={conge:1,maladie:1,formation:1};

const isNuitP   = p => p.type==='nuit'||p.debut>='22:00'||(p.fin<='07:00'&&p.fin>'00:00');
const isReunion = p => p.type==='reunion'||(p.nom||'').toLowerCase().includes('reunion')||(p.nom||'').toLowerCase().includes('réunion');
const isWEDay   = d => d.getDay()===0||d.getDay()===6;
const dowIdx    = d => d.getDay()===0?6:d.getDay()-1;
const ratioE    = e => getTargetH(e)/38;

function dureeH(p){
  if(p.dureeH&&p.dureeH>0) return p.dureeH;
  const [dh,dm]=p.debut.split(':').map(Number), [fh,fm]=p.fin.split(':').map(Number);
  let h=(fh*60+fm)-(dh*60+dm); if(h<=0)h+=1440; return h/60;
}
function typeCat(p){
  if(isReunion(p)) return 'reunion';
  if(isNuitP(p)) return 'nuit';
  if(p.type==='matin'||p.type==='aprem'||p.type==='soir'||p.type==='journee') return p.type;
  if(dureeH(p)>=8) return 'journee';
  const h=parseInt(p.debut); return h<10?'matin':h<14?'aprem':'soir';
}
function typePlage(p){ return typeCat(p); }
function joursOuvMois(yr,mo){
  return getDays(yr,mo).filter(d=>{const dw=d.getDay();return dw>=1&&dw<=5&&!isFerie(dayStr(d));}).length;
}
// Heures créditées (congé, maladie, formation) sur jours ouvrables
function creditHeuresAbs(e,yr,mo){
  const set=new Set();
  absences.forEach(a=>{
    if(a.educId!==e.id||!ABS_CREDIT[a.type]) return;
    getDays(yr,mo).forEach(d=>{
      const ds=dayStr(d),dw=d.getDay();
      if(ds>=a.debut&&ds<=a.fin&&dw>=1&&dw<=5&&!isFerie(ds)) set.add(ds);
    });
  });
  return set.size*7.6*ratioE(e);
}
function heuresDues(e,yr,mo){ return joursOuvMois(yr,mo)*7.6*ratioE(e); }

function dnOf(ds){ return Math.round(Date.UTC(+ds.slice(0,4),+ds.slice(5,7)-1,+ds.slice(8,10))/DAY_MS); }
function dsOfDn(dn){ const d=new Date(dn*DAY_MS); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
function dowOfDn(dn){ return ((dn+3)%7+7)%7; }        // 0 = lundi
function weekOfDn(dn){ return Math.floor((dn+3)/7); } // semaine lundi→dimanche
function hmMs(t){ const [h,m]=t.split(':').map(Number); return h*HOUR_MS+m*60000; }

let _pm=null,_em=null;
function plageById(id){if(!_pm||_pm.size!==plages.length)_pm=new Map(plages.map(p=>[p.id,p]));return _pm.get(+id);}
function educById(id){if(!_em||_em.size!==educs.length)_em=new Map(educs.map(e=>[e.id,e]));return _em.get(+id);}

const _shCache=new Map();
function mkShift(ds,p,cur){
  const key=ds+'|'+p.id+'|'+(cur?1:0);
  let sh=_shCache.get(key); if(sh) return sh;
  const dn=dnOf(ds), s=dn*DAY_MS+hmMs(p.debut); let e=dn*DAY_MS+hmMs(p.fin); if(e<=s) e+=DAY_MS;
  const reun=isReunion(p);
  sh={ds,dn,pid:p.id,s,e,h:dureeH(p),reun,terrain:!reun,night:!reun&&isNuitP(p),cat:typeCat(p),cur:!!cur,ferie:isFerie(ds)};
  _shCache.set(key,sh); return sh;
}
function bumpInto(c,sh,sg){
  c.h+=sg*sh.h;
  if(!sh.terrain) return;
  c[sh.cat]+=sg;
  c.pl[sh.pid]=(c.pl[sh.pid]||0)+sg;
  const dow=dowOfDn(sh.dn);
  if(dow===5){ if(sh.night)c.samN+=sg; else c.samJ+=sg; }
  else if(dow===6){ if(sh.night)c.dimN+=sg; else c.dimJ+=sg; }
  if(sh.ferie) c.ferie+=sg;
}
function newCnt(){ const c={h:0,pl:{}}; KEYS.forEach(k=>c[k]=0); return c; }

// Règle active → sa valeur ; règle désactivée → "off" ; absente → défaut
function ruleVal(type,def,off){
  const all=[...reglesL,...reglesI,...reglesC].filter(r=>r.type===type);
  if(!all.length) return def;
  const act=all.find(r=>r.active);
  return act?+act.value:off;
}
function buildLimits(){
  return {
    minRepos:ruleVal('min_repos',11,0), maxCons:ruleVal('max_consec',7,99),
    maxHSem:ruleVal('max_h_semaine',50,999), maxNuitsC:ruleVal('max_nuits_consec',5,99),
    minReposSem:ruleVal('min_repos_semaine',2,0), reposNuit:ruleVal('repos_apres_nuit',1,0),
    maxWE:ruleVal('max_we_mois',2,99)
  };
}
function plagesDuJour(ds){
  const dn=dnOf(ds), dow=dowOfDn(dn), we=dow>=5;
  const dc=(isFerie(ds)&&!we)?5:dow;
  return plages.filter(p=>(p.jours||[]).includes(dc));
}

// ================================================================
// VERROUILLAGES MANUELS
// ================================================================
function getLockedSlots(moisStr){
  const plan=horaire[moisStr]||{},locked={};
  Object.entries(plan).forEach(([ds,slots])=>{
    Object.entries(slots).forEach(([pid,val])=>{
      if(pid.startsWith('_')||!Array.isArray(val)) return;
      if(slots['_lock_'+pid]==='locked'){if(!locked[ds])locked[ds]={};locked[ds][pid]=val;}
    });
  });
  return locked;
}
function toggleLock(ds,plageId){
  const mo=ds.slice(0,7);
  if(!horaire[mo]||!horaire[mo][ds]) return;
  const lk='_lock_'+plageId;
  horaire[mo][ds][lk]=horaire[mo][ds][lk]==='locked'?null:'locked';
  save(); renderHoraire();
}

function detecterImpossibilites(moisStr){
  const [yr,mo]=moisStr.split('-').map(Number), msgs=[];
  getDays(yr,mo).forEach(d=>{
    const ds=dayStr(d),dow=dowIdx(d);
    plagesDuJour(ds).forEach(p=>{
      const dispo=educs.filter(e=>(e.jours||[]).includes(dow)&&!isAbsent(e.id,ds)).length;
      if(!p.tous&&dispo<(+p.min||0)) msgs.push(`${ds} - ${p.nom}: ${dispo}/${p.min} éduc(s) disponible(s)`);
    });
  });
  return msgs;
}

// ================================================================
// MOTEUR
// ================================================================
async function genMois(moisStr,L,opts){
  opts=opts||{}; L=L||function(){};
  _pm=null;_em=null;_shCache.clear();
  const [yr,mo]=moisStr.split('-').map(Number);
  const jours=getDays(yr,mo), dsList=jours.map(dayStr);
  const MD0=dnOf(dsList[0]), MD1=dnOf(dsList[dsList.length-1]);
  const LIM=buildLimits();
  const tolEl=(typeof document!=='undefined'&&document.getElementById)?document.getElementById('gen-tol'):null;
  const TOLH=opts.tol||(tolEl&&+tolEl.value)||15;
  const lockedSlots=getLockedSlots(moisStr);
  const planning={}, warnings=[], diagnostic=[];
  const S={},CNT={},HISTC={},OBJ={},DUE={},CRED={},HSOLDE={},ELIG={},MEANS={},MEANSM={},MEANSP={},ELIGP={};
  const TW=CFG.tw, TWM=CFG.twMois;

  educs.forEach(e=>{ S[e.id]=[]; CNT[e.id]=newCnt(); HISTC[e.id]=newCnt(); HSOLDE[e.id]=0; });

  function insertShift(arr,sh){
    let i=arr.length;
    while(i>0&&(arr[i-1].s>sh.s||(arr[i-1].s===sh.s&&arr[i-1].pid>sh.pid))) i--;
    arr.splice(i,0,sh);
  }
  function applyAdd(e,sh){ insertShift(S[e.id],sh); if(sh.cur) bumpInto(CNT[e.id],sh,1); }
  function applyRemove(e,sh){
    const arr=S[e.id];
    for(let i=0;i<arr.length;i++){ if(arr[i].dn===sh.dn&&arr[i].pid===sh.pid){arr.splice(i,1);break;} }
    if(sh.cur) bumpInto(CNT[e.id],sh,-1);
  }

  // ── Historique depuis janvier (heures + équité), recalculé depuis les horaires ──
  L('Historique depuis janvier...',5); await sl(20);
  const prevKeys=Object.keys(horaire).filter(k=>k.slice(0,4)===String(yr)&&k<moisStr&&horaire[k]&&Object.keys(horaire[k]).length).sort();
  prevKeys.forEach(key=>{
    const [ky,km]=key.split('-').map(Number), plan=horaire[key], hw={};
    educs.forEach(e=>hw[e.id]=0);
    getDays(ky,km).forEach(day=>{
      const ds=dayStr(day), dd=plan[ds]; if(!dd) return;
      plages.forEach(p=>{
        const ids=dd[p.id]; if(!Array.isArray(ids)) return;
        const sh=mkShift(ds,p,false);
        ids.forEach(x=>{ const id=+x; if(!HISTC[id]) return; hw[id]+=sh.h; bumpInto(HISTC[id],sh,1); });
      });
    });
    educs.forEach(e=>{ HSOLDE[e.id]+=hw[e.id]+creditHeuresAbs(e,ky,km)-heuresDues(e,ky,km); });
  });

  // Fin du mois précédent (repos, jours consécutifs, récurrence, alternance WE)
  const prevKey=moisKey(yr,mo-1), prevPlan=horaire[prevKey];
  if(prevPlan){
    const [py,pm]=prevKey.split('-').map(Number);
    getDays(py,pm).slice(-14).forEach(d=>{
      const ds=dayStr(d), dd=prevPlan[ds]; if(!dd) return;
      plages.forEach(p=>{
        const ids=dd[p.id]; if(!Array.isArray(ids)) return;
        ids.forEach(x=>{ const e=educById(+x); if(e) applyAdd(e,mkShift(ds,p,false)); });
      });
    });
  }

  // ── Objectifs du mois ──
  educs.forEach(e=>{
    DUE[e.id]=heuresDues(e,yr,mo);
    CRED[e.id]=creditHeuresAbs(e,yr,mo);
    const rattrapage=Math.max(-12,Math.min(12,-HSOLDE[e.id]));
    OBJ[e.id]=Math.max(0,DUE[e.id]-CRED[e.id]+rattrapage);
    const j=e.jours||[], ex=e.excls||[];
    const can=cat=>plages.some(p=>typeCat(p)===cat&&!ex.includes(p.id));
    ELIG[e.id]={matin:can('matin'),aprem:can('aprem'),soir:can('soir'),journee:can('journee'),
      nuit:can('nuit'),samJ:j.includes(5),dimJ:j.includes(6),samN:j.includes(5)&&can('nuit'),
      dimN:j.includes(6)&&can('nuit'),ferie:true};
    ELIGP[e.id]={}; plages.forEach(p=>{ if(!isReunion(p)&&!p.tous) ELIGP[e.id][p.id]=!ex.includes(p.id)&&(p.jours||[]).some(d=>j.includes(d)); });
  });

  function calcMeans(){
    KEYS.forEach(k=>{
      let s=0,sm=0,n=0;
      educs.forEach(e=>{ if(!ELIG[e.id][k]) return; const r=Math.max(0.01,ratioE(e)); s+=(HISTC[e.id][k]+CNT[e.id][k])/r; sm+=CNT[e.id][k]/r; n++; });
      MEANS[k]=n?s/n:0; MEANSM[k]=n?sm/n:0;
    });
    plages.forEach(p=>{
      if(isReunion(p)||p.tous) return;
      let s=0,n=0; educs.forEach(e=>{ if(!ELIGP[e.id][p.id]) return; s+=(CNT[e.id].pl[p.id]||0)/Math.max(0.01,ratioE(e)); n++; });
      MEANSP[p.id]=n?s/n:0;
    });
  }
  function eqCore(id,re){
    const c=CNT[id],hc=HISTC[id],el=ELIG[id],ep=ELIGP[id]; let cost=0;
    for(let i=0;i<KEYS.length;i++){ const k=KEYS[i]; if(!el[k]) continue;
      const d=(hc[k]+c[k])/re-MEANS[k], dm=c[k]/re-MEANSM[k]; cost+=TW[k]*d*d+TWM[k]*dm*dm; }
    for(const pid in MEANSP){ if(!ep[pid]) continue; const d=(c.pl[pid]||0)/re-MEANSP[pid]; cost+=CFG.twPlage*d*d; }
    return cost;
  }

  // ================================================================
  // LOI : légalité d'ajouter une prestation (renvoie '' si OK)
  // ================================================================
  function legalAdd(e,sh,wr){
    if(!(e.jours||[]).includes(dowOfDn(sh.dn))) return 'Jour non travaillé';
    if(isAbsent(e.id,sh.ds)) return 'Absence';
    const arr=S[e.id], wk=weekOfDn(sh.dn);
    let hWeek=sh.h, hDay=sh.terrain?sh.h:0, nightDay=sh.night;
    const tDns=new Set(), nDns=new Set(), wDays=new Set();
    if(sh.terrain){ tDns.add(sh.dn); wDays.add(sh.dn); if(sh.night) nDns.add(sh.dn); }
    for(let i=0;i<arr.length;i++){
      const o=arr[i];
      if(o.dn===sh.dn&&o.pid===sh.pid) return 'Déjà assigné';
      if(sh.reun&&o.night&&(o.dn===sh.dn-1||o.dn===sh.dn)) return 'De nuit (pas de réunion)';
      if(o.reun&&sh.night&&(sh.dn===o.dn-1||sh.dn===o.dn)) return 'Réunion ce jour-là';
      if(weekOfDn(o.dn)===wk){ hWeek+=o.h; if(o.terrain) wDays.add(o.dn); }
      if(o.terrain){ tDns.add(o.dn); if(o.night) nDns.add(o.dn); }
      const overlap=o.s<sh.e&&sh.s<o.e?Math.min(o.e,sh.e)-Math.max(o.s,sh.s):0;
      if(!(o.terrain&&sh.terrain)){
        if(overlap>OVERLAP_TOL) return 'Chevauche une autre prestation';
        continue; // réunion : pas de repos 11h
      }
      if(o.dn===sh.dn&&!o.night&&!sh.night){
        if(!e.acceptePause) return 'Pas d\'horaire à pause';
        if(overlap>OVERLAP_TOL) return 'Chevauchement';
        hDay+=o.h; continue;
      }
      if(o.dn===sh.dn){ if(!e.acceptePause) return 'Pas d\'horaire à pause'; hDay+=o.h; if(o.night) nightDay=true; }
      const a=o.s<=sh.s?o:sh, b=a===o?sh:o;
      if(b.s<a.e) return 'Chevauchement';
      const gap=(b.s-a.e)/HOUR_MS;
      if(gap<LIM.minRepos) return `Repos ${LIM.minRepos}h (${gap.toFixed(1)}h)`;
      if(a.night&&b.dn>a.dn){
        const serie=b.night&&b.dn===a.dn+1;
        if(!serie&&b.dn<a.dn+1+LIM.reposNuit) return 'Repos après nuit';
      }
    }
    if(hWeek>LIM.maxHSem+1e-6) return `Max ${LIM.maxHSem}h/sem`;
    if(sh.terrain){
      const cap=nightDay?14:(e.acceptePause?16:11);
      if(hDay>cap+1e-6) return 'Max h/jour';
      let run=1; for(let d=sh.dn-1;tDns.has(d);d--) run++; for(let d=sh.dn+1;tDns.has(d);d++) run++;
      if(run>LIM.maxCons) return `Max ${LIM.maxCons} j consécutifs`;
      if(sh.night){
        let nr=1; for(let d=sh.dn-1;nDns.has(d);d--) nr++; for(let d=sh.dn+1;nDns.has(d);d++) nr++;
        if(nr>LIM.maxNuitsC) return `Max ${LIM.maxNuitsC} nuits consécutives`;
      }
      if(wr&&LIM.minReposSem>0&&wDays.size>7-LIM.minReposSem) return `Repos hebdo (${LIM.minReposSem} j)`;
    }
    return '';
  }

  // ================================================================
  // COUT d'un éducateur (frac = avancement du mois, 1 = fin)
  // ================================================================
  function costE(e,frac){
    const id=e.id,c=CNT[id],hc=HISTC[id],re=Math.max(0.01,ratioE(e)),arr=S[id],el=ELIG[id];
    let cost=0;
    const dev=c.h-OBJ[id]*frac, ex=Math.max(0,Math.abs(dev)-CFG.hBand);
    cost+=CFG.hA*dev*dev+CFG.hB*ex*ex;
    if(frac>=1){
      const m=c.h+CRED[id]-DUE[id], ex2=Math.max(0,Math.abs(m)-(TOLH-3)); cost+=CFG.hMonth*ex2*ex2;
      const cu=HSOLDE[id]+m, ex3=Math.max(0,Math.abs(cu)-(TOLH-6)); cost+=CFG.hMonth*ex3*ex3;
    }
    cost+=eqCore(id,re);

    const byDn=new Map();
    for(let i=0;i<arr.length;i++){ const o=arr[i]; if(!o.terrain) continue; let st=byDn.get(o.dn); if(!st){st=[];byDn.set(o.dn,st);} st.push(o.pid); }
    const weeks=new Map();
    const prefs=e.prefs||[], excl=e.excls||[], dems=e.demandes||[];
    let nr=0,np=-99;
    for(let i=0;i<arr.length;i++){
      const o=arr[i]; if(!o.terrain) continue;
      const dow=dowOfDn(o.dn);
      if(o.cur){
        const s7=byDn.get(o.dn-7), s14=byDn.get(o.dn-14);
        if(dow>=5){ if(s14&&s14.indexOf(o.pid)>=0) cost-=CFG.rec14; }
        else if(s7&&s7.indexOf(o.pid)>=0) cost-=CFG.rec7;
        else if(s14&&s14.indexOf(o.pid)>=0) cost-=CFG.rec14;
        else if(s7||s14) cost-=CFG.recJour;
        if(prefs.includes(o.pid)) cost-=CFG.prefPlage;
        if(excl.includes(o.pid)) cost+=CFG.excl;
        for(const dm of dems){ if(dm.jour===dow&&(dm.plageIds||[]).includes(o.pid)) cost+=dm.type==='eviter'?CFG.demande:-CFG.demande; }
      }
      if(o.night&&o.dn!==np){ nr=(o.dn===np+1)?nr+1:1; np=o.dn; if(nr>2) cost+=CFG.nuit3; }
      if(dow>=4){
        const wk=weekOfDn(o.dn); let w=weeks.get(wk);
        if(!w){w={friN:false,sat:false,sun:false,satN:false};weeks.set(wk,w);}
        if(dow===4){ if(o.night) w.friN=true; }
        else if(dow===5){ w.sat=true; if(o.night) w.satN=true; }
        else w.sun=true;
      }
    }
    let run=0,prev=-99;
    for(const [dn,st] of byDn){ run=(dn===prev+1)?run+1:1; prev=dn; if(run>5) cost+=CFG.cons5; if(st.length>1) cost+=CFG.pauseDouble; }
    const worked=new Set(); let curWE=0;
    for(const [wk,w] of weeks){
      if(!(w.sat||w.sun)) continue;
      if(!((w.sat&&w.sun)||(w.friN&&w.satN))) cost+=CFG.cutWE;
      worked.add(wk);
      const sat=wk*7+2; if(sat>=MD0&&sat<=MD1) curWE++;
    }
    for(const wk of worked) if(worked.has(wk+1)) cost+=CFG.altWE;
    if(curWE>LIM.maxWE) cost+=CFG.maxWE*(curWE-LIM.maxWE);
    return cost;
  }

  function weCountCur(e){
    const s=new Set();
    for(const o of S[e.id]) if(o.cur&&o.terrain&&dowOfDn(o.dn)>=5) s.add(weekOfDn(o.dn));
    return s;
  }
  // Conventions (relâchées progressivement si la couverture l'exige)
  // Heures de réunions "tous" encore à venir ce mois (réservées dans le plafond)
  const REUN=[];
  dsList.forEach(ds=>plagesDuJour(ds).forEach(p=>{ if(p.tous) REUN.push({ds,dn:dnOf(ds),h:dureeH(p)}); }));
  function reuRest(e,dn){
    let h=0;
    for(const r of REUN){
      if(r.dn===dn||!(e.jours||[]).includes(dowOfDn(r.dn))||isAbsent(e.id,r.ds)) continue;
      if(S[e.id].some(o=>o.reun&&o.dn===r.dn)) continue; // déjà comptée
      h+=r.h;
    }
    return h;
  }
  function convWhy(e,sh,lvl){
    if(sh.reun) return '';
    if(lvl<2&&(e.excls||[]).includes(sh.pid)) return 'Plage refusée';
    const cap=Math.min(TOLH,TOLH-3+lvl*3);
    const mois=CNT[e.id].h+sh.h+reuRest(e,sh.dn)+CRED[e.id]-DUE[e.id], cumul=HSOLDE[e.id]+mois;
    if(mois>cap||cumul>cap) return `Heures (+${Math.max(mois,cumul).toFixed(0)}h)`;
    if(lvl<1&&dowOfDn(sh.dn)>=5){ const w=weCountCur(e); if(!w.has(weekOfDn(sh.dn))&&w.size>=LIM.maxWE) return 'Max WE/mois'; }
    return '';
  }
  // Plafond dur ±tolérance (mois et cumul) pour le rééquilibrage
  function hoursOK(e,gain,perte){
    const m=CNT[e.id].h+gain.h-(perte?perte.h:0)+CRED[e.id]-DUE[e.id];
    return m<=TOLH&&HSOLDE[e.id]+m<=TOLH;
  }
  function assign(e,ds,p){ applyAdd(e,mkShift(ds,p,true)); (planning[ds][p.id]||(planning[ds][p.id]=[])).push(e.id); }
  function slotIds(ds,pid){ return ((planning[ds]||{})[pid]||[]).map(Number); }

  // ================================================================
  // ETAPE 0 : BLOCS EN TOURNANTE
  //  - nuits jeudi + vendredi : 1 éducateur par semaine
  //  - week-end : chaque plage sam+dim aux mêmes personnes
  //  Ordre : moins de blocs (proratisé au contrat), puis tour le
  //  plus ancien, puis ordre de la liste. Cycle complet garanti.
  // ================================================================
  const blockKeys=new Set();
  const ROT={};
  educs.forEach(e=>ROT[e.id]={jv:0,lastJV:-1e9,we:0,weN:0,weJ:0,lastWE:-1e9,jvWeeks:new Set(),weWeeks:new Set(),pl:{},plLast:{},plWeeks:{}});
  const plKey=p=>p.id; // la plage du samedi identifie la prestation de week-end
  {
    const keys12=Object.keys(horaire).filter(k=>k<moisStr&&k>=moisKey(yr,mo-12)).sort();
    keys12.forEach(key=>{
      const plan=horaire[key]; if(!plan) return;
      Object.keys(plan).forEach(ds=>{
        if(ds.length!==10) return;
        const dn=dnOf(ds), dow=dowOfDn(dn), wk=weekOfDn(dn);
        plages.forEach(p=>{
          const ids=plan[ds][p.id]; if(!Array.isArray(ids)||isReunion(p)) return;
          const night=isNuitP(p);
          ids.forEach(x=>{ const r=ROT[+x]; if(!r) return;
            if(night&&(dow===3||dow===4)&&!r.jvWeeks.has(wk)){ r.jvWeeks.add(wk); r.jv++; r.lastJV=Math.max(r.lastJV,wk); }
            if(dow>=5){
              if(!r.weWeeks.has(wk)){ r.weWeeks.add(wk); r.we++; r.lastWE=Math.max(r.lastWE,wk); if(night) r.weN++; else r.weJ++; }
              const k=plKey(p); if(!r.plWeeks[k]) r.plWeeks[k]=new Set();
              if(!r.plWeeks[k].has(wk)){ r.plWeeks[k].add(wk); r.pl[k]=(r.pl[k]||0)+1; r.plLast[k]=Math.max(r.plLast[k]||-1e9,wk); }
            }
          });
        });
      });
    });
  }
  const prevPlanB=horaire[moisKey(yr,mo-1)]||{};
  function pairPlages(d1,d2,filt,loose){
    const inM=dn=>dn>=MD0&&dn<=MD1;
    const ds1=dsOfDn(d1), ds2=dsOfDn(d2);
    const list=dn=>{ const ds=dsOfDn(dn); return inM(dn)?plagesDuJour(ds).filter(filt):plages.filter(q=>filt(q)&&(q.jours||[]).includes(dowOfDn(dn))); };
    const A=list(d1), B=list(d2), out=[];
    A.forEach(p=>{
      const q=B.find(x=>x.id===p.id)||B.find(x=>typeCat(x)===typeCat(p)&&x.debut===p.debut)||(loose&&A.length===1&&B.length===1?B[0]:null);
      if(!q) return;
      const slots=[]; let prevIds=null;
      if(inM(d1)) slots.push({ds:ds1,p}); else if(prevPlanB[ds1]&&Array.isArray(prevPlanB[ds1][p.id])) prevIds=prevPlanB[ds1][p.id].map(Number);
      if(inM(d2)) slots.push({ds:ds2,p:q});
      const phantom=(!inM(d2)&&d2>MD1)?{ds:ds2,p:q}:null; // jour du mois suivant : réservé
      if(!slots.length||slots.some(s2=>lockedSlots[s2.ds]&&lockedSlots[s2.ds][s2.p.id])) return;
      out.push({slots,prevIds,phantom,count:Math.max(...slots.map(s2=>Math.max(0,+s2.p.min||0)))});
    });
    return out;
  }
  function tryBlock(e,shs,lvl){
    const done=[]; let why='';
    for(const sh of shs){
      why=legalAdd(e,sh,true)||convWhy(e,sh,lvl);
      if(why) break;
      applyAdd(e,sh); done.push(sh);
    }
    done.forEach(sh=>applyRemove(e,sh));
    return why;
  }
  function assignBlock(blk,kind,wk){
    const shs=blk.slots.map(s2=>mkShift(s2.ds,s2.p,true));
    if(blk.phantom) shs.push(mkShift(blk.phantom.ds,blk.phantom.p,false));
    const chosen=[]; const reasons={};
    const night=shs[0].night;
    const blocked=e=>kind==='we'?ROT[e.id].jvWeeks.has(wk):ROT[e.id].weWeeks.has(wk);
    if(blk.prevIds) blk.prevIds.forEach(id=>{ const e=educById(id); if(e&&chosen.length<blk.count&&!tryBlock(e,shs,1)) chosen.push(e); });
    for(let lvl=0;lvl<3&&chosen.length<blk.count;lvl++){
      const c=educs.filter(e=>{
        if(chosen.includes(e)) return false;
        if(blocked(e)){ reasons[e.id]=kind==='we'?'Fait les nuits jeu+ven cette semaine':'Fait le week-end'; return false; }
        const w=tryBlock(e,shs,lvl); if(w){ if(!lvl) reasons[e.id]=w; return false; } return true;
      });
      const r=e=>ROT[e.id], re=e=>Math.max(0.01,ratioE(e));
      const pk=plKey(blk.slots[0].p);
      const key=kind==='jv'
        ? e=>[r(e).jv/re(e), r(e).lastJV]
        : e=>[(r(e).pl[pk]||0)/re(e), r(e).weWeeks.has(wk-1)?1:0, r(e).we/re(e), r(e).plLast[pk]||-1e9];
      c.sort((a,b)=>{ const ka=key(a),kb=key(b); for(let i=0;i<ka.length;i++){ if(Math.abs(ka[i]-kb[i])>1e-9) return ka[i]-kb[i]; } return educs.indexOf(a)-educs.indexOf(b); });
      c.slice(0,blk.count-chosen.length).forEach(e=>chosen.push(e));
    }
    chosen.forEach(e=>{
      blk.slots.forEach(s2=>{ if(!planning[s2.ds]) planning[s2.ds]={}; assign(e,s2.ds,s2.p); });
      if(blk.phantom) applyAdd(e,mkShift(blk.phantom.ds,blk.phantom.p,false));
      const R=ROT[e.id];
      if(kind==='jv'&&!R.jvWeeks.has(wk)){ R.jvWeeks.add(wk); R.jv++; R.lastJV=wk; }
      if(kind==='we'&&!R.weWeeks.has(wk)){ R.weWeeks.add(wk); R.we++; R.lastWE=wk; if(night) R.weN++; else R.weJ++; }
      if(kind==='we'){ const k=plKey(blk.slots[0].p); if(!R.plWeeks[k]) R.plWeeks[k]=new Set(); if(!R.plWeeks[k].has(wk)){ R.plWeeks[k].add(wk); R.pl[k]=(R.pl[k]||0)+1; R.plLast[k]=wk; } }
    });
    blk.slots.forEach(s2=>blockKeys.add(s2.ds+'|'+s2.p.id));
    const nomBloc=(kind==='jv'?'Nuits jeu+ven':'Week-end')+' — '+blk.slots[0].p.nom+' (tournante)';
    diagnostic.push({ds:blk.slots[0].ds,plage:nomBloc,couverte:chosen.length>=blk.count,
      details:educs.map(e=>chosen.includes(e)?row(e,true,'Son tour'):row(e,false,reasons[e.id]||'Pas son tour'))});
    if(chosen.length<blk.count) warnings.push(`${blk.slots[0].ds} - ${nomBloc}: bloc incomplet (${chosen.length}/${blk.count}), complété jour par jour`);
  }
  const row=(e,ok,raison)=>({nom:e.prenom+' '+e.nom,ini:(e.prenom[0]+e.nom[0]).toUpperCase(),color:e.color||'#888',ok,raison});
  L('Tournantes : nuits jeudi+vendredi et week-ends...',10); await sl(10);
  dsList.forEach(ds=>{ if(!planning[ds]) planning[ds]={}; });
  if(lockedSlots) Object.entries(lockedSlots).forEach(([ds,sl2])=>Object.entries(sl2).forEach(([pid,ids])=>{
    const p=plageById(+pid); if(!p||!planning[ds]) return;
    planning[ds][pid]=[]; planning[ds]['_lock_'+pid]='locked';
    ids.forEach(x=>{ const e=educById(+x); if(e) assign(e,ds,p); });
  }));
  const wks=[...new Set(dsList.map(ds=>weekOfDn(dnOf(ds))))].sort((a,b)=>a-b);
  const isNightPl=q=>!isReunion(q)&&isNuitP(q), isTerrain=q=>!isReunion(q)&&!q.tous;
  wks.forEach(wk=>{
    pairPlages(wk*7,wk*7+1,isNightPl,true).forEach(b=>assignBlock(b,'jv',wk));
    const weB=pairPlages(wk*7+2,wk*7+3,isTerrain);
    weB.sort((a,b)=>(b.slots[0].p&&isNuitP(b.slots[0].p))-(a.slots[0].p&&isNuitP(a.slots[0].p)));
    weB.forEach(b=>assignBlock(b,'we',wk));
  });

  // ── Bilan de charge ──
  let demande=0;
  dsList.forEach(ds=>plagesDuJour(ds).forEach(p=>{
    const n=p.tous?educs.length:Math.max(0,+p.min||0); demande+=n*dureeH(p);
  }));
  const capacite=educs.reduce((s,e)=>s+OBJ[e.id],0);
  const demDay=dsList.map(ds=>plagesDuJour(ds).reduce((s,p)=>s+(p.tous?educs.length:Math.max(0,+p.min||0))*dureeH(p),0));
  const demTot=Math.max(1,demDay.reduce((a,b)=>a+b,0));

  // ================================================================
  // ETAPE 1 : CONSTRUCTION
  // ================================================================
  L('Construction des semaines...',15); await sl(20);
  let cum=0;
  for(let di=0;di<dsList.length;di++){
    const ds=dsList[di], dn=dnOf(ds), dow=dowOfDn(dn), ferie=isFerie(ds);
    if(!planning[ds]) planning[ds]={};
    const frac=(cum+0.5*demDay[di])/demTot; cum+=demDay[di];
    if(di%4===0){ L(`Jour ${di+1}/${dsList.length}`,15+Math.round(di/dsList.length*40)); await sl(0); }


    const todays=plagesDuJour(ds).filter(p=>!(lockedSlots[ds]&&lockedSlots[ds][p.id]));
    const scarce=new Map();
    todays.forEach(p=>{ const sh=mkShift(ds,p,true); scarce.set(p.id,educs.filter(e=>!legalAdd(e,sh,true)).length/Math.max(1,+p.min||1)); });
    todays.sort((a,b)=>(isReunion(a)-isReunion(b))||(scarce.get(a.id)-scarce.get(b.id)));

    for(const p of todays){
      if(blockKeys.has(ds+'|'+p.id)) continue;
      const sh=mkShift(ds,p,true), reqMin=Math.max(0,+p.min||0);
      if(!planning[ds][p.id]) planning[ds][p.id]=[];
      if(p.tous){
        educs.forEach(e=>{ if(!legalAdd(e,sh,false)) assign(e,ds,p); });
        if(slotIds(ds,p.id).length<reqMin) warnings.push(`${ds} - ${p.nom}: ${slotIds(ds,p.id).length}/${reqMin} présents`);
        continue;
      }
      calcMeans();
      let relax=0;
      for(let lvl=0;lvl<3&&slotIds(ds,p.id).length<reqMin;lvl++){
        const taken=new Set(slotIds(ds,p.id));
        const cands=[];
        for(const e of educs){
          if(taken.has(e.id)) continue;
          if(legalAdd(e,sh,true)) continue;
          if(convWhy(e,sh,lvl)) continue;
          const base=costE(e,frac);
          applyAdd(e,sh);
          let c=costE(e,frac)-base;
          if(dow===5&&sh.terrain&&dn<MD1){
            const sun=dsList[di+1], sunPl=plagesDuJour(sun).filter(q=>!isReunion(q));
            if(sunPl.length&&!sunPl.some(q=>!legalAdd(e,mkShift(sun,q,true),false))) c+=CFG.cutWE*0.9;
          }
          applyRemove(e,sh);
          cands.push({e,c});
        }
        cands.sort((a,b)=>a.c-b.c||a.e.id-b.e.id);
        const need=reqMin-taken.size;
        cands.slice(0,need).forEach(x=>assign(x.e,ds,p));
        if(cands.length&&lvl>relax) relax=lvl;
      }
      // Places au-dessus du minimum : seulement pour qui est en retard sur son rythme d'heures
      const reqMax=Math.max(reqMin,+p.max||reqMin);
      if(!isReunion(p)&&slotIds(ds,p.id).length>=reqMin&&slotIds(ds,p.id).length<reqMax){
        const taken=new Set(slotIds(ds,p.id)), extra=[];
        for(const e of educs){
          if(taken.has(e.id)||legalAdd(e,sh,true)||convWhy(e,sh,0)) continue;
          if(CNT[e.id].h+sh.h>OBJ[e.id]*frac+2) continue;
          const base=costE(e,frac); applyAdd(e,sh); const c=costE(e,frac)-base; applyRemove(e,sh);
          if(c<-2) extra.push({e,c});
        }
        extra.sort((x,y)=>x.c-y.c||x.e.id-y.e.id).slice(0,reqMax-taken.size).forEach(x=>assign(x.e,ds,p));
      }
      const got=slotIds(ds,p.id);
      if(got.length<reqMin||sh.night||dow>=5||ferie||relax>0){
        const det=educs.map(e=>{
          if(got.includes(e.id)) return row(e,true,'Assigné');
          return row(e,false,legalAdd(e,sh,true)||convWhy(e,sh,0)||'Non retenu (moins prioritaire)');
        });
        diagnostic.push({ds,plage:p.nom+(relax?` (règles internes assouplies niv.${relax})`:''),couverte:got.length>=reqMin,details:det});
      }
    }
  }

  // ================================================================
  // ETAPE 2 : REEQUILIBRAGE (heures, équité, WE, récurrence)
  // ================================================================
  L('Rééquilibrage des heures et des prestations...',58); await sl(20);
  const slots=[];
  dsList.forEach(ds=>plagesDuJour(ds).forEach(p=>{
    if(isReunion(p)||p.tous||(lockedSlots[ds]&&lockedSlots[ds][p.id])||blockKeys.has(ds+'|'+p.id)) return;
    const mn=Math.max(0,+p.min||0);
    slots.push({ds,p,sh:mkShift(ds,p,true),min:mn,max:Math.max(mn,+p.max||mn)});
  }));
  function hPart(e){
    const id=e.id,c=CNT[id], dev=c.h-OBJ[id], ex=Math.max(0,Math.abs(dev)-CFG.hBand);
    const m=c.h+CRED[id]-DUE[id], ex2=Math.max(0,Math.abs(m)-(TOLH-3)), ex3=Math.max(0,Math.abs(HSOLDE[id]+m)-(TOLH-6));
    return CFG.hA*dev*dev+CFG.hB*ex*ex+CFG.hMonth*(ex2*ex2+ex3*ex3);
  }
  function eqPart(e){
    return eqCore(e.id,Math.max(0.01,ratioE(e)));
  }
  const t0=Date.now(); let nMoves=0;
  for(let sweep=0;sweep<CFG.maxSweeps&&Date.now()-t0<CFG.timeBudget;sweep++){
    calcMeans();
    const base={}; educs.forEach(e=>base[e.id]=costE(e,1));
    const moves=[], holds={}; educs.forEach(e=>holds[e.id]=[]);
    for(const slot of slots){
      const ids=slotIds(slot.ds,slot.p.id), sh=slot.sh;
      ids.forEach(id=>{ if(holds[id]) holds[id].push(slot); });
      for(const aid of ids){
        const A=educById(aid); if(!A) continue;
        applyRemove(A,sh);
        const dA=costE(A,1)-base[aid];
        if(ids.length>slot.min&&dA<-CFG.minGain) moves.push({t:'rem',A,slot,d:dA});
        for(const B of educs){
          if(B.id===aid||ids.includes(B.id)||(B.excls||[]).includes(slot.p.id)) continue;
          if(legalAdd(B,sh,true)||!hoursOK(B,sh,null)) continue;
          applyAdd(B,sh); const dB=costE(B,1)-base[B.id]; applyRemove(B,sh);
          if(dA+dB<-CFG.minGain) moves.push({t:'xfer',A,B,slot,d:dA+dB});
        }
        applyAdd(A,sh);
      }
      if(ids.length<slot.max){
        for(const B of educs){
          if(ids.includes(B.id)||(B.excls||[]).includes(slot.p.id)||legalAdd(B,sh,true)||convWhy(B,sh,0)) continue;
          applyAdd(B,sh); const dB=costE(B,1)-base[B.id]; applyRemove(B,sh);
          if(dB<-CFG.minGain) moves.push({t:'add',B,slot,d:dB});
        }
      }
    }
    // Echanges (équité des types sans toucher aux heures)
    for(let i=0;i<educs.length;i++) for(let j=i+1;j<educs.length;j++){
      const A=educs[i],B=educs[j];
      for(const sa of holds[A.id]) for(const sb of holds[B.id]){
        const a=sa.sh,b=sb.sh;
        if(a===b||Math.abs(a.h-b.h)>3) continue;
        if(a.cat===b.cat&&dowOfDn(a.dn)<5&&dowOfDn(b.dn)<5) continue;
        if(slotIds(sa.ds,sa.p.id).includes(B.id)||slotIds(sb.ds,sb.p.id).includes(A.id)) continue;
        if((A.excls||[]).includes(b.pid)||(B.excls||[]).includes(a.pid)) continue;
        const e0=eqPart(A)+eqPart(B)+hPart(A)+hPart(B);
        bumpInto(CNT[A.id],a,-1);bumpInto(CNT[A.id],b,1);bumpInto(CNT[B.id],b,-1);bumpInto(CNT[B.id],a,1);
        const e1=eqPart(A)+eqPart(B)+hPart(A)+hPart(B);
        bumpInto(CNT[A.id],b,-1);bumpInto(CNT[A.id],a,1);bumpInto(CNT[B.id],a,-1);bumpInto(CNT[B.id],b,1);
        if(e1-e0>-1) continue;
        applyRemove(A,a); applyRemove(B,b);
        const okA=!legalAdd(A,b,true), okB=!legalAdd(B,a,true);
        let d=Infinity;
        if(okA&&okB&&hoursOK(A,b,a)&&hoursOK(B,a,b)){ applyAdd(A,b); applyAdd(B,a); d=costE(A,1)+costE(B,1)-base[A.id]-base[B.id]; applyRemove(A,b); applyRemove(B,a); }
        applyAdd(A,a); applyAdd(B,b);
        if(d<-CFG.minGain) moves.push({t:'swap',A,B,sa,sb,d});
      }
    }
    moves.sort((x,y)=>x.d-y.d);
    const touched=new Set(); let applied=0;
    for(const m of moves){
      if((m.A&&touched.has(m.A.id))||(m.B&&touched.has(m.B.id))) continue;
      if(m.t==='rem'){
        const ids=slotIds(m.slot.ds,m.slot.p.id); if(ids.length<=m.slot.min||!ids.includes(m.A.id)) continue;
        applyRemove(m.A,m.slot.sh); planning[m.slot.ds][m.slot.p.id]=ids.filter(x=>x!==m.A.id);
      } else if(m.t==='add'){
        const ids=slotIds(m.slot.ds,m.slot.p.id); if(ids.length>=m.slot.max||ids.includes(m.B.id)||legalAdd(m.B,m.slot.sh,true)) continue;
        assign(m.B,m.slot.ds,m.slot.p);
      } else if(m.t==='xfer'){
        const ids=slotIds(m.slot.ds,m.slot.p.id); if(!ids.includes(m.A.id)||ids.includes(m.B.id)||legalAdd(m.B,m.slot.sh,true)) continue;
        applyRemove(m.A,m.slot.sh); planning[m.slot.ds][m.slot.p.id]=ids.filter(x=>x!==m.A.id);
        assign(m.B,m.slot.ds,m.slot.p);
      } else {
        const ia=slotIds(m.sa.ds,m.sa.p.id), ib=slotIds(m.sb.ds,m.sb.p.id);
        if(!ia.includes(m.A.id)||!ib.includes(m.B.id)||ia.includes(m.B.id)||ib.includes(m.A.id)) continue;
        applyRemove(m.A,m.sa.sh); applyRemove(m.B,m.sb.sh);
        if(legalAdd(m.A,m.sb.sh,true)||legalAdd(m.B,m.sa.sh,true)){ applyAdd(m.A,m.sa.sh); applyAdd(m.B,m.sb.sh); continue; }
        planning[m.sa.ds][m.sa.p.id]=ia.filter(x=>x!==m.A.id); planning[m.sb.ds][m.sb.p.id]=ib.filter(x=>x!==m.B.id);
        assign(m.A,m.sb.ds,m.sb.p); assign(m.B,m.sa.ds,m.sa.p);
      }
      if(m.A) touched.add(m.A.id); if(m.B) touched.add(m.B.id);
      applied++;
    }
    nMoves+=applied;
    L(`Rééquilibrage passe ${sweep+1} : ${applied} ajustement(s)`,58+Math.min(30,sweep));
    await sl(0);
    if(!applied) break;
  }

  // ================================================================
  // ETAPE 3 : STATUTS, BILAN
  // ================================================================
  dsList.forEach(ds=>{
    const dd=planning[ds], dow=dowOfDn(dnOf(ds));
    plagesDuJour(ds).forEach(p=>{
      const ids=slotIds(ds,p.id);
      if(!p.tous&&ids.length<(+p.min||0)) warnings.push(`${ds} - ${p.nom}: ${(+p.min||0)-ids.length} poste(s) non couvert(s)`);
      ids.forEach(id=>{
        const e=educById(id); if(!e) return;
        const dem=(e.demandes||[]).find(x=>x.jour===dow&&(x.plageIds||[]).includes(p.id));
        let st='neutral';
        if(!isReunion(p)&&(e.excls||[]).includes(p.id)){ st='forced'; warnings.push(`${ds} - ${p.nom}: plage refusée attribuée à ${e.prenom} (manque de personnel)`); }
        else if(dem&&dem.type==='eviter'){ st='dem_evite'; warnings.push(`${ds} - ${p.nom}: demande de ${e.prenom} non respectée`); }
        else if(dem&&dem.type==='prefere') st='dem_pref';
        else if((e.prefs||[]).includes(p.id)) st='pref';
        dd[`_s_${id}_${p.id}`]=st;
      });
    });
  });

  let recOK=0,recTot=0,cuts=0;
  const bilan=educs.map(e=>{
    const c=CNT[e.id], mois=c.h+CRED[e.id]-DUE[e.id];
    const byDn=new Map(); S[e.id].forEach(o=>{ if(o.terrain){ if(!byDn.has(o.dn))byDn.set(o.dn,[]); byDn.get(o.dn).push(o.pid);} });
    S[e.id].forEach(o=>{
      if(!o.cur||!o.terrain||dowOfDn(o.dn)>=5) return;
      const s7=byDn.get(o.dn-7), s14=byDn.get(o.dn-14);
      if(!s7&&!s14) return;
      recTot++; if((s7&&s7.includes(o.pid))||(s14&&s14.includes(o.pid))) recOK++;
    });
    const wk=new Map();
    S[e.id].forEach(o=>{ if(!o.terrain) return; const dw=dowOfDn(o.dn); if(dw<4) return;
      const k=weekOfDn(o.dn); if(!wk.has(k)) wk.set(k,{fn:0,s:0,d:0,sn:0}); const w=wk.get(k);
      if(dw===4){ if(o.night) w.fn=1; } else if(dw===5){ w.s=1; if(o.night) w.sn=1; } else w.d=1; });
    let cu=0; wk.forEach((w,k)=>{ const sat=k*7+2; if(sat+1<MD0||sat>MD1) return; if(sat<MD0&&!w.d) return; if((w.s||w.d)&&!((w.s&&w.d)||(w.fn&&w.sn))) cu++; }); cuts+=cu;
    return {id:e.id,nom:e.prenom+' '+e.nom,heures:c.h,dues:DUE[e.id],credit:CRED[e.id],mois,cumul:HSOLDE[e.id]+mois,coupes:cu};
  });

  if(opts.hook) opts.hook({S,CNT,OBJ,HSOLDE,legalAdd,costE,convWhy,calcMeans,shift:(ds,pid)=>mkShift(ds,plageById(pid),true)});
  return {planning,warnings,diagnostic,bilan,
    charge:{demande,capacite},
    recurrence:recTot?recOK/recTot:1, coupes:cuts, ajustements:nMoves};
}

// ================================================================
// AUDIT LEGAL INDEPENDANT (contrôle le mois tel qu'il est)
// ================================================================
function auditLegal(planning,moisStr){
  const LIM=buildLimits(), out=[];
  const [yr,mo]=moisStr.split('-').map(Number);
  const dsList=getDays(yr,mo).map(dayStr);
  const MD0=dnOf(dsList[0]), MD1=dnOf(dsList[dsList.length-1]);
  const prevKey=moisKey(yr,mo-1), prev=horaire[prevKey]||{};
  const [py,pm]=prevKey.split('-').map(Number);
  const tail=getDays(py,pm).slice(-14).map(dayStr);
  educs.forEach(e=>{
    const list=[];
    const take=(plan,ds,cur)=>{ const dd=plan[ds]; if(!dd) return; plages.forEach(p=>{ const ids=dd[p.id]; if(Array.isArray(ids)&&ids.map(Number).includes(e.id)){ const sh=Object.assign({},mkShift(ds,p,cur)); sh.nom=p.nom; list.push(sh);} }); };
    tail.forEach(ds=>take(prev,ds,false)); dsList.forEach(ds=>take(planning,ds,true));
    list.sort((a,b)=>a.s-b.s);
    const V=(ds,m)=>out.push({educ:e.prenom+' '+e.nom,ds,msg:m});
    list.forEach(x=>{ if(!x.cur) return;
      if(isAbsent(e.id,x.ds)) V(x.ds,`${x.nom} pendant une absence`);
      if(!(e.jours||[]).includes(dowOfDn(x.dn))) V(x.ds,`${x.nom} un jour non travaillé`); });
    const T=list.filter(x=>x.terrain);
    for(let i=1;i<T.length;i++){
      const a=T[i-1],b=T[i]; if(!b.cur) continue;
      const sameDay=a.dn===b.dn&&!a.night&&!b.night;
      if(a.dn===b.dn&&!e.acceptePause) V(b.ds,'Deux prestations sans accord horaire à pause');
      if(sameDay){ if(a.e-b.s>OVERLAP_TOL) V(b.ds,'Chevauchement'); continue; }
      const gap=(b.s-a.e)/HOUR_MS;
      if(gap<LIM.minRepos-1e-6) V(b.ds,`Repos ${gap.toFixed(1)}h < ${LIM.minRepos}h`);
      if(a.night&&b.dn>a.dn&&!(b.night&&b.dn===a.dn+1)&&b.dn<a.dn+1+LIM.reposNuit) V(b.ds,'Pas de repos après nuit');
    }
    list.filter(x=>x.reun&&x.cur).forEach(r=>T.forEach(t=>{ const ov=Math.min(r.e,t.e)-Math.max(r.s,t.s); if(ov>OVERLAP_TOL) V(r.ds,'Réunion pendant une prestation'); }));
    const dayH=new Map(), weekH=new Map(), wDays=new Map();
    list.forEach(x=>{ const w=weekOfDn(x.dn); weekH.set(w,(weekH.get(w)||0)+x.h);
      if(x.terrain){ const k=x.dn; const o=dayH.get(k)||{h:0,n:false}; o.h+=x.h; o.n=o.n||x.night; dayH.set(k,o);
        if(!wDays.has(w)) wDays.set(w,new Set()); wDays.get(w).add(x.dn); } });
    dayH.forEach((o,dn)=>{ if(dn<MD0) return; const cap=o.n?14:(e.acceptePause?16:11); if(o.h>cap+1e-6) V(dsList[dn-MD0],`${o.h.toFixed(1)}h terrain sur la journée`); });
    weekH.forEach((h,w)=>{ if(w*7+3<MD0) return; if(h>LIM.maxHSem+1e-6) V(dsList[Math.max(0,Math.min(dsList.length-1,w*7-3-MD0))],`${h.toFixed(1)}h sur la semaine`); });
    wDays.forEach((set,w)=>{ const mon=w*7-3, sun=w*7+3; if(mon<dnOf(tail[0])||sun>MD1||sun<MD0) return;
      if(7-set.size<LIM.minReposSem) V(dsList[Math.max(0,mon-MD0)],`${7-set.size} jour(s) de repos dans la semaine`); });
    const dns=[...new Set(T.map(x=>x.dn))].sort((a,b)=>a-b);
    let r=0; dns.forEach((d,i)=>{ r=(i&&d===dns[i-1]+1)?r+1:1; if(r===LIM.maxCons+1&&d>=MD0) V(dsList[d-MD0],`${r} jours consécutifs`); });
    const nd=[...new Set(T.filter(x=>x.night).map(x=>x.dn))].sort((a,b)=>a-b);
    r=0; nd.forEach((d,i)=>{ r=(i&&d===nd[i-1]+1)?r+1:1; if(r===LIM.maxNuitsC+1&&d>=MD0) V(dsList[d-MD0],`${r} nuits consécutives`); });
  });
  return out;
}

// ================================================================
// UI
// ================================================================
function verifier(){
  const warns=[];
  if(!educs.length)warns.push({t:'err',m:'Aucun éducateur défini.'});
  if(!plages.length)warns.push({t:'err',m:'Aucune plage horaire définie.'});
  const rc=document.getElementById('gen-recap'),ri=document.getElementById('gen-recap-content');
  rc.style.display='block';
  let html=warns.map(w=>`<div class="alert a-${w.t}">! ${w.m}</div>`).join('');
  if(!warns.length){
    html+=`<div class="alert a-ok">OK : ${educs.length} éducateurs, ${plages.length} plages, ${educs.filter(e=>e.acceptePause).length} accepte(nt) les horaires à pause</div>`;
    html+=plages.map(p=>{
      const j=(p.jours||[]).map(x=>JOURS[x]).join(', ');
      const b=isReunion(p)?'<span class="badge b-blue" style="font-size:.6rem">RÉUNION</span>':'';
      return `<div style="display:flex;align-items:center;gap:7px;margin:5px 0;font-size:.8rem">
        <div style="width:8px;height:8px;border-radius:50%;background:${p.color}"></div>
        <strong>${p.nom}</strong> ${b} - ${p.debut}-${p.fin} - min ${p.min} / max ${p.max} - ${j}</div>`;
    }).join('');
  }
  ri.innerHTML=html;
}

async function lancer(){
  if(!educs.length||!plages.length){verifier();return;}
  const mois=document.getElementById('gen-mois').value;
  if(!mois){alert('Choisissez un mois.');return;}
  const btn=document.getElementById('gen-btn');
  btn.disabled=true;btn.innerHTML='<div class="spin"></div> Génération...';
  document.getElementById('gen-prog').style.display='block';
  document.getElementById('gen-alerts').innerHTML='';
  const log=document.getElementById('gen-log');log.innerHTML='';
  const L=(m,p)=>{log.innerHTML+=m+'<br>';log.scrollTop=log.scrollHeight;if(p!=null)document.getElementById('gen-bar').style.width=p+'%';};
  try{
    detecterImpossibilites(mois).slice(0,8).forEach(m=>L('⚠ '+m,null));
    const r=await genMois(mois,L);
    window._lastDiagnostic=r.diagnostic||[];
    horaire[mois]=r.planning; currentMonth=mois; save();

    const audit=auditLegal(r.planning,mois);
    const trous=r.warnings.filter(w=>w.includes('non couvert')).length;
    const pct=x=>Math.round(x*100);
    L(`Charge : ${r.charge.demande.toFixed(0)}h à couvrir (minimum) pour ${r.charge.capacite.toFixed(0)}h à prester par l'équipe`,null);
    if(r.charge.demande>r.charge.capacite*1.03) L('⚠ Les minimums demandent plus d\'heures que l\'équipe n\'en doit : soldes positifs inévitables.',null);
    L(`Récurrence semaine/semaine : ${pct(r.recurrence)}% · WE coupés : ${r.coupes} · Ajustements : ${r.ajustements}`,null);
    L(audit.length?`❌ ${audit.length} infraction(s) légale(s) détectée(s)`:'✅ Audit légal : aucune infraction',null);
    audit.slice(0,6).forEach(a=>L(`❌ ${a.ds} ${a.educ} : ${a.msg}`,null));
    r.bilan.slice().sort((a,b)=>Math.abs(b.cumul)-Math.abs(a.cumul)).slice(0,4).forEach(b=>
      L(`${b.nom} : mois ${b.mois>=0?'+':''}${b.mois.toFixed(1)}h, cumul ${b.cumul>=0?'+':''}${b.cumul.toFixed(1)}h`,null));
    r.warnings.slice(0,6).forEach(w=>L('! '+w,null));
    L('Terminé !',100);
    const maxDev=Math.max(0,...r.bilan.map(b=>Math.abs(b.mois)));
    const ok=!audit.length&&!trous;
    showAlert('gen-alerts',ok?'ok':'warn',
      `Horaire généré — ${audit.length?audit.length+' infraction(s) légale(s)':'légal'} · ${trous?trous+' poste(s) non couvert(s)':'tout couvert'} · écart heures max ${maxDev.toFixed(1)}h · récurrence ${pct(r.recurrence)}%`);
  }catch(err){
    console.error(err); L('❌ Erreur : '+err.message,null);
    showAlert('gen-alerts','err','Erreur pendant la génération : '+err.message);
  }
  btn.disabled=false;btn.innerHTML="⚡ Générer l'horaire";
  updateMonthLabels();
}
