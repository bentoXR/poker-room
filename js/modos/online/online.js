// Modo Online (baralho virtual): cartas privadas com flip 3D, board animado, timer e confirmação 30s.
// Também cuida do "ritmo" da mesa (avisos de Flop/Turn/River/Showdown em câmera lenta)
// e do assistente de mão (luzinha nas cartas que formam a sua jogada).
import { banco } from '../../core/supabase.js?v=37';
import { estado, nomeDe } from '../../core/estado.js?v=37';
import { $id, escapar, aviso, fecharFolhas, limparErro } from '../../core/ui.js?v=37';
import { lerDevSala } from '../../core/storage.js?v=37';
import { registrarModo } from '../../mesa/modos.js?v=37';
import { executar } from '../../mesa/apostas.js?v=37';
import { recalcularLayoutMesa } from '../../mesa/mesa.js?v=37';
import { parseCarta, htmlCarta, htmlCartaMini, htmlVersoMini, textoCarta } from './cartas.js?v=37';
import { avaliarMaoLocal } from './maos.js?v=37';
import { tocarSom } from '../../core/som.js?v=37';

// Tempos (ms) do "ritmo lento" das etapas da mão
const T = {
  antesCarta: 1100,   // aviso aparece e só depois as cartas caem na mesa
  aposFlop: 2800,     // pausa depois do flop (3 cartas) antes da próxima etapa
  aposCarta: 2300,    // pausa depois de Turn / River
  showdown: 2400,     // aviso "Showdown" antes de revelar as mãos
  anuncio: 2300,      // duração do aviso grande no centro da mesa
  anuncioVez: 2000    // duração do aviso "Sua vez"
};
const ROTULOS_RUA = { 3: 'FLOP', 4: 'TURN', 5: 'RIVER' };
const SUBTITULOS_RUA = {
  FLOP: 'As 3 primeiras cartas da mesa',
  TURN: 'A quarta carta da mesa',
  RIVER: 'A última carta da mesa'
};

const ICONE_LUZ = '<svg class="ic-luz" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21h6M10 17h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>';

// Dicas de mão sempre ativadas (luzinha + nome da jogada atual)
// Estado local efêmero (nada daqui é enviado ao servidor)
const onlineUI = {
  maoCarregada: null,
  jogadorCarregado: null,
  minhasCartas: null,       // ['As', 'Kh']
  viradas: [false, false],  // estado do flip 3D de cada carta
  buscandoCartas: false,
  htmlBoardVisto: '',
  boardQtdVisto: -1,
  htmlMaoVisto: '',
  maoAnimada: '',           // controla para a animação de distribuição tocar só 1x por mão
  faixaChave: '',           // evita reconstruir o botão da faixa durante a contagem regressiva
  avancandoTempo: false,
  ultimoAvancoEm: 0,
  mostrouDica: false,
  assistente: true,

  // Cena de revelação (flop, turn, river e showdown em câmera lenta)
  partidaId: null,
  boardMostrado: -1,        // quantas cartas da mesa já foram reveladas na tela
  cena: null,               // { fila, timer }
  segurando: false,         // true = resultado do showdown ainda escondido
  chaveEmCena: null,
  resultadoVisto: null,
  poteAnimadoChave: null,   // evita repetir a animação de fichas voando para o mesmo showdown
  congelado: null,          // fichas/pote de antes do showdown (para não "estragar" a surpresa)
  ultimaVisao: null,

  eraMinhaVez: false,
  ultimaTxt: null,
  ultimoSegUrgente: null,
  campeaoSomChave: null,
  timerAnuncio: null,
  timerAnuncioVez: null
};

function cancelarCena() {
  if (onlineUI.cena && onlineUI.cena.timer) clearTimeout(onlineUI.cena.timer);
  onlineUI.cena = null;
  onlineUI.segurando = false;
  onlineUI.chaveEmCena = null;
  onlineUI.congelado = null;
  ['anuncio-mesa', 'anuncio-vez'].forEach((id) => {
    const el = $id(id);
    if (el) { el.classList.remove('mostra'); el.innerHTML = ''; }
  });
}

export function resetarOnlineUI() {
  cancelarCena();
  onlineUI.maoCarregada = null;
  onlineUI.jogadorCarregado = null;
  onlineUI.minhasCartas = null;
  onlineUI.viradas = [false, false];
  onlineUI.buscandoCartas = false;
  onlineUI.htmlBoardVisto = '';
  onlineUI.boardQtdVisto = -1;
  onlineUI.htmlMaoVisto = '';
  onlineUI.maoAnimada = '';
  onlineUI.faixaChave = '';
  onlineUI.partidaId = null;
  onlineUI.boardMostrado = -1;
  onlineUI.resultadoVisto = null;
  onlineUI.poteAnimadoChave = null;
  onlineUI.ultimaVisao = null;
  onlineUI.eraMinhaVez = false;
  onlineUI.ultimaTxt = null;
  onlineUI.ultimoSegUrgente = null;
  onlineUI.campeaoSomChave = null;
  const wrap = $id('minha-mao-wrap');
  if (wrap) { wrap.innerHTML = ''; wrap.hidden = true; }
  const faixa = $id('faixa-online');
  if (faixa) { faixa.innerHTML = ''; faixa.hidden = true; }
  const timerWrap = $id('timer-turno-wrap');
  if (timerWrap) timerWrap.hidden = true;
}

// ----- Avisos grandes na mesa -----
function anunciar(titulo, sub, variante, duracao) {
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
  clearTimeout(onlineUI[chave]);
  onlineUI[chave] = setTimeout(() => el.classList.remove('mostra'), duracao);
}

