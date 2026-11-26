// Modo Blackjack: multiplayer 1-6 jogadores contra a Banca automática (1 baralho 52 cartas, S17, 3:2)
// Reutiliza animações (riffle shuffle, cartas voando, fichas voando, anúncios) e sons reais de som.js
import { banco } from '../../core/supabase.js?v=107';
import { estado, nomeDe } from '../../core/estado.js?v=107';
import { lerDevSala } from '../../core/storage.js?v=107';
import { $id, escapar, mostrarErro, limparErro } from '../../core/ui.js?v=107';
import { registrarModo } from '../../mesa/modos.js?v=107';
import { publicarEstado, buscarMesa } from '../../mesa/mesa.js?v=111';
import { htmlCarta, htmlCartaMini } from '../online/cartas.js?v=107';
import { tocarSom, marcarAcaoLocal } from '../../core/som.js?v=107';
import { t } from '../../core/i18n.js?v=110';

const bjUI = {
  partidaId: null,
  apostaRascunho: null,
  enviando: false,
  ultimoTimeoutChave: '',
  ultimoSegUrgente: null,
  ultimaFase: null,
  ultimaMao: null,
  eraMinhaVez: false,
  dealerOcultaAntes: null,
  dealerQtdVisto: 0,
  heroQtdVisto: [],
  ultimoBoardKey: null,
  htmlMaoVisto: '',
  htmlBarraVisto: '',
  ultimoTimerPct: '',
  ultimoTimerHidden: null,
  ultimoTimerCritico: null,
  dealAnimadoChave: '',
  resultadoAnunciadoChave: '',
  timers: [],
  timerAnuncio: null,
  timerAnuncioVez: null
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

function limparTimersBJ() {
  if (Array.isArray(bjUI.timers)) {
    bjUI.timers.forEach((id) => clearTimeout(id));
  }
  bjUI.timers = [];
  clearTimeout(bjUI.timerAnuncio);
  bjUI.timerAnuncio = null;
  clearTimeout(bjUI.timerAnuncioVez);
  bjUI.timerAnuncioVez = null;
}

function agendarBJ(fn, ms) {
  const id = setTimeout(fn, ms);
  bjUI.timers.push(id);
  return id;
}

function anunciarBJ(titulo, sub, variante, duracao) {
  const vez = variante === 'vez';
  const el = $id(vez ? 'anuncio-vez' : 'anuncio-mesa');
  if (!el) return;
  el.className = (vez ? 'anuncio-vez ' : 'anuncio-mesa ') + variante;
  el.style.setProperty('--dur', duracao + 'ms');
  el.innerHTML = '<div class="anuncio-titulo">' + escapar(titulo) + '</div>'
    + (sub ? '<div class="anuncio-sub">' + escapar(sub) + '</div>' : '');
  void el.offsetWidth;
  el.classList.add('mostra');
  const chave = vez ? 'timerAnuncioVez' : 'timerAnuncio';
  clearTimeout(bjUI[chave]);
  bjUI[chave] = setTimeout(() => el.classList.remove('mostra'), duracao);
}

function animarDealBlackjack() {
  const wrap = document.querySelector('#tela-mesa.modo-blackjack .mesa-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.baralho-embaralhar, .carta-voo-deal').forEach((n) => n.remove());

  const deck = document.createElement('div');
  deck.className = 'baralho-embaralhar';
  deck.setAttribute('aria-hidden', 'true');
  let html = '';
  for (let i = 0; i < 8; i++) {
    const lado = i % 2 === 0 ? 'esq' : 'dir';
    html += '<span class="carta verso carta-shuf ' + lado + '" style="--i:' + i + '"></span>';
  }
  deck.innerHTML = html;
  wrap.appendChild(deck);

  agendarBJ(() => {
    if (!wrap.isConnected) return;
    const wRect = wrap.getBoundingClientRect();
    const dRect = deck.getBoundingClientRect();
    const ox = dRect.width > 0 ? (dRect.left - wRect.left) + dRect.width / 2 : wRect.width / 2;
    const oy = dRect.height > 0 ? (dRect.top - wRect.top) + dRect.height / 2 : wRect.height * 0.45;

    const alvos = [];
    const board = $id('board');
    if (board) alvos.push(board);
    wrap.querySelectorAll('.lugar').forEach((l) => alvos.push(l));
    const meuAlvo = ($id('minha-mao-wrap') && !$id('minha-mao-wrap').hidden)
      ? $id('minha-mao-wrap')
      : $id('meu-perfil-dock');
    if (meuAlvo && !meuAlvo.hidden) alvos.push(meuAlvo);

    const coords = alvos.map((alvo) => {
      const aRect = alvo.getBoundingClientRect();
      return {
        ok: aRect.width > 0,
        dx: (aRect.left - wRect.left) + aRect.width / 2 - ox,
        dy: (aRect.top - wRect.top) + aRect.height / 2 - oy
      };
    });

    const frag = document.createDocumentFragment();
    const anims = [];
    let passo = 0;
    for (let r = 0; r < 2; r++) {
      coords.forEach(({ ok, dx, dy }, idx) => {
        if (!ok) return;
        const atraso = passo * 85;
        passo++;

        const card = document.createElement('span');
        card.className = 'carta verso carta-voo-deal';
        card.style.left = ox + 'px';
        card.style.top = oy + 'px';
        frag.appendChild(card);

        tocarSom('carta-dar', atraso);
        anims.push({ card, r, idx, dx, dy, atraso });
      });
    }
    wrap.appendChild(frag);
    anims.forEach(({ card, r, idx, dx, dy, atraso }) => {
      if (card.animate) {
        const curvaX = dx * 0.5 + (idx % 2 === 0 ? -14 : 14);
        const curvaY = dy * 0.48 - 22;
        const anim = card.animate([
          { transform: 'translate(-50%, -50%) scale(0.95) rotate(0deg)', opacity: 0 },
          { transform: 'translate(calc(-50% + ' + curvaX + 'px), calc(-50% + ' + curvaY + 'px)) scale(0.85) rotate(75deg)', opacity: 1, offset: 0.5 },
          { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(0.55) rotate(' + (r === 0 ? -6 : 6) + 'deg)', opacity: 0.08 }
        ], {
          duration: 520,
          delay: atraso,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards'
        });
        anim.onfinish = () => card.remove();
      } else {
        agendarBJ(() => card.remove(), atraso + 560);
      }
    });
    agendarBJ(() => { if (deck.parentNode) deck.remove(); }, passo * 85 + 600);
  }, 550);
}

function animarFichasVitoriaBJ() {
  const wrap = document.querySelector('#tela-mesa.modo-blackjack .mesa-wrap');
  const origem = $id('board');
  const destino = $id('meu-perfil-dock');
  if (!wrap || !origem || !destino || destino.hidden) return;
  const wRect = wrap.getBoundingClientRect();
  const oRect = origem.getBoundingClientRect();
  const dRect = destino.getBoundingClientRect();
  if (!(oRect.width > 0 && dRect.width > 0)) return;

  const ox = (oRect.left - wRect.left) + oRect.width / 2;
  const oy = (oRect.top - wRect.top) + oRect.height / 2;
  const dx = (dRect.left - wRect.left) + dRect.width / 2 - ox;
  const dy = (dRect.top - wRect.top) + dRect.height / 2 - oy;

  for (let i = 0; i < 6; i++) {
    const f = document.createElement('span');
    f.className = 'ficha-voo';
    f.style.left = ox + 'px';
    f.style.top = oy + 'px';
    wrap.appendChild(f);
    const atraso = i * 75;
    if (f.animate) {
      const a = f.animate([
        { transform: 'translate(-50%, -50%) scale(0.8)', opacity: 0 },
        { transform: 'translate(calc(-50% + ' + (dx * 0.48 + (i % 2 ? 18 : -18)) + 'px), calc(-50% + ' + (dy * 0.45 - 22) + 'px)) scale(1.1)', opacity: 1, offset: 0.48 },
        { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(0.75)', opacity: 0 }
      ], {
        duration: 620,
        delay: atraso,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      });
      a.onfinish = () => f.remove();
    } else {
      agendarBJ(() => f.remove(), atraso + 660);
    }
  }
}

function textoPontos(mao) {
  if (!mao) return '';
  if (mao.blackjack) return 'Blackjack! 21';
  if (mao.estourou) return t('bj.estourou', { p: mao.pontos });
  if (mao.soft && mao.pontos <= 21) return (mao.pontos - 10) + ' / ' + mao.pontos;
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
  if (mao.resultado === 'ganhou') return t('bj.ganhou', { v: mao.lucro });
  if (mao.resultado === 'empate') return t('bj.empate');
  return t('bj.banca_venceu');
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

function atualizarBarraSePossivel() {
  if (estado.partidaAtual && estado.ultimoEstado) {
    const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId) || null;
    desenharBarraBlackjack(estado.partidaAtual, estado.jogadoresAtuais, { eu });
  }
}

async function chamarRpcBJ(fn, params, erroId = 'erro-barra') {
  if (bjUI.enviando) return false;
  bjUI.enviando = true;
  limparErro(erroId);
  marcarAcaoLocal();
  atualizarBarraSePossivel();
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
    atualizarBarraSePossivel();
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
  if (!partida || !eu || bjUI.enviando) return;
  const bj = obterBjEstado(partida);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const atual = Number(bjUI.apostaRascunho) || 0;
  bjUI.apostaRascunho = Math.min(eu.saldo, atual + (min * mult));
  tocarSom('ficha');
  atualizarBarraSePossivel();
}

export function bjLimparAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu || bjUI.enviando) return;
  const bj = obterBjEstado(partida);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  bjUI.apostaRascunho = Math.min(eu.saldo, min);
  tocarSom('clique');
  atualizarBarraSePossivel();
}

export function bjRepetirAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu || bjUI.enviando) return;
  const bj = obterBjEstado(partida);
  const ent = minhaEntrada(bj, eu);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const ult = (ent && Number(ent.ultima_aposta) >= min) ? Number(ent.ultima_aposta) : min;
  bjUI.apostaRascunho = Math.min(eu.saldo, ult);
  tocarSom('ficha');
  atualizarBarraSePossivel();
}

