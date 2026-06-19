# 📡 beamclip

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-%E2%98%95-ffdd00?style=flat-square)](https://buymeacoffee.com/captainibo)
[![Get Buffer](https://img.shields.io/badge/New%20to%20Buffer%3F-Sign%20up-2c4bff?style=flat-square)](https://buffer.com/join/bf6b3aee5bee700fe35c863ee82aad7f70eb1955367e27c92247144b95ea8af5)

A small **local** web app to publish a video to **TikTok, Instagram and YouTube** in one go.

You pick a video, beamclip uploads it to **your own storage** (Cloudflare R2, AWS S3,
Backblaze B2, MinIO — anything S3-compatible) and then creates the posts through the
**[Buffer API](https://developers.buffer.com)** with per-channel captions and hashtags.
You watch the upload progress and the per-channel sharing status live.

Everything runs on your machine. Your Buffer key and storage credentials never leave it.

```
video  ─▶  your storage (public URL)  ─▶  Buffer  ─▶  TikTok · Instagram · YouTube
            └ live upload %                  └ live status: sending → sent / error
```

## Why through Buffer?
Posting **directly** to TikTok/Instagram/YouTube would require each user to register a
developer app and pass the platforms' review processes (TikTok content-posting audit,
Meta app review, etc.). Buffer already holds those platform relationships, so going
through Buffer keeps you compliant and avoids that setup. beamclip is just a local
client for **your own** Buffer account.

## Requirements
- [Node.js](https://nodejs.org) 18 or newer
- A **Buffer** account with at least one connected channel — [no account yet? **sign up here**](https://buffer.com/join/bf6b3aee5bee700fe35c863ee82aad7f70eb1955367e27c92247144b95ea8af5)
- A Buffer **Personal API Key** — Buffer → *Settings → API → Personal Keys → New Key*
  (only organization owners can create one)
- An **S3-compatible bucket** with a public read URL — *or* you bring your own already-public video URL

## Quick start
```bash
git clone https://github.com/toutcas/beamclip.git
cd beamclip
npm install
npm start
# open http://localhost:4310
```
Then in the UI:
1. **Settings** — paste your Buffer key, choose a storage backend, fill in the fields, hit *Speicher testen*.
2. **Video** — drag in a clip (or paste a public URL in URL mode).
3. **Kanäle & Texte** — *Kanäle laden*, write a caption + hashtags per channel, choose the posting mode.
4. **Upload & posten** — watch the upload bar, then the live per-channel status.

## Storage: defining your upload location
beamclip never hard-codes where videos go — **you** define it. Two backends ship today:

### `s3` — any S3-compatible bucket
| Field | Cloudflare R2 | AWS S3 |
|---|---|---|
| Endpoint | `https://<accountid>.r2.cloudflarestorage.com` | *(leave blank)* |
| Region | `auto` | e.g. `eu-central-1` |
| Bucket | your bucket | your bucket |
| Access Key / Secret | R2 API token pair | IAM access key |
| **Public base URL** | your `…r2.dev` URL or custom domain | website/CloudFront URL |

> The S3 endpoint itself is usually **not** publicly readable, so the **public base URL**
> is what beamclip hands to Buffer to fetch the video. Make sure that URL is reachable
> without auth (e.g. enable the R2 public bucket / r2.dev, or attach a custom domain).

### `url` — bring your own
No upload at all: you paste a video URL that is already publicly reachable. Useful if you
host elsewhere.

Want another backend (GCS, FTP, plain folder + tunnel)? Add an adapter in
`server/storage/` and wire it into `server/storage/index.js`.

## Configuration & secrets
- Settings saved from the UI go into **`config.json`** (gitignored — never committed).
- You can also use environment variables (see [`.env.example`](.env.example)); they override `config.json`.
- A template lives in [`config.example.json`](config.example.json).
- The browser only ever receives booleans for secret fields (`apiKeySet: true`), never the values.

## Scheduling modes
- **Sofort posten** (`shareNow`) — publish now.
- **In die Queue** (`addToQueue`) — next free slot in your Buffer schedule.
- **Geplant** (`customScheduled`) — pick a date/time.

YouTube needs a title + category (default `20` = Gaming); Instagram is posted as a **Reel**
and shared to feed; these are filled in automatically and editable per channel.

## Notes & limits
- **Rate limits** (Buffer): Free 100 requests / 15 min, 3,000 / month. beamclip stays well under this.
- **Approval roles**: if a channel is set to *Requires Approval* in Buffer, API posts land as drafts awaiting approval — by design.
- **Live status polling** is best-effort; if your plan doesn't expose a single-post query, beamclip shows the status returned at creation and you can confirm in Buffer.
- **Content responsibility is yours.** beamclip is content-neutral; make sure you have the rights to whatever you post (e.g. third-party brands/characters).

## Tech
Node + Express, vanilla JS frontend, `@aws-sdk/client-s3` for storage, Server-Sent Events
for live progress. No build step, no framework.

## Support
If beamclip saves you time, you can [**buy me a coffee** ☕](https://buymeacoffee.com/captainibo) — it's appreciated and keeps the project going!

Don't have a Buffer account yet? [**Sign up with this link**](https://buffer.com/join/bf6b3aee5bee700fe35c863ee82aad7f70eb1955367e27c92247144b95ea8af5) to get started.

## License
MIT — see [LICENSE](LICENSE).
