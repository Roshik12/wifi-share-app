# Deploy Notes

## Short answer

This project now has two deploy paths:

- Full realtime Socket.IO app: Render, Railway, Fly.io, or a VPS.
- Netlify version: static frontend plus Netlify Functions and Netlify Blobs.

The Netlify version works, but it refreshes messages every few seconds instead of using true
Socket.IO realtime.

## Netlify Deploy

Deploy the `wifi-share-app` folder, not the parent folder.

1. Create a GitHub repository from this `wifi-share-app` folder.
2. In Netlify, choose **Add new site** -> **Import an existing project**.
3. Pick the repository.
4. Use these settings:

```text
Base directory: leave empty if the repo root is wifi-share-app
Build command: npm install
Publish directory: public
Functions directory: netlify/functions
```

5. Deploy.

For private text backups, add an environment variable in Netlify:

```text
ADMIN_BACKUP_TOKEN=choose-a-long-secret
```

Then download backups from:

```text
https://YOUR-SITE.netlify.app/api/admin-backup?token=choose-a-long-secret
```

Netlify upload note: files are limited to 4MB in the Netlify version because uploads pass through
serverless functions. The local/full Node server keeps the 5MB limit.

## Recommended simple deploy

1. Push this project to GitHub.
2. Create a new Web Service on Render or Railway.
3. Use these commands:

```bash
npm install
npm start
```

4. Set the port to use the host-provided `PORT` environment variable. This project already does that.
5. Add persistent storage for:

```text
server/data
uploads
```

Without persistent storage, live hosts may delete SQLite data, text backups, and uploaded files
when the service restarts.

## Fly.io Deploy

Run all commands from this folder:

```bash
cd /Users/roshik/Documents/Codex/2026-05-01/bro-i-am-trying-to-make/wifi-share-app
```

Install and log in:

```bash
brew install flyctl
fly auth login
```

Create the app without deploying yet:

```bash
fly launch --no-deploy
```

Create persistent storage for the database, text backup, and uploads:

```bash
fly volumes create wifi_share_data --size 1
```

Open the generated `fly.toml` and make sure it contains:

```toml
[env]
  DATA_DIR = "/data"
  UPLOADS_DIR = "/data/uploads"

[[mounts]]
  source = "wifi_share_data"
  destination = "/data"
```

Then deploy:

```bash
fly deploy
```

Check logs:

```bash
fly logs
```

## What Works

- Anonymous main room
- Password-matched private groups
- Text messages
- Code blocks
- Image upload and inline preview
- General file upload as downloadable attachments
- 5MB upload limit
- 28-hour message cleanup
- Local text backup at `server/data/text-backup.jsonl`

## Privacy Note

The text backup file is outside `/public`, so visitors cannot open it through the website. On a live
host, keep `server/data` private and mount it as persistent storage.
