// Gestão de perfil do usuário: foto de perfil (compressão local), nome único, troca de senha e cache de avatares na mesa
import { banco } from '../core/supabase.js?v=80';
import { estado, contaParams } from '../core/estado.js?v=80';
import { guardarConta, lembrarNome } from '../core/storage.js?v=80';
import { $id, aviso, mostrarErro, limparErro } from '../core/ui.js?v=80';
import { tratarErroConta } from './auth.js?v=80';
import { lerTemaSalvo, escolherTema } from '../core/tema.js?v=80';

// Cache em memória de avatares: conta_id -> { versao, url }
const avataresCache = new Map();
const buscandoContas = new Set();
let perfilSincronizadoId = null;

export function limparCachePerfil() {
  perfilSincronizadoId = null;
}

export function definirAvatarCache(contaId, versao, url) {
  if (!contaId) return;
  avataresCache.set(contaId, {
    versao: Number(versao) || 0,
    url: validarUrlAvatar(url)
  });
}

export function validarUrlAvatar(url) {
  if (typeof url !== 'string') return null;
  if (/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  return null;
}

export function obterAvatarUrl(contaId) {
  if (!contaId) return null;
  const item = avataresCache.get(contaId);
  if (item && item.url) return item.url;
  if (estado.minhaConta && estado.minhaConta.id === contaId) {
    return validarUrlAvatar(estado.minhaConta.avatar_url);
  }
  return null;
}

// Busca sob demanda apenas avatares novos/atualizados dos jogadores da mesa
export async function sincronizarAvataresMesa(jogadores, onAtualizado) {
  if (!Array.isArray(jogadores) || !jogadores.length) return;
  const faltantes = [];

  for (const j of jogadores) {
    const cid = j && j.conta_id;
    if (!cid) continue;
    const v = Number(j.avatar_versao) || 0;
    const cached = avataresCache.get(cid);
    if (v === 0) {
      if (cached && cached.url) avataresCache.set(cid, { versao: 0, url: null });
      continue;
    }
    if ((!cached || cached.versao !== v) && !buscandoContas.has(cid)) {
      faltantes.push(cid);
    }
  }

  if (!faltantes.length) return;
  faltantes.forEach((id) => buscandoContas.add(id));

  try {
    const resp = await banco.rpc('buscar_avatares', { p_contas: faltantes });
    if (!resp.error && Array.isArray(resp.data)) {
      let mudou = false;
      for (const row of resp.data) {
        if (!row || !row.id) continue;
        const urlSegura = validarUrlAvatar(row.avatar_url);
        const ant = avataresCache.get(row.id);
        const v = Number(row.avatar_versao) || 0;
        if (!ant || ant.versao !== v || ant.url !== urlSegura) mudou = true;
        avataresCache.set(row.id, { versao: v, url: urlSegura });
      }
      if (mudou && typeof onAtualizado === 'function') onAtualizado();
    }
  } catch (erro) {
  } finally {
    faltantes.forEach((id) => buscandoContas.delete(id));
  }
}

// Renderiza foto ou inicial dentro de um círculo de avatar no lobby/perfil
export function renderizarAvatarElemento(el, nome, avatarUrl) {
  if (!el) return;
  const url = validarUrlAvatar(avatarUrl);
  if (url) {
    el.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = nome || 'Foto de perfil';
    img.className = 'avatar-img';
    el.appendChild(img);
    el.classList.add('com-foto');
  } else {
    el.classList.remove('com-foto');
    el.textContent = (nome || '').trim().charAt(0).toUpperCase() || '♠';
  }
}

export function atualizarCabecalhoPerfil() {
  if (!estado.minhaConta) return;
  const nome = estado.minhaConta.nome || '';
  const avatar = validarUrlAvatar(estado.minhaConta.avatar_url);
  const nomeEl = $id('salas-nome');
  if (nomeEl) nomeEl.textContent = nome;
  renderizarAvatarElemento($id('salas-avatar'), nome, avatar);
  if (estado.minhaConta.id) {
    definirAvatarCache(estado.minhaConta.id, estado.minhaConta.avatar_versao || 0, avatar);
  }
}

export async function sincronizarMeuPerfil() {
  if (!estado.minhaConta || perfilSincronizadoId === estado.minhaConta.id) return;
  perfilSincronizadoId = estado.minhaConta.id;
  try {
    const resp = await banco.rpc('obter_perfil', contaParams());
    if (resp.error) {
      perfilSincronizadoId = null;
      tratarErroConta(resp.error);
      return;
    }
    if (resp.data && estado.minhaConta) {
      estado.minhaConta.nome = resp.data.nome || estado.minhaConta.nome;
      estado.minhaConta.avatar_url = validarUrlAvatar(resp.data.avatar_url);
      estado.minhaConta.avatar_versao = Number(resp.data.avatar_versao) || 0;
      guardarConta(estado.minhaConta);
      lembrarNome(estado.minhaConta.nome);
      atualizarCabecalhoPerfil();
    }
  } catch (erro) {
    perfilSincronizadoId = null;
  }
}

// ----- Modal / Gaveta Meu Perfil -----
export function perfilAberto() {
  const f = $id('folha-perfil');
  return !!(f && !f.hidden);
}

export function abrirPerfil() {
  if (!estado.minhaConta) return;
  limparErro('erro-perfil');
  limparErro('erro-senha-perfil');

  const nome = estado.minhaConta.nome || '';
  const avatar = validarUrlAvatar(estado.minhaConta.avatar_url);
  renderizarAvatarElemento($id('perfil-avatar-preview'), nome, avatar);
  const btnRem = $id('btn-remover-foto');
  if (btnRem) btnRem.hidden = !avatar;

  const campoNome = $id('campo-perfil-nome');
  if (campoNome) campoNome.value = nome;

  ['campo-senha-atual', 'campo-senha-nova', 'campo-senha-nova-conf'].forEach((id) => {
    const el = $id(id);
    if (el) el.value = '';
  });

  escolherTema(lerTemaSalvo());
  const btnEspiar = $id('btn-perfil-espiar');
  if (btnEspiar) {
    let segurando = false;
    try { segurando = localStorage.getItem('poker-espiar-segurar') === '1'; } catch (e) {}
    btnEspiar.textContent = segurando ? 'Ativado' : 'Desativado';
    btnEspiar.classList.toggle('ativo', segurando);
    btnEspiar.setAttribute('aria-pressed', segurando ? 'true' : 'false');
  }

  $id('fundo-perfil').hidden = false;
  $id('folha-perfil').hidden = false;
}

export function fecharPerfil() {
  const f = $id('folha-perfil');
  const bg = $id('fundo-perfil');
  if (f) f.hidden = true;
  if (bg) bg.hidden = true;
}

export function acionarEscolhaFoto() {
  const input = $id('input-foto-perfil');
  if (input) {
    input.value = '';
    input.click();
  }
}

// Recorta em quadrado 160x160 e comprime no navegador (WebP com fallback JPEG)
function comprimirFoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || '')) {
      reject(new Error('Escolha um arquivo de imagem (JPG, PNG ou WebP).'));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error('Imagem muito grande. Escolha uma foto de até 12 MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não consegui ler essa imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagem não suportado.'));
      img.onload = () => {
        const lado = Math.min(img.width, img.height);
        const sx = Math.floor((img.width - lado) / 2);
        const sy = Math.floor((img.height - lado) / 2);

        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, lado, lado, 0, 0, 160, 160);

        let dataUrl = canvas.toDataURL('image/webp', 0.82);
        if (!dataUrl.startsWith('data:image/webp;base64,')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        }
        if (dataUrl.length > 62000) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        }
        if (dataUrl.length > 64000) {
          reject(new Error('Não consegui comprimir essa foto. Tente outra imagem.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function aoEscolherFotoPerfil(input) {
  const file = input && input.files && input.files[0];
  if (!file || !estado.minhaConta) return;
  limparErro('erro-perfil');

  const btnFoto = $id('btn-escolher-foto');
  if (btnFoto) { btnFoto.disabled = true; btnFoto.textContent = 'Salvando foto...'; }

  try {
    const dataUrl = await comprimirFoto(file);
    const resp = await banco.rpc('atualizar_perfil', {
      ...contaParams(),
      p_avatar: dataUrl
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharPerfil(); return; }
      mostrarErro('erro-perfil', resp.error.message || 'Erro ao salvar foto.');
    } else if (resp.data) {
      estado.minhaConta.avatar_url = validarUrlAvatar(resp.data.avatar_url);
      estado.minhaConta.avatar_versao = Number(resp.data.avatar_versao) || 0;
      guardarConta(estado.minhaConta);
      atualizarCabecalhoPerfil();
      renderizarAvatarElemento($id('perfil-avatar-preview'), estado.minhaConta.nome, estado.minhaConta.avatar_url);
      const btnRem = $id('btn-remover-foto');
      if (btnRem) btnRem.hidden = !estado.minhaConta.avatar_url;
      aviso('Foto de perfil atualizada!');
    }
  } catch (erro) {
    mostrarErro('erro-perfil', erro.message || 'Não consegui processar a foto.');
  } finally {
    if (btnFoto) { btnFoto.disabled = false; btnFoto.textContent = 'Escolher foto'; }
  }
}

export async function removerFotoPerfil() {
  if (!estado.minhaConta) return;
  limparErro('erro-perfil');
  const btn = $id('btn-remover-foto');
  if (btn) btn.disabled = true;

  try {
    const resp = await banco.rpc('atualizar_perfil', {
      ...contaParams(),
      p_remover_avatar: true
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharPerfil(); return; }
      mostrarErro('erro-perfil', resp.error.message || 'Erro ao remover foto.');
    } else if (resp.data) {
      estado.minhaConta.avatar_url = null;
      estado.minhaConta.avatar_versao = Number(resp.data.avatar_versao) || 0;
      guardarConta(estado.minhaConta);
      atualizarCabecalhoPerfil();
      renderizarAvatarElemento($id('perfil-avatar-preview'), estado.minhaConta.nome, null);
      if (btn) btn.hidden = true;
      aviso('Foto removida.');
    }
  } catch (erro) {
    mostrarErro('erro-perfil', 'Sem conexão. Tente novamente.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function salvarNomePerfil() {
  if (!estado.minhaConta) return;
  limparErro('erro-perfil');
  const novoNome = ($id('campo-perfil-nome').value || '').trim().replace(/\s+/g, ' ');
  if (novoNome.length < 2) {
    mostrarErro('erro-perfil', 'O nome precisa ter pelo menos 2 caracteres.');
    return;
  }
  if (novoNome.length > 10) {
    mostrarErro('erro-perfil', 'O nome pode ter no máximo 10 caracteres.');
    return;
  }

  const btn = $id('btn-salvar-nome');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    const resp = await banco.rpc('atualizar_perfil', {
      ...contaParams(),
      p_nome: novoNome
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharPerfil(); return; }
      mostrarErro('erro-perfil', resp.error.message || 'Erro ao atualizar nome.');
    } else if (resp.data) {
      estado.minhaConta.nome = resp.data.nome;
      guardarConta(estado.minhaConta);
      lembrarNome(resp.data.nome);
      atualizarCabecalhoPerfil();
      renderizarAvatarElemento($id('perfil-avatar-preview'), estado.minhaConta.nome, estado.minhaConta.avatar_url);
      aviso('Nome atualizado!');
    }
  } catch (erro) {
    mostrarErro('erro-perfil', 'Sem conexão. Tente novamente.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar nome'; }
  }
}

export async function alterarSenhaPerfil() {
  if (!estado.minhaConta) return;
  limparErro('erro-senha-perfil');

  const atual = ($id('campo-senha-atual').value || '').trim();
  const nova = ($id('campo-senha-nova').value || '').trim();
  const conf = ($id('campo-senha-nova-conf').value || '').trim();

  if (!atual) { mostrarErro('erro-senha-perfil', 'Digite sua senha atual.'); return; }
  if (nova.length < 6) { mostrarErro('erro-senha-perfil', 'A nova senha precisa ter pelo menos 6 caracteres.'); return; }
  if (nova !== conf) { mostrarErro('erro-senha-perfil', 'A confirmação da nova senha não confere.'); return; }

  const btn = $id('btn-alterar-senha');
  if (btn) { btn.disabled = true; btn.textContent = 'Alterando...'; }

  try {
    const resp = await banco.rpc('alterar_senha', {
      ...contaParams(),
      p_senha_atual: atual,
      p_nova_senha: nova
    });
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharPerfil(); return; }
      mostrarErro('erro-senha-perfil', resp.error.message || 'Não consegui alterar a senha.');
    } else if (resp.data) {
      estado.minhaConta.token = resp.data.token;
      guardarConta(estado.minhaConta);
      $id('campo-senha-atual').value = '';
      $id('campo-senha-nova').value = '';
      $id('campo-senha-nova-conf').value = '';
      aviso('Senha alterada! Outras sessões foram desconectadas.');
    }
  } catch (erro) {
    mostrarErro('erro-senha-perfil', 'Sem conexão. Tente novamente.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Alterar senha'; }
  }
}

export async function encerrarOutrasSessoes() {
  if (!estado.minhaConta) return;
  limparErro('erro-senha-perfil');
  const btn = $id('btn-encerrar-sessoes');
  if (btn) btn.disabled = true;

  try {
    const resp = await banco.rpc('encerrar_outras_sessoes', contaParams());
    if (resp.error) {
      if (tratarErroConta(resp.error)) { fecharPerfil(); return; }
      mostrarErro('erro-senha-perfil', resp.error.message || 'Erro ao encerrar sessões.');
    } else if (resp.data && resp.data.token) {
      estado.minhaConta.token = resp.data.token;
      guardarConta(estado.minhaConta);
      aviso('Sessões em outros aparelhos foram encerradas!');
    }
  } catch (erro) {
    mostrarErro('erro-senha-perfil', 'Sem conexão. Tente novamente.');
  } finally {
    if (btn) btn.disabled = false;
  }
}