function parseCartaLocal(raw) { return parseCarta(raw); }

function melhoresDoResultado(partida) {
  const set = {};
  const res = partida && partida.ultimo_resultado;
  if (!res || !res.potes) return set;
  res.potes.forEach((p) => {
    (p.vencedores || []).forEach((v) => {
      (v.melhores || []).forEach((c) => { set[c] = true; });
    });
  });
  return set;
}

function vencedoresDoResultado(partida) {
  const set = {};
  const res = partida && partida.ultimo_resultado;
  if (!res) return set;
  if (res.vencedor_id) set[res.vencedor_id] = true;
  (res.potes || []).forEach((p) => {
    (p.vencedores || []).forEach((v) => { if (v.id) set[v.id] = true; });
  });
  return set;
}

function premiosDoResultado(partida) {
  const mapa = {};
  const res = partida && partida.ultimo_resultado;
  if (!res) return mapa;
  if (res.vencedor_id && res.valor > 0) {
    mapa[res.vencedor_id] = (mapa[res.vencedor_id] || 0) + Number(res.valor);
  }
  (res.potes || []).forEach((p) => {
    (p.vencedores || []).forEach((v) => {
      if (v.id && v.valor > 0) mapa[v.id] = (mapa[v.id] || 0) + Number(v.valor);
    });
  });
  return mapa;
}

// Animação rápida de baralho embaralhando (riffle shuffle) no centro da mesa ao iniciar nova mão
function animarEmbaralhar() {
  const wrap = document.querySelector('#tela-mesa.modo-online .mesa-wrap');
  if (!wrap) return;
  const antiga = wrap.querySelector('.baralho-embaralhar');
  if (antiga) antiga.remove();

  const el = document.createElement('div');
  el.className = 'baralho-embaralhar';
  el.setAttribute('aria-hidden', 'true');
  let html = '';
  for (let i = 0; i < 6; i++) {
    const lado = i % 2 === 0 ? 'esq' : 'dir';
    html += '<span class="carta verso carta-shuf ' + lado + '" style="--i:' + i + '"></span>';
  }
  el.innerHTML = html;
  wrap.appendChild(el);
  setTimeout(() => { el.remove(); }, 980);
}

