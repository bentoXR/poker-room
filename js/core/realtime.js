// Sincronização em tempo real (Broadcast + Postgres Changes + fallback + heartbeat)
// Compartilhada por todos os modos de jogo
import { banco } from './supabase.js?v=69';
import { estado } from './estado.js?v=69';
import { lerDevSala } from './storage.js?v=69';

let canal = null;
let temporizadorReserva = null;
let temporizadorSinal = null;

export function canalAtivo() {
  return canal;
}

export function publicarBroadcast(payload) {
  if (!canal) return;
  try {
    canal.send({ type: 'broadcast', event: 'estado', payload }).catch(() => {});
  } catch (erro) {}
}

export function publicarChat(payload) {
  if (!canal) return;
  try {
    canal.send({ type: 'broadcast', event: 'chat', payload }).catch(() => {});
  } catch (erro) {}
}

export function ligarTempoReal({ onEstado, onBuscar, onConectado, onChat }) {
  desligarTempoReal();
  const idSala = estado.partidaAtual.id;
  let jaInscrito = false;

  canal = banco
    .channel('mesa-' + idSala)
    .on('broadcast', { event: 'estado' }, (msg) => {
      if (msg && msg.payload && msg.payload.partida) onEstado(msg.payload, false);
    })
    .on('broadcast', { event: 'chat' }, (msg) => {
      if (onChat && msg && msg.payload) onChat(msg.payload);
    })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'partidas', filter: 'id=eq.' + idSala },
      (p) => {
        if (p.eventType === 'DELETE') { onBuscar(true); return; }
        const v = p.new ? Number(p.new.versao) : NaN;
        if (!(v <= estado.ultimaVersao)) onBuscar(false);
      })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (jaInscrito) onBuscar(false);
        jaInscrito = true;
        if (onConectado) onConectado();
      }
    });

  temporizadorReserva = setInterval(() => {
    if (!document.hidden) onBuscar(false);
  }, 20000);

  ligarSinal();
}

export function desligarTempoReal() {
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
