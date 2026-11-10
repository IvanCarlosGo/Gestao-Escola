// Importação de professores: análise (pré-visualização) e gravação
const {
  EMAIL_VALIDO, chave, limpo, lista, catalogoEscola, criarResolvedores, criarGarantidores, emTransacao, contarEstados
} = require('./comum');

// Cada linha fica com: estado (novo | atualizar | ignorada | erro), mensagens e o plano do que fazer
async function analisarProfessores(escolaId, linhas, opcoes) {
  const cat = await catalogoEscola(escolaId);
  const resolver = criarResolvedores(cat, opcoes);

  const porEmail = new Map(cat.professores.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p]));
  const porNome = new Map();
  cat.professores.forEach((p) => porNome.set(chave(p.nome), [...(porNome.get(chave(p.nome)) || []), p]));
  const discDe = (id) => new Set(cat.ligDisciplinas.filter((l) => l.professor_id === id).map((l) => l.disciplina_id));
  const turmasDe = (id) => new Set(cat.ligTurmas.filter((l) => l.professor_id === id).map((l) => l.turma_id));

  const vistos = new Map();

  const resultado = linhas.map((l) => {
    const erros = [];
    const avisos = [];
    const nome = limpo(l.nome);
    const email = limpo(l.email).toLowerCase();
    const telefone = limpo(l.telefone);

    if (!nome) erros.push('Falta o nome do professor.');
    if (email && !EMAIL_VALIDO.test(email)) erros.push(`Email inválido: ${email}.`);

    const k = email || chave(nome);
    if (k && vistos.has(k)) erros.push(`Professor repetido (já aparece na linha ${vistos.get(k)}).`);
    else if (k) vistos.set(k, l.linha);

    const disciplinas = lista(l.disciplinas).map((d) => resolver.disciplina(d, erros)).filter(Boolean);
    const turmas = lista(l.turmas).map((t) => resolver.turma(t, erros)).filter(Boolean);

    // Já existe? Procura pelo email; sem email, pelo nome (se não houver dois com o mesmo nome)
    let existente = email ? porEmail.get(email) : null;
    if (!existente && nome) {
      const mesmos = porNome.get(chave(nome)) || [];
      if (mesmos.length > 1) erros.push(`Há ${mesmos.length} professores chamados "${nome}": indique o email para saber qual é.`);
      else if (mesmos.length === 1 && (!email || !mesmos[0].email)) existente = mesmos[0];
    }

    const base = { linha: l.linha, dados: l, nome, erros, avisos };
    if (erros.length) return { ...base, estado: 'erro' };

    if (!existente) {
      if (!disciplinas.length) avisos.push('Sem disciplinas: pode atribuí-las depois no perfil do professor.');
      return {
        ...base,
        estado: 'novo',
        descricao: [disciplinas.map((d) => d.nome).join(', '), turmas.map((t) => t.nome).join(', ')].filter(Boolean).join(' · '),
        plano: { acao: 'novo', nome, email, telefone, disciplinas, turmas }
      };
    }

    // Atualizar: só acrescenta (disciplinas, turmas, contactos em falta); nunca apaga nada
    const jaDisc = discDe(existente.id);
    const jaTurmas = turmasDe(existente.id);
    const novasDisc = disciplinas.filter((d) => d.nova || !jaDisc.has(d.id));
    const novasTurmas = turmas.filter((t) => t.nova || !jaTurmas.has(t.id));
    const mudancas = [];
    const plano = { acao: 'atualizar', id: existente.id, disciplinas: novasDisc, turmas: novasTurmas };

    if (email && !existente.email) { plano.email = email; mudancas.push('email'); }
    if (telefone && telefone !== existente.telefone) { plano.telefone = telefone; mudancas.push('telefone'); }
    novasDisc.forEach((d) => mudancas.push(`+ ${d.nome}`));
    novasTurmas.forEach((t) => mudancas.push(`+ ${t.nome}`));

    if (!mudancas.length) return { ...base, estado: 'ignorada', descricao: 'Já existe, sem alterações.' };
    return { ...base, estado: 'atualizar', descricao: `Já existe: ${mudancas.join(', ')}`, plano };
  });

  const validas = resultado.filter((r) => r.plano);
  const novas = (campo) => [...new Set(validas.flatMap((r) => r.plano[campo]).filter((x) => x.nova).map((x) => x.nome))];

  return {
    linhas: resultado,
    resumo: { ...contarEstados(resultado), novasDisciplinas: novas('disciplinas'), novasTurmas: novas('turmas') }
  };
}

async function gravarProfessores(escolaId, analise) {
  const contagem = { criados: 0, atualizados: 0, disciplinasCriadas: 0, turmasCriadas: 0 };

  await emTransacao(async (conn) => {
    const garantir = criarGarantidores(conn, escolaId, contagem);

    for (const { plano } of analise.linhas.filter((r) => r.plano)) {
      let id = plano.id;
      if (plano.acao === 'novo') {
        const [r] = await conn.query(
          'INSERT INTO professores (escola_id, nome, email, telefone, ativo) VALUES (?, ?, ?, ?, 1)',
          [escolaId, plano.nome, plano.email || null, plano.telefone || null]
        );
        id = r.insertId;
        contagem.criados++;
      } else {
        if (plano.email) await conn.query('UPDATE professores SET email = ? WHERE id = ? AND escola_id = ?', [plano.email, id, escolaId]);
        if (plano.telefone) await conn.query('UPDATE professores SET telefone = ? WHERE id = ? AND escola_id = ?', [plano.telefone, id, escolaId]);
        contagem.atualizados++;
      }
      for (const d of plano.disciplinas) {
        await conn.query('INSERT IGNORE INTO professor_disciplinas (professor_id, disciplina_id) VALUES (?, ?)', [id, await garantir.disciplina(d)]);
      }
      for (const t of plano.turmas) {
        await conn.query('INSERT IGNORE INTO professor_turmas (professor_id, turma_id) VALUES (?, ?)', [id, await garantir.turma(t)]);
      }
    }
  });

  return contagem;
}

module.exports = { analisarProfessores, gravarProfessores };
