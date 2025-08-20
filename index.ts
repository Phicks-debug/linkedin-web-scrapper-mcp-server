#!/usr/bin/env node

/**
 * LinkedIn Web Scraper MCP Server
 * 
 * This server provides tools for scraping LinkedIn profiles and candidate job seeker using Playwright.
 * It exposes LinkedIn web scraping functionality as MCP tools for LLM access.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';
import { Browser, chromium, Page } from 'playwright';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LinkedInProfileLink {
  name: string;
  profileUrl: string;
  headline?: string;
}

interface SearchFilters {
  keywords?: string;
  location?: string; // geoUrn - Uses LinkedIn's internal location codes, example: Spain = 105646813
  network?: string; // F = 1st degree, S = 2nd degree, O = 3rd+ degree
}

interface Config {
  linkedin: {
    email: string;
    password: string;
  };
  browser: {
    headless: boolean;
    slowMo: number;
    cookiesPath: string;
  };
}

class LinkedInPeopleSearchScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly config: Config;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    const configPath = path.join(__dirname, '..', 'config.json');
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData) as Config;

      if (config.linkedin.email === 'your-email@example.com') {
        throw new Error('Please update config.json with your LinkedIn credentials');
      }

      return config;
    } catch (error) {
      throw new Error(`Error loading configuration: ${error}. Please make sure config.json exists and is properly formatted`);
    }
  }

  private async saveCookies(): Promise<void> {
    if (!this.page) return;

    try {
      const cookies = await this.page.context().cookies();
      fs.writeFileSync(this.config.browser.cookiesPath, JSON.stringify(cookies, null, 2));
      console.error('💾 Session cookies saved');
    } catch (error) {
      console.error('❌ Error saving cookies:', error);
    }
  }

  private async loadCookies(): Promise<void> {
    if (!this.page) return;

    try {
      if (fs.existsSync(this.config.browser.cookiesPath)) {
        const cookiesData = fs.readFileSync(this.config.browser.cookiesPath, 'utf8');
        const cookies = JSON.parse(cookiesData);
        await this.page.context().addCookies(cookies);
        console.error('🍪 Session cookies loaded');
      }
    } catch (error) {
      console.error('❌ Error loading cookies:', error);
    }
  }

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.browser.headless,
      slowMo: this.config.browser.slowMo
    });

    this.page = await this.browser.newPage();

    // Set user agent to avoid detection
    await this.page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    // Load saved cookies if they exist
    await this.loadCookies();
  }

  private async loginToLinkedIn(): Promise<boolean> {
    if (!this.page) return false;

    try {
      console.error('🔐 Attempting to log in to LinkedIn...');

      // Navigate to LinkedIn login page with increased timeout and more reliable wait condition
      await this.page.goto('https://www.linkedin.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await this.page.waitForTimeout(3000);

      // Check if already logged in
      const currentUrl = this.page.url();
      if (currentUrl.includes('/feed/') || currentUrl.includes('/in/')) {
        console.error('✅ Already logged in');
        return true;
      }

      // Wait for login form elements to be available and fill in credentials
      console.error('⏳ Waiting for login form elements...');
      const emailInput = this.page.locator('input[name="session_key"]');
      const passwordInput = this.page.locator('input[name="session_password"]');
      const loginButton = this.page.locator('button[type="submit"]');

      // Wait for form elements to be visible
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      await passwordInput.waitFor({ state: 'visible', timeout: 10000 });

      console.error('📝 Filling in credentials...');
      await emailInput.fill(this.config.linkedin.email);
      await passwordInput.fill(this.config.linkedin.password);

      console.error('🚀 Submitting login form...');
      await loginButton.click();

      // Wait for login to complete
      await this.page.waitForTimeout(5000);

      // Check for successful login
      const afterLoginUrl = this.page.url();

      // Check for challenge page (email verification, etc.)
      if (afterLoginUrl.includes('/challenge/')) {
        throw new Error('LinkedIn security challenge detected. Please complete the challenge manually and try again.');
      }

      if (afterLoginUrl.includes('/feed/') || afterLoginUrl.includes('/in/')) {
        console.error('✅ Login successful');
        await this.saveCookies();
        return true;
      } else {
        console.error('❌ Login failed. Please check your credentials.');
        return false;
      }

    } catch (error) {
      console.error('❌ Error during login:', error);
      return false;
    }
  }

  async searchPeople(filters: SearchFilters): Promise<LinkedInProfileLink[]> {
    if (!this.page) {
      throw new Error('Browser not initialized. Call init() first.');
    }

    try {
      console.error(`🔍 Searching for people with filters:`, filters);

      // Build search URL with filters
      const searchUrl = this.buildSearchUrl(filters);
      console.error(`🌐 Navigating to: ${searchUrl}`);

      await this.page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await this.page.waitForTimeout(5000);

      // Check if we need to log in
      const loginRequired = await this.page.locator('input[name="session_key"]').isVisible();
      if (loginRequired) {
        console.error('🔑 Login required, attempting automatic login...');

        const loginSuccess = await this.loginToLinkedIn();
        if (!loginSuccess) {
          throw new Error('Failed to log in to LinkedIn');
        }

        // Navigate to search again after login
        console.error('🔄 Redirecting to search after login...');
        await this.page.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        await this.page.waitForTimeout(5000);
      }

      // Extract profile links from search results
      const profiles = await this.extractProfileLinks();

      return profiles;

    } catch (error) {
      console.error('❌ Error during people search:', error);
      throw error;
    }
  }

  private async extractProfileLinks(): Promise<LinkedInProfileLink[]> {
    if (!this.page) return [];

    try {
      console.error('🔍 Looking for search results on the page...');

      // Wait for search results to load with multiple possible selectors
      const searchSelectors = [
        '.search-results-container',
        '.search-results__list',
        '.reusable-search__result-container',
        '[data-chameleon-result-urn]'
      ];

      let foundResults = false;
      for (const selector of searchSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 15000 });
          console.error(`✅ Found search results using selector: ${selector}`);
          foundResults = true;
          break;
        } catch (e) {
          console.error(`⏳ Selector "${selector}" not found, trying next...`);
          console.error(e)
        }
      }

      if (!foundResults) {
        console.error('⚠️  No search results container found. Let me check what\'s on the page...');
        const pageTitle = await this.page.title();
        const currentUrl = this.page.url();
        console.error(`📄 Current page title: ${pageTitle}`);
        console.error(`🌐 Current URL: ${currentUrl}`);
      }

      const profileElements = await this.getProfileElements();
      if (profileElements.length === 0) {
        console.error('⚠️  No profile elements found. The page structure might have changed.');
        return [];
      }

      console.error(`🎯 Processing ${profileElements.length} profile results...`);
      const profiles: LinkedInProfileLink[] = [];
      for (let i = 0; i < profileElements.length; i++) {
        console.error(`   Processing profile ${i + 1}/${profileElements.length}...`);
        const profile = await this.extractSingleProfile(profileElements[i], i);
        if (profile) {
          profiles.push(profile);
          console.error(`   ✅ Successfully extracted: ${profile.name}`);
        } else {
          console.error(`   ❌ Failed to extract profile ${i + 1}`);
        }
      }

      return profiles;
    } catch (error) {
      console.error('❌ Error extracting profile links:', error);
      return [];
    }
  }

  private async getProfileElements(): Promise<any[]> {
    if (!this.page) return [];

    const profileSelectors = [
      '.reusable-search__result-container',
      '.search-result',
      '.entity-result',
      '[data-chameleon-result-urn]'
    ];

    for (const selector of profileSelectors) {
      const elements = await this.page.$$(selector);
      if (elements && elements.length > 0) {
        console.error(`📋 Found ${elements.length} profiles using selector: ${selector}`);
        return elements;
      }
    }

    return [];
  }

  private async extractSingleProfile(profileElement: any, index: number): Promise<LinkedInProfileLink | null> {
    try {
      const profileUrl = await this.extractProfileUrl(profileElement);
      if (!profileUrl) {
        console.error(`⚠️  No profile URL found for result ${index + 1}`);
        return null;
      }

      const name = await this.extractProfileName(profileElement, index);
      const headline = await this.extractProfileHeadline(profileElement);

      return {
        name,
        profileUrl,
        headline: headline || undefined
      };
    } catch (error) {
      console.error(`⚠️  Error extracting data from profile ${index + 1}:`, error);
      return null;
    }
  }

  private async extractProfileUrl(profileElement: any): Promise<string | null> {
    const linkSelectors = [
      'a[href*="/in/"]',
      '.app-aware-link[href*="/in/"]',
      '.search-result__result-link',
      '[data-control-name="search_srp_result"]'
    ];

    for (const linkSelector of linkSelectors) {
      const profileLink = await profileElement.$(linkSelector);
      const href = await profileLink?.getAttribute('href');
      if (href?.includes('/in/')) {
        return this.cleanProfileUrl(href);
      }
    }

    return null;
  }

  private cleanProfileUrl(url: string): string {
    // Remove tracking parameters
    let cleanUrl = url.split('?')[0];

    // Ensure it's a full URL
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://www.linkedin.com' + cleanUrl;
    }

    return cleanUrl;
  }

  private async extractProfileName(profileElement: any, index: number): Promise<string> {
    const nameSelectors = [
      '.entity-result__title-text a span[aria-hidden="true"]',
      '.search-result__result-link span[aria-hidden="true"]',
      '.actor-name',
      '.search-result__result-link'
    ];

    for (const nameSelector of nameSelectors) {
      const nameElement = await profileElement.$(nameSelector);
      if (nameElement) {
        const name = await nameElement.textContent() || '';
        if (name.trim()) {
          return name.trim();
        }
      }
    }

    return `Profile ${index + 1}`;
  }

  private async extractProfileHeadline(profileElement: any): Promise<string | null> {
    const headlineSelectors = [
      '.entity-result__primary-subtitle',
      '.search-result__snippets',
      '.subline-level-1'
    ];

    for (const headlineSelector of headlineSelectors) {
      const headlineElement = await profileElement.$(headlineSelector);
      if (headlineElement) {
        const headline = await headlineElement.textContent() || '';
        if (headline.trim()) {
          return headline.trim();
        }
      }
    }

    return null;
  }

  private buildSearchUrl(filters: SearchFilters): string {
    const baseUrl = 'https://www.linkedin.com/search/results/people/';
    const params = new URLSearchParams();

    this.addKeywordsToParams(params, filters);
    this.addLocationToParams(params, filters);
    this.addNetworkToParams(params, filters);

    return `${baseUrl}?${params.toString()}`;
  }

  private addKeywordsToParams(params: URLSearchParams, filters: SearchFilters): void {
    if (filters.keywords) {
      params.append('keywords', filters.keywords);
    }
  }

  private addLocationToParams(params: URLSearchParams, filters: SearchFilters): void {
    // Use default geoUrn if no location is provided
    const location = filters.location || '104195383';

    // Use geoUrn directly if the location is a number (LinkedIn's internal location code)
    // Otherwise treat it as a location string
    if (/^\d+$/.test(location)) {
      // It's a geoUrn (numeric location code)
      params.append('origin', 'FACETED_SEARCH');
      params.append('geoUrn', `["${location}"]`);
    } else {
      // It's a location string, add to keywords for simpler search
      const existingKeywords = params.get('keywords');
      const locationKeywords = existingKeywords
        ? `${existingKeywords} ${location}`
        : location;
      params.set('keywords', locationKeywords);
    }
  }

  private addNetworkToParams(params: URLSearchParams, filters: SearchFilters): void {
    if (filters.network) {
      const network = filters.network.toUpperCase();

      // Map network codes to LinkedIn's network filter values
      let networkValue: string | null = null;

      switch (network) {
        case 'F':
          networkValue = 'F'; // First-degree connections
          break;
        case 'S':
          networkValue = 'S'; // Second-degree connections
          break;
        case 'O':
          networkValue = 'O'; // Third+ degree connections (Out of network)
          break;
        default:
          console.error(`⚠️  Invalid network filter: ${filters.network}. Valid options: F (1st degree), S (2nd degree), O (3rd+ degree)`);
          return;
      }

      if (networkValue) {
        params.append('origin', 'FACETED_SEARCH');
        params.append('network', `["${networkValue}"]`);
      }
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

/**
 * Create an MCP server with capabilities for LinkedIn web scraping tools
 */
