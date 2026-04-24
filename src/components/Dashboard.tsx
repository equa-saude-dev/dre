'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Plot from '@/components/DynamicPlot';
import { saveStateAction } from '@/app/actions';
import { supabase } from '@/lib/supabase';
import { DREState, KPI, Initiative, Phase, Scenario, CostItem, MonthData } from '@/lib/calc';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const AREA_LIST = ['produto', 'comercial', 'operacoes', 'juridico'];
const AREA_LABELS: Record<string, string> = { produto: 'Produto & Tech', comercial: 'Comercial & Marketing', operacoes: 'Operações / CS', juridico: 'Jurídico / Adm', outro: 'Outro' };
const AREA_COLORS: Record<string, string> = { produto: '#7C5CFC', comercial: '#A78BFA', operacoes: '#437a22', juridico: '#964219', outro: '#9896a0' };
const CAT_LABELS: Record<string, string> = { folha: 'Folha / RH', ferramentas: 'Ferramentas & SaaS', opex: 'Despesas operacionais' };

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

let _uid = 3000;
const uid = () => ++_uid;
const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);

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
    const rEquaPay = m >= state.revShareIni ? h * state.equaPayVol * (state.equaPayTaxa / 100) : 0;
    const rRevShare = m >= state.revShareIni ? h * state.revShareBase * (state.revSharePct / 100) : 0;
    const rec = rSub + rPerf + rEquaPay + rRevShare;
    let cost = 0;
    Object.values(state.areaCosts).forEach(area => area.forEach(c => { if (m >= c.startM && m <= c.endM) cost += c.monthly; }));
    const res = rec - cost; caixa += res;
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
    caixa += (rec - c); totRec += rec; totCost += c; cxSim -= c;
    if (cxSim > 0) runwayReal = m;
  }
  const pre = s.eq > 0 ? capEfetiva / (s.eq / 100) - capEfetiva : 0;
  return { capNecessaria, capEfetiva, pre, runwayReal, caixaFinal: caixa, recTotal: totRec, resultado: totRec - totCost };
}

