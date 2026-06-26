const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const loginTab = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authMessage = document.getElementById("authMessage");
const appMessage = document.getElementById("appMessage");
const fileList = document.getElementById("fileList");
const emptyState = document.getElementById("emptyState");
const pathLabel = document.getElementById("pathLabel");
const breadcrumbs = document.getElementById("breadcrumbs");
const fileInput = document.getElementById("fileInput");
const uploadButton = document.getElementById("uploadButton");
const refreshButton = document.getElementById("refreshButton");
const logoutButton = document.getElementById("logoutButton");
const newFolderButton = document.getElementById("newFolderButton");
const adminButton = document.getElementById("adminButton");
const closeAdminButton = document.getElementById("closeAdminButton");
const adminPanel = document.getElementById("adminPanel");
const adminUserList = document.getElementById("adminUserList");
const adminMessage = document.getElementById("adminMessage");
const accountLabel = document.getElementById("accountLabel");
const usageFill = document.getElementById("usageFill");
const usageLabel = document.getElementById("usageLabel");

let csrfToken = "";
let currentPath = "";
let allowDelete = false;
let appConfig = { allowSignups: true };
let currentUser = null;

function showAuth(mode = "login", message = "") {
  authView.hidden = false;
  appView.hidden = true;
  adminPanel.hidden = true;
  adminButton.hidden = true;
  currentUser = null;
  setAuthMode(mode);
  authMessage.textContent = message;
}

function showApp() {
  authView.hidden = true;
  appView.hidden = false;
}

function setAuthMode(mode) {
  const isSignup = mode === "signup";
  loginForm.hidden = isSignup;
  signupForm.hidden = !isSignup;
  loginTab.classList.toggle("active", !isSignup);
  signupTab.classList.toggle("active", isSignup);
  authMessage.textContent = "";
}

function setMessage(message, isError = false) {
  appMessage.textContent = message;
  appMessage.classList.toggle("error", isError);
}

function setAdminMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle("error", isError);
}

function setAuthMessage(message, isError = true) {
  authMessage.textContent = message;
  authMessage.classList.toggle("error", isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken && options.method && options.method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(data?.error || "Request failed.");
    error.status = response.status;
    throw error;
  }

  return data;
}

function joinPath(base, name) {
  return [base, name].filter(Boolean).join("/");
}

