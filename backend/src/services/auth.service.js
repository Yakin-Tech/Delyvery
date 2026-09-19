const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const SALT_ROUNDS = 10;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function comparePassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

function signToken(user, { impersonatedBy } = {}) {
  const payload = {
    sub: user.id,
    role: user.role,
    organizationId: user.organizationId,
  };
  if (impersonatedBy) payload.impersonatedBy = impersonatedBy;

  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
};
