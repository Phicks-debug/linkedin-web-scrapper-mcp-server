# LinkedIn Web Scraper

A TypeScript-based web scraper that searches for LinkedIn profiles and extracts profile links from search results.

## Features

- **Automated Login**: Automatically logs into LinkedIn using your credentials
- **Session Persistence**: Saves and reuses cookies to avoid repeated logins
- **Keyword Search**: Search for LinkedIn profiles using custom keywords
- **Profile Extraction**: Extracts profile names, URLs, and headlines
- **Security Challenge Handling**: Handles LinkedIn security challenges with user assistance
- **Adaptive Selectors**: Supports multiple profile card selectors (adapts to LinkedIn UI changes)
- **Clean Output**: Structured console output with emojis for better readability

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Phicks-debug/linkedin-web-scrapper.git
cd linkedin-web-scrapper
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npx playwright install
```

4. Configure your LinkedIn credentials:
```bash
cp config.example.json config.json
```
Then edit `config.json` with your LinkedIn email and password:
```json
{
  "linkedin": {
    "email": "your-linkedin-email@email.com",
    "password": "your-linkedin-password"
  }
}
```

## Usage

### Method 1: Using npm scripts

Search with default keyword ("software engineer"):
```bash
npm run search
```

Search with custom keywords:
```bash
npm run search "data scientist"
```

### Method 2: Direct execution

Build and run:
```bash
npm run build
node dist/index.js "product manager"
```

Development mode:
```bash
npm run dev "frontend developer"
```

## How it works

1. **Configuration Loading**: Reads LinkedIn credentials from `config.json`
2. **Browser Launch**: Opens a Chrome browser instance using Playwright
3. **Cookie Management**: Loads saved session cookies if available
4. **Navigation**: Goes to LinkedIn people search URL with your keywords
5. **Auto Login**: Automatically logs into LinkedIn if not already authenticated
6. **Session Saving**: Saves cookies for future runs to avoid repeated logins
7. **Profile Extraction**: Finds profile cards and extracts:
   - Profile name
   - LinkedIn profile URL
   - Professional headline (if available)
8. **Results Display**: Shows formatted results in the console with emojis

## Example Output

```
🚀 Starting LinkedIn People Search Scraper...
📝 Keywords: software engineer

Searching for people with keywords: "software engineer"
Navigating to: https://www.linkedin.com/search/results/people/?keywords=software%20engineer

Found 10 profiles using selector: .reusable-search__result-container

================================================================================
FOUND 10 LINKEDIN PROFILES
================================================================================

1. John Doe
   Profile: https://www.linkedin.com/in/johndoe
   Headline: Senior Software Engineer at Tech Company

2. Jane Smith
   Profile: https://www.linkedin.com/in/janesmith
   Headline: Full Stack Developer | React & Node.js Expert

...
```

## Important Notes

- **Credentials**: Store your LinkedIn credentials in `config.json` (not tracked by git)
- **Security Challenges**: LinkedIn may occasionally require security challenges - handle them manually when prompted
- **Session Persistence**: Cookies are saved to avoid repeated logins
- **Rate Limiting**: Be respectful of LinkedIn's terms of service and don't make too many requests
- **Browser Window**: The script opens a visible browser window (not headless) to avoid detection
- **Selectors**: The script uses multiple CSS selectors to adapt to LinkedIn's changing UI

## Security

- Your credentials are stored locally in `config.json` and never transmitted anywhere except to LinkedIn
- Session cookies are saved locally in `cookies.json` for convenience
- Both files are excluded from git tracking for security

## Technical Details

- **Language**: TypeScript
- **Browser Automation**: Playwright
- **Target**: LinkedIn People Search (`https://www.linkedin.com/search/results/people/`)
- **Output**: Console-based structured results

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run start` | Build and run the compiled script |
| `npm run dev` | Run directly with ts-node (development) |
| `npm run search` | Build and run with default or provided keywords |

## License

MIT License - see LICENSE file for details.
