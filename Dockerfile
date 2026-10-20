# Build with the full toolchain, ship a slim Debian image with only the headless Chromium shell.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/nxdpro/journeyguard" \
      org.opencontainers.image.description="Open-source monitoring for checkout, sign-up and contact-form journeys" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    JOURNEYGUARD_DATA_DIR=/data \
    JOURNEYGUARD_CONFIG=/config/journeyguard.yml
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY package.json ./
# The Chromium build matching the bundled Playwright, its system libraries and fonts (Latin, Greek,
# Cyrillic, CJK, emoji) so screenshots read correctly; tini reaps Chromium's child processes.
RUN apt-get update \
 && node node_modules/playwright/cli.js install --with-deps --only-shell chromium \
 && apt-get install -y --no-install-recommends tini fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* /tmp/* \
 && chmod +x dist/src/bin.js \
 && ln -s /app/dist/src/bin.js /usr/local/bin/journeyguard \
 && mkdir -p /data /config && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/dist/src/bin.js"]
CMD ["start", "--host", "0.0.0.0"]
