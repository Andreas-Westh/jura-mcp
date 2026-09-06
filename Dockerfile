FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build
RUN rm -rf node_modules
RUN npm ci --omit=dev


FROM node:24-slim
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/dist/ ./dist/
EXPOSE 8080
CMD ["node", "dist/index.js"]
