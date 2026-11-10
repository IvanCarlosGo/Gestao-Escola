// Leitura de ficheiros (.xlsx, .csv) e de texto colado -> linhas com campos em texto
const ExcelJS = require('exceljs');
const { MAX_LINHAS, chave, limpo } = require('./comum');

// Colunas de cada importação: nome do campo, título no modelo e outros nomes aceites no cabeçalho
const COLUNAS = {
  professores: {
    campos: ['nome', 'email', 'telefone', 'disciplinas', 'turmas'],
    // Ordem das colunas quando se cola uma lista sem cabeçalho
    ordemColar: ['nome', 'disciplinas', 'turmas', 'email', 'telefone'],
    obrigatoriosCabecalho: ['nome'],
    sinonimos: {
      nome: ['nome', 'nome completo', 'professor', 'professora', 'docente'],
      email: ['email', 'e-mail', 'mail', 'correio eletronico'],
      telefone: ['telefone', 'telemovel', 'contacto', 'tel', 'telefone / telemovel'],
      disciplinas: ['disciplinas', 'disciplina'],
      turmas: ['turmas', 'turma']
    }
  },
  horarios: {
    campos: ['turma', 'dia', 'inicio', 'fim', 'disciplina', 'professor', 'sala'],
    ordemColar: ['turma', 'dia', 'inicio', 'fim', 'disciplina', 'professor', 'sala'],
    obrigatoriosCabecalho: ['turma', 'professor'],
    horas: ['inicio', 'fim'],
    sinonimos: {
      turma: ['turma', 'classe'],
      dia: ['dia', 'dia da semana'],
      inicio: ['inicio', 'hora inicio', 'hora de inicio', 'hora inicial', 'entrada', 'de'],
      fim: ['fim', 'hora fim', 'hora de fim', 'termino', 'hora final', 'saida', 'ate'],
      disciplina: ['disciplina', 'materia', 'cadeira'],
      professor: ['professor', 'professora', 'docente', 'nome do professor'],
      sala: ['sala', 'local']
    }
  }
};

// Valor de uma célula do Excel em texto (ou Date/número, para as horas)
function valorCelula(v) {
  if (v == null) return '';
  if (v instanceof Date || typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return valorCelula(v.result);
    return '';
  }
  return String(v);
}

