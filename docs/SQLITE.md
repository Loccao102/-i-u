# SQLite personal persistence

## Purpose

SQLite is the temporary persistence layer for the personal-first phase.

It lets the application validate product behavior before introducing accounts, cloud sync and group authorization.

## Runtime requirement

Node 22+ is required because the implementation uses the built-in `node:sqlite` module.

## Database path

Default:

```text
.data/di-dau.sqlite
```

Override:

```bash
SQLITE_PATH=/srv/di-dau/di-dau.sqlite
```

The parent directory is created automatically.

## Tables

- `personal_places`
- `saved_places`
- `personal_ratings`
- `visits`
- `collections`
- `collection_places`

All personal rows include `owner_key`.

## SQLite configuration

At startup the database enables:

- WAL journal mode;
- foreign keys;
- 5-second busy timeout.

Delete-place operations use an immediate transaction so related personal data is removed together.

## Backup

For a single-user deployment, stop writes briefly and copy the SQLite database safely using SQLite backup tooling or the SQLite CLI.

Do not rely on copying only the main `.sqlite` file while active WAL writes are in progress unless the backup method understands WAL.

## Deployment

Good:

- local machine;
- desktop-adjacent server;
- one VPS process;
- one container with a durable mounted volume.

Not recommended:

- multiple app replicas sharing a local filesystem path;
- ephemeral serverless filesystem;
- horizontal scale.

Migrate to PostgreSQL/PostGIS before those deployment modes.

## Privacy

The database stores place coordinates but never stores the browser's current/live GPS coordinate.

POI search can receive current latitude/longitude transiently for proximity bias. Those values must not be persisted or intentionally logged.