function formatSize(size) {
  if (size === null || size === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(size);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function bytesToGb(size) {
  const value = Number(size) / (1024 ** 3);
  return String(Math.round(value * 100) / 100);
}

function gbToBytes(value) {
  const gb = Number(value);
  if (!Number.isFinite(gb) || gb <= 0) {
    throw new Error("Quota must be a positive GB amount.");
  }
  return Math.round(gb * (1024 ** 3));
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function updateAccount(data) {
  if (data.user?.username) {
    currentUser = data.user;
    accountLabel.textContent = data.user.username;
    adminButton.hidden = data.user.role !== "admin";
  }

  if (typeof data.usageBytes === "number" && data.quotaUnlimited) {
    usageFill.style.width = "0%";
    usageLabel.textContent = `${formatSize(data.usageBytes)} used of unlimited storage`;
    return;
  }

  if (typeof data.usageBytes === "number" && typeof data.quotaBytes === "number") {
    const percent = data.quotaBytes > 0 ? Math.min(100, Math.round((data.usageBytes / data.quotaBytes) * 100)) : 0;
    usageFill.style.width = `${percent}%`;
    usageLabel.textContent = `${formatSize(data.usageBytes)} of ${formatSize(data.quotaBytes)} used`;
  }
}

function renderBreadcrumbs() {
  breadcrumbs.replaceChildren();

  const rootButton = document.createElement("button");
  rootButton.type = "button";
  rootButton.textContent = "Root";
  rootButton.addEventListener("click", () => loadFiles(""));
  breadcrumbs.append(rootButton);

  const parts = currentPath ? currentPath.split("/") : [];
  let pathSoFar = "";

  for (const part of parts) {
    pathSoFar = joinPath(pathSoFar, part);
    const separator = document.createElement("span");
    separator.textContent = "/";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = part;
    const nextPath = pathSoFar;
    button.addEventListener("click", () => loadFiles(nextPath));
    breadcrumbs.append(separator, button);
  }
}

function renderFiles(files) {
  fileList.replaceChildren();
  emptyState.hidden = files.length !== 0;

  for (const file of files) {
    const row = document.createElement("div");
    row.className = "file-row";

    const name = document.createElement("button");
    name.type = "button";
    name.className = "name-cell";
    name.textContent = `${file.type === "folder" ? "[DIR] " : ""}${file.name}`;
    name.addEventListener("click", () => {
      if (file.type === "folder") {
        loadFiles(joinPath(currentPath, file.name));
      }
    });

    const size = document.createElement("span");
    size.textContent = formatSize(file.size);

    const modified = document.createElement("span");
    modified.textContent = formatDate(file.modifiedAt);

    const actions = document.createElement("span");
    actions.className = "row-actions";

    if (file.type === "file") {
      const download = document.createElement("a");
      download.href = `/api/download?path=${encodeURIComponent(joinPath(currentPath, file.name))}`;
      download.textContent = "Download";
      actions.append(download);
    }

    if (allowDelete) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => deleteItem(file.name));
      actions.append(remove);
    }

    row.append(name, size, modified, actions);
    fileList.append(row);
  }
}

function renderAdminUsers(users) {
  adminUserList.replaceChildren();

  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No accounts yet.";
    adminUserList.append(empty);
    return;
  }

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "admin-row";
    row.classList.toggle("banned", user.isBanned);

    const account = document.createElement("div");
    account.className = "admin-account";
    const username = document.createElement("strong");
    username.textContent = user.username;
    const role = document.createElement("small");
    role.textContent = `${user.role}${user.id === currentUser?.id ? " / current" : ""}`;
    account.append(username, role);

    const storage = document.createElement("span");
    storage.textContent = `${formatSize(user.usageBytes)} used`;

    const quota = document.createElement("div");
    quota.className = "admin-quota";

    const quotaInput = document.createElement("input");
    quotaInput.type = "number";
    quotaInput.min = "0.1";
    quotaInput.step = "0.1";
    quotaInput.placeholder = "GB";
    quotaInput.value = user.quotaUnlimited ? "" : bytesToGb(user.quotaBytes);
    quotaInput.disabled = user.quotaUnlimited;

    const gbLabel = document.createElement("span");
    gbLabel.textContent = "GB";

    const unlimitedLabel = document.createElement("label");
    unlimitedLabel.className = "inline-check";
    const unlimitedInput = document.createElement("input");
    unlimitedInput.type = "checkbox";
    unlimitedInput.checked = user.quotaUnlimited;
    unlimitedInput.disabled = user.role !== "admin";
    unlimitedInput.addEventListener("change", () => {
      quotaInput.disabled = unlimitedInput.checked;
      if (unlimitedInput.checked) quotaInput.value = "";
    });
    unlimitedLabel.append(unlimitedInput, document.createTextNode("Unlimited"));

    const saveQuota = document.createElement("button");
    saveQuota.type = "button";
    saveQuota.textContent = "Save";
    saveQuota.addEventListener("click", () => saveUserQuota(user, quotaInput, unlimitedInput));

    quota.append(quotaInput, gbLabel);
    if (user.role === "admin") {
      quota.append(unlimitedLabel);
    }
    quota.append(saveQuota);

    const password = document.createElement("div");
    password.className = "admin-password";
    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.placeholder = "New password";
    passwordInput.autocomplete = "new-password";
    const passwordButton = document.createElement("button");
    passwordButton.type = "button";
    passwordButton.textContent = "Set";
    passwordButton.addEventListener("click", () => setUserPassword(user, passwordInput));
    password.append(passwordInput, passwordButton);

    const status = document.createElement("div");
    status.className = "admin-status";
    const statusLabel = document.createElement("span");
    statusLabel.textContent = user.isBanned ? "Banned" : "Active";
    const banButton = document.createElement("button");
    banButton.type = "button";
    banButton.textContent = user.isBanned ? "Unban" : "Ban";
    banButton.disabled = user.id === currentUser?.id;
    banButton.addEventListener("click", () => toggleUserBan(user));
    status.append(statusLabel, banButton);

    row.append(account, storage, quota, password, status);
    adminUserList.append(row);
  }
}

async function loadConfig() {
  appConfig = await api("/api/config");
  signupTab.hidden = !appConfig.allowSignups;
}

async function loadSession() {
  const session = await api("/api/session");
  csrfToken = session.csrfToken;
  allowDelete = session.allowDelete;
  updateAccount(session);
}

async function loadAdminUsers({ keepMessage = false } = {}) {
  try {
    if (!keepMessage) setAdminMessage("");
    const data = await api("/api/admin/users");
    renderAdminUsers(data.users);
  } catch (error) {
    setAdminMessage(error.message, true);
  }
}

