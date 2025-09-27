import session from 'express-session';

class SessionManager {
  constructor(options = {}) {
    this.sessionMiddleware =
      options.sessionMiddleware ||
      session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 1000 * 60 * 60 * 24 * 7
        }
      });
  }

  getSessionMiddleware() {
    return this.sessionMiddleware;
  }

  authMiddleware(req, res, next) {
    if (req.session && req.session.userId) {
      next();
      return;
    }
    res.status(403).send({ error: 'Not authenticated' });
  }

  validateSession(req) {
    if (!req.session || !req.session.userId) {
      throw new Error('Session not authenticated');
    }
  }

  setSession(req, { userId, storeId, isAdmin }) {
    req.session.userId = userId;
    req.session.storeId = storeId;
    req.session.isAdmin = !!isAdmin;
  }

  clearSession(req) {
    req.session.destroy(() => {});
  }

  getSessionContext(req) {
    return {
      userId: req.session.userId,
      storeId: req.session.storeId,
      isAdmin: req.session.isAdmin
    };
  }
}

export { SessionManager };
