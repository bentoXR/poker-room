// Chat de texto simples da mesa (persistido no Supabase + entrega instantânea via Realtime)
import { banco } from '../core/supabase.js?v=62';
import { estado, nomeDe } from '../core/estado.js?v=62';
import { $id, escapar, aviso, abrirFolha } from '../core/ui.js?v=62';
import { publicarChat } from '../core/realtime.js?v=62';
import { tocarSom } from '../core/som.js?v=62';

const chat = {
  partidaId: null,
  mensagens: [],
  ids: new Set(),
  naoLidas: 0,
  enviando: false
};

function chatAberto() {
  const el = $id('folha-chat');
  return Boolean(el && !el.hidden);
}

function atualizarBadge() {
  const badge = $id('badge-chat');
  if (!badge) return;
  if (chat.naoLidas > 0) {
    badge.textContent = chat.naoLidas > 9 ? '9+' : String(chat.naoLidas);
    badge.hidden = false;
  } else {
    badge.textContent = '';
    badge.hidden = true;
  }
}

function formatarHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function ehMinhaMensagem(msg) {
  if (!msg || !msg.autor_id) return false;
  if (estado.meuJogadorId && msg.autor_id === estado.meuJogadorId) return true;
  if (estado.minhaConta && msg.autor_id === estado.minhaConta.id) return true;
  return false;
}

function rolarFim() {
  const lista = $id('chat-lista');
  if (lista) lista.scrollTop = lista.scrollHeight;
}

function desenharChat() {
  const lista = $id('chat-lista');
  if (!lista) return;

  if (!chat.mensagens.length) {
    lista.innerHTML =
      '<div class="chat-vazio">Nenhuma mensagem ainda. Mande um oi para a mesa!</div>';
    return;
  }

  lista.innerHTML = chat.mensagens.map((m) => {
    const minha = ehMinhaMensagem(m);
    const autor = escapar(nomeDe(m.autor_nome || 'Jogador'));
    const texto = escapar(m.texto || '');
    const hora = formatarHora(m.criado_em);
    return (
      '<div class="chat-msg' + (minha ? ' eu' : '') + '">' +
        '<div class="chat-cab">' +
          '<strong class="chat-autor">' + autor + '</strong>' +
          (hora ? '<span class="chat-hora">' + hora + '</span>' : '') +
        '</div>' +
        '<div class="chat-txt">' + texto + '</div>' +
      '</div>'
    );
  }).join('');

  rolarFim();
}

function limparPreviewChat() {
  const wrap = $id('chat-preview');
  if (wrap) wrap.innerHTML = '';
}

function mostrarPreviewChat(msg) {
  const wrap = $id('chat-preview');
  if (!wrap || !msg) return;

  const autor = escapar(nomeDe(msg.autor_nome || 'Jogador'));
  const texto = escapar(msg.texto || '');

  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'chat-preview-item';
  item.setAttribute('aria-label', 'Abrir chat: ' + nomeDe(msg.autor_nome || 'Jogador') + ' disse ' + (msg.texto || ''));
  item.innerHTML =
    '<strong class="chat-preview-autor">' + autor + '</strong> ' +
    '<span class="chat-preview-txt">' + texto + '</span>';
  item.addEventListener('click', () => abrirChat());

  wrap.appendChild(item);
  while (wrap.children.length > 2) {
    wrap.removeChild(wrap.firstElementChild);
  }

  setTimeout(() => {
    if (!item.isConnected) return;
    item.classList.add('saindo');
    setTimeout(() => {
      if (item.isConnected) item.remove();
    }, 260);
  }, 4600);
}

export function limparChatMesa() {
  chat.partidaId = null;
  chat.mensagens = [];
  chat.ids.clear();
  chat.naoLidas = 0;
  chat.enviando = false;
  atualizarBadge();
  limparPreviewChat();
  const lista = $id('chat-lista');
  if (lista) lista.innerHTML = '';
  const campo = $id('campo-chat');
  if (campo) campo.value = '';
}

export async function iniciarChatMesa(partidaId) {
  limparChatMesa();
  if (!partidaId) return;
  chat.partidaId = partidaId;
  desenharChat();

  try {
    const resp = await banco.rpc('listar_mensagens_chat', {
      p_partida: partidaId,
      p_limite: 60
    });
    if (resp.error || chat.partidaId !== partidaId) return;
    const lista = Array.isArray(resp.data) ? resp.data : [];
    for (const m of lista) {
      if (m && m.id != null && !chat.ids.has(m.id)) {
        chat.ids.add(m.id);
        chat.mensagens.push(m);
      }
    }
    desenharChat();
  } catch (erro) {}
}

export function receberMensagemChat(msg) {
  if (!msg || msg.id == null || !chat.partidaId) return;
  if (chat.ids.has(msg.id)) return;
  chat.ids.add(msg.id);
  chat.mensagens.push(msg);
  if (chat.mensagens.length > 100) {
    const removida = chat.mensagens.shift();
    if (removida) chat.ids.delete(removida.id);
  }
  desenharChat();

  if (!chatAberto()) {
    if (!ehMinhaMensagem(msg)) {
      chat.naoLidas += 1;
      atualizarBadge();
      tocarSom('clique');
    }
    mostrarPreviewChat(msg);
  }
}

export function abrirChat() {
  if (!estado.partidaAtual) return;
  chat.naoLidas = 0;
  atualizarBadge();
  limparPreviewChat();
  abrirFolha('folha-chat');
  desenharChat();
  requestAnimationFrame(() => {
    rolarFim();
    if (window.matchMedia && window.matchMedia('(min-width: 820px)').matches) {
      const campo = $id('campo-chat');
      if (campo) campo.focus();
    }
  });
}

export async function enviarChat() {
  if (chat.enviando || !estado.partidaAtual) return;
  const campo = $id('campo-chat');
  const btn = $id('btn-enviar-chat');
  if (!campo) return;

  const texto = campo.value.trim();
  if (!texto) return;

  chat.enviando = true;
  if (btn) btn.disabled = true;

  let resp;
  try {
    resp = await banco.rpc('enviar_mensagem_chat', {
      p_partida: estado.partidaAtual.id,
      p_conta: estado.minhaConta ? estado.minhaConta.id : null,
      p_token: estado.minhaConta ? estado.minhaConta.token : null,
      p_texto: texto,
      p_jogador: estado.meuJogadorId || null,
      p_segredo: estado.meuSegredo || null
    });
  } catch (erro) {
    resp = { error: { message: 'Sem conexão para enviar mensagem.' } };
  }

  chat.enviando = false;
  if (btn) btn.disabled = false;

  if (resp.error) {
    aviso(resp.error.message || 'Não foi possível enviar a mensagem.');
    return;
  }

  campo.value = '';
  if (resp.data) {
    receberMensagemChat(resp.data);
    publicarChat(resp.data);
  }
}
