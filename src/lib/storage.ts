import fs from 'fs/promises';
import path from 'path';
import { DREState } from './calc';

const DATA_FILE = path.join(process.cwd(), 'data.json');

const DEFAULT_STATE: DREState = {
  captacao: 400000, equity: 7, jurPct: 8, caixaPct: 20,
  inicioRec: 6, hFim: 10, mesesPlan: 18,
  sub: 20000, perf: 10000, piloto: 0,
  equaPayVol: 80000, equaPayTaxa: 2.5, equaPayIni: 10,
  revSharePct: 8, revShareBase: 15000, revShareIni: 8,
  revMult: 5,
  areaCosts: {
    produto: [
      { id: 101, cat: 'folha', desc: 'CTO / Dev Fullstack', monthly: 12000, startM: 1, endM: 18 },
      { id: 102, cat: 'folha', desc: 'Dev Backend PJ', monthly: 8000, startM: 4, endM: 18 },
      { id: 103, cat: 'ferramentas', desc: 'Google Cloud / Vertex AI', monthly: 1500, startM: 1, endM: 18 }
    ],
    comercial: [
      { id: 201, cat: 'folha', desc: 'Head Comercial part-time', monthly: 6000, startM: 3, endM: 18 },
      { id: 202, cat: 'ferramentas', desc: 'CRM HubSpot', monthly: 400, startM: 2, endM: 18 }
    ],
    operacoes: [
      { id: 301, cat: 'folha', desc: 'Customer Success', monthly: 4000, startM: 2, endM: 18 }
    ],
    juridico: [
      { id: 401, cat: 'folha', desc: 'Advogado retainer', monthly: 3000, startM: 1, endM: 18 }
    ],
    outro: []
  },
  scenarios: [
    { id: 1, name: 'Conservador', cap: 300000, eq: 8, hFim: 7, sub: 15000, perf: 7000, runwayTarget: null },
    { id: 2, name: 'Base', cap: 400000, eq: 7, hFim: 10, sub: 20000, perf: 10000, runwayTarget: null },
    { id: 3, name: 'Otimista', cap: 600000, eq: 8, hFim: 15, sub: 22000, perf: 12000, runwayTarget: null }
  ],
  phases: [
    { id: 1, name: 'M1 · Validação', startM: 1, endM: 6, objective: 'Fechar 1 hospital e provar ROI', kr: '1 hospital ativo, ROI demonstrado', initiatives: [] },
    { id: 2, name: 'M2 · Piloto', startM: 7, endM: 12, objective: '3 hospitais pagantes', kr: 'MRR ≥ R$ 90k', initiatives: [] },
    { id: 3, name: 'M3 · Escala', startM: 13, endM: 18, objective: '10 hospitais', kr: 'MRR ≥ R$ 200k', initiatives: [] }
  ]
};

export async function getState(): Promise<DREState> {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return DEFAULT_STATE;
  }
}

export async function saveState(state: DREState): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2));
}
