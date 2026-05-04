# KJC Capital — Code Review Arena

AI-powered code review. Stark, Morra and Ishigami debate your code to 9/10.

## Deploy to Vercel (5 minutes)

### Step 1 — Push to GitHub
1. Go to github.com and create a free account if you don't have one
2. Click **New repository** → name it `kjc-arena` → Create
3. Upload ALL files from this folder into the repo (drag and drop in the GitHub UI)

### Step 2 — Deploy on Vercel
1. Go to vercel.com and sign up with your GitHub account
2. Click **Add New Project**
3. Import your `kjc-arena` repository
4. Click **Deploy** — it will build automatically

### Step 3 — Add your Anthropic API key
1. In Vercel, go to your project → **Settings** → **Environment Variables**
2. Add a new variable:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your Anthropic API key (from console.anthropic.com)
3. Click **Save**
4. Go to **Deployments** → click the 3 dots on your latest deploy → **Redeploy**

Your arena is now live at `https://kjc-arena.vercel.app` (or similar).

## Local Development

```bash
npm install
# Create .env.local with:
# ANTHROPIC_API_KEY=your_key_here
npm run dev
# Open http://localhost:3000
```

## How it works

- `pages/index.js` — the full arena UI
- `pages/api/chat.js` — proxy that forwards requests to Anthropic server-side (API key never exposed to browser)
