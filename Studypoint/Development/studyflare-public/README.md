# Studyflare

A private, AI-assisted study space that runs entirely in your own Cloudflare account. You make your own courses from your own files. Nothing is pre-loaded, and nobody else can open it.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/crazyhorse2017/studyflare)

## Set up (about 10 minutes, free Cloudflare account)

1. **Deploy.** Click the button and sign in to Cloudflare and GitHub. On the setup page, put your email in **ALLOWED_EMAILS** and leave `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` as `todo`. Click Deploy and wait for the build.
2. **Lock it.** Open your new `studyflare.<you>.workers.dev` link. Studyflare asks for a one-time Cloudflare API token. With it, Studyflare creates a Cloudflare Access sign-in so that only your email can open the app, and brands that sign-in page as Studyflare. The token isn't stored, so delete it afterwards.
3. **Sign in** with the code Cloudflare emails you. You can add a passkey after that.

To let someone else in, open Settings → People. Each person gets their own separate account.

## What runs where

Everything runs in **your** Cloudflare account: the Worker, the D1 database, and the Access sign-in. No one else, including the author, can see your data.