async function saveUserQuota(user, quotaInput, unlimitedInput) {
  try {
    const quotaBytes = user.role === "admin" && unlimitedInput.checked
      ? "unlimited"
      : gbToBytes(quotaInput.value);

    await api(`/api/admin/users/${encodeURIComponent(user.id)}/quota`, {
      method: "PATCH",
      body: JSON.stringify({ quotaBytes })
    });

    await loadSession();
    await loadAdminUsers({ keepMessage: true });
    setAdminMessage("Quota saved.");
  } catch (error) {
    setAdminMessage(error.message, true);
  }
}

async function toggleUserBan(user) {
  if (user.id === currentUser?.id) {
    setAdminMessage("You cannot ban the account you are currently using.", true);
    return;
  }

  const action = user.isBanned ? "unban" : "ban";
  if (!window.confirm(`${action === "ban" ? "Ban" : "Unban"} "${user.username}"?`)) return;

  try {
    await api(`/api/admin/users/${encodeURIComponent(user.id)}/ban`, {
      method: "PATCH",
      body: JSON.stringify({ isBanned: !user.isBanned })
    });

    await loadAdminUsers({ keepMessage: true });
    setAdminMessage(user.isBanned ? "Account unbanned." : "Account banned.");
  } catch (error) {
    setAdminMessage(error.message, true);
  }
}

async function setUserPassword(user, passwordInput) {
  const password = passwordInput.value;
  if (!password) {
    setAdminMessage("Enter a new password.", true);
    return;
  }

  try {
    await api(`/api/admin/users/${encodeURIComponent(user.id)}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password })
    });

    await loadAdminUsers({ keepMessage: true });
    setAdminMessage("Password changed.");
  } catch (error) {
    setAdminMessage(error.message, true);
  }
}

async function loadFiles(path = currentPath) {
  try {
    setMessage("");
    const data = await api(`/api/list?path=${encodeURIComponent(path)}`);
    currentPath = data.path || "";
    pathLabel.textContent = `/${currentPath}`;
    updateAccount(data);
    renderBreadcrumbs();
    renderFiles(data.files);
  } catch (error) {
    if (error.status === 401) {
      showAuth("login");
      return;
    }
    setMessage(error.message, true);
  }
}

async function uploadFiles(files) {
  if (!files.length) return;

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  try {
    setMessage("Uploading...");
    const result = await api(`/api/upload?path=${encodeURIComponent(currentPath)}`, {
      method: "POST",
      body: formData
    });
    updateAccount(result);
    setMessage("Upload complete.");
    await loadFiles();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    fileInput.value = "";
  }
}

async function createFolder() {
  const name = window.prompt("Folder name");
  if (!name) return;

  try {
    const result = await api("/api/folder", {
      method: "POST",
      body: JSON.stringify({ path: currentPath, name })
    });
    updateAccount(result);
    await loadFiles();
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function deleteItem(name) {
  const target = joinPath(currentPath, name);
  const ok = window.confirm(`Delete "${name}"?`);
  if (!ok) return;

  try {
    const result = await api(`/api/item?path=${encodeURIComponent(target)}`, { method: "DELETE" });
    updateAccount(result);
    await loadFiles();
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function completeAuth(result) {
  csrfToken = result.csrfToken;
  allowDelete = result.allowDelete;
  updateAccount(result);
  showApp();
  await loadFiles("");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("");

  const body = {
    username: document.getElementById("loginUsername").value,
    password: document.getElementById("loginPassword").value
  };

  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(body)
    });
    await completeAuth(result);
  } catch (error) {
    setAuthMessage(error.message);
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("");

  const password = document.getElementById("signupPassword").value;
  const confirm = document.getElementById("signupPasswordConfirm").value;
  if (password !== confirm) {
    setAuthMessage("Passwords do not match.");
    return;
  }

  const body = {
    username: document.getElementById("signupUsername").value,
    password
  };

  try {
    const result = await api("/api/signup", {
      method: "POST",
      body: JSON.stringify(body)
    });
    await completeAuth(result);
  } catch (error) {
    setAuthMessage(error.message);
  }
});

loginTab.addEventListener("click", () => setAuthMode("login"));
signupTab.addEventListener("click", () => setAuthMode("signup"));
uploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => uploadFiles([...fileInput.files]));
refreshButton.addEventListener("click", () => loadFiles());
newFolderButton.addEventListener("click", createFolder);
adminButton.addEventListener("click", async () => {
  adminPanel.hidden = false;
  await loadAdminUsers();
});
closeAdminButton.addEventListener("click", () => {
  adminPanel.hidden = true;
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    csrfToken = "";
    currentUser = null;
    adminPanel.hidden = true;
    showAuth("login");
  }
});

(async function start() {
  try {
    await loadConfig();
  } catch {
    appConfig = { allowSignups: true };
  }

  try {
    await loadSession();
    showApp();
    await loadFiles("");
  } catch {
    showAuth("login");
  }
})();
