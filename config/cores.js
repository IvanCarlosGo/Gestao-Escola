// Cor da escola: a partir de uma cor (#RRGGBB) gera a paleta usada no site da escola.
const COR_PADRAO = '#223C2F';

// Sugestões mostradas no painel ao criar/editar uma escola
const CORES_SUGERIDAS = [
  { cor: '#223C2F', nome: 'Verde-escuro' },
  { cor: '#1E3A8A', nome: 'Azul-marinho' },
  { cor: '#2563EB', nome: 'Azul' },
  { cor: '#0F766E', nome: 'Verde-azulado' },
  { cor: '#7C2D12', nome: 'Castanho' },
  { cor: '#9F1239', nome: 'Bordeaux' },
  { cor: '#6D28D9', nome: 'Roxo' },
  { cor: '#374151', nome: 'Cinzento' }
];

const HEX = /^#[0-9a-fA-F]{6}$/;

function paraRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paraHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

// Mistura com outra cor (t = 0 → cor original, t = 1 → outra)
function misturar(hex, outra, t) {
  const a = paraRgb(hex);
  const b = paraRgb(outra);
  return paraHex(a.map((v, i) => v + (b[i] - v) * t));
}

function luminancia(hex) {
  return paraRgb(hex)
    .map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((soma, c, i) => soma + c * [0.2126, 0.7152, 0.0722][i], 0);
}

// Contraste com texto branco (WCAG); o site usa texto branco nos botões e no menu lateral
function contrasteComBranco(hex) {
  return 1.05 / (luminancia(hex) + 0.05);
}

const CONTRASTE_MINIMO = 4.5;

// Devolve a mensagem de erro, ou null se a cor serve
function validarCor(hex) {
  if (!HEX.test(String(hex || ''))) return 'Escolha uma cor válida (formato #RRGGBB).';
  if (contrasteComBranco(hex) < CONTRASTE_MINIMO) {
    return 'Essa cor é demasiado clara: o texto branco dos botões e do menu ficaria difícil de ler. Escolha um tom mais escuro.';
  }
  return null;
}

// Variáveis CSS que substituem as do tema por omissão (null = usar o tema por omissão)
function temaDaCor(hex) {
  if (!hex || validarCor(hex)) return null;
  const cor = hex.toUpperCase();
  return {
    '--color-primary': cor,
    '--color-primary-rgb': paraRgb(cor).join(', '),
    '--color-primary-dark': misturar(cor, '#000000', 0.25),
    '--color-primary-light': misturar(cor, '#FFFFFF', 0.9),
    '--sidebar-bg': cor,
    '--sidebar-text': misturar(cor, '#FFFFFF', 0.78)
  };
}

module.exports = { COR_PADRAO, CORES_SUGERIDAS, validarCor, temaDaCor, contrasteComBranco };
