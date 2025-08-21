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

interface LinkedInProfile {
  name: string;
  headline?: string;
  location?: string;
  about?: string;
  experience?: Array<{
    title: string;
    company: string;
    duration: string;
    description?: string;
  }>;
  education?: Array<{
    school: string;
    degree?: string;
    years?: string;
  }>;
  skills?: string[];
  profileUrl: string;
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
    // Try to load from environment variables first (for Docker/containerized environments)
    const envEmail = process.env.LINKEDIN_EMAIL;
    const envPassword = process.env.LINKEDIN_PASSWORD;

    if (envEmail && envPassword) {
      return {
        linkedin: {
          email: envEmail,
          password: envPassword
        },
        browser: {
          headless: true,
          slowMo: 1000,
          cookiesPath: "./cookies.json"
        }
      };
    }

    // Fallback to config file
    const configPath = path.join(__dirname, '..', 'config.json');
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData) as Config;

      if (config.linkedin.email === 'your-email@example.com') {
        throw new Error('Please update config.json with your LinkedIn credentials');
      }

      return config;
    } catch (error) {
      throw new Error(`Error loading configuration: ${error}. Please make sure config.json exists and is properly formatted, or set LINKEDIN_EMAIL and LINKEDIN_PASSWORD environment variables`);
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

  async scrapeProfile(profileUrl: string): Promise<LinkedInProfile> {
    if (!this.page) {
      throw new Error('Browser not initialized. Call init() first.');
    }

    try {
      console.error(`🔍 Scraping profile: ${profileUrl}`);

      await this.page.goto(profileUrl, {
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

        // Navigate to profile again after login
        console.error('🔄 Redirecting to profile after login...');
        await this.page.goto(profileUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        await this.page.waitForTimeout(5000);
      }

      // Extract profile information
      const profileData = await this.extractProfileData(profileUrl);

      return profileData;

    } catch (error) {
      console.error('❌ Error during profile scraping:', error);
      throw error;
    }
  }

  private async extractProfileData(profileUrl: string): Promise<LinkedInProfile> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      // Extract basic profile information
      const name = await this.extractProfileNameFromPage();
      const headline = await this.extractProfileHeadlineFromPage();
      const location = await this.extractProfileLocation();
      const about = await this.extractProfileAbout();

      // Extract experience
      const experience = await this.extractProfileExperience();

      // Extract education
      const education = await this.extractProfileEducation();

      // Extract skills
      const skills = await this.extractProfileSkills();

      return {
        name,
        headline,
        location,
        about,
        experience,
        education,
        skills,
        profileUrl
      };
    } catch (error) {
      console.error('❌ Error extracting profile data:', error);
      // Return basic profile with available data
      return {
        name: 'Unknown',
        profileUrl
      };
    }
  }

  private async extractProfileNameFromPage(): Promise<string> {
    if (!this.page) return 'Unknown';

    const nameSelectors = [
      '.pv-text-details__left-panel h1',
      '.pv-top-card--list-bullet .pv-text-details__left-panel h1',
      '.pv-top-card--list .pv-text-details__left-panel h1',
      '.pv-top-card .pv-text-details__left-panel h1'
    ];

    for (const selector of nameSelectors) {
      try {
        const nameElement = await this.page.$(selector);
        const name = await nameElement?.textContent();
        if (name && name.trim()) {
          return name.trim();
        }
      } catch (e) {
        console.error(`❌ Error extracting name with selector ${selector}:`, e);
      }
    }

    return 'Unknown';
  }

  private async extractProfileHeadlineFromPage(): Promise<string | undefined> {
    if (!this.page) return undefined;

    const headlineSelectors = [
      '.pv-text-details__left-panel .text-body-medium.break-words',
      '.pv-top-card--list-bullet .text-body-medium.break-words',
      '.pv-top-card .pv-text-details__left-panel .text-body-medium',
      '.pv-top-card--list .pv-text-details__left-panel .text-body-medium'
    ];

    for (const selector of headlineSelectors) {
      try {
        const headlineElement = await this.page.$(selector);
        const headline = await headlineElement?.textContent();
        if (headline && headline.trim()) {
          return headline.trim();
        }
      } catch (e) {
        console.error(`❌ Error extracting headline with selector ${selector}:`, e);
      }
    }

    return undefined;
  }

  private async extractProfileLocation(): Promise<string | undefined> {
    if (!this.page) return undefined;

    const locationSelectors = [
      '.pv-text-details__left-panel .text-body-small.inline.t-black--light.break-words',
      '.pv-top-card--list-bullet .text-body-small.inline.t-black--light.break-words',
      '.pv-top-card .pv-text-details__left-panel .text-body-small.inline'
    ];

    for (const selector of locationSelectors) {
      try {
        const locationElement = await this.page.$(selector);
        const location = await locationElement?.textContent();
        if (location && location.trim()) {
          return location.trim();
        }
      } catch (e) {
        console.error(`❌ Error extracting location with selector ${selector}:`, e);
      }
    }

    return undefined;
  }

  private async extractProfileAbout(): Promise<string | undefined> {
    if (!this.page) return undefined;

    try {
      // Try to expand "About" section if it's collapsed
      const aboutExpandButton = await this.page.$('button[aria-label="Show more about section"]');
      if (aboutExpandButton) {
        await aboutExpandButton.click();
        await this.page.waitForTimeout(1000);
      }

      const aboutSelectors = [
        '.pv-about-section .pv-shared-text-with-see-more',
        '.pv-about__summary-text',
        '#about .pv-shared-text-with-see-more'
      ];

      for (const selector of aboutSelectors) {
        const aboutElement = await this.page.$(selector);
        const about = await aboutElement?.textContent();
        if (about && about.trim()) {
          return about.trim();
        }
      }
    } catch (e) {
      console.error('❌ Error extracting about section:', e);
    }

    return undefined;
  }

  private async extractProfileExperience(): Promise<Array<{ title: string, company: string, duration: string, description?: string }>> {
    if (!this.page) return [];

    try {
      // Try to expand experience section if collapsed
      const expExpandButton = await this.page.$('button[aria-label*="experience"]');
      if (expExpandButton) {
        await expExpandButton.click();
        await this.page.waitForTimeout(1000);
      }

      const experienceSelectors = [
        '.pv-experience-section .pv-profile-section__list-item',
        '#experience .pv-profile-section__list-item'
      ];

      for (const selector of experienceSelectors) {
        const experienceElements = await this.page.$$(selector);
        if (experienceElements.length > 0) {
          const experiences = [];

          for (const expElement of experienceElements) {
            try {
              const title = await this.extractExperienceTitle(expElement);
              const company = await this.extractExperienceCompany(expElement);
              const duration = await this.extractExperienceDuration(expElement);
              const description = await this.extractExperienceDescription(expElement);

              if (title || company) {
                experiences.push({
                  title: title || 'Unknown Title',
                  company: company || 'Unknown Company',
                  duration: duration || 'Unknown Duration',
                  description
                });
              }
            } catch (e) {
              console.error('❌ Error extracting individual experience:', e);
            }
          }

          return experiences;
        }
      }
    } catch (e) {
      console.error('❌ Error extracting experience section:', e);
    }

    return [];
  }

  private async extractExperienceTitle(expElement: any): Promise<string | undefined> {
    const titleSelectors = [
      '.pv-entity__summary-info h3',
      '.pv-entity__summary-info .t-16.t-black.t-bold'
    ];

    for (const selector of titleSelectors) {
      const titleElement = await expElement.$(selector);
      const title = await titleElement?.textContent();
      if (title && title.trim()) {
        return title.trim();
      }
    }
    return undefined;
  }

  private async extractExperienceCompany(expElement: any): Promise<string | undefined> {
    const companySelectors = [
      '.pv-entity__secondary-title',
      '.pv-entity__summary-info .t-14.t-black.t-normal'
    ];

    for (const selector of companySelectors) {
      const companyElement = await expElement.$(selector);
      const company = await companyElement?.textContent();
      if (company && company.trim()) {
        return company.trim();
      }
    }
    return undefined;
  }

  private async extractExperienceDuration(expElement: any): Promise<string | undefined> {
    const durationSelectors = [
      '.pv-entity__date-range',
      '.pv-entity__summary-info .t-14.t-black--light'
    ];

    for (const selector of durationSelectors) {
      const durationElement = await expElement.$(selector);
      const duration = await durationElement?.textContent();
      if (duration && duration.trim()) {
        return duration.trim();
      }
    }
    return undefined;
  }

  private async extractExperienceDescription(expElement: any): Promise<string | undefined> {
    const descSelectors = [
      '.pv-entity__description',
      '.pv-entity__extra-details'
    ];

    for (const selector of descSelectors) {
      const descElement = await expElement.$(selector);
      const description = await descElement?.textContent();
      if (description && description.trim()) {
        return description.trim();
      }
    }
    return undefined;
  }

  private async extractProfileEducation(): Promise<Array<{ school: string, degree?: string, years?: string }>> {
    if (!this.page) return [];

    try {
      const educationSelectors = [
        '.pv-education-section .pv-profile-section__list-item',
        '#education .pv-profile-section__list-item'
      ];

      for (const selector of educationSelectors) {
        const educationElements = await this.page.$$(selector);
        if (educationElements.length > 0) {
          const education = [];

          for (const eduElement of educationElements) {
            try {
              const school = await this.extractEducationSchool(eduElement);
              const degree = await this.extractEducationDegree(eduElement);
              const years = await this.extractEducationYears(eduElement);

              if (school) {
                education.push({
                  school,
                  degree,
                  years
                });
              }
            } catch (e) {
              console.error('❌ Error extracting individual education:', e);
            }
          }

          return education;
        }
      }
    } catch (e) {
      console.error('❌ Error extracting education section:', e);
    }

    return [];
  }

  private async extractEducationSchool(eduElement: any): Promise<string | undefined> {
    const schoolSelectors = ['.pv-entity__school-name'];

    for (const selector of schoolSelectors) {
      const schoolElement = await eduElement.$(selector);
      const school = await schoolElement?.textContent();
      if (school && school.trim()) {
        return school.trim();
      }
    }
    return undefined;
  }

  private async extractEducationDegree(eduElement: any): Promise<string | undefined> {
    const degreeSelectors = ['.pv-entity__degree-name'];

    for (const selector of degreeSelectors) {
      const degreeElement = await eduElement.$(selector);
      const degree = await degreeElement?.textContent();
      if (degree && degree.trim()) {
        return degree.trim();
      }
    }
    return undefined;
  }

  private async extractEducationYears(eduElement: any): Promise<string | undefined> {
    const yearsSelectors = ['.pv-entity__dates'];

    for (const selector of yearsSelectors) {
      const yearsElement = await eduElement.$(selector);
      const years = await yearsElement?.textContent();
      if (years && years.trim()) {
        return years.trim();
      }
    }
    return undefined;
  }

  private async extractProfileSkills(): Promise<string[]> {
    if (!this.page) return [];

    try {
      await this.expandSkillsSection();
      const skillElements = await this.getSkillElements();

      if (skillElements.length > 0) {
        return await this.extractSkillNamesFromElements(skillElements);
      }
    } catch (e) {
      console.error('❌ Error extracting skills section:', e);
    }

    return [];
  }

  private async expandSkillsSection(): Promise<void> {
    if (!this.page) return;

    const skillsExpandButton = await this.page.$('button[aria-label*="skills"]');
    if (skillsExpandButton) {
      await skillsExpandButton.click();
      await this.page.waitForTimeout(1000);
    }
  }

  private async getSkillElements(): Promise<any[]> {
    if (!this.page) return [];

    const skillsSelectors = [
      '.pv-skills-section .pv-skill-category-entity',
      '#skills .pv-skill-category-entity'
    ];

    for (const selector of skillsSelectors) {
      const skillElements = await this.page.$$(selector);
      if (skillElements.length > 0) {
        return skillElements;
      }
    }

    return [];
  }

  private async extractSkillNamesFromElements(skillElements: any[]): Promise<string[]> {
    const skills: string[] = [];

    for (const skillElement of skillElements) {
      try {
        const skillName = await skillElement?.textContent?.();
        if (skillName && skillName.trim()) {
          skills.push(skillName.trim());
        }
      } catch (e) {
        console.error('❌ Error extracting individual skill:', e);
      }
    }

    return skills;
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
      },
      {
        name: "scrape-linkedin-profile",
        description: "Scrape comprehensive data from a specific LinkedIn profile URL. Returns detailed profile information including experience, education, skills, and more.",
        inputSchema: {
          type: "object",
          properties: {
            profileUrl: {
              type: "string",
              description: "The LinkedIn profile URL to scrape (e.g., 'https://www.linkedin.com/in/username/')"
            }
          },
          required: ["profileUrl"]
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
    else if (request.params.name == "scrape-linkedin-profile") {
      const args = request.params.arguments || {};
      const profileUrl = args.profileUrl as string;

      if (!profileUrl) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `profileUrl is required for scrape-linkedin-profile tool`
        );
      }

      console.error('🚀 Starting LinkedIn Profile Scrape...');
      console.error('📝 Profile URL:', profileUrl);

      try {
        const scraperInstance = await initializeScraper();
        const profile = await scraperInstance.scrapeProfile(profileUrl);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              profile: profile
            }, null, 2)
          }]
        };
      } catch (error: any) {
        console.error('❌ LinkedIn profile scrape error:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `LinkedIn profile scraping failed: ${error.message}`
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
