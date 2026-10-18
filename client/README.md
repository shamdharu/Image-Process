# Imagery client

React and Vite frontend for the Imagery Workspace.

## Deploy to Vercel

Import the repository into Vercel and set the project **Root Directory** to
`client`. Vercel uses the settings in `vercel.json`:

- Build command: `npm run build`
- Output directory: `dist`
- Framework: Vite

Set `VITE_API_URL` in the Vercel project's environment variables to the
HTTPS base URL of the separately hosted API (for example,
`https://api.example.com`, with no trailing slash). Apply it to Production and
any Preview environments that need to access the API. Vite embeds this value
at build time, so redeploy after changing it.

The API must allow the deployed Vercel origin through its `CORS_ORIGIN`
environment variable and run with `NODE_ENV=production` so cross-site session
cookies use secure settings. The client cannot provide database or file-storage
services; those remain part of the API deployment.

## Local development

Install the client dependencies and start Vite:

```sh
npm install
npm run dev
```

Set `VITE_API_URL` in a local `.env.local` file to the API URL when it is not
running at `http://localhost:4000`.

Run a production build locally with:

```sh
npm run build
```
