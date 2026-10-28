// Roteador Modular de Autenticação e Gestão de Usuários (RBAC)
// Responsabilidade Única: endpoints /api/auth/* e /api/users/*

export async function handleAuthRoutes(req, res, { url, currentUser, authService, body, send, sendCookie, getCookie }) {
  // Rotas Públicas de Sessão (GET/POST)
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    return send(res, 200, { authenticated: Boolean(currentUser), user: currentUser ?? null });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const payload = await body(req);
    const user = authService.authenticate(payload.email, payload.password);
    if (!user) return send(res, 401, { error: 'E-mail ou senha incorretos' });
    const { sessionId } = authService.createSession(user.id);
    const cookie = `gclick_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
    return sendCookie(res, 200, { ok: true, user }, cookie);
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const sessionId = getCookie(req, 'gclick_session');
    if (sessionId) authService.deleteSession(sessionId);
    const cookie = `gclick_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    return sendCookie(res, 200, { ok: true }, cookie);
  }

  // Rotas Protegidas de Gestão de Usuários
  if (req.method === 'GET' && url.pathname === '/api/users') {
    if (!currentUser || !authService.hasPermission(currentUser.id, 'usuarios.administrar')) {
      return send(res, 403, { error: 'Acesso negado: permissão "usuarios.administrar" necessária' });
    }
    return send(res, 200, {
      users: authService.listUsers(),
      roles: authService.listRoles(),
      permissions: authService.listPermissions()
    });
  }

  return false; // Rota não processada por este módulo
}

export async function handleUserAdminPostRoutes(req, res, { url, currentUser, payload, authService, send }) {
  if (url.pathname === '/api/users/create') {
    if (!authService.hasPermission(currentUser.id, 'usuarios.administrar')) return send(res, 403, { error: 'Acesso negado' });
    const user = authService.createUser(payload);
    return send(res, 200, { ok: true, user });
  }

  if (url.pathname === '/api/users/update') {
    if (!authService.hasPermission(currentUser.id, 'usuarios.administrar')) return send(res, 403, { error: 'Acesso negado' });
    const user = authService.updateUser(payload.id, payload);
    return send(res, 200, { ok: true, user });
  }

  if (url.pathname === '/api/users/delete') {
    if (!authService.hasPermission(currentUser.id, 'usuarios.administrar')) return send(res, 403, { error: 'Acesso negado' });
    authService.deleteUser(payload.id);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/users/override') {
    if (!authService.hasPermission(currentUser.id, 'usuarios.administrar')) return send(res, 403, { error: 'Acesso negado' });
    authService.setUserOverride(payload.userId, payload.permissionSlug, payload.allowed);
    return send(res, 200, { ok: true, user: authService.getUserById(payload.userId) });
  }

  return false;
}
