# Security policy

SafeLink is software people may rely on in an emergency, so please report problems privately and give us a chance to fix them.

For what the app protects, what it deliberately does not, and the known limits, read [docs/SECURITY.md](docs/SECURITY.md) first: it may already answer your question.

## Supported versions

This project is pre-release. Only the latest commit on `main` is supported.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting: the **Report a vulnerability** button on this repository's [Security tab](https://github.com/gasthecreator/safelink-sentinel/security/advisories/new).

If that button is not available to you, open an issue titled "Security contact request" **without any details**, and the maintainer will arrange a private channel.

Please include the affected commit, the impact, steps to reproduce or a proof of concept, and a suggested fix if you have one.

## What to expect

This is maintained by one person, so the promises are modest and kept:

- Acknowledgement within **7 days**.
- A first assessment and severity within **14 days**, with updates after that.
- A fix, or a clear explanation of why not, within **90 days**; then a published advisory crediting you if you wish.

## Scope

In scope: this repository's code (the phone app, the server, the dashboard), the release workflow, the map-catalog signing scripts, and the deployment configuration in this repository.

Out of scope: third-party services (Google, Render, Firebase, OpenStreetMap), social engineering, volumetric denial of service, and anything that needs physical access to an unlocked phone.

## Safe harbor

Good-faith research that follows this policy, avoids other people's data and does not disrupt a live deployment will not be pursued legally by the maintainer.
