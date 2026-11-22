// Ponto de entrada da aplicação: conecta os módulos, expõe ações para o HTML e inicia o app
import { banco } from './core/supabase.js?v=104';
import { estado, ehContaDev } from './core/estado.js?v=104';
import { lerNome, lerPartidaSalva, esquecerPartida, lerDevSala, esquecerDevSala } from './core/storage.js?v=104';
import {
  $id, TELAS_INTERNAS, mostrar, prepararCampoSenha, alternarSenha,
  algumaFolhaAberta, fecharFolhas, registrarHookSairSalas
} from './core/ui.js?v=104';
import { iniciarTema, escolherTema, alternarTema } from './core/tema.js?v=104';
import { iniciarSom, alternarSom } from './core/som.js?v=104';
import { canalAtivo, ligarTempoReal, enviarSinal } from './core/realtime.js?v=104';
import { escolherIdioma, alternarTermosTraduzidos, aplicarIdiomaDOM, registrarHookIdioma } from './core/i18n.js?v=104';

import {
  registrarHooksAuth, escolherModoLogin, enviarAuth, fazerLogin, criarConta, sairDaConta
} from './lobby/auth.js?v=104';
import {
  abrirPerfil, fecharPerfil, perfilAberto, acionarEscolhaFoto, aoEscolherFotoPerfil,
  removerFotoPerfil, salvarNomePerfil, alterarSenhaPerfil, encerrarOutrasSessoes, limparCachePerfil
} from './lobby/perfil.js?v=104';
import {
  registrarHooksSalas, atualizarVisibilidadeDev, abrirSalas, pararSalas, carregarSalas, desenharSalas, abrirSala, abrirCriar, criarSala, entrarComoJogador,
  abrirJogarAgora, fecharJogarAgora, jogarAgoraOnline, jogarAgoraSolo,
  fecharSenhaSala, confirmarSenhaSala
} from './lobby/salas.js?v=104';
import {
  escolherStack, escolherStackDev, alternarReal, definirReais,
  aoEditarConfig, aoEditarConfigDev, atualizarProfundidade, iniciarConfigSala,
  escolherModoSala, escolherTempoTurno, ciclarTempoTurno, escolherSubirBlinds, ciclarSubirBlinds,
  escolherQtdDev, escolherBotsDev, escolherNivelBotsDev,
  escolherBotsCriar, alternarBotsCriar, escolherPrivadaCriar, alternarPrivadaCriar,
  atualizarControlesCriar
} from './lobby/config-sala.js?v=104';

import {
  abrirMesa, buscarMesa, receberEstado, desenharMesa, iniciarRelogio, recalcularLayoutMesa,
  abrirMenuOnline, sairDaMesa, voltarParaSalas, encerrarSala, copiarConviteSala, registrarHooksMesa, registrarTickOnline, registrarTickBlackjack, limparDomMesa
} from './mesa/mesa.js?v=104';
import {
  agir, apostar, alternarAposta, ajustarAposta, apostaPote, apostaBB, apostaAllIn,
  alternarPreAcao, aoMoverSlider, aoDigitarAposta
} from './mesa/apostas.js?v=104';
import {
  abrirHistorico, abrirReais, abrirGuia, abrirDetalhesPotes, carregarValorReal, copiarAcertoMesa
} from './mesa/extras.js?v=104';
import {
  abrirChat, enviarChat, alternarReacoes, enviarReacao, receberMensagemChat, receberReacao,
  receberDigitando, escolherAbaChat, aoDigitarChat, enviarAtalhoChat, iniciarVotacao, enviarVoto
} from './mesa/chat.js?v=104';

// Modos registrados: Presencial (baralho físico) e Online (baralho virtual)
import {
  abrirCriador, aoDigitarSmallMesa, aoEditarBigMesa, salvarBlinds, abrirRodada,
  moverJogador, iniciarPartida, iniciarOuProximaMao, pagarBlind, usarStackFichas,
  adicionarFichas, removerJogador, resetarPartida, subirNivel
} from './modos/presencial/acoes.js?v=104';
import {
  abrirDistribuicao, fecharDistribuicao, alternarGanhador, alternarVencedorPote,
  alternarModoManualDist, aoEditarPremioManual, confirmarDistribuicao
} from './modos/presencial/distribuir.js?v=104';
import {
  registrarHooksDev, cancelarCriacaoDev, abrirSalaDev, criarSalaDev, controlarDev, trocarJogadorDev,
  proximoJogadorDev, autoSeguirVezDev, abrirPainelDev, desenharPainelDev, adicionarJogadorDev,
  devAcao, apagarSalaDev, excluirSalaDev
} from './modos/presencial/dev.js?v=104';
import {
  virarMinhaCarta, abrirMinhasCartas, alternarModoEspiar, ehModoEspiarSegurar,
  confirmarMao, alternarAutoPronto, alternarAusenteOnline, chamarRabbitHunt,
  mostrarCartasOnline, revancheOnline, comprarRebuyOnline, espectarOnline,
  confirmarTodosDev, tickOnline, resetarOnlineUI, trocarJogadorOnlineUI
} from './modos/online/online.js?v=104';
import {
  bjSomarFicha, bjLimparAposta, bjRepetirAposta, bjDobrarAposta, bjAllInAposta,
  bjConfirmarAposta, bjAgir, bjNovaRodada, bjRevanche, bjConfirmarTodosDev, tickBlackjack, tratarTeclaBlackjack
} from './modos/blackjack/blackjack.js?v=104';

