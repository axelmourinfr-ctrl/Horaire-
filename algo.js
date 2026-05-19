// ============================================================
// algo.js - PlanEduc Pro - Moteur v13
// ============================================================
// PHILOSOPHIE : Horaire humain, stable, institutionnel
//
// Le moteur fonctionne comme un chef éducateur expérimenté :
// - il conserve les habitudes existantes
// - il ne change que ce qui doit changer
// - il fait tourner uniquement le pénible (nuits, WE, fériés)
// - il compense progressivement, jamais brutalement
//
// HIERARCHIE ABSOLUE :
//  P1 - LOI           : repos 11h, 50h/sem, max consec, nuits consec
//  P2 - EQUITE HEURES : ±15h/mois dur, 0 trimestriel
//  P3 - STABILITE     : patterns, habitudes, semaines répétitives
//  P4 - ROTATION DOUCE: nuits/WE/fériés tournent progressivement
//  P5 - PREFERENCES   : demandes éducs
//  P6 - MAXIMUM       : remplir si solde négatif
//
// 3 ETAPES :
//  1. Construction stable (patterns + habitudes)
//  2. Analyse équité
//  3. Micro-ajustements ciblés (swaps nuits/WE seulement)
// ============================================================

const DEBUG_MODE = false;

// ── Helpers de base ──
const isNuitP  = p => p.type==='nuit'||p.debut>='22:00'||(p.fin<='07:00'&&p.fin>'00:00');
const isReunion= p => p.type==='reunion'||(p.nom||'').toLowerCase().includes('reunion')||(p.nom||'').toLowerCase().includes('réunion');
const isWEDay  = d => d.getDay()===0||d.getDay()===6;
const dowIdx   = d => d.getDay()===0?6:d.getDay()-1;
const ratioE   = e => getTargetH(e)/38;
const dbg      = (...a)=>{if(DEBUG_MODE)console.log('[v13]',...a);};

const POIDS = {reunion:0.05, matin:1.0, aprem:1.0, soir:1.2, nuit:2.0, journee:1.0};

function dureeH(p){
  if(p.dureeH&&p.dureeH>0) return p.dureeH;
  const [dh,dm]=p.debut.split(':').map(Number);
  const [fh,fm]=p.fin.split(':').map(Number);
  let h=(fh*60+fm)-(dh*60+dm); if(h<=0)h+=1440;
  // Réunion : plafond 8h (évite les durées aberrantes ex: 13:30→12:00 = 22.5h)
  if(isReunion(p)) return Math.min(h/60, 8);
  return h/60;
}
function typePlage(p){
  if(isReunion(p)) return 'reunion'; if(isNuitP(p)) return 'nuit';
  const h=parseInt(p.debut); if(h<10)return 'matin'; if(h<14)return 'aprem'; return 'soir';
}
function joursOuvMois(yr,mo){
  return getDays(yr,mo).filter(d=>{const dw=d.getDay();return dw>=1&&dw<=5&&!isFerie(dayStr(d));}).length;
}
function moy(arr,fn){ return arr.reduce((s,x)=>s+fn(x),0)/Math.max(1,arr.length); }
function moyPond(arr,fn){ return arr.reduce((s,x)=>s+fn(x)/Math.max(0.01,ratioE(x)),0)/Math.max(1,arr.length); }
function norm(val,e){ return val/Math.max(0.01,ratioE(e)); }

let _pm=null,_em=null;
function plageById(id){if(!_pm||_pm.size!==plages.length)_pm=new Map(plages.map(p=>[p.id,p]));return _pm.get(+id);}
function educById(id){if(!_em||_em.size!==educs.length)_em=new Map(educs.map(e=>[e.id,e]));return _em.get(+id);}

// ================================================================
// MODULE 0 — Classification des groupes d'équité
// ================================================================
// Chaque combinaison plage × jour appartient à un groupe G1..G7.
// Le groupe pilote quelle logique d'équité/rotation s'applique.
// L'utilisateur peut forcer le groupe via plage.groupe (dropdown UI).
// Si plage.groupe === 'auto' ou absent, on détecte automatiquement.
//
// G1 — Lever / Ouverture semaine  (matin, lun→ven hors férié)
// G2 — Fin de journée semaine     (aprem/soir, lun→ven hors férié)
// G3 — Nuit tournante stricte     (par défaut : vendredi nuit ; override possible)
// G4 — Nuit semaine               (lun→jeu nuit, hors vendredi)
// G5 — Journée WE / Férié         (non-nuit, sam+dim ou férié)
// G6 — Nuit WE / Férié            (nuit, sam+dim ou férié)
// G7 — Réunion / Administratif    (détecté par type='reunion' ou nom)
//
// NOTE : l'équité des jours fériés (comptage annuel) est une couche
// transversale gérée par estJourFerieEquite() — ce n'est PAS un groupe
// d'assignation, c'est un compteur parallèle dans l'historique.
// ================================================================

const GROUPE_LABELS = {
  G1: 'Lever / Ouverture semaine',
  G2: 'Fin de journée semaine',
  G3: 'Nuit tournante stricte',
  G4: 'Nuit semaine lun→jeu',
  G5: 'Journée WE / Jours fériés',
  G6: 'Nuit WE / Jours fériés',
  G7: 'Réunion / Administratif',
};

/**
 * Retourne le groupe d'équité d'une combinaison plage × jour.
 *
 * @param {Object}  plage  - Objet plage (champs : .groupe, .type, .nom, .debut, .fin)
 * @param {number}  dow    - Jour semaine PlanEduc (0=Lun … 6=Dim)
 * @param {boolean} ferie  - true si le jour est un jour férié actif
 * @returns {string|null}  - 'G1'..'G7', ou null (réunion annulée sur férié)
 */
function groupePlageJour(plage, dow, ferie) {
  // 1) Override explicite, sinon détection auto
  const grp = (plage.groupe && plage.groupe !== 'auto')
    ? plage.groupe
    : _groupeAuto(plage, dow, ferie);

  // 2) Règle absolue : G7 (réunion / admin) toujours annulé sur férié,
  //    peu importe que ce soit auto-détecté ou tagué manuellement.
  if (grp === 'G7' && ferie) return null;

  return grp;
}

function _groupeAuto(plage, dow, ferie) {
  // Réunion (type ou nom) → G7, quel que soit le jour
  // (le filtre férié est appliqué en aval par groupePlageJour)
  if (isReunion(plage)) return 'G7';

  // Jour férié ou WE (sam=5, dim=6) → traitement WE
  if (ferie || dow >= 5) {
    return isNuitP(plage) ? 'G6' : 'G5';
  }

  // Semaine (lun=0 … ven=4), hors férié
  if (isNuitP(plage)) {
    // Vendredi nuit = tournante stricte par défaut
    // (les autres foyers peuvent override via plage.groupe = 'G3')
    return dow === 4 ? 'G3' : 'G4';
  }

  // Non-nuit, semaine : matin ou fin de journée
  const heureDebut = parseInt(plage.debut, 10);
  return heureDebut < 11 ? 'G1' : 'G2';
}

/**
 * Indique si ce slot doit incrémenter le compteur d'équité jours fériés (G8).
 * C'est vrai pour toute prestation réelle (non-réunion) un jour férié.
 * Ce compteur est annuel et transversal aux groupes G5/G6.
 */
function estJourFerieEquite(plage, ferie) {
  return ferie && !isReunion(plage);
}

/**
 * Retourne les plages actives d'un groupe pour un jour donné.
 * Utile pour les Modules 2, 3, 4 qui itèrent par groupe.
 */
function plagesDuGroupe(groupe, dow, ferie) {
  return plages.filter(p =>
    (p.jours || []).includes(dow) &&
    groupePlageJour(p, dow, ferie) === groupe
  );
}

/**
 * Vérifie si une plage doit être pourvue un jour donné.
 * Sur férié non-WE, on remappe le jour vers Sam (5) — comme le moteur v13 fait
 * dans horaire.js : un lundi férié devient "comme un samedi", donc seules
 * les plages dont .jours inclut 5 ou 6 s'appliquent (journée WE, nuit).
 *
 * Le matin et le soir de semaine (jours=[0,1,2,3] ou [4]) ne s'appliquent PAS
 * sur un férié non-WE. C'est cette logique-là.
 */
function plageApplicable(plage, dow, ferie) {
  const dowCheck = (ferie && dow < 5) ? 5 : dow;
  return (plage.jours || []).includes(dowCheck);
}

/**
 * Console debug : affiche le tableau groupe × plage × jour pour vérification visuelle.
 * Usage : ouvrir la console navigateur et taper  debugGroupes()
 */
function debugGroupes() {
  if (!plages.length) { console.warn('Aucune plage définie.'); return; }
  const rows = [];
  plages.forEach(p => {
    for (let dow = 0; dow <= 6; dow++) {
      if (!(p.jours || []).includes(dow)) continue;
      rows.push({
        Plage       : p.nom,
        Jour        : JOURS[dow],
        Groupe_normal: groupePlageJour(p, dow, false) || '—',
        Groupe_ferie : groupePlageJour(p, dow, true)  || '(annulé)',
        Override     : (p.groupe && p.groupe !== 'auto') ? p.groupe : '(auto)',
      });
    }
  });
  console.table(rows);
}

// ================================================================
// MODULE 1 — Historique & quotas par groupe
// ================================================================
// Module 1 COMPTE et CALCULE. Il ne génère rien.
// Il fournit la matière première aux Modules 2, 3, 4 :
//   - historique par groupe G1..G7 sur N mois passés (par défaut 3)
//   - compteur G8 = jours fériés travaillés sur l'année calendaire en cours
//   - quotas-cibles pour le mois à générer (slots à répartir équitablement)
//
// Lecture : on parcourt horaire[mois] sur la fenêtre historique, on reclassifie
// chaque assignation via groupePlageJour() (Module 0), on cumule par groupe.
// ================================================================

const GROUPES_TOUS = ['G1','G2','G3','G4','G5','G6','G7'];

/**
 * Compte par groupe combien de slots chaque éduc a fait sur l'historique.
 *
 * @param {string} moisStr  - Mois cible à générer (ex: '2026-06')
 * @param {number} horizon  - Nb de mois passés à scanner pour G1..G7 (défaut 3)
 * @returns {Object}        - { educId: {G1..G7, G8, _hTotal, _slotsTotal} }
 *                            G8 = jours fériés travaillés sur l'année courante
 */
