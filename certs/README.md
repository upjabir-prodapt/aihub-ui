# Internal TLS for Translation API

Same Colt internal CA.

`colt-internal-ca.pem` is the two-certificate chain (Issuing CA2 V3 -> Root CA V3, no leaf) that
signs `aihub-api.aicoedev-int.colt.net` and `llm.aicoedev-int.colt.net` — see AICOE-Terraform's
`terraform/GAP-REGISTER.md` R-06 and `docs/BUILD-LOG.md` entries #31/#32 for how those certs got
onto Apigee's northbound LB. This file is public CA material (no private key), safe to commit.

The Dockerfile copies it into the runtime image; `app/deps.py` loads it into the `upstream_http`
client's SSL context *in addition to* the system trust store (see the comment there), so both
Apigee (internal CA) and any future public-CA upstream keep working from the same client.

To renew: replace this file with the new Issuing CA / Root CA chain if Colt ever rotates either
one. The leaf cert changing (renewal without a CA rotation) needs no change here.
