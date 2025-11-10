#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Supabase configuration
const SUPABASE_URL = "https://falunbwzjuhebsgtnrbx.supabase.co";
const SUPABASE_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbHVuYnd6anVoZWJzZ3RucmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0OTgwNDEsImV4cCI6MjA3ODA3NDA0MX0.RvSBQ24ssJp97VzSxQ_gpcxKs3CllG2QHEXpGON-wCk";

// Helper function to make Supabase API calls
async function querySupabaseTable(
  tableName: string,
  params?: Record<string, string>
): Promise<any> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${tableName}`);
  
  // Add query parameters if provided
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: SUPABASE_API_KEY,
      Authorization: `Bearer ${SUPABASE_API_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Supabase API error: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

// Helper function for analytical queries
async function performAnalyticalQuery(
  tableName: string,
  operation: string,
  field?: string
): Promise<any> {
  let selectParam = "*";
  
  if (operation === "count") {
    selectParam = "count";
  } else if (field && operation === "aggregate") {
    // For basic aggregation, we'll fetch all and calculate
    selectParam = field;
  }

  const data = await querySupabaseTable(tableName, {
    select: selectParam,
  });

  switch (operation) {
    case "count":
      return { count: Array.isArray(data) ? data.length : 0 };
    case "list":
      return { data, count: Array.isArray(data) ? data.length : 0 };
    default:
      return data;
  }
}

// Create MCP server
const server = new Server(
  {
    name: "supabase-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
const tools: Tool[] = [
  {
    name: "get_members",
    description:
      "Retrieve member data from the fact_member table. Can be used to get all members or filter by specific criteria.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of records to return",
        },
        order: {
          type: "string",
          description: "Order by field (e.g., 'id.asc', 'created_at.desc')",
        },
        select: {
          type: "string",
          description: "Comma-separated list of fields to select",
        },
      },
    },
  },
  {
    name: "get_resorts",
    description:
      "Retrieve resort data from the fact_resort table. Can be used to get all resorts or filter by specific criteria.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of records to return",
        },
        order: {
          type: "string",
          description: "Order by field (e.g., 'id.asc', 'created_at.desc')",
        },
        select: {
          type: "string",
          description: "Comma-separated list of fields to select",
        },
      },
    },
  },
  {
    name: "get_feedback",
    description:
      "Retrieve feedback data from the fact_feedback table. Can be used to get all feedback or filter by specific criteria.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of records to return",
        },
        order: {
          type: "string",
          description: "Order by field (e.g., 'id.asc', 'created_at.desc')",
        },
        select: {
          type: "string",
          description: "Comma-separated list of fields to select",
        },
      },
    },
  },
  {
    name: "get_events",
    description:
      "Retrieve event data from the fact_event table. Can be used to get all events or filter by specific criteria.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of records to return",
        },
        order: {
          type: "string",
          description: "Order by field (e.g., 'id.asc', 'created_at.desc')",
        },
        select: {
          type: "string",
          description: "Comma-separated list of fields to select",
        },
      },
    },
  },
  {
    name: "analyze_data",
    description:
      "Perform analytical queries across the Supabase tables. Supports counting records, aggregations, and cross-table analysis.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          enum: ["fact_member", "fact_resort", "fact_feedback", "fact_event"],
          description: "The table to analyze",
        },
        operation: {
          type: "string",
          enum: ["count", "list", "aggregate"],
          description:
            "Type of analysis: 'count' for record count, 'list' for all records, 'aggregate' for aggregations",
        },
        field: {
          type: "string",
          description: "Field name for aggregation operations",
        },
      },
      required: ["table", "operation"],
    },
  },
  {
    name: "query_table",
    description:
      "Generic query tool for any Supabase table with advanced filtering and querying capabilities.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          enum: ["fact_member", "fact_resort", "fact_feedback", "fact_event"],
          description: "The table to query",
        },
        filters: {
          type: "object",
          description:
            "Filter conditions as key-value pairs (e.g., {status: 'active'})",
        },
        limit: {
          type: "number",
          description: "Maximum number of records to return",
        },
        order: {
          type: "string",
          description: "Order by field (e.g., 'id.asc', 'created_at.desc')",
        },
      },
      required: ["table"],
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_members": {
        const memberParams: Record<string, string> = {};
        if (args?.limit) memberParams.limit = String(args.limit);
        if (args?.order) memberParams.order = String(args.order);
        if (args?.select) memberParams.select = String(args.select);

        const data = await querySupabaseTable("fact_member", memberParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "get_resorts": {
        const resortParams: Record<string, string> = {};
        if (args?.limit) resortParams.limit = String(args.limit);
        if (args?.order) resortParams.order = String(args.order);
        if (args?.select) resortParams.select = String(args.select);

        const data = await querySupabaseTable("fact_resort", resortParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "get_feedback": {
        const feedbackParams: Record<string, string> = {};
        if (args?.limit) feedbackParams.limit = String(args.limit);
        if (args?.order) feedbackParams.order = String(args.order);
        if (args?.select) feedbackParams.select = String(args.select);

        const data = await querySupabaseTable("fact_feedback", feedbackParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "get_events": {
        const eventParams: Record<string, string> = {};
        if (args?.limit) eventParams.limit = String(args.limit);
        if (args?.order) eventParams.order = String(args.order);
        if (args?.select) eventParams.select = String(args.select);

        const data = await querySupabaseTable("fact_event", eventParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "analyze_data": {
        const { table, operation, field } = args as {
          table: string;
          operation: string;
          field?: string;
        };

        if (!table || !operation) {
          throw new Error("Table and operation are required");
        }

        const result = await performAnalyticalQuery(table, operation, field);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "query_table": {
        const { table, filters, limit, order } = args as {
          table: string;
          filters?: Record<string, any>;
          limit?: number;
          order?: string;
        };

        if (!table) {
          throw new Error("Table name is required");
        }

        const queryParams: Record<string, string> = {};
        if (limit) queryParams.limit = String(limit);
        if (order) queryParams.order = String(order);

        // Build filter query string if filters provided
        // Supports PostgREST syntax: eq, neq, gt, gte, lt, lte, like, ilike, is, in
        if (filters && Object.keys(filters).length > 0) {
          Object.entries(filters).forEach(([key, value]) => {
            // If value is an object with operator, use it (e.g., {operator: 'gt', value: 100})
            if (typeof value === 'object' && value !== null && 'operator' in value) {
              const op = (value as any).operator || 'eq';
              const val = (value as any).value;
              queryParams[key] = `${op}.${val}`;
            } else {
              // Default to equality
              queryParams[key] = `eq.${value}`;
            }
          });
        }

        const data = await querySupabaseTable(table, queryParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Supabase MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

