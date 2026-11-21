// Estado compartilhado da aplicação (conta, sala ativa, mesa, caches de renderização e modo)
import { lerContaSalva, lerDevSala } from './storage.js?v=12';

export const QUALQUER_UM_ABRE_RODADA = false;

export const ICONE_COROA =
  '<svg class="ic cheio coroa" viewBox="0 0 24 24" aria-label="Criador">' +
  '<path d="M3 18h18l-1.5-10-4.5 4-3-7-3 7-4.5-4z"/></svg>';

export const estado = {
  // Conta e lobby
  minhaConta: lerContaSalva(),
  salasAtuais: [],
  temporizadorSalas: null,
  versaoSalas: 0,
  htmlSalas: '',
  abrindoSala: false,

  // Partida e mesa ativa
  partidaAtual: null,
  modoAtual: 'presencial',   // 'presencial' hoje; futuramente suportará 'online'
  meuJogadorId: null,
  meuSegredo: null,
  jogadoresAtuais: [],
  ultimoEstado: null,
  modoDev: false,

  // Sincronização e ações
  ultimaVersao: -1,
  promessaBusca: null,
  buscaSuja: false,
  ocupado: false,

  // Caches de UI (evitam redesenho desnecessário)
  htmlJogadoresVisto: '',
  htmlHistoricoVisto: '',
  htmlPotesVisto: '',
  htmlOrdemVisto: '',
  htmlSelFichasVisto: '',
  htmlDevVisto: '',

  // Estado interativo da mesa
  eraMinhaVez: false,
  ultimoPote: null,
  maoVista: null,
  blindsVistos: null,
  bigEditado: false,
  bigMesaEditado: false,
  apostaEditada: false,
  apostaAberta: false,
  apostaAbertaEm: 0,
  opFichas: null,
  opFichasChave: '',
  distEstado: null,

  // Conversão em R$ (em memória por sala)
  erroReal: '',
  realPorSala: {},

  // Navegação e cronômetros
  profundidade: (history.state && history.state.poker) ? 1 : 0,
  ignorarPop: false,
  relogio: { offset: 0, ini: null, vez: null }
};

export function contaParams() {
  return { p_conta: estado.minhaConta.id, p_token: estado.minhaConta.token };
}

// Na sala DEV os nomes vêm com um sufixo técnico ("Ana DEV 1946"): na tela mostramos só "Ana"
export function nomeDe(texto) {
  const t = String(texto == null ? '' : texto);
  return estado.modoDev ? t.replace(/\s+DEV\s+[0-9a-z]{3,8}\b/gi, '') : t;
}

// Ações de criador: na sala DEV usam sempre o jogador criador (índice 0)
export function credC() {
  if (estado.modoDev) {
    const sala = lerDevSala();
    if (sala && sala.jogadores[0]) {
      return { id: sala.jogadores[0].id, segredo: sala.jogadores[0].segredo };
    }
  }
  return { id: estado.meuJogadorId, segredo: estado.meuSegredo };
}

export function marcarReal(id, porMil) {
  if (porMil > 0) estado.realPorSala[id] = porMil;
}

export function valorPorMil(id) {
  return estado.realPorSala[id] || null;
}

// Passo (incremento mínimo) das apostas. Em salas com R$, é o menor número redondo
// que vale pelo menos R$ 0,01 — mesma regra da função passo_aposta no banco.
export function passoSala() {
  if (!estado.partidaAtual) return 1;
  const v = valorPorMil(estado.partidaAtual.id);
  if (!(v > 0)) return 1;
  const bruto = Math.ceil(Math.round(10 / v * 1e6) / 1e6);
  if (bruto <= 1) return 1;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const ms = [1, 2, 5, 10];
  for (let k = 0; k < ms.length; k++) {
    if (ms[k] * pot >= bruto) return ms[k] * pot;
  }
  return 10 * pot;
}

export function limparCachesMesa() {
  estado.eraMinhaVez = false;
  estado.ultimoPote = null;
  estado.htmlPotesVisto = '';
  estado.htmlJogadoresVisto = '';
  estado.htmlHistoricoVisto = '';
  estado.ultimaVersao = -1;
}
