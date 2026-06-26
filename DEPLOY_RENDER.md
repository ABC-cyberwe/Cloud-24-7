# Deploy Cloud 24/7 On Render

This project is a Node/Express web app, so use Render Web Service, not Static Site or GitHub Pages.

The repo includes `render.yaml`, which creates:

- One Node web service
- Free-plan ephemeral storage under `/tmp/cloud-24-7`
- HTTPS-safe session cookie settings
- Health checks at `/api/health`
- Automatic redeploys on each pushed commit

Render docs used for this setup:

- Web services: https://render.com/docs/web-services
- Persistent disks: https://render.com/docs/disks
- Blueprint YAML: https://render.com/docs/blueprint-spec
- Free service limits: https://render.com/docs/free

## Why Persistent Disk

Cloud 24/7 stores users and files on the filesystem:

- Users database: `data/users.json`
- Uploaded files: `storage/users/`
- Sessions: `sessions/`

Render free web services use an ephemeral filesystem, so local file changes can disappear after deploys, restarts, and idle spin-downs. The included blueprint uses the free plan, so treat it as a no-cost demo unless you later add persistent storage.

## Prepare Admin Password

Create a bcrypt hash for the Render admin password:

```powershell
npm.cmd run hash-password -- "YourStrongAdminPassword"
```

Copy the printed hash. Paste it into Render when the blueprint asks for `ADMIN_PASSWORD_HASH`.

Do not commit your plain password or local `.env` file.

## Push To GitHub

If this folder is not already a Git repo:

```powershell
git init
git add .
git commit -m "Prepare Render deployment"
```

Create a new GitHub repository, then push:

```powershell
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git branch -M main
git push -u origin main
```

## Deploy With Render Blueprint

1. Sign in to Render.
2. Choose New > Blueprint.
3. Select the GitHub repository.
4. Use the included `render.yaml`.
5. When Render asks for `ADMIN_PASSWORD_HASH`, paste the hash from the earlier command.
6. Create/apply the blueprint.

After deploy, Render gives you a public URL like:

```text
https://cloud-24-7.onrender.com
```

## Important Defaults

The Render deployment sets:

```text
ALLOW_SIGNUPS=false
ALLOW_DELETE=false
COOKIE_SECURE=true
HOST=0.0.0.0
TRUST_PROXY=1
```

Turn on signups only if you are ready for public users to upload files to an ephemeral free service.

## Existing Local Data

Your local `.env`, `data/users.json`, `storage/`, `sessions/`, and `logs/` are intentionally ignored by Git.

That means the first Render deploy starts with a fresh users database and empty storage. Free Render storage is ephemeral, so existing local data should not be moved there unless you only need a short-lived demo.

If you later upgrade to paid persistent storage, use these disk-backed paths:

```text
/var/data/data/users.json
/var/data/storage/users/
```

Use Render Shell/SCP or another secure transfer method after the service is deployed.

## Persistent Storage Upgrade

For real storage, change `plan: free` to a paid plan such as `starter`, add this block to `render.yaml`, and switch the storage env vars back to `/var/data`:

```yaml
disk:
  name: cloud-24-7-data
  mountPath: /var/data
  sizeGB: 10
```

Do not use the free setup for permanent file storage: uploaded files and local user data can be lost.
