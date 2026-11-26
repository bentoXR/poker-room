// Gerenciamento de tema visual ('preto' = Preto & Vermelho [padrão] | 'claro' = Claro | 'classico' = Sinuca | 'cassino' = Cassino | 'liberdade' = EUA | 'tropical' = Praia Tropical)
const CHAVE_TEMA = 'poker-tema';
const ORDEM_TEMAS = ['preto', 'claro', 'classico', 'cassino', 'liberdade', 'tropical'];
const CORES_META = {
  classico: '#140c08',
  cassino: '#2e040c',
  preto: '#0b0c0e',
  claro: '#eef2f7',
  liberdade: '#0a3161',
  tropical: '#04384f'
};

function normalizarTema(tema) {
  if (tema === 'branco') return 'claro';
  return ORDEM_TEMAS.includes(tema) ? tema : 'preto';
}

export function lerTemaSalvo() {
  try {
    return normalizarTema(localStorage.getItem(CHAVE_TEMA));
  } catch (erro) {
    return 'preto';
  }
}

function aplicarTemaDOM(tema) {
  const ativo = normalizarTema(tema);
  document.documentElement.setAttribute('data-tema', ativo);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', CORES_META[ativo]);

  document.querySelectorAll('.tema-btn[data-tema]').forEach((btn) => {
    const sel = btn.dataset.tema === ativo;
    btn.classList.toggle('sel', sel);
    btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
    if (btn.getAttribute('role') === 'option') {
      btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
  });

  const amostraLogin = document.getElementById('tema-login-amostra');
  if (amostraLogin) {
    amostraLogin.className = 'amostra amostra-' + ativo;
  }

  const nomeLogin = document.getElementById('tema-login-nome');
  if (nomeLogin) {
    nomeLogin.setAttribute('data-i18n', 'perfil.tema_' + ativo);
    const labelOpcao = document.querySelector(`#menu-tema-login .tema-btn[data-tema="${ativo}"] [data-i18n]`);
    if (labelOpcao) {
      nomeLogin.textContent = labelOpcao.textContent;
    }
  }

  const amostraPerfil = document.getElementById('tema-perfil-amostra');
  if (amostraPerfil) {
    amostraPerfil.className = 'amostra amostra-' + ativo;
  }

  const nomePerfil = document.getElementById('tema-perfil-nome');
  if (nomePerfil) {
    nomePerfil.setAttribute('data-i18n', 'perfil.tema_' + ativo);
    const labelOpcao = document.querySelector(`#menu-tema-perfil .tema-btn[data-tema="${ativo}"] [data-i18n]`);
    if (labelOpcao) {
      nomePerfil.textContent = labelOpcao.textContent;
    }
  }
}

export function fecharMenuTemaLogin() {
  const menu = document.getElementById('menu-tema-login');
  const dropdown = document.getElementById('tema-dropdown-login');
  const btn = document.getElementById('btn-tema-login');
  if (menu) menu.hidden = true;
  if (dropdown) dropdown.classList.remove('aberto');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

export function alternarMenuTemaLogin(forcarFechar) {
  const menu = document.getElementById('menu-tema-login');
  const dropdown = document.getElementById('tema-dropdown-login');
  const btn = document.getElementById('btn-tema-login');
  if (!menu) return;
  const abrir = forcarFechar === true ? false : menu.hidden;
  menu.hidden = !abrir;
  if (dropdown) dropdown.classList.toggle('aberto', abrir);
  if (btn) btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
}

export function fecharMenuTemaPerfil() {
  const menu = document.getElementById('menu-tema-perfil');
  const dropdown = document.getElementById('tema-dropdown-perfil');
  const btn = document.getElementById('btn-tema-perfil');
  if (menu) menu.hidden = true;
  if (dropdown) dropdown.classList.remove('aberto');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

export function alternarMenuTemaPerfil(forcarFechar) {
  const menu = document.getElementById('menu-tema-perfil');
  const dropdown = document.getElementById('tema-dropdown-perfil');
  const btn = document.getElementById('btn-tema-perfil');
  if (!menu) return;
  const abrir = forcarFechar === true ? false : menu.hidden;
  if (abrir) {
    const menuIdioma = document.getElementById('menu-idioma-perfil');
    const dropdownIdioma = document.getElementById('idioma-dropdown-perfil');
    const btnIdioma = document.getElementById('btn-idioma-perfil');
    if (menuIdioma) menuIdioma.hidden = true;
    if (dropdownIdioma) dropdownIdioma.classList.remove('aberto');
    if (btnIdioma) btnIdioma.setAttribute('aria-expanded', 'false');
  }
  menu.hidden = !abrir;
  if (dropdown) dropdown.classList.toggle('aberto', abrir);
  if (btn) btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
}

export function escolherTema(tema) {
  const ativo = normalizarTema(tema);
  try { localStorage.setItem(CHAVE_TEMA, ativo); } catch (erro) {}
  aplicarTemaDOM(ativo);
  fecharMenuTemaLogin();
  fecharMenuTemaPerfil();
}

export function alternarTema() {
  const atual = normalizarTema(document.documentElement.getAttribute('data-tema'));
  const prox = ORDEM_TEMAS[(ORDEM_TEMAS.indexOf(atual) + 1) % ORDEM_TEMAS.length];
  escolherTema(prox);
}

export function iniciarTema() {
  aplicarTemaDOM(lerTemaSalvo());
}