function buildHistoriqueParGroupe(moisStr, horizon) {
  horizon = horizon || 3;
  const [yr, mo] = moisStr.split('-').map(Number);
  const anneeCible = yr;

  const hist = {};
  educs.forEach(e => {
    hist[e.id] = {
      G1:0, G2:0, G3:0, G4:0, G5:0, G6:0, G7:0,
      G8: 0,           // jours fériés travaillés cette année
      _hTotal: 0,      // total heures sur l'horizon
      _slotsTotal: 0,  // total slots sur l'horizon
    };
  });

  // 1) Scan des N mois précédents (G1..G7 + G8 si même année)
  for (let i = 1; i <= horizon; i++) {
    const key = moisKey(yr, mo - i);
    const plan = horaire[key];
    if (!plan) continue;

    const [ky, km] = key.split('-').map(Number);
    const sameYear = (ky === anneeCible);

    getDays(ky, km).forEach(d => {
      const ds = dayStr(d);
      const dow = dowIdx(d);
      const ferie = isFerie(ds);
      const educsCeJourFerie = new Set();

      Object.entries(plan[ds] || {}).forEach(([pid, ids]) => {
        if (pid.startsWith('_') || !Array.isArray(ids)) return;
        const p = plageById(+pid); if (!p) return;
        const grp = groupePlageJour(p, dow, ferie);
        if (!grp) return; // réunion annulée sur férié
        const h = dureeH(p);

        ids.forEach(eid => {
          const id = +eid;
          if (!hist[id]) return;
          hist[id][grp]++;
          hist[id]._hTotal += h;
          hist[id]._slotsTotal++;
          if (ferie && !isReunion(p)) educsCeJourFerie.add(id);
        });
      });

      // G8 : 1 jour férié travaillé = +1, et UNIQUEMENT si même année calendaire
      if (ferie && sameYear) {
        educsCeJourFerie.forEach(id => { if (hist[id]) hist[id].G8++; });
      }
    });
  }

  // 2) G8 supplémentaire : mois de l'année cible NON couverts par l'horizon
  //    (équité fériés annuelle, pas glissante sur N mois)
  for (let m = 1; m < mo - horizon; m++) {
    const key = moisKey(anneeCible, m);
    const plan = horaire[key]; if (!plan) continue;
    const [ky, km] = key.split('-').map(Number);

    getDays(ky, km).forEach(d => {
      const ds = dayStr(d);
      if (!isFerie(ds)) return;
      const educsCeJour = new Set();
      Object.entries(plan[ds] || {}).forEach(([pid, ids]) => {
        if (pid.startsWith('_') || !Array.isArray(ids)) return;
        const p = plageById(+pid); if (!p || isReunion(p)) return;
        ids.forEach(eid => educsCeJour.add(+eid));
      });
      educsCeJour.forEach(id => { if (hist[id]) hist[id].G8++; });
    });
  }

  return hist;
}

/**
 * Poids relatif d'un éduc pour un groupe sur un mois donné.
 * Combine : ratio contrat × (slots accessibles / slots totaux du groupe).
 * Un éduc qui ne bosse pas le vendredi a poids 0 sur G3.
 */
function poidsEducPourGroupe(educ, groupe, moisStr) {
  const [yr, mo] = moisStr.split('-').map(Number);
  let slotsTotaux = 0, slotsAccessibles = 0;

  getDays(yr, mo).forEach(d => {
    const dow = dowIdx(d);
    const ferie = isFerie(dayStr(d));
    plages.forEach(p => {
      if (!plageApplicable(p, dow, ferie)) return;
      if (groupePlageJour(p, dow, ferie) !== groupe) return;
      const mn = p.min || 1;
      slotsTotaux += mn;
      if (!(educ.jours || []).includes(dow)) return;
      if ((educ.excls || []).includes(p.id)) return;
      slotsAccessibles += mn;
    });
  });

  if (slotsTotaux === 0) return 0;
  return (slotsAccessibles / slotsTotaux) * ratioE(educ);
}

/**
 * Calcule les quotas-cibles par éduc × groupe pour le mois à générer.
 *
 * Logique :
 *   - G1, G2, G3, G4, G5, G6 : répartition proportionnelle au poids,
 *     + petit rattrapage doux basé sur l'historique (25% de l'écart).
 *   - G7 (réunion) : "tous présents" → quota = nb de réunions accessibles à l'éduc.
 *   - G8 (équité fériés annuelle) : rattrapage à 30% (un peu plus fort
 *     car la fenêtre est annuelle, plus longue à rééquilibrer).
 *
 * @param {Object} hist     - Sortie de buildHistoriqueParGroupe
 * @param {string} moisStr  - Mois à générer
 * @returns {Object}        - { educId: {G1..G7, G8} } (valeurs en float)
 */
function calculerQuotasParGroupe(hist, moisStr) {
  const quotas = {};
  educs.forEach(e => {
    quotas[e.id] = {G1:0, G2:0, G3:0, G4:0, G5:0, G6:0, G7:0, G8:0};
  });

  const [yr, mo] = moisStr.split('-').map(Number);
  const jours = getDays(yr, mo);

  // ── Total slots à pourvoir ce mois, par groupe ──
  const slotsMois = {G1:0, G2:0, G3:0, G4:0, G5:0, G6:0, G7:0};
  jours.forEach(d => {
    const dow = dowIdx(d);
    const ferie = isFerie(dayStr(d));
    plages.forEach(p => {
      if (!plageApplicable(p, dow, ferie)) return;
      const grp = groupePlageJour(p, dow, ferie);
      if (!grp) return;
      if (grp === 'G7') slotsMois[grp] += 1;       // 1 occurrence par réunion
      else              slotsMois[grp] += (p.min || 1);
    });
  });

  // ── G1, G2, G3, G4, G5, G6 : proportionnel + rattrapage 25% ──
  ['G1','G2','G3','G4','G5','G6'].forEach(grp => {
    const totalSlots = slotsMois[grp];
    if (totalSlots === 0) return;

    const poids = {};
    let sumPoids = 0;
    educs.forEach(e => {
      poids[e.id] = poidsEducPourGroupe(e, grp, moisStr);
      sumPoids += poids[e.id];
    });
    if (sumPoids === 0) return;

    // Part équitable de base
    educs.forEach(e => {
      quotas[e.id][grp] = totalSlots * (poids[e.id] / sumPoids);
    });

    // Rattrapage historique doux (25%)
    const histRempli = educs.some(e => hist[e.id][grp] > 0);
    if (histRempli) {
      // Moyenne pondérée du groupe sur l'historique (normalisée par ratio)
      const moyenneNorm = educs.reduce((s,e) =>
        s + (hist[e.id][grp] / Math.max(0.01, ratioE(e))), 0) / educs.length;
      educs.forEach(e => {
        const expected = moyenneNorm * ratioE(e);
        const actual   = hist[e.id][grp];
        const ecart    = expected - actual;
        quotas[e.id][grp] += ecart * 0.25;
        if (quotas[e.id][grp] < 0) quotas[e.id][grp] = 0;
      });
    }
  });

  // ── G7 (réunion) : tous présents → quota = nb réunions où l'éduc est dispo ──
  educs.forEach(e => {
    let count = 0;
    jours.forEach(d => {
      const dow = dowIdx(d);
      const ferie = isFerie(dayStr(d));
      plages.forEach(p => {
        if (!plageApplicable(p, dow, ferie)) return;
        if (groupePlageJour(p, dow, ferie) !== 'G7') return;
        if (!(e.jours || []).includes(dow)) return;
        if ((e.excls || []).includes(p.id)) return;
        count++;
      });
    });
    quotas[e.id].G7 = count;
  });

  // ── G8 (équité fériés annuelle) : part équitable + rattrapage 30% ──
  const feriesMois = jours.filter(d => isFerie(dayStr(d))).length;
  if (feriesMois > 0) {
    const sumRatios = educs.reduce((s,x) => s + ratioE(x), 0);
    const moyenneNormG8 = educs.reduce((s,e) =>
      s + (hist[e.id].G8 / Math.max(0.01, ratioE(e))), 0) / educs.length;
    educs.forEach(e => {
      const partBrute = feriesMois * (ratioE(e) / Math.max(0.01, sumRatios));
      const expected  = moyenneNormG8 * ratioE(e);
      const actual    = hist[e.id].G8;
      const ecart     = expected - actual;
      quotas[e.id].G8 = Math.max(0, partBrute + ecart * 0.30);
    });
  }

  return quotas;
}

/**
 * DEBUG : affiche dans la console l'historique + quotas pour un mois.
 * Usage : debugQuotas()              → mois courant
 *         debugQuotas('2026-06')     → mois précis
 */
function debugQuotas(moisStr) {
  moisStr = moisStr || currentMonth;
  if (!educs.length || !plages.length) {
    console.warn('Configurez éducateurs et plages avant de debugger.');
    return;
  }
  const hist = buildHistoriqueParGroupe(moisStr, 3);
  const quotas = calculerQuotasParGroupe(hist, moisStr);

  console.log('═'.repeat(70));
  console.log(`Module 1 — Historique & quotas pour ${moisStr}`);
  console.log('═'.repeat(70));

  const rows = educs.map(e => {
    const h = hist[e.id], q = quotas[e.id];
    const fmt = (hv, qv) => `${hv} → ${qv.toFixed(1)}`;
    return {
      Éduc    : `${e.prenom} ${e.nom}`,
      Contrat : e.contrat,
      'Heures hist': h._hTotal.toFixed(0)+'h',
      G1      : fmt(h.G1, q.G1),
      G2      : fmt(h.G2, q.G2),
      G3      : fmt(h.G3, q.G3),
      G4      : fmt(h.G4, q.G4),
      G5      : fmt(h.G5, q.G5),
      G6      : fmt(h.G6, q.G6),
      G7      : fmt(h.G7, q.G7),
      'G8 fériés': fmt(h.G8, q.G8),
    };
  });
  console.table(rows);

  // Vérification : somme des quotas par groupe ≈ slots à pourvoir
  const sumQuotas = {};
  ['G1','G2','G3','G4','G5','G6','G7','G8'].forEach(g => {
    sumQuotas[g] = educs.reduce((s,e) => s + quotas[e.id][g], 0).toFixed(1);
  });
  console.log('Somme quotas par groupe :', sumQuotas);
  console.log('(Hist X → Quota Y) : X = slots faits sur 3 mois passés, Y = cible pour ce mois');
  return {hist, quotas};
}

// ================================================================
// MODULE 2 — Tournante WE en blocs sam+dim gravés
// ================================================================
// Pour chaque week-end du mois (sam+dim), Module 2 choisit AVANT le moteur :
//   - une équipe G5 (journée) : MÊMES éducs sam ET dim
//   - un éduc  G6 (nuit)      : MÊME personne sam ET dim
//
// Les choix sont gravés via `_lock_${pid}='locked'` (mécanisme v13 existant) ;
// genMois les respecte automatiquement via getLockedSlots().
//
// Le tracking auto vs manuel se fait dans weAutoLocks (séparé) pour que
// l'UI puisse afficher un cadenas bleu spécifique aux verrous Module 2.
//
// Critère de choix : équité inter-mois.
//   score = (blocs_historique + blocs_ce_mois) / ratio_contrat
//   tri ascendant → l'éduc avec le score le plus bas prend le WE
//   tiebreak : date du dernier WE travaillé (le plus ancien d'abord)
//
// Soft cap : on essaie 2 WE max / mois (TP visent 1 WE sur 2),
// mais dépassable si tout le monde est déjà à 2 (mois à 5 WE, absences…).
// ================================================================

// État séparé : { mois: { ds: [pid, pid, ...] } } — slots gravés par Module 2
let weAutoLocks = {};

function loadWeAutoLocks() {
  try { weAutoLocks = JSON.parse(localStorage.getItem('planeduc_v3_weauto') || '{}'); }
  catch(e) { weAutoLocks = {}; }
}
function saveWeAutoLocks() {
  try { localStorage.setItem('planeduc_v3_weauto', JSON.stringify(weAutoLocks)); }
  catch(e) {}
}
function isAutoLockWE(moisStr, ds, plageId) {
  return !!(weAutoLocks[moisStr] && weAutoLocks[moisStr][ds] && weAutoLocks[moisStr][ds].includes(+plageId));
}

/**
 * Compte les BLOCS WE (sam+dim ensemble) déjà effectués par chaque éduc
 * sur l'historique. Un bloc = éduc présent sam ET dim sur la même plage WE.
 *
 * @returns { educId: { journee, nuit, dernierWE } }
 */
