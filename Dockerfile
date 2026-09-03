FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

# Install system dependencies
ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=7860
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install npm dependencies
RUN npm install --omit=dev

# Copy project files
COPY server.js ./
COPY config.json ./
COPY eng.traineddata ./
COPY src/ ./src/
COPY public/ ./public/

# Create working directories
RUN mkdir -p session results exports logs data && chmod -R 777 /app

# Expose Hugging Face default port 7860
EXPOSE 7860

# Start server
CMD ["node", "server.js"]