// Lê eventual link direto de convite (?sala=<uuid>) sem sujar a barra de endereço
try {
  const params = new URLSearchParams(window.location.search);
  const salaParam = (params.get('sala') || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(salaParam)) {
    estado.salaConviteId = salaParam;
    params.delete('sala');
    const q = params.toString();
    window.history.replaceState(history.state, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
  }
} catch (erro) {}

// ----- Conexão entre módulos (sem ciclos) -----
registrarHookSairSalas(pararSalas);
registrarHooksSalas({ cancelarCriacaoDev, apagarSalaDev });
registrarHooksAuth({
  abrirSalas,
  pararSalas,
  onLogout: () => { cancelarCriacaoDev(); fecharPerfil(); limparCachePerfil(); limparDomMesa(); },
  onPosLogin: () => {
    if (estado.salaConviteId) {
      const idConvite = estado.salaConviteId;
      estado.salaConviteId = null;
      abrirSala(idConvite);
    }
  }
});
registrarHooksMesa({ abrirSalas, controlarDev, desenharPainelDev, apagarSalaDev, cancelarCriacaoDev, autoSeguirVezDev });
registrarTickOnline(tickOnline);
registrarTickBlackjack(tickBlackjack);
registrarHooksDev({
  abrirSalas,
  pararSalas,
  abrirMesa,
  buscarMesa,
  voltarParaSalas,
  onTrocarJogador: trocarJogadorOnlineUI,
  onRedesenhar: () => { if (estado.ultimoEstado) desenharMesa(estado.ultimoEstado); }
});

// ----- Inicialização ao abrir a página -----
async function iniciarApp() {
  atualizarVisibilidadeDev();
  if (lerDevSala() && !estado.modoDev) {
    if (ehContaDev()) apagarSalaDev();
    else esquecerDevSala();
  }
  if (!estado.minhaConta) {
    mostrar('tela-login');
    if (estado.salaConviteId) aviso('Entre na sua conta para abrir a sala convidada.');
    return;
  }

  if (estado.salaConviteId) {
    const idConvite = estado.salaConviteId;
    estado.salaConviteId = null;
    abrirSalas();
    await abrirSala(idConvite);
    return;
  }

  const id = lerPartidaSalva();
  if (!id) { abrirSalas(); return; }

  mostrar('tela-carregando');
  $id('carregando-texto').textContent = 'Voltando para a mesa...';
  $id('carregando-acoes').hidden = true;

  let resp;
  try {
    resp = await banco.rpc('estado_mesa', { p_partida: id });
  } catch (erro) {
    resp = { error: erro };
  }

  if (resp.error) {
    $id('carregando-texto').textContent =
      'Não consegui falar com o servidor. Confira a internet e tente de novo.';
    $id('carregando-acoes').hidden = false;
    return;
  }

  if (!resp.data || !resp.data.partida || resp.data.partida.encerrada || resp.data.partida.dev) {
    esquecerPartida();
    abrirSalas();
    return;
  }

  await abrirMesa(resp.data.partida, resp.data);
}

// ----- Ponte controlada para handlers declarados no HTML -----
Object.assign(window, {
  // Auth, perfil e lobby
  alternarSenha, escolherModoLogin, enviarAuth, fazerLogin, criarConta, sairDaConta,
  abrirPerfil, fecharPerfil, acionarEscolhaFoto, aoEscolherFotoPerfil,
  removerFotoPerfil, salvarNomePerfil, alterarSenhaPerfil, encerrarOutrasSessoes,
  escolherTema, alternarTema, alternarSom,
  escolherIdioma, alternarTermosTraduzidos,
  abrirSalas, abrirCriar, criarSala, abrirSala, entrarComoJogador,
  abrirJogarAgora, fecharJogarAgora, jogarAgoraOnline, jogarAgoraSolo,
  fecharSenhaSala, confirmarSenhaSala,
  escolherStack, escolherStackDev, alternarReal, definirReais,
  aoEditarConfig, aoEditarConfigDev, atualizarProfundidade,
  escolherModoSala, escolherTempoTurno, ciclarTempoTurno, escolherSubirBlinds, ciclarSubirBlinds,
  escolherQtdDev, escolherBotsDev, escolherNivelBotsDev,
  escolherBotsCriar, alternarBotsCriar, escolherPrivadaCriar, alternarPrivadaCriar,
  esquecerPartida, iniciarApp,

  // Mesa compartilhada e apostas
  voltarParaSalas, sairDaMesa, encerrarSala, copiarConviteSala, abrirMenuOnline,
  abrirHistorico, abrirChat, enviarChat, alternarReacoes, enviarReacao,
  escolherAbaChat, aoDigitarChat, enviarAtalhoChat, iniciarVotacao, enviarVoto,
  abrirReais, copiarAcertoMesa, abrirGuia, abrirDetalhesPotes, fecharFolhas,
  agir, apostar, alternarAposta, ajustarAposta, apostaPote, apostaBB, apostaAllIn,
  alternarPreAcao, aoMoverSlider, aoDigitarAposta,

  // Modo presencial (criador, blinds, distribuição e DEV)
  abrirCriador, aoDigitarSmallMesa, aoEditarBigMesa, salvarBlinds, abrirRodada,
  moverJogador, iniciarPartida, iniciarOuProximaMao, pagarBlind, usarStackFichas,
  adicionarFichas, removerJogador, resetarPartida, subirNivel,
  abrirDistribuicao, fecharDistribuicao, alternarGanhador, alternarVencedorPote,
  alternarModoManualDist, aoEditarPremioManual, confirmarDistribuicao,
  abrirSalaDev, criarSalaDev, trocarJogadorDev, proximoJogadorDev,
  abrirPainelDev, adicionarJogadorDev, devAcao, excluirSalaDev,

  // Modo online (baralho virtual, cartas 3D, confirmação e revanche)
  virarMinhaCarta, alternarModoEspiar, confirmarMao, alternarAutoPronto, alternarAusenteOnline,
  chamarRabbitHunt, mostrarCartasOnline, revancheOnline, comprarRebuyOnline, espectarOnline, confirmarTodosDev,

  // Modo Blackjack (banca automática, 21)
  bjSomarFicha, bjLimparAposta, bjRepetirAposta, bjDobrarAposta, bjAllInAposta,
  bjConfirmarAposta, bjAgir, bjNovaRodada, bjRevanche, bjConfirmarTodosDev
});

// ----- Eventos globais e detalhes de conforto -----
iniciarTema();
iniciarSom();
aplicarIdiomaDOM();
registrarHookIdioma(() => {
  escolherModoLogin($id('grupo-confirmar-senha') && !$id('grupo-confirmar-senha').hidden ? 'criar' : 'entrar');
  atualizarControlesCriar();
  atualizarProfundidade('');
  atualizarProfundidade('dev');
  if ($id('tela-salas') && $id('tela-salas').classList.contains('ativa')) {
    estado.htmlSalas = '';
    desenharSalas();
  }
  if (estado.ultimoEstado && estado.partidaAtual) {
    estado.htmlJogadoresVisto = null;
    const pre = document.querySelector('#caixa-aposta .presets');
    if (pre) pre.dataset.modo = '';
    desenharMesa(estado.ultimoEstado);
  }
});
$id('campo-login-nome').value = lerNome();
prepararCampoSenha('campo-login-senha');
prepararCampoSenha('campo-login-senha-conf');
prepararCampoSenha('campo-senha-atual');
prepararCampoSenha('campo-senha-nova');
prepararCampoSenha('campo-senha-nova-conf');
escolherModoLogin('entrar');
iniciarConfigSala();
iniciarRelogio();

const barraEl = $id('barra-acoes');
const mesaEl = $id('tela-mesa');
function ajustarEspaco() {
  const visivel = barraEl.classList.contains('visivel');
  const altura = visivel ? barraEl.offsetHeight : 0;
  const margemInf = visivel ? (parseFloat(getComputedStyle(barraEl).bottom) || 0) : 0;
  const ehLandscapeMobile = window.innerWidth > window.innerHeight && window.innerHeight <= 520;
  const folga = ehLandscapeMobile ? 2 : (window.innerHeight <= 680 ? 4 : 8);
  mesaEl.style.paddingBottom = altura ? (altura + margemInf + folga) + 'px' : 'calc(6px + env(safe-area-inset-bottom))';
}
if ('ResizeObserver' in window) new ResizeObserver(ajustarEspaco).observe(barraEl);
new MutationObserver(ajustarEspaco).observe(barraEl, { attributes: true, attributeFilter: ['class'] });

let timerResize = null;
window.addEventListener('resize', () => {
  clearTimeout(timerResize);
  timerResize = setTimeout(() => {
    recalcularLayoutMesa();
    ajustarEspaco();
  }, 120);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const popReac = $id('popover-reacoes');
    if (popReac && !popReac.hidden) { alternarReacoes(true); return; }
    if (perfilAberto()) fecharPerfil();
    else if (algumaFolhaAberta()) fecharFolhas();
    else if (window.innerWidth >= 820 && estado.apostaAberta) alternarAposta();
    return;
  }

  // Atalhos ergonômicos apenas para PC (>= 820px) na mesa ativa
  if (window.innerWidth < 820) return;
  if (!$id('tela-mesa').classList.contains('ativa')) return;
  if (perfilAberto() || algumaFolhaAberta()) return;

  const alvo = e.target;
  const emCampo = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable);

  if (e.key === 'Enter' && estado.apostaAberta && (!emCampo || alvo.id === 'campo-valor')) {
    const btnConf = $id('btn-confirmar-aposta');
    if (btnConf && !btnConf.disabled) {
      e.preventDefault();
      apostar();
    }
    return;
  }

  if (emCampo) return;

  if (tratarTeclaBlackjack(e)) return;

  if (e.code === 'Space') {
    const wrapMao = $id('minha-mao-wrap');
    if (estado.modoAtual === 'online' && wrapMao && !wrapMao.hidden) {
      e.preventDefault();
      if (!e.repeat) {
        if (ehModoEspiarSegurar()) abrirMinhasCartas(true);
        else virarMinhaCarta(0);
      }
    }
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || window.innerWidth < 820) return;
  if (estado.modoAtual === 'online' && ehModoEspiarSegurar()) {
    e.preventDefault();
    abrirMinhasCartas(false);
  }
});

