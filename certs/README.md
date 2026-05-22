# Internal TLS for Translation API

Same Colt internal CA as Translation repo. Regenerate from Translation:

```bash
../Translation/certs/fetch-colt-ca.sh
cp ../Translation/certs/colt-internal-ca.pem ./colt-internal-ca.pem
```

Or copy `colt-internal-ca.pem` here. Used by Vite dev proxy and **prod UI Docker image** (`/etc/nginx/certs/`).
