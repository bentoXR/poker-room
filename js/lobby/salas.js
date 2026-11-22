// Lista de salas, criação de sala e entrada na mesa (compartilhado entre modos)
import { banco } from '../core/supabase.js?v=97';
import { estado, ICONE_COROA, contaParams, ehContaDev, invalidarListaSalas } from '../core/estado.js?v=97';
import { guardarMeuJogador, lerDevSala, esquecerDevSala, esquecerPartida } from '../core/storage.js?v=97';
import { $id, escapar, aviso, mostrar, mostrarErro, limparErro } from '../core/ui.js?v=97';
import { desligarTempoReal } from '../core/realtime.js?v=97';
import { tratarErroConta } from './auth.js?v=97';
import { atualizarCabecalhoPerfil, sincronizarMeuPerfil } from './perfil.js?v=97';
import { registrarRealCriacao, obterConfigOnline, aplicarPadraoCriarSala } from './config-sala.js?v=97';
import { abrirMesa } from '../mesa/mesa.js?v=97';
import { t, termo } from '../core/i18n.js?v=97';

let hooksSalas = {
  cancelarCriacaoDev: () => {},
  apagarSalaDev: () => Promise.resolve(false)
};

export function registrarHooksSalas(hooks) {
  hooksSalas = Object.assign(hooksSalas, hooks);
}

export function atualizarVisibilidadeDev() {
  const btnDev = $id('btn-sala-dev');
  if (btnDev) btnDev.hidden = !ehContaDev();
}

function limparContextoDev() {
  hooksSalas.cancelarCriacaoDev();
  estado.modoDev = false;
  if (lerDevSala()) hooksSalas.apagarSalaDev();
  esquecerDevSala();
}

export function abrirSalas() {
  pararSalas();
  hooksSalas.cancelarCriacaoDev();
  atualizarCabecalhoPerfil();
  atualizarVisibilidadeDev();
  sincronizarMeuPerfil();
  limparErro('erro-salas');
  mostrar('tela-salas');
  if (!estado.htmlSalas) {
    $id('lista-salas').innerHTML = '<div class="vazio"><p>' + t('salas.buscando') + '</p></div>';
  }
  carregarSalas();
  estado.temporizadorSalas = setInterval(carregarSalas, 4000);
}

export function pararSalas() {
  if (estado.temporizadorSalas) {
    clearInterval(estado.temporizadorSalas);
    estado.temporizadorSalas = null;
  }
}

export async function carregarSalas() {
  if (!estado.minhaConta || document.hidden) return;
  const minha = ++estado.versaoSalas;

  let resp;
  try {
    resp = await banco.rpc('listar_salas', contaParams());
  } catch (erro) {
    resp = { error: { message: 'sem conexão' } };
  }

  if (minha !== estado.versaoSalas || !$id('tela-salas').classList.contains('ativa')) return;

  if (resp.error) {
    if (tratarErroConta(resp.error)) return;
    mostrarErro('erro-salas', 'Não consegui carregar as salas. Confira a internet.');
    return;
  }
  limparErro('erro-salas');
  estado.salasAtuais = resp.data || [];
  desenharSalas();
}

export function desenharSalas() {
  atualizarVisibilidadeDev();
  let html;
  if (estado.salasAtuais.length === 0) {
    const textoVazio = ehContaDev()
      ? t('salas.vazio_dev')
      : t('salas.vazio_txt');
    html = `
      <div class="vazio">
        <div class="vazio-naipes" aria-hidden="true"><span>♠</span><span class="r">♥</span><span>♣</span><span class="r">♦</span></div>
        <strong>${t('salas.vazio_titulo')}</strong>
        <p>${textoVazio}</p>
      </div>
    `;
  } else {
    html = estado.salasAtuais.map((s) => {
      const ehOnline = s.modo === 'online';
      const ehBlackjack = s.modo === 'blackjack';
      const statusChip = s.iniciada
        ? '<span class="meta-chip vivo"><i></i><b>' + t(ehBlackjack ? 'mesa.rodada' : 'mesa.mao', { n: s.mao }) + '</b></span>'
        : '<span class="meta-chip">' + t('salas.aguardando') + '</span>';
      const jogTxt = ehOnline
        ? '<b>' + s.n_jogadores + '/9</b>'
        : '<b>' + s.n_jogadores + '</b> ' + t(s.n_jogadores === 1 ? 'salas.jogador' : 'salas.jogadores');
      const botsChip = (ehOnline && s.com_bots)
        ? '<span class="meta-chip">' + t('salas.bots_ativados') + '</span>'
        : '';
      const blindsTxt = ehBlackjack
        ? t('mesa.min', { v: '<b>' + s.small_blind + '</b>' })
        : termo('blinds') + ' <b>' + s.small_blind + '/' + s.big_blind + '</b>';
      const tempoChip = (ehOnline || ehBlackjack)
        ? '<span class="meta-chip">' + (Number(s.tempo_turno) === 0 ? '<b>' + t('salas.sem_limite') + '</b>' : t('salas.turno', { s: (s.tempo_turno || 30) })) + '</span>'
        : '';
      const subirChip = (ehOnline && s.subir_blinds_min > 0)
        ? '<span class="meta-chip">↑ <b>' + s.subir_blinds_min + 'm</b></span>'
        : '';
      const modoTag = ehBlackjack
        ? '<span class="tag modo-blackjack">' + t('salas.modo_blackjack') + '</span>'
        : (ehOnline
          ? '<span class="tag modo-online">' + t('salas.modo_online') + '</span>'
          : '<span class="tag modo-presencial">' + t('salas.modo_presencial') + '</span>');
      const tag = s.sou_jogador ? '<span class="tag vez">' + t('salas.continuar') + '</span>' : '';
      return `
        <button type="button" class="sala ${ehBlackjack ? 'eh-blackjack' : (ehOnline ? 'eh-online' : 'eh-presencial')} ${s.sou_jogador ? 'minha' : ''}" onclick="abrirSala('${s.id}')">
          <div class="sala-info">
            <div class="sala-topo-linha">
              <div class="sala-nome">${!ehOnline && s.sou_criador ? ICONE_COROA : ''}${escapar(s.nome)}</div>
              <div class="sala-badges">${modoTag}${tag}</div>
            </div>
            <div class="sala-meta">
              ${statusChip}
              <span class="meta-chip">${jogTxt}</span>
              ${botsChip}
              <span class="meta-chip">${blindsTxt}</span>
              ${tempoChip}${subirChip}
            </div>
          </div>
          <svg class="ic sala-seta" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        </button>
      `;
    }).join('');
  }
  if (html === estado.htmlSalas) return;
  estado.htmlSalas = html;
  $id('lista-salas').innerHTML = html;
}

