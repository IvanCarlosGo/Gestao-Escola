// Dias da semana e tempos (blocos) do horário diário.
// Cada escola escolhe um modelo de horário em Definições e pode ajustá-lo (coluna escolas.tempos, em JSON);
// sem isso usa-se o "Horário geral". Em ambos os modelos as aulas duram 50 min e a tarde começa às 13:00.
const { pool } = require('./db');

const DIAS_SEMANA = [
  { key: 'segunda', label: 'Segunda-feira', curto: 'Seg' },
  { key: 'terca', label: 'Terça-feira', curto: 'Ter' },
  { key: 'quarta', label: 'Quarta-feira', curto: 'Qua' },
  { key: 'quinta', label: 'Quinta-feira', curto: 'Qui' },
  { key: 'sexta', label: 'Sexta-feira', curto: 'Sex' }
];

// Modelos de horário (aulas de 50 min; `intervalo: true` marca um intervalo, que não recebe aulas).
// Os 10 min entre aulas não são intervalos: são a mudança de sala.
const MODELOS_HORARIO = {
  praia: {
    nome: 'Horário da Cidade da Praia',
    tempos: [
      // Manhã
      { inicio: '07:30', fim: '08:20' },
      { inicio: '08:30', fim: '09:20' },
      { inicio: '09:30', fim: '10:20' },
      { inicio: '10:20', fim: '10:40', intervalo: true },
      { inicio: '10:40', fim: '11:30' },
      { inicio: '11:30', fim: '12:20' },
      // Tarde
      { inicio: '13:00', fim: '13:50' },
      { inicio: '14:00', fim: '14:50' },
      { inicio: '15:00', fim: '15:50' },
      { inicio: '15:50', fim: '16:10', intervalo: true },
      { inicio: '16:10', fim: '17:00' },
      { inicio: '17:00', fim: '17:50' }
    ]
  },
  geral: {
    nome: 'Horário geral',
    tempos: [
      // Manhã
      { inicio: '08:00', fim: '08:50' },
      { inicio: '09:00', fim: '09:50' },
      { inicio: '10:00', fim: '10:50' },
      { inicio: '11:00', fim: '11:50' },
      { inicio: '12:00', fim: '12:50' },
      // Tarde
      { inicio: '13:00', fim: '13:50' },
      { inicio: '14:00', fim: '14:50' },
      { inicio: '15:00', fim: '15:50' },
      { inicio: '16:00', fim: '16:50' },
      { inicio: '17:00', fim: '17:50' }
    ]
  }
};

// Escolas sem horário definido usam o Horário geral
const MODELO_PADRAO = 'geral';
const TEMPOS_PADRAO = MODELOS_HORARIO[MODELO_PADRAO].tempos;

// Modelo a que uma lista de tempos corresponde, ou null se foi personalizada
function modeloDosTempos(tempos) {
  const chave = (lista) => JSON.stringify(lista.map((t) => [t.inicio, t.fim, Boolean(t.intervalo)]));
  const procurada = chave(tempos);
  return Object.keys(MODELOS_HORARIO).find((k) => chave(MODELOS_HORARIO[k].tempos) === procurada) || null;
}

// A tarde começa às 13:00
const INICIO_TARDE = '13:00';
const MAX_TEMPOS = 24;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mapa do dia da semana JS (0=Domingo ... 6=Sábado) para os valores usados em `horarios.dia_semana`
const DIA_SEMANA_JS = { 1: 'segunda', 2: 'terca', 3: 'quarta', 4: 'quinta', 5: 'sexta' };

function labelDia(key) {
  const dia = DIAS_SEMANA.find((d) => d.key === key);
  return dia ? dia.label : key;
}

function turnoDeHora(horaInicio) {
  if (!horaInicio) return null;
  return String(horaInicio).slice(0, 5) < INICIO_TARDE ? 'manha' : 'tarde';
}

