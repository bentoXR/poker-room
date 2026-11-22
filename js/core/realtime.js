// Sincronização em tempo real (Broadcast + Postgres Changes + fallback + heartbeat)
// Compartilhada por todos os modos de jogo
import { banco } from './supabase.js?v=102';
import { estado } from './estado.js?v=102';
import { lerDevSala } from './storage.js?v=102';

let canal = null;
let temporizadorReserva = null;
let temporizadorSinal = null;
let geracaoCanal = 0;

export function canalAtivo() {
  return canal;
}

export function publicarBroadcast(payload) {
  if (!canal) return;
  try {
    const sinal = {
      id: (payload && payload.partida && payload.partida.id) || (estado.partidaAtual && estado.partidaAtual.id) || null,
      versao: (payload && payload.partida && Number(payload.partida.versao)) || 0
    };
    canal.send({ type: 'broadcast', event: 'estado', payload: sinal }).catch(() => {});
  } catch (erro) {}
}

export function publicarChat(payload) {
  if (!canal) return;
  try {
    canal.send({ type: 'broadcast', event: 'chat', payload }).catch(() => {});
  } catch (erro) {}
}

export function publicarReacao(payload) {
  if (!canal) return;
  try {
    canal.send({ type: 'broadcast', event: 'reacao', payload }).catch(() => {});
  } catch (erro) {}
}

export function publicarDigitando(payload) {
  if (!canal) return;
  try {
    canal.send({ type: 'broadcast', event: 'digitando', payload }).catch(() => {});
  } catch (erro) {}
}

export function ligarTempoReal({ onEstado, onBuscar, onConectado, onChat, onReacao, onDigitando }) {
  desligarTempoReal();
  const idSala = estado.partidaAtual.id;
  const minhaGeracao = geracaoCanal;
  const ativo = () => minhaGeracao === geracaoCanal
    && !!estado.partidaAtual
    && estado.partidaAtual.id === idSala;
  let jaInscrito = false;

  canal = banco
    .channel('mesa-' + idSala)
    .on('broadcast', { event: 'estado' }, (msg) => {
      if (!ativo()) return;
      const v = msg && msg.payload ? Number(msg.payload.versao) : NaN;
      if (!(v <= estado.ultimaVersao)) onBuscar(false);
    })
    .on('broadcast', { event: 'chat' }, (msg) => {
      if (!ativo()) return;
      if (onChat && msg && msg.payload) onChat(msg.payload);
    })
    .on('broadcast', { event: 'reacao' }, (msg) => {
      if (!ativo()) return;
      if (onReacao && msg && msg.payload) onReacao(msg.payload);
    })
    .on('broadcast', { event: 'digitando' }, (msg) => {
      if (!ativo()) return;
      if (onDigitando && msg && msg.payload) onDigitando(msg.payload);
    })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'partidas', filter: 'id=eq.' + idSala },
      (p) => {
        if (!ativo()) return;
        if (p.eventType === 'DELETE') { onBuscar(true); return; }
        const v = p.new ? Number(p.new.versao) : NaN;
        if (!(v <= estado.ultimaVersao)) onBuscar(false);
      })
    .subscribe((status) => {
      if (!ativo()) return;
      if (status === 'SUBSCRIBED') {
        if (jaInscrito) onBuscar(false);
        jaInscrito = true;
        if (onConectado) onConectado();
      }
    });

  temporizadorReserva = setInterval(() => {
    if (!ativo()) return;
    if (!document.hidden) onBuscar(false);
  }, 20000);

  ligarSinal();
}

export function desligarTempoReal() {
  geracaoCanal++;
  desligarSinal();
  if (temporizadorReserva) {
    clearInterval(temporizadorReserva);
    temporizadorReserva = null;
  }
  if (canal) {
    banco.removeChannel(canal);
    canal = null;
  }
}

export function enviarSinal() {
  if (estado.modoDev) {
    const sala = lerDevSala();
    if (sala) {
      sala.jogadores.forEach((j) => {
        banco.rpc('ping_sala', { p_jogador: j.id, p_segredo: j.segredo }).then(() => {}, () => {});
      });
    }
    return;
  }
  if (!estado.meuJogadorId || !estado.meuSegredo) return;
  banco.rpc('ping_sala', { p_jogador: estado.meuJogadorId, p_segredo: estado.meuSegredo })
    .then(() => {}, () => {});
}

export function ligarSinal() {
  desligarSinal();
  if (!estado.meuJogadorId) return;
  enviarSinal();
  temporizadorSinal = setInterval(enviarSinal, 30000);
}

export function desligarSinal() {
  if (temporizadorSinal) {
    clearInterval(temporizadorSinal);
    temporizadorSinal = null;
  }
}
