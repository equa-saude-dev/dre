'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Plot from '@/components/DynamicPlot';
import { fetchStateAction, saveStateAction } from '@/app/actions';
import { DREState, KPI, Initiative, Phase, Scenario, CostItem, MonthData } from '@/lib/calc';



// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const AREA_LIST = ['produto', 'comercial', 'operacoes', 'juridico'];
const AREA_LABELS: Record<string, string> = { produto: 'Produto & Tech', comercial: 'Comercial & Marketing', operacoes: 'Operações / CS', juridico: 'Jurídico / Adm', outro: 'Outro' };
const AREA_COLORS: Record<string, string> = { produto: '#7C5CFC', comercial: '#A78BFA', operacoes: '#437a22', juridico: '#964219', outro: '#9896a0' };
const CAT_LABELS: Record<string, string> = { folha: 'Folha / RH', ferramentas: 'Ferramentas & SaaS', opex: 'Despesas operacionais' };

// ─── TOOLTIPS — descrição de cada campo ───────────────────────────────────────
const FIELD_HINTS: Record<string, string> = {
  captacao:     'Valor total captado na rodada. Entra como caixa inicial na DRE: Caixa M0 = Captação.',
  equity:       'Percentual do equity cedido aos investidores. Usado para calcular Pré-money = Captação ÷ Equity% – Captação.',
  hFim:         'Número de hospitais ativos ao final do período. A rampa de adesão é linear a partir do mês de início da receita.',
  mesesPlan:    'Horizonte de planejamento em meses (6–36). Fonte de verdade para DRE, GTM e Cenários. Se os milestones ultrapassarem esse valor, o mês máximo dos milestones prevalece.',
  inicioRec:    'Mês em que o primeiro contrato entra em vigor e gera receita. Antes desse mês, toda receita é R$ 0.',
  sub:          'Receita mensal fixa por contrato de glosas. Fórmula: Subscription = Hospitais × Ticket.',
  perf:         'Receita variável mensal por contrato atrelada ao desempenho. Fórmula: Perf. Fee = Hospitais × Fee. Ativo apenas quando Piloto = 0.',
  piloto:       'Receita mensal durante fase piloto. Se > 0, substitui Subscription + Perf. Fee. Use 0 para piloto gratuito.',
  equaPayVol:   'Faturamento médio mensal do hospital (base de recebíveis). Equa Pay adianta esse valor. Fórmula: Volume Total = Hospitais × Faturamento hosp.',
  equaPayTaxa:  'Taxa de antecipação cobrada sobre o faturamento do hospital. Revenue Share = Taxa% × Faturamento hosp × Hospitais. Começa no mês definido em "Mês de início Revenue Share".',
  revSharePct:  'Percentual de Revenue Share cobrado sobre o faturamento antecipado. Receita Rev Share = RevShare% × Faturamento hosp × Hospitais.',
  revShareBase: 'Faturamento mensal médio do hospital — base para cálculo do Revenue Share. Equivale ao volume de recebíveis por hospital.',
  revShareIni:  'Mês de início do Equa Pay e Revenue Share na DRE. Antes desse mês, ambas as receitas são R$ 0.',
  jurPct:       'Porcentagem fixa de custo jurídico/administrativo aplicada como base. Iniciativas de área jurídico somam por cima.',
  caixaPct:     'Reserva de caixa segregada do modelo financeiro. Não entra no cálculo do resultado operacional.',
  revMult:      'Múltiplo de ARR (Annual Recurring Revenue) usado para calcular o valuation por milestone. Valuation = ARR × Múltiplo.',
};

const DEFAULT_STATE: DREState = {
  captacao: 400000, equity: 7, jurPct: 8, caixaPct: 20, inicioRec: 6, hFim: 10, mesesPlan: 18,
  sub: 20000, perf: 10000, piloto: 0,
  equaPayVol: 80000, equaPayTaxa: 2.5, equaPayIni: 8,
  revSharePct: 8, revShareBase: 80000, revShareIni: 8,
  revMult: 5,
  areaCosts: {
    produto: [
      { id: 101, cat: 'folha', desc: 'CTO / Dev Fullstack', monthly: 12000, startM: 1, endM: 18 },
      { id: 102, cat: 'folha', desc: 'Dev Backend PJ', monthly: 8000, startM: 4, endM: 18 },
      { id: 103, cat: 'ferramentas', desc: 'Google Cloud / Vertex AI', monthly: 1500, startM: 1, endM: 18 },
    ],
    comercial: [
      { id: 201, cat: 'folha', desc: 'Head Comercial part-time', monthly: 6000, startM: 3, endM: 18 },
      { id: 202, cat: 'ferramentas', desc: 'CRM HubSpot', monthly: 400, startM: 2, endM: 18 },
    ],
    operacoes: [{ id: 301, cat: 'folha', desc: 'Customer Success', monthly: 4000, startM: 2, endM: 18 }],
    juridico: [{ id: 401, cat: 'folha', desc: 'Advogado retainer', monthly: 3000, startM: 1, endM: 18 }],
    outro: [],
  },
  scenarios: [
    { id: 1, name: 'Conservador', cap: 300000, eq: 8, hFim: 7, sub: 15000, perf: 7000, runwayTarget: null },
    { id: 2, name: 'Base', cap: 400000, eq: 7, hFim: 10, sub: 20000, perf: 10000, runwayTarget: null },
    { id: 3, name: 'Otimista', cap: 600000, eq: 8, hFim: 15, sub: 22000, perf: 12000, runwayTarget: null },
  ],
  phases: [
    { id: 1, name: 'M1 · Validação', startM: 1, endM: 6, objective: 'Fechar 1 hospital e provar ROI', kr: '1 hospital ativo, ROI demonstrado',
      initiatives: [
        { id: 10, name: 'MVP Produto Core', area: 'produto', subarea: 'Plataforma', pct: 60, kpis: [{ id: 2001, metric: 'Funcionalidades entregues', target: '5 módulos' }] },
        { id: 11, name: 'Setup Comercial', area: 'comercial', subarea: 'Vendas Diretas', pct: 20, kpis: [{ id: 2002, metric: 'Demos realizadas', target: '10' }] },
      ]
    },
    { id: 2, name: 'M2 · Piloto', startM: 7, endM: 12, objective: '3 hospitais pagantes, NPS ≥ 40', kr: 'MRR ≥ R$ 90k, churn = 0',
      initiatives: [
        { id: 12, name: 'Expansão Comercial', area: 'comercial', subarea: 'Vendas Diretas', pct: 40, kpis: [{ id: 2003, metric: 'Contratos fechados', target: '3' }] },
        { id: 13, name: 'CS & Onboarding', area: 'operacoes', subarea: 'Customer Success', pct: 30, kpis: [{ id: 2004, metric: 'Tempo onboarding', target: '< 30 dias' }] },
        { id: 14, name: 'Equa Pay MVP', area: 'produto', subarea: 'Fintech / Pay', pct: 30, kpis: [{ id: 2005, metric: 'Volume antecipado', target: 'R$ 500k' }] },
      ]
    },
    { id: 3, name: 'M3 · Escala', startM: 13, endM: 18, objective: '10 hospitais, Equa Pay operacional', kr: 'MRR ≥ R$ 200k',
      initiatives: [
        { id: 15, name: 'Growth & Marketing', area: 'comercial', subarea: 'Marketing', pct: 35, kpis: [{ id: 2006, metric: 'Hospitais ativos', target: '10' }] },
        { id: 16, name: 'Produto Avançado', area: 'produto', subarea: 'Plataforma', pct: 40, kpis: [{ id: 2007, metric: 'Integrações TISS', target: '3' }] },
        { id: 17, name: 'Rev Share Launch', area: 'comercial', subarea: 'Parcerias', pct: 25, kpis: [{ id: 2008, metric: 'Contratos Rev Share', target: '5' }] },
      ]
    },
  ],
};

