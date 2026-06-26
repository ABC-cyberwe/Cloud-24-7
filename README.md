# Cloud 24/7

Cloud 24/7 is a browser-based storage app hosted on this laptop.

It now supports:

- Free account creation
- Login per account
- Private file storage per user
- Upload and download from the browser
- Folder creation
- Per-account storage quota
- Unlimited app-level quota for admin accounts
- Password hashing
- Network/public-ready binding

## Important Reality

The app can run 24/7 only while this laptop is:

1. Powered on
2. Awake
3. Connected to the internet
4. Running this project

This project is now configured to listen on `0.0.0.0`, which means other devices can reach it when your network, firewall, router, tunnel, or hosting provider allows traffic to the app port.

That does not automatically create a public internet URL. For unknown public users, use a real domain, HTTPS, backups, abuse controls, storage monitoring, and signup controls before sharing the address widely.

Admin storage is unlimited only at the app quota level. Actual storage is still limited by the laptop, server disk, cloud volume, or object storage backing this app.

## Run

```powershell
npm.cmd start
```

Open on the laptop:

```text
http://127.0.0.1:8787
```

Open from another device that can reach this machine:

```text
http://<this-machine-ip>:8787
```

Public internet access requires routing traffic to this app with HTTPS through your preferred hosting, reverse proxy, tunnel, or router/firewall setup.

## Public URL With Render

Recommended public deployment for this project:

```text
GitHub repository -> Render Web Service -> https://your-app.onrender.com
```

This app has a Node/Express backend and filesystem storage, so use Render Web Service with a persistent disk. Do not use GitHub Pages for this app.

Follow [DEPLOY_RENDER.md](DEPLOY_RENDER.md).

## Existing Admin Login

The first admin account is created from `.env` when the user database is empty.

Default username:

```text
admin
```

The password is the one generated during setup.

## Admin Storage

Admin accounts have no app-level storage quota when this is set:

```text
ADMIN_QUOTA_BYTES=unlimited
```

The admin can keep uploading until the real storage backend runs out of space. The per-file upload limit still applies:

```text
MAX_UPLOAD_BYTES=2147483648
```

## Free User Accounts

Users can create accounts from the Cloud 24/7 page when this is enabled:

```text
ALLOW_SIGNUPS=true
```

Each account gets its own folder under:

```text
storage/users/
```

Each free account has this default quota:

```text
DEFAULT_USER_QUOTA_BYTES=5368709120
```

That is 5 GB per account.

## Private Access From Phone Or Another Device

Recommended private method:

1. Install Tailscale on the laptop.
2. Install Tailscale on your Android or other device.
3. Sign in to the same Tailscale account.
4. Keep this app running on the laptop.
5. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-private-tailscale-link.ps1
```

Use `tailscale serve`. Do not use `tailscale funnel` unless you intentionally want public internet exposure.

## Start Automatically On Windows Login

The no-admin startup method uses this script:

```text
scripts/run-cloud-forever.ps1
```

It starts Cloud 24/7 and restarts it if it exits.

The Windows Startup shortcut is:

```text
C:\Users\Lenovo\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Private Laptop Cloud.lnk
```

## Maintenance

Update dependencies occasionally:

```powershell
npm.cmd update
npm.cmd audit --audit-level=high
```

Change admin password:

```powershell
npm.cmd run setup -- admin "NewStrongPasswordHere"
```

Back up these folders if the files matter:

```text
storage/
data/
```

## Main Config

Settings live in `.env`.

- `APP_NAME`: visible app name
- `PORT`: app port, default `8787`
- `HOST`: use `0.0.0.0` for network/public-facing access or `127.0.0.1` for local-only access
- `STORAGE_PATH`: uploaded file storage root
- `USERS_DB_PATH`: local account database
- `DEFAULT_USER_QUOTA_BYTES`: free storage per account
- `ADMIN_QUOTA_BYTES`: use `unlimited` for no admin app-level quota
- `ALLOW_SIGNUPS`: enable or disable account creation
- `MAX_UPLOAD_BYTES`: max size of each uploaded file
- `REQUEST_TIMEOUT_MS`: upload request timeout
- `ALLOW_DELETE`: set to `true` only if browser deletion should be enabled
- `COOKIE_SECURE`: use `true` only when the site is served through HTTPS
