'use strict';

const { verifyJwt } = require('../services/jwt');
const { logger } = require('../logger');

// ---------------------------------------------------------------------------
// JWT Bearer middleware for service-to-service authentication.
//
// Validates the Authorization: Bearer <token> header on internal routes.
// Invalid or expired tokens are rejected with 401. A missing header is also
// rejected, preventing unauthenticated internal traffic.
// ---------------------------------------------------------------------------

const { statusForCode } = require('../services/jwt-error-codes');

/**
 * Express middleware that enforces JWT Bearer authentication.
 *
 * On success the decoded payload is attached to `req.jwtPayload` and the
 * request continues to the next handler.
 *
 * On failure a structured 401 JSON response is returned:
 *   { error: string, code: string }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function verifyJwtBearer(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({
      error: 'Missing Authorization header',
      code: 'MISSING_TOKEN',
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authorization header must use Bearer scheme',
      code: 'MALFORMED_TOKEN',
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      error: 'Bearer token is empty',
      code: 'MISSING_TOKEN',
    });
  }

  try {
    const payload = verifyJwt(token);
    req.jwtPayload = payload;
    return next();
  } catch (err) {
    const status = statusForCode(err.code) ?? 401;
    logger.warn(
      { code: err.code, path: req.path, method: req.method },
      '[jwt-auth] rejected request: %s',
      err.message
    );
    return res.status(status).json({
      error: err.message,
      code: err.code ?? 'INVALID_TOKEN',
    });
  }
}

module.exports = { verifyJwtBearer };