// Só os tempos letivos (sem intervalos)
const letivos = (tempos) => tempos.filter((t) => !t.intervalo);

// Valida e normaliza uma lista de tempos: devolve { tempos } ou { erro }
function validarTempos(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return { erro: 'Indique pelo menos um tempo.' };
  if (lista.length > MAX_TEMPOS) return { erro: `No máximo ${MAX_TEMPOS} tempos por dia.` };

  const tempos = [];
  for (const [i, t] of lista.entries()) {
    const inicio = String((t && t.inicio) || '').trim().slice(0, 5);
    const fim = String((t && t.fim) || '').trim().slice(0, 5);
    if (!HORA.test(inicio) || !HORA.test(fim)) return { erro: `Linha ${i + 1}: use horas no formato HH:MM.` };
    if (fim <= inicio) return { erro: `Linha ${i + 1}: o fim (${fim}) tem de ser depois do início (${inicio}).` };
    tempos.push(t.intervalo ? { inicio, fim, intervalo: true } : { inicio, fim });
  }
  tempos.sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (let i = 1; i < tempos.length; i++) {
    if (tempos[i].inicio < tempos[i - 1].fim) {
      return { erro: `${tempos[i - 1].inicio}–${tempos[i - 1].fim} e ${tempos[i].inicio}–${tempos[i].fim} sobrepõem-se.` };
    }
  }
  if (letivos(tempos).length === 0) return { erro: 'Tem de haver pelo menos um tempo de aula (não só intervalos).' };
  return { tempos };
}

// Tempos de uma escola: os definidos em Definições, ou o horário padrão
async function temposDaEscola(escolaId) {
  const [[escola]] = await pool.query('SELECT tempos FROM escolas WHERE id = ?', [escolaId]);
  if (!escola || !escola.tempos) return TEMPOS_PADRAO;
  try {
    const { tempos } = validarTempos(JSON.parse(escola.tempos));
    return tempos || TEMPOS_PADRAO;
  } catch {
    return TEMPOS_PADRAO;
  }
}

// Aulas que não coincidem com os tempos (início e fim têm de ser limites de tempos letivos)
function aulasForaDosTempos(aulas, tempos) {
  const hhmm = (hora) => String(hora || '').slice(0, 5);
  const inicios = new Set(letivos(tempos).map((t) => t.inicio));
  const fins = new Set(letivos(tempos).map((t) => t.fim));
  return aulas.filter((a) => !inicios.has(hhmm(a.hora_inicio)) || !fins.has(hhmm(a.hora_fim)));
}

// grelha[dia][inicioDoBloco] = aulas que ocupam esse bloco (uma aula longa ocupa vários blocos)
function montarGrelha(aulas, tempos = TEMPOS_PADRAO) {
  const hhmm = (hora) => String(hora || '').slice(0, 5);
  const blocos = letivos(tempos);
  const grelha = {};
  let blocosOcupados = 0;
  DIAS_SEMANA.forEach((dia) => {
    grelha[dia.key] = {};
    blocos.forEach((bloco) => {
      const ocupam = aulas
        .filter((a) => a.dia_semana === dia.key && hhmm(a.hora_inicio) <= bloco.inicio && hhmm(a.hora_fim) >= bloco.fim)
        .map((a) => ({ ...a, comecaAqui: hhmm(a.hora_inicio) === bloco.inicio }));
      grelha[dia.key][bloco.inicio] = ocupam;
      if (ocupam.length) blocosOcupados++;
    });
  });
  return { grelha, blocosOcupados, totalBlocos: blocos.length * DIAS_SEMANA.length };
}

module.exports = {
  DIAS_SEMANA, DIA_SEMANA_JS, MODELOS_HORARIO, MODELO_PADRAO, TEMPOS_PADRAO, INICIO_TARDE, modeloDosTempos,
  labelDia, turnoDeHora, letivos, validarTempos, temposDaEscola, aulasForaDosTempos, montarGrelha
};
