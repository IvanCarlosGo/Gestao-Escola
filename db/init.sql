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

-- Sem dados iniciais: as escolas criam-se no painel da plataforma e cada escola
-- introduz (ou importa) as suas turmas, disciplinas, professores e horários no site.
