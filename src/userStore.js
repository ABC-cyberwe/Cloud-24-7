const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const bcrypt = require("bcryptjs");

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const OAUTH_PROVIDERS = new Set(["google", "microsoft"]);

function sanitizeStorageName(username) {
  return username.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhone(phone) {
  const value = String(phone || "").trim();
  return value.replace(/[\s().-]/g, "");
}

function validateUsername(username) {
  const normalized = normalizeUsername(username);

  if (!USERNAME_PATTERN.test(normalized)) {
    const error = new Error("Username must be 3-32 characters and use letters, numbers, dots, underscores, or hyphens.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);

  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    const error = new Error("Enter a valid email address.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function validatePhone(phone) {
  const normalized = normalizePhone(phone);

  if (!PHONE_PATTERN.test(normalized)) {
    const error = new Error("Enter a valid mobile number with country code if needed.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function validateOptionalEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized ? validateEmail(normalized) : "";
}

function validateOptionalPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? validatePhone(normalized) : "";
}

function validatePassword(password) {
  const value = String(password || "");

  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    const error = new Error(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`);
    error.status = 400;
    throw error;
  }

  return value;
}

function validateOAuthProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();

  if (!OAUTH_PROVIDERS.has(normalized)) {
    const error = new Error("Unsupported sign-in provider.");
    error.status = 400;
    throw error;
  }

  return normalized;
}

function normalizeQuotaBytes(quotaBytes, role) {
  const allowUnlimited = role === "admin";
  const raw = String(quotaBytes || "").trim().toLowerCase();

  if (quotaBytes === null || (allowUnlimited && ["unlimited", "none"].includes(raw))) {
    if (allowUnlimited) return null;

    const error = new Error("Invalid account quota.");
    error.status = 400;
    throw error;
  }

  const quota = Number(quotaBytes);

  if (!Number.isFinite(quota) || quota < 1) {
    const error = new Error("Invalid account quota.");
    error.status = 400;
    throw error;
  }

  return quota;
}

function findUserOrThrow(db, id) {
  const user = db.users.find((entry) => entry.id === id);

  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  return user;
}

function userHasOAuth(user, provider, providerId) {
  return user.oauth?.some((entry) => entry.provider === provider && entry.providerId === providerId);
}

function ensureUniqueAccountFields(db, { username, email, phone }, existingId = null) {
  if (db.users.some((entry) => entry.id !== existingId && entry.username === username)) {
    const error = new Error("That username is already taken.");
    error.status = 409;
    throw error;
  }

  if (email && db.users.some((entry) => entry.id !== existingId && entry.email === email)) {
    const error = new Error("That email is already used by another account.");
    error.status = 409;
    throw error;
  }

  if (phone && db.users.some((entry) => entry.id !== existingId && entry.phone === phone)) {
    const error = new Error("That mobile number is already used by another account.");
    error.status = 409;
    throw error;
  }
}

class UserStore {
  constructor(dbPath) {
    this.dbPath = path.resolve(dbPath);
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fsp.mkdir(path.dirname(this.dbPath), { recursive: true });
    if (!fs.existsSync(this.dbPath)) {
      await this.writeDb({ version: 1, users: [] });
    }
  }

  async readDb() {
    await this.init();
    const raw = await fsp.readFile(this.dbPath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  }

  async writeDb(db) {
    await fsp.mkdir(path.dirname(this.dbPath), { recursive: true });
    const tempPath = `${this.dbPath}.${process.pid}.tmp`;
    await fsp.writeFile(tempPath, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(tempPath, this.dbPath);
  }

  async withWrite(mutator) {
    const operation = this.writeQueue.then(async () => {
      const db = await this.readDb();
      const result = await mutator(db);
      await this.writeDb(db);
      return result;
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  safeUser(user) {
    if (!user) return null;
    const quotaUnlimited = user.quotaBytes === null;

    return {
      id: user.id,
      username: user.username,
      email: user.email || "",
      phone: user.phone || "",
      role: user.role,
      quotaBytes: quotaUnlimited ? null : Number(user.quotaBytes),
      quotaUnlimited,
      isBanned: Boolean(user.isBanned),
      authProviders: (user.oauth || []).map((entry) => entry.provider),
      createdAt: user.createdAt,
      storageName: user.storageName
    };
  }

  async listUsers() {
    const db = await this.readDb();
    return db.users
      .map((user) => this.safeUser(user))
      .sort((a, b) => a.username.localeCompare(b.username, undefined, { numeric: true, sensitivity: "base" }));
  }

  async getById(id) {
    const db = await this.readDb();
    const user = db.users.find((entry) => entry.id === id);
    return user || null;
  }

  async getByUsername(username) {
    const normalized = normalizeUsername(username);
    const db = await this.readDb();
    const user = db.users.find((entry) => entry.username === normalized);
    return user || null;
  }

  async getByEmail(email) {
    const normalized = normalizeEmail(email);
    const db = await this.readDb();
    const user = db.users.find((entry) => entry.email === normalized);
    return user || null;
  }

  async getByLoginIdentifier(identifier) {
    const normalized = String(identifier || "").trim().toLowerCase();
    const db = await this.readDb();
    const user = db.users.find((entry) => entry.username === normalized || entry.email === normalized);
    return user || null;
  }

  async getByOAuth(provider, providerId) {
    const normalizedProvider = validateOAuthProvider(provider);
    const id = String(providerId || "");
    const db = await this.readDb();
    const user = db.users.find((entry) => userHasOAuth(entry, normalizedProvider, id));
    return user || null;
  }

  async createUser({ username, email, phone, password, role = "user", quotaBytes }) {
    const normalized = validateUsername(username);
    const emailValue = validateOptionalEmail(email);
    const phoneValue = validateOptionalPhone(phone);
    const passwordValue = validatePassword(password);
    const quota = normalizeQuotaBytes(quotaBytes, role);

    return this.withWrite(async (db) => {
      ensureUniqueAccountFields(db, { username: normalized, email: emailValue, phone: phoneValue });

      const id = crypto.randomUUID();
      const user = {
        id,
        username: normalized,
        email: emailValue,
        phone: phoneValue,
        passwordHash: await bcrypt.hash(passwordValue, 12),
        role,
        quotaBytes: quota,
        isBanned: false,
        oauth: [],
        storageName: `${sanitizeStorageName(normalized)}-${id.slice(0, 8)}`,
        createdAt: new Date().toISOString()
      };

      db.users.push(user);
      return this.safeUser(user);
    });
  }

  async verifyLogin(username, password) {
    const user = await this.getByLoginIdentifier(username);
    if (!user || !user.passwordHash) return null;

    const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
    return ok ? user : null;
  }

  async findOrLinkOAuthUser({ provider, providerId, email }) {
    const normalizedProvider = validateOAuthProvider(provider);
    const id = String(providerId || "").trim();
    const emailValue = validateEmail(email);

    if (!id) {
      const error = new Error("OAuth profile did not include an account id.");
      error.status = 400;
      throw error;
    }

    return this.withWrite(async (db) => {
      const byOAuth = db.users.find((entry) => userHasOAuth(entry, normalizedProvider, id));
      if (byOAuth) return this.safeUser(byOAuth);

      const byEmail = db.users.find((entry) => entry.email === emailValue);
      if (!byEmail) return null;

      byEmail.oauth = byEmail.oauth || [];
      byEmail.oauth.push({
        provider: normalizedProvider,
        providerId: id,
        linkedAt: new Date().toISOString()
      });
      return this.safeUser(byEmail);
    });
  }

  async createOAuthUser({ username, email, phone, provider, providerId, role = "user", quotaBytes }) {
    const normalized = validateUsername(username);
    const emailValue = validateEmail(email);
    const phoneValue = validatePhone(phone);
    const normalizedProvider = validateOAuthProvider(provider);
    const id = String(providerId || "").trim();
    const quota = normalizeQuotaBytes(quotaBytes, role);

    if (!id) {
      const error = new Error("OAuth profile did not include an account id.");
      error.status = 400;
      throw error;
    }

    return this.withWrite(async (db) => {
      ensureUniqueAccountFields(db, { username: normalized, email: emailValue, phone: phoneValue });

      const accountId = crypto.randomUUID();
      const user = {
        id: accountId,
        username: normalized,
        email: emailValue,
        phone: phoneValue,
        passwordHash: null,
        role,
        quotaBytes: quota,
        isBanned: false,
        oauth: [
          {
            provider: normalizedProvider,
            providerId: id,
            linkedAt: new Date().toISOString()
          }
        ],
        storageName: `${sanitizeStorageName(normalized)}-${accountId.slice(0, 8)}`,
        createdAt: new Date().toISOString()
      };

      db.users.push(user);
      return this.safeUser(user);
    });
  }

  async bootstrapAdminFromEnv({ username, passwordHash, quotaBytes }) {
    const normalized = normalizeUsername(username);
    if (!normalized || !passwordHash?.startsWith("$2")) return;
    const quota = normalizeQuotaBytes(quotaBytes, "admin");

    await this.withWrite(async (db) => {
      if (db.users.length > 0) return null;

      const id = crypto.randomUUID();
      db.users.push({
        id,
        username: validateUsername(normalized),
        email: null,
        phone: null,
        passwordHash,
        role: "admin",
        quotaBytes: quota,
        isBanned: false,
        oauth: [],
        storageName: `${sanitizeStorageName(normalized)}-${id.slice(0, 8)}`,
        createdAt: new Date().toISOString()
      });

      return null;
    });
  }

  async updateAdminQuota(quotaBytes) {
    const quota = normalizeQuotaBytes(quotaBytes, "admin");

    return this.withWrite(async (db) => {
      let changed = 0;

      for (const user of db.users) {
        if (user.role === "admin" && user.quotaBytes !== quota) {
          user.quotaBytes = quota;
          changed += 1;
        }
      }

      return changed;
    });
  }

  async updateUserQuota(id, quotaBytes) {
    return this.withWrite(async (db) => {
      const user = findUserOrThrow(db, id);
      user.quotaBytes = normalizeQuotaBytes(quotaBytes, user.role);
      return this.safeUser(user);
    });
  }

  async setUserBanned(id, isBanned) {
    return this.withWrite(async (db) => {
      const user = findUserOrThrow(db, id);
      user.isBanned = Boolean(isBanned);
      user.bannedAt = user.isBanned ? new Date().toISOString() : null;
      return this.safeUser(user);
    });
  }

  async setUserPassword(id, password) {
    const passwordValue = validatePassword(password);

    return this.withWrite(async (db) => {
      const user = findUserOrThrow(db, id);
      user.passwordHash = await bcrypt.hash(passwordValue, 12);
      user.passwordChangedAt = new Date().toISOString();
      return this.safeUser(user);
    });
  }
}

module.exports = {
  UserStore,
  normalizeQuotaBytes,
  normalizeEmail,
  normalizePhone,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername
};
