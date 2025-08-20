# Use Node.js 20 LTS as base image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip prepare script to avoid early build)
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build TypeScript and create directories
RUN npm run build && mkdir -p /app/data /app/logs

# Install Playwright browsers
RUN npx playwright install chromium

# Set environment variables
ENV NODE_ENV=production

# Set executable permissions
RUN chmod +x dist/index.js

# Expose port for MCP communication
EXPOSE 3000

# Run the MCP server
CMD ["node", "dist/index.js"]
