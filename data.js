// ============================================================
// data.js - État global, constantes, sauvegarde/chargement
// ============================================================

let educs       = [];
let plages      = [];
let reglesL     = defaultLegal();
let reglesI     = defaultInternal();
let reglesC     = [];
let horaire     = {};
let absences    = [];
let joursFeries = [];
let currentMonth = new Date().toISOString().slice(0,7);
let cellCtx     = {};

const JOURS     = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const CONTRAT_H = {'temps-plein':38,'4/5':30.4,'3/4':28.5,'mi-temps':19,'perso':null};
const COLORS    = ['#2a5fc8','#1a7a4a','#c8622a','#7a3fc8','#c02a2a','#d4800a','#1a7a8a','#6a8a1a','#8a2a6a','#3a6a8a'];

function defaultLegal(){return[
  {id:'l1',nom:'Repos minimum entre 2 prestations',desc:"Repos obligatoire entre la fin et le debut d'une prestation",type:'min_repos',value:11,unit:'heures',active:true},
  {id:'l2',nom:'Max jours consecutifs',desc:"Nombre maximum de jours de travail d'affilee",type:'max_consec',value:6,unit:'jours',active:true},
  {id:'l3',nom:'Max heures par semaine',desc:"Plafond d'heures sur la semaine lundi-dimanche",type:'max_h_semaine',value:50,unit:'heures',active:true},
  {id:'l4',nom:'Max nuits consecutives',desc:"Nuits de travail d'affilee maximum",type:'max_nuits_consec',value:5,unit:'nuits',active:true},
  {id:'l5',nom:'Repos hebdo minimum',desc:'Jours de repos minimum par semaine',type:'min_repos_semaine',value:2,unit:'jours',active:true},
];}

function defaultInternal(){return[
  {id:'i1',nom:'Max week-ends travailles par mois',desc:"Pour l'equite entre educateurs",type:'max_we_mois',value:2,unit:'WE',active:true},
  {id:'i2',nom:'Repos apres nuit (jours)',desc:"Jours obligatoires de repos apres une nuit",type:'repos_apres_nuit',value:1,unit:'jours',active:true},
  {id:'i3',nom:"Tolerance solde heures (+-h / 3 mois)",desc:"Ecart max acceptable sur la periode d'equite",type:'tol_heures',value:15,unit:'heures',active:true},
];}

