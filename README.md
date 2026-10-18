# ValsadMedia

ValsadMedia is a bilingual regional news portal starter for Valsad and Gujarat. It contains a React/Vite responsive editorial interface and an Express/Mongoose API with session authentication, article/category/location models, public content endpoints, and admin CRUD endpoints.

## Project structure

```text
client/                 React + Vite website
  src/App.jsx            Public routes and editorial UI
  src/styles.css         Responsive newspaper styling
  src/api.js             Credentialed API client
server/                 Express + MongoDB API
  src/index.js            REST API and session middleware
  src/models.js           Mongoose models and indexes
```

## Requirements and local setup

- Node.js 20 or newer
- MongoDB local instance or MongoDB Atlas database

```sh
npm install
```

Copy `server/.env.example` to `server/.env`. Set `MONGODB_URI` and a random `SESSION_SECRET` of 32+ characters. Then:

```sh
npm run dev
```

Vite serves the site at `http://localhost:5173`; the API listens on `http://localhost:5000`. Vite proxies `/api` to the API. Configure `CLIENT_URL` to the exact client origin. Do not commit `.env` files.


## Environment

See `server/.env.example` for server-only secrets. The client uses the relative `/api/v1` path by default; only set `VITE_API_BASE_URL` in a client environment when intentionally overriding that API URL. Never put database, session, or news provider secrets in Vite variables.

## API

All routes use `/api/v1`. Public routes include `/health`, `/auth/me`, `/articles`, `/articles/latest`, `/articles/featured`, `/articles/trending`, `/articles/:slug?lang=en|gu`, `/categories`, `/locations`, `/locations/:id/children`, and `/search?q=...`. Authenticated administrator endpoints are under `/admin`, with article, category, location, dashboard, analytics, and imported-news operations. The Analytics tab shows anonymous active browser visitors, unique visitors and page views; visitor metrics begin accumulating after this version is deployed. Public analytics stores a random browser ID and page paths without names, email addresses, or IP addresses. Set `NEWS_PROVIDER=gnews` and `NEWS_API_KEY` in `server/.env` to fetch stories into the admin review inbox; importing a result creates a draft article and never publishes automatically. Admin sessions use HttpOnly cookies stored in MongoDB. Login is rate-limited and public article queries require published status and a publication time no later than now.

## Deploy with Vercel and Render

The repository includes `render.yaml` for the API and `client/vercel.json` for the frontend. The Vercel config proxies `/api/*` through Vercel to Render, so browser requests and the session cookie stay on the frontend origin.

1. Push this repository to GitHub. Create a MongoDB Atlas database and database user. Copy the Atlas connection string for the Render `MONGODB_URI` value; replace its database name with `valsadmedia` if needed.
2. In Render, create a Blueprint from this repository and select `render.yaml`. Set `MONGODB_URI`, `CLIENT_URL` (after Vercel deploys), `NEWS_API_KEY`, and the three Cloudinary values (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) in the service environment. Render generates `SESSION_SECRET`. The API health check is `/api/v1/health`.
3. In Vercel, import the same GitHub repository as a separate project with **Root Directory** set to `client`, framework **Vite**, build command `npm run build`, and output directory `dist`. No `VITE_API_BASE_URL` is needed because `/api` is proxied by Vercel.
4. The included proxy points to `https://valsadmedia-api.onrender.com`. If Render assigns a different hostname, update the first destination in `client/vercel.json` to the exact Render service URL and redeploy Vercel.
5. Copy the Vercel production URL (for example, `https://your-project.vercel.app`) into Render's `CLIENT_URL`, then redeploy the Render service. Keep `NEWS_PROVIDER=gnews` and enter the GNews key as `NEWS_API_KEY` in Render, not Vercel.
7. Verify `/api/v1/health` on the Render URL, the Vercel home page, admin login, fetching GNews, and publishing an article. Add a custom domain to Vercel afterward and update `CLIENT_URL` in Render to that exact origin.

Render's service setup follows its [Node web service](https://render.com/docs/deploy-node-express-app) and [Blueprint](https://render.com/docs/blueprint-spec) configuration. Vercel's SPA rewrite supports direct links to routes such as `/gu/news/...` and `/admin/dashboard` ([Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)).

For local production compilation run `npm run build`. Server startup requires MongoDB to be reachable. Public article and area-news pages load published content from the API; GNews results enter the admin review inbox as drafts and must be published by an administrator. Admins can upload article images through Cloudinary; configure its cloud name, API key, and API secret on the API service only. Review the hosting provider's current free-tier limits before relying on the service for time-sensitive news, since free API instances may sleep when idle.
