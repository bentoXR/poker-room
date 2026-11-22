// Gerenciamento de tema visual ('preto' = Preto & Vermelho [padrão] | 'classico' = Sinuca | 'cassino' = Cassino | 'liberdade' = EUA | 'tropical' = Praia Tropical)
const CHAVE_TEMA = 'poker-tema';
const ORDEM_TEMAS = ['preto', 'branco', 'classico', 'cassino', 'liberdade', 'tropical'];
const CORES_META = {
  classico: '#140c08',
  cassino: '#2e040c',
  preto: '#0b0c0e',
  branco: '#f4f6fa',
  liberdade: '#0a3161',
  tropical: '#04384f'
};

function normalizarTema(tema) {
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
  });
}

export function escolherTema(tema) {
  const ativo = normalizarTema(tema);
  try { localStorage.setItem(CHAVE_TEMA, ativo); } catch (erro) {}
  aplicarTemaDOM(ativo);
}

export function alternarTema() {
  const atual = normalizarTema(document.documentElement.getAttribute('data-tema'));
  const prox = ORDEM_TEMAS[(ORDEM_TEMAS.indexOf(atual) + 1) % ORDEM_TEMAS.length];
  escolherTema(prox);
}

export function iniciarTema() {
  aplicarTemaDOM(lerTemaSalvo());
}
