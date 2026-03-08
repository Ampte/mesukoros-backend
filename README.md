# Backend (MesuKoros)

Express API for MesuKoros. This folder is fully standalone and can be pushed to its own GitHub repository.

## Local run

```bash
npm install
npm run dev
```

## Environment
Copy `.env.example` to `.env` and set:

- `NODE_ENV=production`
- `PORT=4000` (or use host-provided port)
- `JWT_SECRET=<strong-secret>`
- `CLIENT_URL=https://your-frontend-domain.com`
- `FRONTEND_DIST=<path>` (optional, only when backend also serves frontend build)

`CLIENT_URL` can be a comma-separated list of allowed origins.

## Start

```bash
npm run start
```

## Health endpoint
- `GET /api/health`

## Push backend as separate repo

```bash
cd backend
git init
git add .
git commit -m "Backend initial"
git branch -M main
git remote add origin https://github.com/<your-user>/<backend-repo>.git
git push -u origin main
```
