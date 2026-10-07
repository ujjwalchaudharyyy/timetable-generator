-- ============================================================
-- ChronoGen Database Schema  v4
-- Safe to re-run at any time — all statements use IF NOT EXISTS.
-- mysql -u root -p < database/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS chronogen;
USE chronogen;

CREATE TABLE IF NOT EXISTS institution (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  name                     VARCHAR(255) DEFAULT 'Demo College',
  days_per_week            INT DEFAULT 5,
  periods_per_day          INT DEFAULT 8,
  period_duration_minutes  INT DEFAULT 45,
  day_start_time           VARCHAR(5) DEFAULT '09:00',
  break_after_period       INT DEFAULT 4,
  break_duration_minutes   INT DEFAULT 15,
  lunch_break_after_period INT DEFAULT 6,
  lunch_duration_minutes   INT DEFAULT 30
);

CREATE TABLE IF NOT EXISTS rooms (
  id             VARCHAR(50) PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  capacity       INT DEFAULT 40,
  type           ENUM('classroom','lab','lecture_hall','gym','seminar_room') DEFAULT 'classroom',
  institution_id INT,
  FOREIGN KEY (institution_id) REFERENCES institution(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subjects (
  id                    VARCHAR(50) PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  requires_room_type    ENUM('classroom','lab','lecture_hall','gym','seminar_room') DEFAULT 'classroom',
  min_lectures_per_week INT DEFAULT 1,
  institution_id        INT,
  FOREIGN KEY (institution_id) REFERENCES institution(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teachers (
  id                       VARCHAR(50) PRIMARY KEY,
  name                     VARCHAR(255) NOT NULL,
  max_lectures_per_week    INT DEFAULT 20,
  max_consecutive_lectures INT DEFAULT 3,
  prefers_morning          BOOLEAN DEFAULT FALSE,
  institution_id           INT,
  FOREIGN KEY (institution_id) REFERENCES institution(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id VARCHAR(50),
  subject_id VARCHAR(50),
  PRIMARY KEY (teacher_id, subject_id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS teacher_unavailable (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id VARCHAR(50),
  day        INT,
  period     INT,
  UNIQUE KEY uq_slot (teacher_id, day, period),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classes (
  id             VARCHAR(50) PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  student_count  INT DEFAULT 30,
  institution_id INT,
  FOREIGN KEY (institution_id) REFERENCES institution(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS curriculum (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  class_id     VARCHAR(50),
  subject_id   VARCHAR(50),
  teacher_id   VARCHAR(50),
  min_per_week INT DEFAULT 1,
  FOREIGN KEY (class_id)   REFERENCES classes(id)  ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timetable_genes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  session_id    VARCHAR(100),
  class_id      VARCHAR(50),
  subject_id    VARCHAR(50),
  teacher_id    VARCHAR(50),
  room_id       VARCHAR(50),
  day           INT,
  period        INT,
  fitness_score FLOAT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (session_id)
);

CREATE TABLE IF NOT EXISTS ga_runs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  session_id      VARCHAR(100),
  institution_id  INT,
  population_size INT,
  max_generations INT,
  final_fitness   FLOAT,
  generations_run INT,
  status          ENUM('running','completed','failed') DEFAULT 'running',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance log — tracks every teacher absence with date, substitute, and notes
CREATE TABLE IF NOT EXISTS attendance_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id    VARCHAR(50) NOT NULL,
  absent_date   DATE NOT NULL,
  substitute_id VARCHAR(50),
  notes         VARCHAR(500),
  marked_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id)    REFERENCES teachers(id) ON DELETE CASCADE,
  FOREIGN KEY (substitute_id) REFERENCES teachers(id) ON DELETE SET NULL
);

-- Default institution (safe to re-run)
INSERT IGNORE INTO institution
  (id, name, days_per_week, periods_per_day, period_duration_minutes,
   day_start_time, break_after_period, break_duration_minutes,
   lunch_break_after_period, lunch_duration_minutes)
VALUES
  (1, 'Graphic Era Hill University', 5, 8, 45,
   '09:00', 4, 15, 6, 30);
