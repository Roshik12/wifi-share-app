# Local WiFi Share

A small local-network web app for sharing text, code blocks, images, and files with anonymous users in access-code protected groups.

## Setup

```bash
npm install
npm start
```

If this machine has Node but does not have `npm`, you can still preview the app with the
dependency-free fallback server:

```bash
node server/standalone-dev-server.js
```

Open the printed WiFi URL from another device on the same network, for example:

```text
http://192.168.x.x:3000
```

## Project Structure

```text
/server
  server.js       Express, Socket.IO, uploads, cleanup job
  database.js     SQLite database setup and queries
  /data           SQLite database file is created here
/public
  index.html      Chat UI
  style.css       Dark responsive styling
  script.js       Socket.IO client and upload handling
/uploads          Stored image files
```

## Notes

- File uploads are limited to 5MB.
- Messages and file metadata are stored in SQLite.
- Messages older than 28 hours are removed automatically.
- Associated uploaded image files are deleted during cleanup.
- The main room is anonymous and open.
- Private group names are unique and require the matching group password to join.
- Text message backups are appended to `server/data/text-backup.jsonl`, which is outside the public web folder.
- The server binds to `0.0.0.0`, so other devices on the same WiFi can connect using your computer's local IP.
