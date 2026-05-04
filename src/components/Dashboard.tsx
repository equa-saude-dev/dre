'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Plot from '@/components/DynamicPlot';
import { supabase } from '@/lib/supabase';
import { DREState, KPI, Initiative, Phase, Scenario, CostItem, MonthData } from '@/lib/calc';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const AREA_LIST = ['produto', 'comercial', 'operacoes', 'juridico'];
const AREA_LABELS: Record<string, string> = { produto: 'Produto & Tech', comercial: 'Comercial & Marketing', operacoes: 'Operações / CS', juridico: 'Jurídico / Adm', outro: 'Outro' };
const AREA_COLORS: Record<string, string> = { produto: '#7C5CFC', comercial: '#A78BFA', operacoes: '#437a22', juridico: '#964219', outro: '#9896a0' };
const CAT_LABELS: Record<string, string> = { folha: 'Folha / RH', ferramentas: 'Ferramentas & SaaS', opex: 'Despesas operacionais', consultor: 'Consultor / Assessoria' };

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
  projHospFim:  'Clientes contratados ao final do período. Usado para cálculo de MRR e Receita anualizada de saída.',
  projHospMedios: 'Média de hospitais efetivamente gerando receita ao longo do ano. Usado para cálculo da receita reconhecida.'
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
      { id: 104, cat: 'ferramentas', desc: 'Linkedin', monthly: 1000, startM: 1, endM: 9 },
      { id: 105, cat: 'ferramentas', desc: 'You lead - 20 reuniões', monthly: 2500, startM: 1, endM: 9 },
    ],
    comercial: [
      { id: 201, cat: 'folha', desc: 'Head Comercial part-time', monthly: 6000, startM: 3, endM: 18 },
      { id: 202, cat: 'ferramentas', desc: 'CRM HubSpot', monthly: 400, startM: 2, endM: 18 },
    ],
    operacoes: [{ id: 301, cat: 'folha', desc: 'Customer Success', monthly: 4000, startM: 2, endM: 18 }],
    juridico: [
      { id: 401, cat: 'folha', desc: 'Advogado retainer', monthly: 2000, startM: 1, endM: 9 },
      { id: 402, cat: 'ferramentas', desc: 'Clicksign', monthly: 200, startM: 1, endM: 9 },
      { id: 403, cat: 'opex', desc: 'Contabilidade', monthly: 300, startM: 1, endM: 9 },
      { id: 404, cat: 'opex', desc: 'Viagens coorporativas', monthly: 4000, startM: 1, endM: 9 },
    ],
    outro: [],
  },
  scenarios: [
    { id: 1, name: 'Conservador — mínimo para rodar', cap: 400000, eq: 6.8, hFim: 7, sub: 15000, perf: 7000, runwayTarget: null, contratoAssinado: 11, primeiraReceita: 15, cicloVenda: 180, onboarding: 90, caixaMinimo: '-R$ 56.000', novaRodada: 8 },
    { id: 2, name: 'Plano principal', cap: 500000, eq: 8.3, hFim: 10, sub: 20000, perf: 10000, runwayTarget: null, contratoAssinado: 9, primeiraReceita: 12, cicloVenda: 120, onboarding: 60, caixaMinimo: 'R$ 64.000', novaRodada: 9 },
    { id: 3, name: 'Aceleração opcional', cap: 600000, eq: 9.8, hFim: 15, sub: 22000, perf: 12000, runwayTarget: null, contratoAssinado: 7, primeiraReceita: 10, cicloVenda: 90, onboarding: 30, caixaMinimo: 'R$ 144.000', novaRodada: 7 },
  ],
  phases: [
    { id: 1, name: 'M1 · Validação', startM: 1, endM: 9, objective: 'Primeira prova comercial e operacional completa da Equa', kr: '1 contrato assinado, 3 contas-alvo em pipeline qualificado avançado',
      initiatives: [
        { id: 10, name: 'Validar MVP em produção', area: 'produto', subarea: 'Eng & IA', pct: 63, kpis: [
          { id: 2001, metric: 'Evoluir intel de contrato', target: 'Recall > 80% - Precisão > 90% - R1' },
          { id: 2002, metric: 'Evoluir a estrutura do pipeline do Equa core', target: 'Recall e acurácia dos dados processados' },
          { id: 2003, metric: 'Integrar com ERP (Tasy, MV, Wareline, SPData)', target: 'Executar 1 integração e2e' }
        ] },
        { id: 11, name: 'Captação de leads', area: 'comercial', subarea: 'Eventos', pct: 33, kpis: [
          { id: 2004, metric: 'Participar ativamente de eventos de saúde', target: '10 leads qualificados' },
          { id: 2005, metric: 'Campanhas de awareness em diferentes veículos', target: '50 leads' },
          { id: 2006, metric: 'Criar agente de prospecção com IA', target: '15 leads qualificados' },
          { id: 2007, metric: 'Criar playbook de vendas', target: '4 demos apresentadas' },
          { id: 2008, metric: 'Aumentar reuniões presenciais', target: '15 reuniões' },
          { id: 2009, metric: 'Aumentar reuniões iniciais - You lead', target: '100' }
        ] },
        { id: 12, name: 'Jurídico e LGPD', area: 'juridico', subarea: 'Contratos', pct: 11, kpis: [
          { id: 2010, metric: 'Estarmos contratualmente dentro dos conformes de segurança e LGPD', target: '1 contrato conforme' }
        ] },
      ]
    },
    { id: 2, name: 'M2 · Piloto', startM: 10, endM: 15, objective: '3 hospitais pagantes, NPS ≥ 40', kr: 'MRR ≥ R$ 90k, churn = 0', initiatives: [] },
  ],
  projecao: {
    ano1: { novosHospitais: 1, churnAnual: 0, hospitaisPerdidos: 0, hospitaisFim: 1, hospitaisMedios: 0.08, ticketInicial: 30000, expansaoUpsell: 0, ticket: 30000, cac: 100000, margemBruta: 70, custo: 60000, subPct: 50, perfPct: 50 },
    ano2: { novosHospitais: 15, churnAnual: 5, hospitaisPerdidos: 1, hospitaisFim: 15, hospitaisMedios: 10, ticketInicial: 35000, expansaoUpsell: 15, ticket: 40250, cac: 70000, margemBruta: 70, custo: 250000, subPct: 60, perfPct: 40 },
    ano3: { novosHospitais: 33, churnAnual: 7, hospitaisPerdidos: 3, hospitaisFim: 45, hospitaisMedios: 35, ticketInicial: 40000, expansaoUpsell: 20, ticket: 48000, cac: 50000, margemBruta: 70, custo: 500000, subPct: 70, perfPct: 30 },
    ano4: { novosHospitais: 42, churnAnual: 10, hospitaisPerdidos: 5, hospitaisFim: 78, hospitaisMedios: 75, ticketInicial: 50000, expansaoUpsell: 25, ticket: 62500, cac: 40000, margemBruta: 70, custo: 1000000, subPct: 80, perfPct: 20 },
    invest_cap: 500000,
    invest_pre: 5500000,
    mult_cons: 4,
    mult_base: 6,
    mult_otim: 8,
    mult_sub: 6,
    mult_perf: 3,
    val_type: 'weighted',
    diluicao: 6.12
  },
  pilotStages: [
    { id: 1, stage: '1. Escopo e dados', deadline: 'M1–M2', deliverable: 'área, convênios e dados definidos' },
    { id: 2, stage: '2. Ingestão e baseline', deadline: 'M2–M3', deliverable: 'baseline de perda/subfaturamento' },
    { id: 3, stage: '3. Identificação de oportunidades', deadline: 'M3–M5', deliverable: 'oportunidades classificadas' },
    { id: 4, stage: '4. Validação hospital', deadline: 'M4–M6', deliverable: 'oportunidades aceitas' },
    { id: 5, stage: '5. Envio/faturamento', deadline: 'M5–M8', deliverable: 'valores enviados ao convênio' },
    { id: 6, stage: '6. Recebimento/comprovação', deadline: 'M8–M12', deliverable: 'valor pago e fee calculado' },
    { id: 7, stage: '7. Case comercial', deadline: 'M10–M12', deliverable: 'business case replicável' },
  ],
  valueFunnel: [
    { id: 1, metric: 'Receita potencial identificada', value: 'R$ 1.2M' },
    { id: 3, metric: 'Receita enviada ao convênio', value: 'R$ 1.0M' },
    { id: 4, metric: '% pago pela operadora', value: '92%' },
    { id: 5, metric: 'Receita efetivamente paga', value: 'R$ 920k' },
    { id: 6, metric: 'Performance fee Equa', value: 'R$ 92k' },
  ],
  validationTypes: [
    { id: 1, type: 'Validação técnica', deadline: '30 dias', proves: 'dados, integração e fluxo' },
    { id: 2, type: 'Validação econômica preliminar', deadline: '60–90 dias', proves: 'oportunidades reais e aceite do hospital' },
    { id: 3, type: 'Validação financeira completa', deadline: '9–12 meses', proves: 'pagamento/recebimento e cobrança do fee' },
  ],
  nextRoundTriggers: [
    { id: 1, trigger: 'Contrato assinado', target: '1 hospital' },
    { id: 2, trigger: 'Receita potencial identificada', target: 'R$ 1.2M' },
    { id: 3, trigger: 'Receita validada pelo hospital', target: 'R$ 1.0M' },
    { id: 4, trigger: 'Primeira receita faturada ou recebida', target: 'Confirmada' },
    { id: 5, trigger: 'Pipeline qualificado', target: 'R$ 10M+ em receita potencial' },
    { id: 6, trigger: 'Case comercial', target: '1 case com ROI comprovado' },
    { id: 7, trigger: 'Playbook comercial', target: 'Versão 1.0 pronta para escala' },
  ]
};

let _uid = 3000;
const uid = () => ++_uid;
const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0);

