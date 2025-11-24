# Supabase MCP Server

An MCP (Model Context Protocol) server that provides access to Supabase fact tables with analytical query capabilities. The server supports both stdio and SSE/Streamable HTTP transports for agent integration.

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

- Agent integration:
  - Auto-discovery of tools
  - Automatic tool selection based on user queries
  - Structured responses in MCP format

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

The server supports two transport methods:

#### 1. SSE/Streamable HTTP (Deployed - Recommended for Agents)

The server runs on HTTP using SSE/Streamable HTTP transport (MCP Protocol over HTTP):

```bash
npm run start:sse
```

For development with auto-reload:
```bash
npm run dev:sse
```

**Deployed Version:**
- URL: `https://web-production-bd81.up.railway.app`
- Transport: SSE/Streamable HTTP (MCP Protocol)
- Use for: Agent integration, MCP nodes that support HTTP/SSE

#### 2. stdio (Local - For MCP Clients)

The server runs on stdio and communicates via the MCP protocol:

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

**Use for:** Local MCP clients (Cursor, local agents via stdio)

### MCP Tools Available

The server provides 6 MCP tools that can be auto-discovered by agents:

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

### How SSE/Streamable HTTP Works

The SSE/Streamable HTTP transport implements MCP protocol over HTTP:

1. **Connection**: Client connects via HTTP GET with `Accept: text/event-stream`
2. **Session**: Server establishes SSE stream and returns session ID
3. **Communication**: 
   - Client sends JSON-RPC messages via HTTP POST
   - Server responds with JSON-RPC messages over SSE stream
4. **Auto-Discovery**: Agents can call `tools/list` to discover all available tools
5. **Tool Execution**: Agents call `tools/call` with tool name and arguments

### Agent Integration

When connected to an agent (e.g., DevRev Agent):

1. **Auto-Discovery**: Agent automatically discovers all 6 tools via `tools/list`
2. **Query Understanding**: Agent analyzes user queries and matches to appropriate tools
3. **Tool Selection**: Agent selects the right tool based on query intent
4. **Execution**: Agent calls `tools/call` with appropriate parameters
5. **Response**: Agent receives structured response and formats for user

**Example Flow:**
- User: "How many members do we have?"
- Agent: Discovers tools → Matches to `analyze_data` → Calls with `table: "fact_member", operation: "count"` → Returns count to user

### Example Queries

**Get all members:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_members"
  },
  "id": 1
}
```

**Get first 10 resorts:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_resorts",
    "arguments": {
      "limit": 10
    }
  },
  "id": 2
}
```

**Count feedback records:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "analyze_data",
    "arguments": {
      "table": "fact_feedback",
      "operation": "count"
    }
  },
  "id": 3
}
```

**Query events with filters:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "query_table",
    "arguments": {
      "table": "fact_event",
      "filters": {
        "status": "active"
      },
      "limit": 20
    }
  },
  "id": 4
}
```

## Connecting to Agents/MCP Workflows

### For DevRev Agent (SSE/Streamable HTTP)

1. Connect to deployed server: `https://web-production-bd81.up.railway.app`
2. Transport: SSE/Streamable HTTP (MCP Protocol)
3. Agent will automatically:
   - Discover all tools via `tools/list`
   - Understand user queries
   - Select appropriate tools
   - Execute queries and return responses

### For Local MCP Clients (stdio)

1. Configure the MCP server path to point to this project
2. Set the command to: `node /path/to/dist/index.js`
3. The server will communicate via stdio

## Configuration

The Supabase URL and API key are currently hardcoded in the source files. For production use, consider:

- Using environment variables
- Using a configuration file
- Using secure credential management

To update the configuration, modify these constants in `src/sse-server.ts` or `src/index.ts`:
```typescript
const SUPABASE_URL = "https://falunbwzjuhebsgtnrbx.supabase.co";
const SUPABASE_API_KEY = "your-api-key";
```

## Deployment

### Deploying to Render

1. **Sign up/Login** to [Render](https://render.com) and connect your GitHub account

2. **Create a New Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Render will auto-detect the `render.yaml` configuration

3. **Configure the Service** (if not using render.yaml):
   - **Name**: `supabase-mcp-server` (or any name you prefer)
   - **Environment**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start:sse`
   - **Plan**: Free (or choose a paid plan)

4. **Environment Variables** (optional):
   - `NODE_ENV`: `production`
   - `PORT`: Render automatically sets this (no need to set manually)

5. **Deploy**: Click "Create Web Service" and Render will:
   - Build your application
   - Deploy it automatically
   - Provide you with a URL like: `https://your-app-name.onrender.com`

6. **Note**: On the free tier, your service will sleep after 15 minutes of inactivity. The first request after sleep may take 30-60 seconds to wake up.

See `render.yaml` for deployment configuration.

### Deploying to Railway

1. Push code to GitHub
2. Connect Railway to your GitHub repository
3. Railway auto-detects and deploys
4. Server starts with `npm run start:sse`

See `railway.json` for deployment configuration.

## Development

### Project Structure

```
.
├── src/
│   ├── index.ts          # stdio MCP server (local use)
│   └── sse-server.ts     # SSE/Streamable HTTP server (deployed)
├── dist/                  # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── railway.json          # Railway deployment config
├── render.yaml           # Render deployment config
├── README.md
└── MCP_COMPLETE_REFERENCE.txt  # Complete reference guide
```

### Building

```bash
npm run build
```

### TypeScript

The project uses TypeScript with strict type checking. Configuration is in `tsconfig.json`.

## Documentation

- **MCP_COMPLETE_REFERENCE.txt** - Complete reference with SSE details, tool descriptions, and agent integration examples

## License

MIT
