# LinkedIn Web Scraper MCP Server

A Model Context Protocol (MCP) server that provides LinkedIn web scraping capabilities as tools for AI assistants. This server uses Playwright to automate LinkedIn people search and extract profile information, exposing these capabilities through the MCP protocol.

## Features

- **MCP Tool Integration**: Exposes LinkedIn scraping as MCP tools for AI assistants
- **People Search**: Search LinkedIn profiles using keywords, location, and network filters
- **Profile Extraction**: Extract profile names, URLs, and headlines from search results
- **Session Management**: Automatic LinkedIn login with cookie persistence
- **Adaptive Selectors**: Handles LinkedIn UI changes with multiple CSS selector strategies
- **Network Filtering**: Filter by connection degree (1st, 2nd, 3rd+ connections)
- **Location Support**: Filter by location using LinkedIn's geoUrn codes or location strings

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Phicks-debug/linkedin-web-scrapper.git
cd linkedin-web-scrapper-mcp-server
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
Then edit `config.json` with your LinkedIn credentials:
```json
{
  "linkedin": {
    "email": "your-linkedin-email@email.com",
    "password": "your-linkedin-password"
  },
  "browser": {
    "headless": false,
    "slowMo": 1000,
    "cookiesPath": "./cookies.json"
  }
}
```

5. Build the server:
```bash
npm run build
```

## Usage

### As an MCP Server

This server is designed to be used with MCP-compatible AI assistants. The server exposes LinkedIn scraping functionality through the MCP protocol.

#### Starting the MCP Server

```bash
# Start the server (connects via stdio)
node dist/index.js

# For development with auto-rebuild
npm run watch
```

#### Using MCP Inspector (Development)

Test the server using the MCP Inspector:

```bash
npm run inspector
```

### Available MCP Tools

#### `search-linkedin-people`

Search for LinkedIn profiles using web scraping.

**Input Schema:**
```json
{
  "keywords": "software engineer", // Required: Keywords to search for
  "location": "105646813",        // Optional: Location filter (geoUrn or location string)
  "network": "F"                  // Optional: Network degree filter
}
```

**Network Filter Options:**
- `"F"` - 1st degree connections only
- `"S"` - 2nd degree connections
- `"O"` - 3rd+ degree connections (out of network)

**Location Examples:**
- `"105646813"` - Spain (using LinkedIn geoUrn)
- `"San Francisco"` - Location string
- Default: `"104195383"` if not specified

**Response Format:**
```json
{
  "success": true,
  "count": 10,
  "profiles": [
    {
      "name": "John Doe",
      "profileUrl": "https://www.linkedin.com/in/johndoe",
      "headline": "Senior Software Engineer at Tech Company"
    }
  ],
  "filters": {
    "keywords": "software engineer",
    "location": "105646813",
    "network": "F"
  }
}
```

## MCP Integration

### Adding to Claude Desktop

Add this server to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/path/to/linkedin-web-scrapper-mcp-server/dist/index.js"],
      "cwd": "/path/to/linkedin-web-scrapper-mcp-server"
    }
  }
}
```

### Using with Other MCP Clients

The server follows the standard MCP protocol and can be used with any MCP-compatible client by connecting to the stdio transport.

## How It Works

1. **MCP Protocol**: Exposes LinkedIn scraping as standardized MCP tools
2. **Browser Automation**: Uses Playwright to control Chrome/Chromium browser
3. **Session Persistence**: Saves LinkedIn session cookies to avoid repeated logins
4. **People Search**: Navigates to LinkedIn people search with specified filters
5. **Profile Extraction**: Extracts profile data using adaptive CSS selectors
6. **Structured Output**: Returns JSON-formatted results via MCP protocol

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript and make executable |
| `npm run watch` | Watch mode for development |
| `npm run inspector` | Launch MCP Inspector for testing |
| `npm run dev` | Build and run the server |

### Project Structure

```
├── index.ts              # Main MCP server implementation
├── config.json          # LinkedIn credentials and browser settings
├── cookies.json          # Saved session cookies (auto-generated)
├── package.json          # MCP server configuration
└── dist/                 # Compiled JavaScript output
```

## Security & Privacy

- **Local Credentials**: Your LinkedIn credentials are stored locally in `config.json`
- **Session Cookies**: Saved locally in `cookies.json` for session persistence
- **No Data Transmission**: No data is sent anywhere except to LinkedIn for scraping
- **Browser Automation**: Uses a visible browser window to avoid detection

## Technical Details

- **Protocol**: Model Context Protocol (MCP) 0.6.0
- **Runtime**: Node.js with TypeScript
- **Browser Engine**: Playwright with Chromium
- **Transport**: Standard I/O (stdio) for MCP communication
- **Target**: LinkedIn People Search API

## Error Handling

The server handles common scenarios:
- Automatic LinkedIn login when session expires
- LinkedIn security challenges (requires manual intervention)
- UI changes through adaptive selectors
- Network timeouts and connection issues

## Limitations

- **LinkedIn Terms**: Use responsibly and respect LinkedIn's terms of service
- **Rate Limiting**: Avoid excessive requests to prevent detection
- **Manual Challenges**: Security challenges require manual completion
- **UI Dependencies**: May need updates if LinkedIn significantly changes their UI

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with MCP Inspector
5. Submit a pull request

For issues and feature requests, please use the GitHub issues page.