export default function Dashboard() {
  const [state, setState] = useState<DREState>(DEFAULT_STATE);
  const [activeTab, setActiveTab] = useState('resumo');
  const [theme, setTheme] = useState('dark');
  const isDark = theme === 'dark';
  const [prem, setPrem] = useState<Partial<DREState>>({});
  const [premDirty, setPremDirty] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      console.log('--- Initializing Data Load ---');
      console.log('Supabase URL present:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
      console.log('Supabase Key present:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      try {
        const { data, error } = await supabase
          .from('dre_data')
          .select('state')
          .eq('id', 1)
          .single();
        
        clearTimeout(timeoutId);

        if (error) {
          console.error('Supabase fetch error:', error);
          if (error.code === 'PGRST301' || error.message.includes('Unauthorized')) {
            setLoadError('Erro de Autenticação: Verifique as chaves do Supabase no Vercel.');
          }
          throw error;
        }

        const serverState = data?.state;
        if (serverState && Object.keys(serverState).length > 0) {
          console.log('✅ Server state loaded');
          if (!(serverState as any).mesesPlan) (serverState as any).mesesPlan = 18;
          setState(serverState as any);
        } else {
          console.log('ℹ️ Server state empty, using default');
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.warn('⚠️ Supabase fetch timed out');
        } else {
          console.warn('⚠️ Supabase load failed:', err.message || err);
        }
        
        try {
          const saved = localStorage.getItem('dre_state_v18');
          if (saved) {
            console.log('✅ Local storage state recovered');
            const parsed = JSON.parse(saved);
            if (!parsed.mesesPlan) parsed.mesesPlan = 18;
            setState(parsed);
          }
        } catch (localErr) {
          console.error('Local storage recovery failed:', localErr);
        }
      } finally {
        console.log('--- Data Load Finished ---');
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('dre_theme', theme); } catch {}
  }, [theme]);

  const handleUpdate = useCallback((updates: Partial<DREState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      try { localStorage.setItem('dre_state_v18', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(async () => {
      setIsSyncing(true);
      try { await saveStateAction(state); } catch (err) {} finally { setIsSyncing(false); }
    }, 3000);
    return () => clearTimeout(timer);
  }, [state, isLoaded]);

  const { dreData, totals, meses } = useMemo(() => calcDRE(state), [state]);
  const postMoney = state.equity > 0 ? state.captacao / (state.equity / 100) : 0;
  const preMoney = postMoney - state.captacao;
  const lastD = dreData[dreData.length - 1];
  const txtColor = isDark ? '#f0eeff' : '#1a1825';
  const gridColor = isDark ? '#2e2c3e' : '#e8e6e1';
  const getLayout = (extra: object = {}): object => ({
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { family: 'Satoshi,sans-serif', color: txtColor, size: 12 },
    xaxis: { gridcolor: gridColor, color: txtColor },
    yaxis: { gridcolor: gridColor, color: txtColor, tickprefix: 'R$ ', tickformat: ',.0f' },
    autosize: true, ...extra,
  });
  const xs = dreData.map(d => `M${d.m}`);
  const chartConfig = { displayModeBar: false, responsive: true };
  const getPrem = <K extends keyof DREState>(k: K): DREState[K] => (k in prem ? (prem as DREState)[k] : state[k]);
  const setPremField = <K extends keyof DREState>(k: K, v: DREState[K]) => { setPrem(p => ({ ...p, [k]: v })); setPremDirty(true); };
  const applyPremissas = () => { handleUpdate(prem); setPrem({}); setPremDirty(false); };
  const InfoBtn = ({ field }: { field: string }) => (
    <span style={{ cursor: 'help', fontSize: '.78rem', color: 'var(--pri)', userSelect: 'none', marginLeft: '4px', fontWeight: 700 }} title={FIELD_HINTS[field] || ''} onClick={() => setTooltip(tooltip === field ? null : field)}>ⓘ</span>
  );
  const TooltipBox = ({ field }: { field: string }) => tooltip === field ? (<div style={{ fontSize: '.75rem', color: 'var(--txm)', background: 'var(--sur2)', border: '1px solid var(--bor)', borderRadius: '.5rem', padding: '.5rem .75rem', marginTop: '.25rem', lineHeight: 1.5 }}>{FIELD_HINTS[field]}</div>) : null;

  const addMilestone = () => { const last = state.phases.reduce((m, p) => Math.max(m, p.endM), 0); handleUpdate({ phases: [...state.phases, { id: uid(), name: `M${state.phases.length + 1} · Novo Milestone`, startM: last + 1, endM: last + 6, objective: '', kr: '', initiatives: [{ id: uid(), name: 'Nova iniciativa', area: 'produto', subarea: '', pct: 0, kpis: [{ id: uid(), metric: 'Nova métrica', target: 'Meta' }] }] }] }); };
  const delMilestone = (pid: number) => handleUpdate({ phases: state.phases.filter(p => p.id !== pid) });
  const updPhase = (pid: number, patch: Partial<Phase>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, ...patch } : p) });
  const addInitiative = (pid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: [...p.initiatives, { id: uid(), name: 'Nova iniciativa', area: 'produto', subarea: '', pct: 0, kpis: [{ id: uid(), metric: 'Nova métrica', target: 'Meta' }] }] } : p) });
  const delInitiative = (pid: number, iid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.filter(i => i.id !== iid) } : p) });
  const updInitiative = (pid: number, iid: number, patch: Partial<Initiative>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, ...patch } : i) } : p) });
  const addKPI = (pid: number, iid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: [...i.kpis, { id: uid(), metric: 'Nova métrica', target: 'Meta' }] } : i) } : p) });
  const delKPI = (pid: number, iid: number, kid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: i.kpis.filter(k => k.id !== kid) } : i) } : p) });
  const updKPI = (pid: number, iid: number, kid: number, patch: Partial<KPI>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: i.kpis.map(k => k.id === kid ? { ...k, ...patch } : k) } : i) } : p) });
  const addCost = (area: string) => { const nc = { ...state.areaCosts }; nc[area] = [...nc[area], { id: uid(), cat: 'folha', desc: 'Novo item', monthly: 0, startM: 1, endM: meses }]; handleUpdate({ areaCosts: nc }); };
  const delCost = (area: string, cid: number) => { const nc = { ...state.areaCosts }; nc[area] = nc[area].filter(c => c.id !== cid); handleUpdate({ areaCosts: nc }); };
  const updCost = (area: string, cid: number, patch: Partial<CostItem>) => { const nc = { ...state.areaCosts }; nc[area] = nc[area].map(c => c.id === cid ? { ...c, ...patch } : c); handleUpdate({ areaCosts: nc }); };
  const addScenario = () => handleUpdate({ scenarios: [...state.scenarios, { id: uid(), name: 'Novo Cenário', cap: state.captacao, eq: state.equity, hFim: state.hFim, sub: state.sub, perf: state.perf, runwayTarget: null }] });
  const delScenario = (sid: number) => handleUpdate({ scenarios: state.scenarios.filter(s => s.id !== sid) });
  const updScenario = (sid: number, patch: Partial<Scenario>) => handleUpdate({ scenarios: state.scenarios.map(s => s.id === sid ? { ...s, ...patch } : s) });

  const allocAreas: Record<string, number> = {}; let allocTotal = 0;
  for (let m = 1; m <= meses; m++) {
    Object.keys(state.areaCosts).forEach(a => {
      (state.areaCosts[a] || []).forEach(c => { if (m >= c.startM && m <= c.endM) { allocAreas[a] = (allocAreas[a] || 0) + c.monthly; allocTotal += c.monthly; } });
    });
  }

  const leituraText = lastD ? `Com captação de ${BRL(state.captacao)} (${state.equity}% equity) e ${meses} meses de horizonte, a empresa atinge ${lastD.h} hospitais e encerra o período com caixa ${lastD.caixa > 0 ? 'positivo' : 'negativo'} de ${BRL(lastD.caixa)}. Receita total: ${BRL(totals.rec)}${totals.rEquaPay > 0 ? ` (inclui ${BRL(totals.rEquaPay)} Equa Pay + ${BRL(totals.rRevShare)} Rev Share).` : '.'}` : '';

  if (!isLoaded) return <div className="app-loading">Carregando dados...</div>;

  return (
    <div className="app">
      <div className="hero">
        <div className="hero-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="app-title">Equa — DRE</span>
            <span style={{ fontSize: '0.7rem', background: '#14a08c', color: 'white', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>V1.1 - Supabase</span>
            {isSyncing && <span style={{ fontSize: '0.7rem', color: 'var(--txm)', fontStyle: 'italic' }}>🔄 Sincronizando...</span>}
          </div>
          <span className="hero-desc">Modelo financeiro dinâmico. Altere premissas, OKRs ou milestones para ver DRE, caixa e cenários em tempo real.</span>
          
          {loadError && (
            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,165,0,0.1)', border: '1px solid orange', borderRadius: '5px', color: 'orange', fontSize: '0.8rem' }}>
              ⚠️ {loadError}
            </div>
          )}

          {(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && (
            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,0,0,0.1)', border: '1px solid red', borderRadius: '5px', color: 'red', fontSize: '0.8rem' }}>⚠️ Erro de Configuração: Variáveis do Supabase não encontradas.</div>
          )}
        </div>
        <button className="btn-theme" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Tema escuro' : 'Tema claro'}</button>
      </div>
      <div className="tabs">
        {[['resumo','Resumo'],['premissas','Premissas'],['roadmap','GTM / OKRs'],['dre','DRE'],['cenarios','Cenários']].map(([k,l]) => (
          <button key={k} className={`tab-btn${activeTab===k?' active':''}`} onClick={() => setActiveTab(k)}>{l}</button>
        ))}
      </div>
      {activeTab === 'resumo' && (
        <section className="tab-panel active g2">
          <div className="panel"><div className="ph"><h2>Resumo executivo</h2><span className="pill">{meses} meses</span></div><div className="pb">
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
                return (<div key={a} className="alloc-card"><div className="a-label">{AREA_LABELS[a]}</div><div className="a-pct" style={{ color: AREA_COLORS[a] }}>{pct.toFixed(0)}%</div><div className="a-val">{BRL(allocAreas[a] || 0)}</div><div className="a-bar" style={{ background: AREA_COLORS[a], width: `${pct}%` }}></div></div>);
              })}
            </div>
            <span className="lbl" style={{ marginTop: '1.1rem' }}>Leitura</span><p className="note">{leituraText}</p>
          </div></div>
          <div className="panel"><div className="ph"><h2>Evolução mensal</h2></div><div className="pb-nopad">
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              <Plot data={[
                { type: 'bar', name: 'Subscription', x: xs, y: dreData.map(d => d.rSub), marker: { color: '#7C5CFC' } },
                { type: 'bar', name: 'Perf. Fee', x: xs, y: dreData.map(d => d.rPerf), marker: { color: '#A78BFA' } },
                { type: 'bar', name: 'Equa Pay', x: xs, y: dreData.map(d => d.rEquaPay), marker: { color: '#14a08c' } },
                { type: 'bar', name: 'Revenue Share', x: xs, y: dreData.map(d => d.rRevShare), marker: { color: '#437a22' } },
                { type: 'scatter', mode: 'lines', name: 'Custos', x: xs, y: dreData.map(d => d.cost), line: { color: '#964219', width: 2, dash: 'dot' } as any },
              ] as any} layout={getLayout({ barmode: 'stack', margin: { t: 20, r: 10, b: 40, l: 80 }, legend: { orientation: 'h', y: -0.15 }, height: 280 }) as any} style={{ width: '100%' }} config={chartConfig} useResizeHandler />
            </div>
            <div style={{ padding: '.5rem 1.25rem 1.25rem' }}>
              <Plot data={[{ type: 'scatter', mode: 'lines', name: 'Caixa acumulado', x: xs, y: dreData.map(d => d.caixa), fill: 'tozeroy', fillcolor: 'rgba(124,92,252,.1)', line: { color: '#7C5CFC', width: 2.5 } as any }] as any} layout={getLayout({ margin: { t: 10, r: 10, b: 40, l: 80 }, height: 220 }) as any} style={{ width: '100%' }} config={chartConfig} useResizeHandler />
            </div>
          </div></div>
        </section>
      )}
      {activeTab === 'premissas' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>Premissas da rodada</h2>{premDirty && <span style={{ fontSize: '.78rem', color: 'var(--war)', fontWeight: 600 }}>⚠ Alterações pendentes — clique em Aplicar</span>}</div><div className="pb">
            <div className="fields sub4">
              <PHintField label="Captação (R$)" field="captacao" value={getPrem('captacao') as number} onChange={(v: string) => setPremField('captacao', Number(v))} hint={FIELD_HINTS.captacao} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Equity %" field="equity" step={0.1} value={getPrem('equity') as number} onChange={(v: string) => setPremField('equity', Number(v))} hint={FIELD_HINTS.equity} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Hospitais alvo" field="hFim" value={getPrem('hFim') as number} onChange={(v: string) => setPremField('hFim', Number(v))} hint={FIELD_HINTS.hFim} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Prazo total (meses)" field="mesesPlan" min={6} max={36} value={getPrem('mesesPlan') as number} onChange={(v: string) => setPremField('mesesPlan', Math.min(36, Math.max(6, Number(v))))} hint={FIELD_HINTS.mesesPlan} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
            </div>
            <div className="fields sub2" style={{ marginTop: '.875rem' }}><PHintField label="Início 1ª receita (mês)" field="inicioRec" value={getPrem('inicioRec') as number} onChange={(v: string) => setPremField('inicioRec', Number(v))} hint={FIELD_HINTS.inicioRec} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} /></div>
            <span className="lbl" style={{ marginTop: '1.25rem' }}>🏥 Receita Core — Glosas</span>
            <div className="fields sub3">
              <PHintField label="Subscription / contrato (R$)" field="sub" value={getPrem('sub') as number} onChange={(v: string) => setPremField('sub', Number(v))} hint={FIELD_HINTS.sub} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Performance Fee / contrato (R$)" field="perf" value={getPrem('perf') as number} onChange={(v: string) => setPremField('perf', Number(v))} hint={FIELD_HINTS.perf} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <div className="field"><label>Receita piloto / mês (R$) <InfoBtn field="piloto" /></label><input type="number" value={getPrem('piloto') as number} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPremField('piloto', Number(e.target.value))} /><small>0 = piloto gratuito</small><TooltipBox field="piloto" /></div>
            </div>
            <span className="lbl" style={{ marginTop: '1.25rem' }}>⚡ Equa Pay — Antecipação</span>
            <div className="fields sub2">
              <PHintField label="Faturamento do hospital / mês (R$)" field="equaPayVol" value={getPrem('equaPayVol') as number} onChange={(v: string) => setPremField('equaPayVol', Number(v))} hint={FIELD_HINTS.equaPayVol} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <div className="field"><label>Taxa de antecipação (%) <InfoBtn field="equaPayTaxa" /></label><input type="number" step={0.1} value={getPrem('equaPayTaxa') as number} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPremField('equaPayTaxa', Number(e.target.value))} /><small>Cobrada sobre o faturamento</small><TooltipBox field="equaPayTaxa" /></div>
            </div>
            <span className="lbl" style={{ marginTop: '1.25rem' }}>📊 Revenue Share</span>
            <div className="fields sub3">
              <div className="field"><label>Revenue Share (%) <InfoBtn field="revSharePct" /></label><input type="number" step={0.5} value={getPrem('revSharePct') as number} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPremField('revSharePct', Number(e.target.value))} /><small>% sobre o faturamento antecipado</small><TooltipBox field="revSharePct" /></div>
              <PHintField label="Faturamento do hospital / hosp / mês (R$)" field="revShareBase" value={getPrem('revShareBase') as number} onChange={(v: string) => setPremField('revShareBase', Number(v))} hint={FIELD_HINTS.revShareBase} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Mês de início (Equa Pay + Rev. Share)" field="revShareIni" value={getPrem('revShareIni') as number} onChange={(v: string) => setPremField('revShareIni', Number(v))} hint={FIELD_HINTS.revShareIni} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
            </div>
            <div className="actions" style={{ marginTop: '1.25rem' }}><button className="btn pri" onClick={applyPremissas} style={{ opacity: premDirty ? 1 : 0.55 }}>✓ Aplicar premissas</button></div>
          </div></div>
          <div className="panel"><div className="ph"><h2>Estrutura de Custos</h2></div><div className="pb">
            {AREA_LIST.map(area => {
              const items = state.areaCosts[area] || []; const total = items.reduce((a, c) => a + c.monthly, 0);
              return (<div key={area} className="custo-panel"><div className="custo-header"><div><span className="custo-area-name">{AREA_LABELS[area]}</span><div className="custo-summary"><span className="pill">{BRL(total)}/mês</span></div></div><button className="btn-sm" onClick={() => addCost(area)}>+ Item</button></div><div className="custo-body"><table className="cost-table"><thead><tr><th>Categoria</th><th>Descrição</th><th>R$/mês</th><th>Mês ini.</th><th>Mês fim</th><th></th></tr></thead><tbody>
                {items.map(c => (<tr key={c.id}><td><select value={c.cat} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updCost(area, c.id, { cat: e.target.value as any })}>{Object.keys(CAT_LABELS).map(cat => <option key={cat} value={cat}>{CAT_LABELS[cat]}</option>)}</select></td><td><input value={c.desc} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updCost(area, c.id, { desc: e.target.value })} /></td><td><input type="number" value={c.monthly} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updCost(area, c.id, { monthly: Number(e.target.value) })} /></td><td><input type="number" value={c.startM} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updCost(area, c.id, { startM: Number(e.target.value) })} /></td><td><input type="number" value={c.endM} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updCost(area, c.id, { endM: Number(e.target.value) })} /></td><td><button className="btn-sm btn-danger" onClick={() => delCost(area, c.id)}>✕</button></td></tr>))}
              </tbody></table></div></div>);
            })}
          </div></div>
        </section>
      )}
      {activeTab === 'roadmap' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>GTM / OKRs</h2></div><div className="pb">
            {state.phases.map(ph => (
              <div key={ph.id} className="okr-card">
                <div style={{ display: 'flex', gap: '.75rem', marginBottom: '.875rem' }}><span className="milestone-badge">{ph.name}</span><span className="pill">M{ph.startM}–M{ph.endM}</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: '.75rem', marginBottom: '.75rem' }}>
                  <input value={ph.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updPhase(ph.id, { name: e.target.value })} /><input value={ph.objective} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updPhase(ph.id, { objective: e.target.value })} /><input type="number" value={ph.startM} style={{ width: '60px' }} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updPhase(ph.id, { startM: Number(e.target.value) })} /><input type="number" value={ph.endM} style={{ width: '60px' }} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updPhase(ph.id, { endM: Number(e.target.value) })} />
                </div>
                <input value={ph.kr} style={{ marginBottom: '.75rem' }} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updPhase(ph.id, { kr: e.target.value })} placeholder="Key Result" />
                <table className="init-table"><tbody>{ph.initiatives.map(ini => (<tr key={ini.id}><td><input value={ini.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updInitiative(ph.id, ini.id, { name: e.target.value })} /></td><td><select value={ini.area} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updInitiative(ph.id, ini.id, { area: e.target.value })}>{Object.keys(AREA_LABELS).map(a => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}</select></td><td><input type="number" value={ini.pct} style={{ width: '50px' }} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updInitiative(ph.id, ini.id, { pct: Number(e.target.value) })} /></td><td><button className="btn-sm btn-danger" onClick={() => delInitiative(ph.id, ini.id)}>✕</button></td></tr>))}</tbody></table>
                <button className="btn-sm" onClick={() => addInitiative(ph.id)}>+ Iniciativa</button>
              </div>
            ))}
            <button className="btn" onClick={addMilestone}>+ Milestone</button>
          </div></div>
        </section>
      )}
      {activeTab === 'dre' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>DRE</h2></div><div className="pb">
            <div className="tw"><table><thead><tr><th>Item</th>{dreData.map(d => <th key={d.m} className="r">M{d.m}</th>)}<th className="r">Total</th></tr></thead><tbody>
              <DRERow label="Hospitais ativos" data={dreData} k="h" />
              <DRERow label="Receita Total" data={dreData} k="rec" brl bold subtotal />
              <DRERow label="Custos Operacionais" data={dreData} k="cost" brl neg />
              <DRERow label="Resultado" data={dreData} k="res" brl bold dtotal />
              <DRERow label="Caixa acumulado" data={dreData} k="caixa" brl color="var(--pri)" />
            </tbody></table></div>
          </div></div>
        </section>
      )}
      {activeTab === 'cenarios' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>Cenários</h2></div><div className="pb">
            <div className="tw"><table><thead><tr><th>Cenário</th><th>Captação</th><th>Equity</th><th>Hosp.</th><th className="r">Caixa final</th><th className="r">Resultado</th><th></th></tr></thead><tbody>
              {state.scenarios.map(s => {
                const r = calcScenario(s, state, meses);
                return (<tr key={s.id}><td><input value={s.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updScenario(s.id, { name: e.target.value })} /></td><td><input type="number" value={s.cap} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updScenario(s.id, { cap: Number(e.target.value) })} /></td><td><input type="number" value={s.eq} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updScenario(s.id, { eq: Number(e.target.value) })} /></td><td><input type="number" value={s.hFim} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updScenario(s.id, { hFim: Number(e.target.value) })} /></td><td className="r">{BRL(r.caixaFinal)}</td><td className="r">{BRL(r.resultado)}</td><td><button className="btn-sm btn-danger" onClick={() => delScenario(s.id)}>✕</button></td></tr>);
              })}
            </tbody></table></div>
            <button className="btn pri" onClick={addScenario}>+ Cenário</button>
          </div></div>
        </section>
      )}
    </div>
  );
}

