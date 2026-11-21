// Modo Online (baralho virtual): cartas privadas com flip 3D, board animado, timer e confirmação 30s
import { banco } from '../../core/supabase.js?v=2';
import { estado, nomeDe } from '../../core/estado.js?v=2';
import { $id, escapar, aviso, fecharFolhas, limparErro } from '../../core/ui.js?v=2';
import { lerDevSala } from '../../core/storage.js?v=2';
import { registrarModo } from '../../mesa/modos.js?v=2';
import { executar } from '../../mesa/apostas.js?v=2';

const NAIPES_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };

// Estado local efêmero das cartas do jogador (escondidas por padrão a cada mão!)
const onlineUI = {
  maoCarregada: null,
  jogadorCarregado: null,
  minhasCartas: null,       // ['As', 'Kh']
  viradas: [false, false],  // estado do flip 3D de cada carta
  buscandoCartas: false,
  htmlBoardVisto: '',
  htmlMaoVisto: '',
  avancandoTempo: false,
  ultimoAvancoEm: 0,
  mostrouDica: false
};

export function resetarOnlineUI() {
  onlineUI.maoCarregada = null;
  onlineUI.jogadorCarregado = null;
  onlineUI.minhasCartas = null;
  onlineUI.viradas = [false, false];
  onlineUI.buscandoCartas = false;
  onlineUI.htmlBoardVisto = '';
  onlineUI.htmlMaoVisto = '';
  const wrap = $id('minha-mao-wrap');
  if (wrap) { wrap.innerHTML = ''; wrap.hidden = true; }
  const faixa = $id('faixa-online');
  if (faixa) { faixa.innerHTML = ''; faixa.hidden = true; }
  const timerWrap = $id('timer-turno-wrap');
  if (timerWrap) timerWrap.hidden = true;
}

function parseCarta(c) {
  if (!c || c.length < 2) return null;
  const r = c[0] === 'T' ? '10' : c[0];
  const s = c[1];
  const sym = NAIPES_SYM[s] || '';
  const verm = s === 'h' || s === 'd';
  return { raw: c, val: r, sym, verm };
}

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
      // Se ainda estamos no mesmo jogador e mesma mão, guarda e começa virada para baixo!
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

export function virarMinhaCarta(indice) {
  if (!onlineUI.minhasCartas || indice < 0 || indice > 1) return;
  onlineUI.viradas[indice] = !onlineUI.viradas[indice];
  onlineUI.mostrouDica = true;
  try { if (navigator.vibrate) navigator.vibrate(10); } catch (erro) {}
  const btn = document.querySelector('#minha-mao-wrap .carta-3d[data-idx="' + indice + '"]');
  if (btn) btn.classList.toggle('virada', onlineUI.viradas[indice]);
  const dica = document.querySelector('#minha-mao-wrap .minha-mao-dica');
  if (dica) dica.textContent = (onlineUI.viradas[0] || onlineUI.viradas[1]) ? 'Toque novamente para esconder' : 'Toque na carta para espiar';
}

