# Backend (MesuKoros)

Express API for MesuKoros.

## Local run

```bash
npm install
npm run dev
```

## Environment
Copy `.env.example` to `.env` and set:

- `NODE_ENV=production`
- `PORT=4000`
- `JWT_SECRET=<strong-secret>`
- `CLIENT_URL=https://your-frontend-domain.com`

`CLIENT_URL` can be a comma-separated list of allowed origins.

## Start

```bash
npm run start
```

## Health endpoint
- `GET /api/health`
