FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY public ./public
COPY server.mjs token.mjs rooms.mjs ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3080
EXPOSE 3080
CMD ["node", "server.mjs"]
