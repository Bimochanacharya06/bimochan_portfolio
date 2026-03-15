# Deploy Checklist

Use this checklist before every production deployment of the Bimochan Portfolio.

---

## 1. Pre-Deploy Build

- [ ] Run `npm install` to ensure dependencies are up-to-date
- [ ] Run `npm run lint:html` — zero errors on all `.html` files
- [ ] Run `npm run format -- --check` — all files formatted
- [ ] Run `npm run build:css` — minified CSS generated in `dist/css/`
- [ ] Run `npm run build:js` — minified JS generated in `dist/js/`
- [ ] Verify `dist/` files look correct (not empty, not garbled)

---

## 2. Lighthouse Targets (Desktop)

Run Lighthouse in Chrome DevTools or via `npx lighthouse <url> --view` on the
live URL after deploy.

| Page              | Performance | Accessibility | Best Practices | SEO  |
| ----------------- | ----------- | ------------- | -------------- | ---- |
| `/` (Home)        | ≥ 90        | ≥ 90          | ≥ 90           | ≥ 90 |
| `/project.html`   | ≥ 85        | ≥ 90          | ≥ 90           | ≥ 90 |
| `/contact.html`   | ≥ 85        | ≥ 90          | ≥ 90           | ≥ 90 |
| `/education.html` | ≥ 85        | ≥ 90          | ≥ 90           | ≥ 90 |
| `/404.html`       | ≥ 90        | ≥ 90          | ≥ 90           | N/A  |

> Run on **desktop** profile (mobile scores will vary due to network simulation).

---

## 3. Manual QA Steps

### Navigation

- [ ] All nav links lead to correct pages (Home, Projects, Education, Contact)
- [ ] Active nav link highlights correctly on scroll (Home page)
- [ ] Mobile hamburger menu opens and closes properly
- [ ] Mobile menu closes when a link is tapped
- [ ] Logo/brand links back to home

### Theme Toggle

- [ ] Dark → Light → Dark toggle works without page reload
- [ ] Theme persists after page refresh (localStorage)
- [ ] All components look correct in both themes (text contrast, borders, backgrounds)
- [ ] No flash of wrong theme on page load

### Skip Link

- [ ] Press **Tab** from the top of every page — skip-to-content link appears
- [ ] Pressing **Enter** on skip link jumps focus to main content
- [ ] Works on: index.html, contact.html, project.html, education.html

### Back to Top

- [ ] Scroll down > 400px — Back to Top button appears
- [ ] Click/Enter on button — page scrolls smoothly to top
- [ ] Button disappears after scrolling back to top
- [ ] Button is accessible via keyboard (Tab key)

### Forms (contact.html)

- [ ] Required field validation fires before submit
- [ ] Email field rejects invalid email format
- [ ] Character counter updates as you type in the message field
- [ ] Interest chips are togglable
- [ ] Form submits successfully via FormSubmit.co (check spam filter for confirmation email)
- [ ] Copy-email button copies `bimochan081b@asm.edu.np` to clipboard
- [ ] Tooltip "Copied!" appears after copying and disappears after 2s

### Scroll Animations

- [ ] Reveal animations fire when sections scroll into view
- [ ] With `prefers-reduced-motion: reduce` set in OS — animations are disabled
- [ ] Orb/background animations pause with `prefers-reduced-motion`

### Focus States

- [ ] Tab through all interactive elements on every page
- [ ] Every focused element has a visible 2px outline (light and dark themes)
- [ ] Focus ring visible on: nav links, buttons, form inputs, social links, skill pills

### Images

- [ ] Profile photo loads (WebP with JPEG fallback)
- [ ] Skill/tech logos load correctly
- [ ] No broken image icons anywhere

### 404 Page

- [ ] Navigate to `/nonexistent` — 404 page shows correctly
- [ ] All three 404 page links work (Home, Projects, Contact)

---

## 4. Accessibility Checks

- [ ] Run axe DevTools or WAVE extension on each page — zero critical errors
- [ ] Color contrast: all text passes WCAG AA (4.5:1 for normal, 3:1 for large text)
- [ ] All images have descriptive `alt` text (decorative images use `alt=""`)
- [ ] All form inputs have associated `<label>` elements
- [ ] Interactive elements are operable via keyboard alone
- [ ] Page language is set (`lang="en"` on `<html>`)

---

## 5. Security Checks

- [ ] Deploy with headers from `SECURITY_HEADERS.md` configured on your host
- [ ] Verify at https://securityheaders.com — score **A** or better
- [ ] Verify `Strict-Transport-Security` header present in response
- [ ] Verify `X-Content-Type-Options: nosniff` present
- [ ] Verify `X-Frame-Options: DENY` present
- [ ] Verify `Content-Security-Policy` present and no CSP violation errors in console
- [ ] No API keys or secrets committed to repository (`git log --all -- '*.env'`)
- [ ] FormSubmit.co endpoint not exposing personal email in source (it is obscured via their service ✓)
- [ ] `api/chat.py` `ANTHROPIC_API_KEY` loaded from environment, not hardcoded ✓

---

## 6. SEO / Meta

- [ ] Each page has unique `<title>` and `<meta name="description">`
- [ ] `sitemap.xml` includes all pages with correct URLs
- [ ] `robots.txt` present (or hosting platform allows indexing)
- [ ] Canonical URLs set correctly
- [ ] OpenGraph / Twitter card tags present on index.html

---

## 7. Performance Quick Checks

- [ ] First Contentful Paint (FCP) < 1.5s on desktop (Chrome DevTools Network: Fast 3G)
- [ ] No render-blocking resources (fonts use `display=swap`, icons preloaded)
- [ ] Hero image (`photo.webp`) served with correct `Cache-Control`
- [ ] CSS and JS files served minified from `dist/` in production
- [ ] WebP images load; JPEG fallback loads in Safari < 14 (check with browser stack if needed)

---

## 8. Post-Deploy Smoke Test

- [ ] Visit all pages in a fresh incognito window
- [ ] Hard-refresh (`Ctrl+Shift+R`) — no stale CSS/JS
- [ ] Test on mobile device (or DevTools mobile simulation: iPhone 12, Pixel 5)
- [ ] Check browser console — zero JS errors
- [ ] Submit a test contact form message and confirm receipt

---

## Revert Procedure

If a deployment causes issues:

```bash
# Netlify: roll back via dashboard
# Dashboard → Deploys → select previous deploy → "Publish deploy"

# Vercel: roll back via CLI
vercel rollback

# GitHub Pages:
git revert HEAD
git push origin main
```

All changes are on the `copilot/add-security-and-performance-upgrades` branch.
To revert to the previous state:

```bash
git checkout main
# The previous version is on the main branch before this PR was merged.
```
