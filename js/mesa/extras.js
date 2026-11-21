// Recursos compartilhados da mesa: histórico, conversão em R$, guia de mãos e detalhes dos potes
import { banco } from '../core/supabase.js?v=8';
import { estado, nomeDe, marcarReal, valorPorMil } from '../core/estado.js?v=8';
import { $id, escapar, fmtNum, fmtReais, abrirFolha } from '../core/ui.js?v=8';
import { nomePote, potesVisiveisNaMesa } from '../core/potes.js?v=8';
import { htmlCartaMini } from '../modos/online/cartas.js?v=8';

// ----- Histórico -----
export function abrirHistorico() {
  abrirFolha('folha-hist');
}

export function desenharHistorico(linhas) {
  const ult = $id('mesa-ultima');
  if (ult) ult.textContent = (linhas && linhas.length) ? nomeDe(linhas[0].texto) : '';
  let html;
  if (!linhas || linhas.length === 0) {
    html = '<div class="detalhe" style="padding:4px 0 8px">Nada registrado ainda. As jogadas aparecem aqui.</div>';
  } else {
    html = linhas.map((linha) => (
      '<div class="hist-linha"><span class="hist-mao">Mão ' + linha.mao + '</span>'
      + '<span>' + escapar(nomeDe(linha.texto)) + '</span></div>'
    )).join('');
  }
  if (html === estado.htmlHistoricoVisto) return;
  estado.htmlHistoricoVisto = html;
  $id('hist-lista').innerHTML = html;
}

// ----- Conversão em reais (referência por sala) -----
export async function carregarValorReal() {
  if (!estado.partidaAtual) return;
  const id = estado.partidaAtual.id;
  if (valorPorMil(id)) return;
  try {
    const resp = await banco.rpc('valor_real_sala', { p_partida: id });
    estado.erroReal = resp && resp.error ? resp.error.message : '';
    const v = resp && !resp.error ? Number(resp.data) : NaN;
    if (v > 0) {
      marcarReal(id, v);
      if (estado.partidaAtual && estado.partidaAtual.id === id) atualizarReais(false);
    }
  } catch (erro) {
    estado.erroReal = 'sem conexão';
  }
  if (estado.partidaAtual && estado.partidaAtual.id === id) atualizarReais(false);
}

export function abrirReais() {
  atualizarReais(true);
  abrirFolha('folha-reais');
  if (estado.partidaAtual && !valorPorMil(estado.partidaAtual.id)) carregarValorReal();
}

export function atualizarReais(forcar) {
  if (!estado.partidaAtual) return;
  $id('btn-reais').hidden = !valorPorMil(estado.partidaAtual.id);
  if (!forcar && $id('folha-reais').hidden) return;

  const v = valorPorMil(estado.partidaAtual.id);
  if (!v) {
    $id('info-real').textContent = 'Esta sala não tem valor em reais definido.'
      + (estado.erroReal ? ' (erro: ' + estado.erroReal + ')' : '');
    $id('lista-reais').innerHTML = '';
    return;
  }

  const conv = (n) => fmtReais(n / 1000 * v);
  const ini = Number(estado.partidaAtual.saldo_inicial);
  $id('info-real').textContent = '1.000 fichas = ' + fmtReais(v)
    + (ini > 0 ? ' · Cada jogador começou com ' + fmtNum(ini) + ' fichas (' + conv(ini) + ')' : '');

  let html = estado.jogadoresAtuais.map((j) => (
    '<div class="linha-dev' + (j.id === estado.meuJogadorId ? ' atual' : '') + '">'
    + '<div class="info-dev">' + escapar(nomeDe(j.nome))
    + '<small>' + j.saldo + ' fichas</small></div><strong>' + conv(j.saldo) + '</strong></div>'
  )).join('');

  if (estado.partidaAtual.pote > 0) {
    html += '<div class="linha-dev"><div class="info-dev">No pote<small>'
      + estado.partidaAtual.pote + ' fichas</small></div><strong>' + conv(estado.partidaAtual.pote) + '</strong></div>';
  }
  $id('lista-reais').innerHTML = html;
}

// ----- Detalhes dos potes (principal e laterais) -----
export function abrirDetalhesPotes() {
  if (!estado.partidaAtual) return;
  const potes = potesVisiveisNaMesa(estado.partidaAtual, estado.jogadoresAtuais);
  if (!potes || potes.length < 2) return;
  desenharDetalhesPotes();
  abrirFolha('folha-potes');
}