export async function abrirSala(id) {
  if (estado.abrindoSala || estado.criandoSala) return;
  estado.abrindoSala = true;
  limparContextoDev();
  limparErro('erro-salas');

  try {
    const sala = estado.salasAtuais.find((x) => x.id === id);

    if (sala && sala.sou_jogador) {
      pararSalas();
      const entrou = await conectarNaSala({ id: sala.id, modo: sala.modo, dev: false }, 'erro-salas');
      if (!entrou && $id('tela-salas').classList.contains('ativa')) {
        carregarSalas();
        estado.temporizadorSalas = setInterval(carregarSalas, 4000);
      }
      return;
    }

    const resp = await banco.from('partidas').select('*').eq('id', id).maybeSingle();
    if (resp.error) {
      mostrarErro('erro-salas', 'Não consegui abrir a sala. Confira a internet.');
      return;
    }
    if (!resp.data || resp.data.encerrada || resp.data.dev) {
      aviso('Essa sala não existe mais.');
      carregarSalas();
      return;
    }
    pararSalas();
    const entrou = await conectarNaSala(resp.data, 'erro-salas');
    if (!entrou && $id('tela-salas').classList.contains('ativa')) {
      carregarSalas();
      estado.temporizadorSalas = setInterval(carregarSalas, 4000);
    }
  } finally {
    estado.abrindoSala = false;
  }
}

export function abrirCriar() {
  limparContextoDev();
  desligarTempoReal();
  limparErro('erro-criar');
  aplicarPadraoCriarSala();
  $id('criar-nome-sala').value = t('criar.padrao_nome', { nome: estado.minhaConta.nome });
  mostrar('tela-criar');
}

export async function criarSala() {
  if (estado.criandoSala || estado.abrindoSala) return;
  limparContextoDev();
  desligarTempoReal();
  limparErro('erro-criar');

  const nomeSala = ($id('criar-nome-sala').value || '').trim().replace(/\s+/g, ' ');
  const saldo = parseInt($id('campo-saldo').value);
  const small = parseInt($id('campo-small').value);
  const big = parseInt($id('campo-big').value);
  const cfg = obterConfigOnline('');

  if (cfg.modo === 'blackjack') {
    if (!(saldo > 0) || !(cfg.apostaMin > 0)) {
      mostrarErro('erro-criar', 'Saldo inicial e aposta mínima precisam ser maiores que zero.');
      return;
    }
    if (cfg.apostaMin > saldo) {
      mostrarErro('erro-criar', 'A aposta mínima não pode ser maior que as fichas iniciais.');
      return;
    }
  } else {
    if (!(saldo > 0) || !(small > 0) || !(big > 0)) {
      mostrarErro('erro-criar', 'Saldo e blinds precisam ser números maiores que zero.');
      return;
    }
    if (big <= small) {
      mostrarErro('erro-criar', 'O big blind precisa ser maior que o small blind.');
      return;
    }
  }

  estado.criandoSala = true;
  esquecerPartida();
  estado.partidaAtual = null;
  estado.meuJogadorId = null;
  estado.meuSegredo = null;
  estado.jogadoresAtuais = [];
  estado.ultimoEstado = null;
  invalidarListaSalas();

  const botao = $id('botao-criar');
  botao.disabled = true;
  botao.textContent = t('criar.criando');

  try {
    let resp;
    try {
      resp = cfg.modo === 'blackjack'
        ? await banco.rpc('criar_sala_blackjack', Object.assign({}, contaParams(), {
            p_saldo: saldo,
            p_aposta_min: cfg.apostaMin,
            p_tempo_turno: cfg.tempoTurno,
            p_nome: nomeSala || null
          }))
        : (cfg.modo === 'online'
          ? await banco.rpc('criar_sala_online', Object.assign({}, contaParams(), {
              p_saldo: saldo,
              p_small: small,
              p_big: big,
              p_tempo_turno: cfg.tempoTurno,
              p_subir_blinds_min: cfg.subirBlindsMin,
              p_nome: nomeSala || null,
              p_com_bots: !!cfg.comBots
            }))
          : await banco.rpc('criar_sala', Object.assign({}, contaParams(), {
              p_saldo: saldo,
              p_small: small,
              p_big: big,
              p_nome: nomeSala || null
            })));
    } catch (erro) {
      resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
    }

    if (resp.error) {
      if (!tratarErroConta(resp.error)) mostrarErro('erro-criar', resp.error.message);
    } else if (resp.data && resp.data.partida_id) {
      const dados = resp.data;
      pararSalas();
      limparContextoDev();
      guardarMeuJogador(estado.minhaConta.id, dados.partida_id, dados.jogador_id, dados.segredo);
      await registrarRealCriacao('', dados.partida_id, saldo, dados.jogador_id, dados.segredo);
      await abrirMesa({ id: dados.partida_id, modo: cfg.modo, dev: false });
    }
  } finally {
    estado.criandoSala = false;
    botao.disabled = false;
    botao.textContent = t('criar.botao');
  }
}