function PHintField({ label, field, value, onChange, hint, tooltip, setTooltip, InfoBtn, TooltipBox, min, max, step }: { label: string; field: string; value: number; onChange: (v: string) => void; hint: string; tooltip: string | null; setTooltip: (v: string | null) => void; InfoBtn: any; TooltipBox: any; min?: number; max?: number; step?: number }) {
  return (<div className="field"><label>{label} <InfoBtn field={field} /></label><input type="number" value={value} min={min} max={max} step={step} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} /><TooltipBox field={field} /></div>);
}

function DRERow({ label, data, k, brl, bold, neg, indent, color, subtotal, dtotal }: { label: string; data: MonthData[]; k: keyof MonthData; brl?: boolean; bold?: boolean; neg?: boolean; indent?: boolean; color?: string; subtotal?: boolean; dtotal?: boolean }) {
  const tot = data.reduce((a, d) => a + (d[k] as number), 0);
  const style: React.CSSProperties = { ...(bold ? { fontWeight: 700 } : {}), ...(color ? { color } : {}), ...(indent ? { paddingLeft: '1.2rem' } : {}) };
  return (<tr className={dtotal ? 'total' : subtotal ? 'subtotal' : ''}><td style={style}>{label}</td>{data.map((d: MonthData) => <td key={d.m} className="r" style={style}>{brl ? BRL(neg ? -(d[k] as number) : d[k] as number) : d[k] as number}</td>)}<td className="r bold" style={style}>{brl ? BRL(neg ? -tot : tot) : '—'}</td></tr>);
}
