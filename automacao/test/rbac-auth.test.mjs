import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initSchema, hashPassword, verifyPassword } from '../lib/db.mjs';
import { AuthService } from '../lib/auth-service.mjs';

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

test('DB e Seeds: inicializa tabelas e insere sementes iniciais', () => {
  const db = createTestDb();
  const perms = db.prepare('SELECT COUNT(*) as c FROM permissions').get().c;
  const roles = db.prepare('SELECT COUNT(*) as c FROM roles').get().c;
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

  assert.ok(perms >= 7, 'Deve conter pelo menos 7 permissões padrão');
  assert.equal(roles, 3, 'Deve conter os 3 cargos padrão (admin, operador, auditor)');
  assert.equal(users, 1, 'Deve criar o administrador inicial');
});

test('Hash de Senha: hash seguro com salt e verificação em tempo constante', () => {
  const { hash, salt } = hashPassword('MinhaSenha@123');
  assert.ok(hash.length > 32);
  assert.ok(salt.length > 16);

  assert.equal(verifyPassword('MinhaSenha@123', hash, salt), true);
  assert.equal(verifyPassword('SenhaIncorreta', hash, salt), false);
});

test('Autenticação e Sessões: login, validação de sessão e expiração', () => {
  const db = createTestDb();
  const auth = new AuthService(db);

  // Login com usuário admin inicial
  const admin = auth.authenticate('admin@gclick.local', 'Admin@123456');
  assert.ok(admin, 'Admin inicial deve autenticar');
  assert.equal(admin.email, 'admin@gclick.local');
  assert.equal(admin.is_superadmin, true);

  // Falha de senha
  assert.equal(auth.authenticate('admin@gclick.local', 'senha_errada'), null);

  // Criação e validação de sessão
  const { sessionId } = auth.createSession(admin.id);
  const sessionUser = auth.validateSession(sessionId);
  assert.ok(sessionUser);
  assert.equal(sessionUser.id, admin.id);

  // Logout / deleção de sessão
  auth.deleteSession(sessionId);
  assert.equal(auth.validateSession(sessionId), null);
});

test('RBAC Híbrido: Herança de Papel, Overrides de Usuário e Fallback', () => {
  const db = createTestDb();
  const auth = new AuthService(db);

  // 1. Criar usuário "Ana" com papel "auditor"
  // Auditor possui: enquete.visualizar, enquete.exportar
  // Auditor NÃO possui: enquete.gravar, enquete.conferir
  const ana = auth.createUser({
    name: 'Ana Vendedora/Auditora',
    email: 'ana@empresa.com.br',
    password: 'Password@123',
    roleSlugs: ['auditor'],
    accountIds: ['2420']
  });

  // Checagem padrão do papel
  assert.equal(auth.hasPermission(ana.id, 'enquete.visualizar'), true, 'Ana herda visualizar do cargo auditor');
  assert.equal(auth.hasPermission(ana.id, 'enquete.exportar'), true, 'Ana herda exportar do cargo auditor');
  assert.equal(auth.hasPermission(ana.id, 'enquete.gravar'), false, 'Ana NÃO tem permissão de gravar por padrão');
  assert.equal(auth.hasPermission(ana.id, 'enquete.conferir'), false, 'Ana NÃO tem conferir por padrão');

  // 2. Cenário de Exceção 1: Liberação Manual Direta (allowed = true)
  // O diretor quer que APENAS a Ana grave no G-Click esta semana
  auth.setUserOverride(ana.id, 'enquete.gravar', true);
  assert.equal(auth.hasPermission(ana.id, 'enquete.gravar'), true, 'Override concedeu enquete.gravar para Ana');

  // 3. Cenário de Exceção 2: Bloqueio Manual Direto (allowed = false)
  // O diretor quer revogar a exportação de Ana, mesmo que o cargo de auditor permita
  auth.setUserOverride(ana.id, 'enquete.exportar', false);
  assert.equal(auth.hasPermission(ana.id, 'enquete.exportar'), false, 'Override revogou enquete.exportar de Ana');

  // 4. Cenário de Remoção de Exceção (allowed = null) -> Volta a herdar do papel
  auth.setUserOverride(ana.id, 'enquete.exportar', null);
  assert.equal(auth.hasPermission(ana.id, 'enquete.exportar'), true, 'Ao remover a exceção, volta a herdar do cargo');

  // 5. Fallback Padrão: permissão não existente ou sem vínculo
  assert.equal(auth.hasPermission(ana.id, 'usuarios.administrar'), false, 'Fallback bloqueia permissão não atribuída');
});

test('Multi-Tenant: Restrição de acesso por conta de escritório', () => {
  const db = createTestDb();
  const auth = new AuthService(db);

  // Usuário restrito somente à conta 2420
  const operador = auth.createUser({
    name: 'Carlos Operador',
    email: 'carlos@empresa.com.br',
    password: 'Password@123',
    roleSlugs: ['operador'],
    accountIds: ['2420']
  });

  // Na conta 2420 tem permissão
  assert.equal(auth.hasPermission(operador.id, 'enquete.conferir', '2420'), true);

  // Na conta 6581 tem acesso negado pela restrição de conta
  assert.equal(auth.hasPermission(operador.id, 'enquete.conferir', '6581'), false);

  // Usuário com acesso global '*'
  const supervisor = auth.createUser({
    name: 'Supervisora Maria',
    email: 'maria@empresa.com.br',
    password: 'Password@123',
    roleSlugs: ['operador'],
    accountIds: ['*']
  });

  assert.equal(auth.hasPermission(supervisor.id, 'enquete.conferir', '2420'), true);
  assert.equal(auth.hasPermission(supervisor.id, 'enquete.conferir', '6581'), true);
});

test('Superadmin: possui acesso total irrestrito', () => {
  const db = createTestDb();
  const auth = new AuthService(db);

  const admin = auth.authenticate('admin@gclick.local', 'Admin@123456');
  assert.equal(auth.hasPermission(admin.id, 'qualquer.permissao.inexistente'), true, 'Superadmin tem acesso a tudo');
  assert.equal(auth.hasPermission(admin.id, 'enquete.gravar', '9999'), true, 'Superadmin acessa qualquer conta');
});