// Animação do pote voando em fichas até o(s) assento(s) vencedor(es)
function animarPoteParaVencedor(partida) {
  if (!partida || !partida.aguardando_proxima_mao || onlineUI.segurando || !partida.ultimo_resultado) return;
  const chave = chaveDoResultado(partida);
  if (!chave || chave === onlineUI.poteAnimadoChave) return;
  onlineUI.poteAnimadoChave = chave;

  const premios = premiosDoResultado(partida);
  const idsVencedores = Object.keys(premios);
  if (!idsVencedores.length) return;

  requestAnimationFrame(() => {
    const wrap = document.querySelector('#tela-mesa .mesa-wrap');
    const poteEl = $id('pote-ficha');
    if (!wrap || !poteEl) return;

    const wRect = wrap.getBoundingClientRect();
    const pRect = poteEl.getBoundingClientRect();
    const ox = (pRect.left - wRect.left) + pRect.width / 2;
    const oy = (pRect.top - wRect.top) + pRect.height / 2;

    const destinos = idsVencedores
      .map((id) => wrap.querySelector('.lugar[data-jogador-id="' + id + '"]'))
      .filter(Boolean);
    if (!destinos.length) return;
    tocarSom('ganhar-pote');

    const totalFichas = Math.max(6, destinos.length * 4);
    for (let i = 0; i < totalFichas; i++) {
      const alvo = destinos[i % destinos.length];
      const aRect = alvo.getBoundingClientRect();
      const dx = (aRect.left - wRect.left) + aRect.width / 2 - ox;
      const dy = (aRect.top - wRect.top) + aRect.height / 2 - oy;

      const chip = document.createElement('span');
      chip.className = 'ficha-voo';
      chip.style.left = ox + 'px';
      chip.style.top = oy + 'px';
      wrap.appendChild(chip);

      const espalhoX = ((i % 3) - 1) * 10;
      const espalhoY = (Math.floor(i / 3) - 1) * 8;
      const curvaX = dx * 0.45 + espalhoX * 1.6;
      const curvaY = dy * 0.45 - 26 + espalhoY;

      if (chip.animate) {
        const anim = chip.animate([
          { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
          { transform: 'translate(calc(-50% + ' + espalhoX + 'px), calc(-50% + ' + espalhoY + 'px)) scale(1.1)', opacity: 1, offset: 0.16 },
          { transform: 'translate(calc(-50% + ' + curvaX + 'px), calc(-50% + ' + curvaY + 'px)) scale(1.05)', opacity: 1, offset: 0.58 },
          { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(0.55)', opacity: 0.15 }
        ], {
          duration: 860,
          delay: i * 70,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards'
        });
        anim.onfinish = () => chip.remove();
      } else {
        setTimeout(() => chip.remove(), 900);
      }
    }

    destinos.forEach((alvo) => {
      setTimeout(() => {
        alvo.classList.remove('recebeu-pote');
        void alvo.offsetWidth;
        alvo.classList.add('recebeu-pote');
      }, 640);
    });
  });
}

// ----- Cena em câmera lenta: flop → turn → river → showdown -----
function chaveDoResultado(partida) {
  const res = partida.ultimo_resultado;
  return (partida.aguardando_proxima_mao && res) ? (partida.mao + ':' + res.tipo) : null;
}

function prepararCena(partida, jogadores) {
  const total = Array.isArray(partida.board) ? partida.board.length : 0;
  const res = partida.ultimo_resultado;
  const chave = chaveDoResultado(partida);
  const ehShowdown = !!(chave && res && res.tipo === 'showdown');

  if (onlineUI.boardMostrado < 0 || onlineUI.partidaId !== partida.id) {
    // Primeira vez que vemos esta mesa: mostra tudo como está, sem reencenar
    cancelarCena();
    onlineUI.partidaId = partida.id;
    onlineUI.boardMostrado = total;
    onlineUI.resultadoVisto = chave;
    onlineUI.poteAnimadoChave = chave;
  } else if (total < onlineUI.boardMostrado) {
    // Nova mão começou
    cancelarCena();
    onlineUI.boardMostrado = total;
    onlineUI.resultadoVisto = chave;
  } else if (!onlineUI.cena) {
    const faltamCartas = total > onlineUI.boardMostrado;
    const faltaShowdown = ehShowdown && chave !== onlineUI.resultadoVisto;
    if (faltamCartas || faltaShowdown) iniciarCena(total, faltaShowdown ? chave : null);
    else if (chave) onlineUI.resultadoVisto = chave;
  } else {
    // Se uma nova carta ou o showdown chegou enquanto a animação anterior ainda rodava, enfileira sem dar spoiler!
    const fila = onlineUI.cena.fila;
    let ate = onlineUI.boardMostrado;
    fila.forEach((et) => { if (et.ate && et.ate > ate) ate = et.ate; });
    while (ate < total) {
      const prox = ate < 3 ? Math.min(3, total) : ate + 1;
      const idxShow = fila.findIndex((et) => et.showdown);
      const item = { ate: prox, rotulo: ROTULOS_RUA[prox] || 'FLOP' };
      if (idxShow >= 0) fila.splice(idxShow, 0, item);
      else fila.push(item);
      ate = prox;
    }
    if (ehShowdown && chave !== onlineUI.resultadoVisto && !onlineUI.segurando) {
      if (!fila.some((et) => et.showdown)) fila.push({ showdown: true });
      onlineUI.segurando = true;
      onlineUI.chaveEmCena = chave;
      onlineUI.congelado = onlineUI.ultimaVisao;
    }
  }

  if (!onlineUI.segurando) {
    onlineUI.ultimaVisao = { jogadores, pote: partida.pote };
  }
}

function iniciarCena(total, chaveShowdown) {
  const fila = [];
  let atual = onlineUI.boardMostrado;
  while (atual < total) {
    const prox = atual < 3 ? Math.min(3, total) : atual + 1;
    fila.push({ ate: prox, rotulo: ROTULOS_RUA[prox] || 'FLOP' });
    atual = prox;
  }
  if (chaveShowdown) {
    fila.push({ showdown: true });
    onlineUI.segurando = true;
    onlineUI.chaveEmCena = chaveShowdown;
    onlineUI.congelado = onlineUI.ultimaVisao;
  }
  onlineUI.cena = { fila, timer: null };
  proximaEtapa();
}

function proximaEtapa() {
  const cena = onlineUI.cena;
  if (!cena) return;
  const etapa = cena.fila.shift();
  if (!etapa) { terminarCena(); return; }

  if (etapa.showdown) {
    anunciar('SHOWDOWN', 'Hora de mostrar as cartas', 'showdown', T.showdown);
    tocarSom('showdown');
    cena.timer = setTimeout(proximaEtapa, T.showdown);
    return;
  }

  anunciar(etapa.rotulo, SUBTITULOS_RUA[etapa.rotulo], 'rua', T.anuncio);
  cena.timer = setTimeout(() => {
    onlineUI.boardMostrado = etapa.ate;
    desenharBoardInterno(estado.partidaAtual);
    cena.timer = setTimeout(proximaEtapa, etapa.ate === 3 ? T.aposFlop : T.aposCarta);
  }, T.antesCarta);
}

function terminarCena() {
  const eraSegurando = onlineUI.segurando;
  if (onlineUI.chaveEmCena) onlineUI.resultadoVisto = onlineUI.chaveEmCena;
  onlineUI.cena = null;
  onlineUI.segurando = false;
  onlineUI.chaveEmCena = null;
  onlineUI.congelado = null;
  if (eraSegurando) {
    tocarSom('carta-virar');
    recalcularLayoutMesa();
  }
}

// ----- Cartas da mesa (board) -----
function desenharBoardInterno(partida) {
  if (!partida) return;
  const boardEl = $id('board');
  boardEl.classList.add('online');
  const todas = Array.isArray(partida.board) ? partida.board : [];
  const n = onlineUI.boardMostrado < 0 ? todas.length : Math.min(onlineUI.boardMostrado, todas.length);
  const cartas = todas.slice(0, n);
  const melhores = (partida.aguardando_proxima_mao && !onlineUI.segurando) ? melhoresDoResultado(partida) : {};
  const chave = cartas.join(',') + '|' + Object.keys(melhores).sort().join(',');

  if (chave !== onlineUI.htmlBoardVisto) {
    const antes = onlineUI.boardQtdVisto < 0 ? n : onlineUI.boardQtdVisto;
    onlineUI.htmlBoardVisto = chave;
    onlineUI.boardQtdVisto = n;
    let html = '';
    for (let k = 0; k < 5; k++) {
      const raw = cartas[k];
      if (!raw) {
        html += '<div class="carta-slot-vazio"></div>';
        continue;
      }
      const c = parseCartaLocal(raw);
      if (!c) { html += '<div class="carta-slot-vazio"></div>'; continue; }
      const nova = k >= antes;
      const atraso = nova ? ((k - antes) * 420) + 'ms' : '0ms';
      const dest = !!melhores[c.raw];
      html += '<div class="carta-board' + (nova ? '' : ' ja') + (dest ? ' destaque' : '') + '" data-raw="' + c.raw + '" style="--atraso:' + atraso + '">'
        + htmlCarta(c.raw)
        + '</div>';
    }
    boardEl.querySelector('.slots').innerHTML = html;
    if (antes < n) {
      for (let k = antes; k < n; k++) {
        tocarSom('carta-dar', (k - antes) * 420);
      }
    }
  }

  boardEl.querySelectorAll('.rotulos span').forEach((el) => {
    const faseVis = faseExibida(partida);
    el.classList.toggle('atual', partida.iniciada && !partida.aguardando_proxima_mao && Number(el.dataset.f) === faseVis);
  });
  atualizarLuzes();
}

function faseExibida(partida) {
  if (!onlineUI.segurando || onlineUI.boardMostrado < 0) return partida.fase;
  const n = onlineUI.boardMostrado;
  return n >= 5 ? 3 : n === 4 ? 2 : n === 3 ? 1 : 0;
}

// ----- Assistente de mão: luzinha sempre ativa nas cartas que formam a sua jogada -----
function atualizarLuzes() {
  const wrap = $id('minha-mao-wrap');
  const boardEl = $id('board');
  if (wrap) wrap.querySelectorAll('.carta-3d').forEach((b) => b.classList.remove('luz'));
  if (boardEl) boardEl.querySelectorAll('.carta-board').forEach((el) => el.classList.remove('luz', 'apagada'));
  const nomeEl = $id('minha-mao-nome');
  const esconderNome = () => {
    if (nomeEl) { nomeEl.hidden = true; nomeEl.innerHTML = ''; }
    if (wrap) wrap.classList.remove('com-nome');
  };

  const p = estado.partidaAtual;
  if (!p || p.modo !== 'online' || !onlineUI.minhasCartas) { esconderNome(); return; }
  const eu = (estado.jogadoresAtuais || []).find((j) => j.id === estado.meuJogadorId);
  const olhando = !!(onlineUI.viradas[0] || onlineUI.viradas[1]);
  const emMao = p.iniciada && !p.aguardando_proxima_mao && !onlineUI.segurando;
  if (!olhando || !emMao || !eu || !eu.tem_cartas || eu.desistiu) { esconderNome(); return; }

  const todas = Array.isArray(p.board) ? p.board : [];
  const abertas = todas.slice(0, onlineUI.boardMostrado < 0 ? todas.length : Math.min(onlineUI.boardMostrado, todas.length));
  const av = avaliarMaoLocal(onlineUI.minhasCartas.concat(abertas));
  if (!av) { esconderNome(); return; }

  const usadas = {};
  av.usadas.forEach((r) => { usadas[r] = true; });
  if (wrap) {
    wrap.querySelectorAll('.carta-3d').forEach((b) => {
      b.classList.toggle('luz', !!usadas[b.dataset.raw]);
    });
  }
  if (boardEl) {
    boardEl.querySelectorAll('.carta-board').forEach((el) => {
      if (usadas[el.dataset.raw]) el.classList.add('luz');
      else if (av.cat >= 1) el.classList.add('apagada');
    });
  }
  if (nomeEl) {
    nomeEl.innerHTML = '<span class="mm-txt"><b>' + escapar(av.detalhe) + '</b>'
      + (av.projeto ? '<small>' + escapar(av.projeto) + '</small>' : '') + '</span>';
    nomeEl.hidden = false;
  }
  if (wrap) wrap.classList.add('com-nome');
}

// Busca as 2 cartas privadas do jogador atual (autenticadas pelo segredo no banco)
async function sincronizarMinhasCartas(partida, eu) {
  if (!eu || !partida.iniciada || !eu.tem_cartas) {
    if (onlineUI.minhasCartas !== null) {
      onlineUI.minhasCartas = null;
      onlineUI.maoCarregada = null;
      onlineUI.viradas = [false, false];
      desenharMinhaMao(partida, eu);
    }
    return;
  }

  const maoRef = partida.aguardando_proxima_mao ? (partida.mao - 1) : partida.mao;
  if (onlineUI.maoCarregada === maoRef && onlineUI.jogadorCarregado === eu.id && onlineUI.minhasCartas) {
    desenharMinhaMao(partida, eu);
    return;
  }
  if (onlineUI.buscandoCartas) return;

  onlineUI.buscandoCartas = true;
  const jid = eu.id;
  const seg = estado.meuSegredo;
  try {
    const resp = await banco.rpc('minhas_cartas', { p_jogador: jid, p_segredo: seg });
    if (!resp.error && resp.data && Array.isArray(resp.data.cartas) && resp.data.cartas.length === 2) {
      if (estado.meuJogadorId === jid) {
        const mudouMao = (onlineUI.maoCarregada !== resp.data.mao || onlineUI.jogadorCarregado !== jid);
        onlineUI.maoCarregada = resp.data.mao;
        onlineUI.jogadorCarregado = jid;
        onlineUI.minhasCartas = resp.data.cartas;
        if (mudouMao) onlineUI.viradas = [false, false];
        desenharMinhaMao(estado.partidaAtual, estado.jogadoresAtuais.find((x) => x.id === jid));
      }
    }
  } catch (erro) {
  } finally {
    onlineUI.buscandoCartas = false;
  }
}

export function virarMinhaCarta(_indice) {
  if (!onlineUI.minhasCartas) return;
  const abrir = !(onlineUI.viradas[0] && onlineUI.viradas[1]);
  onlineUI.viradas = [abrir, abrir];
  onlineUI.mostrouDica = true;
  tocarSom('carta-virar');
  try { if (navigator.vibrate) navigator.vibrate(10); } catch (erro) {}
  document.querySelectorAll('#minha-mao-wrap .carta-3d').forEach((btn) => {
    btn.classList.toggle('virada', abrir);
  });
  const dica = document.querySelector('#minha-mao-wrap .minha-mao-dica');
  if (dica) dica.textContent = abrir ? 'Toque novamente para esconder' : 'Toque nas cartas para espiar';
  atualizarLuzes();
}

function desenharMinhaMao(partida, eu) {
  const wrap = $id('minha-mao-wrap');
  if (!wrap) return;
  if (!partida || partida.modo !== 'online' || !eu || !onlineUI.minhasCartas || !eu.tem_cartas) {
    wrap.hidden = true;
    if (onlineUI.htmlMaoVisto) { onlineUI.htmlMaoVisto = ''; wrap.innerHTML = ''; }
    return;
  }

  const emPausa = !!partida.aguardando_proxima_mao && !onlineUI.segurando;
  const res = partida.ultimo_resultado;
  const vis = Array.isArray(eu.cartas_visiveis) ? eu.cartas_visiveis : [];
  const melhores = emPausa && res && res.tipo === 'showdown' ? melhoresDoResultado(partida) : {};

  const c1Vis = !!vis[0];
  const c2Vis = !!vis[1];
  const ganheiPorDesistencia = !!(res && res.tipo === 'desistencia' && res.vencedor_id === eu.id);
  const podeRevelar = emPausa && ganheiPorDesistencia && (!c1Vis || !c2Vis);

  // Chave de cache: evita reconstruir o DOM (e repetir a animação) a cada aposta da mesa
  const chave = [
    onlineUI.maoCarregada,
    onlineUI.jogadorCarregado,
    onlineUI.minhasCartas.join(','),
    emPausa ? '1' : '0',
    c1Vis ? '1' : '0',
    c2Vis ? '1' : '0',
    podeRevelar ? '1' : '0',
    eu.mao_nome || '',
    onlineUI.assistente ? 'L' : 'l',
    Object.keys(melhores).sort().join(',')
  ].join('|');

  if (chave === onlineUI.htmlMaoVisto) {
    wrap.hidden = false;
    atualizarLuzes();
    return;
  }
  onlineUI.htmlMaoVisto = chave;

  const abertas = [
    onlineUI.viradas[0] || c1Vis,
    onlineUI.viradas[1] || c2Vis
  ];

  const chaveMao = onlineUI.maoCarregada + ':' + onlineUI.jogadorCarregado + ':' + onlineUI.minhasCartas.join(',');
  const animarAgora = chaveMao !== onlineUI.maoAnimada;
  if (animarAgora) {
    onlineUI.maoAnimada = chaveMao;
    tocarSom('carta-dar', 0);
    tocarSom('carta-dar', 220);
  }

  const cartasHtml = onlineUI.minhasCartas.map((raw, idx) => {
    const c = parseCartaLocal(raw);
    if (!c) return '';
    const virada = abertas[idx];
    const dest = !!melhores[c.raw];
    return `
      <div class="carta-3d-slot${animarAgora ? ' animar-entrada' : ''}">
        <button type="button" class="carta-3d${virada ? ' virada' : ''}${dest ? ' destaque' : ''}"
                data-idx="${idx}" data-raw="${c.raw}" onclick="virarMinhaCarta(${idx})"
                aria-label="Carta ${idx + 1}: toque para virar">
          <span class="carta-face verso"></span>
          <span class="carta-face frente">${htmlCarta(c.raw)}</span>
        </button>
      </div>
    `;
  }).join('');

  let revelarHtml = '';
  if (podeRevelar) {
    revelarHtml = '<div class="minha-mao-revelar">'
      + (!c1Vis ? '<button type="button" class="secundario" onclick="mostrarCartasOnline(\'1\')">Mostrar ' + textoCarta(onlineUI.minhasCartas[0]) + '</button>' : '')
      + (!c2Vis ? '<button type="button" class="secundario" onclick="mostrarCartasOnline(\'2\')">Mostrar ' + textoCarta(onlineUI.minhasCartas[1]) + '</button>' : '')
      + ((!c1Vis && !c2Vis) ? '<button type="button" class="positivo" onclick="mostrarCartasOnline(\'ambas\')">Mostrar as duas</button>' : '')
      + '</div>';
  }

  const dica = podeRevelar
    ? 'Quer mostrar seu blefe ou sua mão para a mesa?'
    : (eu.mao_nome && emPausa
        ? 'Sua mão: ' + escapar(eu.mao_nome)
        : (abertas[0] || abertas[1] ? 'Toque novamente para esconder' : 'Toque nas cartas para espiar'));

  wrap.innerHTML = '<div class="minha-mao-linha"><div class="minha-mao-cartas">' + cartasHtml + '</div></div>'
    + '<div class="minha-mao-nome" id="minha-mao-nome" hidden></div>'
    + '<div class="minha-mao-dica">' + dica + '</div>'
    + revelarHtml;
  wrap.hidden = false;
  // Remove a classe de entrada depois que as cartas terminam de cair,
  // evitando que a animação repita ao abrir/fechar "Aumentar" no celular!
  setTimeout(() => {
    wrap.querySelectorAll('.carta-3d-slot.animar-entrada').forEach((el) => el.classList.remove('animar-entrada'));
  }, 1150);
  atualizarLuzes();
}

// ----- Ações RPC do modo Online -----
export function confirmarMao() {
  tocarSom('clique');
  return executar('confirmar_mao', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo
  }, 'erro-barra');
}

export function mostrarCartasOnline(qual) {
  tocarSom('carta-virar');
  return executar('mostrar_cartas_online', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo,
    p_qual: qual || 'ambas'
  }, 'erro-barra').then((ok) => {
    if (ok) {
      if (qual === '1') onlineUI.viradas[0] = true;
      else if (qual === '2') onlineUI.viradas[1] = true;
      else { onlineUI.viradas[0] = true; onlineUI.viradas[1] = true; }
      aviso('Cartas mostradas na mesa!');
    }
    return ok;
  });
}