function calcMeses(state: DREState) {
  const fromPhases = (state.phases || []).reduce((max, p) => Math.max(max, p.endM), 0);
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
    if (state.areaCosts) {
      Object.values(state.areaCosts).forEach(area => {
        if (Array.isArray(area)) {
          area.forEach(c => { if (m >= c.startM && m <= c.endM) cost += c.monthly; });
        }
      });
    }
    const res = rec - cost; caixa += res;
    dreData.push({ m, h, rSub, rPerf, rEquaPay, rRevShare, rec, cost, res, caixa, recContratada: rec, mrrSub: rSub, perfFeeEst: rPerf, recReconhecida: rec, caixaRecebido: rec, contasReceber: 0 });
    totals.rec += rec; totals.rSub += rSub; totals.rPerf += rPerf;
    totals.rEquaPay += rEquaPay; totals.rRevShare += rRevShare; totals.opex += cost; totals.res += res;
  }
  return { dreData, totals, meses };
}

function calcScenario(s: Scenario, state: DREState, meses: number) {
  let totalCost = 0;
  for (let m = 1; m <= meses; m++) {
    let mc = 0;
    if (state.areaCosts) {
      Object.values(state.areaCosts).forEach(area => {
        if (Array.isArray(area)) {
          area.forEach(c => { if (m >= c.startM && m <= c.endM) mc += c.monthly; });
        }
      });
    }
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
    const rSub = m >= ini ? h * (state.piloto > 0 ? state.piloto : s.sub) : 0;
    const rPerf = (m >= ini && state.piloto === 0) ? h * s.perf : 0;
    const rEquaPay = m >= state.revShareIni ? h * state.equaPayVol * (state.equaPayTaxa / 100) : 0;
    const rRevShare = m >= state.revShareIni ? h * state.revShareBase * (state.revSharePct / 100) : 0;
    const rec = rSub + rPerf + rEquaPay + rRevShare;
    let c = 0;
    if (state.areaCosts) {
      Object.values(state.areaCosts).forEach(area => {
        if (Array.isArray(area)) {
          area.forEach(ci => { if (m >= ci.startM && m <= ci.endM) c += ci.monthly; });
        }
      });
    }
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
  const [isReadOnly, setIsReadOnly] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsReadOnly(new URLSearchParams(window.location.search).get('readonly') === 'true');
    }
  }, []);

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
        if (serverState && typeof serverState === 'object') {
          console.log('✅ Server state loaded');
          // Merge with DEFAULT_STATE to ensure all keys exist
          const mergedState = { ...DEFAULT_STATE, ...serverState };
          // Ensure nested objects/arrays are also merged or initialized if missing
          if (!mergedState.areaCosts) mergedState.areaCosts = DEFAULT_STATE.areaCosts;
          if (!mergedState.phases) mergedState.phases = DEFAULT_STATE.phases;
          if (!mergedState.scenarios) mergedState.scenarios = DEFAULT_STATE.scenarios;
          
          setState(mergedState as DREState);
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
    if (isReadOnly) return;
    setState(prev => {
      const next = { ...prev, ...updates };
      try { localStorage.setItem('dre_state_v18', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, [isReadOnly]);

  useEffect(() => {
    if (!isLoaded || isReadOnly) return;
    const timer = setTimeout(async () => {
      setIsSyncing(true);
      try { 
        console.log('--- Syncing to Supabase ---');
        const { error } = await supabase
          .from('dre_data')
          .upsert({ id: 1, state: state });
        
        if (error) throw error;
        console.log('✅ Sync success');
      } catch (err: any) {
        console.error('❌ Sync failed:', err.message || err);
      } finally { 
        setIsSyncing(false); 
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [state, isLoaded]);

  const { dreData, totals, meses } = useMemo(() => calcDRE(state), [state]);
  const projCalculada = useMemo(() => {
    const proj = state.projecao || DEFAULT_STATE.projecao!;
    const res: Record<string, any> = {};
    let currentBase = 0;
    ['ano1', 'ano2', 'ano3', 'ano4'].forEach((y, i) => {
      const ky = y as 'ano1' | 'ano2' | 'ano3' | 'ano4';
      const term = proj[ky] || DEFAULT_STATE.projecao![ky];
      const startBase = currentBase;
      const totalBeforeChurn = startBase + (term.novosHospitais || 0);
      const lost = Math.round(totalBeforeChurn * ((term.churnAnual || 0) / 100));
      const net = totalBeforeChurn - lost;
      const finalTicket = (term.ticketInicial || 0) * (1 + (term.expansaoUpsell || 0) / 100);
      res[ky] = { ...term, hospitaisFim: net, hospitaisPerdidos: lost, hospitaisInicio: startBase, ticket: finalTicket };
      currentBase = net;
    });
    return res;
  }, [state.projecao]);
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

  const addMilestone = () => { const last = state.phases.reduce((m, p) => Math.max(m, p.endM), 0); handleUpdate({ phases: [...state.phases, { id: uid(), name: `M${state.phases.length + 1} · Novo Milestone`, startM: last + 1, endM: last + 6, objective: '', kr: '', krs: [{ id: uid(), text: 'Novo KR' }], initiatives: [{ id: uid(), name: 'Nova iniciativa', area: 'produto', subarea: '', pct: 0, kpis: [{ id: uid(), metric: 'Nova métrica', target: 'Meta', initiative: '' }] }] }] }); };
  const delMilestone = (pid: number) => handleUpdate({ phases: state.phases.filter(p => p.id !== pid) });
  const updPhase = (pid: number, patch: Partial<Phase>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, ...patch } : p) });
  const addKR = (pid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, krs: [...(p.krs || []), { id: uid(), text: '' }] } : p) });
  const delKR = (pid: number, krid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, krs: (p.krs || []).filter(k => k.id !== krid) } : p) });
  const updKR = (pid: number, krid: number, text: string) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, krs: (p.krs || []).map(k => k.id === krid ? { ...k, text } : k) } : p) });
  const addInitiative = (pid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: [...p.initiatives, { id: uid(), name: 'Nova iniciativa', area: 'produto', subarea: '', pct: 0, kpis: [{ id: uid(), metric: 'Nova métrica', target: 'Meta', initiative: '' }] }] } : p) });
  const delInitiative = (pid: number, iid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.filter(i => i.id !== iid) } : p) });
  const updInitiative = (pid: number, iid: number, patch: Partial<Initiative>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, ...patch } : i) } : p) });
  const addKPI = (pid: number, iid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: [...i.kpis, { id: uid(), metric: 'Nova métrica', target: 'Meta' }] } : i) } : p) });
  const delKPI = (pid: number, iid: number, kid: number) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: i.kpis.filter(k => k.id !== kid) } : i) } : p) });
  const updKPI = (pid: number, iid: number, kid: number, patch: Partial<KPI>) => handleUpdate({ phases: state.phases.map(p => p.id === pid ? { ...p, initiatives: p.initiatives.map(i => i.id === iid ? { ...i, kpis: i.kpis.map(k => k.id === kid ? { ...k, ...patch } : k) } : i) } : p) });
  const addCost = (area: string) => { const nc = { ...state.areaCosts }; nc[area] = [...nc[area], { id: uid(), cat: 'folha', desc: 'Novo item', monthly: 0, startM: 1, endM: meses }]; handleUpdate({ areaCosts: nc }); };
  const delCost = (area: string, cid: number) => { const nc = { ...state.areaCosts }; nc[area] = nc[area].filter(c => c.id !== cid); handleUpdate({ areaCosts: nc }); };
  const updCost = (area: string, cid: number, patch: Partial<CostItem>) => { const nc = { ...state.areaCosts }; nc[area] = nc[area].map(c => c.id === cid ? { ...c, ...patch } : c); handleUpdate({ areaCosts: nc }); };
  const addScenario = () => handleUpdate({ scenarios: [...state.scenarios, { id: uid(), name: 'Novo Cenário', cap: state.captacao, eq: state.equity, hFim: state.hFim, sub: state.sub, perf: state.perf, runwayTarget: null, contratoAssinado: 1, primeiraReceita: 1, cicloVenda: 0, onboarding: 0, caixaMinimo: '', novaRodada: 1 }] });
  const delScenario = (sid: number) => handleUpdate({ scenarios: state.scenarios.filter(s => s.id !== sid) });
  const updScenario = (sid: number, patch: Partial<Scenario>) => handleUpdate({ scenarios: state.scenarios.map(s => s.id === sid ? { ...s, ...patch } : s) });

  const allocAreas: Record<string, number> = {}; let allocTotal = 0;
  for (let m = 1; m <= meses; m++) {
    if (state.areaCosts) {
      Object.keys(state.areaCosts).forEach(a => {
        const areaItems = state.areaCosts[a];
        if (Array.isArray(areaItems)) {
          areaItems.forEach(c => { 
            if (m >= c.startM && m <= c.endM) { 
              allocAreas[a] = (allocAreas[a] || 0) + c.monthly; 
              allocTotal += c.monthly; 
            } 
          });
        }
      });
    }
  }

  const leituraText = lastD ? `Com captação de ${BRL(state.captacao)} (${state.equity}% equity) e ${meses} meses de horizonte, a empresa atinge ${lastD.h} hospitais e encerra o período com caixa ${lastD.caixa > 0 ? 'positivo' : 'negativo'} de ${BRL(lastD.caixa)}. Receita total: ${BRL(totals.rec)}${totals.rEquaPay > 0 ? ` (inclui ${BRL(totals.rEquaPay)} Equa Pay + ${BRL(totals.rRevShare)} Rev Share).` : '.'}` : '';

  if (!isLoaded) return <div className="app-loading">Carregando dados...</div>;

  return (
    <div className={`app ${isReadOnly ? 'readonly-mode' : ''}`}>
      {isReadOnly && (
        <div className="view-mode-banner">
          Modo de Visualização - Edições desativadas
        </div>
      )}
      <div className="hero">
        <div className="hero-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/equa-logo.png" alt="Equa" style={{ height: '32px' }} />
            <span className="app-title" style={{ marginLeft: '4px', borderLeft: '1px solid var(--bor)', paddingLeft: '14px' }}>Business</span>
            {isSyncing && <span style={{ fontSize: '0.7rem', color: 'var(--txm)', fontStyle: 'italic' }}>🔄 Sincronizando...</span>}
          </div>

          
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
      <div className="tabs hide-on-mobile">
        {[['resumo','Resumo'],['premissas','Alocação do capital'],['roadmap','GTM / OKRs'],['piloto','Piloto e captura de valor'],['dre','DRE (Capital)'],['cenarios','Cenários'],['modelo','Modelo de negócio'],['receita','Projeção de receita']].map(([k,l]) => (
          <button key={k} className={`tab-btn${activeTab===k?' active':''}`} onClick={() => setActiveTab(k)}>{l}</button>
        ))}
      </div>
      <div className="mobile-tabs-container hide-on-desktop">
        <select value={activeTab} onChange={(e) => setActiveTab(e.target.value)} className="mobile-tabs-select">
          {[['resumo','Resumo'],['premissas','Alocação do capital'],['roadmap','GTM / OKRs'],['piloto','Piloto e captura de valor'],['dre','DRE (Capital)'],['cenarios','Cenários'],['modelo','Modelo de negócio'],['receita','Projeção de receita'],['proxima','Próxima rodada']].map(([k,l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </div>
      {activeTab === 'resumo' && (
        <section className="tab-panel active g1">
          <div className="status-grid">
            <div className="status-card">
              <div className="status-info">
                <span className="status-label">Runway</span>
                <strong className="status-value">12 meses</strong>
              </div>
            </div>
            <div className="status-card">
              <div className="status-info">
                <span className="status-label">Caixa final</span>
                <strong className="status-value">R$ 74 mil</strong>
              </div>
            </div>
            <div className="status-card">
              <div className="status-info">
                <span className="status-label">Milestone principal</span>
                <strong className="status-value">contrato assinado + 1ª receita</strong>
              </div>
            </div>
            <div className="status-card">
              <div className="status-info">
                <span className="status-label">Gatilho próxima rodada</span>
                <strong className="status-value">contrato assinado / piloto validado</strong>
              </div>
            </div>
          </div>

          <div className="g2">
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
              <div className="metric"><span>Subscription (total)</span><strong>{BRL(totals.rSub)}</strong></div>
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
          
          <div className="panel" style={{ marginTop: '1.5rem' }}><div className="ph"><h2>Projeção de receita</h2></div><div className="pb-nopad">
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              {(() => {
                const xsProj = ['Ano 1', 'Ano 2', 'Ano 3', 'Ano 4'];
                const subData = ['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                  const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                  const rec = proj.hospitaisMedios * proj.ticket * 12;
                  return rec * ((proj.subPct ?? 0) / 100);
                });
                const perfData = ['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                  const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                  const rec = proj.hospitaisMedios * proj.ticket * 12;
                  return rec * ((proj.perfPct ?? 0) / 100);
                });
                const costData = ['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                  const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                  return proj.custo * 12;
                });
                return (
                  <Plot data={[
                    { type: 'bar', name: 'Subscription', x: xsProj, y: subData, marker: { color: '#7C5CFC' } },
                    { type: 'bar', name: 'Perf. Fee', x: xsProj, y: perfData, marker: { color: '#A78BFA' } },
                    { type: 'scatter', mode: 'lines', name: 'Custos', x: xsProj, y: costData, line: { color: '#964219', width: 2, dash: 'dot' } as any },
                  ] as any} layout={getLayout({ barmode: 'stack', margin: { t: 20, r: 10, b: 40, l: 80 }, legend: { orientation: 'h', y: -0.15 }, height: 280 }) as any} style={{ width: '100%' }} config={chartConfig} useResizeHandler />
                );
              })()}
            </div>
          </div></div>

          <div className="panel" style={{ marginTop: '1.5rem' }}><div className="ph"><h2>Retorno potencial para investidores (MOIC)</h2></div><div className="pb-nopad">
            <div style={{ padding: '1.25rem 1.25rem 0' }}>
              {(() => {
                const xsProj = ['Ano 2', 'Ano 3', 'Ano 4'];
                
                const cap = state.projecao?.invest_cap ?? DEFAULT_STATE.projecao!.invest_cap!;
                const pre = state.projecao?.invest_pre ?? DEFAULT_STATE.projecao!.invest_pre!;
                const post = cap + pre;
                const part = post > 0 ? (cap / post) : 0;
                const diluicao = (state.projecao?.diluicao ?? DEFAULT_STATE.projecao!.diluicao!) / 100;
                const multBase = state.projecao?.mult_base ?? DEFAULT_STATE.projecao!.mult_base!;
                const multSub = state.projecao?.mult_sub ?? DEFAULT_STATE.projecao!.mult_sub!;
                const multPerf = state.projecao?.mult_perf ?? DEFAULT_STATE.projecao!.mult_perf!;
                const valType = state.projecao?.val_type ?? 'weighted';

                const moicSemDiluicao = xsProj.map((_, i) => {
                  const p = ['ano2', 'ano3', 'ano4'][i];
                  const proj = state.projecao?.[p as "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano2" | "ano3" | "ano4"];
                  const arr = proj.hospitaisFim * proj.ticket * 12;
                  let val = 0;
                  if (valType === 'weighted') {
                    val = (arr * ((proj.subPct ?? 0) / 100) * multSub) + (arr * ((proj.perfPct ?? 0) / 100) * multPerf);
                  } else {
                    val = arr * multBase;
                  }
                  const returnVal = val * part;
                  return cap > 0 ? returnVal / cap : 0;
                });

                const moicComDiluicao = xsProj.map((_, i) => {
                  const p = ['ano2', 'ano3', 'ano4'][i];
                  const proj = state.projecao?.[p as "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano2" | "ano3" | "ano4"];
                  const arr = proj.hospitaisFim * proj.ticket * 12;
                  let val = 0;
                  if (valType === 'weighted') {
                    val = (arr * ((proj.subPct ?? 0) / 100) * multSub) + (arr * ((proj.perfPct ?? 0) / 100) * multPerf);
                  } else {
                    val = arr * multBase;
                  }
                  const returnVal = val * diluicao;
                  return cap > 0 ? returnVal / cap : 0;
                });

                return (
                  <Plot data={[
                    { type: 'bar', name: 'Sem diluição', x: xsProj, y: moicSemDiluicao, marker: { color: '#7C5CFC' }, text: moicSemDiluicao.map(v => v.toFixed(1) + 'x'), textposition: 'auto' },
                    { type: 'bar', name: 'Com diluição', x: xsProj, y: moicComDiluicao, marker: { color: '#A78BFA' }, text: moicComDiluicao.map(v => v.toFixed(1) + 'x'), textposition: 'auto' },
                  ] as any} layout={getLayout({ barmode: 'group', margin: { t: 20, r: 10, b: 40, l: 40 }, legend: { orientation: 'h', y: -0.15 }, height: 280, yaxis: { title: 'MOIC (x)' } }) as any} style={{ width: '100%' }} config={chartConfig} useResizeHandler />
                );
              })()}
            </div>
          </div></div>

          </div>
        </section>
      )}
      {activeTab === 'premissas' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>Alocação do capital</h2>{premDirty && <span style={{ fontSize: '.78rem', color: 'var(--war)', fontWeight: 600 }}>⚠ Alterações pendentes — clique em Aplicar</span>}</div><div className="pb">
            <div className="fields sub4">
              <PHintField label="Captação (R$)" field="captacao" value={getPrem('captacao') as number} onChange={(v: string) => setPremField('captacao', Number(v))} hint={FIELD_HINTS.captacao} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Equity %" field="equity" step={0.1} value={getPrem('equity') as number} onChange={(v: string) => setPremField('equity', Number(v))} hint={FIELD_HINTS.equity} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Hospitais alvo" field="hFim" value={getPrem('hFim') as number} onChange={(v: string) => setPremField('hFim', Number(v))} hint={FIELD_HINTS.hFim} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Prazo total (meses)" field="mesesPlan" min={6} max={36} value={getPrem('mesesPlan') as number} onChange={(v: string) => setPremField('mesesPlan', Math.min(36, Math.max(6, Number(v))))} hint={FIELD_HINTS.mesesPlan} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
            </div>
            <div className="fields sub2" style={{ marginTop: '.875rem' }}><PHintField label="Início 1ª receita (mês)" field="inicioRec" value={getPrem('inicioRec') as number} onChange={(v: string) => setPremField('inicioRec', Number(v))} hint={FIELD_HINTS.inicioRec} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} /></div>
            
            <div className="section-divider" />
            <span className="lbl">🏥 Receita Core</span>
            <div className="fields sub2">
              <PHintField label="Subscription / contrato (R$)" field="sub" value={getPrem('sub') as number} onChange={(v: string) => setPremField('sub', Number(v))} hint={FIELD_HINTS.sub} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <PHintField label="Performance Fee / contrato (R$)" field="perf" value={getPrem('perf') as number} onChange={(v: string) => setPremField('perf', Number(v))} hint={FIELD_HINTS.perf} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
            </div>
            
            <div className="section-divider" />
            <span className="lbl">⚡ Equa Pay — Antecipação</span>
            <div className="fields sub2">
              <PHintField label="Faturamento do hospital / mês (R$)" field="equaPayVol" value={getPrem('equaPayVol') as number} onChange={(v: string) => setPremField('equaPayVol', Number(v))} hint={FIELD_HINTS.equaPayVol} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
              <div className="field"><label>Taxa de antecipação (%) <InfoBtn field="equaPayTaxa" /></label><input type="number" step={0.1} value={getPrem('equaPayTaxa') as number} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPremField('equaPayTaxa', Number(e.target.value))} /><small>Cobrada sobre o faturamento</small><TooltipBox field="equaPayTaxa" /></div>
            </div>
            
            <div className="section-divider" />
            <span className="lbl">📊 Revenue Share</span>
            <div className="fields sub2">
              <div className="field"><label>Revenue Share (%) <InfoBtn field="revSharePct" /></label><input type="number" step={0.5} value={getPrem('revSharePct') as number} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPremField('revSharePct', Number(e.target.value))} /><small>% sobre o faturamento antecipado</small><TooltipBox field="revSharePct" /></div>
              <PHintField label="Mês de início (Equa Pay + Rev. Share)" field="revShareIni" value={getPrem('revShareIni') as number} onChange={(v: string) => setPremField('revShareIni', Number(v))} hint={FIELD_HINTS.revShareIni} tooltip={tooltip} setTooltip={setTooltip} InfoBtn={InfoBtn} TooltipBox={TooltipBox} />
            </div>
            <div className="actions" style={{ marginTop: '1.5rem' }}><button className="btn pri" onClick={applyPremissas} style={{ opacity: premDirty ? 1 : 0.55 }}>✓ Aplicar premissas</button></div>
          </div></div>
          
          <div className="panel"><div className="ph"><h2>Estrutura de Custos</h2></div><div className="pb">
            {AREA_LIST.map(area => {
              const items = state.areaCosts[area] || []; const total = items.reduce((a, c) => a + c.monthly, 0);
              return (
                <div key={area} className="custo-panel">
                  <div className="custo-header">
                    <div>
                      <span className="custo-area-name">{AREA_LABELS[area]}</span>
                      <div className="custo-summary">
                        <span className="pill pri">{BRL(total)}/mês médio</span>
                        <span className="pill">{items.length} itens</span>
                      </div>
                    </div>
                    <button className="btn-sm pri" onClick={() => addCost(area)}>+ Item</button>
                  </div>
                  <div className="custo-body tw">
                    <table className="cost-table">
                      <thead>
                        <tr>
                          <th>CATEGORIA</th>
                          <th>DESCRIÇÃO</th>
                          <th>R$/MÊS</th>
                          <th>MÊS INI.</th>
                          <th>MÊS FIM</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(c => (
                          <tr key={c.id}>
                            <td>
                              <select value={c.cat} onChange={(e) => updCost(area, c.id, { cat: e.target.value as any })}>
                                {Object.keys(CAT_LABELS).map(cat => <option key={cat} value={cat}>{CAT_LABELS[cat]}</option>)}
                              </select>
                            </td>
                            <td><input value={c.desc} onChange={(e) => updCost(area, c.id, { desc: e.target.value })} /></td>
                            <td><input type="number" value={c.monthly} onChange={(e) => updCost(area, c.id, { monthly: Number(e.target.value) })} /></td>
                            <td><input type="number" value={c.startM} style={{ width: '60px' }} onChange={(e) => updCost(area, c.id, { startM: Number(e.target.value) })} /></td>
                            <td><input type="number" value={c.endM} style={{ width: '60px' }} onChange={(e) => updCost(area, c.id, { endM: Number(e.target.value) })} /></td>
                            <td><button className="btn-icon danger" onClick={() => delCost(area, c.id)}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div></div>
        </section>
      )}
      {activeTab === 'roadmap' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>GTM / OKRs</h2></div><div className="pb">
            {(state.phases || []).map(ph => (
              <div key={ph.id} className="okr-card-v2">
                <div className="okr-header">
                  <div className="milestone-badge-v2">{ph.name}</div>
                  <div className="pill-v2">M{ph.startM}–M{ph.endM}</div>
                  <button className="btn-icon danger" onClick={() => delMilestone(ph.id)}>✕</button>
                </div>
                
                <div className="okr-main-fields">
                  <div className="field-v2">
                    <label>NOME DO MILESTONE</label>
                    <textarea rows={2} style={{ minHeight: '50px', resize: 'vertical' }} value={ph.name} onChange={(e) => updPhase(ph.id, { name: e.target.value })} />
                  </div>
                  <div className="field-v2">
                    <label>OBJETIVO</label>
                    <textarea rows={5} style={{ minHeight: '100px', resize: 'vertical' }} value={ph.objective} onChange={(e) => updPhase(ph.id, { objective: e.target.value })} />
                  </div>
                  <div className="field-v2-sm">
                    <label>MÊS INÍCIO</label>
                    <input type="number" value={ph.startM} onChange={(e) => updPhase(ph.id, { startM: Number(e.target.value) })} />
                  </div>
                  <div className="field-v2-sm">
                    <label>MÊS FIM</label>
                    <input type="number" value={ph.endM} onChange={(e) => updPhase(ph.id, { endM: Number(e.target.value) })} />
                  </div>
                </div>

                <div className="field-v2" style={{ marginTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label style={{ margin: 0 }}>KEY RESULTS</label>
                    <button className="btn-sm outline" onClick={() => addKR(ph.id)}>+ Adicionar KR</button>
                  </div>
                  {(!ph.krs || ph.krs.length === 0) && (
                    <textarea value={ph.kr} onChange={(e) => updPhase(ph.id, { kr: e.target.value })} placeholder="Ex: MRR ≥ R$ 200k, Churn < 5%" style={{ marginBottom: '0.5rem' }} />
                  )}
                  {ph.krs && ph.krs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {ph.krs.map(kr => (
                        <div key={kr.id} style={{ display: 'flex', gap: '0.5rem' }}>
                          <input style={{ flex: 1 }} value={kr.text} onChange={(e) => updKR(ph.id, kr.id, e.target.value)} placeholder="Descrição do Key Result" />
                          <button className="btn-icon danger" onClick={() => delKR(ph.id, kr.id)}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="initiatives-list">
                  {(ph.initiatives || []).map(ini => (
                    <div key={ini.id} className="initiative-box">
                      <div className="init-header">
                        <div className="field-v2">
                          <label>INICIATIVA</label>
                          <input value={ini.name} onChange={(e) => updInitiative(ph.id, ini.id, { name: e.target.value })} />
                        </div>
                        <div className="field-v2">
                          <label>ÁREA</label>
                          <select value={ini.area} onChange={(e) => updInitiative(ph.id, ini.id, { area: e.target.value })}>
                            {Object.keys(AREA_LABELS).map(a => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
                          </select>
                        </div>
                        <div className="field-v2">
                          <label>SUBÁREA</label>
                          <input value={ini.subarea} onChange={(e) => updInitiative(ph.id, ini.id, { subarea: e.target.value })} />
                        </div>
                        <div className="field-v2-sm">
                          <label>% ALOC.</label>
                          <input type="number" value={ini.pct} onChange={(e) => updInitiative(ph.id, ini.id, { pct: Number(e.target.value) })} />
                        </div>
                        <div className="init-actions">
                  <button className="btn-sm pri" onClick={() => addKPI(ph.id, ini.id)}>+ KPI</button>
                          <button className="btn-icon danger" onClick={() => delInitiative(ph.id, ini.id)}>✕</button>
                        </div>
                      </div>

                      <div className="kpi-nested-list">
                        <div className="tw">
                          <table className="kpi-table-v2">
                            <thead>
                              <tr>
                                <th style={{ width: '300px', textAlign: 'left' }}>AÇÃO / INICIATIVA</th>
                                <th style={{ width: '220px', textAlign: 'left' }}>MÉTRICA</th>
                                <th style={{ width: '180px', textAlign: 'left' }}>META</th>
                                <th style={{ width: '50px' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(ini.kpis || []).map(k => (
                                <tr key={k.id}>
                                  <td><textarea rows={2} value={k.initiative || ''} onChange={(e) => updKPI(ph.id, ini.id, k.id, { initiative: e.target.value })} placeholder="Ex: Desenvolver feature X" /></td>
                                  <td><textarea rows={2} value={k.metric} onChange={(e) => updKPI(ph.id, ini.id, k.id, { metric: e.target.value })} placeholder="Ex: Taxa de conversão" /></td>
                                  <td><textarea rows={2} value={k.target} onChange={(e) => updKPI(ph.id, ini.id, k.id, { target: e.target.value })} placeholder="Ex: > 10%" /></td>
                                  <td style={{ textAlign: 'center' }}><button className="btn-icon danger" onClick={() => delKPI(ph.id, ini.id, k.id)}>✕</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button className="btn outline" onClick={() => addInitiative(ph.id)} style={{ marginTop: '1rem' }}>+ Adicionar Iniciativa</button>
                </div>
              </div>
            ))}
            <button className="btn pri" onClick={addMilestone}>+ Adicionar Milestone</button>
          </div></div>
        </section>
      )}
      {activeTab === 'receita' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>Projeção de Receita (Macro)</h2></div><div className="pb">
            <p className="note" style={{ marginBottom: '1.5rem' }}>Esta projeção possui lógica própria para estimar cenários de curto, médio e longo prazo, independente das premissas mensais do DRE.</p>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Crescimento da Base e Churn</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>PREMISSA / MÉTRICA</th>
                    <th className="r">1 ANO</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Novos hospitais contratados</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      return (
                        <td key={p} className="r">
                          <input 
                            type="number" 
                            className="scen-input" 
                            value={proj[keyP].novosHospitais || 0} 
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              handleUpdate({ projecao: { ...proj, [keyP]: { ...proj[keyP], novosHospitais: val } } });
                            }} 
                          />
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Churn anual (%)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      return (
                        <td key={p} className="r">
                          <input 
                            type="number" 
                            className="scen-input" 
                            value={proj[keyP].churnAnual || 0} 
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              handleUpdate({ projecao: { ...proj, [keyP]: { ...proj[keyP], churnAnual: val } } });
                            }} 
                          />
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="subtotal" style={{ opacity: 0.8 }}>
                    <td>Hospitais perdidos (churn sobre base total)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p) => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      return <td key={p} className="r">{projCalculada[keyP].hospitaisPerdidos}</td>;
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td><strong>Hospitais ativos líquidos no fim do ano</strong></td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p) => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      return <td key={p} className="r bold">{projCalculada[keyP].hospitaisFim}</td>;
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '1.1rem', marginTop: '2rem', marginBottom: '1rem', color: 'var(--pri)' }}>Unit Economics estimado</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>MÉTRICA</th>
                    <th className="r">1 ANO</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>CAC médio por hospital (R$)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      return <td key={p} className="r"><input type="number" className="scen-input" value={proj[keyP].cac || 0} onChange={(e) => handleUpdate({ projecao: { ...proj, [keyP]: { ...proj[keyP], cac: Number(e.target.value) } } })} /></td>;
                    })}
                  </tr>
                  <tr>
                    <td>Margem bruta estimada (%)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      return <td key={p} className="r"><input type="number" className="scen-input" value={proj[keyP].margemBruta || 0} onChange={(e) => handleUpdate({ projecao: { ...proj, [keyP]: { ...proj[keyP], margemBruta: Number(e.target.value) } } })} /></td>;
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td>Receita reconhecida média por hospital</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = projCalculada[keyP];
                      let recYear = proj.hospitaisMedios * proj.ticket * 12;
                      if (i === 0) {
                        recYear = dreData.slice(0, 12).reduce((sum, d) => sum + d.recReconhecida, 0);
                        return <td key={p} className="r bold">{BRL(recYear / (proj.hospitaisFim || 1))}</td>;
                      }
                      if (proj.hospitaisMedios <= 0) return <td key={p} className="r">N/A</td>;
                      return <td key={p} className="r bold">{BRL(recYear / proj.hospitaisMedios)}</td>;
                    })}
                  </tr>
                  <tr>
                    <td>Receita anualizada de saída por hospital / run-rate</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as 'ano1' | 'ano2' | 'ano3' | 'ano4'];
                      return <td key={p} className="r">{BRL(proj.ticket * 12)}</td>;
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td>Payback CAC (meses)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as 'ano1' | 'ano2' | 'ano3' | 'ano4'];
                      if (i === 0) return <td key={p} className="r" style={{ fontSize: '0.75rem', opacity: 0.7 }}>N/A — ano de validação</td>;
                      const mbMensal = proj.ticket * (proj.margemBruta / 100);
                      if (mbMensal <= 0 || proj.cac <= 0) return <td key={p} className="r">N/A</td>;
                      return <td key={p} className="r bold">{(proj.cac / mbMensal).toFixed(1)}</td>;
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td>LTV / CAC</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as 'ano1' | 'ano2' | 'ano3' | 'ano4'];
                      if (i === 0) return <td key={p} className="r" style={{ fontSize: '0.75rem', opacity: 0.7 }}>N/A — ano de validação</td>;
                      const mbAnual = proj.ticket * 12 * (proj.margemBruta / 100);
                      const vidaUtil = Math.min(proj.churnAnual > 0 ? 1 / (proj.churnAnual / 100) : 5, 5);
                      const ltv = mbAnual * vidaUtil;
                      if (proj.cac <= 0) return <td key={p} className="r">N/A</td>;
                      return <td key={p} className="r bold">{(ltv / proj.cac).toFixed(1)}x</td>;
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: '1rem', fontSize: '0.85rem', lineHeight: '1.4' }}>
              No Ano 1, os unit economics ainda não devem ser lidos como métricas maduras de aquisição, mas como custo de validação do primeiro hospital. A receita reconhecida média reflete o valor efetivamente reconhecido no período, enquanto o run-rate anualizado representa apenas a receita mensalizada de saída. Payback CAC e LTV/CAC são apresentados como N/A no Ano 1. A partir do Ano 2, as métricas passam a refletir uma operação comercial mais recorrente. Para evitar distorções por churn baixo em uma base ainda sem histórico, o cálculo de LTV/CAC utiliza vida útil máxima de 5 anos.
            </p>

            <h3 style={{ fontSize: '1.1rem', marginTop: '2rem', marginBottom: '1rem', color: 'var(--pri)' }}>Expansão e NRR</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>MÉTRICA</th>
                    <th className="r">1 ANO</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Ticket inicial médio (R$)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      return (
                        <td key={p} className="r">
                          <input 
                            type="number" 
                            className="scen-input" 
                            value={proj[keyP].ticketInicial || 0} 
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              handleUpdate({ projecao: { ...proj, [keyP]: { ...proj[keyP], ticketInicial: val } } });
                            }} 
                          />
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Expansão líquida por cliente (%)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      return (
                        <td key={p} className="r">
                          <input 
                            type="number" 
                            className="scen-input" 
                            value={proj[keyP].expansaoUpsell || 0} 
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              handleUpdate({ projecao: { ...proj, [keyP]: { ...proj[keyP], expansaoUpsell: val } } });
                            }} 
                          />
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td>Ticket final (com expansão)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = projCalculada[keyP];
                      return <td key={p} className="r bold">{BRL(proj.ticket)}</td>;
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td>NRR estimado (%)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = projCalculada[keyP];
                      if (i === 0) {
                        return <td key={p} className="r" style={{ fontSize: '0.75rem', opacity: 0.7 }}>N/A — ano de validação</td>;
                      }
                      const nrr = 100 + (proj.expansaoUpsell || 0) - (proj.churnAnual || 0);
                      return <td key={p} className="r bold">{nrr.toFixed(1)}%</td>;
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
              NRR é uma métrica projetada, não histórica. Ela mede a retenção líquida esperada da receita da base existente, excluindo novos hospitais. A métrica considera expansão por upsell, aumento de volume e módulos adicionais, descontando churn e eventuais downgrades.
            </p>

            <div className="section-divider" />
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Resultados Projetados (Consolidado)</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>PREMISSA / MÉTRICA</th>
                    <th className="r">1 ANO</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Hospitais médios faturando no ano</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      return <td key={p} className="r"><input type="number" className="scen-input" value={proj[keyP].hospitaisMedios} onChange={(e) => handleUpdate({ projecao: { ...proj, [keyP]: { ...proj[keyP], hospitaisMedios: Number(e.target.value) } } })} /></td>;
                    })}
                  </tr>
                  <tr>
                    <td>Custo operacional anual (R$)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao!;
                      let cst = proj[keyP].custo * 12;
                      if (i === 0) {
                        cst = dreData.slice(0, 12).reduce((sum, d) => sum + (d.cost || 0), 0);
                      }
                      return <td key={p} className="r">{BRL(cst)}</td>;
                    })}
                  </tr>
                  <tr style={{ height: '1rem' }}><td colSpan={5}></td></tr>
                  <tr className="subtotal">
                    <td>Receita reconhecida no ano</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      let rec = proj.hospitaisMedios * proj.ticket * 12;
                      if (i === 0) {
                        rec = dreData.slice(0, 12).reduce((sum, d) => sum + d.recReconhecida, 0);
                      }
                      return <td key={p} className="r bold">{BRL(rec)}</td>
                    })}
                  </tr>
                  <tr className="subtotal" style={{ color: 'var(--war)' }}>
                    <td>Custo operacional anual (total)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      let cst = proj.custo * 12;
                      if (i === 0) {
                        cst = dreData.slice(0, 12).reduce((sum, d) => sum + (d.cost || 0), 0);
                      }
                      return <td key={p} className="r bold">-{BRL(cst)}</td>
                    })}
                  </tr>
                  <tr className="total">
                    <td style={{ color: 'var(--pri)' }}>Margem operacional anual</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      let rec = proj.hospitaisMedios * proj.ticket * 12;
                      let cst = proj.custo * 12;
                      if (i === 0) {
                        rec = dreData.slice(0, 12).reduce((sum, d) => sum + d.recReconhecida, 0);
                        cst = dreData.slice(0, 12).reduce((sum, d) => sum + (d.cost || 0), 0);
                      }
                      return <td key={p} className="r bold" style={{ color: 'var(--pri)' }}>{BRL(rec - cst)}</td>
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td>MRR de saída (Receita mensalizada)</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      return <td key={p} className="r bold">{BRL(proj.hospitaisFim * proj.ticket)}</td>
                    })}
                  </tr>
                  <tr className="subtotal">
                    <td>Receita anualizada de saída</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      return <td key={p} className="r bold">{BRL(proj.hospitaisFim * proj.ticket * 12)}</td>
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
              Receita reconhecida representa o valor efetivamente reconhecido dentro do ano. MRR de saída representa a receita mensalizada ao final do período, calculada com base nos hospitais ativos líquidos após churn. Receita anualizada de saída é o run-rate do fim do ano e não deve ser confundida com receita reconhecida no período.
            </p>
            
            <div style={{ padding: '1.5rem 0 0' }}>
              {(() => {
                const xsProj = ['Ano 1', 'Ano 2', 'Ano 3', 'Ano 4'];
                const recData = ['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                  const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                  if (i === 0) return dreData.slice(0, 12).reduce((sum, d) => sum + d.recReconhecida, 0);
                  return proj.hospitaisMedios * proj.ticket * 12;
                });
                const arrData = ['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                  const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                  return proj.hospitaisFim * proj.ticket * 12;
                });
                const costData = ['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                  const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                  if (i === 0) return dreData.slice(0, 12).reduce((sum, d) => sum + (d.cost || 0), 0);
                  return proj.custo * 12;
                });
                return (
                  <Plot data={[
                    { type: 'bar', name: 'Receita Reconhecida', x: xsProj, y: recData, marker: { color: '#A78BFA' } },
                    { type: 'scatter', mode: 'lines+markers', name: 'Receita anualizada de saída', x: xsProj, y: arrData, line: { color: '#7C5CFC', width: 3 } as any },
                    { type: 'scatter', mode: 'lines', name: 'Custo Operacional', x: xsProj, y: costData, line: { color: '#964219', width: 2, dash: 'dot' } as any },
                  ] as any} layout={getLayout({ margin: { t: 20, r: 10, b: 40, l: 60 }, legend: { orientation: 'h', y: -0.15 }, height: 280, yaxis: { title: 'R$' } }) as any} style={{ width: '100%' }} config={chartConfig} useResizeHandler />
                );
              })()}
            </div>
          </div></div>
        </section>
      )}
      {activeTab === 'modelo' && (
        <section className="tab-panel active g1">
          <div className="panel" style={{ marginTop: '1.5rem' }}><div className="ph"><h2>Modelo de negócio e qualidade da receita</h2></div><div className="pb">
            <p className="note" style={{ marginBottom: '1.5rem' }}>A Equa inicia com um modelo híbrido, combinando subscription e performance fee. O performance fee reduz a fricção comercial e alinha a remuneração ao resultado financeiro do hospital. Ao longo do tempo, a estratégia é aumentar a participação da subscription, tornando a receita mais previsível, recorrente e valorizável.</p>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>COMPOSIÇÃO (%)</th>
                    <th className="r">1 ANO</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Subscription (%)</strong></td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao || DEFAULT_STATE.projecao!;
                      const term = proj[keyP] || DEFAULT_STATE.projecao![keyP];
                      return <td key={p} className="r"><input type="number" className="scen-input" value={term.subPct ?? 0} onChange={(e) => { const v = Number(e.target.value); handleUpdate({ projecao: { ...proj, [keyP]: { ...term, subPct: v, perfPct: 100 - v } } }); }} /></td>;
                    })}
                  </tr>
                  <tr>
                    <td><strong>Performance Fee (%)</strong></td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map(p => {
                      const keyP = p as 'ano1' | 'ano2' | 'ano3' | 'ano4';
                      const proj = state.projecao || DEFAULT_STATE.projecao!;
                      const term = proj[keyP] || DEFAULT_STATE.projecao![keyP];
                      return <td key={p} className="r"><input type="number" className="scen-input" value={term.perfPct ?? 0} onChange={(e) => { const v = Number(e.target.value); handleUpdate({ projecao: { ...proj, [keyP]: { ...term, perfPct: v, subPct: 100 - v } } }); }} /></td>;
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '1.1rem', marginTop: '1.5rem', marginBottom: '1rem', color: 'var(--pri)' }}>Receita reconhecida por tipo</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>MÉTRICA</th>
                    <th className="r">1 ANO</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="subtotal">
                    <td>Receita reconhecida no ano</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      let val = proj.hospitaisMedios * proj.ticket * 12;
                      if (i === 0) val = dreData.slice(0, 12).reduce((sum, d) => sum + d.recReconhecida, 0);
                      return <td key={p} className="r bold">{BRL(val)}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Subscription</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      let val = proj.hospitaisMedios * proj.ticket * 12 * ((proj.subPct ?? 0) / 100);
                      if (i === 0) val = (dreData.slice(0, 12).reduce((sum, d) => sum + d.recReconhecida, 0)) * 0.5;
                      return <td key={p} className="r">{BRL(val)}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Performance fee</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      let val = proj.hospitaisMedios * proj.ticket * 12 * ((proj.perfPct ?? 0) / 100);
                      if (i === 0) val = (dreData.slice(0, 12).reduce((sum, d) => sum + d.recReconhecida, 0)) * 0.5;
                      return <td key={p} className="r">{BRL(val)}</td>
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '1.1rem', marginTop: '1.5rem', marginBottom: '1rem', color: 'var(--pri)' }}>Receita anualizada de saída</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>MÉTRICA</th>
                    <th className="r">1 ANO</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="subtotal">
                    <td>Receita anualizada de saída</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      if (i === 0) return <td key={p} className="r bold" style={{ fontSize: '0.85rem', opacity: 0.8 }}>N/A — validação</td>;
                      return <td key={p} className="r bold">{BRL(proj.hospitaisFim * proj.ticket * 12)}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Subscription ARR</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      if (i === 0) return <td key={p} className="r">N/A</td>;
                      const arr = proj.hospitaisFim * proj.ticket * 12;
                      return <td key={p} className="r">{BRL(arr * ((proj.subPct ?? 0) / 100))}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Performance fee run-rate estimado</td>
                    {['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      if (i === 0) return <td key={p} className="r">N/A</td>;
                      const arr = proj.hospitaisFim * proj.ticket * 12;
                      return <td key={p} className="r">{BRL(arr * ((proj.perfPct ?? 0) / 100))}</td>
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: '0.75rem', fontSize: '0.8rem', fontStyle: 'italic' }}>
              No Ano 1, a companhia ainda está em fase de validação/piloto. Por isso, a receita anualizada de saída, Subscription ARR e performance fee run-rate são apresentados como N/A nessa seção. A receita efetivamente reconhecida no Ano 1 permanece refletida na DRE e na Projeção de Receita. A partir do Ano 2, a receita anualizada de saída passa a representar o run-rate do último mês do ano multiplicado por 12, calculado com base nos hospitais ativos líquidos após churn e no ticket final mensal com expansão.
            </p>

            <div style={{ padding: '1.5rem 0 0' }}>
              {(() => {
                const xsProj = ['Ano 1', 'Ano 2', 'Ano 3', 'Ano 4'];
                const subArrData = ['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                  if (i === 0) return 0;
                  const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                  const arr = proj.hospitaisFim * proj.ticket * 12;
                  return arr * ((proj.subPct ?? 0) / 100);
                });
                const perfArrData = ['ano1', 'ano2', 'ano3', 'ano4'].map((p, i) => {
                  if (i === 0) return 0;
                  const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                  const arr = proj.hospitaisFim * proj.ticket * 12;
                  return arr * ((proj.perfPct ?? 0) / 100);
                });
                return (
                  <Plot data={[
                    { type: 'bar', name: 'Subscription ARR', x: xsProj, y: subArrData, marker: { color: '#7C5CFC' } },
                    { type: 'bar', name: 'Performance fee run-rate', x: xsProj, y: perfArrData, marker: { color: '#A78BFA' } },
                  ] as any} layout={getLayout({ barmode: 'stack', margin: { t: 20, r: 10, b: 40, l: 60 }, legend: { orientation: 'h', y: -0.15 }, height: 280, yaxis: { title: 'Receita Anualizada (R$)' } }) as any} style={{ width: '100%' }} config={chartConfig} useResizeHandler />
                );
              })()}
              <p className="note" style={{ marginTop: '1rem', fontSize: '0.85rem', lineHeight: '1.4' }}>
                Receita anualizada de saída representa o run-rate do último mês do ano multiplicado por 12. Subscription é tratada como ARR recorrente. Performance fee é apresentado como run-rate variável estimado, com menor qualidade de receita por depender de timing, baseline, validação do hospital e captura efetiva de valor. Essa métrica não deve ser confundida com receita reconhecida no ano.
              </p>
            </div>
            
            <div className="section-divider" />
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Valuation ponderado por qualidade da receita</h3>
            <div className="fields sub2" style={{ marginBottom: '1rem' }}>
              <div className="field"><label>Múltiplo sobre Subscription ARR</label><input type="number" value={state.projecao?.mult_sub ?? DEFAULT_STATE.projecao!.mult_sub} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, mult_sub: Number(e.target.value) } })} /></div>
              <div className="field"><label>Múltiplo sobre Performance fee run-rate estimado</label><input type="number" value={state.projecao?.mult_perf ?? DEFAULT_STATE.projecao!.mult_perf} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, mult_perf: Number(e.target.value) } })} /></div>
            </div>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>MÉTRICA</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Subscription ARR × {(state.projecao?.mult_sub ?? DEFAULT_STATE.projecao!.mult_sub)}x</td>
                    {['ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      const arr = proj.hospitaisFim * proj.ticket * 12;
                      const subArr = arr * ((proj.subPct ?? 0) / 100);
                      const mult = state.projecao?.mult_sub ?? DEFAULT_STATE.projecao!.mult_sub!;
                      return <td key={p} className="r">{BRL(subArr * mult)}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Performance fee × {(state.projecao?.mult_perf ?? DEFAULT_STATE.projecao!.mult_perf)}x</td>
                    {['ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      const arr = proj.hospitaisFim * proj.ticket * 12;
                      const perfArr = arr * ((proj.perfPct ?? 0) / 100);
                      const mult = state.projecao?.mult_perf ?? DEFAULT_STATE.projecao!.mult_perf!;
                      return <td key={p} className="r">{BRL(perfArr * mult)}</td>
                    })}
                  </tr>
                  <tr className="subtotal" style={{ color: 'var(--pri)' }}>
                    <td>Valuation ponderado</td>
                    {['ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      const arr = proj.hospitaisFim * proj.ticket * 12;
                      const subArr = arr * ((proj.subPct ?? 0) / 100);
                      const perfArr = arr * ((proj.perfPct ?? 0) / 100);
                      const multSub = state.projecao?.mult_sub ?? DEFAULT_STATE.projecao!.mult_sub!;
                      const multPerf = state.projecao?.mult_perf ?? DEFAULT_STATE.projecao!.mult_perf!;
                      return <td key={p} className="r bold">{BRL(subArr * multSub + perfArr * multPerf)}</td>
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

          </div></div>
        </section>
      )}
      {activeTab === 'receita' && (
        <section className="tab-panel active g1">
          <div className="panel"><div className="ph"><h2>Retorno potencial para investidores</h2></div><div className="pb">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Rodada atual</h3>
            <div className="fields sub2">
              <div className="field"><label>Captação (R$)</label><input type="number" value={state.projecao?.invest_cap ?? DEFAULT_STATE.projecao!.invest_cap} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, invest_cap: Number(e.target.value) } })} /></div>
              <div className="field"><label>Valuation pre-money (R$)</label><input type="number" value={state.projecao?.invest_pre ?? DEFAULT_STATE.projecao!.invest_pre} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, invest_pre: Number(e.target.value) } })} /></div>
            </div>
            {(() => {
              const cap = state.projecao?.invest_cap ?? DEFAULT_STATE.projecao!.invest_cap!;
              const pre = state.projecao?.invest_pre ?? DEFAULT_STATE.projecao!.invest_pre!;
              const post = cap + pre;
              const part = post > 0 ? (cap / post) * 100 : 0;
              return (
                <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem', background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px' }}>
                  <div><span style={{ fontSize: '0.8rem', opacity: 0.8 }}>Valuation post-money</span><div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{BRL(post)}</div></div>
                  <div><span style={{ fontSize: '0.8rem', opacity: 0.8 }}>Participação da rodada</span><div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: 'var(--pri)' }}>{part.toFixed(2).replace('.', ',')}%</div></div>
                </div>
              );
            })()}

            <div className="section-divider" />
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Cenários de valuation por qualidade da receita</h3>
            <div className="fields sub3" style={{ marginBottom: '1rem' }}>
              <div className="field"><label>Múltiplo conservador</label><input type="number" value={state.projecao?.mult_cons ?? DEFAULT_STATE.projecao!.mult_cons} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, mult_cons: Number(e.target.value) } })} /></div>
              <div className="field"><label>Múltiplo base</label><input type="number" value={state.projecao?.mult_base ?? DEFAULT_STATE.projecao!.mult_base} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, mult_base: Number(e.target.value) } })} /></div>
              <div className="field"><label>Múltiplo otimista</label><input type="number" value={state.projecao?.mult_otim ?? DEFAULT_STATE.projecao!.mult_otim} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, mult_otim: Number(e.target.value) } })} /></div>
            </div>
            
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Métrica</th>
                    <th className="r">2 ANOS</th>
                    <th className="r">3 ANOS</th>
                    <th className="r">4 ANOS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="subtotal">
                    <td>Receita anualizada de saída</td>
                    {['ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      return <td key={p} className="r bold">{BRL(proj.hospitaisFim * proj.ticket * 12)}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Conservador ({(state.projecao?.mult_cons ?? DEFAULT_STATE.projecao!.mult_cons)}x)</td>
                    {['ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      const mult = state.projecao?.mult_cons ?? DEFAULT_STATE.projecao!.mult_cons!;
                      return <td key={p} className="r">{BRL(proj.hospitaisFim * proj.ticket * 12 * mult)}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Plano Principal ({(state.projecao?.mult_base ?? DEFAULT_STATE.projecao!.mult_base)}x)</td>
                    {['ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      const mult = state.projecao?.mult_base ?? DEFAULT_STATE.projecao!.mult_base!;
                      return <td key={p} className="r">{BRL(proj.hospitaisFim * proj.ticket * 12 * mult)}</td>
                    })}
                  </tr>
                  <tr>
                    <td>Otimista ({(state.projecao?.mult_otim ?? DEFAULT_STATE.projecao!.mult_otim)}x)</td>
                    {['ano2', 'ano3', 'ano4'].map(p => {
                      const proj = projCalculada[p as "ano1" | "ano2" | "ano3" | "ano4"];
                      const mult = state.projecao?.mult_otim ?? DEFAULT_STATE.projecao!.mult_otim!;
                      return <td key={p} className="r">{BRL(proj.hospitaisFim * proj.ticket * 12 * mult)}</td>
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="section-divider" />
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Retorno potencial da rodada atual</h3>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              <div className="field" style={{ width: '250px' }}><label>Participação diluída estimada (%)</label><input type="number" step={0.1} value={state.projecao?.diluicao ?? DEFAULT_STATE.projecao!.diluicao} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, diluicao: Number(e.target.value) } })} /></div>
              <div className="field" style={{ width: '380px' }}><label>Tipo de Valuation (Cenário Base)</label><select value={state.projecao?.val_type ?? 'weighted'} onChange={(e) => handleUpdate({ projecao: { ...state.projecao!, val_type: e.target.value as 'simple' | 'weighted' } })}><option value="weighted">Valuation ponderado por qualidade da receita</option><option value="simple">Valuation simples por múltiplo de ARR total ({(state.projecao?.mult_base ?? DEFAULT_STATE.projecao!.mult_base)}x)</option></select></div>
            </div>

            {(() => {
              const cap = state.projecao?.invest_cap ?? DEFAULT_STATE.projecao!.invest_cap!;
              const pre = state.projecao?.invest_pre ?? DEFAULT_STATE.projecao!.invest_pre!;
              const post = cap + pre;
              const part = post > 0 ? (cap / post) : 0;
              const diluicao = (state.projecao?.diluicao ?? DEFAULT_STATE.projecao!.diluicao!) / 100;
              const multBase = state.projecao?.mult_base ?? DEFAULT_STATE.projecao!.mult_base!;
              const multSub = state.projecao?.mult_sub ?? DEFAULT_STATE.projecao!.mult_sub!;
              const multPerf = state.projecao?.mult_perf ?? DEFAULT_STATE.projecao!.mult_perf!;
              const valType = state.projecao?.val_type ?? 'weighted';

              return (
                <div className="tw">
                  <table className="cost-table">
                    <thead>
                      <tr>
                        <th>CENÁRIO DE DILUIÇÃO</th>
                        <th className="r">2 ANOS</th>
                        <th className="r">3 ANOS</th>
                        <th className="r">4 ANOS</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="subtotal">
                        <td>Sem diluição ({(part * 100).toFixed(2).replace('.', ',')}%)</td>
                        {['ano2', 'ano3', 'ano4'].map(p => {
                          const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                          const arr = proj.hospitaisFim * proj.ticket * 12;
                          let val = 0;
                          if (valType === 'weighted') {
                            val = (arr * ((proj.subPct ?? 0) / 100) * multSub) + (arr * ((proj.perfPct ?? 0) / 100) * multPerf);
                          } else {
                            val = arr * multBase;
                          }
                          const returnVal = val * part;
                          const moic = cap > 0 ? returnVal / cap : 0;
                          return <td key={p} className="r"><div>{BRL(returnVal)}</div><div style={{ fontSize: '0.8rem', color: 'var(--pri)', fontWeight: 'bold' }}>{moic.toFixed(1).replace('.', ',')}x</div></td>
                        })}
                      </tr>
                      <tr className="subtotal">
                        <td>Com diluição estimada ({(diluicao * 100).toFixed(2).replace('.', ',')}%)</td>
                        {['ano2', 'ano3', 'ano4'].map(p => {
                          const proj = state.projecao?.[p as "ano1" | "ano2" | "ano3" | "ano4"] || DEFAULT_STATE.projecao![p as "ano1" | "ano2" | "ano3" | "ano4"];
                          const arr = proj.hospitaisFim * proj.ticket * 12;
                          let val = 0;
                          if (valType === 'weighted') {
                            val = (arr * ((proj.subPct ?? 0) / 100) * multSub) + (arr * ((proj.perfPct ?? 0) / 100) * multPerf);
                          } else {
                            val = arr * multBase;
                          }
                          const returnVal = val * diluicao;
                          const moic = cap > 0 ? returnVal / cap : 0;
                          return <td key={p} className="r"><div>{BRL(returnVal)}</div><div style={{ fontSize: '0.8rem', color: 'var(--pri)', fontWeight: 'bold' }}>{moic.toFixed(1).replace('.', ',')}x</div></td>
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
            <p className="note" style={{ marginTop: '1rem' }}>
              Os cenários de valuation são ilustrativos. Subscription ARR recebe múltiplo superior por representar receita recorrente mais previsível. Performance fee é tratado como run-rate variável estimado e recebe múltiplo menor por depender de baseline, timing, validação do hospital e captura efetiva de valor. Cenários não representam promessa de liquidez, valuation futuro ou retorno garantido.
            </p>
          </div></div>

          <div className="panel" style={{ marginTop: '1.5rem' }}><div className="ph"><h2>Opcionalidade estratégica futura</h2></div><div className="pb">
            <p className="note" style={{ marginBottom: '1.5rem' }}>A Equa está sendo construída para se tornar uma infraestrutura crítica de inteligência financeira hospitalar. Caso execute bem, essa camada pode se tornar estratégica para diferentes categorias de players do setor.</p>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th style={{ width: '25%' }}>CATEGORIA</th>
                    <th>DESCRIÇÃO DO VALOR ESTRATÉGICO</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>ERP / HIS hospitalar</strong></td>
                    <td>Adiciona uma camada de IA e inteligência de receita ao fluxo operacional já instalado nos hospitais.</td>
                  </tr>
                  <tr>
                    <td><strong>Plataformas de RCM / IA</strong></td>
                    <td>Amplia cobertura em pré-faturamento, contratos e hospitais pequenos/médios.</td>
                  </tr>
                  <tr>
                    <td><strong>Operadoras verticalizadas</strong></td>
                    <td>Melhora margem, governança de receita e padronização financeira em redes próprias.</td>
                  </tr>
                  <tr>
                    <td><strong>Grupos hospitalares</strong></td>
                    <td>Reduz perdas, melhora previsibilidade de recebimento e padroniza cobrança entre unidades.</td>
                  </tr>

                  <tr>
                    <td><strong>Crédito em saúde</strong></td>
                    <td>Usa inteligência sobre qualidade da conta e risco de glosa para precificar recebíveis hospitalares.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div></div>
        </section>
      )}
      {activeTab === 'piloto' && (
        <section className="tab-panel active g1">
          <div className="panel"><div className="ph"><h2>Piloto e Prova de Valor</h2></div><div className="pb">
            <p className="note" style={{ marginBottom: '1.5rem' }}>O piloto é a base da confiança com o hospital. Ele demonstra não apenas a capacidade técnica de identificar perdas, mas principalmente a capacidade de transformar dados em caixa real.</p>
            
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Bloco 1 — Etapas do piloto</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Etapa</th>
                    <th>Prazo</th>
                    <th>Entregável</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.pilotStages || DEFAULT_STATE.pilotStages!).map(s => (
                    <tr key={s.id}>
                      <td><input value={s.stage} onChange={(e) => handleUpdate({ pilotStages: (state.pilotStages || DEFAULT_STATE.pilotStages!).map(x => x.id === s.id ? { ...x, stage: e.target.value } : x) })} /></td>
                      <td><input value={s.deadline} onChange={(e) => handleUpdate({ pilotStages: (state.pilotStages || DEFAULT_STATE.pilotStages!).map(x => x.id === s.id ? { ...x, deadline: e.target.value } : x) })} /></td>
                      <td><input value={s.deliverable} onChange={(e) => handleUpdate({ pilotStages: (state.pilotStages || DEFAULT_STATE.pilotStages!).map(x => x.id === s.id ? { ...x, deliverable: e.target.value } : x) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '1.1rem', marginTop: '2rem', marginBottom: '1rem', color: 'var(--pri)' }}>Bloco 2 — Funil de valor</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Métrica</th>
                    <th className="r">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.valueFunnel || DEFAULT_STATE.valueFunnel!).filter(v => v.metric !== '% validado pelo hospital').map(v => (
                    <tr key={v.id}>
                      <td><input value={v.metric} onChange={(e) => handleUpdate({ valueFunnel: (state.valueFunnel || DEFAULT_STATE.valueFunnel!).map(x => x.id === v.id ? { ...x, metric: e.target.value } : x) })} /></td>
                      <td><input className="r" value={v.value} onChange={(e) => handleUpdate({ valueFunnel: (state.valueFunnel || DEFAULT_STATE.valueFunnel!).map(x => x.id === v.id ? { ...x, value: e.target.value } : x) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: '1.1rem', marginTop: '2rem', marginBottom: '1rem', color: 'var(--pri)' }}>Bloco 3 — Validação curta vs ciclo completo</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Tipo de validação</th>
                    <th>Prazo</th>
                    <th>O que comprova</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.validationTypes || DEFAULT_STATE.validationTypes!).map(v => (
                    <tr key={v.id}>
                      <td><input value={v.type} onChange={(e) => handleUpdate({ validationTypes: (state.validationTypes || DEFAULT_STATE.validationTypes!).map(x => x.id === v.id ? { ...x, type: e.target.value } : x) })} /></td>
                      <td><input value={v.deadline} onChange={(e) => handleUpdate({ validationTypes: (state.validationTypes || DEFAULT_STATE.validationTypes!).map(x => x.id === v.id ? { ...x, deadline: e.target.value } : x) })} /></td>
                      <td><input value={v.proves} onChange={(e) => handleUpdate({ validationTypes: (state.validationTypes || DEFAULT_STATE.validationTypes!).map(x => x.id === v.id ? { ...x, proves: e.target.value } : x) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div></div>
        </section>
      )}
      {activeTab === 'dre' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>DRE (Capital)</h2></div><div className="pb">
            <div className="tw"><table><thead><tr><th>Item</th>{dreData.map(d => <th key={d.m} className="r">M{d.m}</th>)}<th className="r">Total / Saída</th></tr></thead><tbody>
              <DRERow label="Hospitais ativos" data={dreData} k="h" isSnapshot />
              <DRERow label="Receita contratada" data={dreData} k="recContratada" brl subtotal hint="Mostra contrato assinado, mesmo antes de caixa" />
              <DRERow label="MRR subscription" data={dreData} k="mrrSub" brl indent hint="Mostra recorrência real" isSnapshot />
              <DRERow label="Performance fee run-rate estimado" data={dreData} k="perfFeeEst" brl indent hint="Mostra variável, separado" isSnapshot />
              <DRERow label="Receita reconhecida" data={dreData} k="recReconhecida" brl subtotal hint="Mostra DRE" />
              <DRERow label="Caixa recebido" data={dreData} k="caixaRecebido" brl subtotal hint="Mostra runway real" />
              <DRERow label="Contas a receber" data={dreData} k="contasReceber" brl indent hint="Mostra diferença entre faturado e recebido" isSnapshot />
              <DRERow label="Custos Operacionais" data={dreData} k="cost" brl neg subtotal />
              <DRERow label="Burn líquido" data={dreData} k="res" brl bold dtotal />
              <DRERow label="Caixa acumulado" data={dreData} k="caixa" brl color="var(--pri)" bold isSnapshot />
            </tbody></table></div>
            <p className="note" style={{ marginTop: '1.5rem', fontSize: '0.85rem' }}>
              Na coluna Total / Saída, métricas de fluxo são somadas no período, enquanto métricas de posição, como MRR, hospitais ativos, contas a receber e caixa acumulado, mostram o valor de saída no M12. Caixa acumulado representa saldo final, não soma dos saldos mensais.
            </p>
          </div></div>
        </section>
      )}
      {activeTab === 'cenarios' && (
        <section className="tab-panel g1 active">
          <div className="panel"><div className="ph"><h2>Comparativo de Cenários</h2></div><div className="pb">
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Premissa</th>
                    {(state.scenarios || []).map(s => (
                      <th key={s.id} className="r" style={{ minWidth: '160px', position: 'relative' }}>
                        <input 
                          value={s.name} 
                          onChange={(e) => updScenario(s.id, { name: e.target.value })} 
                          style={{ textAlign: 'right', background: 'transparent', border: 'none', color: 'inherit', fontWeight: 'bold', width: '100%', outline: 'none' }} 
                        />
                        <button 
                          onClick={() => delScenario(s.id)}
                          style={{ position: 'absolute', top: '-10px', right: '-10px', background: 'var(--war)', color: '#fff', border: 'none', borderRadius: '50%', width: '20px', height: '20px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Remover cenário"
                        >×</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Contrato assinado</td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="text" className="scen-input" value={s.contratoAssinado ? `M${s.contratoAssinado}` : ''} onChange={(e) => updScenario(s.id, { contratoAssinado: parseInt(e.target.value.replace(/\D/g,'')) || 0 })} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>1ª receita recebida</td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="text" className="scen-input" value={s.primeiraReceita ? `M${s.primeiraReceita}` : ''} onChange={(e) => updScenario(s.id, { primeiraReceita: parseInt(e.target.value.replace(/\D/g,'')) || 0 })} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Ciclo de venda</td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="text" className="scen-input" value={s.cicloVenda ? `${s.cicloVenda} dias` : ''} onChange={(e) => updScenario(s.id, { cicloVenda: parseInt(e.target.value.replace(/\D/g,'')) || 0 })} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Onboarding</td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="text" className="scen-input" value={s.onboarding ? `${s.onboarding} dias` : ''} onChange={(e) => updScenario(s.id, { onboarding: parseInt(e.target.value.replace(/\D/g,'')) || 0 })} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Caixa mínimo</td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="text" className="scen-input" value={s.caixaMinimo || ''} onChange={(e) => updScenario(s.id, { caixaMinimo: e.target.value })} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Nova rodada começa</td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="text" className="scen-input" value={s.novaRodada ? `M${s.novaRodada}` : ''} onChange={(e) => updScenario(s.id, { novaRodada: parseInt(e.target.value.replace(/\D/g,'')) || 0 })} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={(state.scenarios || []).length + 1} style={{ height: '2rem' }}></td>
                  </tr>
                  <tr>
                    <td><strong>Captação</strong></td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="number" className="scen-input" value={s.cap} onChange={(e) => updScenario(s.id, { cap: Number(e.target.value) })} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td><strong>Equity (%)</strong></td>
                    {(state.scenarios || []).map(s => (
                      <td key={s.id} className="r">
                        <input type="number" className="scen-input" value={s.eq} onChange={(e) => updScenario(s.id, { eq: Number(e.target.value) })} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <button className="btn pri" onClick={addScenario} style={{ marginTop: '1.5rem' }}>+ Novo Cenário</button>
            
            <p className="note" style={{ marginTop: '2rem', fontSize: '0.85rem', lineHeight: '1.5' }}>
              Os cenários não variam apenas pela captação, mas principalmente pelo timing de validação comercial, assinatura do contrato, onboarding e recebimento da primeira receita. O cenário conservador mostra o risco de atraso e necessidade de iniciar a próxima rodada antes da primeira receita. O plano principal considera contrato no M9 e primeira receita no M12. O cenário de aceleração considera validação mais rápida, redução do ciclo comercial e antecipação da receita.
            </p>
          </div></div>
        </section>
      )}
      {activeTab === 'proxima' && (
        <section className="tab-panel active g1">
          <div className="panel"><div className="ph"><h2>Próxima Rodada</h2></div><div className="pb">
            <div className="alert-box info" style={{ marginBottom: '1.5rem' }}>
              <strong>Estratégia de Captação:</strong> A próxima rodada deve ser iniciada após contrato assinado e evidências concretas de valor, não apenas após o fim dos 12 meses de runway.
            </div>
            
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--pri)' }}>Gatilhos para próxima rodada</h3>
            <div className="tw">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Gatilho</th>
                    <th>Meta / Evidência</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.nextRoundTriggers || DEFAULT_STATE.nextRoundTriggers!).map(t => (
                    <tr key={t.id}>
                      <td><input value={t.trigger} onChange={(e) => handleUpdate({ nextRoundTriggers: (state.nextRoundTriggers || DEFAULT_STATE.nextRoundTriggers!).map(x => x.id === t.id ? { ...x, trigger: e.target.value } : x) })} /></td>
                      <td><input value={t.target} onChange={(e) => handleUpdate({ nextRoundTriggers: (state.nextRoundTriggers || DEFAULT_STATE.nextRoundTriggers!).map(x => x.id === t.id ? { ...x, target: e.target.value } : x) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div></div>
        </section>
      )}
    </div>
  );
}

function PHintField({ label, field, value, onChange, hint, tooltip, setTooltip, InfoBtn, TooltipBox, min, max, step }: { label: string; field: string; value: number; onChange: (v: string) => void; hint: string; tooltip: string | null; setTooltip: (v: string | null) => void; InfoBtn: any; TooltipBox: any; min?: number; max?: number; step?: number }) {
  return (<div className="field"><label>{label} <InfoBtn field={field} /></label><input type="number" value={value} min={min} max={max} step={step} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} /><TooltipBox field={field} /></div>);
}

function DRERow({ label, data, k, brl, bold, neg, indent, color, subtotal, dtotal, hint, isSnapshot }: { label: string; data: MonthData[]; k: keyof MonthData; brl?: boolean; bold?: boolean; neg?: boolean; indent?: boolean; color?: string; subtotal?: boolean; dtotal?: boolean; hint?: string; isSnapshot?: boolean }) {
  const tot = isSnapshot ? (data[data.length - 1][k] as number) : data.reduce((a, d) => a + (d[k] as number), 0);
  const style: React.CSSProperties = { ...(bold ? { fontWeight: 700 } : {}), ...(color ? { color } : {}), ...(indent ? { paddingLeft: '1.2rem' } : {}) };
  return (
    <tr className={dtotal ? 'total' : subtotal ? 'subtotal' : ''}>
      <td style={style}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {label}
          {hint && <span style={{ cursor: 'help', fontSize: '.7rem', color: 'var(--txf)', opacity: 0.7 }} title={hint}>ⓘ</span>}
        </div>
      </td>
      {data.map((d: MonthData) => <td key={d.m} className="r" style={style}>{brl ? BRL(neg ? -(d[k] as number) : d[k] as number) : d[k] as number}</td>)}
      <td className="r bold" style={style}>{brl ? BRL(neg ? -tot : tot) : tot}</td>
    </tr>
  );
}
