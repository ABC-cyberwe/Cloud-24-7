const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const bcrypt = require("bcryptjs");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");

function randomSecret(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function serializeEnv(values) {
  const order = [
    "APP_NAME",
    "PORT",
    "HOST",
    "STORAGE_PATH",
    "USERS_DB_PATH",
    "SESSION_DIR",
    "SESSION_SECRET",
    "TRUST_PROXY",
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD_HASH",
    "ADMIN_QUOTA_BYTES",
    "MAX_UPLOAD_BYTES",
    "MAX_FILES_PER_UPLOAD",
    "REQUEST_TIMEOUT_MS",
    "DEFAULT_USER_QUOTA_BYTES",
    "ALLOW_SIGNUPS",
    "ALLOW_DELETE",
    "COOKIE_SECURE"
  ];

  return `${order.map((key) => `${key}=${values[key]}`).join("\n")}\n`;
}

async function main() {
  const existing = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : {};
  const username = process.argv[2] || existing.ADMIN_USERNAME || "admin";
  const generatedPassword = randomSecret(18);
  const password = process.argv[3] || generatedPassword;

  const values = {
    APP_NAME: existing.APP_NAME || "Cloud 24/7",
    PORT: existing.PORT || "8787",
    HOST: existing.HOST || "0.0.0.0",
    STORAGE_PATH: existing.STORAGE_PATH || "./storage",
    USERS_DB_PATH: existing.USERS_DB_PATH || "./data/users.json",
    SESSION_DIR: existing.SESSION_DIR || "./sessions",
    SESSION_SECRET: existing.SESSION_SECRET || randomSecret(),
    TRUST_PROXY: existing.TRUST_PROXY || "loopback",
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD_HASH: await bcrypt.hash(password, 12),
    ADMIN_QUOTA_BYTES: existing.ADMIN_QUOTA_BYTES || "unlimited",
    MAX_UPLOAD_BYTES: existing.MAX_UPLOAD_BYTES || "2147483648",
    MAX_FILES_PER_UPLOAD: existing.MAX_FILES_PER_UPLOAD || "25",
    REQUEST_TIMEOUT_MS: existing.REQUEST_TIMEOUT_MS || "1800000",
    DEFAULT_USER_QUOTA_BYTES: existing.DEFAULT_USER_QUOTA_BYTES || "5368709120",
    ALLOW_SIGNUPS: existing.ALLOW_SIGNUPS || "true",
    ALLOW_DELETE: existing.ALLOW_DELETE || "false",
    COOKIE_SECURE: existing.COOKIE_SECURE || "false"
  };

  fs.writeFileSync(envPath, serializeEnv(values), { mode: 0o600 });

  console.log("Cloud 24/7 setup complete.");
  console.log(`Username: ${username}`);
  if (!process.argv[3]) {
    console.log(`Generated password: ${password}`);
    console.log("Save this password now. It is not stored in plain text.");
  } else {
    console.log("Password updated.");
  }
  console.log(`Config file: ${envPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
