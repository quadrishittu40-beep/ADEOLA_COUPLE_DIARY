# Quadri and Olamide Diary

Installable shared diary with a real backend, for Vercel.

## What is inside
- `public/` the app (installable PWA: manifest, service worker, icons, photos)
- `api/` the backend (login, session cookie, diary pages)
- Data is stored in a private Vercel Blob store. Passwords are hashed with scrypt.
- Only two accounts can exist: one for Quadri, one for Olamide.
- Weeks seal on the server. A page can only be written for today or earlier, and never after its week has ended (Africa/Lagos time).

## Deploy
1. Push this folder to a GitHub repository and import it in Vercel (Framework: Other, Output Directory: `public`).
2. In the project: Storage > Create > Blob > Private, and connect it to the project. This adds `BLOB_READ_WRITE_TOKEN`.
3. In Settings > Environment Variables add `AUTH_SECRET` with a long random value (for example the output of `openssl rand -hex 32`).
4. Redeploy. Open the site, create the two accounts, then use "Add to Home Screen" (iPhone) or "Install app" (Android and desktop Chrome).

## Photos and videos
Each person can attach up to 8 photos and videos to their own page for the day (photos up to 10 MB, videos up to 50 MB).
Photos are shrunk on the phone before upload. Files are sent in 3 MB pieces because Vercel limits one request to about 4.5 MB.
They are stored in the same private Blob store as the diary pages. The free Vercel plan has 1 GB of storage in total.
