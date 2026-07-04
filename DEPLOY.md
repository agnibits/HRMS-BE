# Deploying HRMS to AWS Lightsail (single instance)

This guide deploys the whole stack — **API + PostgreSQL + Redis + Nginx** — on **one** Lightsail Ubuntu instance using Docker Compose. Access is over **HTTP via the instance's static IP** (add a domain + HTTPS later — see the last section).

```
Internet ──▶ Nginx (:80) ──▶ API (:4000) ──▶ Postgres + Redis   (all in Docker on one VM)
```

---

## 1. Create the Lightsail instance

1. Lightsail console → **Create instance**.
2. Platform: **Linux/Unix** → Blueprint: **OS Only → Ubuntu 22.04 LTS**. ✅ (what you selected)
3. Instance plan: **choose at least 2 GB RAM** (the $12/mo plan). 512 MB/1 GB can run out of memory during the Docker build.
4. Name it (e.g. `hrms-prod`) → **Create instance**. Wait until it shows *Running*.

## 2. Give it a static IP

Public IPs change on reboot — pin one:

1. Lightsail → **Networking** → **Create static IP** → attach it to `hrms-prod`.
2. Note this IP (e.g. `13.51.x.x`). This is your `<STATIC_IP>` everywhere below.

## 3. Open the firewall ports

Instance → **Networking** tab → under **IPv4 Firewall**, ensure these rules exist:

| Application | Protocol | Port |
|---|---|---|
| SSH | TCP | 22 |
| HTTP | TCP | 80 |

> Do **not** open 4000/5432/6379 — Nginx is the only public entry; the app, DB and Redis stay internal.

## 4. Connect via SSH

Easiest: click **Connect using SSH** (browser terminal) on the instance page. Or from your PC with the downloaded Lightsail key:

```bash
ssh -i LightsailDefaultKey.pem ubuntu@<STATIC_IP>
```

Everything below runs **on the server**.

## 5. Install Docker + Compose

```bash
sudo apt-get update && sudo apt-get upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu          # run docker without sudo
newgrp docker                           # apply the group now
docker --version && docker compose version
```

### (Recommended on 2 GB) add a 2 GB swap file — prevents build OOM

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 6. Get the code onto the server

**Option A — GitHub (recommended).** Push this project to a (private) GitHub repo from your PC, then on the server:

```bash
git clone https://github.com/<you>/hrms-backend.git
cd hrms-backend
```

**Option B — upload from your PC** (no GitHub). Run this on your **local machine**:

```bash
scp -i LightsailDefaultKey.pem -r "d:/Agnibits-HR/HR-BE" ubuntu@<STATIC_IP>:~/hrms-backend
# then on the server:  cd ~/hrms-backend
```

> Either way, make sure `node_modules`, `.env`, and `.dev/` are **not** uploaded (the `.gitignore`/`.dockerignore` already exclude them; the image is built fresh on the server).

## 7. Configure environment

```bash
cp .env.production.example .env
nano .env
```

Fill in the `CHANGE_ME` values. Generate the two JWT secrets with:

```bash
openssl rand -base64 48     # run twice → JWT_ACCESS_SECRET and JWT_REFRESH_SECRET
```

At minimum set: `APP_URL`/`FRONTEND_URL`/`CORS_ORIGINS` to `http://<STATIC_IP>`, `POSTGRES_PASSWORD`, both JWT secrets, and `SEED_ADMIN_*`. (Email SMTP can wait — password-reset/verify emails just won't send until configured.)

## 8. Deploy 🚀

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

This builds the image, starts Postgres/Redis, **runs migrations**, **seeds** the super-admin, then starts the API + worker + Nginx. First run takes a few minutes (image build).

## 9. Verify

```bash
curl http://localhost/health          # {"status":"ok",...}
```

From your browser:
- **API:** `http://<STATIC_IP>/api/v1`
- **Swagger docs:** `http://<STATIC_IP>/api/v1/docs`
- **Login:** the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` you set in `.env`

---

## Day-2 operations

**Update after code changes** (git push from PC → on server):
```bash
cd ~/hrms-backend && git pull && ./deploy/deploy.sh
```

**Logs / status / restart:**
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml down        # stop everything (data is kept in volumes)
```

**Backup the database:**
```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U hrms hrms | gzip > backup-$(date +%F).sql.gz
```

---

## Running on the $5 / 512 MB plan (client demo on a budget)

The cheapest plan **works for a demo** — with two adjustments, because 512 MB is tight:

1. **Add the 2 GB swap file** (Step 5 above) — this is **mandatory**, otherwise the Docker build runs out of memory and fails.
2. **Skip the background worker** to save ~80 MB of RAM. Emails will queue but not send (fine for a demo — login/CRUD/all APIs work normally):
   ```bash
   docker compose -f docker-compose.prod.yml stop worker
   ```

Trade-off: the image build is slower (a few extra minutes) and there's little headroom, but it's perfectly fine to **show a client**. Login, all APIs, and Swagger work.

### Upgrading later (when the client pays)

Lightsail instances **can't be resized in place**. To move to a bigger plan:

1. Instance → **Snapshots** → **Create snapshot**.
2. From the snapshot → **Create new instance** → pick 2 GB / 4 GB.
3. **Networking** → detach the static IP from the old instance, attach it to the new one.
4. Delete the old instance. Total downtime ~10 minutes; **all data is preserved** in the snapshot.

Then start the worker again: `docker compose -f docker-compose.prod.yml up -d`.

---

## Later: add a domain + HTTPS

1. Point your domain's **A record** to `<STATIC_IP>`.
2. Set `APP_URL`/`FRONTEND_URL`/`CORS_ORIGINS` in `.env` to `https://yourdomain.com`.
3. Add a `443 ssl` server block to `deploy/nginx.conf` and obtain a free cert. Simplest path: run **Certbot** in a companion container (or on the host) against `yourdomain.com`, mount the certs into the Nginx container, and redirect `80 → 443`. Ping me and I'll wire the TLS config + auto-renewal for your exact domain.

---

## Notes & alternatives

- **Managed database:** for automatic backups/failover you can later move Postgres to a **Lightsail Managed Database** and point `DATABASE_URL` at it (drop the `postgres` service from compose). Redis stays on the instance (Lightsail has no managed Redis).
- **Memory:** the API + worker + Postgres + Redis + Nginx fit comfortably in 2 GB with the swap file. Scale the instance up anytime from the console.
- **Security:** keep `.env` private, use strong `POSTGRES_PASSWORD`/JWT secrets, and consider setting `ENABLE_SWAGGER=false` once you go live.