export function desenharDetalhesPotes() {
  if (!estado.partidaAtual) return;
  const potes = potesVisiveisNaMesa(estado.partidaAtual, estado.jogadoresAtuais);
  if (!potes || potes.length < 2) return;
  $id('potes-total').textContent = estado.partidaAtual.pote;

  const html = potes.map((p, i) => {
    const titulo = nomePote(i, potes.length);
    const nomes = p.elegiveis.map((j) => '<span class="tag">' + escapar(nomeDe(j.nome)) + '</span>').join('');
    const sub = p.automatico
      ? 'Único na disputa (demais desistiram) — já garantido'
      : (p.morto > 0 ? 'Inclui ' + p.morto + ' de quem desistiu' : '');
    return '<div class="pote-card' + (p.automatico ? ' auto' : '') + '">'
      + '<div class="pote-card-topo">'
      +   '<div class="pote-card-titulo">' + titulo
      +     (p.automatico ? ' <span class="pote-badge ok">Automático</span>' : '') + '</div>'
      +   '<div class="pote-card-valor">' + p.valor + '</div>'
      + '</div>'
      + (sub ? '<div class="pote-card-sub">' + sub + '</div>' : '')
      + '<div class="pote-jogadores-lista">' + nomes + '</div>'
      + '</div>';
  }).join('');
  $id('potes-detalhe-lista').innerHTML = html;

  const eu = estado.jogadoresAtuais.find((j) => j.id === estado.meuJogadorId) || null;
  const souCriador = (!!eu && eu.criador) || estado.modoDev;
  const permiteDistManual = estado.modoAtual === 'presencial';
  $id('btn-potes-ir-dist').hidden = !(permiteDistManual && souCriador && estado.partidaAtual.fase === 4 && estado.partidaAtual.pote > 0);
}

// ----- Guia de mãos do poker -----
const MAOS_POKER = [
  ['Royal Flush', 'Sequência Real', 'A, K, Q, J e 10 do mesmo naipe.', 'A♠ K♠ Q♠ J♠ 10♠'],
  ['Straight Flush', 'Straight Flush', 'Cinco cartas em sequência, todas do mesmo naipe.', '9♥ 8♥ 7♥ 6♥ 5♥'],
  ['Quadra', 'Four of a Kind', 'Quatro cartas do mesmo valor.', 'Q♠ Q♥ Q♦ Q♣ 7♠*'],
  ['Full House', 'Full House', 'Uma trinca (três iguais) e um par (duas iguais).', 'K♠ K♥ K♦ 4♣ 4♠'],
  ['Flush', 'Flush', 'Cinco cartas do mesmo naipe, sem estarem em sequência.', 'A♦ J♦ 9♦ 6♦ 3♦'],
  ['Sequência', 'Straight', 'Cinco cartas em sequência, de naipes variados. O A também vale 1 (A-2-3-4-5).', '9♣ 8♦ 7♠ 6♥ 5♣'],
  ['Trinca', 'Three of a Kind', 'Três cartas do mesmo valor.', '8♠ 8♥ 8♦ K♣* 3♠*'],
  ['Dois Pares', 'Two Pair', 'Dois pares de valores diferentes.', 'J♠ J♦ 5♥ 5♣ A♠*'],
  ['Um Par', 'One Pair', 'Duas cartas do mesmo valor.', '10♠ 10♥ A♦* 7♣* 3♠*'],
  ['Carta Alta', 'High Card', 'Nenhuma combinação: vale a carta mais alta.', 'A♠ J♦* 8♣* 5♥* 2♦*']
];

const NAIPE_POR_SIMBOLO = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

// Usa o mesmo desenho de carta do modo Online (naipes e cores idênticos)
function cartaMiniHtml(txt) {
  const apagada = txt.slice(-1) === '*';
  if (apagada) txt = txt.slice(0, -1);
  const naipe = NAIPE_POR_SIMBOLO[txt.slice(-1)];
  const valor = txt.slice(0, -1);
  return htmlCartaMini((valor === '10' ? 'T' : valor) + naipe, 'guia' + (apagada ? ' apagada' : ''));
}

export function abrirGuia() {
  const lista = $id('guia-lista');
  if (!lista.firstChild) {
    lista.innerHTML = MAOS_POKER.map((m, i) => (
      '<div class="guia-item">'
      + '<div class="guia-topo"><span class="guia-num">' + (i + 1) + '</span>'
      + '<div><div class="guia-nome">' + m[0] + '</div><div class="guia-en">' + m[1] + '</div></div></div>'
      + '<div class="guia-cartas">' + m[3].split(' ').map(cartaMiniHtml).join('') + '</div>'
      + '<div class="guia-desc">' + m[2] + '</div></div>'
    )).join('');
  }
  abrirFolha('folha-guia');
  $id('folha-guia').querySelector('.folha-corpo').scrollTop = 0;
}
