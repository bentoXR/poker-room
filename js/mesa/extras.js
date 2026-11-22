// Recursos compartilhados da mesa: histórico, conversão em R$, guia de mãos e detalhes dos potes
import { banco } from '../core/supabase.js?v=103';
import { estado, nomeDe, marcarReal, valorPorMil } from '../core/estado.js?v=103';
import { $id, escapar, fmtNum, fmtReais, abrirFolha } from '../core/ui.js?v=103';
import { nomePote, potesVisiveisNaMesa } from '../core/potes.js?v=103';
import { htmlCartaMini } from '../modos/online/cartas.js?v=103';
import { abrirChat } from './chat.js?v=103';

// ----- Histórico -----
export function abrirHistorico() {
  abrirChat('log');
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
  const lista = $id('hist-lista');
  if (lista) lista.innerHTML = html;
}

// ----- Conversão em reais + Placar e Acerto da sessão (Quem paga quem) -----
let textoCopiaAcerto = '';

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
  if (!estado.partidaAtual || !(Number(valorPorMil(estado.partidaAtual.id)) > 0)) return;
  atualizarReais(true);
  abrirFolha('folha-reais');
}

function fmtSinalReais(fichas, vPorMil) {
  const r = (fichas / 1000) * vPorMil;
  const sinal = fichas > 0 ? '+' : '';
  return sinal + fmtReais(r);
}

function fmtSinalFichas(fichas) {
  return (fichas > 0 ? '+' : '') + fmtNum(fichas);
}

export function atualizarReais(forcar) {
  const p = estado.partidaAtual;
  if (!p) return;
  const v = valorPorMil(p.id);
  const temReal = Number(v) > 0;
  const btn = $id('btn-reais');
  if (btn) {
    btn.hidden = !temReal;
    btn.textContent = 'R$';
    btn.dataset.label = 'Acerto R$';
    btn.title = 'Placar e acerto em R$';
  }
  const btnMenu = $id('menu-btn-reais');
  if (btnMenu) {
    btnMenu.hidden = !temReal;
    btnMenu.textContent = '🏆 Placar (R$)';
  }
  if (!temReal) return;
  if (!forcar && $id('folha-reais').hidden) return;

  const conv = (n) => fmtReais((n / 1000) * v);
  const ini = Number(p.saldo_inicial) || 0;
  const semInicio = !p.iniciada && Number(p.mao) === 1;
  $id('info-real').textContent = (v
    ? '1.000 fichas = ' + fmtReais(v) + (ini > 0 ? ' · Stack inicial: ' + fmtNum(ini) + ' (' + conv(ini) + ')' : '')
    : 'Stack inicial: ' + fmtNum(ini) + ' fichas'
  ) + (p.pote > 0 ? ' · Pote na mesa: ' + fmtNum(p.pote) : '');

  const linhas = (estado.jogadoresAtuais || []).map((j) => {
    const entrada = semInicio ? ini : Number(j.total_comprado || ini);
    const atual = Number(j.saldo) || 0;
    const liq = atual - entrada;
    return { j, nome: nomeDe(j.nome), entrada, atual, liq };
  });

  let html = linhas.map((l) => {
    const cls = l.liq > 0 ? 'pos' : (l.liq < 0 ? 'neg' : 'zero');
    const liqTxt = v ? fmtSinalReais(l.liq, v) : (fmtSinalFichas(l.liq) + ' fichas');
    const subTxt = v
      ? (fmtNum(l.atual) + ' fichas (' + conv(l.atual) + ') · entrou ' + fmtNum(l.entrada))
      : ('Agora: ' + fmtNum(l.atual) + ' · entrou: ' + fmtNum(l.entrada));
    return '<div class="linha-dev' + (l.j.id === estado.meuJogadorId ? ' atual' : '') + '">'
      + '<div class="info-dev">' + escapar(l.nome)
      + '<small>' + subTxt + '</small></div>'
      + '<strong class="placar-saldo ' + cls + '">' + liqTxt + '</strong>'
      + '</div>';
  }).join('');

  if (p.pote > 0) {
    html += '<div class="linha-dev"><div class="info-dev">No pote atual<small>'
      + fmtNum(p.pote) + ' fichas em disputa</small></div><strong>' + (v ? conv(p.pote) : fmtNum(p.pote)) + '</strong></div>';
  }
  $id('lista-reais').innerHTML = html;

  // Cálculo mínimo de transferências ("Quem paga quem")
  const devedores = linhas.filter((l) => l.liq < 0).map((l) => ({ nome: l.nome, val: -l.liq })).sort((a, b) => b.val - a.val);
  const credores = linhas.filter((l) => l.liq > 0).map((l) => ({ nome: l.nome, val: l.liq })).sort((a, b) => b.val - a.val);
  const transfs = [];
  let i = 0;
  let j = 0;
  while (i < devedores.length && j < credores.length) {
    const pago = Math.min(devedores[i].val, credores[j].val);
    if (pago > 0) transfs.push({ de: devedores[i].nome, para: credores[j].nome, fichas: pago });
    devedores[i].val -= pago;
    credores[j].val -= pago;
    if (devedores[i].val <= 0) i++;
    if (credores[j].val <= 0) j++;
  }

  const acertoEl = $id('acerto-transferencias');
  if (acertoEl) {
    if (transfs.length === 0) {
      acertoEl.innerHTML = '<div class="detalhe" style="padding:4px 0">Nenhum acerto pendente no momento.</div>';
    } else {
      acertoEl.innerHTML = transfs.map((t) => {
        const quantia = v ? fmtReais((t.fichas / 1000) * v) : (fmtNum(t.fichas) + ' fichas');
        return '<div class="acerto-item">'
          + '<span><strong>' + escapar(t.de) + '</strong> → <strong>' + escapar(t.para) + '</strong></span>'
          + '<strong>' + quantia + '</strong>'
          + '</div>';
      }).join('');
    }
  }

  const nomeSala = nomeDe(p.nome || ('Sala ' + p.codigo));
  const corpoPlacar = linhas.map((l) => '• ' + l.nome + ': ' + (v ? fmtSinalReais(l.liq, v) : fmtSinalFichas(l.liq) + ' fichas') + ' (saldo ' + fmtNum(l.atual) + ')');
  const corpoTransf = transfs.map((t) => '• ' + t.de + ' paga ' + (v ? fmtReais((t.fichas / 1000) * v) : fmtNum(t.fichas) + ' fichas') + ' para ' + t.para);
  textoCopiaAcerto = '🏆 Placar — ' + nomeSala + '\n' + corpoPlacar.join('\n')
    + (corpoTransf.length ? '\n\n💸 Acerto (quem paga quem):\n' + corpoTransf.join('\n') : '');
}

export function copiarAcertoMesa() {
  atualizarReais(true);
  if (!textoCopiaAcerto) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textoCopiaAcerto)
      .then(() => aviso('Resumo do acerto copiado!'))
      .catch(() => copiarFallbackAcerto(textoCopiaAcerto));
  } else {
    copiarFallbackAcerto(textoCopiaAcerto);
  }
}

function copiarFallbackAcerto(txt) {
  try {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    aviso('Resumo do acerto copiado!');
  } catch (e) {
    aviso('Não foi possível copiar automaticamente.');
  }
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