export function bjDobrarAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu || bjUI.enviando) return;
  const bj = obterBjEstado(partida);
  const min = Math.max(1, Number(bj.aposta_min) || 10);
  const atual = Math.max(min, Number(bjUI.apostaRascunho) || min);
  bjUI.apostaRascunho = Math.min(eu.saldo, atual * 2);
  tocarSom('ficha');
  atualizarBarraSePossivel();
}

export function bjAllInAposta() {
  const partida = estado.partidaAtual;
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!partida || !eu || bjUI.enviando) return;
  bjUI.apostaRascunho = eu.saldo;
  tocarSom('allin');
  atualizarBarraSePossivel();
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
  if (acao === 'pedir') tocarSom('carta-dar');
  else if (acao === 'parar') tocarSom('check');
  else if (acao === 'dobrar' || acao === 'dividir') {
    tocarSom('ficha');
    tocarSom('carta-dar', 130);
  }
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
  tocarSom('embaralhar');
  await chamarRpcBJ('bj_revanche', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo
  });
}

export async function bjConfirmarTodosDev() {
  if (!estado.modoDev || !estado.partidaAtual || bjUI.enviando) return;
  const sala = lerDevSala();
  if (!sala || !sala.jogadores) return;
  bjUI.enviando = true;
  atualizarBarraSePossivel();
  try {
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
  } finally {
    bjUI.enviando = false;
    atualizarBarraSePossivel();
  }
}

