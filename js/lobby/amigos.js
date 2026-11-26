// Sistema social: presença online, amigos, pedidos, busca exata, sugestões recentes, perfil público e convites de sala
import { banco } from '../core/supabase.js?v=107';
import { estado, contaParams } from '../core/estado.js?v=107';
import { guardarMeuJogador, esquecerDevSala } from '../core/storage.js?v=107';
import { $id, escapar, aviso, fmtNum, mostrarErro, limparErro, confirmarDialogo } from '../core/ui.js?v=120';
import { tratarErroConta } from './auth.js?v=120';
import { validarUrlAvatar, abrirPerfil, alternarAcordeaoSenha } from './perfil.js?v=109';
import { pararSalas, abrirSala, confirmarSaidaPartidaAtualSeNecessario } from './salas.js?v=125';
import { abrirMesa, copiarConviteSala } from '../mesa/mesa.js?v=125';
import { tocarSom } from '../core/som.js?v=123';

const socialCache = {
  carregado: false,
  convidado: false,
  amigos: [],
  pedidosRecebidos: [],
  pedidosEnviados: [],
  convitesSala: []
};

let canalSocial = null;
let timerPresenca = null;
let timerSyncSocial = null;
let partidaPresencaId = null;
let sincronizandoSocial = false;
let abaAmigosAtual = 'amigos';
let sugestoesCache = null;
let carregandoSugestoes = false;
let resultadoBusca = undefined; // undefined = sem busca ainda, null = não encontrado, obj = encontrado
let perfilAlvoAtual = null;
const convitesDispensados = new Set();
const convitesVistos = new Set();
const convidadosNaSessao = new Map(); // partidaId -> Set<contaId>
const botsPedidoEnviado = new Set(); // botId -> pedido visual na sessão

