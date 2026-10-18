#!/usr/bin/env bash
# Downloads the public-domain Natural Earth admin-1 subdivisions (v5.1.2, pre-split per country)
# packaged on npm as @geo-insight/data (MIT package, Natural Earth data is public domain).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/source && cd build/source
curl -sSL https://registry.npmjs.org/@geo-insight/data/-/data-0.3.0.tgz | tar xz
curl -sSL https://registry.npmjs.org/@cublya/world-atlas/-/world-atlas-3.0.0-beta.2.tgz | tar xz -O package/countries-50m.json > countries-50m.json
echo "Source extracted to build/source/package/dist/assets"
