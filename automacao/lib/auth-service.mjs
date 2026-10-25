import crypto from 'node:crypto';
import { getDatabase, hashPassword, verifyPassword } from './db.mjs';

const SESSION_DURATION_DAYS = 7;

export class AuthService {
  constructor(db = null) {
    this.db = db || getDatabase();
  }

  // --- AUTENTICAÇÃO E SESSÃO ---

  authenticate(email, password) {
    const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
    if (!user || !user.is_active) return null;
    if (!verifyPassword(password, user.password_hash, user.salt)) return null;
    return this.getUserById(user.id);
  }

  createSession(userId) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    
    this.db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, userId, now.toISOString(), expiresAt);

    return { sessionId, expiresAt };
  }

  validateSession(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const session = this.db.prepare(`
      SELECT s.*, u.is_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `).get(sessionId);

    if (!session || !session.is_active) {
      if (session) this.deleteSession(sessionId);
      return null;
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      this.deleteSession(sessionId);
      return null;
    }

    return this.getUserById(session.user_id);
  }

  deleteSession(sessionId) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  deleteUserSessions(userId) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  // --- MOTOR RBAC HÍBRIDO (3 ETAPAS) ---

  /**
   * Verifica se o usuário tem uma permissão específica.
   * Algoritmo:
   * 1. Exceção direta do usuário (user_permissions):
   *    - allowed = 1 -> PERMITIDO
   *    - allowed = 0 -> NEGADO
   * 2. Permissão herdada do papel (role_permissions):
   *    - se algum papel vinculado ao usuário possui a permissão -> PERMITIDO
   * 3. Fallback:
   *    - se for superadmin -> PERMITIDO
   *    - caso contrário -> NEGADO
   * 
   * Se accountId for fornecido, valida se o usuário possui acesso àquela conta do G-Click.
   */
  hasPermission(userId, permissionSlug, accountId = null) {
    const user = this.db.prepare('SELECT id, is_active, is_superadmin FROM users WHERE id = ?').get(userId);
    if (!user || !user.is_active) return false;

    // Se houver restrição por conta, valida user_accounts
    if (accountId && !user.is_superadmin) {
      const accMatch = this.db.prepare(`
        SELECT 1 FROM user_accounts 
        WHERE user_id = ? AND (account_id = ? OR account_id = '*')
      `).get(userId, String(accountId).trim());
      if (!accMatch) return false;
    }

    // Superadmin bypassa todas as checagens de permissão
    if (user.is_superadmin) return true;

    // ETAPA 1: Exceção Direta do Usuário (user_permissions)
    const override = this.db.prepare(`
      SELECT up.allowed 
      FROM user_permissions up
      JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = ? AND p.slug = ?
    `).get(userId, permissionSlug);

    if (override !== undefined) {
      return Boolean(override.allowed);
    }

    // ETAPA 2: Permissões dos Papéis (role_permissions via user_roles)
    const roleMatch = this.db.prepare(`
      SELECT 1 
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ? AND p.slug = ?
    `).get(userId, permissionSlug);

    if (roleMatch) {
      return true;
    }

    // ETAPA 3: Bloqueio Padrão (Fallback Deny)
    return false;
  }

  // --- DEFINIÇÃO DE EXCEÇÕES (OVERRIDES) ---

  setUserOverride(userId, permissionSlug, allowed) {
    const perm = this.db.prepare('SELECT id FROM permissions WHERE slug = ?').get(permissionSlug);
    if (!perm) throw new Error(`Permissão "${permissionSlug}" não existe`);

    if (allowed === null || allowed === undefined) {
      // Remove a exceção (volta a herdar do papel)
      this.db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?').run(userId, perm.id);
    } else {
      const allowedInt = allowed ? 1 : 0;
      this.db.prepare(`
        INSERT INTO user_permissions (user_id, permission_id, allowed)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, permission_id) DO UPDATE SET allowed = excluded.allowed
      `).run(userId, perm.id, allowedInt);
    }
  }

  getUserEffectivePermissions(userId) {
    const user = this.db.prepare('SELECT is_superadmin FROM users WHERE id = ?').get(userId);
    if (!user) return [];

    const allPerms = this.db.prepare('SELECT id, slug, module, description FROM permissions ORDER BY module, slug').all();
    const userRoles = this.db.prepare(`
      SELECT r.slug FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `).all(userId).map(r => r.slug);

    const rolePermIds = new Set(this.db.prepare(`
      SELECT rp.permission_id
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
    `).all(userId).map(x => x.permission_id));

    const overrides = new Map(this.db.prepare(`
      SELECT permission_id, allowed FROM user_permissions WHERE user_id = ?
    `).all(userId).map(x => [x.permission_id, Boolean(x.allowed)]));

    return allPerms.map(p => {
      let allowed = false;
      let source = 'denied';

      if (user.is_superadmin) {
        allowed = true;
        source = 'superadmin';
      } else if (overrides.has(p.id)) {
        allowed = overrides.get(p.id);
        source = allowed ? 'override_allowed' : 'override_denied';
      } else if (rolePermIds.has(p.id)) {
        allowed = true;
        source = 'role';
      }

      return {
        slug: p.slug,
        module: p.module,
        description: p.description,
        allowed,
        source
      };
    });
  }

  // --- CRUD DE USUÁRIOS ---

  createUser({ name, email, password, isSuperadmin = false, roleSlugs = [], accountIds = ['*'] }) {
    const cleanEmail = String(email).trim().toLowerCase();
    const exists = this.db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (exists) throw new Error(`Já existe um usuário com o e-mail "${cleanEmail}"`);

    const { hash, salt } = hashPassword(password);
    const now = new Date().toISOString();

    const insertUser = this.db.prepare(`
      INSERT INTO users (name, email, password_hash, salt, is_active, is_superadmin, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `);
    const res = insertUser.run(String(name).trim(), cleanEmail, hash, salt, isSuperadmin ? 1 : 0, now, now);
    const userId = Number(res.lastInsertRowid);

    // Atribuir papéis
    if (Array.isArray(roleSlugs) && roleSlugs.length) {
      const getRole = this.db.prepare('SELECT id FROM roles WHERE slug = ?');
      const insertUserRole = this.db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
      for (const slug of roleSlugs) {
        const r = getRole.get(slug);
        if (r) insertUserRole.run(userId, r.id);
      }
    }

    // Atribuir contas
    if (Array.isArray(accountIds) && accountIds.length) {
      const insertUserAcc = this.db.prepare('INSERT OR IGNORE INTO user_accounts (user_id, account_id) VALUES (?, ?)');
      for (const acc of accountIds) {
        insertUserAcc.run(userId, String(acc).trim());
      }
    }

    return this.getUserById(userId);
  }

  updateUser(userId, { name, email, password, isActive, isSuperadmin, roleSlugs, accountIds }) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('Usuário não encontrado');

    const now = new Date().toISOString();
    let cleanEmail = user.email;
    if (email && email.trim().toLowerCase() !== user.email) {
      cleanEmail = email.trim().toLowerCase();
      const existing = this.db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(cleanEmail, userId);
      if (existing) throw new Error(`O e-mail "${cleanEmail}" já está em uso por outro usuário`);
    }

    let hash = user.password_hash;
    let salt = user.salt;
    if (password && password.trim()) {
      const newHash = hashPassword(password);
      hash = newHash.hash;
      salt = newHash.salt;
      this.deleteUserSessions(userId); // invalida sessões ao trocar senha
    }

    const updatedActive = isActive !== undefined ? (isActive ? 1 : 0) : user.is_active;
    const updatedSuper = isSuperadmin !== undefined ? (isSuperadmin ? 1 : 0) : user.is_superadmin;
    const updatedName = name ? String(name).trim() : user.name;

    this.db.prepare(`
      UPDATE users 
      SET name = ?, email = ?, password_hash = ?, salt = ?, is_active = ?, is_superadmin = ?, updated_at = ?
      WHERE id = ?
    `).run(updatedName, cleanEmail, hash, salt, updatedActive, updatedSuper, now, userId);

    if (Array.isArray(roleSlugs)) {
      this.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
      const getRole = this.db.prepare('SELECT id FROM roles WHERE slug = ?');
      const insertUserRole = this.db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
      for (const slug of roleSlugs) {
        const r = getRole.get(slug);
        if (r) insertUserRole.run(userId, r.id);
      }
    }

    if (Array.isArray(accountIds)) {
      this.db.prepare('DELETE FROM user_accounts WHERE user_id = ?').run(userId);
      const insertUserAcc = this.db.prepare('INSERT OR IGNORE INTO user_accounts (user_id, account_id) VALUES (?, ?)');
      for (const acc of accountIds) {
        insertUserAcc.run(userId, String(acc).trim());
      }
    }

    return this.getUserById(userId);
  }

  deleteUser(userId) {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('Usuário não encontrado');
    if (user.is_superadmin) {
      const superCount = this.db.prepare('SELECT COUNT(*) as count FROM users WHERE is_superadmin = 1').get().count;
      if (superCount <= 1) throw new Error('Não é possível excluir o único superadministrador do sistema');
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return true;
  }

  getUserById(userId) {
    const user = this.db.prepare(`
      SELECT id, name, email, is_active, is_superadmin, created_at, updated_at
      FROM users WHERE id = ?
    `).get(userId);
    if (!user) return null;

    const roles = this.db.prepare(`
      SELECT r.id, r.name, r.slug, r.description
      FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `).all(userId);

    const accounts = this.db.prepare(`
      SELECT account_id FROM user_accounts WHERE user_id = ?
    `).all(userId).map(a => a.account_id);

    return {
      ...user,
      is_active: Boolean(user.is_active),
      is_superadmin: Boolean(user.is_superadmin),
      roles,
      accounts,
      permissions: this.getUserEffectivePermissions(userId)
    };
  }

  listUsers() {
    const users = this.db.prepare(`
      SELECT id, name, email, is_active, is_superadmin, created_at, updated_at
      FROM users ORDER BY name ASC
    `).all();

    return users.map(u => this.getUserById(u.id));
  }

  listRoles() {
    const roles = this.db.prepare('SELECT * FROM roles ORDER BY name ASC').all();
    return roles.map(r => {
      const perms = this.db.prepare(`
        SELECT p.slug FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = ?
      `).all(r.id).map(p => p.slug);
      return { ...r, permissions: perms };
    });
  }

  listPermissions() {
    return this.db.prepare('SELECT * FROM permissions ORDER BY module, slug').all();
  }
}