function desenharMinhaMao(partida, eu) {
  const wrap = $id('minha-mao-wrap');
  if (!wrap) return;
  if (!partida || partida.modo !== 'online' || !eu || !onlineUI.minhasCartas || !eu.tem_cartas) {
    wrap.hidden = true;
    if (onlineUI.htmlMaoVisto) { onlineUI.htmlMaoVisto = ''; wrap.innerHTML = ''; }
    return;
  }

  const emPausa = !!partida.aguardando_proxima_mao;
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
    Object.keys(melhores).sort().join(',')
  ].join('|');

  if (chave === onlineUI.htmlMaoVisto) {
    wrap.hidden = false;
    return;
  }
  onlineUI.htmlMaoVisto = chave;

  const abertas = [
    onlineUI.viradas[0] || c1Vis,
    onlineUI.viradas[1] || c2Vis
  ];

  const cartasHtml = onlineUI.minhasCartas.map((raw, idx) => {
    const c = parseCarta(raw);
    if (!c) return '';
    const virada = abertas[idx];
    const dest = !!melhores[raw];
    return `
      <div class="carta-3d-slot">
        <button type="button" class="carta-3d${virada ? ' virada' : ''}${dest ? ' destaque' : ''}"
                data-idx="${idx}" onclick="virarMinhaCarta(${idx})"
                aria-label="Carta ${idx + 1}: toque para virar">
          <span class="carta-face verso"></span>
          <span class="carta-face frente${c.verm ? ' verm' : ''}">
            <span class="cf-canto"><span>${c.val}</span><span>${c.sym}</span></span>
            <span class="cf-centro">${c.sym}</span>
          </span>
        </button>
      </div>
    `;
  }).join('');

  let revelarHtml = '';
  if (podeRevelar) {
    const p1 = parseCarta(onlineUI.minhasCartas[0]);
    const p2 = parseCarta(onlineUI.minhasCartas[1]);
    revelarHtml = '<div class="minha-mao-revelar">'
      + (!c1Vis ? '<button type="button" class="secundario" onclick="mostrarCartasOnline(\'1\')">Mostrar ' + (p1 ? p1.val + p1.sym : '1ª') + '</button>' : '')
      + (!c2Vis ? '<button type="button" class="secundario" onclick="mostrarCartasOnline(\'2\')">Mostrar ' + (p2 ? p2.val + p2.sym : '2ª') + '</button>' : '')
      + ((!c1Vis && !c2Vis) ? '<button type="button" class="positivo" onclick="mostrarCartasOnline(\'ambas\')">Mostrar as duas</button>' : '')
      + '</div>';
  }

  const dica = podeRevelar
    ? 'Quer mostrar seu blefe ou sua mão para a mesa?'
    : (eu.mao_nome && emPausa
        ? 'Sua mão: ' + escapar(eu.mao_nome)
        : (abertas[0] || abertas[1] ? 'Toque na carta para esconder' : 'Toque na carta para espiar'));

  wrap.innerHTML = '<div class="minha-mao-cartas">' + cartasHtml + '</div>'
    + '<div class="minha-mao-dica">' + dica + '</div>'
    + revelarHtml;
  wrap.hidden = false;
}

// ----- Ações RPC do modo Online -----
export function confirmarMao() {
  return executar('confirmar_mao', {
    p_jogador: estado.meuJogadorId,
    p_segredo: estado.meuSegredo
  }, 'erro-barra');
}