function buildHistoriqueWE(moisStr, horizon) {
  horizon = horizon || 6;
  const [yr, mo] = moisStr.split('-').map(Number);
  const hist = {};
  educs.forEach(e => { hist[e.id] = { journee: 0, nuit: 0, dernierWE: null }; });

  for (let i = 1; i <= horizon; i++) {
    const key = moisKey(yr, mo - i);
    const plan = horaire[key]; if (!plan) continue;
    const [ky, km] = key.split('-').map(Number);

    // Repérer les samedis de ce mois
    getDays(ky, km).forEach(sam => {
      if (sam.getDay() !== 6) return; // 6 = samedi (JS)
      const dim = new Date(sam); dim.setDate(dim.getDate() + 1);
      const dsSam = dayStr(sam);
      const dsDim = dayStr(dim);

      // Collecter les éducs par groupe WE le sam et le dim
      const samJ = new Set(), samN = new Set();
      const dimJ = new Set(), dimN = new Set();
      const collect = (plan, ds, dow, setJ, setN) => {
        Object.entries(plan[ds] || {}).forEach(([pid, ids]) => {
          if (pid.startsWith('_') || !Array.isArray(ids)) return;
          const p = plageById(+pid); if (!p) return;
          const grp = groupePlageJour(p, dow, isFerie(ds));
          if (grp === 'G5') ids.forEach(id => setJ.add(+id));
          else if (grp === 'G6') ids.forEach(id => setN.add(+id));
        });
      };
      collect(plan, dsSam, 5, samJ, samN);
      // Le dim peut être dans le mois suivant
      const planDim = (dim.getMonth() === sam.getMonth()) ? plan : horaire[moisKey(dim.getFullYear(), dim.getMonth()+1)];
      if (planDim) collect(planDim, dsDim, 6, dimJ, dimN);

      // Intersection : éduc présent sam ET dim sur le même groupe = bloc complet
      samJ.forEach(id => {
        if (dimJ.has(id) && hist[id]) {
          hist[id].journee++;
          if (!hist[id].dernierWE || dsSam > hist[id].dernierWE) hist[id].dernierWE = dsSam;
        }
      });
      samN.forEach(id => {
        if (dimN.has(id) && hist[id]) {
          hist[id].nuit++;
          if (!hist[id].dernierWE || dsSam > hist[id].dernierWE) hist[id].dernierWE = dsSam;
        }
      });
    });
  }

  return hist;
}

/**
 * Retourne les paires sam+dim qui touchent le mois.
 * - Cas normal : sam et dim dans le mois
 * - Cas "dim au 1er du mois" : sam est dans le mois précédent
 * - Cas "sam au dernier jour" : dim est dans le mois suivant
 *
 * Chaque WE est { sam: Date, dim: Date, samDansMois, dimDansMois }
 */
function getWeekendsDuMois(moisStr) {
  const [yr, mo] = moisStr.split('-').map(Number);
  const jours = getDays(yr, mo);
  const WEs = [];

  // 1) Sam du 1er au dernier jour
  jours.forEach(d => {
    if (d.getDay() !== 6) return;
    const sam = new Date(d);
    const dim = new Date(d); dim.setDate(dim.getDate() + 1);
    WEs.push({
      sam, dim,
      samDansMois: true,
      dimDansMois: dim.getMonth() === sam.getMonth(),
    });
  });
  // 2) Si le mois commence un dim : ajouter le WE dont le sam est dans le mois précédent
  if (jours[0].getDay() === 0) {
    const dim = new Date(jours[0]);
    const sam = new Date(dim); sam.setDate(sam.getDate() - 1);
    WEs.unshift({ sam, dim, samDansMois: false, dimDansMois: true });
  }
  return WEs;
}

/**
 * Identifie la plage G5 (journée WE) et G6 (nuit WE) dans la config.
 * Une plage WE doit être applicable sam (jour 5) ET dim (jour 6).
 * Retourne { plageG5, plageG6 } ou null si non trouvées.
 */
function trouverPlagesWE() {
  let plageG5 = null, plageG6 = null;
  plages.forEach(p => {
    // Doit être applicable sam ET dim
    if (!(p.jours || []).includes(5) || !(p.jours || []).includes(6)) return;
    // On teste le sam (dow=5) hors férié pour identifier les plages
    const grp = groupePlageJour(p, 5, false);
    if (grp === 'G5' && !plageG5) plageG5 = p;
    if (grp === 'G6' && !plageG6) plageG6 = p;
  });
  return { plageG5, plageG6 };
}

/**
 * Planifie les blocs WE pour un mois SANS écrire dans horaire.
 * Retourne { ds: { plageId: [educIds] }, summary }
 *
 * @param {string} moisStr
 * @returns Plan + summary détaillé pour debug
 */
function planifierBlocsWE(moisStr) {
  const { plageG5, plageG6 } = trouverPlagesWE();
  if (!plageG5 && !plageG6) {
    return { plan: {}, summary: { error: 'Aucune plage WE détectée (G5/G6)' } };
  }

  const hist = buildHistoriqueWE(moisStr, 6);
  const WEs  = getWeekendsDuMois(moisStr);
  const plan = {};
  const summary = { weekends: [], plageG5: plageG5?.nom, plageG6: plageG6?.nom };

  // Trackers SÉPARÉS journée/nuit pour ce mois (en cours d'attribution)
  // Important : sans cette séparation, un éduc qui vient de faire journée
  // au WE1 apparaît encore "n'a jamais fait journée" au WE2 → sur-correction.
  const nbJ = {};  // blocs journée attribués ce mois
  const nbN = {};  // blocs nuit    attribués ce mois
  educs.forEach(e => { nbJ[e.id] = 0; nbN[e.id] = 0; });
  const nbTotal = id => nbJ[id] + nbN[id];

  WEs.forEach(we => {
    const dsSam = dayStr(we.sam);
    const dsDim = dayStr(we.dim);

    // ── Si le sam est dans le mois précédent et déjà assigné : on suit ──
    if (!we.samDansMois) {
      const moisPrec = moisKey(we.sam.getFullYear(), we.sam.getMonth() + 1);
      const planPrec = horaire[moisPrec]?.[dsSam] || {};
      const eqJournee = planPrec[plageG5?.id];
      const eqNuit    = planPrec[plageG6?.id];
      if (eqJournee || eqNuit) {
        if (we.dimDansMois && eqJournee) {
          plan[dsDim] = plan[dsDim] || {};
          plan[dsDim][plageG5.id] = [...eqJournee];
        }
        if (we.dimDansMois && eqNuit) {
          plan[dsDim] = plan[dsDim] || {};
          plan[dsDim][plageG6.id] = [...eqNuit];
        }
        summary.weekends.push({
          dsSam, dsDim, type: 'carryover_from_prev',
          journee: eqJournee, nuit: eqNuit,
        });
        return;
      }
    }

    // ── Disponibilités sam+dim ──
    const dispoJournee = plageG5 ? educs.filter(e => {
      if (!(e.jours || []).includes(5) || !(e.jours || []).includes(6)) return false;
      if (isAbsent(e.id, dsSam) || isAbsent(e.id, dsDim)) return false;
      if ((e.excls || []).includes(plageG5.id)) return false;
      return true;
    }) : [];

    const dispoNuit = plageG6 ? educs.filter(e => {
      if (!(e.jours || []).includes(5) || !(e.jours || []).includes(6)) return false;
      if (isAbsent(e.id, dsSam) || isAbsent(e.id, dsDim)) return false;
      if ((e.excls || []).includes(plageG6.id)) return false;
      return true;
    }) : [];

    // Score normalisé : (total blocs hist + total blocs ce mois) / ratio
    // → un mi-temps (ratio 0.5) reçoit moitié moins de WE qu'un TP.
    // Tiebreak 1 : équité par sous-type (hist + ce mois).
    // Tiebreak 2 : moins de WE ce mois (étale dans le mois).
    // Tiebreak 3 : dernier WE le plus ancien.
    const trier = (liste, type) => [...liste].sort((a, b) => {
      const totA = hist[a.id].journee + hist[a.id].nuit + nbTotal(a.id);
      const totB = hist[b.id].journee + hist[b.id].nuit + nbTotal(b.id);
      const sa = totA / Math.max(0.01, ratioE(a));
      const sb = totB / Math.max(0.01, ratioE(b));
      if (Math.abs(sa - sb) > 0.01) return sa - sb;
      const moisA = type === 'journee' ? nbJ[a.id] : nbN[a.id];
      const moisB = type === 'journee' ? nbJ[b.id] : nbN[b.id];
      const ta = hist[a.id][type] + moisA;
      const tb = hist[b.id][type] + moisB;
      if (ta !== tb) return ta - tb;
      if (nbTotal(a.id) !== nbTotal(b.id)) return nbTotal(a.id) - nbTotal(b.id);
      const la = hist[a.id].dernierWE || '0000-00-00';
      const lb = hist[b.id].dernierWE || '0000-00-00';
      return la.localeCompare(lb);
    });

    const triesJournee = trier(dispoJournee, 'journee');
    const teamJournee  = triesJournee.slice(0, plageG5?.min || 2).map(e => e.id);

    // Pour la nuit, éviter de re-piocher dans la team journée si possible
    const triesNuit = trier(dispoNuit, 'nuit');
    const nuitHorsJournee = triesNuit.filter(e => !teamJournee.includes(e.id));
    const educNuit = nuitHorsJournee.length ? nuitHorsJournee[0].id : (triesNuit[0]?.id ?? null);

    // Écrire dans le plan
    if (we.samDansMois && plageG5 && teamJournee.length) {
      plan[dsSam] = plan[dsSam] || {};
      plan[dsSam][plageG5.id] = teamJournee;
    }
    if (we.dimDansMois && plageG5 && teamJournee.length) {
      plan[dsDim] = plan[dsDim] || {};
      plan[dsDim][plageG5.id] = teamJournee;
    }
    if (we.samDansMois && plageG6 && educNuit !== null) {
      plan[dsSam] = plan[dsSam] || {};
      plan[dsSam][plageG6.id] = [educNuit];
    }
    if (we.dimDansMois && plageG6 && educNuit !== null) {
      plan[dsDim] = plan[dsDim] || {};
      plan[dsDim][plageG6.id] = [educNuit];
    }

    // Incrémenter compteurs par type
    teamJournee.forEach(id => { nbJ[id] = (nbJ[id] || 0) + 1; });
    if (educNuit !== null) nbN[educNuit] = (nbN[educNuit] || 0) + 1;

    summary.weekends.push({
      dsSam, dsDim, type: 'planned',
      journee: teamJournee.map(id => educById(id)?.prenom),
      nuit: educNuit !== null ? educById(educNuit)?.prenom : null,
    });
  });

  summary.nbWEParEduc = {};
  educs.forEach(e => { summary.nbWEParEduc[e.prenom] = nbJ[e.id] + nbN[e.id]; });

  return { plan, summary };
}

/**
 * Écrit les blocs WE planifiés dans horaire[mois] avec verrous.
 * À appeler AVANT genMois() dans lancer().
 */
function genererBlocsWE(moisStr) {
  loadWeAutoLocks();
  const { plan, summary } = planifierBlocsWE(moisStr);
  if (summary.error) {
    console.warn('Module 2 :', summary.error);
    return { error: summary.error };
  }

  if (!horaire[moisStr]) horaire[moisStr] = {};
  weAutoLocks[moisStr] = {};

  Object.entries(plan).forEach(([ds, slots]) => {
    if (!horaire[moisStr][ds]) horaire[moisStr][ds] = {};
    weAutoLocks[moisStr][ds] = [];
    Object.entries(slots).forEach(([pid, ids]) => {
      horaire[moisStr][ds][pid] = ids;
      horaire[moisStr][ds]['_lock_' + pid] = 'locked';
      weAutoLocks[moisStr][ds].push(+pid);
    });
  });

  // Cas particulier : si le sam déborde du mois suivant, écrire aussi là-bas
  Object.entries(plan).forEach(([ds, slots]) => {
    const moisDeDs = ds.slice(0, 7);
    if (moisDeDs !== moisStr) {
      if (!horaire[moisDeDs]) horaire[moisDeDs] = {};
      if (!horaire[moisDeDs][ds]) horaire[moisDeDs][ds] = {};
      if (!weAutoLocks[moisDeDs]) weAutoLocks[moisDeDs] = {};
      weAutoLocks[moisDeDs][ds] = weAutoLocks[moisDeDs][ds] || [];
      Object.entries(slots).forEach(([pid, ids]) => {
        horaire[moisDeDs][ds][pid] = ids;
        horaire[moisDeDs][ds]['_lock_' + pid] = 'locked';
        if (!weAutoLocks[moisDeDs][ds].includes(+pid)) weAutoLocks[moisDeDs][ds].push(+pid);
      });
    }
  });

  saveWeAutoLocks();
  return { plan, summary };
}