export function revancheOnline() {
  tocarSom('clique');
  return executar('revanche_online', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo
  }, 'erro-barra').then((ok) => {
    if (ok) aviso('Revanche iniciada! Confirmem entrada.');
    return ok;
  });
}

// Atalho exclusivo do modo DEV Online: confirma todos os jogadores fictícios de uma vez
export async function confirmarTodosDev() {
  const sala = lerDevSala();
  if (!sala || estado.ocupado) return;
  limparErro('erro-dev');
  for (let i = 0; i < sala.jogadores.length; i++) {
    const j = sala.jogadores[i];
    const naMesa = estado.jogadoresAtuais.find((x) => x.id === j.id);
    if (!naMesa || !(naMesa.saldo > 0) || naMesa.confirmado) continue;
    await executar('confirmar_mao', { p_jogador: j.id, p_segredo: j.segredo }, 'erro-dev');
    if (estado.partidaAtual && estado.partidaAtual.iniciada && !estado.partidaAtual.aguardando_proxima_mao) break;
  }
  fecharFolhas();
}

// Chama avancar_tempo_online quando algum prazo (timer de turno ou contagem de 30s) vence
async function dispararAvancoTempo(partidaId) {
  const agora = Date.now();
  if (onlineUI.avancandoTempo || (agora - onlineUI.ultimoAvancoEm) < 1800) return;
  onlineUI.avancandoTempo = true;
  onlineUI.ultimoAvancoEm = agora;
  try {
    await executar('avancar_tempo_online', { p_partida: partidaId }, 'erro-barra');
  } finally {
    onlineUI.avancandoTempo = false;
  }
}

