// Modo Blackjack: multiplayer 1-6 jogadores contra a Banca automática (1 baralho de 52 cartas, S17, 3:2)
import { banco } from '../../core/supabase.js?v=86';
import { estado, nomeDe } from '../../core/estado.js?v=86';
import { lerDevSala } from '../../core/storage.js?v=86';
import { $id, escapar, aviso, mostrarErro, limparErro } from '../../core/ui.js?v=86';
import { registrarModo } from '../../mesa/modos.js?v=86';
import { publicarEstado, buscarMesa } from '../../mesa/mesa.js?v=86';
import { htmlCarta, htmlCartaMini } from '../online/cartas.js?v=86';
import { tocarSom, marcarAcaoLocal } from '../../core/som.js?v=86';

const bjUI = {
  partidaId: null,
  apostaRascunho: null,
  enviando: false,
  ultimoTimeoutChave: '',
  ultimaFase: null,
  ultimoBoardKey: null
};

const VALORES_CARTA = {
  A: 11, K: 10, Q: 10, J: 10, T: 10, '10': 10,
  '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
};

function valorCartaBJ(raw) {
  if (!raw || raw.length < 2) return 0;
  const r = raw.slice(0, raw.length - 1);
  return VALORES_CARTA[r] || 0;
}

function obterBjEstado(partida) {
  return (partida && partida.blackjack_estado) ? partida.blackjack_estado : {
    fase: 'apostas',
    aposta_min: (partida && partida.small_blind) || 10,
    dealer: { cartas: [], oculta: false, pontos: 0, soft: false, blackjack: false, estourou: false },
    maos: {}
  };
}

function textoPontos(mao) {
  if (!mao) return '';
  if (mao.blackjack) return 'Blackjack!';
  if (mao.estourou) return 'Estourou (' + mao.pontos + ')';
  if (mao.soft && mao.pontos <= 21) return (mao.pontos - 10) + '/' + mao.pontos;
  return String(mao.pontos || 0);
}

function classeResultado(res) {
  if (res === 'blackjack') return 'blackjack';
  if (res === 'ganhou') return 'ganhou';
  if (res === 'empate') return 'empate';
  if (res === 'perdeu') return 'perdeu';
  return '';
}

function rotuloResultado(mao) {
  if (!mao || !mao.resultado) return '';
  if (mao.resultado === 'blackjack') return 'Blackjack! +' + mao.lucro;
  if (mao.resultado === 'ganhou') return 'Ganhou +' + mao.lucro;
  if (mao.resultado === 'empate') return 'Empate (devolveu)';
  return 'Banca venceu';
}

function minhaEntrada(bj, eu) {
  if (!eu || !bj || !bj.maos) return null;
  return bj.maos[eu.id] || null;
}

function garantirRascunho(bj, eu) {
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const saldo = eu ? Number(eu.saldo) || 0 : 0;
  const ent = minhaEntrada(bj, eu);
  const base = (ent && Number(ent.ultima_aposta) >= min) ? Number(ent.ultima_aposta) : min;
  if (bjUI.apostaRascunho === null || bjUI.apostaRascunho < min) {
    bjUI.apostaRascunho = Math.min(saldo, base);
  }
  if (bjUI.apostaRascunho > saldo) bjUI.apostaRascunho = saldo;
  return bjUI.apostaRascunho;
}

async function chamarRpcBJ(fn, params, erroId = 'erro-barra') {
  if (bjUI.enviando) return false;
  bjUI.enviando = true;
  limparErro(erroId);
  marcarAcaoLocal();
  let resp;
  try {
    resp = await banco.rpc(fn, params);
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  } finally {
    bjUI.enviando = false;
  }
  if (resp.error) {
    mostrarErro(erroId, resp.error.message);
    return false;
  }
  if (resp.data && resp.data.partida) {
    publicarEstado(resp.data);
  } else {
    buscarMesa(true);
  }
  return true;
}

export function bjSomarFicha(mult) {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu) return;
  const bj = obterBjEstado(partida);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const atual = Number(bjUI.apostaRascunho) || 0;
  bjUI.apostaRascunho = Math.min(eu.saldo, atual + (min * mult));
  tocarSom('ficha');
  if (estado.ultimoEstado) desenharBarraBlackjack(partida, estado.jogadoresAtuais, { eu });
}

