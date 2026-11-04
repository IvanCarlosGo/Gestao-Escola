// Utilitários de apresentação partilhados pelas views

// "Maria Silva" -> "MS"; "Ana" -> "AN"
function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Cor estável do avatar a partir do id (ou do nome)
const CORES_AVATAR = ['blue', 'indigo', 'purple', 'rose', 'teal', 'amber'];

function avatarCor(chave) {
  const texto = String(chave ?? '');
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma += texto.charCodeAt(i);
  return CORES_AVATAR[soma % CORES_AVATAR.length];
}

const MOTIVOS_FALTA = ['Doença', 'Consulta médica', 'Motivos pessoais', 'Formação', 'Assistência familiar', 'Outro'];

// Dias úteis (seg-sex) do mês atual
function diasUteisMes(hoje = new Date()) {
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  let total = 0;
  for (let d = 1; d <= ultimoDia; d++) {
    const dia = new Date(hoje.getFullYear(), hoje.getMonth(), d).getDay();
    if (dia !== 0 && dia !== 6) total++;
  }
  return Math.max(total, 1);
}

// Turmas: o nome guardado é "<ano>º<letra>" (ex: "10ºA") ou, com nome próprio, "<ano>º <nome>" (ex: "10º ASIBD1")
const ANOS_ESCOLARES = ['7', '8', '9', '10', '11', '12'];
const LETRAS_TURMA = 'ABCDEFGHIJKL'.split('');
const NOME_TURMA_VALIDO = /^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 -]{0,19}$/;

// "10ºA" -> { ano: '10', letra: 'A' }; "10º ASIBD1" -> { ano: '10', letra: 'ASIBD1' }
// Nomes sem ano no início devolvem { ano: null, letra: null }
function partesTurma(nome) {
  const m = String(nome || '').trim().match(/^(\d{1,2})\s*[º°]?\s*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 -]*)$/);
  if (!m) return { ano: null, letra: null };
  const letra = m[2].trim();
  return { ano: m[1], letra: letra.length === 1 ? letra.toUpperCase() : letra };
}

function nomeTurma(ano, letra) {
  const nome = String(letra || '').trim().replace(/\s+/g, ' ');
  if (!ano || !nome) return '';
  // Uma letra fica colada ("10ºA"); um nome próprio leva espaço ("10º ASIBD1")
  return nome.length === 1 ? `${ano}º${nome.toUpperCase()}` : `${ano}º ${nome}`;
}

// "2025-09-22" -> "22 Set 2025"
const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function dataCurta(valor) {
  const [ano, mes, dia] = String(valor || '').slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return '—';
  return `${dia} ${MESES_CURTOS[mes - 1]} ${ano}`;
}

module.exports = {
  iniciais, avatarCor, MOTIVOS_FALTA, diasUteisMes, dataCurta,
  ANOS_ESCOLARES, LETRAS_TURMA, NOME_TURMA_VALIDO, partesTurma, nomeTurma
};
