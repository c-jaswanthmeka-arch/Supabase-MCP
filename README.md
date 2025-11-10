# Supabase MCP Server

An MCP (Model Context Protocol) server that provides access to Supabase fact tables with analytical query capabilities.

## Features

- Query four Supabase fact tables:
  - `fact_member` - Member data
  - `fact_resort` - Resort data
  - `fact_feedback` - Feedback data
  - `fact_event` - Event data

- Analytical capabilities:
  - Count records
  - List all records
  - Aggregate data
  - Filter and query with custom parameters

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the TypeScript project:
```bash
npm run build
```

## Usage

### Running the Server

The server runs on stdio and communicates via the MCP protocol:

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### MCP Tools Available

1. **get_members** - Retrieve member data
   - Parameters: `limit`, `order`, `select`

2. **get_resorts** - Retrieve resort data
   - Parameters: `limit`, `order`, `select`

3. **get_feedback** - Retrieve feedback data
   - Parameters: `limit`, `order`, `select`

4. **get_events** - Retrieve event data
   - Parameters: `limit`, `order`, `select`

5. **analyze_data** - Perform analytical queries
   - Parameters: `table`, `operation` (count/list/aggregate), `field` (optional)

6. **query_table** - Generic query tool with filtering
   - Parameters: `table`, `filters` (object), `limit`, `order`

### Example Queries

**Get all members:**
```json
{
  "tool": "get_members"
}
```

**Get first 10 resorts:**
```json
{
  "tool": "get_resorts",
  "arguments": {
    "limit": 10
  }
}
```

**Count feedback records:**
```json
{
  "tool": "analyze_data",
  "arguments": {
    "table": "fact_feedback",
    "operation": "count"
  }
}
```

**Query events with filters:**
```json
{
  "tool": "query_table",
  "arguments": {
    "table": "fact_event",
    "filters": {
      "status": "active"
    },
    "limit": 20
  }
}
```

## Connecting to MCP Workflow

To connect this server to an MCP node in your workflow:

1. Configure the MCP server path to point to this project
2. Set the command to: `node /path/to/dist/index.js`
3. The server will communicate via stdio

## Configuration

The Supabase URL and API key are currently hardcoded in `src/index.ts`. For production use, consider:

- Using environment variables
- Using a configuration file
- Using secure credential management

To update the configuration, modify these constants in `src/index.ts`:
```typescript
const SUPABASE_URL = "https://falunbwzjuhebsgtnrbx.supabase.co";
const SUPABASE_API_KEY = "your-api-key";
```

## Development

### Project Structure

```
.
├── src/
│   └── index.ts          # Main MCP server implementation
├── dist/                  # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

### Building

```bash
npm run build
```

### TypeScript

The project uses TypeScript with strict type checking. Configuration is in `tsconfig.json`.

## License

MIT