export function tratarTeclaBlackjack(e) {
  if (estado.modoAtual !== 'blackjack' || !estado.partidaAtual) return false;
  const bj = obterBjEstado(estado.partidaAtual);
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  if (!eu) return false;

  if (e.key === 'Enter' && (bj.fase === 'apostas' || bj.fase === 'resultado')) {
    const ent = minhaEntrada(bj, eu) || {};
    if (!ent.confirmado && eu.saldo >= (Number(bj.aposta_min) || 10)) {
      e.preventDefault();
      bjConfirmarAposta();
      return true;
    }
  }

  if (bj.fase === 'jogando' && estado.partidaAtual.vez_jogador_id === eu.id) {
    const k = (e.key || '').toLowerCase();
    if (k === 'h' || k === 'p') { e.preventDefault(); bjAgir('pedir'); return true; }
    if (k === 's') { e.preventDefault(); bjAgir('parar'); return true; }
    if (k === 'd') {
      const ent = minhaEntrada(bj, eu) || {};
      const mao = (ent.lista || [])[Number(ent.indice_ativa) || 0];
      if (mao && mao.cartas.length === 2 && eu.saldo >= mao.aposta) {
        e.preventDefault();
        bjAgir('dobrar');
        return true;
      }
    }
  }
  return false;
}