// Atualização a cada segundo (chamada pelo tick() de mesa.js)
export function tickOnline() {
  const p = estado.partidaAtual;
  if (!p || p.modo !== 'online' || p.encerrada) return;

  const agora = Date.now() + estado.relogio.offset;

  // 1) Timer de turno (contagem regressiva + barra de progresso). tempo_turno = 0 → sem limite.
  const limitado = Number(p.tempo_turno) > 0;
  const emTurno = p.iniciada && !p.aguardando_proxima_mao && p.fase < 4 && !!p.vez_jogador_id && !!p.vez_desde;
  const timerWrap = $id('timer-turno-wrap');
  const timerFill = $id('timer-turno-fill');

  if (emTurno && limitado) {
    const totalMs = Math.max(15, Number(p.tempo_turno) || 30) * 1000;
    const decorrido = Math.max(0, agora - Date.parse(p.vez_desde));
    const restanteMs = Math.max(0, totalMs - decorrido);
    const restanteSeg = Math.ceil(restanteMs / 1000);
    const pct = Math.max(0, Math.min(100, (restanteMs / totalMs) * 100));

    const elTurno = $id('tempo-turno');
    if (elTurno) {
      elTurno.textContent = restanteSeg + 's';
      const tagVez = elTurno.closest('.tag.vez');
      if (tagVez) tagVez.classList.toggle('urgente', restanteSeg <= 7);
    }
    const barraAssento = document.querySelector('.lugar.vez .l-timer i');
    if (barraAssento) {
      barraAssento.style.width = pct.toFixed(1) + '%';
      barraAssento.classList.toggle('alerta', restanteSeg <= 12 && restanteSeg > 7);
      barraAssento.classList.toggle('urgente', restanteSeg <= 7);
    }

    const minhaVez = p.vez_jogador_id === estado.meuJogadorId;
    if (minhaVez && restanteSeg <= 7 && restanteSeg > 0) {
      if (onlineUI.ultimoSegUrgente !== restanteSeg) {
        onlineUI.ultimoSegUrgente = restanteSeg;
        tocarSom('tempo-urgente');
      }
    } else {
      onlineUI.ultimoSegUrgente = null;
    }
    if (timerWrap && timerFill) {
      timerWrap.hidden = !minhaVez;
      if (minhaVez) {
        timerFill.style.width = pct.toFixed(1) + '%';
        timerFill.classList.toggle('alerta', restanteSeg <= 12 && restanteSeg > 7);
        timerFill.classList.toggle('urgente', restanteSeg <= 7);
      }
    }

    if (restanteMs <= 0 && (decorrido - totalMs) >= 350) {
      dispararAvancoTempo(p.id);
    }
  } else {
    onlineUI.ultimoSegUrgente = null;
    if (timerWrap) timerWrap.hidden = true;
  }

  // 2) Contagem regressiva de 30s entre mãos (ou início da 1ª mão)
  const emEspera = (!p.iniciada || p.aguardando_proxima_mao) && !!p.proxima_mao_em;
  if (emEspera) {
    const restanteMs = Math.max(0, Date.parse(p.proxima_mao_em) - agora);
    const seg = Math.ceil(restanteMs / 1000);
    document.querySelectorAll('[data-contagem-online]').forEach((el) => {
      el.textContent = seg + 's';
    });
    if (restanteMs <= 0 && (agora - Date.parse(p.proxima_mao_em)) >= 350) {
      dispararAvancoTempo(p.id);
    }
  }
}