export function bjLimparAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu) return;
  const bj = obterBjEstado(partida);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  bjUI.apostaRascunho = Math.min(eu.saldo, min);
  if (estado.ultimoEstado) desenharBarraBlackjack(partida, estado.jogadoresAtuais, { eu });
}

export function bjRepetirAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu) return;
  const bj = obterBjEstado(partida);
  const ent = minhaEntrada(bj, eu);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const ult = (ent && Number(ent.ultima_aposta) >= min) ? Number(ent.ultima_aposta) : min;
  bjUI.apostaRascunho = Math.min(eu.saldo, ult);
  tocarSom('ficha');
  if (estado.ultimoEstado) desenharBarraBlackjack(partida, estado.jogadoresAtuais, { eu });
}

export function bjDobrarAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu) return;
  const bj = obterBjEstado(partida);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const atual = Math.max(min, Number(bjUI.apostaRascunho) || min);
  bjUI.apostaRascunho = Math.min(eu.saldo, atual * 2);
  tocarSom('ficha');
  if (estado.ultimoEstado) desenharBarraBlackjack(partida, estado.jogadoresAtuais, { eu });
}

export function bjAllInAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu) return;
  bjUI.apostaRascunho = eu.saldo;
  tocarSom('ficha');
  if (estado.ultimoEstado) desenharBarraBlackjack(partida, estado.jogadoresAtuais, { eu });
}

export async function bjConfirmarAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu || !estado.meuJogadorId || !estado.meuSegredo) return;
  const bj = obterBjEstado(partida);
  const valor = garantirRascunho(bj, eu);
  tocarSom('ficha');
  await chamarRpcBJ('bj_apostar', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo,
    p_valor: valor
  });
}

export async function bjAgir(acao) {
  if (!estado.partidaAtual || !estado.meuJogadorId || !estado.meuSegredo) return;
  if (acao === 'pedir') tocarSom('carta');
  else if (acao === 'parar') tocarSom('check');
  else if (acao === 'dobrar' || acao === 'dividir') tocarSom('ficha');
  await chamarRpcBJ('bj_agir', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo,
    p_acao: acao
  });
}

export async function bjNovaRodada() {
  if (!estado.partidaAtual || !estado.meuJogadorId || !estado.meuSegredo) return;
  await chamarRpcBJ('bj_nova_rodada', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo
  });
}

export async function bjRevanche() {
  if (!estado.partidaAtual || !estado.meuJogadorId || !estado.meuSegredo) return;
  bjUI.apostaRascunho = null;
  await chamarRpcBJ('bj_revanche', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo
  });
}

export async function bjConfirmarTodosDev() {
  if (!estado.modoDev || !estado.partidaAtual) return;
  const sala = lerDevSala();
  if (!sala || !sala.jogadores) return;
  const bj = obterBjEstado(estado.partidaAtual);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  for (const j of sala.jogadores) {
    const ent = (bj.maos && bj.maos[j.id]) || {};
    const naMesa = (estado.jogadoresAtuais || []).find((x) => x.id === j.id);
    if (!ent.confirmado && naMesa && naMesa.saldo >= min) {
      await banco.rpc('bj_apostar', { p_jogador: j.id, p_segredo: j.segredo, p_valor: min });
    }
  }
  await buscarMesa(true);
}

function desenharDealerBoard(partida) {
  const board = $id('board');
  if (!board) return;
  const bj = obterBjEstado(partida);
  const dealer = bj.dealer || { cartas: [], oculta: false, pontos: 0 };
  const cartas = Array.isArray(dealer.cartas) ? dealer.cartas : [];

  const boardKey = bj.fase + '|' + cartas.join(',') + '|' + (dealer.oculta ? '1' : '0') + '|' + dealer.pontos;
  if (bjUI.ultimoBoardKey === boardKey && bjUI.partidaId === partida.id) return;
  bjUI.ultimoBoardKey = boardKey;
  bjUI.partidaId = partida.id;

  let cartasHtml = '';
  if (cartas.length === 0) {
    cartasHtml = '<div class="bj-dealer-vazio">Faça sua aposta para iniciar a rodada</div>';
  } else {
    cartasHtml = '<div class="bj-dealer-cartas">'
      + cartas.map((c) => htmlCarta(c)).join('')
      + (dealer.oculta ? '<span class="carta verso" aria-label="Carta oculta da banca"></span>' : '')
      + '</div>';
  }

  let badgePts = '';
  if (cartas.length > 0) {
    const cls = dealer.blackjack ? 'blackjack' : (dealer.estourou ? 'estourou' : '');
    const txt = dealer.oculta ? String(dealer.pontos) + ' + ?' : textoPontos(dealer);
    badgePts = '<span class="bj-score ' + cls + '">' + escapar(txt) + '</span>';
  }

  board.innerHTML = `
    <div class="bj-dealer">
      <div class="bj-dealer-topo">
        <span class="bj-dealer-titulo">BANCA · DEALER</span>
        ${badgePts}
      </div>
      ${cartasHtml}
    </div>
  `;
}

