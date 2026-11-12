// Importação de horários: análise (pré-visualização) e gravação
const { DIAS_SEMANA, labelDia, letivos, temposDaEscola } = require('../horarioSlots');
const {
  EMAIL_VALIDO, chave, limpo, catalogoEscola, criarResolvedores, criarGarantidores, emTransacao, contarEstados
} = require('./comum');

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (h) => String(h || '').slice(0, 5);

// "Segunda-feira", "segunda", "seg", "2ª", "2" -> "segunda"
function normalizarDia(texto) {
  // "2ª", "2a", "2." -> "2" (só depois de um número; "qua" não pode perder o "a")
  const k = chave(texto).replace(/-?feira/, '').trim().replace(/^(\d)\s*[ªºa.]$/, '$1');
  const porNumero = { 2: 'segunda', 3: 'terca', 4: 'quarta', 5: 'quinta', 6: 'sexta' };
  if (porNumero[k]) return porNumero[k];
  const dia = DIAS_SEMANA.find((d) => k.length >= 3 && d.key.startsWith(k.slice(0, 3)));
  return dia ? dia.key : null;
}

async function analisarHorarios(escolaId, linhas, opcoes) {
  const cat = await catalogoEscola(escolaId);
  const SLOTS_LETIVOS = letivos(await temposDaEscola(escolaId));
  const resolver = criarResolvedores(cat, opcoes);

  const profPorEmail = new Map(cat.professores.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p]));
  const profPorNome = new Map();
  cat.professores.forEach((p) => profPorNome.set(chave(p.nome), [...(profPorNome.get(chave(p.nome)) || []), p]));

  function professor(texto, erros) {
    const t = limpo(texto);
    if (EMAIL_VALIDO.test(t)) {
      const p = profPorEmail.get(t.toLowerCase());
      if (p) return { id: p.id, nome: p.nome };
    } else {
      const mesmos = profPorNome.get(chave(t)) || [];
      if (mesmos.length === 1) return { id: mesmos[0].id, nome: mesmos[0].nome };
      if (mesmos.length > 1) {
        erros.push(`Há ${mesmos.length} professores chamados "${t}": escreva o email do professor em vez do nome.`);
        return null;
      }
    }
    if (opcoes.criarProfessores && !EMAIL_VALIDO.test(t)) return { nova: true, nome: t };
    erros.push(`O professor "${t}" não existe. Importe primeiro os professores ou ative "Criar professores em falta".`);
    return null;
  }

  // 1.ª passagem: interpretar cada linha
  const resolvidas = linhas.map((l) => {
    const erros = [];
    const avisos = [];
    ['turma', 'dia', 'inicio', 'disciplina', 'professor'].forEach((c) => {
      if (!limpo(l[c])) erros.push(`Falta ${({ turma: 'a turma', dia: 'o dia', inicio: 'a hora de início', disciplina: 'a disciplina', professor: 'o professor' })[c]}.`);
    });
    if (erros.length) return { l, erros, avisos };

    const turma = resolver.turma(l.turma, erros);
    const disciplina = resolver.disciplina(l.disciplina, erros);
    const prof = professor(l.professor, erros);
    const dia = normalizarDia(l.dia);
    if (!dia) erros.push(`Dia "${l.dia}" inválido (use segunda a sexta).`);

    const inicio = l.inicio;
    let fim = l.fim;
    if (!HORA.test(inicio)) erros.push(`Hora de início "${inicio}" inválida (use HH:MM, por exemplo 08:15).`);
    const bloco = SLOTS_LETIVOS.find((s) => s.inicio === inicio);
    if (!fim && bloco) fim = bloco.fim;
    if (!fim) {
      if (HORA.test(inicio)) erros.push('Falta a hora de fim (o início não coincide com um bloco do horário).');
    }
    else if (!HORA.test(fim)) erros.push(`Hora de fim "${fim}" inválida (use HH:MM).`);
    else if (HORA.test(inicio) && fim <= inicio) erros.push('A hora de fim tem de ser depois da hora de início.');
    if (HORA.test(inicio) && !bloco) avisos.push(`${inicio} não coincide com o início de um bloco da grelha: a aula pode não aparecer na grelha.`);

    return { l, erros, avisos, turma, disciplina, prof, dia, inicio, fim, sala: limpo(l.sala) };
  });

  // Substituir: apaga o horário atual das turmas (já existentes) que vêm no ficheiro
  const turmasSubstituir = new Set(
    opcoes.substituir ? resolvidas.filter((r) => !r.erros.length && r.turma.id).map((r) => r.turma.id) : []
  );

  // Ocupações atuais (menos as das turmas a substituir), para detetar conflitos
  const refId = (ref) => (ref.id ? `id:${ref.id}` : `novo:${chave(ref.nome)}`);
  const ocupacoes = cat.horarios
    .filter((h) => !turmasSubstituir.has(h.turma_id))
    .map((h) => ({
      turma: `id:${h.turma_id}`, prof: `id:${h.professor_id}`, disc: `id:${h.disciplina_id}`,
      sala: chave(h.sala), dia: h.dia_semana, inicio: hhmm(h.hora_inicio), fim: hhmm(h.hora_fim),
      onde: 'no horário atual', turmaNome: h.turma_nome, profNome: h.professor_nome, discNome: h.disciplina_nome
    }));

  // 2.ª passagem: conflitos com o horário atual e com as linhas anteriores do ficheiro
  const resultado = resolvidas.map((r) => {
    const base = { linha: r.l.linha, dados: r.l, erros: r.erros, avisos: r.avisos };
    if (r.erros.length) return { ...base, estado: 'erro' };

    const aula = {
      turma: refId(r.turma), prof: refId(r.prof), disc: refId(r.disciplina), sala: chave(r.sala),
      dia: r.dia, inicio: r.inicio, fim: r.fim,
      onde: `na linha ${r.l.linha}`, turmaNome: r.turma.nome, profNome: r.prof.nome, discNome: r.disciplina.nome
    };
    const descricao = `${labelDia(r.dia)} ${r.inicio}–${r.fim} · ${r.disciplina.nome} · ${r.prof.nome}${r.sala ? ' · ' + r.sala : ''}`;
    const sobrepostas = ocupacoes.filter((o) => o.dia === aula.dia && o.inicio < aula.fim && o.fim > aula.inicio);
    const intervalo = (o) => `${o.inicio}–${o.fim}`;

    const igual = sobrepostas.find((o) => o.turma === aula.turma && o.prof === aula.prof && o.disc === aula.disc
      && o.inicio === aula.inicio && o.fim === aula.fim);
    if (igual) return { ...base, estado: 'ignorada', descricao: `Já existe ${igual.onde}.` };

    const daTurma = sobrepostas.find((o) => o.turma === aula.turma);
    const doProf = sobrepostas.find((o) => o.prof === aula.prof);
    const daSala = aula.sala ? sobrepostas.find((o) => o.sala === aula.sala) : null;
    if (daTurma) r.erros.push(`Conflito: o ${daTurma.turmaNome} já tem ${daTurma.discNome} (${daTurma.profNome}) das ${intervalo(daTurma)} ${daTurma.onde}.`);
    if (doProf) r.erros.push(`Conflito: ${doProf.profNome} já tem aula no ${doProf.turmaNome} das ${intervalo(doProf)} ${doProf.onde}.`);
    if (daSala) r.erros.push(`Conflito: a ${r.sala} já está ocupada pelo ${daSala.turmaNome} das ${intervalo(daSala)} ${daSala.onde}.`);
    if (r.erros.length) return { ...base, estado: 'erro', descricao };

    ocupacoes.push(aula);
    return {
      ...base,
      estado: 'novo',
      turmaNome: r.turma.nome,
      descricao,
      plano: { turma: r.turma, disciplina: r.disciplina, professor: r.prof, dia: r.dia, inicio: r.inicio, fim: r.fim, sala: r.sala }
    };
  });

  const validas = resultado.filter((x) => x.plano);
  const novas = (campo) => [...new Set(validas.map((x) => x.plano[campo]).filter((x) => x.nova).map((x) => x.nome))];
  const aApagar = cat.horarios.filter((h) => turmasSubstituir.has(h.turma_id));

  return {
    linhas: resultado,
    turmasSubstituir: [...turmasSubstituir],
    resumo: {
      ...contarEstados(resultado),
      novasDisciplinas: novas('disciplina'),
      novasTurmas: novas('turma'),
      novosProfessores: novas('professor'),
      aulasApagar: aApagar.length,
      turmasApagar: [...new Set(aApagar.map((h) => h.turma_nome))]
    }
  };
}