/**
 * DEBUG : affiche les blocs WE prévus pour un mois.
 * Usage : debugBlocsWE() ou debugBlocsWE('2026-06')
 */
function debugBlocsWE(moisStr) {
  moisStr = moisStr || currentMonth;
  if (!educs.length || !plages.length) {
    console.warn('Configurez éducateurs et plages.'); return;
  }
  const { plan, summary } = planifierBlocsWE(moisStr);

  console.log('═'.repeat(70));
  console.log(`Module 2 — Blocs WE planifiés pour ${moisStr}`);
  console.log(`Plage journée : ${summary.plageG5 || 'aucune'} · Plage nuit : ${summary.plageG6 || 'aucune'}`);
  console.log('═'.repeat(70));

  if (!summary.weekends || !summary.weekends.length) {
    console.warn('Aucun WE détecté.');
    return;
  }

  const rows = summary.weekends.map(w => ({
    'Sam'      : w.dsSam,
    'Dim'      : w.dsDim,
    'Type'     : w.type === 'carryover_from_prev' ? '↩ report mois préc.' : 'planifié',
    'Journée'  : Array.isArray(w.journee) ? w.journee.join(' + ') : (w.journee ? w.journee.join(',') : '—'),
    'Nuit'     : w.nuit || '—',
  }));
  console.table(rows);

  console.log('Nombre de WE par éduc ce mois-ci :', summary.nbWEParEduc);

  // Historique pour contextualiser
  const hist = buildHistoriqueWE(moisStr, 6);
  const histRows = educs.map(e => ({
    Éduc       : `${e.prenom} ${e.nom}`,
    Contrat    : e.contrat,
    'WE journée (6 mois)': hist[e.id].journee,
    'WE nuit (6 mois)'   : hist[e.id].nuit,
    'Dernier WE'         : hist[e.id].dernierWE || '—',
  }));
  console.log('Historique 6 mois :');
  console.table(histRows);
  return { plan, summary, hist };
}

/**
 * DEBUG : identifie les carences en personnel d'un mois généré.
 * Affiche par plage et par jour les postes non pourvus, et résume
 * les heures perdues globalement et par plage.
 *
 * Usage : debugCarence() ou debugCarence('2026-07')
 */
function debugCarence(moisStr) {
  moisStr = moisStr || currentMonth;
  const plan = horaire[moisStr];
  if (!plan) { console.warn('Pas d\'horaire généré pour', moisStr); return; }
  const [yr, mo] = moisStr.split('-').map(Number);
  const jours = getDays(yr, mo);
  const rows = [];
  let totalManquant = 0, totalHManquant = 0;
  const parPlage = {};
  const parEduc = {};
  educs.forEach(e => { parEduc[e.id] = { h: 0, slots: 0, prenom: e.prenom }; });

  // 1) Carences (postes non pourvus)
  jours.forEach(d => {
    const ds = dayStr(d);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
    const ferie = isFerie(ds);
    const we = d.getDay() === 0 || d.getDay() === 6;
    const dowCheck = (ferie && !we) ? 5 : dow;

    plages.forEach(p => {
      if (!p.jours.includes(dowCheck)) return;
      // Réunion sur férié = annulée
      if (isReunion(p) && ferie) return;
      const ids = (plan[ds] || {})[p.id] || [];
      const manque = (p.min || 1) - ids.length;
      if (manque > 0) {
        const hPerdu = manque * dureeH(p);
        rows.push({
          Date: ds,
          Jour: ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][dow] + (ferie ? ' 🎉' : ''),
          Plage: p.nom,
          Pourvu: ids.length,
          Requis: p.min,
          Manque: manque,
          'h perdues': hPerdu.toFixed(1) + 'h',
        });
        totalManquant += manque;
        totalHManquant += hPerdu;
        if (!parPlage[p.nom]) parPlage[p.nom] = { manque: 0, h: 0 };
        parPlage[p.nom].manque += manque;
        parPlage[p.nom].h += hPerdu;
      }
      // Compteur heures par éduc
      ids.forEach(id => {
        if (parEduc[+id]) {
          parEduc[+id].h += dureeH(p);
          parEduc[+id].slots++;
        }
      });
    });
  });

  console.log('═'.repeat(80));
  console.log(`debugCarence — ${moisStr}`);
  console.log('═'.repeat(80));

  if (!rows.length) {
    console.log('✅ Aucune carence — tous les minimums sont couverts.');
  } else {
    console.log(`⚠ ${totalManquant} poste(s) non pourvu(s) — ≈ ${totalHManquant.toFixed(1)}h perdues`);
    console.table(rows);
    console.log('Synthèse par plage :');
    console.table(Object.entries(parPlage).map(([p,v]) => ({
      Plage: p,
      'Postes manquants': v.manque,
      'Heures perdues': v.h.toFixed(1) + 'h',
    })));
  }

  // 2) Solde heures par éduc
  const joursOuv = jours.filter(d => {
    const dw = d.getDay();
    return dw >= 1 && dw <= 5 && !isFerie(dayStr(d));
  }).length;
  console.log(`\nSolde heures (mois = ${joursOuv} jours ouvrables) :`);
  const soldes = educs.map(e => {
    const cible = joursOuv * 7.6 * (getTargetH(e) / 38);
    const fait = parEduc[e.id].h;
    return {
      Éduc: e.prenom,
      Contrat: e.contrat,
      'h faites': fait.toFixed(1),
      'h cible': cible.toFixed(1),
      'écart': (fait - cible).toFixed(1) + 'h',
      slots: parEduc[e.id].slots,
    };
  });
  console.table(soldes);
  return { rows, parPlage, soldes, totalManquant, totalHManquant };
}

// ================================================================
// PATTERNS PERSISTANTS (habitudes hebdomadaires)
// { educId: { dow: { plageId: count } } }
// ================================================================
function loadPatterns(){ try{return JSON.parse(localStorage.getItem('planeduc_v3_patterns')||'{}');}catch(e){return {};} }
function savePatterns(p){ try{localStorage.setItem('planeduc_v3_patterns',JSON.stringify(p));}catch(e){} }

function buildPatterns(moisStr){
  // Analyser les 4 derniers mois pour extraire les habitudes réelles
  const [yr,mo]=moisStr.split('-').map(Number);
  const patterns=loadPatterns();
  for(let i=1;i<=4;i++){
    const key=moisKey(yr,mo-i);
    const plan=horaire[key]; if(!plan) continue;
    const [ky,km]=key.split('-').map(Number);
    getDays(ky,km).forEach(day=>{
      const ds=dayStr(day),dow=dowIdx(day);
      Object.entries(plan[ds]||{}).forEach(([pid,ids])=>{
        if(pid.startsWith('_')||!Array.isArray(ids)) return;
        ids.forEach(eid=>{
          const id=String(eid);
          if(!patterns[id]) patterns[id]={};
          if(!patterns[id][dow]) patterns[id][dow]={};
          patterns[id][dow][pid]=(patterns[id][dow][pid]||0)+1;
        });
      });
    });
  }
  savePatterns(patterns);
  return patterns;
}

// Bonus de stabilité — FORT pour les habitudes ancrées
// Un éducateur qui a "toujours" fait cette plage ce jour est très prioritaire
function bonusStabilite(e,dow,plage,patterns){
  const pat=patterns[String(e.id)];
  if(!pat||!pat[dow]||!pat[dow][plage.id]) return 0;
  const cnt=pat[dow][plage.id]||0;
  // Progression forte : l'habitude s'ancre exponentiellement
  if(cnt>=8)  return -35; // très forte habitude → très prioritaire
  if(cnt>=6)  return -28;
  if(cnt>=4)  return -20;
  if(cnt>=2)  return -12;
  return -5;
}

// ================================================================
// STATS ANNUELLES
// ================================================================
function loadAnnualStats(){ try{return JSON.parse(localStorage.getItem('planeduc_v3_annual')||'{}');}catch(e){return {};} }

function updateAnnualStats(moisStr){
  try{
    const yr=moisStr.split('-')[0];
    const stats=loadAnnualStats(); if(!stats[yr])stats[yr]={};
    const tot={};
    educs.forEach(e=>{tot[e.id]={h:0,nuits:0,we:0,feries:0,matin:0,aprem:0,soir:0,reunion:0};});
    Object.keys(horaire).filter(k=>k.startsWith(yr)).forEach(mk=>{
      const [ky,km]=mk.split('-').map(Number);
      getDays(ky,km).forEach(day=>{
        const ds=dayStr(day),weD=isWEDay(day),feD=isFerie(ds);
        Object.entries(horaire[mk][ds]||{}).forEach(([pid,ids])=>{
          if(pid.startsWith('_')||!Array.isArray(ids)) return;
          const p=plageById(+pid); if(!p) return;
          const tp=typePlage(p);
          ids.forEach(eid=>{
            const id=+eid; if(!tot[id]) return;
            tot[id].h+=dureeH(p);
            if(tp==='nuit')    tot[id].nuits++;
            if(tp==='matin')   tot[id].matin++;
            if(tp==='aprem')   tot[id].aprem++;
            if(tp==='soir')    tot[id].soir++;
            if(tp==='reunion') tot[id].reunion++;
            if(weD) tot[id].we++;
            if(feD) tot[id].feries++;
          });
        });
      });
    });
    educs.forEach(e=>{stats[yr][e.id]=tot[e.id];});
    localStorage.setItem('planeduc_v3_annual',JSON.stringify(stats));
  }catch(err){console.warn('updateAnnualStats:',err);}
}