function dayStr(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function moisKey(yr,mo){
  const d = new Date(yr, mo-1, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function moisKeyDelta(moisStr, delta){
  const [y,m] = moisStr.split('-').map(Number);
  return moisKey(y, m + delta);
}
function getDays(y,m){
  const d=new Date(y,m-1,1), r=[];
  while(d.getMonth()===m-1){r.push(new Date(d));d.setDate(d.getDate()+1);}
  return r;
}
function monthLabel(s){
  const [y,m] = s.split('-').map(Number);
  const l = new Date(y,m-1,1).toLocaleDateString('fr-BE',{month:'long',year:'numeric'});
  return l.charAt(0).toUpperCase()+l.slice(1);
}
function getTargetH(e){
  return e.contrat==='perso' ? (e.heuresPerso||38) : (CONTRAT_H[e.contrat]||38);
}
function getRule(type, def){
  const all=[...reglesL,...reglesI,...reglesC].filter(r=>r.active);
  const r=all.find(x=>x.type===type);
  return r ? +r.value : def;
}
function sl(ms){ return new Promise(r=>setTimeout(r,ms)); }

function isAbsent(educId, ds){
  return absences.some(a => a.educId===educId && ds>=a.debut && ds<=a.fin);
}
function isFerie(ds){
  return joursFeries.some(f => f.date===ds && f.active);
}

function save(){
  try{
    localStorage.setItem('planeduc_v3_config', JSON.stringify({educs,plages,reglesL,reglesI,reglesC,absences,joursFeries}));
    const moisList = Object.keys(horaire);
    localStorage.setItem('planeduc_v3_mois', JSON.stringify(moisList));
    moisList.forEach(mois=>{
      try{ localStorage.setItem('planeduc_v3_h_'+mois, JSON.stringify(horaire[mois])); }
      catch(e){ console.warn('Impossible de sauvegarder',mois,e); }
    });
  }catch(e){ console.error('Erreur sauvegarde:',e); }
}

function load(){
  try{
    const cfg = JSON.parse(localStorage.getItem('planeduc_v3_config')||'{}');
    if(cfg.educs)       educs       = cfg.educs;
    // Auto-assign color if missing (éducs créés avant cette feature)
    educs.forEach((e, i) => { if (!e.color) e.color = COLORS[i % COLORS.length]; });
    if(cfg.plages)      plages      = cfg.plages;
    if(cfg.reglesL)     reglesL     = cfg.reglesL;
    if(cfg.reglesI)     reglesI     = cfg.reglesI;
    if(cfg.reglesC)     reglesC     = cfg.reglesC;
    if(cfg.absences)    absences    = cfg.absences;
    if(cfg.joursFeries) joursFeries = cfg.joursFeries;

    horaire = {};
    const moisList = JSON.parse(localStorage.getItem('planeduc_v3_mois')||'[]');
    moisList.forEach(mois=>{
      try{
        const data = localStorage.getItem('planeduc_v3_h_'+mois);
        if(data) horaire[mois] = JSON.parse(data);
      }catch(e){ console.warn('Impossible de charger',mois,e); }
    });

    const old = JSON.parse(localStorage.getItem('planeduc_v3')||'{}');
    if(old.horaire && Object.keys(horaire).length===0){
      horaire = old.horaire;
      save();
    }

    // Module 2 — charger les verrous WE auto si l'API est disponible
    if(typeof loadWeAutoLocks === 'function') loadWeAutoLocks();

    console.log('Charge:',Object.keys(horaire).length,'mois:', Object.keys(horaire).join(', '));
  }catch(e){ console.error('Erreur chargement:',e); }
}

function resetAll(){
  if(!confirm('Supprimer TOUTES les donnees ?\nCette action est irreversible.')) return;
  ['planeduc_v3_config','planeduc_v3_mois'].forEach(k=>localStorage.removeItem(k));
  Object.keys(localStorage).filter(k=>k.startsWith('planeduc_v3_h_')).forEach(k=>localStorage.removeItem(k));
  localStorage.removeItem('planeduc_v3');
  location.reload();
}

// Clés de cache à vider systématiquement avec les horaires
const CACHE_KEYS = [
  'planeduc_v3_patterns',
  'planeduc_v3_annual',
  'planeduc_v3_webloc',
  'planeduc_v3_cycle',
  'planeduc_v3_weauto',   // Module 2 — verrous WE auto-gravés
  'planeduc_v3_nuitvend'  // Module 3 — pointeur cycle nuit vendredi
];

function resetHoraires(){
  if(!confirm('Supprimer TOUS les horaires générés et réinitialiser les caches ?\n(Les éducateurs, plages et règles sont conservés)')) return;
  // Horaires
  Object.keys(localStorage).filter(k=>k.startsWith('planeduc_v3_h_')).forEach(k=>localStorage.removeItem(k));
  localStorage.removeItem('planeduc_v3_mois');
  // Caches moteur
  CACHE_KEYS.forEach(k=>localStorage.removeItem(k));
  horaire = {};
  if(typeof weAutoLocks !== 'undefined') weAutoLocks = {};
  save();
  alert('Horaires et caches réinitialisés avec succès.');
  location.reload();
}

function exportData(){
  const blob = new Blob([JSON.stringify({educs,plages,reglesL,reglesI,reglesC,horaire,absences,joursFeries},null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `planeduc_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function importData(e){
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try{
      const d = JSON.parse(ev.target.result);
      if(d.educs)       educs       = d.educs;
      if(d.plages)      plages      = d.plages;
      if(d.reglesL)     reglesL     = d.reglesL;
      if(d.reglesI)     reglesI     = d.reglesI;
      if(d.reglesC)     reglesC     = d.reglesC;
      if(d.horaire)     horaire     = d.horaire;
      if(d.absences)    absences    = d.absences;
      if(d.joursFeries) joursFeries = d.joursFeries;
      save(); renderAll(); renderRules(); renderFeries();
      alert('Importe avec succes !');
    }catch(err){ alert('Fichier invalide.'); }
  };
  r.readAsText(f);
  e.target.value = '';
}