async function gravarHorarios(escolaId, analise) {
  const contagem = { aulas: 0, apagadas: 0, disciplinasCriadas: 0, turmasCriadas: 0, professoresCriados: 0 };

  await emTransacao(async (conn) => {
    const garantir = criarGarantidores(conn, escolaId, contagem);
    const profsCriados = new Map();
    const garantirProfessor = async (ref) => {
      if (ref.id) return ref.id;
      const k = chave(ref.nome);
      if (!profsCriados.has(k)) {
        const [r] = await conn.query('INSERT INTO professores (escola_id, nome, ativo) VALUES (?, ?, 1)', [escolaId, ref.nome]);
        profsCriados.set(k, r.insertId);
        contagem.professoresCriados++;
      }
      return profsCriados.get(k);
    };

    if (analise.turmasSubstituir.length) {
      const [r] = await conn.query('DELETE FROM horarios WHERE escola_id = ? AND turma_id IN (?)', [escolaId, analise.turmasSubstituir]);
      contagem.apagadas = r.affectedRows;
    }

    for (const { plano } of analise.linhas.filter((x) => x.plano)) {
      const turmaId = await garantir.turma(plano.turma);
      const disciplinaId = await garantir.disciplina(plano.disciplina);
      const professorId = await garantirProfessor(plano.professor);
      await conn.query(
        `INSERT INTO horarios (escola_id, professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [escolaId, professorId, disciplinaId, turmaId, plano.dia, plano.inicio, plano.fim, plano.sala || null]
      );
      // Liga o professor à disciplina e à turma (assim o preenchimento automático da grelha funciona)
      await conn.query('INSERT IGNORE INTO professor_disciplinas (professor_id, disciplina_id) VALUES (?, ?)', [professorId, disciplinaId]);
      await conn.query('INSERT IGNORE INTO professor_turmas (professor_id, turma_id) VALUES (?, ?)', [professorId, turmaId]);
      contagem.aulas++;
    }
  });

  return contagem;
}

module.exports = { analisarHorarios, gravarHorarios, normalizarDia };