export async function conectarNaSala(partida, idDoErro) {
  limparContextoDev();
  if (!partida || !partida.id || partida.dev) {
    mostrarErro(idDoErro, 'Essa sala não está disponível.');
    return false;
  }
  let resp;
  try {
    resp = await banco.rpc('entrar_sala', Object.assign({}, contaParams(), { p_partida_id: partida.id }));
  } catch (erro) {
    resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
  }

  if (resp.error) {
    if (!tratarErroConta(resp.error)) mostrarErro(idDoErro, resp.error.message);
    return false;
  }

  const reconectou = !!resp.data.reconectado;
  guardarMeuJogador(estado.minhaConta.id, partida.id, resp.data.jogador_id, resp.data.segredo);
  await abrirMesa(partida);

  if (reconectou) {
    const eu = estado.jogadoresAtuais.find((j) => j.id === estado.meuJogadorId);
    if (eu) aviso('Bem-vindo de volta, ' + eu.nome + '! Você tem ' + eu.saldo + ' fichas.');
  }
  return true;
}

export async function entrarComoJogador() {
  limparErro('erro-escolha');
  const botao = $id('botao-jogar');
  botao.disabled = true;
  botao.textContent = 'Entrando...';
  await conectarNaSala(estado.partidaAtual, 'erro-escolha');
  botao.disabled = false;
  botao.textContent = 'Entrar como jogador';
}

export function abrirJogarAgora() {
  if (!estado.minhaConta || estado.abrindoSala || estado.criandoSala) return;
  limparErro('erro-jogar-agora');
  const fundo = $id('fundo-jogar-agora');
  const folha = $id('folha-jogar-agora');
  if (fundo) fundo.hidden = false;
  if (folha) folha.hidden = false;
}

export function fecharJogarAgora() {
  const fundo = $id('fundo-jogar-agora');
  const folha = $id('folha-jogar-agora');
  if (fundo) fundo.hidden = true;
  if (folha) folha.hidden = true;
}

async function executarJogarAgora(rpcNome, btnId) {
  if (!estado.minhaConta || estado.abrindoSala || estado.criandoSala) return;
  limparErro('erro-jogar-agora');
  estado.abrindoSala = true;
  const b1 = $id('btn-ja-online');
  const b2 = $id('btn-ja-solo');
  if (b1) b1.disabled = true;
  if (b2) b2.disabled = true;

  try {
    let resp;
    try {
      resp = await banco.rpc(rpcNome, contaParams());
    } catch (erro) {
      resp = { error: { message: 'Não consegui falar com o servidor. Confira a internet.' } };
    }
    if (resp.error) {
      if (!tratarErroConta(resp.error)) mostrarErro('erro-jogar-agora', resp.error.message);
      return;
    }
    const dados = resp.data;
    if (!dados || !dados.partida_id) {
      mostrarErro('erro-jogar-agora', 'Não foi possível entrar na partida.');
      return;
    }
    fecharJogarAgora();
    pararSalas();
    limparContextoDev();
    esquecerPartida();
    guardarMeuJogador(estado.minhaConta.id, dados.partida_id, dados.jogador_id, dados.segredo);
    await abrirMesa({ id: dados.partida_id, modo: 'online', dev: false });
  } finally {
    estado.abrindoSala = false;
    if (b1) b1.disabled = false;
    if (b2) b2.disabled = false;
  }
}

export function jogarAgoraOnline() {
  return executarJogarAgora('jogar_agora_online', 'btn-ja-online');
}

export function jogarAgoraSolo() {
  return executarJogarAgora('criar_sala_solo_bots', 'btn-ja-solo');
}
