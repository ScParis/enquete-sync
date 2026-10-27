import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const defaultDbPath = process.env.GCLICK_DB_PATH || path.join(root, 'auth.db');

let instance = null;

export function getDatabase(customPath = null) {
  if (customPath) {
    const db = new DatabaseSync(customPath);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    initSchema(db);
    return db;
  }
  if (!instance) {
    instance = new DatabaseSync(defaultDbPath);
    instance.exec('PRAGMA busy_timeout = 5000;');
    instance.exec('PRAGMA journal_mode = WAL;');
    instance.exec('PRAGMA foreign_keys = ON;');
    initSchema(instance);
  }
  return instance;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_superadmin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      module TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      allowed INTEGER NOT NULL, -- 1 = concedido diretamente, 0 = bloqueado diretamente
      PRIMARY KEY (user_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS user_accounts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL, -- '2420', '6581' ou '*'
      PRIMARY KEY (user_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  seedInitialData(db);
}

const DEFAULT_PERMISSIONS = [
  { slug: 'enquete.visualizar', module: 'Auditoria', description: 'Visualizar planilha e dados da auditoria' },
  { slug: 'enquete.exportar', module: 'Auditoria', description: 'Exportar logs e relatórios da auditoria' },
  { slug: 'enquete.conferir', module: 'G-Click', description: 'Executar conferência ativa do robô na Enquete' },
  { slug: 'enquete.gravar', module: 'G-Click', description: 'Executar gravação de respostas no G-Click' },
  { slug: 'mapeamentos.gerenciar', module: 'Configurações', description: 'Criar e editar mapeamentos de tarefas e perfis' },
  { slug: 'planilha.escrever', module: 'Planilha', description: 'Sincronizar dados com o Google Sheets via Apps Script' },
  { slug: 'usuarios.administrar', module: 'Administração', description: 'Gerenciar usuários, cargos e permissões' },
  { slug: 'obrigacoes.visualizar', module: 'Obrigações', description: 'Visualizar e inspecionar obrigações no G-Click' }
];

const DEFAULT_ROLES = [
  {
    name: 'Administrador',
    slug: 'admin',
    description: 'Acesso total a todas as funcionalidades e configurações',
    permissions: DEFAULT_PERMISSIONS.map(p => p.slug)
  },
  {
    name: 'Operador',
    slug: 'operador',
    description: 'Pode visualizar, exportar, conferir e gravar na Enquete e Obrigações',
    permissions: ['enquete.visualizar', 'enquete.exportar', 'enquete.conferir', 'enquete.gravar', 'obrigacoes.visualizar']
  },
  {
    name: 'Auditor',
    slug: 'auditor',
    description: 'Somente leitura e exportação de dados',
    permissions: ['enquete.visualizar', 'enquete.exportar']
  }
];

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

export function seedInitialData(db) {
  const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (slug, module, description) VALUES (?, ?, ?)');
  for (const p of DEFAULT_PERMISSIONS) {
    insertPerm.run(p.slug, p.module, p.description);
  }

  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, slug, description) VALUES (?, ?, ?)');
  for (const r of DEFAULT_ROLES) {
    insertRole.run(r.name, r.slug, r.description);
  }

  const getRole = db.prepare('SELECT id FROM roles WHERE slug = ?');
  const getPerm = db.prepare('SELECT id FROM permissions WHERE slug = ?');
  const insertRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  for (const r of DEFAULT_ROLES) {
    const roleRow = getRole.get(r.slug);
    if (!roleRow) continue;
    for (const pSlug of r.permissions) {
      const permRow = getPerm.get(pSlug);
      if (permRow) {
        insertRolePerm.run(roleRow.id, permRow.id);
      }
    }
  }

  const countUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (countUsers.count === 0) {
    const now = new Date().toISOString();
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@gclick.local';
    const adminPass = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@123456';
    const { hash, salt } = hashPassword(adminPass);

    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password_hash, salt, is_active, is_superadmin, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `);
    const userRes = insertUser.run('Administrador', adminEmail, hash, salt, now, now);
    const adminId = Number(userRes.lastInsertRowid);

    const adminRole = getRole.get('admin');
    if (adminRole) {
      db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(adminId, adminRole.id);
    }
    db.prepare('INSERT INTO user_accounts (user_id, account_id) VALUES (?, ?)').run(adminId, '*');
  }
}