function avisarMinhaVez(partida, eu) {
  const emJogo = partida.iniciada && !partida.aguardando_proxima_mao && partida.fase < 4;
  const minhaVez = !!eu && emJogo && partida.vez_jogador_id === eu.id && !onlineUI.segurando;
  if (minhaVez && !onlineUI.eraMinhaVez && !partida.fase_blind) {
    anunciar('SUA VEZ', null, 'vez', T.anuncioVez);
    tocarSom('sua-vez');
  }
  onlineUI.eraMinhaVez = minhaVez;
}

function destacarUltimaJogada() {
  const el = $id('mesa-ultima');
  if (!el) return;
  const txt = el.textContent;
  if (onlineUI.ultimaTxt !== null && txt && txt !== onlineUI.ultimaTxt) {
    el.classList.remove('nova');
    void el.offsetWidth;
    el.classList.add('nova');
  }
  onlineUI.ultimaTxt = txt;
}

// ----- Registro do modo 'online' no contrato compartilhado de mesa/modos.js -----
registrarModo('online', {
  prepararCena,

  visaoCongelada() {
    if (!onlineUI.segurando) return null;
    return onlineUI.congelado || { jogadores: null, pote: null };
  },

  faseExibida,

  textoStatus() {
    return onlineUI.segurando ? 'Mostrando as cartas…' : null;
  },

  desenharBoard(partida) {
    desenharBoardInterno(partida);
  },

  htmlCartasAssento(jogador, partida) {
    if (!partida.iniciada) return '';
    const souEu = jogador.id === estado.meuJogadorId;
    const segurando = onlineUI.segurando;
    const vis = (!segurando && Array.isArray(jogador.cartas_visiveis)) ? jogador.cartas_visiveis : [];
    const temVis = !!(vis[0] || vis[1]);

    // Minhas cartas (e o nome da minha mão) já ficam em destaque grande na barra de baixo:
    // evita crescer o assento inferior e sobrepor o centro da mesa em telas pequenas.
    if (souEu) return '';

    const melhores = (partida.aguardando_proxima_mao && !segurando) ? melhoresDoResultado(partida) : {};
    let html = '';
    if (temVis) {
      html += '<div class="l-cartas reveladas">';
      for (let i = 0; i < 2; i++) {
        const c = parseCartaLocal(vis[i]);
        if (c) {
          html += htmlCartaMini(c.raw, 'frente-mini' + (melhores[c.raw] ? ' destaque' : ''));
        } else if (jogador.tem_cartas) {
          html += htmlVersoMini();
        }
      }
      html += '</div>';
    } else if (jogador.tem_cartas && !jogador.desistiu && (!partida.aguardando_proxima_mao || segurando)) {
      html += '<div class="l-cartas fechadas">' + htmlVersoMini() + htmlVersoMini() + '</div>';
    }

    if (jogador.mao_nome && partida.aguardando_proxima_mao && !segurando) {
      html += '<div class="l-mao-nome">' + escapar(jogador.mao_nome) + '</div>';
    }
    return html;
  },

  ehVencedorAssento(jogador, partida) {
    if (!partida.aguardando_proxima_mao || onlineUI.segurando) return false;
    return !!vencedoresDoResultado(partida)[jogador.id];
  },

  premioVencedorAssento(jogador, partida) {
    if (!partida.aguardando_proxima_mao || onlineUI.segurando) return 0;
    return premiosDoResultado(partida)[jogador.id] || 0;
  },

  desenharFaixa(partida, jogadores, { eu }) {
    // Esconde faixa do presencial
    $id('faixa-fase').hidden = true;

    const faixa = $id('faixa-online');
    if (!faixa) return;

    const emEspera = !partida.iniciada || partida.aguardando_proxima_mao;
    if (!emEspera || onlineUI.segurando) {
      faixa.hidden = true;
      faixa.innerHTML = '';
      onlineUI.faixaChave = '';
      return;
    }

    const comFichas = jogadores.filter((j) => j.saldo > 0);
    const confirmados = comFichas.filter((j) => j.confirmado);
    const fimTorneio = partida.iniciada && comFichas.length < 2;
    const res = partida.ultimo_resultado;

    // Monta resumo do resultado da mão anterior (showdown ou desistência)
    let resHtml = '';
    if (res && partida.aguardando_proxima_mao) {
      if (res.tipo === 'showdown' && Array.isArray(res.potes)) {
        resHtml = res.potes.map((p) => {
          const vs = (p.vencedores || []).map((v) => (
            '<span class="res-nome">' + escapar(nomeDe(v.nome)) + '</span>'
            + ' <span class="res-valor">+' + Number(v.valor).toLocaleString('pt-BR') + '</span>'
            + (v.mao_nome ? ' <span class="res-mao">' + escapar(v.mao_nome) + '</span>' : '')
          )).join(' · ');
          const pref = res.potes.length > 1 ? '<span class="res-pote">' + escapar(p.nome) + ':</span> ' : '';
          return '<div class="res-linha">🏆 ' + pref + vs + '</div>';
        }).join('');
      } else if (res.tipo === 'desistencia' && res.vencedor_nome) {
        resHtml = '<div class="res-linha">🏆 <span class="res-nome">' + escapar(nomeDe(res.vencedor_nome)) + '</span>'
          + ' <span class="res-valor">+' + Number(res.valor).toLocaleString('pt-BR') + '</span>'
          + ' <span class="res-mao">Todos desistiram</span></div>';
      }
    }

    const restanteSeg = partida.proxima_mao_em
      ? Math.max(0, Math.ceil((Date.parse(partida.proxima_mao_em) - (Date.now() + estado.relogio.offset)) / 1000))
      : null;

    const faixaChave = [
      fimTorneio ? 'F' : 'E',
      partida.iniciada ? 'I' : 'L',
      comFichas.length,
      confirmados.length,
      eu ? (eu.id + ':' + (eu.saldo > 0 ? '1' : '0') + ':' + (eu.confirmado ? '1' : '0')) : 'spec',
      restanteSeg !== null ? 'T' : 'N',
      resHtml
    ].join('|');

    if (faixaChave === onlineUI.faixaChave && !faixa.hidden) {
      if (restanteSeg !== null) {
        faixa.querySelectorAll('[data-contagem-online]').forEach((el) => { el.textContent = restanteSeg + 's'; });
      }
      return;
    }
    onlineUI.faixaChave = faixaChave;

    faixa.classList.toggle('campeao', fimTorneio);

    // 1) Fim da partida (Campeão!)
    if (fimTorneio) {
      const chaveCamp = partida.id + ':' + partida.mao;
      if (onlineUI.campeaoSomChave !== chaveCamp) {
        onlineUI.campeaoSomChave = chaveCamp;
        tocarSom('campeao');
      }
      const camp = comFichas[0] ? nomeDe(comFichas[0].nome) : (res && res.campeao ? nomeDe(res.campeao) : '—');
      faixa.innerHTML = `
        <div class="faixa-online-res">🏆 Campeão: ${escapar(camp)}!</div>
        ${resHtml ? '<div class="faixa-online-sub">' + resHtml + '</div>' : ''}
        <div class="faixa-online-acoes">
          ${eu && jogadores.length >= 2 ? '<button class="positivo" onclick="revancheOnline()">Jogar revanche</button>' : ''}
          <button class="secundario" onclick="voltarParaSalas()">Voltar às salas</button>
        </div>
      `;
      faixa.hidden = false;
      return;
    }

    // 2) Lobby antes da 1ª mão OU pausa de 30s entre mãos
    let sub = '';
    if (comFichas.length < 2) {
      sub = 'Aguardando pelo menos <strong>2 jogadores</strong> entrarem na sala…';
    } else if (restanteSeg !== null) {
      sub = '<strong>' + confirmados.length + ' de ' + comFichas.length + ' prontos</strong>'
        + ' · inicia em <strong data-contagem-online>' + restanteSeg + 's</strong>';
    } else {
      sub = '<strong>' + confirmados.length + ' de ' + comFichas.length + ' prontos</strong>'
        + ' · precisa de <strong>2 jogadores</strong> para começar';
    }

    let acaoHtml = '';
    if (eu && eu.saldo > 0 && comFichas.length >= 2) {
      if (eu.confirmado) {
        acaoHtml = '<div class="faixa-online-acoes"><button type="button" class="confirmado" disabled>✓ Confirmado'
          + (restanteSeg !== null ? ' · <span data-contagem-online>' + restanteSeg + 's</span>' : ' · aguardando…')
          + '</button></div>';
      } else {
        const rot = partida.iniciada ? 'Entrar na próxima mão' : 'Estou pronto';
        acaoHtml = '<div class="faixa-online-acoes"><button type="button" class="positivo" onclick="confirmarMao()">'
          + rot + (restanteSeg !== null ? ' (<span data-contagem-online>' + restanteSeg + 's</span>)' : '')
          + '</button></div>';
      }
    } else if (eu && eu.saldo <= 0) {
      sub = 'Você ficou <strong>sem fichas</strong> · assistindo a mesa como espectador';
    }

    faixa.innerHTML = (resHtml ? '<div class="faixa-online-res">' + resHtml + '</div>' : '')
      + '<div class="faixa-online-sub">' + sub + '</div>'
      + acaoHtml;
    faixa.hidden = false;
  },

  desenharCriador(partida, _jogadores, { eu }) {
    // Sem líder durante a partida online!
    $id('btn-criador').hidden = true;
    $id('btn-iniciar-rapido').hidden = true;
    $id('painel-criador').hidden = true;

    const btnSair = $id('btn-sair-mesa');
    btnSair.hidden = !eu || estado.modoDev;
    const emMaoAtiva = partida.iniciada && !partida.aguardando_proxima_mao && eu && !eu.desistiu && eu.saldo > 0;
    btnSair.disabled = !!emMaoAtiva;
    btnSair.title = emMaoAtiva ? 'Aguarde o fim da mão ou desista para sair' : 'Sair da mesa';
  },

  aoNovaMao() {
    animarEmbaralhar();
  },

  aoAtualizarMesa(partida, _jogadores, { eu }) {
    sincronizarMinhasCartas(partida, eu);
    desenharMinhaMao(partida, eu);
    avisarMinhaVez(partida, eu);
    destacarUltimaJogada();
    animarPoteParaVencedor(partida);
    tickOnline();
  },

  aoSairDaMesa() {
    const boardEl = $id('board');
    if (boardEl && boardEl.classList.contains('online')) {
      boardEl.classList.remove('online');
      boardEl.querySelector('.slots').innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    }
    resetarOnlineUI();
  }
});
