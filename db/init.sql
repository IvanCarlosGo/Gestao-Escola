-- Base de dados: Gestão de Faltas de Professores
-- Este script corre automaticamente quando o container MySQL é criado
-- (montado em /docker-entrypoint-initdb.d)

SET NAMES utf8mb4;

-- =========================================================
-- Tabela: professores
-- =========================================================
CREATE TABLE IF NOT EXISTS professores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE,
  telefone VARCHAR(20),
  data_admissao DATE,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- Tabela: disciplinas
-- =========================================================
CREATE TABLE IF NOT EXISTS disciplinas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL UNIQUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- Tabela: turmas
-- =========================================================
CREATE TABLE IF NOT EXISTS turmas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(50) NOT NULL UNIQUE,
  ano_letivo VARCHAR(20) DEFAULT '2025/2026',
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- Tabela: professor_disciplinas (N:N)
-- =========================================================
CREATE TABLE IF NOT EXISTS professor_disciplinas (
  professor_id INT NOT NULL,
  disciplina_id INT NOT NULL,
  PRIMARY KEY (professor_id, disciplina_id),
  FOREIGN KEY (professor_id) REFERENCES professores(id) ON DELETE CASCADE,
  FOREIGN KEY (disciplina_id) REFERENCES disciplinas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- Tabela: professor_turmas (N:N)
-- =========================================================
CREATE TABLE IF NOT EXISTS professor_turmas (
  professor_id INT NOT NULL,
  turma_id INT NOT NULL,
  PRIMARY KEY (professor_id, turma_id),
  FOREIGN KEY (professor_id) REFERENCES professores(id) ON DELETE CASCADE,
  FOREIGN KEY (turma_id) REFERENCES turmas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- Tabela: horarios (grelha semanal de aulas)
-- =========================================================
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

CREATE INDEX idx_horarios_professor ON horarios(professor_id);
CREATE INDEX idx_horarios_dia ON horarios(dia_semana);

-- =========================================================
-- Tabela: faltas
-- =========================================================
CREATE TABLE IF NOT EXISTS faltas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  professor_id INT NOT NULL,
  horario_id INT NULL,
  data_falta DATE NOT NULL,
  hora_inicio TIME NULL,
  hora_fim TIME NULL,
  tipo ENUM('falta', 'atraso') NOT NULL DEFAULT 'falta',
  motivo VARCHAR(255),
  justificada TINYINT(1) NOT NULL DEFAULT 0,
  substituto VARCHAR(150),
  observacoes TEXT,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_faltas_professor FOREIGN KEY (professor_id)
    REFERENCES professores(id) ON DELETE CASCADE,
  CONSTRAINT fk_faltas_horario FOREIGN KEY (horario_id)
    REFERENCES horarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_faltas_professor ON faltas(professor_id);
CREATE INDEX idx_faltas_data ON faltas(data_falta);

-- =========================================================
-- Dados de exemplo
-- =========================================================
INSERT INTO professores (nome, email, telefone, data_admissao, ativo) VALUES
('Ana Sofia Martins', 'ana.martins@escola.pt', '912345678', '2018-09-01', 1),
('João Pedro Silva', 'joao.silva@escola.pt', '913456789', '2015-09-01', 1),
('Maria Fernanda Costa', 'maria.costa@escola.pt', '914567890', '2020-09-01', 1),
('Ricardo Alves', 'ricardo.alves@escola.pt', '915678901', '2019-01-15', 1),
('Beatriz Oliveira', 'beatriz.oliveira@escola.pt', '916789012', '2021-09-01', 1),
('Carlos Mendes', 'carlos.mendes@escola.pt', '917890123', '2017-09-01', 1);

INSERT INTO disciplinas (nome) VALUES
('Matemática'), ('Português'), ('História'), ('Educação Física'), ('Inglês'), ('Físico-Química'),
('Geografia'), ('Biologia'), ('Artes Visuais'), ('Filosofia'), ('Informática'), ('Química');

INSERT INTO turmas (nome, ano_letivo) VALUES
('10ºA', '2025/2026'), ('10ºB', '2025/2026'),
('11ºA', '2025/2026'), ('11ºB', '2025/2026'),
('12ºA', '2025/2026'), ('12ºB', '2025/2026');

INSERT INTO professor_disciplinas (professor_id, disciplina_id) VALUES
(1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6);

INSERT INTO professor_turmas (professor_id, turma_id) VALUES
(1, 1), (1, 3), (2, 2), (2, 4), (3, 3), (3, 5),
(4, 4), (4, 6), (5, 5), (5, 1), (6, 6), (6, 2);

-- Grelha de horários: 5 dias x 4 blocos por professor, na sua turma principal
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
) slot;

INSERT INTO faltas (professor_id, data_falta, hora_inicio, hora_fim, tipo, motivo, justificada, substituto, observacoes) VALUES
(1, CURDATE() - INTERVAL 3 DAY, '08:30:00', '10:00:00', 'falta', 'Doença', 1, 'Pedro Nunes', 'Atestado médico entregue na secretaria'),
(2, CURDATE() - INTERVAL 5 DAY, '10:15:00', '11:45:00', 'falta', 'Consulta médica', 1, NULL, 'Justificação enviada por email'),
(3, CURDATE() - INTERVAL 1 DAY, '09:00:00', '09:10:00', 'atraso', 'Trânsito', 0, NULL, NULL),
(1, CURDATE() - INTERVAL 10 DAY, '14:00:00', '15:30:00', 'falta', 'Assunto pessoal', 0, 'Sofia Reis', NULL),
(4, CURDATE() - INTERVAL 2 DAY, '11:00:00', '12:30:00', 'falta', 'Formação profissional', 1, NULL, 'Formação creditada pela direção'),
(5, CURDATE(), '08:30:00', '08:40:00', 'atraso', 'Problema de transporte', 0, NULL, NULL);
