# Use the official Playwright image with pre-installed browsers
FROM mcr.microsoft.com/playwright:v1.54.0-jammy

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create a non-root user for security
RUN groupadd -r scraper && useradd -r -g scraper -G audio,video scraper \
    && mkdir -p /home/scraper/Downloads \
    && chown -R scraper:scraper /home/scraper \
    && chown -R scraper:scraper /app

# Switch to non-root user
USER scraper

# Set environment variables for headless operation
ENV DISPLAY=:99
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Expose port if your scraper runs a web server
EXPOSE 3000

# Default command
CMD ["node", "index.ts"]