function validarUrlAvatarOuBot(url) {
  const segura = validarUrlAvatar(url);
  if (segura) return segura;
  if (typeof url === 'string' && /^\.\/img\/icons-bots\/[^"'<>\\]+$/.test(url)) return url;
  return null;
}

function registrarConviteEnviadoLocal(partidaId, contaId) {
  if (!partidaId || !contaId) return;
  if (!convidadosNaSessao.has(partidaId)) convidadosNaSessao.set(partidaId, new Set());
  convidadosNaSessao.get(partidaId).add(contaId);
}

function jaConvidadoNestaSessao(partidaId, contaId) {
  const s = convidadosNaSessao.get(partidaId);
  return !!(s && s.has(contaId));
}

function avatarHtml(nome, avatarUrl, classeExtra = '') {
  const url = validarUrlAvatarOuBot(avatarUrl);
  if (url) {
    return `<span class="amigo-avatar com-foto ${classeExtra}"><img src="${url}" alt="" decoding="async"></span>`;
  }
  const inicial = escapar((nome || '').trim().charAt(0).toUpperCase() || '♠');
  return `<span class="amigo-avatar ${classeExtra}">${inicial}</span>`;
}

export function formatarPresenca(item) {
  if (!item) return { texto: 'Offline', classe: 'offline' };
  const st = item.status_presenca || (item.online ? 'online' : 'offline');
  if (st === 'em_partida') {
    const salaNome = item.partida_atual && item.partida_atual.nome
      ? item.partida_atual.nome
      : null;
    return {
      texto: salaNome ? `Em partida · ${salaNome}` : 'Em partida',
      classe: 'partida'
    };
  }
  if (item.online || st === 'online') {
    return { texto: 'Online agora', classe: 'online' };
  }
  const ts = item.ultimo_acesso ? Date.parse(item.ultimo_acesso) : NaN;
  if (!Number.isFinite(ts)) return { texto: 'Offline', classe: 'offline' };

  const diffMs = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2) return { texto: 'Visto agora há pouco', classe: 'offline' };
  if (mins < 60) return { texto: `Visto há ${mins} min`, classe: 'offline' };
  const horas = Math.floor(mins / 60);
  if (horas < 24) return { texto: `Visto há ${horas} h`, classe: 'offline' };
  const dias = Math.floor(horas / 24);
  if (dias === 1) return { texto: 'Visto ontem', classe: 'offline' };
  if (dias < 30) return { texto: `Visto há ${dias} d`, classe: 'offline' };
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return { texto: `Visto em ${dd}/${mm}`, classe: 'offline' };
}

function modoLegivel(modo) {
  if (modo === 'blackjack') return 'Blackjack';
  if (modo === 'presencial') return 'Presencial';
  return 'Poker Online';
}

function formatarTempoJogando(criadaEmIso) {
  const ts = criadaEmIso ? Date.parse(criadaEmIso) : NaN;
  if (!Number.isFinite(ts)) return '—';
  const dias = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  const semanas = Math.floor(dias / 7);
  if (semanas < 1) return 'Menos de 1 semana';
  if (semanas < 4) return semanas === 1 ? '1 semana' : `${semanas} semanas`;
  const meses = Math.max(1, Math.floor(dias / 30));
  if (meses < 12) return meses === 1 ? '1 mês' : `${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? '1 ano' : `${anos} anos`;
}

function gerarStatsBot(chave) {
  let h = 2166136261;
  const s = String(chave || 'bot');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const faixa = rnd();
  let dias;
  if (faixa < 0.3) {
    dias = 7 + Math.floor(rnd() * 20); // 1 a 3 semanas
  } else if (faixa < 0.78) {
    dias = 32 + Math.floor(rnd() * 300); // 1 a 11 meses
  } else {
    dias = 370 + Math.floor(rnd() * 720); // 1 a 2 anos
  }
  const baseVitorias = Math.max(4, Math.floor(dias * (0.25 + rnd() * 0.55)));
  const maosVencidas = Math.min(480, baseVitorias + Math.floor(rnd() * 25));
  const criadaEm = new Date(Date.now() - dias * 86400000).toISOString();
  return { maos_vencidas: maosVencidas, criada_em: criadaEm };
}

// ----- Presença e Realtime Social -----
export async function enviarPingPresenca() {
  if (!estado.minhaConta || document.hidden) return;
  try {
    await banco.rpc('ping_presenca', {
      ...contaParams(),
      p_partida_id: partidaPresencaId || null
    });
  } catch (e) {}
}

export function atualizarPresencaSala(partidaId) {
  partidaPresencaId = partidaId || null;
  if (estado.minhaConta) enviarPingPresenca();
}

export function notificarContaSocial(contaId, tipo = 'atualizar') {
  if (!contaId || !estado.minhaConta || contaId === estado.minhaConta.id) return;
  try {
    const ch = banco.channel('social-' + contaId);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'social', payload: { tipo } })
          .catch(() => {})
          .finally(() => {
            setTimeout(() => { try { banco.removeChannel(ch); } catch (e) {} }, 600);
          });
      }
    });
  } catch (e) {}
}

export function iniciarSocial() {
  pararSocial();
  if (!estado.minhaConta) return;

  enviarPingPresenca();
  timerPresenca = setInterval(() => {
    if (!document.hidden && estado.minhaConta) enviarPingPresenca();
  }, 30000);

  if (!estado.minhaConta.convidado) {
    try {
      canalSocial = banco
        .channel('social-' + estado.minhaConta.id)
        .on('broadcast', { event: 'social' }, (msg) => {
          const tipo = msg && msg.payload && msg.payload.tipo;
          if (tipo === 'pedido_amizade') tocarSom('notificacao');
          else if (tipo === 'amizade_aceita') tocarSom('sucesso');
          sincronizarSocial(true);
        })
        .subscribe();
    } catch (e) {}

    timerSyncSocial = setInterval(() => {
      if (!document.hidden && estado.minhaConta) sincronizarSocial(false);
    }, 25000);
  }

  sincronizarSocial(false);
}

export function pararSocial() {
  if (timerPresenca) { clearInterval(timerPresenca); timerPresenca = null; }
  if (timerSyncSocial) { clearInterval(timerSyncSocial); timerSyncSocial = null; }
  if (canalSocial) {
    try { banco.removeChannel(canalSocial); } catch (e) {}
    canalSocial = null;
  }
  partidaPresencaId = null;
  socialCache.carregado = false;
  socialCache.amigos = [];
  socialCache.pedidosRecebidos = [];
  socialCache.pedidosEnviados = [];
  socialCache.convitesSala = [];
  sugestoesCache = null;
  resultadoBusca = undefined;
  perfilAlvoAtual = null;
  convitesDispensados.clear();
  convitesVistos.clear();
  convidadosNaSessao.clear();
  botsPedidoEnviado.clear();
  atualizarBadgesSocial();
  atualizarBannerConviteLobby();
}

export async function sincronizarSocial(notificarNovos = false) {
  if (!estado.minhaConta || sincronizandoSocial) return;
  sincronizandoSocial = true;
  try {
    const resp = await banco.rpc('listar_amigos_e_pedidos', contaParams());
    if (resp.error) {
      tratarErroConta(resp.error);
      return;
    }
    const d = resp.data || {};
    const novosConvites = Array.isArray(d.convites_sala) ? d.convites_sala : [];
    const temNovoConvite = novosConvites.some((c) => !convitesVistos.has(c.convite_id));
    novosConvites.forEach((c) => convitesVistos.add(c.convite_id));

    socialCache.carregado = true;
    socialCache.convidado = !!d.convidado;
    socialCache.amigos = Array.isArray(d.amigos) ? d.amigos : [];
    socialCache.pedidosRecebidos = Array.isArray(d.pedidos_recebidos) ? d.pedidos_recebidos : [];
    socialCache.pedidosEnviados = Array.isArray(d.pedidos_enviados) ? d.pedidos_enviados : [];
    socialCache.convitesSala = novosConvites;

    if (estado.minhaConta) {
      estado.minhaConta.convidado = socialCache.convidado;
    }

    atualizarBadgesSocial();
    atualizarBannerConviteLobby(notificarNovos && temNovoConvite);
    if (amigosAberto()) renderizarGavetaAmigos();
    if (convidarAmigosAberto()) renderizarConvidarAmigos();
  } catch (e) {
  } finally {
    sincronizandoSocial = false;
  }
}

function atualizarBadgesSocial() {
  const totalPendentes = socialCache.pedidosRecebidos.length + socialCache.convitesSala.length;
  const badgeLobby = $id('badge-amigos-lobby');
  if (badgeLobby) {
    badgeLobby.hidden = totalPendentes === 0;
    badgeLobby.textContent = totalPendentes > 9 ? '9+' : String(totalPendentes);
  }
  const badgeAbaPedidos = $id('badge-aba-pedidos');
  if (badgeAbaPedidos) {
    badgeAbaPedidos.hidden = totalPendentes === 0;
    badgeAbaPedidos.textContent = totalPendentes > 9 ? '9+' : String(totalPendentes);
  }
}

export function atualizarBannerConviteLobby(tocarAviso = false) {
  const banner = $id('banner-convite-sala');
  if (!banner) return;

  const telaSalas = $id('tela-salas');
  const noLobby = !!(telaSalas && telaSalas.classList.contains('ativa'));
  const convite = socialCache.convitesSala.find((c) => !convitesDispensados.has(c.convite_id));

  if (!noLobby || !convite || !estado.minhaConta || estado.minhaConta.convidado) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  banner.innerHTML = `
    <div class="banner-convite-esq">
      ${avatarHtml(convite.remetente_nome, convite.remetente_avatar_url, 'sm')}
      <div class="banner-convite-txt">
        <strong>${escapar(convite.remetente_nome)} convidou você!</strong>
        <span>${escapar(convite.partida_nome)} · ${escapar(modoLegivel(convite.partida_modo))}${convite.tem_senha ? ' · 🔒 Privada' : ''}</span>
      </div>
    </div>
    <div class="banner-convite-acoes">
      <button type="button" class="positivo btn-sm" data-convite-id="${convite.convite_id}" onclick="aceitarConviteSala(this.dataset.conviteId)">Entrar</button>
      <button type="button" class="secundario btn-sm" data-convite-id="${convite.convite_id}" onclick="recusarConviteSala(this.dataset.conviteId)">Recusar</button>
      <button type="button" class="banner-convite-fechar" data-convite-id="${convite.convite_id}" onclick="dispensarBannerConvite(this.dataset.conviteId)" aria-label="Fechar aviso">✕</button>
    </div>
  `;
  banner.hidden = false;
  if (tocarAviso) {
    tocarSom('convite-social');
    aviso(`${convite.remetente_nome} convidou você para jogar!`);
  }
}

export function dispensarBannerConvite(conviteId) {
  if (conviteId) convitesDispensados.add(conviteId);
  atualizarBannerConviteLobby(false);
}

// ----- Gaveta Principal de Amigos -----
export function amigosAberto() {
  const f = $id('folha-amigos');
  return !!(f && !f.hidden);
}

export function abrirAmigos(aba) {
  if (!estado.minhaConta) return;
  if (aba) abaAmigosAtual = aba;
  else if (socialCache.convitesSala.length + socialCache.pedidosRecebidos.length > 0 && abaAmigosAtual === 'amigos') {
    abaAmigosAtual = 'pedidos';
  }

  $id('fundo-amigos').hidden = false;
  $id('folha-amigos').hidden = false;
  escolherAbaAmigos(abaAmigosAtual);
  sincronizarSocial(false);
}

export function fecharAmigos() {
  const f = $id('folha-amigos');
  const bg = $id('fundo-amigos');
  if (f) f.hidden = true;
  if (bg) bg.hidden = true;
}

export function escolherAbaAmigos(aba) {
  abaAmigosAtual = (aba === 'pedidos' || aba === 'adicionar') ? aba : 'amigos';

  document.querySelectorAll('.amigos-aba[data-amigos-aba]').forEach((btn) => {
    const sel = btn.dataset.amigosAba === abaAmigosAtual;
    btn.classList.toggle('ativa', sel);
    btn.setAttribute('aria-selected', sel ? 'true' : 'false');
  });

  if (abaAmigosAtual === 'adicionar' && !estado.minhaConta?.convidado && sugestoesCache === null) {
    carregarSugestoesAmizade();
  }
  renderizarGavetaAmigos();
}

export function abrirDefinirSenhaConvidado() {
  fecharAmigos();
  fecharPerfilPublico();
  abrirPerfil('conta');
  alternarAcordeaoSenha(false);
}

function renderizarGavetaAmigos() {
  const corpo = $id('amigos-corpo');
  const abasEl = $id('amigos-abas');
  if (!corpo) return;

  const ehConvidado = !!(estado.minhaConta && estado.minhaConta.convidado) || socialCache.convidado;
  if (abasEl) abasEl.hidden = ehConvidado;

  if (ehConvidado) {
    corpo.innerHTML = `
      <div class="social-vazio-card">
        <div class="social-vazio-ico" aria-hidden="true">🔒</div>
        <strong>Disponível para contas permanentes</strong>
        <p>Contas <strong>Convidado (Guest)</strong> não podem adicionar amigos ou receber convites. Defina uma senha no seu perfil para salvar sua conta e liberar o sistema de amizades!</p>
        <button type="button" onclick="abrirDefinirSenhaConvidado()">Definir senha no meu perfil</button>
      </div>
    `;
    return;
  }

  if (abaAmigosAtual === 'amigos') {
    if (!socialCache.carregado) {
      corpo.innerHTML = '<div class="social-carregando">Carregando amigos...</div>';
      return;
    }
    if (!socialCache.amigos.length) {
      corpo.innerHTML = `
        <div class="social-vazio-card">
          <div class="social-vazio-ico" aria-hidden="true">👥</div>
          <strong>Você ainda não tem amigos aqui</strong>
          <p>Adicione pessoas pelo nome exato ou jogue uma partida e clique no perfil dos jogadores na mesa.</p>
          <button type="button" class="secundario" onclick="escolherAbaAmigos('adicionar')">+ Adicionar amigo</button>
        </div>
      `;
      return;
    }

    corpo.innerHTML = '<div class="social-lista">' + socialCache.amigos.map((a) => {
      const pres = formatarPresenca(a);
      const podeEntrar = !!(a.partida_atual && !a.partida_atual.tem_senha && (!estado.partidaAtual || estado.partidaAtual.id !== a.partida_atual.id));
      return `
        <div class="social-item clicavel" data-conta-id="${a.conta_id}" onclick="abrirPerfilJogador(this.dataset.contaId)">
          <div class="social-item-esq">
            <div class="social-av-wrap">
              ${avatarHtml(a.nome, a.avatar_url)}
              <span class="status-dot ${pres.classe}" title="${escapar(pres.texto)}"></span>
            </div>
            <div class="social-item-info">
              <strong class="social-nome">${escapar(a.nome)}</strong>
              <span class="social-sub ${pres.classe}">${escapar(pres.texto)}</span>
            </div>
          </div>
          <div class="social-item-acoes" onclick="event.stopPropagation()">
            ${podeEntrar ? `<button type="button" class="positivo btn-sm" data-partida-id="${a.partida_atual.id}" onclick="entrarSalaDoAmigo(this.dataset.partidaId)">Entrar</button>` : ''}
            <button type="button" class="secundario btn-sm" data-conta-id="${a.conta_id}" onclick="abrirPerfilJogador(this.dataset.contaId)">Perfil</button>
          </div>
        </div>
      `;
    }).join('') + '</div>';
    return;
  }

  if (abaAmigosAtual === 'pedidos') {
    const convites = socialCache.convitesSala;
    const recebidos = socialCache.pedidosRecebidos;
    const enviados = socialCache.pedidosEnviados;

    if (!convites.length && !recebidos.length && !enviados.length) {
      corpo.innerHTML = `
        <div class="social-vazio-card">
          <div class="social-vazio-ico" aria-hidden="true">✉️</div>
          <strong>Nenhum pedido ou convite</strong>
          <p>Quando alguém enviar um pedido de amizade ou convidar você para uma mesa, aparecerá aqui.</p>
        </div>
      `;
      return;
    }

    let html = '';
    if (convites.length) {
      html += '<div class="social-secao-titulo">Convites para jogar</div><div class="social-lista">';
      html += convites.map((c) => `
        <div class="social-item destaque-convite">
          <div class="social-item-esq">
            ${avatarHtml(c.remetente_nome, c.remetente_avatar_url)}
            <div class="social-item-info">
              <strong class="social-nome">${escapar(c.remetente_nome)}</strong>
              <span class="social-sub partida">${escapar(c.partida_nome)} · ${escapar(modoLegivel(c.partida_modo))}${c.tem_senha ? ' · 🔒' : ''}</span>
            </div>
          </div>
          <div class="social-item-acoes">
            <button type="button" class="positivo btn-sm" data-convite-id="${c.convite_id}" onclick="aceitarConviteSala(this.dataset.conviteId)">Entrar</button>
            <button type="button" class="secundario btn-sm" data-convite-id="${c.convite_id}" onclick="recusarConviteSala(this.dataset.conviteId)">Recusar</button>
          </div>
        </div>
      `).join('') + '</div>';
    }

    if (recebidos.length) {
      html += '<div class="social-secao-titulo">Pedidos de amizade recebidos</div><div class="social-lista">';
      html += recebidos.map((p) => `
        <div class="social-item">
          <div class="social-item-esq clicavel" data-conta-id="${p.conta_id}" onclick="abrirPerfilJogador(this.dataset.contaId)">
            ${avatarHtml(p.nome, p.avatar_url)}
            <div class="social-item-info">
              <strong class="social-nome">${escapar(p.nome)}</strong>
              <span class="social-sub">Quer ser seu amigo</span>
            </div>
          </div>
          <div class="social-item-acoes">
            <button type="button" class="positivo btn-sm" data-amizade-id="${p.amizade_id}" onclick="responderPedidoAmigo(this.dataset.amizadeId, true)">Aceitar</button>
            <button type="button" class="secundario btn-sm" data-amizade-id="${p.amizade_id}" onclick="responderPedidoAmigo(this.dataset.amizadeId, false)">Recusar</button>
          </div>
        </div>
      `).join('') + '</div>';
    }

    if (enviados.length) {
      html += '<div class="social-secao-titulo">Pedidos enviados</div><div class="social-lista">';
      html += enviados.map((p) => `
        <div class="social-item">
          <div class="social-item-esq clicavel" data-conta-id="${p.conta_id}" onclick="abrirPerfilJogador(this.dataset.contaId)">
            ${avatarHtml(p.nome, p.avatar_url)}
            <div class="social-item-info">
              <strong class="social-nome">${escapar(p.nome)}</strong>
              <span class="social-sub">Aguardando resposta</span>
            </div>
          </div>
          <div class="social-item-acoes">
            <button type="button" class="secundario btn-sm" data-conta-id="${p.conta_id}" onclick="cancelarOuRemoverAmigo(this.dataset.contaId, false)">Cancelar</button>
          </div>
        </div>
      `).join('') + '</div>';
    }

    corpo.innerHTML = html;
    return;
  }

  // Aba adicionar: busca pelo nome exato + sugestões de partidas recentes
  let buscaHtml = '';
  if (resultadoBusca === null) {
    buscaHtml = '<div class="social-busca-vazia">Nenhuma conta permanente encontrada com esse nome exato.</div>';
  } else if (resultadoBusca && resultadoBusca.conta_id) {
    const r = resultadoBusca;
    const pres = formatarPresenca(r);
    let acaoBtn = '';
    if (r.relacao === 'amigos') {
      acaoBtn = '<span class="social-tag-ok">Amigos ✓</span>';
    } else if (r.relacao === 'enviado') {
      acaoBtn = `<button type="button" class="secundario btn-sm" data-conta-id="${r.conta_id}" onclick="cancelarOuRemoverAmigo(this.dataset.contaId, false)">Enviado · Cancelar</button>`;
    } else if (r.relacao === 'recebido') {
      acaoBtn = `<button type="button" class="positivo btn-sm" data-amizade-id="${r.amizade_id}" onclick="responderPedidoAmigo(this.dataset.amizadeId, true)">Aceitar</button>`;
    } else {
      acaoBtn = `<button type="button" class="positivo btn-sm" data-conta-id="${r.conta_id}" onclick="enviarPedidoAmigo(this.dataset.contaId)">+ Adicionar</button>`;
    }
    buscaHtml = `
      <div class="social-lista" style="margin-top:10px">
        <div class="social-item">
          <div class="social-item-esq clicavel" data-conta-id="${r.conta_id}" onclick="abrirPerfilJogador(this.dataset.contaId)">
            <div class="social-av-wrap">
              ${avatarHtml(r.nome, r.avatar_url)}
              <span class="status-dot ${pres.classe}"></span>
            </div>
            <div class="social-item-info">
              <strong class="social-nome">${escapar(r.nome)}</strong>
              <span class="social-sub ${pres.classe}">${escapar(pres.texto)}</span>
            </div>
          </div>
          <div class="social-item-acoes">${acaoBtn}</div>
        </div>
      </div>
    `;
  }

  let sugHtml = '';
  if (carregandoSugestoes) {
    sugHtml = '<div class="social-carregando">Buscando jogadores recentes...</div>';
  } else if (Array.isArray(sugestoesCache) && sugestoesCache.length) {
    sugHtml = '<div class="social-lista">' + sugestoesCache.map((s) => {
      const pres = formatarPresenca(s);
      return `
        <div class="social-item">
          <div class="social-item-esq clicavel" data-conta-id="${s.conta_id}" onclick="abrirPerfilJogador(this.dataset.contaId)">
            <div class="social-av-wrap">
              ${avatarHtml(s.nome, s.avatar_url)}
              <span class="status-dot ${pres.classe}"></span>
            </div>
            <div class="social-item-info">
              <strong class="social-nome">${escapar(s.nome)}</strong>
              <span class="social-sub ${pres.classe}">Jogou recentemente · ${escapar(pres.texto)}</span>
            </div>
          </div>
          <div class="social-item-acoes">
            <button type="button" class="positivo btn-sm" data-conta-id="${s.conta_id}" onclick="enviarPedidoAmigo(this.dataset.contaId)">+ Adicionar</button>
          </div>
        </div>
      `;
    }).join('') + '</div>';
  } else {
    sugHtml = '<div class="social-busca-vazia">Nenhum jogador recente disponível para sugestão.</div>';
  }

  const valorInput = ($id('campo-busca-amigo') ? $id('campo-busca-amigo').value : '');
  corpo.innerHTML = `
    <form class="social-busca-form" onsubmit="event.preventDefault(); buscarAmigoExato();">
      <input id="campo-busca-amigo" type="text" maxlength="20" placeholder="Nome exato do jogador" value="${escapar(valorInput)}" autocomplete="off" autocapitalize="words" spellcheck="false">
      <button type="submit" id="btn-buscar-amigo">Buscar</button>
    </form>
    <p class="dica" style="margin:6px 0 0">Digite o apelido exato da conta (contas Convidado não aparecem na busca).</p>
    <div id="erro-busca-amigo" class="erro" role="alert"></div>
    ${buscaHtml}
    <div class="social-secao-titulo" style="margin-top:16px">Jogaram com você recentemente</div>
    ${sugHtml}
  `;
}

export async function buscarAmigoExato() {
  if (!estado.minhaConta) return;
  limparErro('erro-busca-amigo');
  const campo = $id('campo-busca-amigo');
  const nome = (campo ? campo.value : '').trim().replace(/\s+/g, ' ');
  if (nome.length < 2) {
    mostrarErro('erro-busca-amigo', 'Digite o nome completo do jogador.');
    return;
  }

  const btn = $id('btn-buscar-amigo');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const resp = await banco.rpc('buscar_conta_exata', {
      ...contaParams(),
      p_nome: nome
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharAmigos(); return; }
      mostrarErro('erro-busca-amigo', resp.error.message || 'Erro ao buscar jogador.');
      return;
    }
    resultadoBusca = resp.data || null;
    renderizarGavetaAmigos();
  } catch (e) {
    mostrarErro('erro-busca-amigo', 'Sem conexão. Tente novamente.');
  } finally {
    const b = $id('btn-buscar-amigo');
    if (b) { b.disabled = false; b.textContent = 'Buscar'; }
  }
}

async function carregarSugestoesAmizade() {
  if (!estado.minhaConta || carregandoSugestoes) return;
  carregandoSugestoes = true;
  if (amigosAberto() && abaAmigosAtual === 'adicionar') renderizarGavetaAmigos();
  try {
    const resp = await banco.rpc('sugestoes_amizade', contaParams());
    if (!resp.error && Array.isArray(resp.data)) {
      sugestoesCache = resp.data;
    } else {
      sugestoesCache = [];
    }
  } catch (e) {
    sugestoesCache = [];
  } finally {
    carregandoSugestoes = false;
    if (amigosAberto() && abaAmigosAtual === 'adicionar') renderizarGavetaAmigos();
  }
}

// ----- Ações de Amizade -----
export async function enviarPedidoAmigo(alvoContaId) {
  if (!estado.minhaConta || !alvoContaId) return;
  try {
    const resp = await banco.rpc('enviar_pedido_amizade', {
      ...contaParams(),
      p_alvo_conta: alvoContaId
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharAmigos(); fecharPerfilPublico(); return; }
      aviso(resp.error.message || 'Não foi possível enviar o pedido.');
      return;
    }
    const auto = !!(resp.data && resp.data.auto_aceita);
    if (auto) tocarSom('sucesso');
    aviso(auto ? 'Pedido aceito! Vocês agora são amigos.' : 'Pedido de amizade enviado!');
    notificarContaSocial(alvoContaId, auto ? 'amizade_aceita' : 'pedido_amizade');
    if (Array.isArray(sugestoesCache)) {
      sugestoesCache = sugestoesCache.filter((s) => s.conta_id !== alvoContaId);
    }
    if (resultadoBusca && resultadoBusca.conta_id === alvoContaId) {
      resultadoBusca.relacao = auto ? 'amigos' : 'enviado';
      resultadoBusca.amizade_id = resp.data?.amizade_id || null;
    }
    await sincronizarSocial(false);
    if (perfilPublicoAberto() && perfilAlvoAtual && perfilAlvoAtual.conta_id === alvoContaId) {
      await carregarPerfilPublico(alvoContaId);
    }
  } catch (e) {
    aviso('Sem conexão. Tente novamente.');
  }
}

export async function responderPedidoAmigo(amizadeId, aceitar) {
  if (!estado.minhaConta || !amizadeId) return;
  try {
    const resp = await banco.rpc('responder_pedido_amizade', {
      ...contaParams(),
      p_amizade_id: amizadeId,
      p_aceitar: !!aceitar
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharAmigos(); fecharPerfilPublico(); return; }
      aviso(resp.error.message || 'Não foi possível responder ao pedido.');
      return;
    }
    const outroId = resp.data && resp.data.outro_conta_id;
    if (aceitar) tocarSom('sucesso');
    aviso(aceitar ? 'Amizade aceita!' : 'Pedido recusado.');
    if (outroId) notificarContaSocial(outroId, aceitar ? 'amizade_aceita' : 'pedido_recusado');
    sugestoesCache = null;
    await sincronizarSocial(false);
    if (perfilPublicoAberto() && perfilAlvoAtual && perfilAlvoAtual.conta_id === outroId) {
      await carregarPerfilPublico(outroId);
    }
  } catch (e) {
    aviso('Sem conexão. Tente novamente.');
  }
}

export async function cancelarOuRemoverAmigo(alvoContaId, confirmar = true) {
  if (!estado.minhaConta || !alvoContaId) return;
  if (confirmar) {
    const ok = await confirmarDialogo({
      titulo: 'Remover amigo?',
      mensagem: 'Remover este jogador da sua lista de amigos?',
      textoConfirmar: 'Remover',
      perigo: true
    });
    if (!ok) return;
  }
  try {
    const resp = await banco.rpc('cancelar_ou_remover_amizade', {
      ...contaParams(),
      p_alvo_conta: alvoContaId
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharAmigos(); fecharPerfilPublico(); return; }
      aviso(resp.error.message || 'Não foi possível atualizar a amizade.');
      return;
    }
    aviso(confirmar ? 'Amigo removido.' : 'Pedido cancelado.');
    notificarContaSocial(alvoContaId, 'amizade_removida');
    sugestoesCache = null;
    if (resultadoBusca && resultadoBusca.conta_id === alvoContaId) {
      resultadoBusca.relacao = 'nenhum';
      resultadoBusca.amizade_id = null;
    }
    await sincronizarSocial(false);
    if (perfilPublicoAberto() && perfilAlvoAtual && perfilAlvoAtual.conta_id === alvoContaId) {
      await carregarPerfilPublico(alvoContaId);
    }
  } catch (e) {
    aviso('Sem conexão. Tente novamente.');
  }
}

// ----- Mini-Perfil Público -----
export function perfilPublicoAberto() {
  const f = $id('folha-perfil-publico');
  return !!(f && !f.hidden);
}

export function fecharPerfilPublico() {
  const f = $id('folha-perfil-publico');
  const bg = $id('fundo-perfil-publico');
  if (f) f.hidden = true;
  if (bg) bg.hidden = true;
  perfilAlvoAtual = null;
}

export async function abrirPerfilJogador(contaId, nomeFallback = '') {
  if (!estado.minhaConta || !contaId) return;
  if (contaId === estado.minhaConta.id) {
    abrirPerfil('conta');
    return;
  }

  perfilAlvoAtual = { conta_id: contaId, nome: nomeFallback || 'Jogador', carregando: true };
  renderizarPerfilPublico();
  $id('fundo-perfil-publico').hidden = false;
  $id('folha-perfil-publico').hidden = false;
  await carregarPerfilPublico(contaId);
}

export function abrirPerfilBot(botId, nome = '', avatarUrl = '') {
  if (!estado.minhaConta || !botId) return;
  const nomeSala = estado.partidaAtual
    ? (estado.partidaAtual.nome || (estado.partidaAtual.codigo ? 'Sala ' + estado.partidaAtual.codigo : ''))
    : '';
  const stats = gerarStatsBot(nome || botId);
  perfilAlvoAtual = {
    eh_bot: true,
    bot_id: botId,
    nome: nome || 'Jogador',
    avatar_url: validarUrlAvatarOuBot(avatarUrl),
    maos_vencidas: stats.maos_vencidas,
    criada_em: stats.criada_em,
    online: true,
    status_presenca: 'em_partida',
    partida_atual: nomeSala ? { nome: nomeSala } : null
  };
  renderizarPerfilPublico();
  $id('fundo-perfil-publico').hidden = false;
  $id('folha-perfil-publico').hidden = false;
}

export function enviarPedidoBot(botId) {
  if (!botId) return;
  botsPedidoEnviado.add(botId);
  aviso('Pedido de amizade enviado!');
  if (perfilPublicoAberto() && perfilAlvoAtual && perfilAlvoAtual.eh_bot && perfilAlvoAtual.bot_id === botId) {
    renderizarPerfilPublico();
  }
}

export function cancelarPedidoBot(botId) {
  if (!botId) return;
  botsPedidoEnviado.delete(botId);
  aviso('Pedido cancelado.');
  if (perfilPublicoAberto() && perfilAlvoAtual && perfilAlvoAtual.eh_bot && perfilAlvoAtual.bot_id === botId) {
    renderizarPerfilPublico();
  }
}

async function carregarPerfilPublico(contaId) {
  try {
    const resp = await banco.rpc('obter_perfil_publico', {
      ...contaParams(),
      p_alvo_conta: contaId
    });
    if (!perfilPublicoAberto()) return;
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharPerfilPublico(); return; }
      perfilAlvoAtual = { conta_id: contaId, erro: resp.error.message || 'Erro ao carregar perfil.' };
      renderizarPerfilPublico();
      return;
    }
    perfilAlvoAtual = resp.data;
    renderizarPerfilPublico();
  } catch (e) {
    if (!perfilPublicoAberto()) return;
    perfilAlvoAtual = { conta_id: contaId, erro: 'Sem conexão. Tente novamente.' };
    renderizarPerfilPublico();
  }
}

function renderizarPerfilPublico() {
  const corpo = $id('perfil-publico-corpo');
  if (!corpo || !perfilAlvoAtual) return;

  if (perfilAlvoAtual.carregando) {
    corpo.innerHTML = `
      <div class="pp-cabecalho">
        ${avatarHtml(perfilAlvoAtual.nome, null, 'lg')}
        <strong class="pp-nome">${escapar(perfilAlvoAtual.nome)}</strong>
        <span class="pp-status offline">Carregando perfil...</span>
      </div>
    `;
    return;
  }

  if (perfilAlvoAtual.erro) {
    corpo.innerHTML = `<div class="social-busca-vazia">${escapar(perfilAlvoAtual.erro)}</div>`;
    return;
  }

  const p = perfilAlvoAtual;
  const pres = formatarPresenca(p);
  const euConvidado = !!(estado.minhaConta && estado.minhaConta.convidado);

  let acoesHtml = '';
  if (p.eh_bot) {
    if (euConvidado) {
      acoesHtml = `
        <div class="pp-aviso">Crie uma senha no seu perfil para adicionar amigos.</div>
        <button type="button" onclick="abrirDefinirSenhaConvidado()">Definir senha no perfil</button>
      `;
    } else if (botsPedidoEnviado.has(p.bot_id)) {
      acoesHtml = `<button type="button" class="secundario" data-bot-id="${escapar(p.bot_id)}" onclick="cancelarPedidoBot(this.dataset.botId)">Pedido enviado · Cancelar</button>`;
    } else {
      acoesHtml = `<button type="button" class="positivo" data-bot-id="${escapar(p.bot_id)}" onclick="enviarPedidoBot(this.dataset.botId)">+ Adicionar amigo</button>`;
    }
  } else if (p.convidado) {
    acoesHtml = '<div class="pp-aviso">Conta <strong>Convidado (Guest)</strong> — não aceita pedidos de amizade.</div>';
  } else if (euConvidado) {
    acoesHtml = `
      <div class="pp-aviso">Crie uma senha no seu perfil para adicionar amigos.</div>
      <button type="button" onclick="abrirDefinirSenhaConvidado()">Definir senha no perfil</button>
    `;
  } else if (p.relacao === 'nenhum') {
    acoesHtml = `<button type="button" class="positivo" data-conta-id="${p.conta_id}" onclick="enviarPedidoAmigo(this.dataset.contaId)">+ Adicionar amigo</button>`;
  } else if (p.relacao === 'enviado') {
    acoesHtml = `<button type="button" class="secundario" data-conta-id="${p.conta_id}" onclick="cancelarOuRemoverAmigo(this.dataset.contaId, false)">Pedido enviado · Cancelar</button>`;
  } else if (p.relacao === 'recebido') {
    acoesHtml = `
      <div class="pp-acoes-duplas">
        <button type="button" class="positivo" data-amizade-id="${p.amizade_id}" onclick="responderPedidoAmigo(this.dataset.amizadeId, true)">Aceitar pedido</button>
        <button type="button" class="secundario" data-amizade-id="${p.amizade_id}" onclick="responderPedidoAmigo(this.dataset.amizadeId, false)">Recusar</button>
      </div>
    `;
  } else if (p.relacao === 'amigos') {
    const botoes = [];
    const naMesaAtiva = !!(estado.partidaAtual && !estado.partidaAtual.dev && estado.meuJogadorId);
    const amigoNestaMesa = naMesaAtiva && (estado.jogadoresAtuais || []).some((j) => j.conta_id === p.conta_id);

    if (naMesaAtiva && !amigoNestaMesa) {
      const jaConv = jaConvidadoNestaSessao(estado.partidaAtual.id, p.conta_id);
      botoes.push(
        jaConv
          ? '<button type="button" class="secundario" disabled>Convite enviado ✓</button>'
          : `<button type="button" class="positivo" data-conta-id="${p.conta_id}" onclick="enviarConviteAmigo(this.dataset.contaId)">Convidar para esta sala</button>`
      );
    } else if (!naMesaAtiva && p.partida_atual && !p.partida_atual.tem_senha) {
      botoes.push(`<button type="button" class="positivo" data-partida-id="${p.partida_atual.id}" onclick="entrarSalaDoAmigo(this.dataset.partidaId)">Entrar na sala (${escapar(p.partida_atual.nome)})</button>`);
    }
    botoes.push(`<button type="button" class="contorno-perigo" data-conta-id="${p.conta_id}" onclick="cancelarOuRemoverAmigo(this.dataset.contaId, true)">Remover amigo</button>`);
    acoesHtml = `<div class="pp-acoes-pilha">${botoes.join('')}</div>`;
  }

  const statsHtml = `
    <div class="pp-stats">
      <div class="pp-stat-card">
        <span class="pp-stat-val">🏆 ${fmtNum(Number(p.maos_vencidas) || 0)}</span>
        <span class="pp-stat-lbl">Mãos vencidas</span>
      </div>
      <div class="pp-stat-card">
        <span class="pp-stat-val">📅 ${escapar(formatarTempoJogando(p.criada_em))}</span>
        <span class="pp-stat-lbl">Joga há</span>
      </div>
    </div>
  `;

  corpo.innerHTML = `
    <div class="pp-cabecalho">
      ${avatarHtml(p.nome, p.avatar_url, 'lg')}
      <strong class="pp-nome">${escapar(p.nome)}</strong>
      <span class="pp-status ${pres.classe}"><i class="status-dot ${pres.classe}"></i> ${escapar(pres.texto)}</span>
    </div>
    ${statsHtml}
    <div class="pp-acoes">${acoesHtml}</div>
  `;
}

// ----- Convidar Amigos para a Mesa Atual -----
export function convidarAmigosAberto() {
  const f = $id('folha-convidar-amigos');
  return !!(f && !f.hidden);
}

export function fecharConvidarAmigos() {
  const f = $id('folha-convidar-amigos');
  const bg = $id('fundo-convidar-amigos');
  if (f) f.hidden = true;
  if (bg) bg.hidden = true;
}

export function abrirConvidarAmigos() {
  if (!estado.minhaConta || !estado.partidaAtual) return;
  if (estado.modoDev || estado.partidaAtual.dev) {
    copiarConviteSala();
    return;
  }
  $id('fundo-convidar-amigos').hidden = false;
  $id('folha-convidar-amigos').hidden = false;
  renderizarConvidarAmigos();
  sincronizarSocial(false);
}

function renderizarConvidarAmigos() {
  const corpo = $id('convidar-amigos-corpo');
  if (!corpo) return;

  const ehConvidado = !!(estado.minhaConta && estado.minhaConta.convidado) || socialCache.convidado;
  if (ehConvidado) {
    corpo.innerHTML = `
      <div class="social-vazio-card">
        <div class="social-vazio-ico" aria-hidden="true">🔗</div>
        <strong>Convide pelo link da sala</strong>
        <p>Contas Convidado não têm lista de amigos. Copie o link abaixo para chamar outras pessoas ou defina uma senha no perfil.</p>
        <button type="button" class="positivo" onclick="copiarConviteSala()">Copiar link da sala</button>
      </div>
    `;
    return;
  }

  if (!socialCache.carregado) {
    corpo.innerHTML = '<div class="social-carregando">Carregando amigos...</div>';
    return;
  }

  const partidaId = estado.partidaAtual ? estado.partidaAtual.id : null;
  const contasNaMesa = new Set((estado.jogadoresAtuais || []).map((j) => j.conta_id).filter(Boolean));

  if (!socialCache.amigos.length) {
    corpo.innerHTML = `
      <div class="social-vazio-card">
        <div class="social-vazio-ico" aria-hidden="true">👥</div>
        <strong>Nenhum amigo adicionado ainda</strong>
        <p>Você pode copiar o link da sala para enviar no WhatsApp, ou clicar nos jogadores da mesa para adicioná-los.</p>
      </div>
    `;
    return;
  }

  corpo.innerHTML = '<div class="social-lista">' + socialCache.amigos.map((a) => {
    const pres = formatarPresenca(a);
    const naMesa = contasNaMesa.has(a.conta_id);
    const jaConv = partidaId && jaConvidadoNestaSessao(partidaId, a.conta_id);

    let btnHtml;
    if (naMesa) {
      btnHtml = '<span class="social-tag-ok">Na mesa</span>';
    } else if (jaConv) {
      btnHtml = '<button type="button" class="secundario btn-sm" disabled>Convidado ✓</button>';
    } else {
      btnHtml = `<button type="button" class="positivo btn-sm" data-conta-id="${a.conta_id}" onclick="enviarConviteAmigo(this.dataset.contaId)">Convidar</button>`;
    }

    return `
      <div class="social-item">
        <div class="social-item-esq">
          <div class="social-av-wrap">
            ${avatarHtml(a.nome, a.avatar_url)}
            <span class="status-dot ${pres.classe}"></span>
          </div>
          <div class="social-item-info">
            <strong class="social-nome">${escapar(a.nome)}</strong>
            <span class="social-sub ${pres.classe}">${escapar(pres.texto)}</span>
          </div>
        </div>
        <div class="social-item-acoes">${btnHtml}</div>
      </div>
    `;
  }).join('') + '</div>';
}

export async function enviarConviteAmigo(destinatarioId) {
  if (!estado.minhaConta || !estado.partidaAtual || !destinatarioId) return;
  const partidaId = estado.partidaAtual.id;
  try {
    const resp = await banco.rpc('enviar_convite_sala', {
      ...contaParams(),
      p_destinatario_id: destinatarioId,
      p_partida_id: partidaId
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharConvidarAmigos(); fecharPerfilPublico(); return; }
      aviso(resp.error.message || 'Não foi possível enviar o convite.');
      return;
    }
    registrarConviteEnviadoLocal(partidaId, destinatarioId);
    notificarContaSocial(destinatarioId, 'convite_sala');
    aviso('Convite enviado!');
    if (convidarAmigosAberto()) renderizarConvidarAmigos();
    if (perfilPublicoAberto() && perfilAlvoAtual && perfilAlvoAtual.conta_id === destinatarioId) {
      renderizarPerfilPublico();
    }
  } catch (e) {
    aviso('Sem conexão. Tente novamente.');
  }
}

// ----- Entrar em Sala via Amigo / Convite -----
export async function aceitarConviteSala(conviteId) {
  if (!estado.minhaConta || !conviteId || estado.abrindoSala) return;
  estado.abrindoSala = true;
  try {
    const conv = socialCache.convitesSala.find((c) => c.convite_id === conviteId);
    const podeEntrar = await confirmarSaidaPartidaAtualSeNecessario(conv ? conv.partida_id : null);
    if (!podeEntrar) return;

    const resp = await banco.rpc('aceitar_convite_sala', {
      ...contaParams(),
      p_convite_id: conviteId
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharAmigos(); return; }
      aviso(resp.error.message || 'Não foi possível entrar pela solicitação.');
      await sincronizarSocial(false);
      return;
    }
    const d = resp.data;
    pararSalas();
    esquecerDevSala();
    estado.modoDev = false;
    fecharAmigos();
    fecharPerfilPublico();
    convitesDispensados.add(conviteId);
    socialCache.convitesSala = socialCache.convitesSala.filter((c) => c.convite_id !== conviteId);
    atualizarBadgesSocial();
    atualizarBannerConviteLobby(false);

    guardarMeuJogador(estado.minhaConta.id, d.partida_id, d.jogador_id, d.segredo);
    await abrirMesa({ id: d.partida_id, modo: d.modo || 'online', dev: false });
  } catch (e) {
    aviso('Sem conexão. Tente novamente.');
  } finally {
    estado.abrindoSala = false;
  }
}

export async function recusarConviteSala(conviteId) {
  if (!estado.minhaConta || !conviteId) return;
  convitesDispensados.add(conviteId);
  socialCache.convitesSala = socialCache.convitesSala.filter((c) => c.convite_id !== conviteId);
  atualizarBadgesSocial();
  atualizarBannerConviteLobby(false);
  if (amigosAberto()) renderizarGavetaAmigos();

  try {
    await banco.rpc('recusar_convite_sala', {
      ...contaParams(),
      p_convite_id: conviteId
    });
  } catch (e) {}
}

export async function entrarSalaDoAmigo(partidaId) {
  if (!partidaId) return;
  fecharAmigos();
  fecharPerfilPublico();
  await abrirSala(partidaId);
}
