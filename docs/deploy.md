# Deploying Hangul Hero to the Pi

Runs at `https://hangul.paulclay.xyz` through the Cloudflare tunnel that already serves
the other projects on this machine. Steady state: **push to `main` and it is live within
two minutes.** Nothing is pushed to the Pi; it pulls, which is why none of this needs an
inbound port.

Everything below follows the conventions already on the box (`shabani`, `mr-porker`), so
there is one pattern to remember rather than six.

## What is already there

| | |
|---|---|
| Tunnel | `c92760fe-3292-4b86-b3a0-33335ef39a93`, config at `~/.cloudflared/config.yml` |
| Ports in use | 3000, 5000, 5001, 5277, 8088, 8787, 8788, 9100, 9101, 20241 |
| Port we take | **8790** |
| Node | v24.18.0, so `node:sqlite` is available and nothing needs compiling |
| Disk | 29GB card, about 16GB free |

## 1. Deploy key

Each project has its own key and its own SSH host alias, so one compromised key does not
reach the others.

```bash
ssh pi@192.168.4.21
ssh-keygen -t ed25519 -f ~/.ssh/hangul-hero-deploy -N "" -C "hangul-hero deploy"
cat ~/.ssh/hangul-hero-deploy.pub
```

Add that public key at **github.com/paulporkhogkart/hangul-hero → Settings → Deploy keys**,
read-only. Then append to `~/.ssh/config`:

```
Host github.com-hangul
  HostName github.com
  IdentityFile ~/.ssh/hangul-hero-deploy
  IdentitiesOnly yes
```

## 2. git-lfs

Not currently installed, and the pronunciation pack is an LFS object. Without this a
checkout produces a text pointer where 68MB of audio should be, and the game loses every
clip without erroring.

```bash
sudo apt-get update && sudo apt-get install -y git-lfs
git lfs install
```

## 3. Clone

```bash
cd /home/pi
git clone git@github.com-hangul:paulporkhogkart/hangul-hero.git
cd hangul-hero
git lfs pull
npm ci --no-audit --no-fund
npm run build:next && rm -rf web/dist && mv web/dist-next web/dist
```

## 4. Environment

`.env` is gitignored, so `git reset --hard` on every deploy leaves it alone.

```bash
cat > /home/pi/hangul-hero/.env <<'EOF'
NODE_ENV=production
PORT=8790
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
EOF
chmod 600 /home/pi/hangul-hero/.env
```

**No Azure key.** Speech synthesis is a development tool; the Pi serves the pack that was
generated on the desktop and never talks to Azure.

`NODE_ENV=production` matters beyond performance: it is what closes the
`/auth/discord?debug=1` diagnostic endpoint.

## 5. systemd

```bash
cd /home/pi/hangul-hero
sudo visudo -cf deploy/sudoers.d/hangul-hero-deploy
sudo install -m 0440 -o root -g root deploy/sudoers.d/hangul-hero-deploy /etc/sudoers.d/hangul-hero-deploy
sudo install -m 0644 deploy/hangul-hero.service deploy/hangul-hero-deploy.service \
                     deploy/hangul-hero-deploy.timer deploy/hangul-hero-backup.service \
                     deploy/hangul-hero-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hangul-hero.service hangul-hero-deploy.timer hangul-hero-backup.timer
curl -s localhost:8790/api/health
```

Expect `{"ok":true,"words":6153,...}`. That endpoint reads the database, so it fails when
the process is up but useless, which is the case a health check exists for.

## 6. DNS and tunnel

`paulclay.xyz` must be an active zone in the same Cloudflare account as the tunnel.

```bash
cloudflared tunnel route dns c92760fe-3292-4b86-b3a0-33335ef39a93 hangul.paulclay.xyz
```

If that fails with a certificate error, the Pi has tunnel credentials but not the account
cert. Either run `cloudflared tunnel login` once, or add a **proxied CNAME** in the
dashboard: `hangul` → `c92760fe-3292-4b86-b3a0-33335ef39a93.cfargotunnel.com`.

Then add the ingress rule to `~/.cloudflared/config.yml`, **above the `http_status:404`
catch-all**, which must stay last:

```yaml
  - hostname: hangul.paulclay.xyz
    service: http://localhost:8790
```

```bash
cloudflared tunnel ingress validate
sudo systemctl restart cloudflared
curl -s https://hangul.paulclay.xyz/api/health
```

## 7. Discord

Add `https://hangul.paulclay.xyz/auth/discord/callback` to the app's OAuth2 redirects.
Discord matches the string exactly, and the server derives it from `x-forwarded-proto` and
`x-forwarded-host`, which cloudflared sets. If sign in ever fails, run the diagnostic
**locally** (`npm run server`, then `/auth/discord?debug=1`) and compare the string
character for character.

## Day to day

```bash
git push origin main          # live within 2 minutes

systemctl status hangul-hero
journalctl -u hangul-hero -f
journalctl -u hangul-hero-deploy -n 40      # why a deploy did or did not happen
sudo systemctl start hangul-hero-deploy     # do not wait for the timer
bash deploy/deploy.sh --force               # redeploy the same commit
```

## Notes

**A broken push cannot take the site down.** The build runs into `web/dist-next` and only
replaces `web/dist` on success, and the script confirms `/api/health` answers afterwards
rather than assuming a restart worked.

**Backups** run at 04:20 into `data/backups/`, keeping 14 days. `VACUUM INTO` snapshots the
live database without stopping the server. The database is the only thing here that cannot
be rebuilt from source: words, audio and the site all regenerate.

**Rate limiting** is 80 writes per IP per 10 minutes. That is not anti-cheat, which this
project deliberately does not attempt. It is so nobody can fill a card that five other
projects live on.

**Regenerating words or audio** happens on the desktop, never on the Pi:

```bash
npm run words:fetch && npm run words:build   # needs KRDICT_API_KEY
npm run tts:build && node tools/audio-pack.mjs   # needs AZURE_SPEECH_KEY
git commit -am "words: refresh" && git push
```
