> [!NOTE]
> Studyflare is in early development. Sign-in, schools and courses work today. Uploads, the study assistant and flashcards are on the way.

<p align="center">
  <img src="public/brand/logo.svg" alt="Studyflare logo" width="96" height="96">
</p>

<h1 align="center">Studyflare</h1>

<p align="center"><strong>Study on Cloudflare. Keep it to yourself.</strong></p>

<p align="center">
  A private, AI-assisted study space that runs entirely in your own Cloudflare account. It starts blank, and you build every course from your own material.
</p>

<p align="center">
  <a href="#set-up">Set up</a> ·
  <a href="#what-runs-where">What runs where</a> ·
  <a href="#adding-people">Adding people</a>
</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/crazyhorse2017/studyflare"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

<p align="center">
  <img alt="Cloudflare Workers + D1" src="https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-f38020?logo=cloudflare&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white">
  <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind-4-06b6d4?logo=tailwindcss&logoColor=white">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white">
  <img alt="SQLite 3" src="https://img.shields.io/badge/SQLite-3-003b57?logo=sqlite&logoColor=white">
  <img alt="Wrangler 4" src="https://img.shields.io/badge/Wrangler-4-f38020?logo=cloudflare&logoColor=white">
  <img alt="Cloudflare Access" src="https://img.shields.io/badge/Cloudflare-Access-f38020?logo=cloudflare&logoColor=white">
  <img alt="jose" src="https://img.shields.io/badge/jose-JWT-000000?logo=jsonwebtokens&logoColor=white">
  <img alt="Python 3.12" src="https://img.shields.io/badge/Python-3.12-3776ab?logo=python&logoColor=white">
  <img alt="uv" src="https://img.shields.io/badge/uv-Astral-261230?logo=uv&logoColor=white">
  <img alt="Cost: $0/mo" src="https://img.shields.io/badge/cost-%240%2Fmo-1f3b66">
</p>

---

## Set up

About 10 minutes, with a free Cloudflare account and a free GitHub account.

1. **Deploy.** Click **Deploy to Cloudflare** and sign in to Cloudflare and GitHub. On the setup page, put your email in **`ALLOWED_EMAILS`**. Leave `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` as `todo`. Click Deploy and wait for the build to finish.
2. **Lock it.** Open your new `studyflare.<you>.workers.dev` link. Studyflare asks for a one-time Cloudflare API token, then:
   - creates a Cloudflare Access sign-in so only your email can open it;
   - brands that sign-in page as Studyflare.

   The token isn't stored, so delete it once setup finishes.
3. **Sign in** with the code Cloudflare emails you. You can add a passkey after that.

## What runs where

Everything runs in **your** Cloudflare account: the Worker, the D1 database and the Access sign-in. Nobody else, including the author, can see your courses or files.

## Adding people

Open **Settings → People** to let someone else in. Each person gets a separate, empty account and never sees yours. Every change asks for a Cloudflare token, which is used once and then discarded.
