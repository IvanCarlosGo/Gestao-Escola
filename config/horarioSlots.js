// Dias da semana e blocos horários usados na grelha de horários
// (Registrar Horário + separador "Horário Semanal" do perfil do professor)

const DIAS_SEMANA = [
  { key: 'segunda', label: 'Segunda-feira', curto: 'Seg' },
  { key: 'terca', label: 'Terça-feira', curto: 'Ter' },
  { key: 'quarta', label: 'Quarta-feira', curto: 'Qua' },
  { key: 'quinta', label: 'Quinta-feira', curto: 'Qui' },
  { key: 'sexta', label: 'Sexta-feira', curto: 'Sex' }
];

// Blocos de aula fixos. `intervalo: true` marca uma linha de intervalo
// (não corresponde a um horário real da tabela `horarios`).
const SLOTS = [
  { inicio: '07:30', fim: '08:15' },
  { inicio: '08:15', fim: '09:00' },
  { inicio: '09:00', fim: '09:45' },
  { inicio: '09:45', fim: '10:30', intervalo: true },
  { inicio: '10:45', fim: '11:30' },
  { inicio: '11:30', fim: '12:15' },
  { inicio: '12:15', fim: '13:00', intervalo: true },
  { inicio: '14:00', fim: '14:45' },
  { inicio: '14:45', fim: '15:30' },
  { inicio: '15:30', fim: '16:15' },
  { inicio: '16:15', fim: '17:00' }
];

// Apenas os blocos letivos (sem intervalos), usados no formulário "hora início"
const SLOTS_LETIVOS = SLOTS.filter((s) => !s.intervalo);

// Mapa do dia da semana JS (0=Domingo ... 6=Sábado) para os valores usados em `horarios.dia_semana`
const DIA_SEMANA_JS = { 1: 'segunda', 2: 'terca', 3: 'quarta', 4: 'quinta', 5: 'sexta' };

function labelDia(key) {
  const dia = DIAS_SEMANA.find((d) => d.key === key);
  return dia ? dia.label : key;
}

function turnoDeHora(horaInicio) {
  if (!horaInicio) return null;
  return horaInicio < '13:00:00' ? 'manha' : 'tarde';
}

// grelha[dia][inicioDoBloco] = aulas que ocupam esse bloco (uma aula longa ocupa vários blocos)
function montarGrelha(aulas) {
  const hhmm = (hora) => String(hora || '').slice(0, 5);
  const grelha = {};
  let blocosOcupados = 0;
  DIAS_SEMANA.forEach((dia) => {
    grelha[dia.key] = {};
    SLOTS_LETIVOS.forEach((bloco) => {
      const ocupam = aulas
        .filter((a) => a.dia_semana === dia.key && hhmm(a.hora_inicio) <= bloco.inicio && hhmm(a.hora_fim) >= bloco.fim)
        .map((a) => ({ ...a, comecaAqui: hhmm(a.hora_inicio) === bloco.inicio }));
      grelha[dia.key][bloco.inicio] = ocupam;
      if (ocupam.length) blocosOcupados++;
    });
  });
  return { grelha, blocosOcupados, totalBlocos: SLOTS_LETIVOS.length * DIAS_SEMANA.length };
}

module.exports = { DIAS_SEMANA, DIA_SEMANA_JS, SLOTS, SLOTS_LETIVOS, labelDia, turnoDeHora, montarGrelha };