const server = new Server(
  {
    name: "linkedin-web-scrapper-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Global scraper instance
let scraper: LinkedInPeopleSearchScraper | null = null;

/**
 * Initialize the scraper if not already initialized
 */
async function initializeScraper(): Promise<LinkedInPeopleSearchScraper> {
  if (!scraper) {
    scraper = new LinkedInPeopleSearchScraper();
    await scraper.init();
  }
  return scraper;
}

/**
 * Handler that lists available LinkedIn web scraping tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search-linkedin-people",
        description: "Search for LinkedIn profiles using web scraping. Returns profile names, URLs, and headlines.",
        inputSchema: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description: "Keywords to search for in profiles (e.g., 'AI engineer', 'data scientist')"
            },
            location: {
              type: "string",
              description: "Location filter - can be a location string (e.g., 'San Francisco') or LinkedIn geoUrn code (e.g., '105646813' for Spain). Default: '104195383'"
            },
            network: {
              type: "string",
              description: "Network degree filter: 'F' = 1st degree connections, 'S' = 2nd degree connections, 'O' = 3rd+ degree connections",
              enum: ["F", "S", "O"]
            }
          }
        }
      }
    ]
  };
});

/**
 * Handler for LinkedIn web scraping tools.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name == "search-linkedin-people") {
      const args = request.params.arguments || {};
      const filters: SearchFilters = {
        keywords: args.keywords as string,
        location: args.location as string,
        network: args.network as string
      };

      console.error('🚀 Starting LinkedIn People Search...');
      console.error('📝 Search Filters:', JSON.stringify(filters, null, 2));

      try {
        const scraperInstance = await initializeScraper();
        const profiles = await scraperInstance.searchPeople(filters);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              count: profiles.length,
              profiles: profiles,
              filters: filters
            }, null, 2)
          }]
        };
      } catch (error: any) {
        console.error('❌ LinkedIn search error:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `LinkedIn search failed: ${error.message}`
        );
      }
    }
    else {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${error}`
    );
  }
});

/**
 * Cleanup function to close browser when server shuts down
 */
process.on('SIGINT', async () => {
  console.error('🛑 Shutting down LinkedIn Web Scraper MCP Server...');
  if (scraper) {
    await scraper.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('🛑 Shutting down LinkedIn Web Scraper MCP Server...');
  if (scraper) {
    await scraper.close();
  }
  process.exit(0);
});

/**
 * Start the server using stdio transport.
 */
async function main() {
  // Check if we're in test mode (Docker environment variables set)
  const testKeywords = process.env.TEST_KEYWORDS;
  const testLocation = process.env.TEST_LOCATION;
  const testNetwork = process.env.TEST_NETWORK;

  if (testKeywords) {
    console.error("🧪 Running in test mode...");
    console.error(`Testing search for: ${testKeywords}`);

    try {
      const scraperInstance = await initializeScraper();
      const filters: SearchFilters = {
        keywords: testKeywords,
        location: testLocation,
        network: testNetwork
      };

      const profiles = await scraperInstance.searchPeople(filters);
      console.error("✅ Test search completed successfully!");
      console.error(`Found ${profiles.length} profiles:`);
      profiles.forEach((profile, index) => {
        console.error(`${index + 1}. ${profile.name} - ${profile.profileUrl}`);
        if (profile.headline) {
          console.error(`   ${profile.headline}`);
        }
      });

      await scraperInstance.close();
      console.error("🏁 Test completed, keeping container alive...");

      // Keep container alive for log inspection
      setInterval(() => {
        console.error("📡 MCP Server ready for connections...");
      }, 30000);

    } catch (error) {
      console.error("❌ Test search failed:", error);
      process.exit(1);
    }
  } else {
    // Normal MCP server mode
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 LinkedIn Web Scraper MCP Server started");
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
