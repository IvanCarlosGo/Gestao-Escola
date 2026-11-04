// Aulas a decorrer num dado momento, segundo o horário (usado pelo Dashboard e pela API)
const { pool } = require('./db');
const { DIA_SEMANA_JS } = require('./horarioSlots');

const minutosDoDia = (hora) => {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
};

async function aulasAgora(agora = new Date()) {
  const hoje = agora.toLocaleDateString('sv-SE');
  const diaKey = DIA_SEMANA_JS[agora.getDay()] || null;
  const hora = agora.toTimeString().slice(0, 8);

  let aulas = [];
  let proximaAula = null;

  if (diaKey) {
    [aulas] = await pool.query(
      `SELECT h.id AS horario_id, h.hora_inicio, h.hora_fim, h.sala,
        p.id AS professor_id, p.nome AS professor_nome,
        d.id AS disciplina_id, d.nome AS disciplina_nome,
        t.id AS turma_id, t.nome AS turma_nome,
        EXISTS(SELECT 1 FROM faltas f WHERE f.professor_id = p.id AND f.data_falta = ?) AS tem_falta
       FROM horarios h
       JOIN professores p ON p.id = h.professor_id AND p.ativo = 1
       JOIN disciplinas d ON d.id = h.disciplina_id
       JOIN turmas t ON t.id = h.turma_id
       WHERE h.dia_semana = ? AND h.hora_inicio <= ? AND h.hora_fim > ?
       ORDER BY p.nome ASC`,
      [hoje, diaKey, hora, hora]
    );

    if (aulas.length === 0) {
      const [[proxima]] = await pool.query(
        `SELECT MIN(h.hora_inicio) AS hora_inicio
         FROM horarios h JOIN professores p ON p.id = h.professor_id AND p.ativo = 1
         WHERE h.dia_semana = ? AND h.hora_inicio > ?`,
        [diaKey, hora]
      );
      proximaAula = proxima && proxima.hora_inicio ? proxima : null;
    }
  }

  return { aulas, proximaAula, diaKey, hoje, hora };
}

// Acrescenta a cada aula os minutos que faltam e a % já decorrida
function calcularProgresso(aulas, agora = new Date()) {
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  aulas.forEach((a) => {
    const inicio = minutosDoDia(a.hora_inicio);
    const fim = minutosDoDia(a.hora_fim);
    a.minutosRestantes = Math.max(0, fim - agoraMin);
    a.progresso = Math.min(100, Math.max(0, Math.round(((agoraMin - inicio) / (fim - inicio)) * 100)));
  });
  return aulas;
}

module.exports = { aulasAgora, calcularProgresso };
