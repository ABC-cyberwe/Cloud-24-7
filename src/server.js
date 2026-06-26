const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");

require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const multer = require("multer");
const session = require("express-session");
const FileStoreFactory = require("session-file-store");

const { UserStore } = require("./userStore");

const FileStore = FileStoreFactory(session);
const app = express();

function parseQuotaConfig(value, name, allowUnlimited = false) {
  const raw = String(value || "").trim().toLowerCase();

  if (allowUnlimited && ["unlimited", "none"].includes(raw)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    failStartup(`${name} must be a positive number${allowUnlimited ? ' or "unlimited"' : ""}.`);
  }

  return parsed;
}

function parseBooleanConfig(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseTrustProxyConfig(value) {
  const fallback = process.env.RENDER ? 1 : "loopback";
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const raw = String(value).trim().toLowerCase();
  if (raw === "true") return 1;
  if (raw === "false") return false;

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  return value;
}

const APP_NAME = process.env.APP_NAME || "Cloud 24/7";
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, "..", "storage"));
const USERS_STORAGE_ROOT = path.join(STORAGE_ROOT, "users");
const USERS_DB_PATH = path.resolve(process.env.USERS_DB_PATH || path.join(__dirname, "..", "data", "users.json"));
const SESSION_DIR = path.resolve(process.env.SESSION_DIR || path.join(__dirname, "..", "sessions"));
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const TRUST_PROXY = parseTrustProxyConfig(process.env.TRUST_PROXY);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 2147483648);
const MAX_FILES_PER_UPLOAD = Number(process.env.MAX_FILES_PER_UPLOAD || 25);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 1800000);
const DEFAULT_USER_QUOTA_BYTES = parseQuotaConfig(process.env.DEFAULT_USER_QUOTA_BYTES || 5368709120, "DEFAULT_USER_QUOTA_BYTES");
const ADMIN_QUOTA_BYTES = parseQuotaConfig(process.env.ADMIN_QUOTA_BYTES || "unlimited", "ADMIN_QUOTA_BYTES", true);
const ALLOW_SIGNUPS = parseBooleanConfig(process.env.ALLOW_SIGNUPS, true);
const ALLOW_DELETE = parseBooleanConfig(process.env.ALLOW_DELETE, false);
const COOKIE_SECURE = parseBooleanConfig(process.env.COOKIE_SECURE, Boolean(process.env.RENDER));

const userStore = new UserStore(USERS_DB_PATH);

function failStartup(message) {
  console.error(`\nStartup blocked: ${message}`);
  console.error("Run: npm.cmd run setup");
  process.exit(1);
}

if (SESSION_SECRET.length < 32) {
  failStartup("SESSION_SECRET must be at least 32 characters.");
}

fs.mkdirSync(USERS_STORAGE_ROOT, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: "same-origin" }
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use(
  session({
    name: "cloud247.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new FileStore({
      path: SESSION_DIR,
      ttl: 60 * 60 * 12,
      retries: 0
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

function normalizeRelativePath(input) {
  const raw = String(input || "").replace(/\\/g, "/");
  if (raw.includes("\0")) {
    const error = new Error("Invalid path.");
    error.status = 400;
    throw error;
  }
  const normalized = path.posix.normalize(`/${raw}`).slice(1);
  return normalized === "." ? "" : normalized;
}

function assertInside(rootPath, targetPath) {
  const rootLower = rootPath.toLowerCase();
  const targetLower = targetPath.toLowerCase();

  if (targetLower !== rootLower && !targetLower.startsWith(`${rootLower}${path.sep}`)) {
    const error = new Error("Path is outside your storage.");
    error.status = 400;
    throw error;
  }
}

function userRoot(user) {
  return path.join(USERS_STORAGE_ROOT, user.storageName);
}

async function ensureUserRoot(user) {
  const root = userRoot(user);
  await fsp.mkdir(root, { recursive: true });
  return root;
}

async function resolveStoragePath(user, input) {
  const root = await ensureUserRoot(user);
  const relativePath = normalizeRelativePath(input);
  const targetPath = path.resolve(root, relativePath);
  assertInside(root, targetPath);
  return { root, relativePath, targetPath };
}

const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function sanitizeName(name) {
  const raw = String(name || "").replace(/\\/g, "/");
  let clean = path.posix.basename(raw);
  clean = clean.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim();
  clean = clean.replace(/^\.+$/, "");
  clean = clean.slice(0, 180).trim();

  if (!clean) {
    const error = new Error("Invalid file or folder name.");
    error.status = 400;
    throw error;
  }

  if (reservedWindowsNames.test(clean)) {
    clean = `_${clean}`;
  }

  return clean;
}

async function directorySize(targetPath) {
  let total = 0;
  let entries;

  try {
    entries = await fsp.readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
      continue;
    }

    if (entry.isFile()) {
      const stat = await fsp.stat(entryPath);
      total += stat.size;
    }
  }

  return total;
}

function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

async function requireAuth(req, res, next) {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Login required." });
    }

    const user = await userStore.getById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Login required." });
    }

    if (user.isBanned) {
      req.session.destroy(() => {});
      return res.status(403).json({ error: "This account is banned." });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }

  return next();
}