function prepararCenaBlackjack(partida, jogadores) {
  const bj = obterBjEstado(partida);
  if (bjUI.partidaId !== partida.id) {
    limparTimersBJ();
    bjUI.partidaId = partida.id;
    bjUI.ultimaFase = bj.fase;
    bjUI.ultimaMao = partida.mao;
    bjUI.dealerOcultaAntes = !!(bj.dealer && bj.dealer.oculta);
    bjUI.dealerQtdVisto = (bj.dealer && Array.isArray(bj.dealer.cartas)) ? bj.dealer.cartas.length : 0;
    bjUI.heroQtdVisto = [];
    bjUI.eraMinhaVez = false;
    bjUI.ultimoBoardKey = null;
    bjUI.dealAnimadoChave = '';
    bjUI.resultadoAnunciadoChave = '';
    return;
  }

  const eu = (jogadores || []).find((j) => j.id === estado.meuJogadorId) || null;
  const ent = minhaEntrada(bj, eu);
  const novaRodadaDeal = (bj.fase === 'jogando' || bj.fase === 'resultado')
    && (bjUI.ultimaFase === 'apostas' || (partida.mao !== bjUI.ultimaMao && partida.iniciada));
  const dealChave = partida.id + ':' + partida.mao;

  if (novaRodadaDeal && bjUI.dealAnimadoChave !== dealChave) {
    bjUI.dealAnimadoChave = dealChave;
    bjUI.dealerQtdVisto = 0;
    bjUI.heroQtdVisto = [];
    tocarSom('embaralhar');
    animarDealBlackjack();
  }

  // Revelação da carta oculta da Banca + cartas extras da Banca
  const dealer = bj.dealer || {};
  const dealerCartas = Array.isArray(dealer.cartas) ? dealer.cartas : [];
  if (bjUI.dealerOcultaAntes === true && !dealer.oculta && dealerCartas.length >= 2) {
    tocarSom('carta-virar', 80);
    for (let k = 2; k < dealerCartas.length; k++) {
      tocarSom('carta-dar', 260 + (k - 2) * 240);
    }
  }
  bjUI.dealerOcultaAntes = !!dealer.oculta;

  // Anúncio e som de "SUA VEZ"
  const minhaVez = bj.fase === 'jogando' && !!eu && partida.vez_jogador_id === eu.id;
  if (minhaVez && !bjUI.eraMinhaVez) {
    const atraso = (novaRodadaDeal ? 1050 : 0);
    agendarBJ(() => {
      if (estado.partidaAtual && estado.partidaAtual.id === partida.id && estado.partidaAtual.vez_jogador_id === eu.id) {
        anunciarBJ(t('bj.anuncio_vez'), t('bj.anuncio_vez_sub'), 'vez', 2000);
        tocarSom('sua-vez');
      }
    }, atraso);
  }
  bjUI.eraMinhaVez = minhaVez;

  // Anúncio e som de fim da rodada para o Hero
  const resChave = partida.id + ':' + partida.mao + ':' + bj.fase;
  if ((bj.fase === 'resultado' || bj.fase === 'encerrada')
    && bjUI.ultimaFase === 'jogando'
    && bjUI.resultadoAnunciadoChave !== resChave
    && ent && Array.isArray(ent.lista) && ent.lista.length > 0) {
    bjUI.resultadoAnunciadoChave = resChave;
    const totalLucro = ent.lista.reduce((acc, m) => acc + (Number(m.lucro) || 0), 0);
    const totalPag = ent.lista.reduce((acc, m) => acc + (Number(m.pagamento) || 0), 0);
    const temBj = ent.lista.some((m) => m.resultado === 'blackjack');
    const todosEmpate = ent.lista.every((m) => m.resultado === 'empate');
    const todosEstourou = ent.lista.every((m) => m.estourou);

    const atrasoRes = Math.max(250, (dealerCartas.length - 1) * 200);
    agendarBJ(() => {
      if (!estado.partidaAtual || estado.partidaAtual.id !== partida.id) return;
      if (temBj && totalLucro > 0) {
        tocarSom('campeao');
        tocarSom('ganhar-pote', 220);
        animarFichasVitoriaBJ();
        anunciarBJ('BLACKJACK!', t('bj.anuncio_bj_sub', { v: totalLucro }), 'campeao', 2600);
      } else if (totalLucro > 0) {
        tocarSom('ganhar-pote');
        animarFichasVitoriaBJ();
        anunciarBJ(t('bj.anuncio_ganhou'), t('bj.anuncio_ganhou_sub', { v: totalLucro }), 'showdown', 2200);
      } else if (todosEmpate || totalPag > 0 && totalLucro === 0) {
        tocarSom('check');
        anunciarBJ(t('bj.anuncio_empate'), t('bj.anuncio_empate_sub'), 'flop', 1900);
      } else {
        tocarSom('desistir');
        anunciarBJ(
          todosEstourou ? t('bj.anuncio_estourou') : t('bj.anuncio_banca_venceu'),
          dealer.blackjack ? t('bj.anuncio_banca_bj') : t('bj.anuncio_banca_pts', { p: dealer.pontos }),
          'turn',
          2000
        );
      }
    }, atrasoRes);
  }

  bjUI.ultimaFase = bj.fase;
  bjUI.ultimaMao = partida.mao;
}