// ─── FORMATTERS ───────────────────────────────────────────────────────────────
let _uid = 3000;
const uid = () => ++_uid;
const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);

// ─── CALC ENGINE ──────────────────────────────────────────────────────────────
function calcMeses(state: DREState) {
  const fromPhases = state.phases.reduce((max, p) => Math.max(max, p.endM), 0);
  const planned = state.mesesPlan || 18;
  return Math.min(36, Math.max(fromPhases, planned));
}

function calcDRE(state: DREState) {
  const meses = calcMeses(state);
  let caixa = state.captacao;
  const dreData: MonthData[] = [];
  const totals = { rec: 0, rSub: 0, rPerf: 0, rEquaPay: 0, rRevShare: 0, opex: 0, res: 0 };

  for (let m = 1; m <= meses; m++) {
    let h = 0;
    if (m >= state.inicioRec) {
      const ramp = meses - state.inicioRec + 1;
      h = ramp > 0 ? Math.min(state.hFim, Math.ceil((m - state.inicioRec + 1) * state.hFim / ramp)) : state.hFim;
    }
    const rSub = m >= state.inicioRec ? h * (state.piloto > 0 ? state.piloto : state.sub) : 0;
    const rPerf = (m >= state.inicioRec && state.piloto === 0) ? h * state.perf : 0;
    // Equa Pay começa no mesmo mês do Revenue Share
    const rEquaPay = m >= state.revShareIni ? h * state.equaPayVol * (state.equaPayTaxa / 100) : 0;
    const rRevShare = m >= state.revShareIni ? h * state.revShareBase * (state.revSharePct / 100) : 0;
    const rec = rSub + rPerf + rEquaPay + rRevShare;
    let cost = 0;
    Object.values(state.areaCosts).forEach(area => area.forEach(c => { if (m >= c.startM && m <= c.endM) cost += c.monthly; }));
    const res = rec - cost;
    caixa += res;
    dreData.push({ m, h, rSub, rPerf, rEquaPay, rRevShare, rec, cost, res, caixa });
    totals.rec += rec; totals.rSub += rSub; totals.rPerf += rPerf;
    totals.rEquaPay += rEquaPay; totals.rRevShare += rRevShare; totals.opex += cost; totals.res += res;
  }
  return { dreData, totals, meses };
}