export function mostrarCartasOnline(qual) {
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

  // 1) Timer de turno (contagem regressiva + barra de progresso)
  const emTurno = p.iniciada && !p.aguardando_proxima_mao && p.fase < 4 && !!p.vez_jogador_id && !!p.vez_desde;
  const timerWrap = $id('timer-turno-wrap');
  const timerFill = $id('timer-turno-fill');

  if (emTurno) {
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

    const minhaVez = p.vez_jogador_id === estado.meuJogadorId;
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
  } else if (timerWrap) {
    timerWrap.hidden = true;
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

// ----- Registro do modo 'online' no contrato compartilhado de mesa/modos.js -----
registrarModo('online', {
  desenharBoard(partida) {
    const boardEl = $id('board');
    boardEl.classList.add('online');
    const cartas = Array.isArray(partida.board) ? partida.board : [];
    const melhores = partida.aguardando_proxima_mao ? melhoresDoResultado(partida) : {};
    const chave = cartas.join(',') + '|' + Object.keys(melhores).sort().join(',');

    if (chave !== onlineUI.htmlBoardVisto) {
      const prevCount = onlineUI.htmlBoardVisto ? (onlineUI.htmlBoardVisto.split('|')[0].split(',').filter(Boolean).length) : 0;
      onlineUI.htmlBoardVisto = chave;
      let html = '';
      for (let k = 0; k < 5; k++) {
        const raw = cartas[k];
        if (!raw) {
          html += '<div class="carta-slot-vazio"></div>';
        } else {
          const c = parseCarta(raw);
          const novaIdx = k >= prevCount ? (k - prevCount) : 0;
          const atraso = k >= prevCount ? (novaIdx * 95) + 'ms' : '0ms';
          const dest = !!melhores[raw];
          html += `
            <div class="carta-board${c.verm ? ' verm' : ''}${dest ? ' destaque' : ''}" style="--atraso:${atraso}">
              <div class="carta-corpo">
                <span class="c-val">${c.val}</span>
                <span class="c-naipe">${c.sym}</span>
              </div>
            </div>
          `;
        }
      }
      boardEl.querySelector('.slots').innerHTML = html;
    }

    boardEl.querySelectorAll('.rotulos span').forEach((el) => {
      el.classList.toggle('atual', partida.iniciada && !partida.aguardando_proxima_mao && Number(el.dataset.f) === partida.fase);
    });
  },

  htmlCartasAssento(jogador, partida) {
    if (!partida.iniciada) return '';
    const souEu = jogador.id === estado.meuJogadorId;
    const vis = Array.isArray(jogador.cartas_visiveis) ? jogador.cartas_visiveis : [];
    const temVis = !!(vis[0] || vis[1]);

    // Minhas cartas (e o nome da minha mão) já ficam em destaque grande na barra de baixo:
    // evita crescer o assento inferior e sobrepor o centro da mesa em telas pequenas.
    if (souEu) return '';

    let html = '';
    if (temVis) {
      html += '<div class="l-cartas">';
      for (let i = 0; i < 2; i++) {
        const c = parseCarta(vis[i]);
        if (c) {
          html += '<span class="mini-carta frente' + (c.verm ? ' verm' : '') + '"><span class="mv">' + c.val + '</span><span class="mn">' + c.sym + '</span></span>';
        } else if (jogador.tem_cartas) {
          html += '<span class="mini-carta verso"></span>';
        }
      }
      html += '</div>';
    } else if (jogador.tem_cartas && !jogador.desistiu && !partida.aguardando_proxima_mao) {
      html += '<div class="l-cartas"><span class="mini-carta verso"></span><span class="mini-carta verso"></span></div>';
    }

    if (jogador.mao_nome && partida.aguardando_proxima_mao) {
      html += '<div class="l-mao-nome">' + escapar(jogador.mao_nome) + '</div>';
    }
    return html;
  },

  ehVencedorAssento(jogador, partida) {
    if (!partida.aguardando_proxima_mao) return false;
    return !!vencedoresDoResultado(partida)[jogador.id];
  },

  desenharFaixa(partida, jogadores, { eu }) {
    // Esconde faixa do presencial
    $id('faixa-fase').hidden = true;

    const faixa = $id('faixa-online');
    if (!faixa) return;

    const emEspera = !partida.iniciada || partida.aguardando_proxima_mao;
    if (!emEspera) {
      faixa.hidden = true;
      faixa.innerHTML = '';
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
            escapar(nomeDe(v.nome)) + ' +' + v.valor
            + (v.mao_nome ? ' <span class="res-mao">(' + escapar(v.mao_nome) + ')</span>' : '')
          )).join(' · ');
          const pref = res.potes.length > 1 ? escapar(p.nome) + ': ' : '';
          return '<div class="res-linha">🏆 ' + pref + vs + '</div>';
        }).join('');
      } else if (res.tipo === 'desistencia' && res.vencedor_nome) {
        resHtml = '<div class="res-linha">🏆 ' + escapar(nomeDe(res.vencedor_nome))
          + ' ganhou +' + res.valor + ' <span class="res-mao">(todos desistiram)</span></div>';
      }
    }

    faixa.classList.toggle('campeao', fimTorneio);

    // 1) Fim da partida (Campeão!)
    if (fimTorneio) {
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
    const restanteSeg = partida.proxima_mao_em
      ? Math.max(0, Math.ceil((Date.parse(partida.proxima_mao_em) - (Date.now() + estado.relogio.offset)) / 1000))
      : null;

    let sub = '';
    if (comFichas.length < 2) {
      sub = 'Aguardando pelo menos 2 jogadores entrarem na sala…';
    } else if (restanteSeg !== null) {
      sub = 'Confirmados: ' + confirmados.length + ' de ' + comFichas.length
        + ' · inicia em <strong data-contagem-online>' + restanteSeg + 's</strong> (ou quando todos confirmarem)';
    } else {
      sub = 'Confirmados: ' + confirmados.length + ' de ' + comFichas.length
        + ' · precisa de pelo menos 2 para começar';
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
      sub = 'Você ficou sem fichas · assistindo a mesa como espectador';
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

  aoAtualizarMesa(partida, _jogadores, { eu }) {
    sincronizarMinhasCartas(partida, eu);
    desenharMinhaMao(partida, eu);
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
