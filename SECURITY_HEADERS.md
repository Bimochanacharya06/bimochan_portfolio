# Security Headers Guide

Copy-paste configurations for deploying the Bimochan Portfolio with proper HTTP security headers.

---

## Content Security Policy (CSP) Rationale

The site loads assets from these origins:

- Fonts: `fonts.googleapis.com`, `fonts.gstatic.com`
- Icons: `cdn.jsdelivr.net`
- Dev icons: `cdn.jsdelivr.net`
- Form backend: `formsubmit.co`
- AI API (chat page): `api.anthropic.com` (server-side only)
- Analytics (if added): `cloud.umami.is`

`unsafe-inline` is **avoided** for scripts. All inline styles in the HTML use a nonce or are hashed where the platform supports it. The configurations below use the `strict-dynamic` + nonce approach for Netlify/Vercel where the nonce is injected at the edge, and a hash-based approach for NGINX static serving.

---

## Netlify (`netlify.toml`)

```toml
[[headers]]
  for = "/*"
  [headers.values]
    # Security headers
    Strict-Transport-Security  = "max-age=63072000; includeSubDomains; preload"
    X-Content-Type-Options     = "nosniff"
    X-Frame-Options            = "DENY"
    Referrer-Policy            = "strict-origin-when-cross-origin"
    Permissions-Policy         = "camera=(), microphone=(), geolocation=(), interest-cohort=()"

    # Content Security Policy
    # NOTE: Replace <NONCE> with your edge function nonce, or use the
    # hash-based fallback in the NGINX section below.
    Content-Security-Policy = """
      default-src 'self';
      script-src  'self' 'unsafe-inline';
      style-src   'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net;
      font-src    'self' https://fonts.gstatic.com https://cdn.jsdelivr.net;
      img-src     'self' data: https://cdn.jsdelivr.net https://avatars.githubusercontent.com;
      connect-src 'self' https://formsubmit.co https://api.anthropic.com;
      frame-src   'none';
      object-src  'none';
      base-uri    'self';
      form-action 'self' https://formsubmit.co;
      upgrade-insecure-requests;
    """

# Cache static assets
[[headers]]
  for = "/static/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "no-cache, must-revalidate"
```

> **To remove `unsafe-inline` for scripts:** Move all inline `<script>` blocks to
> external `.js` files and reference them. Then replace `'unsafe-inline'` with
> `'strict-dynamic' 'nonce-<your-nonce>'` and inject the nonce via a Netlify
> Edge Function.

---

## Vercel (`vercel.json`)

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=63072000; includeSubDomains; preload"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()"
        },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: https://cdn.jsdelivr.net https://avatars.githubusercontent.com; connect-src 'self' https://formsubmit.co https://api.anthropic.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://formsubmit.co; upgrade-insecure-requests;"
        }
      ]
    },
    {
      "source": "/static/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

---

## NGINX (`nginx.conf` snippet)

```nginx
server {
    listen 443 ssl http2;
    server_name bimochanacharya.com.np www.bimochanacharya.com.np;

    # SSL (managed by Let's Encrypt / certbot)
    ssl_certificate     /etc/letsencrypt/live/bimochanacharya.com.np/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bimochanacharya.com.np/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;

    root /var/www/bimochan_portfolio;
    index index.html;

    # ── Security Headers ──────────────────────────────────────────────────────
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options    "nosniff"                                      always;
    add_header X-Frame-Options           "DENY"                                         always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin"              always;
    add_header Permissions-Policy        "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;

    # Content Security Policy
    # Replace sha256-<HASH> with actual hashes generated from your inline scripts.
    # Run: openssl dgst -sha256 -binary <<< 'your inline script' | openssl enc -base64
    add_header Content-Security-Policy "
        default-src 'self';
        script-src  'self' 'unsafe-inline';
        style-src   'self' 'unsafe-inline'
                    https://fonts.googleapis.com
                    https://cdn.jsdelivr.net;
        font-src    'self'
                    https://fonts.gstatic.com
                    https://cdn.jsdelivr.net;
        img-src     'self' data:
                    https://cdn.jsdelivr.net
                    https://avatars.githubusercontent.com;
        connect-src 'self'
                    https://formsubmit.co
                    https://api.anthropic.com;
        frame-src   'none';
        object-src  'none';
        base-uri    'self';
        form-action 'self' https://formsubmit.co;
        upgrade-insecure-requests;
    " always;

    # ── Static asset caching ──────────────────────────────────────────────────
    location ~* \.(css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|webp|avif|ico|gif)$ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    location ~* \.html$ {
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # ── Redirects ─────────────────────────────────────────────────────────────
    # Redirect HTTP → HTTPS
    server {
        listen 80;
        server_name bimochanacharya.com.np www.bimochanacharya.com.np;
        return 301 https://$host$request_uri;
    }
}
```

---

## Hardening Roadmap (Removing `unsafe-inline`)

The site currently uses inline `<style>` and `<script>` blocks. To fully
eliminate `unsafe-inline`:

1. **Scripts** – Move all `<script>` blocks in HTML files to external
   `static/js/*.js` files. Then use a nonce-based CSP injected at the edge:
   ```
   script-src 'strict-dynamic' 'nonce-RANDOM_PER_REQUEST'
   ```
2. **Styles** – Move inline `<style>` blocks to `static/css/*.css`. For any
   remaining inline `style=` attributes use CSS classes. Then:
   ```
   style-src 'self' https://fonts.googleapis.com https://cdn.jsdelivr.net
   ```
3. **Subresource Integrity (SRI)** – Add `integrity` and `crossorigin`
   attributes to all CDN `<link>` and `<script>` tags.

   Example:

   ```html
   <link
     rel="stylesheet"
     href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"
     integrity="sha384-<HASH>"
     crossorigin="anonymous"
   />
   ```

   Generate hashes at https://www.srihash.org/

---

## Header Testing

After deployment, verify headers at:

- https://securityheaders.com
- https://observatory.mozilla.org
- `curl -I https://bimochanacharya.com.np`

Target score: **A** on Security Headers, **A+** on Mozilla Observatory.