// "8:15", "08h15", "8.15", 08:15 do Excel (Date/fração do dia) -> "08:15"; texto inválido fica como está
function normalizarHora(v) {
  const p2 = (n) => String(n).padStart(2, '0');
  if (v instanceof Date) return `${p2(v.getUTCHours())}:${p2(v.getUTCMinutes())}`;
  if (typeof v === 'number') {
    if (v > 0 && v < 1) {
      const min = Math.round(v * 1440);
      return `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;
    }
    if (Number.isInteger(v) && v >= 0 && v < 24) return `${p2(v)}:00`;
  }
  const texto = limpo(v);
  const m = /^(\d{1,2})\s*(?:[:hH.]\s*(\d{1,2}))?\s*(?:h|min)?$/i.exec(texto);
  if (m && Number(m[1]) < 24 && Number(m[2] || 0) < 60) return `${p2(Number(m[1]))}:${p2(Number(m[2] || 0))}`;
  return texto;
}

// ---------- CSV ----------

// O Excel português grava CSV com ";" e, muitas vezes, em Windows-1252 (não UTF-8)
function descodificar(buffer) {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  return buffer.toString('latin1');
}

function lerCsv(texto) {
  const primeira = texto.split(/\r?\n/).find((l) => l.trim()) || '';
  const contar = (c) => primeira.split(c).length - 1;
  const sep = ['\t', ';', ','].reduce((melhor, c) => (contar(c) > contar(melhor) ? c : melhor), ';');

  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.map((valores, i) => ({ n: i + 1, valores }));
}

// ---------- Excel ----------

async function lerXlsx(buffer, tipo) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // Prefere a folha com o nome certo ("Professores" / "Horários"); ignora as folhas de apoio do modelo
  const procurada = tipo === 'professores' ? 'prof' : 'horar';
  const folhas = wb.worksheets.filter((w) => !/instru|lista/.test(chave(w.name)));
  const folha = folhas.find((w) => chave(w.name).includes(procurada)) || folhas[0] || wb.worksheets[0];
  if (!folha) return [];

  const linhas = [];
  folha.eachRow({ includeEmpty: false }, (row, n) => {
    const valores = [];
    for (let c = 1; c <= Math.max(row.cellCount, 8); c++) valores.push(valorCelula(row.getCell(c).value));
    linhas.push({ n, valores });
  });
  return linhas;
}

// ---------- Ficheiro / texto -> linhas com campos ----------

async function lerFicheiro(ficheiro, tipo) {
  const nome = String(ficheiro.originalname || '').toLowerCase();
  try {
    if (nome.endsWith('.xlsx')) return { tabela: await lerXlsx(ficheiro.buffer, tipo) };
    if (nome.endsWith('.csv') || nome.endsWith('.txt')) return { tabela: lerCsv(descodificar(ficheiro.buffer)) };
  } catch (err) {
    return { erro: 'Não foi possível ler o ficheiro. Confirme que é um Excel (.xlsx) ou CSV válido.' };
  }
  if (nome.endsWith('.xls')) return { erro: 'O formato .xls antigo não é suportado. No Excel use "Guardar como" → "Livro do Excel (.xlsx)".' };
  return { erro: 'Formato não suportado. Use um ficheiro Excel (.xlsx) ou CSV.' };
}

// Texto colado (de uma folha de cálculo vem separado por tabulações; à mão, separe as colunas com ";")
function lerTexto(texto) {
  const t = String(texto || '');
  const sep = t.includes('\t') ? '\t' : ';';
  return t.split(/\r?\n/).map((l, i) => ({ n: i + 1, valores: l.split(sep) }));
}

// Converte a tabela em objetos { linha, campo: texto }, reconhecendo o cabeçalho (em qualquer ordem)
function mapearLinhas(tipo, tabela, { colado = false } = {}) {
  const def = COLUNAS[tipo];
  const naoVazias = tabela.filter((l) => l.valores.some((v) => limpo(v instanceof Date ? 'x' : v)));
  if (!naoVazias.length) return { linhas: [] };

  const campoDoTitulo = (titulo) => {
    const k = chave(String(titulo).replace(/\(.*?\)|\*/g, ''));
    return def.campos.find((campo) => def.sinonimos[campo].includes(k)) || null;
  };
  const cabecalho = naoVazias[0].valores.map(campoDoTitulo);
  const temCabecalho = def.obrigatoriosCabecalho.every((c) => cabecalho.includes(c));

  const ordem = temCabecalho ? cabecalho : (colado ? def.ordemColar : def.campos);
  const dados = temCabecalho ? naoVazias.slice(1) : naoVazias;
  if (dados.length > MAX_LINHAS) return { erro: `O ficheiro tem ${dados.length} linhas; o máximo por importação é ${MAX_LINHAS}.` };

  const linhas = dados.map(({ n, valores }) => {
    const obj = { linha: n };
    def.campos.forEach((campo) => { obj[campo] = ''; });
    ordem.forEach((campo, i) => {
      if (!campo || i >= valores.length) return;
      const v = valores[i];
      obj[campo] = (def.horas || []).includes(campo) ? normalizarHora(v) : limpo(v instanceof Date ? v.toISOString().slice(0, 10) : v);
    });
    return obj;
  }).filter((l) => def.campos.some((c) => l[c]));

  return { linhas };
}

// Os dados voltam do formulário de confirmação: aceita só os campos conhecidos, em texto
function sanitizarLinhas(tipo, json) {
  let bruto;
  try { bruto = JSON.parse(json); } catch (e) { return null; }
  if (!Array.isArray(bruto) || bruto.length > MAX_LINHAS) return null;
  const { campos } = COLUNAS[tipo];
  return bruto.map((l) => {
    const obj = { linha: Number(l && l.linha) || 0 };
    campos.forEach((c) => { obj[c] = limpo(l && l[c]).slice(0, 300); });
    return obj;
  });
}

module.exports = { COLUNAS, lerFicheiro, lerTexto, mapearLinhas, sanitizarLinhas, normalizarHora };