function requireCsrf(req, res, next) {
  const supplied = req.get("x-csrf-token") || req.body?._csrf || "";
  if (!supplied || supplied !== req.session.csrfToken) {
    return res.status(403).json({ error: "Security token expired. Please refresh and try again." });
  }
  return next();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

async function uniquePath(directory, requestedName) {
  const parsed = path.parse(requestedName);
  let candidate = requestedName;
  let counter = 1;

  while (true) {
    const fullPath = path.join(directory, candidate);
    try {
      await fsp.access(fullPath);
      candidate = `${parsed.name} (${counter})${parsed.ext}`;
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

async function usagePayload(user) {
  const root = await ensureUserRoot(user);
  const usageBytes = await directorySize(root);
  const quotaUnlimited = user.quotaBytes === null;
  const quotaBytes = quotaUnlimited ? null : Number(user.quotaBytes);

  return {
    usageBytes,
    quotaBytes,
    quotaUnlimited,
    usagePercent: quotaUnlimited ? 0 : Math.min(100, Math.round((usageBytes / quotaBytes) * 100))
  };
}

async function rejectIfQuotaWouldOverflow(req, res, next) {
  try {
    if (req.user.quotaBytes === null) {
      return next();
    }

    const contentLength = Number(req.get("content-length") || 0);
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return next();
    }

    const root = await ensureUserRoot(req.user);
    const used = await directorySize(root);
    const quotaBytes = Number(req.user.quotaBytes);
    if (used + contentLength > quotaBytes) {
      return res.status(413).json({ error: "Upload would exceed this account's free storage quota." });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

async function cleanupUploadedFiles(files = []) {
  await Promise.all(
    files.map((file) => fsp.rm(file.path, { force: true }).catch(() => {}))
  );
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, req.uploadDirectory);
    },
    filename(req, file, cb) {
      uniquePath(req.uploadDirectory, sanitizeName(file.originalname))
        .then((name) => cb(null, name))
        .catch((error) => cb(error));
    }
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: MAX_FILES_PER_UPLOAD
  }
});

app.get("/api/config", (req, res) => {
  res.json({
    appName: APP_NAME,
    allowSignups: ALLOW_SIGNUPS,
    defaultUserQuotaBytes: DEFAULT_USER_QUOTA_BYTES,
    adminQuotaUnlimited: ADMIN_QUOTA_BYTES === null
  });
});

app.post("/api/signup", signupLimiter, async (req, res, next) => {
  try {
    if (!ALLOW_SIGNUPS) {
      return res.status(403).json({ error: "New account creation is currently disabled." });
    }

    const user = await userStore.createUser({
      username: req.body?.username,
      password: req.body?.password,
      role: "user",
      quotaBytes: DEFAULT_USER_QUOTA_BYTES
    });

    await ensureUserRoot(user);
    await regenerateSession(req);
    req.session.userId = user.id;
    const csrfToken = getCsrfToken(req);

    return res.status(201).json({
      user,
      csrfToken,
      allowDelete: ALLOW_DELETE,
      ...(await usagePayload(user))
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/login", loginLimiter, async (req, res, next) => {
  try {
    const user = await userStore.verifyLogin(req.body?.username, req.body?.password);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: "This account is banned." });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    const csrfToken = getCsrfToken(req);

    return res.json({
      user: userStore.safeUser(user),
      csrfToken,
      allowDelete: ALLOW_DELETE,
      ...(await usagePayload(user))
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/logout", requireAuth, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("cloud247.sid");
    return res.json({ ok: true });
  });
});

app.get("/api/session", requireAuth, async (req, res, next) => {
  try {
    res.json({
      user: userStore.safeUser(req.user),
      username: req.user.username,
      csrfToken: getCsrfToken(req),
      allowDelete: ALLOW_DELETE,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxFilesPerUpload: MAX_FILES_PER_UPLOAD,
      ...(await usagePayload(req.user))
    });
  } catch (error) {
    next(error);
  }
});

async function adminUserPayload(user) {
  return {
    ...userStore.safeUser(user),
    ...(await usagePayload(user))
  };
}

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await userStore.listUsers();
    const payload = await Promise.all(
      users.map(async (user) => ({
        ...user,
        ...(await usagePayload(user))
      }))
    );

    res.json({ users: payload });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/users/:id/quota", requireAuth, requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const updated = await userStore.updateUserQuota(req.params.id, req.body?.quotaBytes);
    res.json({ user: await adminUserPayload(updated) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/users/:id/ban", requireAuth, requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const isBanned = Boolean(req.body?.isBanned);

    if (isBanned && req.params.id === req.user.id) {
      return res.status(400).json({ error: "You cannot ban the account you are currently using." });
    }

    const updated = await userStore.setUserBanned(req.params.id, isBanned);
    res.json({ user: await adminUserPayload(updated) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/users/:id/password", requireAuth, requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const updated = await userStore.setUserPassword(req.params.id, req.body?.password);
    res.json({ user: await adminUserPayload(updated) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/list", requireAuth, async (req, res, next) => {
  try {
    const { relativePath, targetPath } = await resolveStoragePath(req.user, req.query.path);
    const stat = await fsp.stat(targetPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Path is not a folder." });
    }

    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(targetPath, entry.name);
        const entryStat = await fsp.stat(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? "folder" : "file",
          size: entry.isDirectory() ? null : entryStat.size,
          modifiedAt: entryStat.mtime.toISOString()
        };
      })
    );

    files.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

    res.json({ path: relativePath, files, ...(await usagePayload(req.user)) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/folder", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const parent = await resolveStoragePath(req.user, req.body.path);
    const parentStat = await fsp.stat(parent.targetPath);
    if (!parentStat.isDirectory()) {
      return res.status(400).json({ error: "Parent path is not a folder." });
    }

    const folderName = sanitizeName(req.body.name);
    const folderRelativePath = path.posix.join(parent.relativePath, folderName);
    const folder = await resolveStoragePath(req.user, folderRelativePath);

    await fsp.mkdir(folder.targetPath);
    res.status(201).json({ ok: true, name: folderName, ...(await usagePayload(req.user)) });
  } catch (error) {
    if (error.code === "EEXIST") {
      error.status = 409;
      error.message = "A folder with that name already exists.";
    }
    next(error);
  }
});

app.post(
  "/api/upload",
  requireAuth,
  requireCsrf,
  rejectIfQuotaWouldOverflow,
  async (req, res, next) => {
    try {
      const uploadTarget = await resolveStoragePath(req.user, req.query.path);
      const stat = await fsp.stat(uploadTarget.targetPath);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: "Upload path is not a folder." });
      }
      req.uploadDirectory = uploadTarget.targetPath;
      return next();
    } catch (error) {
      return next(error);
    }
  },
  upload.array("files", MAX_FILES_PER_UPLOAD),
  async (req, res, next) => {
    try {
      const usage = await usagePayload(req.user);
      if (!usage.quotaUnlimited && usage.usageBytes > usage.quotaBytes) {
        await cleanupUploadedFiles(req.files);
        return res.status(413).json({ error: "Upload exceeded this account's free storage quota." });
      }

      res.status(201).json({
        ok: true,
        files: (req.files || []).map((file) => ({
          name: file.filename,
          size: file.size
        })),
        ...usage
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/download", requireAuth, async (req, res, next) => {
  try {
    const { targetPath } = await resolveStoragePath(req.user, req.query.path);
    const stat = await fsp.stat(targetPath);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "Only files can be downloaded." });
    }
    res.download(targetPath, path.basename(targetPath));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/item", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    if (!ALLOW_DELETE) {
      return res.status(403).json({ error: "Delete is disabled by server settings." });
    }

    const requestedPath = normalizeRelativePath(req.query.path);
    if (!requestedPath) {
      return res.status(400).json({ error: "The storage root cannot be deleted." });
    }

    const { targetPath } = await resolveStoragePath(req.user, requestedPath);
    await fsp.rm(targetPath, { recursive: true, force: false });
    return res.json({ ok: true, ...(await usagePayload(req.user)) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    appName: APP_NAME,
    privateByDefault: HOST === "127.0.0.1",
    publicListening: HOST === "0.0.0.0" || HOST === "::",
    signupsEnabled: ALLOW_SIGNUPS
  });
});

app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html" }));

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? `A file is larger than the ${MAX_UPLOAD_BYTES} byte limit.`
      : error.message;
    return res.status(400).json({ error: message });
  }

  const status = error.status || (error.code === "ENOENT" ? 404 : 500);
  const message = status >= 500 ? "Server error." : error.message;
  if (status >= 500) {
    console.error(error);
  }
  return res.status(status).json({ error: message });
});

async function start() {
  await userStore.init();
  await userStore.bootstrapAdminFromEnv({
    username: ADMIN_USERNAME,
    passwordHash: ADMIN_PASSWORD_HASH,
    quotaBytes: ADMIN_QUOTA_BYTES
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`${APP_NAME} running at http://${HOST}:${PORT}`);
    console.log(`User storage folder: ${USERS_STORAGE_ROOT}`);
  });

  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(60000, REQUEST_TIMEOUT_MS);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