// ================================================================
// VERROUILLAGES MANUELS
// ================================================================
function getLockedSlots(moisStr){
  const plan=horaire[moisStr]||{}, locked={};
  Object.entries(plan).forEach(([ds,slots])=>{
    Object.entries(slots).forEach(([pid,val])=>{
      if(pid.startsWith('_')) return;
      if(!Array.isArray(val)) return;
      if(slots['_lock_'+pid]==='locked'){
        if(!locked[ds])locked[ds]={};
        locked[ds][pid]=val;
      }
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

// ================================================================
// DETECTION D'IMPOSSIBILITES
// ================================================================
function detecterImpossibilites(moisStr){
  const [yr,mo]=moisStr.split('-').map(Number);
  const jours=getDays(yr,mo); const msgs=[];
  plages.forEach(p=>{
    jours.forEach(d=>{
      const ds=dayStr(d),dow=dowIdx(d),we=isWEDay(d),fe=isFerie(ds);
      const dc=(fe&&!we)?5:dow; if(!p.jours.includes(dc)) return;
      const dispo=educs.filter(e=>(e.jours||[]).includes(dow)&&!isAbsent(e.id,ds)).length;
      if(dispo<(+p.min||1)) msgs.push(`${ds} - ${p.nom}: ${dispo}/${p.min} educ(s) disponible(s)`);
    });
  });
  return msgs;
}

// ================================================================
// CALCUL QUOTAS (avec équité progressive douce)
// ================================================================
function calculerQuotas(hist,jours,moisStr){
  const [yr,mo]=moisStr.split('-').map(Number);
  const joursOuv=joursOuvMois(yr,mo);
  const poidsTotal=educs.reduce((s,e)=>s+ratioE(e),0);
  const annStats=loadAnnualStats()[yr]||{};
  const quotas={};

  educs.forEach(e=>{
    const re=ratioE(e);
    const base=joursOuv*7.6*re;
    // Correction douce du solde : max ±6h (progressive, pas brutale)
    const ajust=Math.max(-6,Math.min(6,-(hist[e.id].solde||0)*0.35));
    quotas[e.id]={
      h:{cible:base+ajust, min:base-15, max:base+15},
      plage:{}, types:{},
      ann:(annStats[e.id]||{nuits:0,we:0,feries:0}),
      exceptionsUsees:0, exceptionsMax:3
    };

    plages.forEach(p=>{
      if(isReunion(p)){quotas[e.id].plage[p.id]={cible:999,min:0,max:999};return;}
      const ja=jours.filter(d=>{
        const di=dowIdx(d),dc=(isFerie(dayStr(d))&&!isWEDay(d))?5:di;
        return p.jours.includes(dc);
      }).length;
      const totalPostes=ja*(+p.min||1);
      const cible=totalPostes*re/Math.max(0.01,poidsTotal);
      // Correction historique très douce (0.2) pour ne pas casser la stabilité
      const myN=(hist[e.id].plageCount[p.id]||0)/Math.max(0.01,re);
      const avgN=moyPond(educs,x=>hist[x.id].plageCount[p.id]||0);
      const corr=(myN-avgN)*re*0.2;
      // Correction annuelle nuits (très légère)
      const corrAnn=isNuitP(p)?Math.max(-1,Math.min(1,(norm((annStats[e.id]||{}).nuits||0,e)-moyPond(educs,x=>(annStats[x.id]||{}).nuits||0))*re*0.1)):0;
      const c=Math.max(0,cible-corr-corrAnn);
      quotas[e.id].plage[p.id]={cible:c,min:Math.max(0,Math.floor(c-2)),max:Math.ceil(c+2)};
    });

    ['matin','aprem','soir','nuit'].forEach(tp=>{
      const pts=plages.filter(p=>!isReunion(p)&&(tp==='nuit'?isNuitP(p):typePlage(p)===tp));
      let tot=0;
      pts.forEach(p=>{
        const ja=jours.filter(d=>{const di=dowIdx(d),dc=(isFerie(dayStr(d))&&!isWEDay(d))?5:di;return p.jours.includes(dc);}).length;
        tot+=ja*(+p.min||1);
      });
      const ct=tot*re/Math.max(0.01,poidsTotal);
      quotas[e.id].types[tp]={cible:ct,min:Math.max(0,Math.floor(ct-1.5)),max:Math.ceil(ct+1.5)};
    });
  });
  return quotas;
}

// ================================================================
// PRE-ALLOCATION NUITS (vision mois complet)
// ================================================================
function preAllouerNuits(jours,hist,moisStr){
  const preAlloc={};
  const annStats=loadAnnualStats()[moisStr.split('-')[0]]||{};
  const cpt={};
  educs.forEach(e=>{cpt[e.id]={nuits:0,lastNuit:null,nuitsC:0};});

  jours.filter(d=>{
    const dow=dowIdx(d),we=isWEDay(d),fe=isFerie(dayStr(d));
    const dc=(fe&&!we)?5:dow;
    return plages.some(p=>p.jours.includes(dc)&&isNuitP(p)&&!isReunion(p));
  }).forEach(d=>{
    const ds=dayStr(d),dow=dowIdx(d),we=isWEDay(d),fe=isFerie(ds);
    const dc=(fe&&!we)?5:dow;
    preAlloc[ds]={};
    plages.filter(p=>p.jours.includes(dc)&&isNuitP(p)&&!isReunion(p)).forEach(p=>{
      const reqMin=+p.min||1;
      const cands=educs.filter(e=>{
        if(!(e.jours||[]).includes(dow)||isAbsent(e.id,ds)) return false;
        if(cpt[e.id].nuitsC>=2) return false;
        if(cpt[e.id].lastNuit&&Math.round((d-new Date(cpt[e.id].lastNuit))/86400000)<=1) return false;
        return true;
      }).sort((a,b)=>{
        // Trier par nuits normalisées (annuel inclus) : moins de nuits = prioritaire
        const nA=norm((hist[a.id].nuits||0)+((annStats[a.id]||{}).nuits||0)+cpt[a.id].nuits,a);
        const nB=norm((hist[b.id].nuits||0)+((annStats[b.id]||{}).nuits||0)+cpt[b.id].nuits,b);
        return nA-nB;
      }).slice(0,reqMin);
      preAlloc[ds][p.id]=cands.map(e=>e.id);
      cands.forEach(e=>{cpt[e.id].nuits++;cpt[e.id].nuitsC++;cpt[e.id].lastNuit=ds;});
    });
    educs.forEach(e=>{if(cpt[e.id].lastNuit!==ds)cpt[e.id].nuitsC=0;});
  });
  return preAlloc;
}

// ================================================================
// SEMAINE GLISSANTE 50H
// ================================================================
function hSem(trackerE,ds){
  const d=new Date(ds+'T12:00');
  const lundi=new Date(d); lundi.setDate(d.getDate()-((d.getDay()+6)%7));
  const dim=new Date(lundi); dim.setDate(lundi.getDate()+6);
  let h=0;
  for(let dd=new Date(lundi);dd<=dim;dd.setDate(dd.getDate()+1)) h+=(trackerE.joursH||{})[dayStr(dd)]||0;
  return h;
}

// ================================================================
// UI
// ================================================================
function verifier(){
  const warns=[];
  if(!educs.length)  warns.push({t:'err',m:'Aucun educateur defini.'});
  if(!plages.length) warns.push({t:'err',m:'Aucune plage horaire definie.'});
  const rc=document.getElementById('gen-recap'),ri=document.getElementById('gen-recap-content');
  rc.style.display='block';
  let html=warns.map(w=>`<div class="alert a-${w.t}">! ${w.m}</div>`).join('');
  if(!warns.length){
    html+=`<div class="alert a-ok">OK: ${educs.length} educateurs - ${plages.length} plages</div>`;
    html+=plages.map(p=>{
      const j=p.jours.map(x=>JOURS[x]).join(', ');
      const b=isReunion(p)?'<span class="badge b-blue" style="font-size:.6rem">REUNION</span>':'';
      return `<div style="display:flex;align-items:center;gap:7px;margin:5px 0;font-size:.8rem">
        <div style="width:8px;height:8px;border-radius:50%;background:${p.color}"></div>
        <strong>${p.nom}</strong> ${b} - ${p.debut}-${p.fin} - min ${p.min} educ - ${j}</div>`;
    }).join('');
  }
  ri.innerHTML=html;
}

async function lancer(){
  if(!educs.length||!plages.length){verifier();return;}
  const mois=document.getElementById('gen-mois').value;
  if(!mois){alert('Choisissez un mois.');return;}
  const btn=document.getElementById('gen-btn');
  btn.disabled=true; btn.innerHTML='<div class="spin"></div> Generation...';
  document.getElementById('gen-prog').style.display='block';
  document.getElementById('gen-alerts').innerHTML='';
  const log=document.getElementById('gen-log'); log.innerHTML='';
  const L=(m,p)=>{log.innerHTML+=m+'<br>';log.scrollTop=log.scrollHeight;if(p!=null)document.getElementById('gen-bar').style.width=p+'%';};

  L('Detection impossibilites...',3); await sl(50);
  const impos=detecterImpossibilites(mois);
  impos.forEach(msg=>L('⚠ '+msg,null));

  // Module 2 — Tournante WE en blocs sam+dim gravés
  // Désactivable au runtime via window.MODULE2_ENABLED = false (console)
  if(typeof window === 'undefined' || window.MODULE2_ENABLED !== false){
    L('Module 2 : gravure des blocs week-end...',6); await sl(30);
    const m2 = genererBlocsWE(mois);
    if(m2 && m2.summary){
      const nbWE = (m2.summary.weekends||[]).filter(w=>w.type==='planned').length;
      if(nbWE>0) L(`  ${nbWE} bloc(s) WE gravé(s) (sam+dim équipe identique)`,null);
    }
  } else {
    L('Module 2 désactivé (window.MODULE2_ENABLED = false)',6);
    // Purger les éventuels verrous WE auto résiduels pour ne pas polluer la génération
    if(typeof weAutoLocks !== 'undefined' && weAutoLocks[mois]){
      Object.entries(weAutoLocks[mois]).forEach(([ds, pids])=>{
        if(horaire[mois] && horaire[mois][ds]){
          pids.forEach(pid=>{
            delete horaire[mois][ds]['_lock_'+pid];
            delete horaire[mois][ds][pid];
          });
        }
      });
      delete weAutoLocks[mois];
      if(typeof saveWeAutoLocks === 'function') saveWeAutoLocks();
    }
  }

  const result=await genMois(mois,L);
  window._lastDiagnostic=result.diagnostic||[];

  L('Validation...',93); await sl(30);
  const validation=validatePlanning(result.planning,mois,result.tracker,result.quotas);

  horaire[mois]=result.planning;
  currentMonth=mois; save();
  updateAnnualStats(mois);
  buildPatterns(mois);

  const qs=planningQualityScore(validation);
  L(`Score qualite : ${qs.score}/100 — ${qs.label}`,null);
  if(validation.errors.length) L(`⚠ ${validation.errors.length} poste(s) non couverts`,null);
  validation.warnings.slice(0,6).forEach(w=>L('! '+w,null));
  result.warnings.slice(0,4).forEach(w=>L('! '+w,null));
  L('Termine !',100);

  btn.disabled=false; btn.innerHTML="Generer l'horaire";
  const at=validation.errors.length?'warn':'ok';
  showAlert('gen-alerts',at,`Horaire genere — Score : ${qs.score}/100 (${qs.label})${validation.errors.length?' — '+validation.errors.length+' poste(s) non couvert(s)':''}`);
  updateMonthLabels();
}

// ================================================================
// MOTEUR PRINCIPAL — 3 ETAPES
// ================================================================
async function genMois(moisStr,L){
  _pm=null; _em=null;
  const [yr,mo]=moisStr.split('-').map(Number);
  const jours=getDays(yr,mo);
  const planning={}, warnings=[], diagnostic=[];
  const horizon=+document.getElementById('gen-horizon').value||3;
  const minRepos=getRule('min_repos',11);
  const maxCons=getRule('max_consec',6);
  const maxWeMois=getRule('max_we_mois',2);
  const reposNuit=getRule('repos_apres_nuit',1);
  const maxNuitsC=2;

  L('Etape 1 : Historique et patterns...',6); await sl(30);
  const lockedSlots=getLockedSlots(moisStr);

  // ── HISTORIQUE ──
  const hist={};
  educs.forEach(e=>{
    hist[e.id]={solde:0,plageCount:{},we:0,ferie:0,nuits:0,types:{matin:0,aprem:0,soir:0,nuit:0,reunion:0}};
    plages.forEach(p=>hist[e.id].plageCount[p.id]=0);
  });
  for(let i=1;i<horizon;i++){
    const key=moisKey(yr,mo-i); const plan=horaire[key]; if(!plan) continue;
    const [ky,km]=key.split('-').map(Number);
    const joursMois=getDays(ky,km); const joursOuvH=joursOuvMois(ky,km);
    const hTrav={}; educs.forEach(e=>hTrav[e.id]=0);
    joursMois.forEach(day=>{
      const ds=dayStr(day),weD=isWEDay(day),feD=isFerie(ds);
      Object.entries(plan[ds]||{}).forEach(([pid,ids])=>{
        if(pid.startsWith('_')||!Array.isArray(ids)) return;
        const p=plageById(+pid); if(!p) return;
        const tp=typePlage(p);
        ids.forEach(eid=>{
          const id=+eid; if(!hist[id]) return;
          hTrav[id]+=dureeH(p);
          hist[id].plageCount[p.id]=(hist[id].plageCount[p.id]||0)+1;
          if(weD)hist[id].we++; if(feD)hist[id].ferie++;
          if(isNuitP(p)&&!isReunion(p)) hist[id].nuits++;
          hist[id].types[tp]=(hist[id].types[tp]||0)+1;
        });
      });
    });
    educs.forEach(e=>{hist[e.id].solde+=hTrav[e.id]-joursOuvH*7.6*ratioE(e);});
  }

  L('Etape 1 : Quotas et pre-allocation nuits...',14); await sl(30);
  const quotas=calculerQuotas(hist,jours,moisStr);
  const patterns=buildPatterns(moisStr);
  const preAlloc=preAllouerNuits(jours,hist,moisStr);

  // ── TRACKER ──
  const tracker={};
  const lastPrest={};
  educs.forEach(e=>{
    tracker[e.id]={h:0,nuits:0,nuitsC:0,weCount:0,weJours:new Set(),cons:0,lastDay:null,plageCount:{},types:{matin:0,aprem:0,soir:0,nuit:0,reunion:0},fatigue:0,joursH:{}};
    plages.forEach(p=>tracker[e.id].plageCount[p.id]=0);
    lastPrest[e.id]=null;
  });

  // Continuite mois precedent
  const prevPlan=horaire[moisKey(yr,mo-1)]||{};
  Object.keys(prevPlan).sort().forEach(ds=>{
    Object.entries(prevPlan[ds]||{}).forEach(([pid,ids])=>{
      if(pid.startsWith('_')||!Array.isArray(ids)) return;
      const p=plageById(+pid); if(!p) return;
      ids.forEach(eid=>{
        const id=+eid;
        if(!lastPrest[id]||ds>lastPrest[id].date)
          lastPrest[id]={date:ds,fin:p.fin,isNuit:isNuitP(p)&&!isReunion(p),pm:p.fin<p.debut};
      });
    });
  });

  // ── P1 : LOI ──
  function checkLoi(e,d,ds,dow,plage){
    if(!(e.jours||[]).includes(dow)) return {ok:false,raison:'Jour non travaillé'};
    if(isAbsent(e.id,ds)) return {ok:false,raison:'Absence encodée'};
    const t=tracker[e.id], re=isReunion(plage);
    if(!re){
      if(t.cons>=maxCons) return {ok:false,raison:`Max ${maxCons}j consécutifs`};
      if(isNuitP(plage)&&t.nuitsC>=maxNuitsC) return {ok:false,raison:'Max 2 nuits consécutives'};
      const la=lastPrest[e.id];
      if(la){
        const [lh,lm]=la.fin.split(':').map(Number);
        const [bh,bm]=plage.debut.split(':').map(Number);
        const finMs=new Date(la.date+'T00:00').getTime()+(la.pm?86400000:0)+(lh*60+lm)*60000;
        const debMs=new Date(ds+'T00:00').getTime()+(bh*60+bm)*60000;
        const dh=(debMs-finMs)/3600000;
        if(dh>=0&&dh<minRepos) return {ok:false,raison:`Repos 11h (${dh.toFixed(1)}h dispo)`};
      }
      if(la&&la.isNuit&&reposNuit>0&&Math.round((d-new Date(la.date))/86400000)<=reposNuit)
        return {ok:false,raison:'Repos après nuit'};
      const maxHJ=isNuitP(plage)?14:11;
      const hJour=plages.filter(p2=>!isReunion(p2)).reduce((s,pp)=>{
        const ids=(planning[ds]||{})[pp.id];
        return Array.isArray(ids)&&ids.map(x=>+x).includes(e.id)?s+dureeH(pp):s;
      },0);
      if(hJour+dureeH(plage)>maxHJ) return {ok:false,raison:`Max h/jour (${(hJour+dureeH(plage)).toFixed(1)}h)`};
    }
    if(hSem(tracker[e.id],ds)+dureeH(plage)>50) return {ok:false,raison:`Max 50h/sem`};
    return {ok:true,raison:''};
  }

  function checkConvention(e,d,ds,plage,niveau){
    const re=isReunion(plage);
    if(niveau<2&&!re&&(e.excls||[]).includes(plage.id)) return {ok:false,raison:'Plage refusée',bloquant:true};
    if(!re&&isWEDay(d)&&tracker[e.id].weCount>=maxWeMois&&niveau<1) return {ok:false,raison:'Max WE/mois',bloquant:false};
    if(!re&&niveau===0){
      // Solde heures : seuil proportionnel au ratio contrat
      // Mi-temps (ratio 0.5) bloqué à +7h, temps plein à +14h
      const solde=hist[e.id].solde+(tracker[e.id].h-quotas[e.id].h.cible);
      const seuilSolde=14*ratioE(e);
      if(solde>seuilSolde) return {ok:false,raison:`Solde +${solde.toFixed(1)}h`,bloquant:false};
      // Quota max plage
      const myC=tracker[e.id].plageCount[plage.id]||0;
      const qMax=quotas[e.id]?.plage[plage.id]?.max;
      if(qMax!==undefined&&myC>=qMax&&quotas[e.id].exceptionsUsees>=quotas[e.id].exceptionsMax)
        return {ok:false,raison:'Quota plage max',bloquant:false};
    }
    return {ok:true,raison:''};
  }

  // ── SCORE ──
  // La STABILITE a le poids le plus fort pour les prestations normales
  // La ROTATION ne s'applique fort qu'aux nuits/WE/fériés
  function score(e,d,ds,plage,weOrFerie,preAllocIds,dow){
    const t=tracker[e.id],ht=hist[e.id],re=ratioE(e),q=quotas[e.id];
    const annS=loadAnnualStats()[moisStr.split('-')[0]]||{};
    const ann=annS[e.id]||{nuits:0,we:0,feries:0};
    const reunion=isReunion(plage), nuit=isNuitP(plage);
    let sc=0;

    // ── P2 : Solde heures (quasi-contrainte dure) ──
    const solde=ht.solde+(t.h-q.h.cible);
    // Progressif : fort seulement quand on approche ±15h
    if(solde>12)       sc+=40;  // fort blocage
    else if(solde>8)   sc+=20;
    else if(solde>4)   sc+=8;
    else if(solde<-12) sc-=40;  // fort bonus
    else if(solde<-8)  sc-=20;
    else if(solde<-4)  sc-=8;
    else sc+=solde*1.5; // zone normale : influence douce

    if(!reunion){
      // ── P3 : STABILITE (poids FORT pour prestations normales) ──
      if(!nuit&&!weOrFerie){
        // Pour matins/après-midis/soirs normaux : bonus de stabilité très fort
        sc+=bonusStabilite(e,dow,plage,patterns)*1.5;
      } else {
        // Pour nuits/WE/fériés : bonus de stabilité normal
        sc+=bonusStabilite(e,dow,plage,patterns);
      }

      // Bonus si c'est dans la pré-allocation (nuits)
      if(preAllocIds&&preAllocIds.includes(e.id)) sc-=12;

      // ── P4 : ROTATION pour le pénible (nuits/WE/fériés) ──
      // Pour les matins/soirs normaux : équité très douce
      const tp=typePlage(plage);

      // Equité plage (normalisée par contrat)
      const myCP=norm((ht.plageCount[plage.id]||0)+(t.plageCount[plage.id]||0),e);
      const avgCP=moyPond(educs,x=>(hist[x.id].plageCount[plage.id]||0)+(tracker[x.id].plageCount[plage.id]||0));
      const ecP=myCP-avgCP;
      if(nuit||weOrFerie){
        // Rotation forte pour le pénible
        sc+=ecP*12;
        if(ecP<-1.5) sc-=18; if(ecP>1.5) sc+=15;
      } else {
        // Rotation très douce pour le normal
        sc+=ecP*4;
      }

      // Equité type (nuit/soir/matin)
      const myTP=norm((ht.types[tp]||0)+(t.types[tp]||0),e);
      const avgTP=moyPond(educs,x=>(hist[x.id].types[tp]||0)+(tracker[x.id].types[tp]||0));
      const ecT=myTP-avgTP;
      if(nuit||weOrFerie){
        sc+=ecT*10; if(ecT<-1)sc-=12; if(ecT>1)sc+=10;
      } else {
        sc+=ecT*3; // très doux pour le normal
      }

      // WE (annuel+mensuel)
      if(weOrFerie){
        const myWE=norm((ht.we||0)+(t.weCount||0)+(ann.we||0),e);
        const avgWE=moyPond(educs,x=>(hist[x.id].we||0)+(tracker[x.id].weCount||0)+((annS[x.id]||{}).we||0));
        const ecWE=myWE-avgWE;
        sc+=ecWE*11; if(ecWE<-1)sc-=14; if(ecWE>1)sc+=11;
      }

      // Fériés
      if(isFerie(ds)){
        const myF=norm((ht.ferie||0)+(ann.feries||0),e);
        const avgF=moyPond(educs,x=>(hist[x.id].ferie||0)+((annS[x.id]||{}).feries||0));
        sc+=(myF-avgF)*12;
      }

      // Nuits (annuel, poids max)
      if(nuit){
        const myN=norm((ht.nuits||0)+(t.nuits||0)+(ann.nuits||0),e);
        const avgN=moyPond(educs,x=>(hist[x.id].nuits||0)+(tracker[x.id].nuits||0)+((annS[x.id]||{}).nuits||0));
        const ecN=myN-avgN;
        sc+=ecN*15; if(ecN<-1.5)sc-=22; if(ecN>1.5)sc+=18;
      }

      // Fatigue (légère pénalité)
      sc+=t.fatigue*0.5;
    }

    // ── P5 : Préférences ──
    if(!reunion&&(e.prefs||[]).includes(plage.id)) sc-=10;
    const dow2=d.getDay()===0?6:d.getDay()-1;
    (e.demandes||[]).forEach(dem=>{
      if(dem.jour===dow2&&(dem.plageIds||[]).includes(plage.id)){
        if(dem.type==='eviter')  sc+=13;
        if(dem.type==='prefere') sc-=13;
      }
    });

    // Eviter double terrain (sauf pause acceptée)
    if(!reunion&&!e.acceptePause){
      const dejaTerrain=Object.keys(planning[ds]||{}).some(pid=>{
        if(pid.startsWith('_')) return false;
        const p2=plageById(+pid); if(!p2||isReunion(p2)) return false;
        return ((planning[ds][pid]||[]).map(x=>+x)).includes(e.id);
      });
      if(dejaTerrain) sc+=30;
    }

    return sc;
  }

  function updateTracker(e,d,ds,plage,nuit,we){
    const t=tracker[e.id],tp=typePlage(plage),re=isReunion(plage);
    const h=dureeH(plage);
    t.h+=h;
    if(!t.joursH[ds])t.joursH[ds]=0; t.joursH[ds]+=h;
    if(!re){
      const diffJ=t.lastDay?Math.round((d-new Date(t.lastDay))/86400000):999;
      t.cons=diffJ===1?t.cons+1:1; t.lastDay=ds;
      if(nuit){t.nuits++;t.nuitsC++;}else t.nuitsC=0;
      if(we&&!t.weJours.has(ds)){t.weJours.add(ds);if(d.getDay()===6)t.weCount++;}
      const pw=POIDS[tp]||1.0;
      t.fatigue+=pw*(h>10?2:h>8?1.5:h>6?0.8:0.3)+(t.cons>4?1.2:0);
      t.fatigue=Math.min(18,t.fatigue*0.94);
      lastPrest[e.id]={date:ds,fin:plage.fin,isNuit:nuit,pm:plage.fin<plage.debut};
    }
    t.plageCount[plage.id]=(t.plageCount[plage.id]||0)+1;
    t.types[tp]=(t.types[tp]||0)+1;
  }

  // ================================================================
  // PHASE 0 : PRÉ-ASSIGNATION WE EN BLOCS (sam+dim identiques)
  //
  // Logique chef éducateur : on commence TOUJOURS par construire
  // le tableau des WE avant tout le reste.
  //
  // Cycle inter-mois persisté dans localStorage.
  // Plage WE = plage dont TOUS les jours sont 5 (sam) ou 6 (dim).
  // Un bloc = même équipe sam+dim, type identique (J+J ou N+N).
  // ================================================================
  L('Phase 0 : Tournante WE en blocs...',20); await sl(30);

  // Identifier les plages WE (jours uniquement sam=5 et/ou dim=6)
  const plagesWEOnly = plages.filter(p =>
    !isReunion(p) &&
    p.jours && p.jours.length > 0 &&
    p.jours.every(j => j === 5 || j === 6)
  );

  if(plagesWEOnly.length > 0){
    // Construire la liste des WE du mois (sam+dim groupés)
    const weBlocs = [];
    jours.forEach(d => {
      if(d.getDay() === 6){ // samedi
        const dDim = jours.find(x => x.getDay()===0 && x>d);
        weBlocs.push({
          num: weBlocs.length+1,
          dSam: d, dsSam: dayStr(d),
          dDim: dDim||null, dsDim: dDim?dayStr(dDim):null
        });
      } else if(d.getDay()===0 && !weBlocs.some(w=>w.dsDim===dayStr(d))){
        // Dimanche orphelin début de mois
        weBlocs.push({num:weBlocs.length+1, dSam:null, dsSam:null, dDim:d, dsDim:dayStr(d)});
      }
    });

    // Charger/sauvegarder position du cycle WE
    let cycleWE = {};
    try{ cycleWE = JSON.parse(localStorage.getItem('planeduc_v3_webloc')||'{}'); }catch(e){}

    for(const plage of plagesWEOnly){
      const reqMin = +plage.min || 1;
      const ck = `we_${plage.id}`;

      // Éducs éligibles : non exclus, disponibles sam ET dim
      // Accepte dim stocké comme 5/6 (format UI PlanEduc) ou 0 (getDay natif)
      const eligibles = educs.filter(e => {
        if((e.excls||[]).includes(plage.id)) return false;
        const j = e.jours||[];
        const hasSam = j.includes(5);
        const hasDim = j.includes(6) || j.includes(0);
        return hasSam && hasDim;
      }).sort((a,b) => {
        // Tri initial équité WE (ceux qui en ont le moins en premier)
        const wA = (hist[a.id].we||0)/Math.max(0.01,ratioE(a));
        const wB = (hist[b.id].we||0)/Math.max(0.01,ratioE(b));
        return wA - wB;
      });

      if(!eligibles.length){
        // Fallback : tous ceux qui travaillent au moins le samedi
        const fallback = educs.filter(e =>
          !(e.excls||[]).includes(plage.id) && (e.jours||[]).includes(5)
        );
        if(fallback.length) eligibles.push(...fallback.filter(e=>!eligibles.includes(e)));
      }

      if(!eligibles.length){ warnings.push(`${plage.nom} WE : aucun éduc éligible`); continue; }

      const cycleLen = Math.max(1, Math.ceil(eligibles.length / reqMin));
      let pos = cycleWE[ck] || 0;

      for(const we of weBlocs){
        if(lockedSlots[we.dsSam]?.[plage.id] || lockedSlots[we.dsDim]?.[plage.id]){
          pos = (pos+1) % cycleLen; continue;
        }

        // Groupe théorique du cycle
        const groupeTheo = [];
        for(let i=0;i<reqMin;i++) groupeTheo.push(eligibles[(pos*reqMin+i)%eligibles.length]);

        // Vérifier légalité sur le samedi
        let groupeFinal = groupeTheo.filter(e => {
          if(!we.dSam) return true; // dim seul = OK
          if(isAbsent(e.id,we.dsSam)) return false;
          if(!(e.jours||[]).includes(5)) return false;
          // Vérif solde : pas bloqué
          const solde = hist[e.id].solde+(tracker[e.id].h-quotas[e.id].h.cible);
          return solde <= 14*ratioE(e);
        });

        // Compléter si manque
        if(groupeFinal.length < reqMin){
          const suppl = eligibles.filter(e =>
            !groupeTheo.includes(e) && !groupeFinal.includes(e) &&
            !isAbsent(e.id, we.dsSam||we.dsDim) &&
            (hist[e.id].solde+(tracker[e.id].h-quotas[e.id].h.cible)) <= 14*ratioE(e)
          );
          groupeFinal = groupeFinal.concat(suppl.slice(0, reqMin-groupeFinal.length));
        }
        // Urgence : ignorer solde
        if(groupeFinal.length < reqMin){
          const urgence = eligibles.filter(e => !groupeFinal.includes(e));
          groupeFinal = groupeFinal.concat(urgence.slice(0, reqMin-groupeFinal.length));
        }

        // Assigner SAM en premier (tracker mis à jour), puis DIM
        if(we.dSam && plage.jours.includes(5)){
          if(!planning[we.dsSam]) planning[we.dsSam]={};
          if(!Array.isArray(planning[we.dsSam][plage.id])) planning[we.dsSam][plage.id]=[];
          groupeFinal.forEach(e=>{
            if(isAbsent(e.id,we.dsSam)) return;
            if(planning[we.dsSam][plage.id].map(x=>+x).includes(e.id)) return;
            planning[we.dsSam][plage.id].push(e.id);
            planning[we.dsSam][`_s_${e.id}_${plage.id}`]='neutral';
            updateTracker(e,we.dSam,we.dsSam,plage,isNuitP(plage),true);
          });
        }

        // DIM : vérifier repos après sam nuit avant d'assigner
        if(we.dDim && plage.jours.includes(6)){
          if(!planning[we.dsDim]) planning[we.dsDim]={};
          if(!Array.isArray(planning[we.dsDim][plage.id])) planning[we.dsDim][plage.id]=[];
          groupeFinal.forEach(e=>{
            if(isAbsent(e.id,we.dsDim)) return;
            // Vérif repos 11h entre sam et dim pour les nuits
            const la=lastPrest[e.id];
            if(la && isNuitP(plage)){
              const [lh,lm]=la.fin.split(':').map(Number);
              const [bh,bm]=plage.debut.split(':').map(Number);
              const finMs=new Date(la.date+'T00:00').getTime()+(la.pm?86400000:0)+(lh*60+lm)*60000;
              const debMs=new Date(we.dsDim+'T00:00').getTime()+(bh*60+bm)*60000;
              const repos=(debMs-finMs)/3600000;
              if(repos>=0&&repos<minRepos) return; // pas assez de repos
            }
            if(planning[we.dsDim][plage.id].map(x=>+x).includes(e.id)) return;
            planning[we.dsDim][plage.id].push(e.id);
            planning[we.dsDim][`_s_${e.id}_${plage.id}`]='neutral';
            updateTracker(e,we.dDim,we.dsDim,plage,isNuitP(plage),true);
          });
        }

        if(groupeFinal.length < reqMin)
          warnings.push(`WE${we.num} ${plage.nom} : ${groupeFinal.length}/${reqMin} couvert`);

        pos = (pos+1) % cycleLen;
      }

      // Sauvegarder position pour le mois suivant
      cycleWE[ck] = pos;
    }
    try{ localStorage.setItem('planeduc_v3_webloc', JSON.stringify(cycleWE)); }catch(e){}
  }

  // ================================================================
  // ETAPE 2 : GENERATION JOUR PAR JOUR
  // ================================================================
  L('Etape 2 : Generation...',25);

  for(let di=0;di<jours.length;di++){
    if(di%3===0){L(`Jour ${di+1}/${jours.length}`,25+Math.round((di/jours.length)*55));await sl(0);}
    const d=jours[di],ds=dayStr(d),dow=dowIdx(d);
    const we=isWEDay(d),ferie=isFerie(ds);
    // Initialiser planning du jour SANS écraser les pré-assignations WE (Phase 0)
    if(!planning[ds]) planning[ds]={};
    else {
      // Conserver uniquement les entrées WE pré-assignées et les verrouillages
      const keep={};
      Object.entries(planning[ds]).forEach(([k,v])=>{ keep[k]=v; });
      planning[ds]=keep;
    }

    // Recopier les verrouillages
    if(lockedSlots[ds]){
      Object.entries(lockedSlots[ds]).forEach(([pid,ids])=>{
        planning[ds][pid]=ids; planning[ds]['_lock_'+pid]='locked';
        ids.forEach(eid=>{
          const e=educById(+eid); if(!e) return;
          const p=plageById(+pid); if(!p) return;
          updateTracker(e,d,ds,p,isNuitP(p)&&!isReunion(p),we);
        });
      });
    }

    const dowForPlages=(ferie&&!we)?5:dow;
    const pjBase=plages.filter(p=>p.jours.includes(dowForPlages));

    // Ordre : nuits→WE/fériés→longues→reste→réunions
    function prio(p){
      if(isReunion(p)) return 10;
      if(isNuitP(p))   return 0;
      if(we||ferie)    return 1;
      if(dureeH(p)>8)  return 2;
      return 3;
    }
    const pj=[...pjBase].sort((a,b)=>{
      const pa=prio(a),pb=prio(b); if(pa!==pb) return pa-pb;
      const ca=educs.filter(e=>checkLoi(e,d,ds,dow,a).ok).length;
      const cb=educs.filter(e=>checkLoi(e,d,ds,dow,b).ok).length;
      return (ca/Math.max(1,+a.min||1))-(cb/Math.max(1,+b.min||1));
    });

    const preAllocJour=preAlloc[ds]||{};

    // ── PASSE A : Minimum obligatoire ──
    for(const plage of pj){
      if(lockedSlots[ds]&&lockedSlots[ds][plage.id]) continue;
      const nuit=isNuitP(plage)&&!isReunion(plage);
      const reqMin=Math.max(0,+plage.min||1), useAll=plage.tous;
      const pIds=preAllocJour[plage.id]||[];
      const reunion=isReunion(plage);
      const diagD=[];

      // Tester tous les educs (diagnostic)
      let cands=[];
      educs.forEach(e=>{
        const loi=checkLoi(e,d,ds,dow,plage);
        if(!loi.ok){diagD.push({nom:e.prenom+' '+e.nom,ini:(e.prenom[0]+e.nom[0]).toUpperCase(),color:e.color||'#888',ok:false,raison:loi.raison});return;}
        const conv=checkConvention(e,d,ds,plage,0);
        if(!conv.ok){diagD.push({nom:e.prenom+' '+e.nom,ini:(e.prenom[0]+e.nom[0]).toUpperCase(),color:e.color||'#888',ok:false,raison:conv.raison+(conv.bloquant?'':' ⚠')});return;}
        cands.push(e);
      });

      // Niveaux de relâchement
      if(cands.length<reqMin&&!useAll)
        cands=educs.filter(e=>checkLoi(e,d,ds,dow,plage).ok&&checkConvention(e,d,ds,plage,1).ok);
      if(cands.length<reqMin&&!useAll){
        cands=educs.filter(e=>checkLoi(e,d,ds,dow,plage).ok);
        cands.forEach(e=>{if(quotas[e.id])quotas[e.id].exceptionsUsees++;});
      }

      const scored=cands.map(e=>({e,sc:score(e,d,ds,plage,we||ferie,pIds,dow)})).sort((a,b)=>a.sc-b.sc);
      const n=useAll?scored.length:Math.min(reqMin,scored.length);
      const assigned=scored.slice(0,n).map(x=>x.e);

      planning[ds][plage.id]=assigned.map(e=>e.id);
      assigned.forEach(e=>diagD.push({nom:e.prenom+' '+e.nom,ini:(e.prenom[0]+e.nom[0]).toUpperCase(),color:e.color||'#888',ok:true,raison:'Assigné'}));

      if(assigned.length<reqMin||(nuit||we||ferie))
        diagnostic.push({ds,plage:plage.nom,couverte:assigned.length>=reqMin,details:diagD});

      assigned.forEach(e=>{
        const isExcl=!reunion&&(e.excls||[]).includes(plage.id);
        const isPref=(e.prefs||[]).includes(plage.id);
        const dow2=d.getDay()===0?6:d.getDay()-1;
        const dem=(e.demandes||[]).find(x=>x.jour===dow2&&(x.plageIds||[]).includes(plage.id));
        const sk=`_s_${e.id}_${plage.id}`;
        if(isExcl){planning[ds][sk]='forced';warnings.push(`${ds} - ${plage.nom}: refusée assignée à ${e.prenom}`);}
        else if(dem&&dem.type==='eviter'){planning[ds][sk]='dem_evite';warnings.push(`${ds} - ${plage.nom}: demande de ${e.prenom} non respectée`);}
        else if(dem&&dem.type==='prefere') planning[ds][sk]='dem_pref';
        else if(isPref) planning[ds][sk]='pref';
        else planning[ds][sk]='neutral';
        updateTracker(e,d,ds,plage,nuit,we);
      });

      if(assigned.length<reqMin)
        warnings.push(`${ds} - ${plage.nom}: ${reqMin-assigned.length} poste(s) non couvert(s)`);
    }

    // ── PASSE B : Maximum ──
    for(const plage of pj){
      if(plage.tous||isReunion(plage)) continue;
      if(lockedSlots[ds]&&lockedSlots[ds][plage.id]) continue;
      const reqMin=Math.max(0,+plage.min||1),reqMax=Math.max(reqMin,+plage.max||reqMin);
      if(reqMax<=reqMin) continue;
      const deja=(planning[ds][plage.id]||[]).map(x=>+x);
      const encore=reqMax-deja.length; if(encore<=0) continue;
      const cands=educs.filter(e=>{
        if(deja.includes(e.id)) return false;
        if(!checkLoi(e,d,ds,dow,plage).ok) return false;
        if(!checkConvention(e,d,ds,plage,1).ok) return false;
        const solde=hist[e.id].solde+(tracker[e.id].h-quotas[e.id].h.cible);
        return solde<10;
      }).map(e=>({e,sc:score(e,d,ds,plage,we||ferie,[],dow)}))
        .sort((a,b)=>a.sc-b.sc).slice(0,encore).map(x=>x.e);
      if(!cands.length) continue;
      planning[ds][plage.id]=[...deja,...cands.map(e=>e.id)];
      cands.forEach(e=>{
        planning[ds][`_s_${e.id}_${plage.id}`]=(e.excls||[]).includes(plage.id)?'forced':(e.prefs||[]).includes(plage.id)?'pref':'neutral';
        updateTracker(e,d,ds,plage,isNuitP(plage),we);
      });
    }
  }

  // ================================================================
  // ETAPE 3 : MICRO-AJUSTEMENTS (swaps ciblés nuits/WE seulement)
  // Ne pas toucher les matins/soirs stables !
  // ================================================================
  L('Etape 3 : Micro-ajustements...',83); await sl(30);

  // Swaps ciblés pour rééquilibrer nuits, soirs et WE.
  // maxDebt  = max heures en dessous cible qu'on tolère pour eIn (qui perd le slot)
  // maxSurp  = max heures au dessus cible qu'on tolère pour eOut (qui gagne le slot)
  // Seuils plus larges pour nuits (13h/slot) pour permettre les échanges d'équité.
  const passesSwap=[
    {nom:'nuits', keyFn:e=>norm((hist[e.id].nuits||0)+(tracker[e.id].nuits||0),e),
     filtre:p=>isNuitP(p)&&!isReunion(p),  maxSwaps:60, maxDebt:26, maxSurp:18},
    {nom:'soirs', keyFn:e=>norm((hist[e.id].types?.soir||0)+(tracker[e.id].types?.soir||0),e),
     filtre:p=>typePlage(p)==='soir'&&!isReunion(p)&&!(p.jours||[]).every(j=>j===4), maxSwaps:15, maxDebt:14, maxSurp:12},
    {nom:'WE',    keyFn:e=>norm((hist[e.id].we||0)+(tracker[e.id].weCount||0),e),
     filtre:p=>!isReunion(p),              maxSwaps:25, maxDebt:16, maxSurp:14},
  ];

  for(const pass of passesSwap){
    let sw=0;
    for(let iter=0;iter<pass.maxSwaps;iter++){
      let improved=false;
      for(const ds of Object.keys(planning)){
        if(lockedSlots[ds]) continue;
        const d=new Date(ds+'T12:00'),dow=dowIdx(d),we=isWEDay(d);
        if(pass.nom==='WE'&&!we) continue;
        for(const plage of plages){
          if(!pass.filtre(plage)) continue;
          const ids=(planning[ds][plage.id]||[]).map(x=>+x); if(!ids.length) continue;
          const reqMin=+plage.min||1;
          for(const idIn of ids){
            const eIn=educById(idIn); if(!eIn) continue;
            const sIn=pass.keyFn(eIn);
            for(const eOut of educs.filter(e=>!ids.includes(e.id))){
              if(pass.keyFn(eOut)>=sIn-1.5) continue;
              if(!swapValide(planning,ds,plage,idIn,eOut.id,reqMin,dow)) continue;
              // Guards corrects :
              // eIn PERD le slot → ses heures baissent : empêcher qu'il descende trop bas
              // eOut GAGNE le slot → ses heures montent : empêcher qu'il monte trop haut
              const soldIn =hist[eIn.id].solde +(tracker[eIn.id].h -quotas[eIn.id].h.cible);
              const soldOut=hist[eOut.id].solde+(tracker[eOut.id].h-quotas[eOut.id].h.cible);
              if(soldIn -dureeH(plage)<-pass.maxDebt) continue; // eIn ne doit pas descendre sous -maxDebt
              if(soldOut+dureeH(plage)> pass.maxSurp)  continue; // eOut ne doit pas dépasser +maxSurp
              // Appliquer le swap
              const newIds=ids.filter(x=>x!==idIn).concat(eOut.id);
              planning[ds][plage.id]=newIds;
              delete planning[ds][`_s_${idIn}_${plage.id}`];
              planning[ds][`_s_${eOut.id}_${plage.id}`]='neutral';
              const h=dureeH(plage);
              tracker[eIn.id].h =Math.max(0,tracker[eIn.id].h-h);
              tracker[eOut.id].h+=h;
              tracker[eIn.id].plageCount[plage.id]=Math.max(0,(tracker[eIn.id].plageCount[plage.id]||0)-1);
              tracker[eOut.id].plageCount[plage.id]=(tracker[eOut.id].plageCount[plage.id]||0)+1;
              if(isNuitP(plage)){
                tracker[eIn.id].nuits=Math.max(0,(tracker[eIn.id].nuits||0)-1);
                tracker[eOut.id].nuits=(tracker[eOut.id].nuits||0)+1;
              }
              if(typePlage(plage)==='soir'){
                tracker[eIn.id].types.soir =Math.max(0,(tracker[eIn.id].types?.soir||0)-1);
                tracker[eOut.id].types.soir=(tracker[eOut.id].types?.soir||0)+1;
              }
              if(we){
                tracker[eIn.id].weCount=Math.max(0,(tracker[eIn.id].weCount||0)-1);
                tracker[eOut.id].weCount=(tracker[eOut.id].weCount||0)+1;
              }
              improved=true;sw++;break;
            }
            if(improved)break;
          }
          if(improved)break;
        }
        if(improved)break;
      }
      if(!improved)break;
    }
    if(sw>0) dbg(`Swap ${pass.nom}: ${sw}`);
    await sl(0);
  }

  return {planning,warnings,diagnostic,tracker,quotas};
}

function swapValide(planning,ds,plage,idIn,idOut,reqMin,dow){
  const eOut=educById(idOut); if(!eOut) return false;
  if(!(eOut.jours||[]).includes(dow)||isAbsent(eOut.id,ds)) return false;
  const newIds=(planning[ds][plage.id]||[]).map(x=>+x).filter(x=>x!==idIn).concat(idOut);
  if(newIds.length<reqMin) return false;
  if((planning[ds][plage.id]||[]).map(x=>+x).includes(idOut)) return false;
  if(!isReunion(plage)&&!eOut.acceptePause){
    const autreTerrain=Object.keys(planning[ds]||{}).some(pid=>{
      if(pid.startsWith('_')) return false;
      const p=plageById(+pid); if(!p||isReunion(p)) return false;
      return (planning[ds][pid]||[]).map(x=>+x).includes(idOut);
    });
    if(autreTerrain) return false;
  }
  return true;
}

// ================================================================
// VALIDATION (toujours sauvegarder — planning partiel accepté)
// ================================================================
function validatePlanning(planning,moisStr,tracker,quotas){
  const [yr,mo]=moisStr.split('-').map(Number);
  const jours=getDays(yr,mo);
  const errors=[],warns=[];

  jours.forEach(d=>{
    const ds=dayStr(d),dow=dowIdx(d),we=isWEDay(d),fe=isFerie(ds);
    const dc=(fe&&!we)?5:dow;
    plages.filter(p=>p.jours.includes(dc)).forEach(p=>{
      const ids=((planning[ds]||{})[p.id]||[]);
      if(ids.length<(+p.min||1))
        errors.push(`${ds} - ${p.nom}: ${ids.length}/${p.min} educs`);
    });
  });

  const nTot={},wTot={},hTot={};
  educs.forEach(e=>{nTot[e.id]=0;wTot[e.id]=0;hTot[e.id]=tracker?tracker[e.id]?.h||0:0;});
  jours.forEach(d=>{
    const ds=dayStr(d),we=isWEDay(d);
    plages.forEach(p=>{
      ((planning[ds]||{})[p.id]||[]).forEach(id=>{
        if(isNuitP(p)&&!isReunion(p)) nTot[+id]=(nTot[+id]||0)+1;
        if(we) wTot[+id]=(wTot[+id]||0)+1;
      });
    });
  });

  const avgNN=moyPond(educs,e=>nTot[e.id]||0); let ecNMax=0;
  educs.forEach(e=>{
    const myN=norm(nTot[e.id]||0,e), ec=Math.abs(myN-avgNN);
    if(ec>ecNMax) ecNMax=ec;
    if(ec>4) warns.push(`Nuits : ${e.prenom} ecart ${ec.toFixed(1)}`);
  });
  let ecHMax=0;
  educs.forEach(e=>{
    const s=hTot[e.id]-(quotas?quotas[e.id]?.h.cible||0:0);
    if(Math.abs(s)>ecHMax) ecHMax=Math.abs(s);
    if(Math.abs(s)>15) warns.push(`Solde ${e.prenom}: ${s>=0?'+':''}${s.toFixed(1)}h`);
  });

  const metrics={
    equite:Math.max(0,100-ecNMax*12),
    stabilite:85,
    couverture:errors.length===0?100:Math.max(0,100-errors.length*15),
    prefs:Math.max(0,100-warns.filter(w=>w.includes('demande')).length*10)
  };
  return {valid:true,errors,warnings:warns,metrics};
}

function planningQualityScore(validation){
  const m=validation.metrics||{equite:50,stabilite:50,couverture:50,prefs:50};
  const score=Math.round(m.equite*0.30+m.stabilite*0.30+m.couverture*0.30+m.prefs*0.10);
  const label=score>=85?'Excellent':score>=70?'Bon':score>=55?'Moyen':'À améliorer';
  return {score,label,details:m};
}
