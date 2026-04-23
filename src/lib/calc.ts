export interface CostItem {
  id: number;
  cat: 'folha' | 'ferramentas' | 'opex';
  desc: string;
  monthly: number;
  startM: number;
  endM: number;
}

export interface KPI {
  id: number;
  metric: string;
  target: string;
}

export interface Initiative {
  id: number;
  name: string;
  area: string;
  subarea: string;
  pct: number;
  kpis: KPI[];
}

export interface Phase {
  id: number;
  name: string;
  startM: number;
  endM: number;
  objective: string;
  kr: string;
  initiatives: Initiative[];
}

export interface Scenario {
  id: number;
  name: string;
  cap: number;
  eq: number;
  hFim: number;
  sub: number;
  perf: number;
  runwayTarget: number | null;
}

export interface DREState {
  captacao: number;
  equity: number;
  jurPct: number;
  caixaPct: number;
  inicioRec: number;
  hFim: number;
  mesesPlan: number;
  sub: number;
  perf: number;
  piloto: number;
  equaPayVol: number;
  equaPayTaxa: number;
  equaPayIni: number;
  revSharePct: number;
  revShareBase: number;
  revShareIni: number;
  revMult: number;
  areaCosts: Record<string, CostItem[]>;
  phases: Phase[];
  scenarios: Scenario[];
}

export interface MonthData {
  m: number;
  h: number;
  rSub: number;
  rPerf: number;
  rEquaPay: number;
  rRevShare: number;
  rec: number;
  cost: number;
  res: number;
  caixa: number;
}

export interface DRETotals {
  rec: number;
  rSub: number;
  rPerf: number;
  rEquaPay: number;
  rRevShare: number;
  opex: number;
  res: number;
}

export function calculateDRE(state: DREState): { dreData: MonthData[]; totals: DRETotals; meses: number } {
  const mesesRaw = Math.max(...state.phases.map(p => p.endM), 6);
  const meses = Math.min(36, mesesRaw);
  
  let caixa = state.captacao;
  const dreData: MonthData[] = [];
  const totals: DRETotals = { rec: 0, rSub: 0, rPerf: 0, rEquaPay: 0, rRevShare: 0, opex: 0, res: 0 };

  for (let m = 1; m <= meses; m++) {
    let h = 0;
    if (m >= state.inicioRec) {
      const ramp = meses - state.inicioRec + 1;
      h = ramp > 0 ? Math.min(state.hFim, Math.ceil((m - state.inicioRec + 1) * state.hFim / ramp)) : state.hFim;
    }
    
    const rSub = m >= state.inicioRec ? h * (state.piloto > 0 ? state.piloto : state.sub) : 0;
    const rPerf = (m >= state.inicioRec && state.piloto === 0) ? h * state.perf : 0;
    const rEquaPay = m >= state.equaPayIni ? h * state.equaPayVol * (state.equaPayTaxa / 100) : 0;
    const rRevShare = m >= state.revShareIni ? h * state.revShareBase * (state.revSharePct / 100) : 0;
    const rec = rSub + rPerf + rEquaPay + rRevShare;

    let cost = 0;
    Object.values(state.areaCosts).forEach(area => {
      area.forEach(c => {
        if (m >= c.startM && m <= c.endM) cost += c.monthly;
      });
    });

    const res = rec - cost;
    caixa += res;
    
    dreData.push({ m, h, rSub, rPerf, rEquaPay, rRevShare, rec, cost, res, caixa });
    
    totals.rec += rec;
    totals.rSub += rSub;
    totals.rPerf += rPerf;
    totals.rEquaPay += rEquaPay;
    totals.rRevShare += rRevShare;
    totals.opex += cost;
    totals.res += res;
  }

  return { dreData, totals, meses };
}

export function calcScenarioResults(s: Scenario, state: DREState, meses: number) {
  let totalCost = 0;
  for (let m = 1; m <= meses; m++) {
    let mc = 0;
    Object.values(state.areaCosts).forEach(area => {
      area.forEach(c => { if (m >= c.startM && m <= c.endM) mc += c.monthly; });
    });
    totalCost += mc;
  }
  const avgCost = totalCost / meses;
  const capNecessaria = s.runwayTarget ? s.runwayTarget * avgCost * (1 + state.caixaPct / 100) : null;
  const capEfetiva = capNecessaria !== null ? capNecessaria : s.cap;

  let caixa = capEfetiva;
  let totRec = 0;
  let totCost = 0;
  let runwayReal = 0;
  let cxSim = capEfetiva;

  for (let m = 1; m <= meses; m++) {
    let h = 0;
    if (m >= state.inicioRec) {
      const rl = meses - state.inicioRec + 1;
      h = rl > 0 ? Math.min(s.hFim, Math.ceil((m - state.inicioRec + 1) * s.hFim / rl)) : s.hFim;
    }
    const rec = (m >= state.inicioRec ? h * (s.sub + s.perf) : 0) +
                (m >= state.equaPayIni ? h * state.equaPayVol * (state.equaPayTaxa / 100) : 0) +
                (m >= state.revShareIni ? h * state.revShareBase * (state.revSharePct / 100) : 0);
    
    let c = 0;
    Object.values(state.areaCosts).forEach(area => {
      area.forEach(ci => { if (m >= ci.startM && m <= ci.endM) c += ci.monthly; });
    });
    
    caixa += (rec - c);
    totRec += rec;
    totCost += c;

    cxSim -= c;
    if (cxSim > 0) runwayReal = m;
  }
  
  const pre = s.eq > 0 ? (capEfetiva / (s.eq / 100)) - capEfetiva : 0;
  
  return { capNecessaria, capEfetiva, pre, runwayReal, caixaFinal: caixa, recTotal: totRec, resultado: totRec - totCost };
}
