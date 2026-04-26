# Product positioning

VerificationStation is designed primarily as a **B2B HTTP API** (integrator-facing): stable JSON contracts, optional **multi-tenant API keys** (`TENANT_KEYS_JSON`), per-tenant **usage in metrics**, and clear documentation of **what the service proves** (syntax, DNS/MX, optional SMTP `RCPT TO` at probe time) versus what it does **not** (inbox placement, marketing engagement, lead quality—see [README – limitations](../README.md#2-what-this-service-does-not-do) and [API integrator guide](API.md#integrator-decision-guide)).

**Self-hosted single-tenant** is a first-class mode: one bearer token in `STATION_SECRET` / `API_KEY`, the implicit tenant id `default`, and default global rate limits. No multi-tenant config is required.

**Scaling past one process** (multiple nodes, or queue-based workers) is described in [SCALING.md](SCALING.md): shared state for rate limits and provider cooldown, optional async delivery.

For commercial SaaS, combine per-tenant keys and quotas with your own **billing and abuse** at the API gateway; this service focuses on **verification accuracy and operability** on the data path.
