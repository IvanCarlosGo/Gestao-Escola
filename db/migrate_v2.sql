-- =========================================================
-- Migração v2: Turmas, Disciplinas, Horários
-- =========================================================
SET NAMES utf8mb4;

-- Disciplinas
CREATE TABLE IF NOT EXISTS disciplinas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL UNIQUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Popula disciplinas a partir dos valores já existentes em professores.disciplina
INSERT IGNORE INTO disciplinas (nome)
  SELECT DISTINCT disciplina FROM professores WHERE disciplina IS NOT NULL;

-- Disciplinas extra do catálogo (para a página de gestão ter mais variedade)
INSERT IGNORE INTO disciplinas (nome) VALUES
  ('Geografia'), ('Biologia'), ('Artes Visuais'), ('Filosofia'), ('Informática'), ('Química');

-- Turmas
CREATE TABLE IF NOT EXISTS turmas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(50) NOT NULL UNIQUE,
  ano_letivo VARCHAR(20) DEFAULT '2025/2026',
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO turmas (nome, ano_letivo) VALUES
  ('10ºA', '2025/2026'), ('10ºB', '2025/2026'),
  ('11ºA', '2025/2026'), ('11ºB', '2025/2026'),
  ('12ºA', '2025/2026'), ('12ºB', '2025/2026');

-- Professor <-> Disciplinas (N:N)
CREATE TABLE IF NOT EXISTS professor_disciplinas (
  professor_id INT NOT NULL,
  disciplina_id INT NOT NULL,
  PRIMARY KEY (professor_id, disciplina_id),
  FOREIGN KEY (professor_id) REFERENCES professores(id) ON DELETE CASCADE,
  FOREIGN KEY (disciplina_id) REFERENCES disciplinas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Liga cada professor à disciplina que já tinha associada
INSERT IGNORE INTO professor_disciplinas (professor_id, disciplina_id)
  SELECT p.id, d.id FROM professores p
  JOIN disciplinas d ON d.nome = p.disciplina
  WHERE p.disciplina IS NOT NULL;

-- Professor <-> Turmas (N:N)
CREATE TABLE IF NOT EXISTS professor_turmas (
  professor_id INT NOT NULL,
  turma_id INT NOT NULL,
  PRIMARY KEY (professor_id, turma_id),
  FOREIGN KEY (professor_id) REFERENCES professores(id) ON DELETE CASCADE,
  FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Atribui 2 turmas a cada professor existente (round-robin simples)
INSERT IGNORE INTO professor_turmas (professor_id, turma_id)
  SELECT p.id, t1.id FROM professores p
  JOIN turmas t1 ON t1.id = ((p.id - 1) % 6) + 1;
INSERT IGNORE INTO professor_turmas (professor_id, turma_id)
  SELECT p.id, t2.id FROM professores p
  JOIN turmas t2 ON t2.id = (((p.id - 1) + 2) % 6) + 1;

-- Horários (grelha semanal)
CREATE TABLE IF NOT EXISTS horarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  professor_id INT NOT NULL,
  disciplina_id INT NOT NULL,
  turma_id INT NOT NULL,
  dia_semana ENUM('segunda','terca','quarta','quinta','sexta') NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  sala VARCHAR(30),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (professor_id) REFERENCES professores(id) ON DELETE CASCADE,
  FOREIGN KEY (disciplina_id) REFERENCES disciplinas(id) ON DELETE CASCADE,
  FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx1_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'horarios' AND INDEX_NAME = 'idx_horarios_professor'
);
SET @sqlidx1 = IF(@idx1_exists = 0, 'CREATE INDEX idx_horarios_professor ON horarios(professor_id)', 'SELECT 1');
PREPARE stmtidx1 FROM @sqlidx1;
EXECUTE stmtidx1;
DEALLOCATE PREPARE stmtidx1;

SET @idx2_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'horarios' AND INDEX_NAME = 'idx_horarios_dia'
);
SET @sqlidx2 = IF(@idx2_exists = 0, 'CREATE INDEX idx_horarios_dia ON horarios(dia_semana)', 'SELECT 1');
PREPARE stmtidx2 FROM @sqlidx2;
EXECUTE stmtidx2;
DEALLOCATE PREPARE stmtidx2;

-- Liga cada falta (opcionalmente) ao horário/aula em que ocorreu
SET @col_exists0 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'faltas' AND COLUMN_NAME = 'horario_id'
);
SET @sql0 = IF(@col_exists0 = 0,
  'ALTER TABLE faltas ADD COLUMN horario_id INT NULL AFTER professor_id',
  'SELECT 1'
);
PREPARE stmt0 FROM @sql0;
EXECUTE stmt0;
DEALLOCATE PREPARE stmt0;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_faltas_horario'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE faltas ADD CONSTRAINT fk_faltas_horario FOREIGN KEY (horario_id) REFERENCES horarios(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Remove a coluna antiga de texto livre (substituída por professor_disciplinas)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'professores' AND COLUMN_NAME = 'disciplina'
);
SET @sql2 = IF(@col_exists > 0, 'ALTER TABLE professores DROP COLUMN disciplina', 'SELECT 1');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- Dados de exemplo para horários (grelha Seg-Sex, 4 blocos por professor, na sua turma principal)
INSERT INTO horarios (professor_id, disciplina_id, turma_id, dia_semana, hora_inicio, hora_fim, sala)
SELECT p.id, pd.disciplina_id, ptx.turma_id, dia.dia_semana, slot.hora_inicio, slot.hora_fim,
       CONCAT('Sala ', LPAD(FLOOR(1 + RAND() * 20), 2, '0'))
FROM professores p
JOIN professor_disciplinas pd ON pd.professor_id = p.id
JOIN (
  SELECT professor_id, MIN(turma_id) AS turma_id FROM professor_turmas GROUP BY professor_id
) ptx ON ptx.professor_id = p.id
JOIN (
  SELECT 'segunda' AS dia_semana UNION ALL SELECT 'terca' UNION ALL SELECT 'quarta'
  UNION ALL SELECT 'quinta' UNION ALL SELECT 'sexta'
) dia
JOIN (
  SELECT '07:30:00' AS hora_inicio, '08:15:00' AS hora_fim UNION ALL
  SELECT '08:15:00', '09:00:00' UNION ALL
  SELECT '09:00:00', '09:45:00' UNION ALL
  SELECT '14:00:00', '14:45:00'
) slot
WHERE NOT EXISTS (SELECT 1 FROM horarios h WHERE h.professor_id = p.id)
LIMIT 200;
