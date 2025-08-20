import * as fs from 'fs';
import * as path from 'path';
import { Browser, chromium, Page } from 'playwright';

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
        console.log('⚠️  Please update config.json with your LinkedIn credentials');
        process.exit(1);
      }

      return config;
    } catch (error) {
      console.error('❌ Error loading configuration:', error);
      console.log('Please make sure config.json exists and is properly formatted');
      process.exit(1);
    }
  }

  private async saveCookies(): Promise<void> {
    if (!this.page) return;

    try {
      const cookies = await this.page.context().cookies();
      fs.writeFileSync(this.config.browser.cookiesPath, JSON.stringify(cookies, null, 2));
      console.log('💾 Session cookies saved');
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
        console.log('🍪 Session cookies loaded');
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
      console.log('🔐 Attempting to log in to LinkedIn...');

      // Navigate to LinkedIn login page with increased timeout and more reliable wait condition
      await this.page.goto('https://www.linkedin.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await this.page.waitForTimeout(3000);

      // Check if already logged in
      const currentUrl = this.page.url();
      if (currentUrl.includes('/feed/') || currentUrl.includes('/in/')) {
        console.log('✅ Already logged in');
        return true;
      }

      // Wait for login form elements to be available and fill in credentials
      console.log('⏳ Waiting for login form elements...');
      const emailInput = this.page.locator('input[name="session_key"]');
      const passwordInput = this.page.locator('input[name="session_password"]');
      const loginButton = this.page.locator('button[type="submit"]');

      // Wait for form elements to be visible
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
      await passwordInput.waitFor({ state: 'visible', timeout: 10000 });

      console.log('📝 Filling in credentials...');
      await emailInput.fill(this.config.linkedin.email);
      await passwordInput.fill(this.config.linkedin.password);

      console.log('🚀 Submitting login form...');
      await loginButton.click();

      // Wait for login to complete
      await this.page.waitForTimeout(5000);

      // Check for successful login
      const afterLoginUrl = this.page.url();

      // Check for challenge page (email verification, etc.)
      if (afterLoginUrl.includes('/challenge/')) {
        console.log('⚠️  LinkedIn security challenge detected.');
        console.log('Please complete the challenge manually in the browser window.');
        console.log('After completing the challenge, press Enter to continue...');

        // Wait for user input
        await new Promise(resolve => {
          process.stdin.once('data', () => resolve(void 0));
        });

        // Wait a bit more and check the URL again
        await this.page.waitForTimeout(3000);
        const finalUrl = this.page.url();

        if (finalUrl.includes('/feed/') || finalUrl.includes('/in/') || !finalUrl.includes('/challenge/')) {
          console.log('✅ Login successful after challenge');
          await this.saveCookies();
          return true;
        } else {
          console.log('❌ Login failed after challenge');
          return false;
        }
      }

      if (afterLoginUrl.includes('/feed/') || afterLoginUrl.includes('/in/')) {
        console.log('✅ Login successful');
        await this.saveCookies();
        return true;
      } else {
        console.log('❌ Login failed. Please check your credentials.');
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
      console.log(`🔍 Searching for people with filters:`, filters);

      // Build search URL with filters
      const searchUrl = this.buildSearchUrl(filters);
      console.log(`🌐 Navigating to: ${searchUrl}`);

      await this.page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await this.page.waitForTimeout(5000);

      // Check if we need to log in
      const loginRequired = await this.page.locator('input[name="session_key"]').isVisible();
      if (loginRequired) {
        console.log('🔑 Login required, attempting automatic login...');

        const loginSuccess = await this.loginToLinkedIn();
        if (!loginSuccess) {
          throw new Error('Failed to log in to LinkedIn');
        }

        // Navigate to search again after login
        console.log('🔄 Redirecting to search after login...');
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
      console.log('🔍 Looking for search results on the page...');

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
          console.log(`✅ Found search results using selector: ${selector}`);
          foundResults = true;
          break;
        } catch (e) {
          console.log(`⏳ Selector "${selector}" not found, trying next...`);
          console.log(e)
        }
      }

      if (!foundResults) {
        console.log('⚠️  No search results container found. Let me check what\'s on the page...');
        const pageTitle = await this.page.title();
        const currentUrl = this.page.url();
        console.log(`📄 Current page title: ${pageTitle}`);
        console.log(`🌐 Current URL: ${currentUrl}`);

        // Take a screenshot for debugging
        await this.page.screenshot({ path: 'debug-no-results.png' });
        console.log('📸 Screenshot saved as debug-no-results.png');
      }

      const profileElements = await this.getProfileElements();
      if (profileElements.length === 0) {
        console.log('⚠️  No profile elements found. The page structure might have changed.');
        return [];
      }

      console.log(`🎯 Processing ${profileElements.length} profile results...`);
      const profiles: LinkedInProfileLink[] = [];
      for (let i = 0; i < profileElements.length; i++) {
        console.log(`   Processing profile ${i + 1}/${profileElements.length}...`);
        const profile = await this.extractSingleProfile(profileElements[i], i);
        if (profile) {
          profiles.push(profile);
          console.log(`   ✅ Successfully extracted: ${profile.name}`);
        } else {
          console.log(`   ❌ Failed to extract profile ${i + 1}`);
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
        console.log(`📋 Found ${elements.length} profiles using selector: ${selector}`);
        return elements;
      }
    }

    return [];
  }

  private async extractSingleProfile(profileElement: any, index: number): Promise<LinkedInProfileLink | null> {
    try {
      const profileUrl = await this.extractProfileUrl(profileElement);
      if (!profileUrl) {
        console.log(`⚠️  No profile URL found for result ${index + 1}`);
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
      console.log(`⚠️  Error extracting data from profile ${index + 1}:`, error);
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
          console.log(`⚠️  Invalid network filter: ${filters.network}. Valid options: F (1st degree), S (2nd degree), O (3rd+ degree)`);
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

  displayResults(profiles: LinkedInProfileLink[]): void {
    console.log('\n' + '='.repeat(80));
    console.log(`� FOUND ${profiles.length} LINKEDIN PROFILES`);
    console.log('='.repeat(80));

    profiles.forEach((profile, index) => {
      console.log(`\n${index + 1}. ${profile.name}`);
      console.log(`   🔗 Profile: ${profile.profileUrl}`);
      if (profile.headline) {
        console.log(`   💼 Headline: ${profile.headline}`);
      }
    });

    console.log('\n' + '='.repeat(80));
  }
}

interface ArgumentHandler {
  handles: string[];
  process: (filters: SearchFilters, nextArg: string | undefined) => boolean;
}

function isValidNextArg(nextArg: string | undefined): boolean {
  return Boolean(nextArg && !nextArg.startsWith('-'));
}

function createStringArgumentHandler(field: keyof SearchFilters, aliases: string[]): ArgumentHandler {
  return {
    handles: aliases,
    process: (filters, nextArg) => {
      if (isValidNextArg(nextArg)) {
        (filters as any)[field] = nextArg;
        return true;
      }
      return false;
    }
  };
}

function createHelpArgumentHandler(): ArgumentHandler {
  return {
    handles: ['--help', '-h'],
    process: () => {
      showHelp();
      process.exit(0);
    }
  };
}

function createArgumentHandlers(): ArgumentHandler[] {
  return [
    createStringArgumentHandler('keywords', ['--keywords', '-k']),
    createStringArgumentHandler('location', ['--location', '-l']),
    createStringArgumentHandler('network', ['--network', '-n']),
    createHelpArgumentHandler()
  ];
}

function findArgumentHandler(arg: string, handlers: ArgumentHandler[]): ArgumentHandler | undefined {
  return handlers.find(handler => handler.handles.includes(arg));
}

function handleBackwardCompatibility(filters: SearchFilters, args: string[], index: number): void {
  const arg = args[index];
  // If no flags are used, treat the first argument as keywords for backward compatibility
  if (index === 0 && !arg.startsWith('-')) {
    filters.keywords = arg;
  }
}

function parseArguments(): SearchFilters {
  const args = process.argv.slice(2);
  const filters: SearchFilters = {};
  const handlers = createArgumentHandlers();

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    const nextArg = args[i + 1];
    const handler = findArgumentHandler(arg, handlers);

    if (handler) {
      const consumedNextArg = handler.process(filters, nextArg);
      if (consumedNextArg) {
        i += 2; // Skip both current and next argument as next was consumed
      } else {
        i++; // Only advance current argument
      }
    } else {
      handleBackwardCompatibility(filters, args, i);
      i++; // Advance to next argument
    }
  }

  return filters;
}

function showHelp(): void {
  console.log(`
🚀 LinkedIn People Search Scraper

USAGE:
  npm run search -- [OPTIONS]
  npm run search -- "software engineer"  # Simple keyword search (backward compatible)

OPTIONS:
  -k, --keywords <string>           Search keywords (e.g., "AI engineer", "data scientist")
  -l, --location <string>           Location - can be a location string (e.g., "San Francisco") 
                                    or LinkedIn geoUrn code (e.g., "105646813" for Spain)
                                    Default: 104195383 (if no location provided)
  -n, --network <string>            Network degree filter:
                                      F = 1st degree connections (First-degree)
                                      S = 2nd degree connections (Second-degree)  
                                      O = 3rd+ degree connections (Out of network)
  -h, --help                        Show this help message

LOCATION EXAMPLES:
  String: "San Francisco", "New York", "London"
  GeoUrn: "105646813" (Spain), "102257491" (London Area)
  Default: "104195383" (used when no location is specified)

NETWORK EXAMPLES:
  F = Search only 1st degree connections (people you're directly connected to)
  S = Search only 2nd degree connections (friends of friends)
  O = Search 3rd+ degree connections (people outside your extended network)

EXAMPLES:
  # Basic keyword search (uses default geoUrn 104195383)
  npm run search -- "AI engineer"
  
  # Search with location string
  npm run search -- --keywords "software engineer" --location "San Francisco"
  
  # Search with LinkedIn geoUrn location code
  npm run search -- -k "data scientist" -l "105646813"
  
  # Search only 1st degree connections
  npm run search -- -k "product manager" -n "F"
  
  # Search 2nd degree connections in a specific location
  npm run search -- -k "software engineer" -l "New York" -n "S"
  
  # Search people outside your network
  npm run search -- -k "AI researcher" -n "O"
`);
}

// Main execution function
async function main() {
  const scraper = new LinkedInPeopleSearchScraper();

  try {
    // Parse command line arguments
    const filters = parseArguments();

    // If no filters provided, show help
    if (Object.keys(filters).length === 0) {
      showHelp();
      return;
    }

    console.log('🚀 Starting LinkedIn People Search Scraper...');
    console.log('📝 Search Filters:', JSON.stringify(filters, null, 2));

    await scraper.init();
    const profiles = await scraper.searchPeople(filters);

    scraper.displayResults(profiles);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scraper.close();
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

export { LinkedInPeopleSearchScraper, LinkedInProfileLink, SearchFilters };