function calcScenario(s: Scenario, state: DREState, meses: number) {
  let totalCost = 0;
  for (let m = 1; m <= meses; m++) {
    let mc = 0;
    Object.values(state.areaCosts).forEach(area => area.forEach(c => { if (m >= c.startM && m <= c.endM) mc += c.monthly; }));
    totalCost += mc;
  }
  const avgCost = meses > 0 ? totalCost / meses : 0;
  const capNecessaria = (s.runwayTarget && s.runwayTarget > 0) ? s.runwayTarget * avgCost * (1 + state.caixaPct / 100) : null;
  const capEfetiva = capNecessaria !== null ? capNecessaria : s.cap;

  let caixa = capEfetiva, totRec = 0, totCost = 0, runwayReal = 0;
  let cxSim = capEfetiva;
  const ini = state.inicioRec;

  for (let m = 1; m <= meses; m++) {
    let h = 0;
    if (m >= ini) { const rl = meses - ini + 1; h = rl > 0 ? Math.min(s.hFim, Math.ceil((m - ini + 1) * s.hFim / rl)) : s.hFim; }
    const rec = (m >= ini ? h * (s.sub + s.perf) : 0)
      + (m >= state.revShareIni ? h * state.equaPayVol * (state.equaPayTaxa / 100) : 0)
      + (m >= state.revShareIni ? h * state.revShareBase * (state.revSharePct / 100) : 0);
    let c = 0;
    Object.values(state.areaCosts).forEach(area => area.forEach(ci => { if (m >= ci.startM && m <= ci.endM) c += ci.monthly; }));
    caixa += (rec - c); totRec += rec; totCost += c;
    cxSim -= c;
    if (cxSim > 0) runwayReal = m;
  }
  const pre = s.eq > 0 ? capEfetiva / (s.eq / 100) - capEfetiva : 0;
  return { capNecessaria, capEfetiva, pre, runwayReal, caixaFinal: caixa, recTotal: totRec, resultado: totRec - totCost };
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DREDashboard() {
  const [state, setState] = useState<DREState>(DEFAULT_STATE);
  const [activeTab, setActiveTab] = useState('resumo');
  const [theme, setTheme] = useState('dark'); // default dark
  const isDark = theme === 'dark';
  const [prem, setPrem] = useState<Partial<DREState>>({});
  const [premDirty, setPremDirty] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from Supabase and fallback to localStorage
  useEffect(() => {
    async function loadData() {
      try {
        const serverState = await fetchStateAction();
        if (serverState && Object.keys(serverState).length > 0) {
          if (!(serverState as any).mesesPlan) (serverState as any).mesesPlan = 18;
          setState(serverState as any);
        } else {
          throw new Error('No server state');
        }
      } catch (err) {
        console.warn('Fallback to local storage:', err);
        const saved = localStorage.getItem('dre_state_v18');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!parsed.mesesPlan) parsed.mesesPlan = 18;
          setState(parsed);
        }
      } finally {
        setIsLoaded(true);
      }
    }
    loadData();

    try {
      const savedTheme = localStorage.getItem('dre_theme') || 'dark';
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } catch {}
  }, []);

  // Sync theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('dre_theme', theme); } catch {}
  }, [theme]);

  // Save to localStorage and Supabase
  const handleUpdate = useCallback((updates: Partial<DREState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      
      // 1. Local Persistence (Sync)
      try { 
        localStorage.setItem('dre_state_v18', JSON.stringify(next)); 
      } catch (e) {}
      
      // 2. Schedule Supabase Sync (Async/Outside updater)
      // We don't call it here to keep the updater pure
      return next;
    });
  }, []);

  // Effect to handle Supabase Sync after state updates
  useEffect(() => {
    if (!isLoaded) return; // Don't save before initial load is complete

    const timer = setTimeout(async () => {
      setIsSyncing(true);
      try {
        await saveStateAction(state);
        console.log('✅ Supabase synced');
      } catch (err) {
        console.error('❌ Supabase sync failed:', err);
      } finally {
        setIsSyncing(false);
      }
    }, 1500); // Debounce 1.5s to avoid hitting Supabase too hard

    return () => clearTimeout(timer);
  }, [state, isLoaded]);

  const { dreData, totals, meses } = useMemo(() => calcDRE(state), [state]);
  const postMoney = state.equity > 0 ? state.captacao / (state.equity / 100) : 0;
  const preMoney = postMoney - state.captacao;
  const lastD = dreData[dreData.length - 1];

  // Chart colors from current theme
  const txtColor = isDark ? '#f0eeff' : '#1a1825';
  const gridColor = isDark ? '#2e2c3e' : '#e8e6e1';
  const getLayout = (extra: object = {}): object => ({
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'Satoshi,sans-serif', color: txtColor, size: 12 },
    xaxis: { gridcolor: gridColor, color: txtColor },
    yaxis: { gridcolor: gridColor, color: txtColor, tickprefix: 'R$ ', tickformat: ',.0f' },
    autosize: true,
    ...extra,
  });
  const xs = dreData.map(d => `M${d.m}`);
  const chartConfig = { displayModeBar: false, responsive: true };

  // Premissas pending helpers
  const getPrem = <K extends keyof DREState>(k: K): DREState[K] => (k in prem ? (prem as DREState)[k] : state[k]);
  const setPremField = <K extends keyof DREState>(k: K, v: DREState[K]) => {
    setPrem(p => ({ ...p, [k]: v }));
    setPremDirty(true);
  };
  const applyPremissas = () => { handleUpdate(prem); setPrem({}); setPremDirty(false); };

  // Tooltip helper
  const InfoBtn = ({ field }: { field: string }) => (
    <span
      style={{ cursor: 'help', fontSize: '.78rem', color: 'var(--pri)', userSelect: 'none', marginLeft: '4px', fontWeight: 700 }}
      title={FIELD_HINTS[field] || ''}
      onClick={() => setTooltip(tooltip === field ? null : field)}
    >ⓘ</span>
  );
  const TooltipBox = ({ field }: { field: string }) =>
    tooltip === field ? (
      <div style={{ fontSize: '.75rem', color: 'var(--txm)', background: 'var(--sur2)', border: '1px solid var(--bor)', borderRadius: '.5rem', padding: '.5rem .75rem', marginTop: '.25rem', lineHeight: 1.5 }}>
        {FIELD_HINTS[field]}
      </div>
    ) : null;

  // ─── ROADMAP handlers ──────────────────────────────────────────────────────
  const addMilestone = () => {
    const last = state.phases.reduce((m, p) => Math.max(m, p.endM), 0);
    handleUpdate({ phases: [...state.phases, { id: uid(), name: `M${state.phases.length + 1} · Novo Milestone`, startM: last + 1, endM: last + 6, objective: '', kr: '', initiatives: [{ id: uid(), name: 'Nova iniciativa', area: 'produto', subarea: '', pct: 0, kpis: [{ id: uid(), metric: 'Nova métrica', target: 'Meta' }] }] }] });
  };
  const delMilestone = (pid: number) => handleUpdate({ phases: state.phases.filter(p => p.id !== pid) });
  const updPhase = (pid: number, patch: Partial<Phase>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, ...patch } : p) });
  const addInitiative = (pid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: [...p.initiatives, { id: uid(), name: 'Nova iniciativa', area: 'produto', subarea: '', pct: 0, kpis: [{ id: uid(), metric: 'Nova métrica', target: 'Meta' }] }] } : p) });
  const delInitiative = (pid: number, iid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.filter(i => i.id !== iid) } : p) });
  const updInitiative = (pid: number, iid: number, patch: Partial<Initiative>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, ...patch } : i) } : p) });
  const addKPI = (pid: number, iid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: [...i.kpis, { id: uid(), metric: 'Nova métrica', target: 'Meta' }] } : i) } : p) });
  const delKPI = (pid: number, iid: number, kid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: i.kpis.filter(k => k.id !== kid) } : i) } : p) });
  const updKPI = (pid: number, iid: number, kid: number, patch: Partial<KPI>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: i.kpis.map(k => k.id === kid ? { ...k, ...patch } : k) } : i) } : p) });

  // ─── COSTS handlers ──────────────────────────────────────────────────────
  const addCost = (area: string) => { const nc = { ...state.areaCosts }; nc[area] = [...nc[area], { id: uid(), cat: 'folha', desc: 'Novo item', monthly: 0, startM: 1, endM: meses }]; handleUpdate({ areaCosts: nc }); };
  const delCost = (area: string, cid: number) => { const nc = { ...state.areaCosts }; nc[area] = nc[area].filter(c => c.id !== cid); handleUpdate({ areaCosts: nc }); };
  const updCost = (area: string, cid: number, patch: Partial<CostItem>) => { const nc = { ...state.areaCosts }; nc[area] = nc[area].map(c => c.id === cid ? { ...c, ...patch } : c); handleUpdate({ areaCosts: nc }); };

  // ─── SCENARIO handlers ──────────────────────────────────────────────────
  const addScenario = () => handleUpdate({ scenarios: [...state.scenarios, { id: uid(), name: 'Novo Cenário', cap: state.captacao, eq: state.equity, hFim: state.hFim, sub: state.sub, perf: state.perf, runwayTarget: null }] });
  const delScenario = (sid: number) => handleUpdate({ scenarios: state.scenarios.filter(s => s.id !== sid) });
  const updScenario = (sid: number, patch: Partial<Scenario>) => handleUpdate({ scenarios: state.scenarios.map(s => s.id === sid ? { ...s, ...patch } : s) });

  // ─── ALLOC calc (from areaCosts, source of truth) ────────────────────────
  const allocAreas: Record<string, number> = {};
  let allocTotal = 0;
  for (let m = 1; m <= meses; m++) {
    Object.keys(state.areaCosts).forEach(a => {
      (state.areaCosts[a] || []).forEach(c => {
        if (m >= c.startM && m <= c.endM) { allocAreas[a] = (allocAreas[a] || 0) + c.monthly; allocTotal += c.monthly; }
      });
    });
  }

  const leituraText = lastD ? `Com captação de ${BRL(state.captacao)} (${state.equity}% equity) e ${meses} meses de horizonte, a empresa atinge ${lastD.h} hospitais e encerra o período com caixa ${lastD.caixa > 0 ? 'positivo' : 'negativo'} de ${BRL(lastD.caixa)}. Receita total: ${BRL(totals.rec)}${totals.rEquaPay > 0 ? ` (inclui ${BRL(totals.rEquaPay)} Equa Pay + ${BRL(totals.rRevShare)} Rev Share).` : '.'}` : '';

  return (
    <div className="app">
      {/* HEADER */}
      <div className="hero">
        <div className="hero-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="app-title">Equa — DRE</span>
            <span style={{ fontSize: '0.7rem', background: '#14a08c', color: 'white', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>V1.1 - Supabase</span>
            {isSyncing && <span style={{ fontSize: '0.7rem', color: 'var(--txm)', fontStyle: 'italic' }}>🔄 Sincronizando...</span>}
          </div>
          <span className="hero-desc">Modelo financeiro dinâmico. Altere premissas, OKRs ou milestones para ver DRE, caixa e cenários em tempo real.</span>
          
          {(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && (
            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,0,0,0.1)', border: '1px solid red', borderRadius: '5px', color: 'red', fontSize: '0.8rem' }}>
              ⚠️ Erro de Configuração: Variáveis do Supabase não encontradas no ambiente.
            </div>
          )}
        </div>
        <button className="btn-theme" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? 'Tema escuro' : 'Tema claro'}
        </button>
      </div>

      {/* TABS */}
      <div className="tabs">
        {[['resumo','Resumo'],['premissas','Premissas'],['roadmap','GTM / OKRs'],['dre','DRE'],['cenarios','Cenários']].map(([k,l]) => (
          <button key={k} className={`tab-btn${activeTab===k?' active':''}`} onClick={() => setActiveTab(k)}>{l}</button>
        ))}
      </div>

      {/* ─── RESUMO ─────────────────────────────────────────────── */}
      {activeTab === 'resumo' && (
        <section className="tab-panel active g2">
          <div className="panel">
            <div className="ph"><h2>Resumo executivo</h2><span className="pill">{meses} meses</span></div>
            <div className="pb">
              <div className="mg">
                <div className="metric"><span>Captação</span><strong>{BRL(state.captacao)}</strong></div>
                <div className="metric"><span>Pré-money</span><strong>{BRL(preMoney)}</strong></div>
                <div className="metric"><span>Pós-money</span><strong>{BRL(postMoney)}</strong></div>
                <div className="metric"><span>Equity ofertado</span><strong>{state.equity}%</strong></div>
                <div className="metric good"><span>Runway estimado</span><strong>{meses} meses</strong></div>
                <div className={`metric ${lastD && lastD.caixa > 0 ? 'good' : 'warn'}`}><span>Caixa final</span><strong>{BRL(lastD?.caixa || 0)}</strong></div>
                <div className="metric"><span>Hospitais ao final</span><strong>{lastD?.h || 0}</strong></div>
                <div className="metric"><span>Receita total</span><strong>{BRL(totals.rec)}</strong></div>
                <div className={`metric ${totals.res >= 0 ? 'good' : 'bad'}`}><span>Resultado operacional</span><strong>{BRL(totals.res)}</strong></div>
                <div className="metric"><span>OPEX total</span><strong>{BRL(totals.opex)}</strong></div>
                <div className="metric ep"><span>Equa Pay (total)</span><strong>{BRL(totals.rEquaPay)}</strong></div>
                <div className="metric"><span>Revenue Share (total)</span><strong>{BRL(totals.rRevShare)}</strong></div>
                <div className="metric"><span>Performance Fee (total)</span><strong>{BRL(totals.rPerf)}</strong></div>
              </div>

              <span className="lbl">Alocação por área</span>
              <div className="alloc-grid">
                {Object.keys(AREA_COLORS).filter(a => (allocAreas[a] || 0) > 0).map(a => {
                  const pct = allocTotal > 0 ? (allocAreas[a] / allocTotal * 100) : 0;
                  return (
                    <div key={a} className="alloc-card">
                      <div className="a-label">{AREA_LABELS[a]}</div>
                      <div className="a-pct" style={{ color: AREA_COLORS[a] }}>{pct.toFixed(0)}%</div>
                      <div className="a-val">{BRL(allocAreas[a] || 0)}</div>
                      <div className="a-bar" style={{ background: AREA_COLORS[a], width: `${pct}%` }}></div>
                    </div>
                  );
                })}
              </div>

              <span className="lbl" style={{ marginTop: '1.1rem' }}>Leitura</span>
              <p className="note">{leituraText}</p>
            </div>
          </div>

          <div className="panel">
            <div className="ph"><h2>Evolução mensal</h2></div>
            <div className="pb-nopad">
              <div style={{ padding: '1.25rem 1.25rem 0' }}>
                <Plot
                  data={[
                    { type: 'bar', name: 'Subscription', x: xs, y: dreData.map(d => d.rSub), marker: { color: '#7C5CFC' } },
                    { type: 'bar', name: 'Perf. Fee', x: xs, y: dreData.map(d => d.rPerf), marker: { color: '#A78BFA' } },
                    { type: 'bar', name: 'Equa Pay', x: xs, y: dreData.map(d => d.rEquaPay), marker: { color: '#14a08c' } },
                    { type: 'bar', name: 'Revenue Share', x: xs, y: dreData.map(d => d.rRevShare), marker: { color: '#437a22' } },
                    { type: 'scatter', mode: 'lines', name: 'Custos', x: xs, y: dreData.map(d => d.cost), line: { color: '#964219', width: 2, dash: 'dot' } as any },
                  ] as any}
                  layout={getLayout({ barmode: 'stack', margin: { t: 20, r: 10, b: 40, l: 80 }, legend: { orientation: 'h', y: -0.15 }, height: 280 }) as any}
                  style={{ width: '100%' }} config={chartConfig} useResizeHandler
                />
              </div>
              <div style={{ padding: '.5rem 1.25rem 1.25rem' }}>
                <Plot
                  data={[{ type: 'scatter', mode: 'lines', name: 'Caixa acumulado', x: xs, y: dreData.map(d => d.caixa), fill: 'tozeroy', fillcolor: 'rgba(124,92,252,.1)', line: { color: '#7C5CFC', width: 2.5 } as any }] as any}
                  layout={getLayout({ margin: { t: 10, r: 10, b: 40, l: 80 }, height: 220 }) as any}
                  style={{ width: '100%' }} config={chartConfig} useResizeHandler
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── PREMISSAS ──────────────────────────────────────────── */}
      {activeTab === 'premissas' && (
        <section className="tab-panel g1 active">
          <div className="panel">
            <div className="ph">
              <h2>Premissas da rodada</h2>
              {premDirty && <span style={{ fontSize: '.78rem', color: 'var(--war)', fontWeight: 600 }}>⚠ Alterações pendentes — clique em Aplicar</span>}
            </div>
            <div className="pb">
              {/* ── Rodada ── */}
              <div className="fields sub4">
                <PHintField label="Captação (R$)" field="captacao" value={getPrem('captacao') as number}
                  onChange={v => setPremField('captacao', Number(v))} hint={FIELD_HINTS.captacao}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
                <PHintField label="Equity %" field="equity" step={0.1} value={getPrem('equity') as number}
                  onChange={v => setPremField('equity', Number(v))} hint={FIELD_HINTS.equity}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
                <PHintField label="Hospitais alvo" field="hFim" value={getPrem('hFim') as number}
                  onChange={v => setPremField('hFim', Number(v))} hint={FIELD_HINTS.hFim}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
                <PHintField label="Prazo total (meses)" field="mesesPlan" min={6} max={36} value={getPrem('mesesPlan') as number}
                  onChange={v => setPremField('mesesPlan', Math.min(36, Math.max(6, Number(v))))} hint={FIELD_HINTS.mesesPlan}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              </div>
              <div className="fields sub2" style={{ marginTop: '.875rem' }}>
                <PHintField label="Início 1ª receita (mês)" field="inicioRec" value={getPrem('inicioRec') as number}
                  onChange={v => setPremField('inicioRec', Number(v))} hint={FIELD_HINTS.inicioRec}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              </div>

              {/* ── Receita Core ── */}
              <span className="lbl" style={{ marginTop: '1.25rem' }}>🏥 Receita Core — Glosas</span>
              <div className="fields sub3">
                <PHintField label="Subscription / contrato (R$)" field="sub" value={getPrem('sub') as number}
                  onChange={v => setPremField('sub', Number(v))} hint={FIELD_HINTS.sub}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
                <PHintField label="Performance Fee / contrato (R$)" field="perf" value={getPrem('perf') as number}
                  onChange={v => setPremField('perf', Number(v))} hint={FIELD_HINTS.perf}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
                <div className="field">
                  <label>Receita piloto / mês (R$) <InfoBtn field="piloto" /></label>
                  <input type="number" value={getPrem('piloto') as number} onChange={e => setPremField('piloto', Number(e.target.value))} />
                  <small>0 = piloto gratuito</small>
                  <TooltipBox field="piloto" />
                </div>
              </div>

              {/* ── Equa Pay ── */}
              <span className="lbl" style={{ marginTop: '1.25rem' }}>
                <span className="equapay-note" style={{ fontSize: '.8rem' }}>⚡ Equa Pay — Antecipação de Recebíveis</span>
              </span>
              <div className="fields sub2">
                <PHintField label="Faturamento do hospital / mês (R$)" field="equaPayVol" value={getPrem('equaPayVol') as number}
                  onChange={v => setPremField('equaPayVol', Number(v))} hint={FIELD_HINTS.equaPayVol}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
                <div className="field">
                  <label>Taxa de antecipação (%) <InfoBtn field="equaPayTaxa" /></label>
                  <input type="number" step={0.1} value={getPrem('equaPayTaxa') as number} onChange={e => setPremField('equaPayTaxa', Number(e.target.value))} />
                  <small>Cobrada sobre o faturamento do hospital</small>
                  <TooltipBox field="equaPayTaxa" />
                </div>
              </div>

              {/* ── Revenue Share ── */}
              <span className="lbl" style={{ marginTop: '1.25rem' }}>📊 Revenue Share</span>
              <div className="fields sub3">
                <div className="field">
                  <label>Revenue Share (%) <InfoBtn field="revSharePct" /></label>
                  <input type="number" step={0.5} value={getPrem('revSharePct') as number} onChange={e => setPremField('revSharePct', Number(e.target.value))} />
                  <small>% sobre o faturamento antecipado do hospital</small>
                  <TooltipBox field="revSharePct" />
                </div>
                <PHintField label="Faturamento do hospital / hosp / mês (R$)" field="revShareBase" value={getPrem('revShareBase') as number}
                  onChange={v => setPremField('revShareBase', Number(v))} hint={FIELD_HINTS.revShareBase}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
                <PHintField label="Mês de início (Equa Pay + Rev. Share)" field="revShareIni" value={getPrem('revShareIni') as number}
                  onChange={v => setPremField('revShareIni', Number(v))} hint={FIELD_HINTS.revShareIni}
                  tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              </div>

              {/* ── Alocação fixa ── */}
              <span className="lbl" style={{ marginTop: '1.25rem' }}>Alocação fixa</span>
              <div className="fields sub2">
                <div className="field">
                  <label>Jurídico/Adm base % <InfoBtn field="jurPct" /></label>
                  <input type="number" value={getPrem('jurPct') as number} onChange={e => setPremField('jurPct', Number(e.target.value))} />
                  <small>Base fixa; iniciativas jurídico somam por cima</small>
                  <TooltipBox field="jurPct" />
                </div>
                <div className="field">
                  <label>Caixa/Runway % <InfoBtn field="caixaPct" /></label>
                  <input type="number" value={getPrem('caixaPct') as number} onChange={e => setPremField('caixaPct', Number(e.target.value))} />
                  <small>Reserva segregada fora da DRE</small>
                  <TooltipBox field="caixaPct" />
                </div>
              </div>

              <div className="actions" style={{ marginTop: '1.25rem' }}>
                <button className="btn pri" onClick={applyPremissas} style={{ opacity: premDirty ? 1 : 0.55 }}>
                  ✓ Aplicar premissas
                </button>
                {premDirty && <button className="btn" onClick={() => { setPrem({}); setPremDirty(false); }}>Descartar</button>}
              </div>
            </div>
          </div>

          {/* ── Custos ── */}
          <div className="panel">
            <div className="ph"><h2>Estrutura de Custos por Área</h2><span className="derived-note">Alimenta a DRE diretamente</span></div>
            <div className="pb">
              <p className="note" style={{ marginBottom: '1rem' }}>Detalhe os custos reais por área: <strong>Folha/RH</strong>, <strong>Ferramentas & SaaS</strong>, <strong>Despesas operacionais</strong>. Cada item tem mês de início e fim.</p>
              {AREA_LIST.map(area => {
                const items = state.areaCosts[area] || [];
                const total = items.reduce((a, c) => a + c.monthly, 0);
                return (
                  <div key={area} className="custo-panel">
                    <div className="custo-header">
                      <div>
                        <span className="custo-area-name">{AREA_LABELS[area]}</span>
                        <div className="custo-summary">
                          <span className="pill">{BRL(total)}/mês médio</span>
                          <span className="pill war">{items.length} itens</span>
                        </div>
                      </div>
                      <button className="btn-sm" onClick={() => addCost(area)}>+ Item</button>
                    </div>
                    <div className="custo-body">
                      <table className="cost-table">
                        <thead><tr><th>Categoria</th><th>Descrição</th><th>R$/mês</th><th>Mês ini.</th><th>Mês fim</th><th></th></tr></thead>
                        <tbody>
                          {items.map(c => (
                            <tr key={c.id}>
                              <td>
                                <select value={c.cat} onChange={e => updCost(area, c.id, { cat: e.target.value as any })}>
                                  {Object.keys(CAT_LABELS).map(cat => <option key={cat} value={cat}>{CAT_LABELS[cat]}</option>)}
                                </select>
                              </td>
                              <td><input value={c.desc} onChange={e => updCost(area, c.id, { desc: e.target.value })} placeholder="Descrição" /></td>
                              <td><input type="number" value={c.monthly} min={0} onChange={e => updCost(area, c.id, { monthly: Number(e.target.value) })} /></td>
                              <td><input type="number" value={c.startM} min={1} max={36} onChange={e => updCost(area, c.id, { startM: Number(e.target.value) })} /></td>
                              <td><input type="number" value={c.endM} min={1} max={36} onChange={e => updCost(area, c.id, { endM: Number(e.target.value) })} /></td>
                              <td><button className="btn-sm btn-danger" onClick={() => delCost(area, c.id)}>✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ─── GTM / OKRs ─────────────────────────────────────────── */}
      {activeTab === 'roadmap' && (
        <section className="tab-panel g1 active">
          <div className="panel">
            <div className="ph"><h2>GTM / OKRs por Milestone</h2><span className="derived-note">Iniciativas definem alocação e velocidade comercial</span></div>
            <div className="pb">
              <div className="stk">
                {state.phases.map(ph => (
                  <div key={ph.id} className="okr-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.875rem', flexWrap: 'wrap' }}>
                      <span className="milestone-badge">{ph.name}</span>
                      <span className="pill" style={{ fontSize: '.75rem' }}>M{ph.startM}–M{ph.endM}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: '.75rem', alignItems: 'end', marginBottom: '.75rem' }}>
                      <div className="field"><label>Nome do milestone</label><input value={ph.name} onChange={e => updPhase(ph.id, { name: e.target.value })} /></div>
                      <div className="field"><label>Objetivo</label><input value={ph.objective} onChange={e => updPhase(ph.id, { objective: e.target.value })} /></div>
                      <div className="field"><label>Mês início</label><input type="number" value={ph.startM} min={1} style={{ width: '80px' }} onChange={e => updPhase(ph.id, { startM: Number(e.target.value) })} /></div>
                      <div className="field"><label>Mês fim</label><input type="number" value={ph.endM} min={1} style={{ width: '80px' }} onChange={e => updPhase(ph.id, { endM: Number(e.target.value) })} /></div>
                    </div>
                    <div className="field" style={{ marginBottom: '.75rem' }}>
                      <label>Key Result</label>
                      <input value={ph.kr} onChange={e => updPhase(ph.id, { kr: e.target.value })} />
                    </div>
                    <table className="init-table">
                      <thead><tr><th>Iniciativa</th><th>Área</th><th>Subárea</th><th>% Aloc.</th><th></th><th></th></tr></thead>
                      <tbody>
                        {ph.initiatives.map(ini => (
                          <React.Fragment key={ini.id}>
                            <tr>
                              <td><input value={ini.name} onChange={e => updInitiative(ph.id, ini.id, { name: e.target.value })} placeholder="Nome da iniciativa" /></td>
                              <td>
                                <select value={ini.area} onChange={e => updInitiative(ph.id, ini.id, { area: e.target.value })}>
                                  {Object.keys(AREA_LABELS).map(a => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
                                </select>
                              </td>
                              <td><input value={ini.subarea || ''} onChange={e => updInitiative(ph.id, ini.id, { subarea: e.target.value })} placeholder="Ex: Plataforma" /></td>
                              <td><input type="number" value={ini.pct} min={0} max={100} style={{ width: '60px' }} onChange={e => updInitiative(ph.id, ini.id, { pct: Number(e.target.value) })} /></td>
                              <td><button className="btn-sm" onClick={() => addKPI(ph.id, ini.id)}>+ KPI</button></td>
                              <td><button className="btn-sm btn-danger" onClick={() => delInitiative(ph.id, ini.id)}>✕</button></td>
                            </tr>
                            {ini.kpis.length > 0 && (
                              <tr><td colSpan={6}>
                                <div className="kpi-block">
                                  <div className="kpi-block-header">
                                    <span className="kpi-ini-label">{ini.name}</span>
                                    <span className="kpi-ini-sub">{AREA_LABELS[ini.area]}</span>
                                    {ini.subarea && <span className="kpi-ini-sub">{ini.subarea}</span>}
                                  </div>
                                  <table className="kpi-table">
                                    <thead><tr><th>Métrica</th><th>Meta</th><th></th></tr></thead>
                                    <tbody>
                                      {ini.kpis.map(k => (
                                        <tr key={k.id}>
                                          <td><input value={k.metric} onChange={e => updKPI(ph.id, ini.id, k.id, { metric: e.target.value })} placeholder="Métrica" /></td>
                                          <td><input value={k.target} onChange={e => updKPI(ph.id, ini.id, k.id, { target: e.target.value })} placeholder="Meta" /></td>
                                          <td><button className="btn-sm btn-danger" onClick={() => delKPI(ph.id, ini.id, k.id)}>✕</button></td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td></tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                    <div className="actions" style={{ marginTop: '.6rem' }}>
                      <button className="btn-sm" onClick={() => addInitiative(ph.id)}>+ Iniciativa</button>
                      <button className="btn-sm btn-danger" onClick={() => delMilestone(ph.id)}>Remover milestone</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="actions" style={{ marginTop: '.5rem' }}>
                <button className="btn" onClick={addMilestone}>+ Adicionar milestone</button>
              </div>

              <hr className="section-divider" />
              {/* Alocação por Área — reflete Premissas */}
              <span className="lbl">Alocação por área (baseada em Premissas → Custos)</span>
              <div className="alloc-grid" style={{ marginBottom: '1.25rem' }}>
                {Object.keys(AREA_COLORS).filter(a => (allocAreas[a] || 0) > 0).map(a => {
                  const pct = allocTotal > 0 ? (allocAreas[a] / allocTotal * 100) : 0;
                  return (
                    <div key={a} className="alloc-card">
                      <div className="a-label">{AREA_LABELS[a]}</div>
                      <div className="a-pct" style={{ color: AREA_COLORS[a] }}>{pct.toFixed(0)}%</div>
                      <div className="a-val">{BRL(allocAreas[a] || 0)}</div>
                      <div className="a-bar" style={{ background: AREA_COLORS[a], width: `${pct}%` }}></div>
                    </div>
                  );
                })}
              </div>

              <hr className="section-divider" />
              <span className="lbl">Resumo consolidado por iniciativa</span>
              <div className="tw">
                <table>
                  <thead><tr>
                    <th>Milestone</th><th>Período</th><th>Iniciativa</th><th>Área</th><th>Subárea</th>
                    <th className="r">% Aloc.</th><th>KPIs</th><th>Key Result</th>
                  </tr></thead>
                  <tbody>
                    {state.phases.map(ph =>
                      ph.initiatives.map((ini, i) => {
                        const kpiStr = ini.kpis.map(k => `${k.metric}: ${k.target}`).join(' · ');
                        return (
                          <tr key={ini.id}>
                            {i === 0 && <td rowSpan={ph.initiatives.length} style={{ fontWeight: 600, verticalAlign: 'top', paddingTop: '.7rem' }}>
                              <span className="milestone-badge" style={{ fontSize: '.72rem' }}>{ph.name}</span>
                            </td>}
                            {i === 0 && <td rowSpan={ph.initiatives.length} style={{ whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: '.7rem' }}>
                              <span className="pill" style={{ fontSize: '.72rem' }}>M{ph.startM}–{ph.endM}</span>
                            </td>}
                            <td>{ini.name}</td>
                            <td><span className="pill" style={{ background: AREA_COLORS[ini.area] + '22', color: AREA_COLORS[ini.area], fontSize: '.72rem' }}>{AREA_LABELS[ini.area]}</span></td>
                            <td style={{ color: 'var(--txm)', fontSize: '.8rem' }}>{ini.subarea || '—'}</td>
                            <td className="r">{ini.pct}%</td>
                            <td style={{ fontSize: '.78rem', color: 'var(--txm)' }}>{kpiStr}</td>
                            <td style={{ fontSize: '.78rem', color: 'var(--txm)' }}>{ph.kr}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <hr className="section-divider" />
              <div className="ph" style={{ border: 'none', padding: 0, marginBottom: '.75rem' }}>
                <h2>ROI dos Investidores por Milestone</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  <span style={{ fontSize: '.8rem', color: 'var(--txf)' }}>Múltiplo de receita (ARR)</span>
                  <input type="number" value={state.revMult} min={1} max={20} step={0.5}
                    style={{ width: '70px', padding: '.35rem .6rem', border: '1px solid var(--bor)', borderRadius: '.5rem', background: 'var(--input-bg)', color: 'var(--input-text)', fontSize: '.88rem', textAlign: 'center' }}
                    onChange={e => handleUpdate({ revMult: Number(e.target.value) })} />
                  <span style={{ fontSize: '.8rem', color: 'var(--txf)' }}>x ARR</span>
                </div>
              </div>
              <div className="tw">
                <table className="roi-table">
                  <thead><tr>
                    <th>Milestone</th><th className="r">Período</th><th className="r">Rec. mensal (fim)</th>
                    <th className="r">ARR estimado</th><th className="r">Valuation (ARR×múlt.)</th>
                    <th className="r">Post-money entrada</th><th className="r">ROI investidor</th><th className="r">Múltiplo</th>
                  </tr></thead>
                  <tbody>
                    {state.phases.map(ph => {
                      const idx = Math.min(ph.endM, dreData.length) - 1;
                      if (idx < 0) return null;
                      const d = dreData[idx];
                      const arr = d.rec * 12;
                      const valuation = arr * state.revMult;
                      const roi = postMoney > 0 ? ((valuation / postMoney) - 1) * 100 : 0;
                      const multiple = postMoney > 0 ? (valuation / postMoney) : 0;
                      return (
                        <tr key={ph.id}>
                          <td><span className="milestone-badge">{ph.name}</span></td>
                          <td className="r">M{ph.startM}–M{ph.endM}</td>
                          <td className="r">{BRL(d.rec)}/mês</td>
                          <td className="r">{BRL(arr)}</td>
                          <td className="r"><strong>{BRL(valuation)}</strong></td>
                          <td className="r">{BRL(postMoney)}</td>
                          <td className="r"><span className={roi >= 100 ? 'roi-positive' : 'roi-neutral'}>{roi > 0 ? '+' : ''}{roi.toFixed(0)}%</span></td>
                          <td className="r"><strong>{multiple > 0 ? multiple.toFixed(1) + 'x' : '—'}</strong></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── DRE ────────────────────────────────────────────────── */}
      {activeTab === 'dre' && (
        <section className="tab-panel g1 active">
          <div className="panel">
            <div className="ph"><h2>DRE projetada</h2></div>
            <div className="pb">
              <div className="tw">
                <table>
                  <thead><tr>
                    <th>Item</th>
                    {dreData.map(d => <th key={d.m} className="r">M{d.m}</th>)}
                    <th className="r">Total</th>
                  </tr></thead>
                  <tbody>
                    <DRERow label="Hospitais ativos" data={dreData} k="h" />
                    <DRERow label="Subscription" data={dreData} k="rSub" brl indent />
                    <DRERow label="Performance Fee" data={dreData} k="rPerf" brl indent />
                    <DRERow label="Equa Pay" data={dreData} k="rEquaPay" brl indent color="#14a08c" />
                    <DRERow label="Revenue Share" data={dreData} k="rRevShare" brl indent />
                    <DRERow label="Receita Total" data={dreData} k="rec" brl bold subtotal />
                    <DRERow label="Custos Operacionais" data={dreData} k="cost" brl neg />
                    <DRERow label="Resultado" data={dreData} k="res" brl bold dtotal />
                    <DRERow label="Caixa acumulado" data={dreData} k="caixa" brl color="var(--pri)" />
                  </tbody>
                </table>
              </div>
              <div className="chart-wrap">
                <div style={{ padding: '0 1.25rem 1.25rem' }}>
                  <Plot
                    data={[
                      { type: 'bar', name: 'Subscription', x: xs, y: dreData.map(d => d.rSub), marker: { color: '#7C5CFC' } },
                      { type: 'bar', name: 'Perf. Fee', x: xs, y: dreData.map(d => d.rPerf), marker: { color: '#A78BFA' } },
                      { type: 'bar', name: 'Equa Pay', x: xs, y: dreData.map(d => d.rEquaPay), marker: { color: '#14a08c' } },
                      { type: 'bar', name: 'Revenue Share', x: xs, y: dreData.map(d => d.rRevShare), marker: { color: '#437a22' } },
                      { type: 'scatter', mode: 'lines', name: 'Caixa', x: xs, yaxis: 'y2', y: dreData.map(d => d.caixa), line: { color: '#964219', width: 2.5 } as any },
                    ] as any}
                    layout={getLayout({
                      barmode: 'stack',
                      margin: { t: 20, r: 60, b: 50, l: 80 },
                      legend: { orientation: 'h', y: -0.12 },
                      height: 360,
                      yaxis2: { overlaying: 'y', side: 'right', tickprefix: 'R$ ', tickformat: ',.0f', gridcolor: 'transparent', color: txtColor },
                    }) as any}
                    style={{ width: '100%' }} config={chartConfig} useResizeHandler
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── CENÁRIOS ───────────────────────────────────────────── */}
      {activeTab === 'cenarios' && (
        <section className="tab-panel g1 active">
          <div className="panel">
            <div className="ph"><h2>Cenários dinâmicos</h2><span className="derived-note">Edite os campos diretamente na tabela</span></div>
            <div className="pb">
              <div className="tw">
                <table>
                  <thead><tr>
                    <th>Cenário</th><th>Captação (R$)</th><th>Equity %</th><th>Hosp. alvo</th>
                    <th>Subscription (R$)</th><th>Perf. Fee (R$)</th><th>Runway alvo (m)</th>
                    <th className="r">Cap. necessária</th><th className="r">Pré-money</th>
                    <th className="r">Runway real</th><th className="r">Caixa final</th>
                    <th className="r">Receita total</th><th className="r">Resultado</th><th></th>
                  </tr></thead>
                  <tbody>
                    {state.scenarios.map(s => {
                      const r = calcScenario(s, state, meses);
                      return (
                        <tr key={s.id}>
                          <td><input className="scen-input" style={{ textAlign: 'left' }} value={s.name} onChange={e => updScenario(s.id, { name: e.target.value })} /></td>
                          <td><input className="scen-input" type="number" value={s.cap} onChange={e => updScenario(s.id, { cap: Number(e.target.value) })} /></td>
                          <td><input className="scen-input" type="number" value={s.eq} onChange={e => updScenario(s.id, { eq: Number(e.target.value) })} /></td>
                          <td><input className="scen-input" type="number" value={s.hFim} onChange={e => updScenario(s.id, { hFim: Number(e.target.value) })} /></td>
                          <td><input className="scen-input" type="number" value={s.sub} onChange={e => updScenario(s.id, { sub: Number(e.target.value) })} /></td>
                          <td><input className="scen-input" type="number" value={s.perf} onChange={e => updScenario(s.id, { perf: Number(e.target.value) })} /></td>
                          <td><input className="scen-input" value={s.runwayTarget ?? ''} placeholder="auto" onChange={e => updScenario(s.id, { runwayTarget: e.target.value ? Number(e.target.value) : null })} /></td>
                          <td className="r">{r.capNecessaria !== null ? BRL(r.capNecessaria) : '—'}</td>
                          <td className="r">{BRL(r.pre)}</td>
                          <td className="r"><span className="runway-badge">{r.runwayReal} m</span></td>
                          <td className="r">{BRL(r.caixaFinal)}</td>
                          <td className="r">{BRL(r.recTotal)}</td>
                          <td className="r">{BRL(r.resultado)}</td>
                          <td><button className="btn-sm btn-danger" onClick={() => delScenario(s.id)}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="actions" style={{ marginTop: '.75rem' }}>
                <button className="btn pri" onClick={addScenario}>+ Adicionar cenário</button>
              </div>
              <div className="chart-wrap">
                <div style={{ padding: '0 1.25rem 1.25rem' }}>
                  <Plot
                    data={[
                      { type: 'bar', name: 'Captação efetiva', x: state.scenarios.map(s => s.name), y: state.scenarios.map(s => calcScenario(s, state, meses).capEfetiva), marker: { color: '#7C5CFC' } },
                      { type: 'bar', name: 'Receita total', x: state.scenarios.map(s => s.name), y: state.scenarios.map(s => calcScenario(s, state, meses).recTotal), marker: { color: '#437a22' } },
                      { type: 'bar', name: 'Caixa final', x: state.scenarios.map(s => s.name), y: state.scenarios.map(s => calcScenario(s, state, meses).caixaFinal), marker: { color: '#964219' } },
                    ] as any}
                    layout={getLayout({ barmode: 'group', margin: { t: 20, r: 20, b: 50, l: 80 }, legend: { orientation: 'h', y: -0.12 }, height: 340 }) as any}
                    style={{ width: '100%' }} config={chartConfig} useResizeHandler
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

/** Campo com botão ⓘ e tooltip box expandível */
function PHintField({
  label, field, value, onChange, hint, tooltip, setTooltip, InfoBtn, TooltipBox, min, max, step,
}: {
  label: string; field: string; value: number; onChange: (v: string) => void; hint: string;
  tooltip: string | null; setTooltip: (v: string | null) => void;
  InfoBtn: React.FC<{ field: string }>; TooltipBox: React.FC<{ field: string }>;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div className="field">
      <label>{label} <InfoBtn field={field} /></label>
      <input type="number" value={value} min={min} max={max} step={step} onChange={e => onChange(e.target.value)} />
      <TooltipBox field={field} />
    </div>
  );
}

/** Linha da DRE */
interface DRERowProps { label: string; data: MonthData[]; k: keyof MonthData; brl?: boolean; bold?: boolean; neg?: boolean; indent?: boolean; color?: string; subtotal?: boolean; dtotal?: boolean; }
function DRERow({ label, data, k, brl, bold, neg, indent, color, subtotal, dtotal }: DRERowProps) {
  const tot = data.reduce((a, d) => a + (d[k] as number), 0);
  const trClass = dtotal ? 'total' : subtotal ? 'subtotal' : '';
  const style: React.CSSProperties = { ...(bold ? { fontWeight: 700 } : {}), ...(color ? { color } : {}), ...(indent ? { paddingLeft: '1.2rem' } : {}) };
  return (
    <tr className={trClass}>
      <td style={style}>{label}</td>
      {data.map(d => {
        const v = neg ? -(d[k] as number) : (d[k] as number);
        return <td key={d.m} className="r" style={style}>{brl ? BRL(v) : d[k]}</td>;
      })}
      <td className="r bold" style={style}>{brl ? BRL(neg ? -tot : tot) : '—'}</td>
    </tr>
  );
}
