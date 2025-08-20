# Use Node.js 20 LTS as base image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip prepare script to avoid early build)
RUN npm ci --ignore-scripts && npx playwright install && npx playwright install chromium

# Copy source code
COPY . .

# Build TypeScript and create directories
RUN npm run build && mkdir -p /app/data /app/logs

# Set environment variables
ENV NODE_ENV=production

# Set executable permissions
EXPOSE 3000

# Run the MCP server
CMD ["node", "dist/index.js"]
