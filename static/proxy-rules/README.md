# Proxy routing data

These small files are offline bootstrap snapshots. The runtime updater replaces
them with validated HTTPS data and keeps the last known good copy.

- GFWList source: https://github.com/gfwlist/gfwlist
- Upstream license: GNU LGPL v2.1
- Bundled snapshot: minimal Rainsee bootstrap subset, not a full upstream release

Mainland routing does not use a separate geographic domain or IP database.
"Bypass Mainland China" proxies GFWList matches and connects other destinations
directly. "Proxy Mainland China only" applies the inverse action.

Keep upstream attribution and license notices when refreshing bundled data.