function desenharMinhaMao(bj, eu, minhaVez) {
  const wrap = $id('minha-mao-wrap');
  if (!wrap) return;
  const ent = minhaEntrada(bj, eu);
  const lista = (ent && Array.isArray(ent.lista)) ? ent.lista : [];

  if (!eu || lista.length === 0) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }

  const idxAtiva = Number(ent.indice_ativa) || 0;
  const ehSplit = lista.length > 1;
  const htmlMaos = lista.map((mao, idx) => {
    const ativa = minhaVez && idx === idxAtiva && mao.status === 'jogando';
    const cartas = Array.isArray(mao.cartas) ? mao.cartas : [];
    const clsRes = classeResultado(mao.resultado);
    const rotRes = rotuloResultado(mao);
    const statusTxt = mao.estourou ? 'estourou' : (mao.blackjack ? 'blackjack' : '');
    return `
      <div class="bj-mao-card${ativa ? ' ativa' : ''}${clsRes ? ' ' + clsRes : ''}">
        <div class="bj-mao-cartas">${cartas.map((c) => htmlCarta(c)).join('')}</div>
        <div class="bj-mao-meta">
          <span class="bj-score ${statusTxt}">${escapar(textoPontos(mao))}</span>
          <span class="bj-aposta-tag">Aposta ${mao.aposta}${mao.dobrou ? ' (2x)' : ''}</span>
          ${rotRes ? '<span class="bj-res ' + clsRes + '">' + escapar(rotRes) + '</span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  wrap.innerHTML = '<div class="bj-mao-hero' + (ehSplit ? ' split' : '') + '">' + htmlMaos + '</div>';
  wrap.hidden = false;
}

function desenharBarraBlackjack(partida, jogadores, ctx) {
  const barra = $id('barra-blackjack');
  const barraAcoes = $id('barra-acoes');
  if (!barra || !barraAcoes) return;

  const bj = obterBjEstado(partida);
  const eu = (ctx && ctx.eu) || (jogadores || []).find((j) => j.id === estado.meuJogadorId) || null;
  const minhaVez = bj.fase === 'jogando' && !!eu && partida.vez_jogador_id === eu.id;

  desenharMinhaMao(bj, eu, minhaVez);

  if (!eu) {
    barra.hidden = true;
    barra.innerHTML = '';
    barraAcoes.classList.remove('visivel');
    return;
  }

  barraAcoes.classList.add('visivel');
  barra.hidden = false;

  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const ent = minhaEntrada(bj, eu) || {};
  const lista = Array.isArray(ent.lista) ? ent.lista : [];

  if (bj.fase === 'encerrada') {
    barra.innerHTML = `
      <div class="bj-aviso-fora">Todos os jogadores ficaram sem fichas nesta mesa.</div>
      <button type="button" class="positivo bj-btn-cheio" onclick="bjRevanche()">Revanche (reiniciar fichas)</button>
    `;
    return;
  }

  if (bj.fase === 'jogando') {
    if (minhaVez) {
      const idx = Number(ent.indice_ativa) || 0;
      const maoAtiva = lista[idx];
      const nCartas = (maoAtiva && Array.isArray(maoAtiva.cartas)) ? maoAtiva.cartas.length : 0;
      const podeDobrar = !!maoAtiva && nCartas === 2 && eu.saldo >= maoAtiva.aposta;
      const podeDividir = !!maoAtiva && lista.length === 1 && nCartas === 2
        && valorCartaBJ(maoAtiva.cartas[0]) === valorCartaBJ(maoAtiva.cartas[1])
        && eu.saldo >= maoAtiva.aposta;

      barra.innerHTML = `
        <div class="bj-acoes-grid">
          <button type="button" class="positivo" onclick="bjAgir('pedir')">Pedir</button>
          <button type="button" class="neutro" onclick="bjAgir('parar')">Parar</button>
          <button type="button" class="secundario" onclick="bjAgir('dobrar')"${podeDobrar ? '' : ' disabled'}>Dobrar</button>
          <button type="button" class="secundario" onclick="bjAgir('dividir')"${podeDividir ? '' : ' disabled'}>Dividir</button>
        </div>
      `;
    } else {
      const vezJog = (jogadores || []).find((j) => j.id === partida.vez_jogador_id);
      const txt = vezJog ? ('Vez de ' + nomeDe(vezJog.nome) + '…') : 'Banca jogando…';
      barra.innerHTML = '<div class="bj-espera">' + escapar(txt) + '</div>';
    }
    return;
  }

  // Fases 'apostas' ou 'resultado'
  if (eu.saldo < min && !(bj.fase === 'apostas' && ent.confirmado)) {
    barra.innerHTML = '<div class="bj-aviso-fora">Você ficou sem fichas suficientes (mín. ' + min + ') e está fora desta partida.</div>';
    return;
  }

  if (bj.fase === 'apostas' && ent.confirmado) {
    const devBtn = estado.modoDev
      ? '<button type="button" class="secundario bj-btn-dev-conf" onclick="bjConfirmarTodosDev()">Confirmar todos (DEV)</button>'
      : '';
    barra.innerHTML = `
      <div class="bj-espera">Aposta confirmada: <b>${ent.aposta_pendente}</b> · Aguardando outros jogadores…</div>
      ${devBtn}
    `;
    return;
  }

  const valor = garantirRascunho(bj, eu);
  const temUlt = Number(ent.ultima_aposta) >= min && Number(ent.ultima_aposta) <= eu.saldo;
  const resumoUlt = (bj.fase === 'resultado' && lista.length > 0)
    ? '<div class="bj-resumo-rodada">' + lista.map((m) => '<span class="bj-res ' + classeResultado(m.resultado) + '">' + escapar(rotuloResultado(m)) + '</span>').join(' ') + '</div>'
    : '';

  barra.innerHTML = `
    ${resumoUlt}
    <div class="bj-fichas">
      ${temUlt ? '<button type="button" class="secundario" onclick="bjRepetirAposta()">Repetir</button>' : ''}
      <button type="button" class="secundario" onclick="bjSomarFicha(1)"${eu.saldo < valor + min ? ' disabled' : ''}>+${min}</button>
      <button type="button" class="secundario" onclick="bjSomarFicha(2)"${eu.saldo < valor + min * 2 ? ' disabled' : ''}>+${min * 2}</button>
      <button type="button" class="secundario" onclick="bjSomarFicha(5)"${eu.saldo < valor + min * 5 ? ' disabled' : ''}>+${min * 5}</button>
      <button type="button" class="secundario" onclick="bjDobrarAposta()"${eu.saldo < Math.max(min, valor) * 2 ? ' disabled' : ''}>2x</button>
      <button type="button" class="secundario allin" onclick="bjAllInAposta()">All-in</button>
      <button type="button" class="neutro" onclick="bjLimparAposta()">Mín.</button>
    </div>
    <button type="button" class="positivo bj-btn-cheio" onclick="bjConfirmarAposta()">Apostar ${valor}</button>
  `;
}

export function tickBlackjack() {
  const partida = estado.partidaAtual;
  const wrap = $id('timer-turno-wrap');
  const fill = $id('timer-turno-fill');
  if (!partida || partida.modo !== 'blackjack' || !wrap || !fill) {
    if (wrap) wrap.hidden = true;
    return;
  }
  const bj = obterBjEstado(partida);
  const tempo = Number(partida.tempo_turno) || 0;
  let inicioMs = null;
  let fimMs = null;
  let chave = '';

  const agoraSrv = Date.now() + (estado.relogio ? estado.relogio.offset : 0);
  if (bj.fase === 'jogando' && partida.vez_jogador_id && partida.vez_desde && tempo > 0) {
    inicioMs = Date.parse(partida.vez_desde);
    fimMs = inicioMs + tempo * 1000;
    chave = 'j:' + partida.mao + ':' + partida.vez_jogador_id + ':' + partida.vez_desde;
  } else if (bj.fase === 'apostas' && bj.prazo_apostas && tempo > 0) {
    fimMs = Date.parse(bj.prazo_apostas);
    inicioMs = fimMs - tempo * 1000;
    chave = 'a:' + partida.mao + ':' + bj.prazo_apostas;
  }

  if (!fimMs || !inicioMs || tempo <= 0) {
    wrap.hidden = true;
    return;
  }

  const rest = Math.max(0, fimMs - agoraSrv);
  const pct = Math.max(0, Math.min(100, (rest / (tempo * 1000)) * 100));
  wrap.hidden = false;
  fill.style.width = pct.toFixed(1) + '%';
  fill.classList.toggle('critico', rest <= 6000);

  if (rest <= 0 && bjUI.ultimoTimeoutChave !== chave) {
    bjUI.ultimoTimeoutChave = chave;
    banco.rpc('bj_avancar_tempo', { p_partida: partida.id }).then((r) => {
      if (r && r.data && r.data.partida) publicarEstado(r.data);
    }).catch(() => {});
  }
}

export function resetarBlackjackUI() {
  bjUI.partidaId = null;
  bjUI.apostaRascunho = null;
  bjUI.enviando = false;
  bjUI.ultimoTimeoutChave = '';
  bjUI.ultimaFase = null;
  bjUI.ultimoBoardKey = null;
  const barra = $id('barra-blackjack');
  if (barra) { barra.innerHTML = ''; barra.hidden = true; }
  const wrap = $id('minha-mao-wrap');
  if (wrap) { wrap.innerHTML = ''; wrap.hidden = true; }
}

registrarModo('blackjack', {
  textoStatus(partida) {
    const bj = obterBjEstado(partida);
    if (bj.fase === 'encerrada') return 'Fim de jogo — todos ficaram sem fichas.';
    if (bj.fase === 'resultado') return 'Rodada encerrada · Faça sua próxima aposta';
    if (bj.fase === 'apostas') return 'Faça sua aposta para receber as cartas';
    return null;
  },

  desenharBoard(partida) {
    desenharDealerBoard(partida);
  },

  htmlCartasAssento(jogador, partida) {
    if (jogador.id === estado.meuJogadorId) return '';
    const bj = obterBjEstado(partida);
    const ent = (bj.maos && bj.maos[jogador.id]) || null;
    if (!ent) return '<div class="bj-assento-st">Aguardando</div>';
    if (ent.eliminado) return '<div class="bj-assento-st perdido">Sem fichas</div>';
    if (bj.fase === 'apostas') {
      return ent.confirmado
        ? '<div class="bj-assento-st ok">Apostou ' + ent.aposta_pendente + '</div>'
        : '<div class="bj-assento-st">Apostando…</div>';
    }
    const lista = Array.isArray(ent.lista) ? ent.lista : [];
    if (lista.length === 0) return '<div class="bj-assento-st">Fora da rodada</div>';

    return '<div class="bj-assento-maos">' + lista.map((m) => {
      const cartas = (m.cartas || []).map((c) => htmlCartaMini(c)).join('');
      const st = m.resultado ? rotuloResultado(m) : textoPontos(m);
      const cls = classeResultado(m.resultado) || (m.estourou ? 'perdeu' : '');
      return '<div class="bj-assento-mao">'
        + '<div class="l-cartas reveladas">' + cartas + '</div>'
        + '<div class="bj-assento-st ' + cls + '">' + escapar(st) + '</div>'
        + '</div>';
    }).join('') + '</div>';
  },

  ehVencedorAssento(jogador, partida) {
    const bj = obterBjEstado(partida);
    if (bj.fase !== 'resultado') return false;
    const ent = bj.maos && bj.maos[jogador.id];
    if (!ent || !Array.isArray(ent.lista)) return false;
    return ent.lista.some((m) => m.resultado === 'ganhou' || m.resultado === 'blackjack');
  },

  premioVencedorAssento(jogador, partida) {
    const bj = obterBjEstado(partida);
    if (bj.fase !== 'resultado') return 0;
    const ent = bj.maos && bj.maos[jogador.id];
    if (!ent || !Array.isArray(ent.lista)) return 0;
    return ent.lista.reduce((acc, m) => acc + Math.max(0, Number(m.pagamento) || 0), 0);
  },

  desenharBarra(partida, jogadores, ctx) {
    desenharBarraBlackjack(partida, jogadores, ctx);
  },

  desenharFaixa() {
    const f = $id('faixa-fase');
    if (f) f.hidden = true;
    const fo = $id('faixa-online');
    if (fo) { fo.hidden = true; fo.innerHTML = ''; }
  },

  desenharCriador() {
    const b = $id('btn-criador');
    if (b) b.hidden = true;
  },

  aoSairDaMesa() {
    resetarBlackjackUI();
  }
});