document.addEventListener('click', (e) => {
  const pop = $id('popover-reacoes');
  const naAncora = e.target && e.target.closest && e.target.closest('.meu-avatar-reacoes');
  if (pop && !pop.hidden && !pop.contains(e.target) && !naAncora) {
    alternarReacoes(true);
  }
});

// Ajuste suave de aposta com a roda do mouse no PC sobre a caixa de aposta
$id('caixa-aposta').addEventListener('wheel', (e) => {
  if (window.innerWidth < 820 || !estado.apostaAberta) return;
  e.preventDefault();
  ajustarAposta(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

$id('campo-login-nome').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $id('campo-login-senha').focus();
});
$id('campo-login-senha').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const grpConf = $id('grupo-confirmar-senha');
    if (grpConf && !grpConf.hidden) $id('campo-login-senha-conf').focus();
    else enviarAuth();
  }
});
$id('campo-login-senha-conf').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') enviarAuth();
});
const campoEntrarSenha = $id('campo-entrar-senha');
if (campoEntrarSenha) {
  campoEntrarSenha.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmarSenhaSala();
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const naMesa = $id('tela-mesa').classList.contains('ativa');
  const nasSalas = $id('tela-salas').classList.contains('ativa');
  if (estado.partidaAtual && naMesa) {
    buscarMesa(false);
    const canal = canalAtivo();
    if (!canal || canal.state !== 'joined') {
      ligarTempoReal({
        onEstado: receberEstado,
        onBuscar: buscarMesa,
        onConectado: carregarValorReal,
        onChat: receberMensagemChat,
        onReacao: receberReacao,
        onDigitando: receberDigitando
      });
    } else {
      enviarSinal();
    }
  } else if (nasSalas) {
    carregarSalas();
  }
});

window.addEventListener('online', () => {
  if (estado.partidaAtual && $id('tela-mesa').classList.contains('ativa')) buscarMesa(false);
});

window.addEventListener('popstate', () => {
  if (estado.ignorarPop) { estado.ignorarPop = false; return; }
  if (algumaFolhaAberta()) {
    fecharFolhas();
    try { history.pushState({ poker: 1 }, ''); } catch (erro) {}
    return;
  }
  estado.profundidade = 0;
  const ativa = document.querySelector('.tela.ativa');
  const id = ativa ? ativa.id : '';
  if (TELAS_INTERNAS.indexOf(id) >= 0) voltarParaSalas();
});

iniciarApp();