function desenharDealerBoard(partida) {
  const board = $id('board');
  if (!board) return;
  board.className = 'board bj-board';

  const bj = obterBjEstado(partida);
  const dealer = bj.dealer || { cartas: [], oculta: false, pontos: 0 };
  const cartas = Array.isArray(dealer.cartas) ? dealer.cartas : [];

  const boardKey = bj.fase + '|' + cartas.join(',') + '|' + (dealer.oculta ? '1' : '0') + '|' + dealer.pontos + '|' + bjUI.dealerQtdVisto;
  if (bjUI.ultimoBoardKey === boardKey && bjUI.partidaId === partida.id) return;
  bjUI.ultimoBoardKey = boardKey;

  let cartasHtml = '';
  if (cartas.length === 0) {
    cartasHtml = '<div class="bj-dealer-vazio">' + escapar(t('bj.faca_aposta')) + '<small>' + escapar(t('bj.regra_dica')) + '</small></div>';
    bjUI.dealerQtdVisto = 0;
  } else {
    const slots = cartas.map((c, idx) => {
      const ja = idx < bjUI.dealerQtdVisto;
      const atraso = ja ? 0 : Math.max(0, idx - bjUI.dealerQtdVisto) * 180;
      return '<div class="bj-carta-slot' + (ja ? ' ja' : '') + '" style="--atraso:' + atraso + 'ms">' + htmlCarta(c) + '</div>';
    }).join('');
    const ocultaHtml = dealer.oculta
      ? '<div class="bj-carta-slot' + (bjUI.dealerQtdVisto > 0 ? ' ja' : '') + '" style="--atraso:180ms"><span class="carta verso" aria-label="Hidden card"></span></div>'
      : '';
    cartasHtml = '<div class="bj-dealer-cartas">' + slots + ocultaHtml + '</div>';
    bjUI.dealerQtdVisto = cartas.length;
  }

  let badgePts = '';
  if (cartas.length > 0) {
    const cls = dealer.blackjack ? 'blackjack' : (dealer.estourou ? 'estourou' : '');
    const txt = dealer.oculta ? (String(dealer.pontos) + ' + ?') : textoPontos(dealer);
    badgePts = '<span class="bj-score ' + cls + '">' + escapar(txt) + '</span>';
  }

  board.innerHTML = `
    <div class="bj-dealer">
      <div class="bj-dealer-topo">
        <span class="bj-dealer-titulo">${escapar(t('bj.banca_titulo'))}</span>
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
    if (bjUI.htmlMaoVisto !== '') {
      bjUI.htmlMaoVisto = '';
      wrap.innerHTML = '';
    }
    bjUI.heroQtdVisto = [];
    return;
  }

  const idxAtiva = Number(ent.indice_ativa) || 0;
  const ehSplit = lista.length > 1;
  const novasQtds = [];
  const htmlMaos = lista.map((mao, idx) => {
    const ativa = minhaVez && idx === idxAtiva && mao.status === 'jogando';
    const cartas = Array.isArray(mao.cartas) ? mao.cartas : [];
    const prevQtd = bjUI.heroQtdVisto[idx] || 0;
    novasQtds[idx] = cartas.length;

    const cartasHtml = cartas.map((c, cIdx) => {
      const ja = cIdx < prevQtd;
      const atraso = ja ? 0 : Math.max(0, cIdx - prevQtd) * 140;
      return '<div class="bj-carta-slot' + (ja ? ' ja' : '') + '" style="--atraso:' + atraso + 'ms">' + htmlCarta(c) + '</div>';
    }).join('');

    const clsRes = classeResultado(mao.resultado);
    const rotRes = rotuloResultado(mao);
    const statusTxt = mao.estourou ? 'estourou' : (mao.blackjack ? 'blackjack' : '');
    return `
      <div class="bj-mao-card${ativa ? ' ativa' : ''}${clsRes ? ' ' + clsRes : ''}">
        <div class="bj-mao-cartas">${cartasHtml}</div>
        <div class="bj-mao-meta">
          <span class="bj-score ${statusTxt}">${escapar(textoPontos(mao))}</span>
          <span class="bj-aposta-tag">${escapar(t('bj.aposta_tag', { v: mao.aposta }))}${mao.dobrou ? ' (2x)' : ''}</span>
          ${rotRes ? '<span class="bj-res ' + clsRes + '">' + escapar(rotRes) + '</span>' : ''}
        </div>
      </div>
    `;
  }).join('');

  bjUI.heroQtdVisto = novasQtds;
  const htmlWrap = '<div class="bj-mao-hero' + (ehSplit ? ' split' : '') + '">' + htmlMaos + '</div>';
  if (htmlWrap !== bjUI.htmlMaoVisto) {
    bjUI.htmlMaoVisto = htmlWrap;
    wrap.innerHTML = htmlWrap;
  }
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
  const travado = bjUI.enviando ? ' disabled' : '';

  if (bj.fase === 'encerrada') {
    barra.innerHTML = `
      <div class="bj-aviso-fora">${escapar(t('bj.todos_sem_fichas'))}</div>
      <button type="button" class="positivo bj-btn-cheio" onclick="bjRevanche()"${travado}>${escapar(t('bj.revanche'))}</button>
    `;
    return;
  }

  if (bj.fase === 'jogando') {
    if (minhaVez) {
      const idx = Number(ent.indice_ativa) || 0;
      const maoAtiva = lista[idx];
      const nCartas = (maoAtiva && Array.isArray(maoAtiva.cartas)) ? maoAtiva.cartas.length : 0;
      const podeDobrar = !bjUI.enviando && !!maoAtiva && nCartas === 2 && eu.saldo >= maoAtiva.aposta;
      const podeDividir = !bjUI.enviando && !!maoAtiva && lista.length === 1 && nCartas === 2
        && valorCartaBJ(maoAtiva.cartas[0]) === valorCartaBJ(maoAtiva.cartas[1])
        && eu.saldo >= maoAtiva.aposta;

      barra.innerHTML = `
        <div class="bj-acoes-grid">
          <button type="button" class="positivo bj-btn-pedir" onclick="bjAgir('pedir')"${travado}>${t('bj.pedir')}<small>${t('bj.pedir_sub')}</small></button>
          <button type="button" class="neutro bj-btn-parar" onclick="bjAgir('parar')"${travado}>${t('bj.parar')}<small>${t('bj.parar_sub')}</small></button>
          <button type="button" class="secundario bj-btn-dobrar" onclick="bjAgir('dobrar')"${podeDobrar ? '' : ' disabled'}>${t('bj.dobrar')}<small>${t('bj.dobrar_sub')}</small></button>
          <button type="button" class="secundario bj-btn-dividir" onclick="bjAgir('dividir')"${podeDividir ? '' : ' disabled'}>${t('bj.dividir')}<small>${t('bj.dividir_sub')}</small></button>
        </div>
      `;
    } else {
      const vezJog = (jogadores || []).find((j) => j.id === partida.vez_jogador_id);
      const txt = vezJog ? t('mesa.vez_de', { nome: nomeDe(vezJog.nome) }) : t('bj.banca_jogando');
      barra.innerHTML = '<div class="bj-espera">' + escapar(txt) + '</div>';
    }
    return;
  }

  // Fases 'apostas' ou 'resultado'
  if (eu.saldo < min && !(bj.fase === 'apostas' && ent.confirmado)) {
    barra.innerHTML = '<div class="bj-aviso-fora">' + escapar(t('bj.sem_fichas_fora', { min })) + '</div>';
    return;
  }

  if (bj.fase === 'apostas' && ent.confirmado) {
    const devBtn = estado.modoDev
      ? '<button type="button" class="secundario bj-btn-dev-conf" onclick="bjConfirmarTodosDev()"' + travado + '>' + escapar(t('bj.conf_todos_dev')) + '</button>'
      : '';
    barra.innerHTML = `
      <div class="bj-espera">${t('bj.aposta_conf', { v: ent.aposta_pendente })}</div>
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
      ${temUlt ? '<button type="button" class="secundario" onclick="bjRepetirAposta()"' + travado + '>' + escapar(t('bj.repetir')) + '</button>' : ''}
      <button type="button" class="secundario bj-chip" onclick="bjSomarFicha(1)"${(bjUI.enviando || eu.saldo < valor + min) ? ' disabled' : ''}>+${min}</button>
      <button type="button" class="secundario bj-chip" onclick="bjSomarFicha(2)"${(bjUI.enviando || eu.saldo < valor + min * 2) ? ' disabled' : ''}>+${min * 2}</button>
      <button type="button" class="secundario bj-chip" onclick="bjSomarFicha(5)"${(bjUI.enviando || eu.saldo < valor + min * 5) ? ' disabled' : ''}>+${min * 5}</button>
      <button type="button" class="secundario" onclick="bjDobrarAposta()"${(bjUI.enviando || eu.saldo < Math.max(min, valor) * 2) ? ' disabled' : ''}>2x</button>
      <button type="button" class="secundario allin" onclick="bjAllInAposta()"${travado}>All-in</button>
      <button type="button" class="neutro" onclick="bjLimparAposta()"${travado}>${escapar(t('bj.min_btn'))}</button>
    </div>
    <button type="button" class="positivo bj-btn-cheio" onclick="bjConfirmarAposta()"${travado}>${bjUI.enviando ? escapar(t('bj.enviando')) : t('bj.apostar', { v: valor })}</button>
  `;
}

export function tickBlackjack() {
  if (document.hidden) return;
  const partida = estado.partidaAtual;
  const wrap = $id('timer-turno-wrap');
  const fill = $id('timer-turno-fill');
  if (!partida || partida.modo !== 'blackjack' || !wrap || !fill) {
    if (wrap && bjUI.ultimoTimerHidden !== true) {
      bjUI.ultimoTimerHidden = true;
      wrap.hidden = true;
    }
    return;
  }
  const bj = obterBjEstado(partida);
  const tempo = Number(partida.tempo_turno) || 0;
  let inicioMs = null;
  let fimMs = null;
  let chave = '';
  let minhaVez = false;

  const agoraSrv = Date.now() + (estado.relogio ? estado.relogio.offset : 0);
  if (bj.fase === 'jogando' && partida.vez_jogador_id && partida.vez_desde && tempo > 0) {
    inicioMs = Date.parse(partida.vez_desde);
    fimMs = inicioMs + tempo * 1000;
    chave = 'j:' + partida.mao + ':' + partida.vez_jogador_id + ':' + partida.vez_desde;
    minhaVez = partida.vez_jogador_id === estado.meuJogadorId;
  } else if (bj.fase === 'apostas' && bj.prazo_apostas && tempo > 0) {
    fimMs = Date.parse(bj.prazo_apostas);
    inicioMs = fimMs - tempo * 1000;
    chave = 'a:' + partida.mao + ':' + bj.prazo_apostas;
  }

  if (!fimMs || !inicioMs || tempo <= 0) {
    if (bjUI.ultimoTimerHidden !== true) {
      bjUI.ultimoTimerHidden = true;
      wrap.hidden = true;
    }
    bjUI.ultimoSegUrgente = null;
    bjUI.ultimoTimerPct = '';
    return;
  }

  const rest = Math.max(0, fimMs - agoraSrv);
  const pctStr = Math.max(0, Math.min(100, (rest / (tempo * 1000)) * 100)).toFixed(1) + '%';
  const seg = Math.ceil(rest / 1000);
  const critico = rest <= 6000;

  if (bjUI.ultimoTimerHidden !== false) {
    bjUI.ultimoTimerHidden = false;
    wrap.hidden = false;
  }
  if (bjUI.ultimoTimerPct !== pctStr) {
    bjUI.ultimoTimerPct = pctStr;
    fill.style.width = pctStr;
  }
  if (bjUI.ultimoTimerCritico !== critico) {
    bjUI.ultimoTimerCritico = critico;
    fill.classList.toggle('critico', critico);
  }

  if (minhaVez && seg > 0 && seg <= 5 && bjUI.ultimoSegUrgente !== seg) {
    bjUI.ultimoSegUrgente = seg;
    tocarSom('tempo-urgente');
  } else if (!minhaVez || seg > 5) {
    bjUI.ultimoSegUrgente = null;
  }

  if (rest <= 0 && bjUI.ultimoTimeoutChave !== chave) {
    const humanos = (estado.jogadoresAtuais || []).filter((j) => !j.eh_bot && !j.espectando && !j.ausente);
    const idxH = estado.modoDev ? 0 : humanos.findIndex((j) => j.id === estado.meuJogadorId);
    const atrasoBj = idxH > 0 ? idxH * 600 : 0;
    if ((agoraSrv - fimMs) >= atrasoBj) {
      bjUI.ultimoTimeoutChave = chave;
      banco.rpc('bj_avancar_tempo', { p_partida: partida.id }).then((r) => {
        if (r && r.data && !r.data.sem_mudanca && r.data.partida) publicarEstado(r.data);
      }).catch(() => {});
    }
  }
}

export function resetarBlackjackUI() {
  limparTimersBJ();
  bjUI.partidaId = null;
  bjUI.apostaRascunho = null;
  bjUI.enviando = false;
  bjUI.ultimoTimeoutChave = '';
  bjUI.ultimoSegUrgente = null;
  bjUI.ultimaFase = null;
  bjUI.ultimaMao = null;
  bjUI.eraMinhaVez = false;
  bjUI.dealerOcultaAntes = null;
  bjUI.dealerQtdVisto = 0;
  bjUI.heroQtdVisto = [];
  bjUI.ultimoBoardKey = null;
  bjUI.htmlMaoVisto = '';
  bjUI.htmlBarraVisto = '';
  bjUI.ultimoTimerPct = '';
  bjUI.ultimoTimerHidden = null;
  bjUI.ultimoTimerCritico = null;
  bjUI.dealAnimadoChave = '';
  bjUI.resultadoAnunciadoChave = '';
  const barra = $id('barra-blackjack');
  if (barra) { barra.innerHTML = ''; barra.hidden = true; }
  const wrap = $id('minha-mao-wrap');
  if (wrap) { wrap.innerHTML = ''; wrap.hidden = true; }
  const timerWrap = $id('timer-turno-wrap');
  if (timerWrap) timerWrap.hidden = true;
}

registrarModo('blackjack', {
  prepararCena(partida, jogadores) {
    prepararCenaBlackjack(partida, jogadores);
  },

  textoStatus(partida) {
    const bj = obterBjEstado(partida);
    if (bj.fase === 'encerrada') return t('bj.status_encerrada');
    if (bj.fase === 'resultado') return t('bj.status_resultado');
    if (bj.fase === 'apostas') return t('bj.status_apostas');
    return null;
  },

  desenharBoard(partida) {
    desenharDealerBoard(partida);
  },

  htmlCartasAssento(jogador, partida) {
    if (jogador.id === estado.meuJogadorId) return '';
    const bj = obterBjEstado(partida);
    const ent = (bj.maos && bj.maos[jogador.id]) || null;
    if (!ent) return '<div class="bj-assento-st">' + escapar(t('bj.aguardando')) + '</div>';
    if (ent.eliminado) return '<div class="bj-assento-st perdido">' + escapar(t('bj.sem_fichas')) + '</div>';
    if (bj.fase === 'apostas') {
      return ent.confirmado
        ? '<div class="bj-assento-st ok">' + escapar(t('bj.apostou', { v: ent.aposta_pendente })) + '</div>'
        : '<div class="bj-assento-st">' + escapar(t('bj.apostando')) + '</div>';
    }
    const lista = Array.isArray(ent.lista) ? ent.lista : [];
    if (lista.length === 0) return '<div class="bj-assento-st">' + escapar(t('bj.fora_rodada')) + '</div>';

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
