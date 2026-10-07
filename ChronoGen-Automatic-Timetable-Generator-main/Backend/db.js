// db.js — MySQL connection pool
// Connects to MySQL and runs one-time column migrations on startup.

require('dotenv').config();
const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host:               process.env.DB_HOST || 'localhost',
  user:               process.env.DB_USER || 'root',
  password:           process.env.DB_PASS || '',
  database:           process.env.DB_NAME || 'chronogen',
  waitForConnections: true,
  connectionLimit:    10,
});

// Safely add a column — skips if it already exists (MySQL error 1060).
async function addColumnIfMissing(conn, table, column, definition) {
  try {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  } catch (err) {
    if (err.errno !== 1060) throw err; // 1060 = duplicate column, that's fine
  }
}

// Runs once on startup to handle schema changes added after the initial deploy.
async function runMigrations() {
  const conn = await db.getConnection();
  try {
    // Add timing columns to institution (safe to re-run)
    await addColumnIfMissing(conn, 'institution', 'day_start_time',        "VARCHAR(5)  NOT NULL DEFAULT '09:00'");
    await addColumnIfMissing(conn, 'institution', 'break_after_period',    'INT         NOT NULL DEFAULT 4');
    await addColumnIfMissing(conn, 'institution', 'break_duration_minutes','INT         NOT NULL DEFAULT 15');
    await addColumnIfMissing(conn, 'institution', 'lunch_duration_minutes','INT         NOT NULL DEFAULT 30');

    // Create attendance_log if this is an older install that didn't have it
    await conn.query(`
      CREATE TABLE IF NOT EXISTS attendance_log (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        teacher_id    VARCHAR(50)  NOT NULL,
        absent_date   DATE         NOT NULL,
        substitute_id VARCHAR(50),
        notes         VARCHAR(500),
        marked_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id)    REFERENCES teachers(id) ON DELETE CASCADE,
        FOREIGN KEY (substitute_id) REFERENCES teachers(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Fill in defaults for any NULL timing values on the institution row
    await conn.query(`
      UPDATE institution
      SET
        day_start_time         = COALESCE(NULLIF(day_start_time, ''), '09:00'),
        break_after_period     = COALESCE(break_after_period, 4),
        break_duration_minutes = COALESCE(break_duration_minutes, 15),
        lunch_duration_minutes = COALESCE(lunch_duration_minutes, 30)
      WHERE id = 1
    `).catch(() => {}); // non-fatal if institution row doesn't exist yet

    console.log('  ✅ DB migrations done');
  } catch (err) {
    console.warn('  ⚠️  Migration warning (non-fatal):', err.message);
  } finally {
    conn.release();
  }
}

// Test connection on startup, then run migrations.
db.getConnection()
  .then(conn => { conn.release(); return runMigrations(); })
  .catch(err => {
    console.error('\n  ❌ MySQL connection failed:', err.message);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('  → Wrong username/password. Check DB_PASS in .env');
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.error('  → Database "chronogen" not found.');
      console.error('  → Run: mysql -u root -p < Database/schema.sql');
    } else if (err.code === 'ECONNREFUSED') {
      console.error('  → MySQL is not running. Start it first.');
    }
  });

module.exports = db;
