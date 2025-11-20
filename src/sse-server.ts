#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import http from "http";
import { randomUUID } from "crypto";

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
  // Handle date range filters (e.g., join_date.gte and join_date.lte)
  if (params) {
    const dateRangeFields = new Map<string, string[]>();
    
    Object.entries(params).forEach(([key, value]) => {
      // Check if this is a date range filter (e.g., "join_date.gte")
      if (key.includes('.')) {
        const [field, operator] = key.split('.');
        if (!dateRangeFields.has(field)) {
          dateRangeFields.set(field, []);
        }
        dateRangeFields.get(field)!.push(`${operator}.${value}`);
      } else {
        url.searchParams.append(key, value);
      }
    });
    
    // Handle date range fields - Supabase PostgREST needs same field name with different operators
    // We'll append them as separate parameters with the same field name
    dateRangeFields.forEach((operators, field) => {
      operators.forEach(opValue => {
        url.searchParams.append(field, opValue);
      });
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

// ---- Analytics helpers -----------------------------------------

function monthRange(ym: string) {
  // ym = "YYYY-MM"
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day of month
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function previousMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // prev month first day
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Helper function to format INR amounts in Lakhs and Crores
function formatInrToLakhsCrores(amount: number): string {
  const absAmount = Math.abs(amount);
  if (absAmount >= 10000000) { // >= 1 Crore
    const crores = absAmount / 10000000;
    return `${crores.toFixed(2)}CR`;
  } else if (absAmount >= 100000) { // >= 1 Lakh
    const lakhs = absAmount / 100000;
    return `${lakhs.toFixed(2)}L`;
  } else {
    // For amounts less than 1 Lakh, show in thousands
    const thousands = absAmount / 1000;
    return `${thousands.toFixed(2)}K`;
  }
}

function safeNumber(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function groupBy<T>(arr: T[], key: (t: T) => string) {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

function topKeywords(texts: string[], k = 8) {
  const stop = new Set([
    "the","a","an","and","or","to","for","of","in","on","at","with","from",
    "is","are","was","were","it","this","that","as","by","be","have","has",
    "had","but","not","we","you","they","our","your","their","him","her"
  ]);
  const counts: Record<string, number> = {};
  for (const t of texts) {
    if (!t) continue;
    for (const w of String(t).toLowerCase().match(/\b[a-z]{3,}\b/g) || []) {
      if (!stop.has(w)) counts[w] = (counts[w] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,k)
    .map(([word,count])=>({ word, count }));
}

/**
 * Convert a "filters" object (your internal format) into PostgREST query params.
 * Supports eq, gt, gte, lt, lte, like, ilike, is, in, and combined date ranges.
 */
function buildQuery(filters?: Record<string, any>): Record<string, string> {
  if (!filters) return {};
  const qp: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value && typeof value === "object" && "operator" in value) {
      let op = String(value.operator || "eq");
      let val = value.value;
      // Support array for 'in' operator: { field: { operator: 'in', value: ['A','B'] } }
      if (op === "in" && Array.isArray(val)) {
        const list = val.map(v => typeof v === "string" ? `"${v}"` : v).join(",");
        qp[key] = `in.(${list})`;
      } else {
        // Automatically add wildcards for ilike and like operators for partial matching
        if ((op === 'ilike' || op === 'like') && typeof val === 'string') {
          // Only add wildcards if they're not already present
          if (!val.startsWith('%')) val = '%' + val;
          if (!val.endsWith('%')) val = val + '%';
        }
        qp[key] = `${op}.${val}`;
      }
    } else if (value && typeof value === "object" && ("gte" in value || "lte" in value || "gt" in value || "lt" in value)) {
      if ("gte" in value) qp[`${key}.gte`] = String(value.gte);
      if ("lte" in value) qp[`${key}.lte`] = String(value.lte);
      if ("gt" in value)  qp[`${key}.gt`]  = String(value.gt);
      if ("lt" in value)  qp[`${key}.lt`]  = String(value.lt);
    } else {
      qp[key] = `eq.${value}`;
    }
  }
  return qp;
}

// Helper function for analytical queries
async function performAnalyticalQuery(
  tableName: string,
  operation: string,
  field?: string,
  filters?: Record<string, any>
): Promise<any> {
  // Validate filters format - must be an object, not an array
  if (filters && Array.isArray(filters)) {
    throw new Error("Invalid filters format: 'filters' must be an object (key-value pairs), not an array. Example: {'membership_tier': 'Red'} or {'membership_tier': {'operator': 'eq', 'value': 'Red'}}. DO NOT use array format like [{'column': '...', 'operator': '...', 'value': '...'}].");
  }

  switch (operation) {
    case "count": {
      // Build query params with filters if provided
      const queryParams: Record<string, string> = {};
      
      // Handle filters if provided
      if (filters && typeof filters === 'object' && !Array.isArray(filters) && Object.keys(filters).length > 0) {
        Object.entries(filters).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null && 'operator' in value) {
            const op = (value as any).operator || 'eq';
            const val = (value as any).value;
            queryParams[key] = `${op}.${val}`;
          } else if (typeof value === 'object' && value !== null && ('gte' in value || 'lte' in value || 'gt' in value || 'lt' in value)) {
            if ('gte' in value) {
              queryParams[`${key}.gte`] = String(value.gte);
            }
            if ('lte' in value) {
              queryParams[`${key}.lte`] = String(value.lte);
            }
            if ('gt' in value) {
              queryParams[`${key}.gt`] = String(value.gt);
            }
            if ('lt' in value) {
              queryParams[`${key}.lt`] = String(value.lt);
            }
          } else {
            queryParams[key] = `eq.${value}`;
          }
        });
      }
      
      // Use Supabase count endpoint with filters
      const url = new URL(`${SUPABASE_URL}/rest/v1/${tableName}`);
      url.searchParams.append("select", "*");
      
      // Add filter parameters
      const dateRangeFields = new Map<string, string[]>();
      Object.entries(queryParams).forEach(([key, value]) => {
        if (key.includes('.')) {
          const [field, operator] = key.split('.');
          if (!dateRangeFields.has(field)) {
            dateRangeFields.set(field, []);
          }
          dateRangeFields.get(field)!.push(`${operator}.${value}`);
        } else {
          url.searchParams.append(key, value);
        }
      });
      
      dateRangeFields.forEach((operators, field) => {
        operators.forEach(opValue => {
          url.searchParams.append(field, opValue);
        });
      });
      
      const response = await fetch(url.toString(), {
        method: "HEAD",
        headers: {
          apikey: SUPABASE_API_KEY,
          Authorization: `Bearer ${SUPABASE_API_KEY}`,
          "Content-Type": "application/json",
          Prefer: "count=exact",
        },
      });

      if (!response.ok) {
        // Fallback: fetch with filters and count
        const data = await querySupabaseTable(tableName, queryParams);
        return { count: Array.isArray(data) ? data.length : 0 };
      }

      const count = response.headers.get("content-range");
      if (count) {
        // Parse content-range header: "0-999/1000"
        const match = count.match(/\/(\d+)$/);
        if (match) {
          return { count: parseInt(match[1], 10) };
        }
      }

      // Fallback: fetch with filters and count
      const data = await querySupabaseTable(tableName, queryParams);
      return { count: Array.isArray(data) ? data.length : 0 };
    }
    case "list": {
      // Build query params with filters if provided
      const queryParams: Record<string, string> = { limit: "10000" };
      
      // Handle filters if provided
      if (filters && typeof filters === 'object' && !Array.isArray(filters) && Object.keys(filters).length > 0) {
        Object.entries(filters).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null && 'operator' in value) {
            const op = (value as any).operator || 'eq';
            let val = (value as any).value;
            // Automatically add wildcards for ilike and like operators for partial matching
            if ((op === 'ilike' || op === 'like') && typeof val === 'string') {
              // Only add wildcards if they're not already present
              if (!val.startsWith('%')) val = '%' + val;
              if (!val.endsWith('%')) val = val + '%';
            }
            queryParams[key] = `${op}.${val}`;
          } else if (typeof value === 'object' && value !== null && ('gte' in value || 'lte' in value || 'gt' in value || 'lt' in value)) {
            if ('gte' in value) {
              queryParams[`${key}.gte`] = String(value.gte);
            }
            if ('lte' in value) {
              queryParams[`${key}.lte`] = String(value.lte);
            }
            if ('gt' in value) {
              queryParams[`${key}.gt`] = String(value.gt);
            }
            if ('lt' in value) {
              queryParams[`${key}.lt`] = String(value.lt);
            }
          } else {
            queryParams[key] = `eq.${value}`;
          }
        });
      }
      
      // Fetch records with filters
      const data = await querySupabaseTable(tableName, queryParams);
      return { data, count: Array.isArray(data) ? data.length : 0 };
    }
    case "aggregate": {
      if (!field) {
        throw new Error("Field is required for aggregate operation");
      }
      
      // Build query params with filters if provided
      const queryParams: Record<string, string> = { limit: "10000" };
      
      // Handle filters if provided
      if (filters && typeof filters === 'object' && !Array.isArray(filters) && Object.keys(filters).length > 0) {
        Object.entries(filters).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null && 'operator' in value) {
            const op = (value as any).operator || 'eq';
            const val = (value as any).value;
            queryParams[key] = `${op}.${val}`;
          } else if (typeof value === 'object' && value !== null && ('gte' in value || 'lte' in value || 'gt' in value || 'lt' in value)) {
            if ('gte' in value) {
              queryParams[`${key}.gte`] = String(value.gte);
            }
            if ('lte' in value) {
              queryParams[`${key}.lte`] = String(value.lte);
            }
            if ('gt' in value) {
              queryParams[`${key}.gt`] = String(value.gt);
            }
            if ('lt' in value) {
              queryParams[`${key}.lt`] = String(value.lt);
            }
          } else {
            queryParams[key] = `eq.${value}`;
          }
        });
      }
      
      // Fetch records with filters and calculate aggregation
      const data = await querySupabaseTable(tableName, queryParams);
      if (!Array.isArray(data)) {
        return { error: "Unable to aggregate data" };
      }
      
      // Basic aggregations
      const values = data.map((item: any) => item[field]).filter((v: any) => v != null && !isNaN(Number(v)));
      if (values.length === 0) {
        return { error: "No data to aggregate" };
      }
      
      const numericValues = values.map((v: any) => Number(v));
      
      return {
        field,
        count: numericValues.length,
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        sum: numericValues.reduce((a: number, b: number) => a + b, 0),
        avg: numericValues.reduce((a: number, b: number) => a + b, 0) / numericValues.length,
      };
    }
    default:
      const data = await querySupabaseTable(tableName, { limit: "10000" });
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
      "Retrieve member data from the fact_member table. Use ONLY when user wants to SEE member records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. Column names: 'date_joined' for date queries (NOT 'joining_date'), 'is_active' for active status (NOT 'status'), 'membership_tier' for tier (e.g., 'Red', 'White'), 'member_region' for region (NOT 'home_region'), 'lifetime_value' for customer value (NOT 'lifetime_value_inr'). Use to analyze customer segments by membership_tier, region, or date_joined. For customer analysis: Query members by membership_tier to identify which resorts attract specific customer tiers, cross-reference with resort data to find resorts popular with Red tier customers. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Retrieve resort data from the fact_resort table. Use ONLY when user wants to SEE resort records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. NOTE: This tool does NOT support filtering. For filtered queries (by theme, region, location, etc.), use 'query_table' with table: 'fact_resort' and appropriate filters. Column names: 'activity_date' for date queries, 'resort_name' for resort name, 'resort_theme' for theme (e.g., 'Beach', 'Hill Station', 'Waterpark'), 'resort_region' for region (e.g., 'West', 'South', 'North', 'East'), 'total_revenue', 'restaurant_revenue', 'activity_revenue' for revenue, 'occupied_percentage', 'member_rooms_booked', 'total_rooms_available' for occupancy. Use to analyze resort performance, compare revenue across time periods, identify trends, and correlate with events or feedback. For sales analysis: Query resort data for specific months/resorts, compare revenue and occupancy rates, identify low-performing periods. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Retrieve feedback data from the fact_feedback table. Use ONLY for simple feedback retrieval without filters. For questions like 'What was the feedback on [resort] in [month]?' or 'Show me feedback for [resort]', use query_table or insights_resort_feedback_analysis instead. Use ONLY when user wants to SEE feedback records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. Column names: 'feedback_date' (NOT 'log_date') for date queries, 'resort_name' (NOT 'resort_name_fk') for resort name, 'member_id_fk' for member, 'nps_score' for NPS score, 'csat_score' for CSAT score, 'sentiment' for sentiment, 'issue_details_text' (NOT 'details_text') for feedback text. IMPORTANT: For filtered feedback queries (by resort, date, etc.), use query_table or insights_resort_feedback_analysis. Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
  // COMMENTED OUT: Old get_events tool using Supabase fact_event table
  // {
  //   name: "get_events",
  //   description:
  //     "Retrieve event data from the fact_event table. Use ONLY when user wants to SEE event records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. Column names: 'event_date' for date queries, 'impact_region' for regional filtering. Event types: 'Local News', 'Economic News', 'Major Weather', 'Competitor Promo', 'Local Event'. Use 'weather_condition', 'competitor_name', 'relevance_score', 'details_description' for analysis. Important for sales/revenue analysis: Query events table to find potential reasons for low sales (weather, competitor promotions, economic factors, local events). Use to identify which resorts were affected by external events in a specific time period. Filter by 'impact_region' to find events affecting specific regions. Cross-reference with resort data to identify correlations between events and sales performance. For questions about resorts affected by events: Query events for a specific time period/region, then cross-reference with resort data to identify affected resorts. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
  //   inputSchema: {
  //     type: "object",
  //     properties: {
  //       limit: {
  //         type: "number",
  //         description: "Maximum number of records to return",
  //       },
  //       order: {
  //         type: "string",
  //         description: "Order by field (e.g., 'id.asc', 'created_at.desc')",
  //       },
  //       select: {
  //         type: "string",
  //         description: "Comma-separated list of fields to select",
  //       },
  //     },
  //   },
  // },
  {
    name: "get_events",
    description:
      "Search for real-time events using YDC API. Use for questions about weather events, news, or any events in specific locations. Input: query (search query like 'serious weather events in pune' or 'weather details in goa'), optional start_date and end_date (YYYY-MM-DD format for date range), optional count (number of results, default 5), optional country (ISO country code like 'IN' for India). Output: JSON with event results including titles, descriptions, URLs, and metadata. Use for questions like 'give me serious weather details in pune', 'weather events in goa and maharashtra', etc. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'serious weather events in pune', 'weather details in goa')",
        },
        start_date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (optional, for date range filtering)",
        },
        end_date: {
          type: "string",
          description: "End date in YYYY-MM-DD format (optional, for date range filtering)",
        },
        count: {
          type: "number",
          description: "Number of results to return (default: 5)",
        },
        country: {
          type: "string",
          description: "ISO country code (e.g., 'IN' for India, optional)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_member_aggregated",
    description:
      "Retrieve aggregated member data from the fact_member_aggregated table. Use for quick numerical queries like 'Total red members', 'Total active members by region', etc. This table provides pre-aggregated member statistics for faster queries. Use ONLY when user wants to SEE aggregated member records (not count them). When user asks for 'all' records, omit the limit parameter. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
    name: "get_resort_aggregated",
    description:
      "Retrieve aggregated resort data from the fact_resort_aggregated table. Use for quick numerical queries like 'Sales in July in Acacia', 'Total revenue by resort', etc. This table provides pre-aggregated resort statistics for faster queries. Use ONLY when user wants to SEE aggregated resort records (not count them). When user asks for 'all' records, omit the limit parameter. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Perform analytical queries across the Supabase tables. This is the ONLY correct tool for counting records and aggregations. NEVER use get_members/get_resorts/get_feedback/get_events for counting. Use when user asks for 'count', 'total number', 'how many', 'number of', 'average', 'min', 'max', 'sum'. Supports counting filtered results if filters are provided. For date ranges, use column names: 'date_joined' (NOT 'joining_date') for fact_member, 'activity_date' for fact_resort, 'event_date' for fact_event, 'feedback_date' (NOT 'log_date') for fact_feedback. Format: filters: {'date_joined': {'gte': '2018-01-01', 'lte': '2018-12-31'}}. For aggregations, specify the field parameter (use 'field' or 'column' - both are accepted). For fact_member: use 'lifetime_value' (NOT 'lifetime_value_inr') for lifetime value aggregations. For fact_resort: use 'total_revenue' (NOT 'total_revenue_inr'), 'activity_revenue' (NOT 'ancillary_revenue_inr'), 'restaurant_revenue' for revenue analysis. Can combine with filters to analyze specific time periods, resorts, or conditions. Use this tool to compare revenue across months, resorts, or regions. For sales analysis: compare revenue between months, identify low-performing periods, analyze occupancy rates. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          enum: ["fact_member", "fact_resort", "fact_feedback", "fact_event", "fact_member_aggregated", "fact_resort_aggregated"],
          description: "The table to analyze. MUST be one of: 'fact_member', 'fact_resort', 'fact_feedback', 'fact_event', 'fact_member_aggregated', 'fact_resort_aggregated'. Use aggregated tables (fact_member_aggregated, fact_resort_aggregated) for quick numerical queries like 'Total red members' or 'Sales in July in Acacia'. DO NOT use 'resorts', 'members', 'feedback', or 'events' - always use the 'fact_' prefix.",
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
        filters: {
          type: "object",
          description: "Optional filters to apply before counting/analyzing (e.g., {is_active: true, date_joined: {gte: '2018-01-01', lte: '2018-12-31'}})",
        },
      },
      required: ["table", "operation"],
    },
  },
  {
    name: "query_table",
    description:
      "Generic query tool for any Supabase table with advanced filtering and querying capabilities. Use when user wants filtered results or to SHOW/DISPLAY records with conditions. CRITICAL LIMITATIONS: This tool does NOT support joins, group_by, metrics, or aggregations. For demographic analysis (gender, region, age_group breakdowns) or questions requiring joining multiple tables, use 'insights_feedback_demographics' instead. For counting or aggregating, use 'analyze_data' instead. CRITICAL: Table name MUST be one of: 'fact_member', 'fact_resort', 'fact_feedback', 'fact_event' (always use 'fact_' prefix, never use 'resorts', 'members', 'feedback', or 'events'). Supports advanced filtering with operators (eq, gt, gte, lt, lte, like, ilike). When user asks for 'all' records or a specific number (e.g., '50 resorts'), DO NOT set limit parameter - tool defaults to 10000 which should cover all unique resorts. If a specific date returns fewer resorts than expected, try querying without date filter and deduplicating by resort_name to get ALL unique resorts. CRITICAL FOR RESORTS: fact_resort is a time-series table with daily records. When user asks for 'resorts' (not daily data), you MUST ALWAYS add a date filter to get one record per resort: filters: {'activity_date': {'gte': '2025-10-01', 'lte': '2025-10-01'}} (use a specific date like latest available). If that date returns fewer resorts than expected (e.g., user says there are 1353 resorts but you only get 11), query WITHOUT date filter and deduplicate by resort_name in your response to get ALL unique resorts. NEVER return multiple daily records for the same resort when user asks for 'resorts' - always show unique resort names. When asked for 'resorts' WITHOUT specifications, use query_table with table: 'fact_resort' and a date filter (or without date filter if you need all unique resorts). When asked WITH specifications (theme, region, etc.), ALWAYS add a date filter to the filters object: {'resort_theme': {'operator': 'ilike', 'value': 'Beach'}, 'activity_date': {'gte': '2025-10-01', 'lte': '2025-10-01'}}. For date ranges, use column names: 'date_joined' (NOT 'joining_date') for fact_member, 'activity_date' for fact_resort, 'event_date' for fact_event, 'feedback_date' (NOT 'log_date') for fact_feedback. CRITICAL FORMAT: 'filters' MUST be an OBJECT (not an array). Examples: Simple equality: {'membership_tier': 'Red'}. With operator: {'membership_tier': {'operator': 'eq', 'value': 'Red'}}. Date range: {'date_joined': {'gte': '2018-01-01', 'lte': '2018-12-31'}}. Multiple filters: {'membership_tier': 'Red', 'is_active': true}. FOR RESORT FILTERING: When user asks for resorts WITH specifications (theme, region, location, etc.), use filters. Use 'resort_theme' to filter by theme (e.g., 'Beach', 'Hill Station', 'Waterpark') - use 'ilike' for partial matching: {'resort_theme': {'operator': 'ilike', 'value': 'Beach'}}. Use 'resort_region' to filter by region (e.g., 'West', 'South', 'North', 'East'): ALWAYS use 'ilike' for case-insensitive matching: {'resort_region': {'operator': 'ilike', 'value': 'East'}} or {'resort_region': {'operator': 'ilike', 'value': 'north'}} (works with any case variation). Use 'resort_location' to filter by location/state (e.g., 'Maharashtra', 'Goa'): ALWAYS use 'ilike' for case-insensitive matching: {'resort_location': {'operator': 'ilike', 'value': 'Maharashtra'}} or {'resort_location': {'operator': 'ilike', 'value': 'goa'}}. CRITICAL: 'resort_location' is for location/state (Maharashtra, Goa), 'resort_region' is for region (West, South, North, East). ALWAYS add date filter: {'resort_location': {'operator': 'ilike', 'value': 'Maharashtra'}, 'activity_date': {'gte': '2025-10-01', 'lte': '2025-10-01'}}. Use 'resort_name' with 'ilike' operator for case-insensitive matching: {'resort_name': {'operator': 'ilike', 'value': 'Assanora'}}. Combine multiple filters: {'resort_theme': {'operator': 'ilike', 'value': 'Beach'}, 'resort_region': {'operator': 'eq', 'value': 'West'}, 'activity_date': {'gte': '2025-09-01', 'lte': '2025-09-30'}}. DO NOT use array format like [{'column': '...', 'operator': '...', 'value': '...'}]. DO NOT use 'group_by', 'metrics', 'join', or 'columns' parameters - these are NOT supported. For demographic questions like 'Which gender members give us the most positive feedback?', use 'insights_feedback_demographics' instead. For feedback questions like 'What was the feedback on [resort] in [month]?': Use query_table with table: 'fact_feedback', filters: {'resort_name': {'operator': 'ilike', 'value': '[resort_name]'}, 'feedback_date': {'gte': '[start_date]', 'lte': '[end_date]'}}. For sales/revenue analysis: Query fact_resort data for specific time periods/resorts, then query fact_event table for the same time period to find potential reasons (weather, competitor promotions, economic factors, local events). For feedback analysis: Query fact_feedback by resort_name (use 'ilike' for case-insensitive, NOT 'resort_name_fk'), feedback_date (NOT 'log_date'), or nps_score. For customer analysis: Query fact_member by membership_tier, region, or date_joined. For cross-referencing: Query resorts affected by events in a specific region/time, resorts with poor feedback, resorts attracting specific customer tiers. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          enum: ["fact_member", "fact_resort", "fact_feedback", "fact_event", "fact_member_aggregated", "fact_resort_aggregated"],
          description: "The table to query. MUST be one of: 'fact_member', 'fact_resort', 'fact_feedback', 'fact_event', 'fact_member_aggregated', 'fact_resort_aggregated'. Use aggregated tables (fact_member_aggregated, fact_resort_aggregated) for quick numerical queries like 'Total red members' or 'Sales in July in Acacia'. DO NOT use 'resorts', 'members', 'feedback', or 'events' - always use the 'fact_' prefix.",
        },
        filters: {
          type: "object",
          description:
            "Filter conditions as an OBJECT (key-value pairs), NOT an array. Examples: Simple equality: {'membership_tier': 'Red'}. With operator: {'membership_tier': {'operator': 'eq', 'value': 'Red'}}. Date range: {'date_joined': {'gte': '2018-01-01', 'lte': '2018-12-31'}}. Multiple filters: {'membership_tier': 'Red', 'is_active': true}. Supports operators: eq, gt, gte, lt, lte, like, ilike. DO NOT use array format [{'column': '...', 'operator': '...', 'value': '...'}].",
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
  {
    name: "insights_sales_root_cause",
    description:
      "Explain WHY sales were low for a month and/or a resort by combining resort performance, events, and recent feedback. Input: month ('YYYY-MM'), optional resort_name, optional region. Output: JSON summary with deltas vs previous month, key drivers (weather, competitor promos, local events), occupancy, and feedback themes. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM (e.g., '2025-09')" },
        resort_name: { type: "string" },
        region: { type: "string" }
      },
      required: ["month"]
    }
  },
  {
    name: "insights_events_impact",
    description:
      "Find which resorts' sales were affected by external events within a date range. Use for questions like 'From all negative events in [month] which resorts could have been affected by these events'. Input: start_date, end_date. Output: resorts in regions with negative events, including both confirmed impacts (revenue drop >5%) and potentially affected resorts. Lists all negative events (weather, competitor promos, economic news) in each region. Returns both 'impacted' (confirmed revenue drop) and 'potentially_affected' (resorts in event regions). Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" }
      },
      required: ["start_date","end_date"]
    }
  },
  {
    name: "insights_feedback_drag",
    description:
      "Identify resorts where negative feedback in previous months correlates with next-month sales decline. Input: month ('YYYY-MM') of the SALES month to evaluate. Output: resorts, feedback themes, and magnitude of decline. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: { month: { type: "string" } },
      required: ["month"]
    }
  },
  {
    name: "insights_surge_forecast",
    description:
      "Heuristic forecast of upcoming booking surges using recent trends (revenue, occupancy), improving sentiment, and benign events. Input: month ('YYYY-MM') to forecast. Output: JSON with 'forecast' array (resorts expected to surge with 'key_drivers' explaining why), and 'summary' with total count and top forecasted resort. Includes resorts with positive trends, stable performance with low negatives, good sentiment (more positive than negative feedback), or minimal decline. Only excludes resorts with major negative events AND strong declining trends. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: { month: { type: "string" } },
      required: ["month"]
    }
  },
  {
    name: "insights_red_tier_attraction",
    description:
      "Rank resorts that attract Red tier customers using member tier and activity/feedback proxies. Optional date range. Output: resorts ordered by Red-tier engagement counts. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: { start_date: { type: "string" }, end_date: { type: "string" } }
    }
  },
  {
    name: "insights_red_tier_poor_feedback",
    description:
      "Find resorts with poor feedback from Red tier customers and summarize their main issues. Optional date range. Output: resorts with negative feedback snippets and themes. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: { start_date: { type: "string" }, end_date: { type: "string" } }
    }
  },
  {
    name: "insights_blue_tier_feedback",
    description:
      "Find resorts with feedback from Blue tier customers. Use for questions like 'Which resorts have got most negative feedback from blue tier customers'. Optional date range. Output: resorts with feedback from Blue tier customers, including negative feedback count and themes. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: { start_date: { type: "string" }, end_date: { type: "string" } }
    }
  },
  {
    name: "insights_resort_feedback_analysis",
    description:
      "Analyze feedback for a specific resort within a date range. Use for questions like 'What was the feedback on [resort] in [month]?', 'What is the negative/positive feedback for [resort] in [month]?', 'What are the top 3 feedback themes for [resort]?'. Provides comprehensive feedback analysis including sentiment breakdown, key themes (top 3 positive and negative), NPS/CSAT scores, and sample quotes. Input: resort_name (required), date_range with start and end (required, format: YYYY-MM-DD). Example: For 'What was the feedback on Assonora in September 2025': Use with resort_name: 'Assonora', date_range: {start: '2025-09-01', end: '2025-09-30'}. Output: JSON summary with feedback statistics, top themes (positive_themes, negative_themes), and insights. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        resort_name: { type: "string", description: "Resort name (e.g., 'Assanora')" },
        date_range: {
          type: "object",
          properties: {
            start: { type: "string", description: "Start date (YYYY-MM-DD)" },
            end: { type: "string", description: "End date (YYYY-MM-DD)" }
          },
          required: ["start", "end"]
        }
      },
      required: ["resort_name", "date_range"]
    }
  },
  {
    name: "insights_member_lifetime_value",
    description:
      "Analyze member lifetime value (LTV) by region, membership tier, or date joined. Identifies high-value segments, average LTV trends, and members at risk. Returns explicit highest_ltv_tier and lowest_ltv_tier fields to answer questions about maximum and minimum spenders by tier. Optional filters: region, membership_tier, start_date, end_date. Output: JSON with LTV statistics, by_tier analysis (sorted by average LTV descending), by_region analysis, highest_ltv_tier, lowest_ltv_tier, and at_risk_members. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string" },
        membership_tier: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_regional_performance",
    description:
      "Compare resort performance across regions. Analyzes revenue, occupancy, and trends by region. Optional date range. Output: JSON with regional rankings, revenue/occupancy comparisons, and trend analysis. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_resort_theme_analysis",
    description:
      "Analyze performance by resort theme (Beach, Waterpark, etc.). Compares revenue, occupancy, and popularity across themes. Optional date range. Output: JSON with theme rankings, revenue analysis, and occupancy trends. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_revenue_stream_analysis",
    description:
      "Analyze revenue streams (ancillary vs restaurant) across resorts or regions. Identifies best revenue mix, growth trends, and opportunities. Optional filters: resort_name, region, start_date, end_date. Output: JSON with revenue breakdown, mix analysis, and growth trends. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        resort_name: { type: "string" },
        region: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_competitor_impact",
    description:
      "Analyze impact of competitor promotions on resort sales. Identifies which resorts are most affected by competitor events and quantifies revenue impact. Optional date range. Output: JSON with affected resorts, revenue impact, and competitor event details. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_weather_impact",
    description:
      "Analyze how weather conditions affect resort performance. Correlates weather events with revenue and occupancy changes. Input: start_date, end_date (YYYY-MM-DD format, required for meaningful results - use date range covering all available data like '2025-07-01' to '2025-10-31'). Output: JSON with weather-impacted resorts, performance changes, and weather event details. For questions like 'Which month saw the maximum weather events?', first query fact_event table with filters for weather events across the full date range, then group by month to count events per month. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_platform_issue_analysis",
    description:
      "Analyze feedback and issues by platform/channel (Android, email, etc.). Identifies which platforms have most issues, best/worst feedback, and platform-specific trends. Optional date range. Output: JSON with platform breakdown, issue rates, and feedback quality. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_issue_type_trends",
    description:
      "Analyze issue type trends across resorts. Identifies most common issues, increasing problem types, and resorts with most issues. Optional filters: resort_name, start_date, end_date. Output: JSON with issue type breakdown, trends, and resort rankings. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        resort_name: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" }
      }
    }
  },
  {
    name: "insights_member_churn_risk",
    description:
      "Identify members at risk of churning based on inactivity, low LTV, poor feedback, payment issues, and lack of recent holidays. Output: JSON with at-risk members, risk factors, and recommendations. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        risk_level: { type: "string", enum: ["high", "medium", "low"], description: "Filter by risk level" }
      }
    }
  },
  {
    name: "insights_resort_performance_ranking",
    description:
      "Rank resorts by multiple metrics (revenue, occupancy, feedback quality, member satisfaction). Provides comprehensive performance scoring. Optional date range. Output: JSON with resort rankings, scores, and metric breakdowns. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" },
        metric: { type: "string", enum: ["revenue", "occupancy", "feedback", "overall"], description: "Primary ranking metric" }
      }
    }
  },
  {
    name: "insights_seasonal_trends",
    description:
      "Identify seasonal patterns in bookings, revenue, and feedback. Analyzes month-over-month trends, peak seasons, and seasonal variations. Optional year filter. Output: JSON with seasonal patterns, peak periods, and trend analysis. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "string", description: "Year to analyze (e.g., '2025')" }
      }
    }
  },
  {
    name: "insights_monthly_sales_comparison",
    description:
      "Compare sales between two months to identify resorts with revenue changes (both increases and decreases). Input: month1 ('YYYY-MM'), month2 ('YYYY-MM'). Output: JSON with resorts showing revenue changes in month2 compared to month1, with revenue deltas and percentage changes. Includes both 'resorts_with_low_sales' (decline) and 'resorts_with_increased_sales' (increase). Use for questions like 'Which resorts showed decline/increase in revenue from September to October 2025' or 'Which resorts show decline/increase in revenue between 2 months'. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        month1: { type: "string", description: "First month to compare (YYYY-MM, e.g., '2025-09')" },
        month2: { type: "string", description: "Second month to compare (YYYY-MM, e.g., '2025-10')" }
      },
      required: ["month1", "month2"]
    }
  },
  {
    name: "insights_resort_revenue_reasons",
    description:
      "Analyze reasons for revenue changes (both increase and decrease) for a specific resort in a specific month. Combines resort performance data, events, and feedback to identify root causes. Input: resort_name, month ('YYYY-MM'). Output: JSON with revenue_comparison (showing previous_month, current_month, delta_inr, percentage_change), identified_reasons array (events, feedback, occupancy), events array, negative_feedback_count, negative_feedback_themes, and positive reasons if revenue increased. Shows both negative reasons (for decline) and positive reasons (for increase). IMPORTANT: Before using this tool for 'What negative feedback caused revenue decline' questions, first verify there was actually a decline using insights_monthly_sales_comparison. If there was no decline, state that clearly. Use for questions like 'What negative feedback or negative external events caused a revenue decline for Saj from September to October 2025' or 'What positive feedback or positive external events caused a revenue increase for Assonora from September to October 2025'. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        resort_name: { type: "string", description: "Name of the resort (e.g., 'Acacia Palms')" },
        month: { type: "string", description: "Month to analyze (YYYY-MM, e.g., '2025-10')" }
      },
      required: ["resort_name", "month"]
    }
  },
  {
    name: "insights_revenue_feedback_correlation",
    description:
      "Identify resorts where lower revenue in a month correlates with negative feedback from previous months. Input: month ('YYYY-MM') of the revenue month to evaluate. For general correlation questions like 'What is correlation between negative feedback and loss in revenue' or 'How much does each negative feedback cost us', analyze multiple months (e.g., July, August, September, October 2025) to identify patterns across the dataset. Output: JSON with resorts showing revenue decline (revenue_decline_inr), associated negative feedback themes, negative_feedback_count, and correlation strength. For cost calculations: Sum revenue_decline_inr across all months/resorts, sum negative_feedback_count, then divide to get cost per feedback. Use for questions like 'Which resorts saw a lower revenue in a month with a co-relation to negative feedback'. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month to analyze (YYYY-MM, e.g., '2025-10')" }
      },
      required: ["month"]
    }
  },
  {
    name: "insights_unpaid_asf_feedback",
    description:
      "Find feedback from members who have not paid Annual Subscription Fee (ASF) for 2 years. Identifies members with unpaid ASF for 2+ years by filtering fact_member table where annual_asf_fee_missed_years > 2, then retrieves their feedback. Output: JSON with member details including annual_asf_fee_missed_years, ASF payment status, total feedback count, negative feedback count, and their complaints/feedback (if any). Use for questions like 'Is there any negative feedback from members who have not paid ASF for 2 years, what is it' or 'Those members who have not paid ASF for 2 or more years what are their complaints' or 'Which members have not paid their ASF for 2 years'. Returns all feedback (not just negative) but highlights negative feedback separately. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "insights_resort_event_decline",
    description:
      "Identify external events that led to revenue decline for a specific resort, or find all events for a specific month/period. Analyzes events in the resort's region/time period and correlates with revenue drops. Input: resort_name (required), optional month ('YYYY-MM' format) to get all events for that specific month even if there's no revenue decline. Output: JSON with events affecting the resort, revenue impact, and event details. If month is specified, also returns all_events_for_month array with all events for that month regardless of revenue impact. Use for questions like 'What external events led to decline in revenue for Saj resort' or 'Did any weather events or traffic events cause disruption in Saj in Sept 2025'. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        resort_name: { type: "string", description: "Name of the resort (e.g., 'Saj')" },
        month: { type: "string", description: "Optional: Specific month to analyze (YYYY-MM format, e.g., '2025-09'). If provided, returns all events for that month even if there's no revenue decline." }
      },
      required: ["resort_name"]
    }
  },
  {
    name: "insights_feedback_demographics",
    description:
      "Analyze feedback by demographic dimensions (gender, region, age_group) and sentiment. Performs multi-table analysis joining feedback with member data. Input: sentiment ('positive', 'negative', 'neutral', or omit for all), dimension ('gender', 'member_region', 'age_group', or omit for all). Optional: start_date, end_date (YYYY-MM-DD format). Output: JSON with breakdown by dimension showing count and percentage of feedback. Use for questions like 'Which gender members give us the most positive feedback?', 'Which region customers have given the most positive feedback?', 'Which age group members have given us the most negative feedback?'. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        sentiment: {
          type: "string",
          enum: ["positive", "negative", "neutral"],
          description: "Filter feedback by sentiment (optional)"
        },
        dimension: {
          type: "string",
          enum: ["gender", "member_region", "age_group"],
          description: "Demographic dimension to analyze (optional, if omitted returns all dimensions)"
        },
        start_date: {
          type: "string",
          description: "Start date for feedback filter (YYYY-MM-DD format, optional)"
        },
        end_date: {
          type: "string",
          description: "End date for feedback filter (YYYY-MM-DD format, optional)"
        }
      }
    }
  }
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
        // If limit is not provided, set a high limit to get all records
        // Supabase default limit might be low, so we set a high limit for "all" queries
        if (args?.limit) {
          memberParams.limit = String(args.limit);
        } else {
          // Set high limit for "all" queries (Supabase max is typically 1000, but we'll use 10000)
          memberParams.limit = "10000";
        }
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
        if (args?.limit) {
          resortParams.limit = String(args.limit);
        } else {
          resortParams.limit = "10000";
        }
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
        if (args?.limit) {
          feedbackParams.limit = String(args.limit);
        } else {
          feedbackParams.limit = "10000";
        }
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

      // COMMENTED OUT: Old get_events handler using Supabase fact_event table
      // case "get_events": {
      //   const eventParams: Record<string, string> = {};
      //   if (args?.limit) {
      //     eventParams.limit = String(args.limit);
      //   } else {
      //     eventParams.limit = "10000";
      //   }
      //   if (args?.order) eventParams.order = String(args.order);
      //   if (args?.select) eventParams.select = String(args.select);

      //   const data = await querySupabaseTable("fact_event", eventParams);
      //   return {
      //     content: [
      //       {
      //         type: "text",
      //         text: JSON.stringify(data, null, 2),
      //       },
      //     ],
      //   };
      // }

      case "get_events": {
        const { query, start_date, end_date, count = 5, country = "IN" } = args as {
          query: string;
          start_date?: string;
          end_date?: string;
          count?: number;
          country?: string;
        };

        if (!query) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Query parameter is required" }, null, 2),
              },
            ],
          };
        }

        // Build YDC API URL
        const ydcUrl = new URL("https://ydc-index.io/v1/search");
        ydcUrl.searchParams.append("query", query);
        ydcUrl.searchParams.append("count", String(count));
        ydcUrl.searchParams.append("safesearch", "strict");
        ydcUrl.searchParams.append("livecrawl", "all");
        
        if (country) {
          ydcUrl.searchParams.append("country", country);
        }

        // Add freshness date range if provided
        if (start_date && end_date) {
          // Format: YYYY-MM-DD to YYYY-MM-DD (e.g., "2025-10-01to2025-10-31")
          ydcUrl.searchParams.append("freshness", `${start_date}to${end_date}`);
        } else if (start_date) {
          // If only start_date provided, use it as both start and end
          ydcUrl.searchParams.append("freshness", `${start_date}to${start_date}`);
        } else if (end_date) {
          // If only end_date provided, use it as both start and end
          ydcUrl.searchParams.append("freshness", `${end_date}to${end_date}`);
        }

        try {
          const response = await fetch(ydcUrl.toString(), {
            method: "GET",
            headers: {
              "X-API-Key": "ydc-sk-ab00c889ec8faa3f-8DIVRUMJAVKnyNEJ6pDOpOW9Z8Hw0Se5-0a3e037d",
            },
          });

          if (!response.ok) {
            throw new Error(`YDC API error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Failed to fetch events from YDC API",
                    message: error.message || String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case "get_member_aggregated": {
        const memberAggParams: Record<string, string> = {};
        if (args?.limit) {
          memberAggParams.limit = String(args.limit);
        } else {
          memberAggParams.limit = "10000";
        }
        if (args?.order) memberAggParams.order = String(args.order);
        if (args?.select) memberAggParams.select = String(args.select);

        const data = await querySupabaseTable("fact_member_aggregated", memberAggParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "get_resort_aggregated": {
        const resortAggParams: Record<string, string> = {};
        if (args?.limit) {
          resortAggParams.limit = String(args.limit);
        } else {
          resortAggParams.limit = "10000";
        }
        if (args?.order) resortAggParams.order = String(args.order);
        if (args?.select) resortAggParams.select = String(args.select);

        const data = await querySupabaseTable("fact_resort_aggregated", resortAggParams);
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
        const { table, operation, field, column, filters, aggregation } = args as {
          table: string;
          operation: string;
          field?: string;
          column?: string;
          filters?: Record<string, any>;
          aggregation?: string;
        };

        if (!table || !operation) {
          throw new Error("Table and operation are required");
        }

        // Accept both 'field' and 'column' for backward compatibility
        // Also ignore 'aggregation' parameter as it's not needed (operation already specifies it)
        const fieldName = field || column;
        
        // For aggregate operations, field is required
        if (operation === "aggregate" && !fieldName) {
          throw new Error("Field is required for aggregate operation (use 'field' or 'column' parameter)");
        }

        const result = await performAnalyticalQuery(table, operation, fieldName, filters);
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
        const { table, table_name, filters, limit, order, group_by, metrics, join, columns } = args as {
          table?: string;
          table_name?: string;
          filters?: Record<string, any>;
          limit?: number;
          order?: string;
          group_by?: any;
          metrics?: any;
          join?: any;
          columns?: any;
        };

        // Accept both 'table' and 'table_name' for backward compatibility
        const tableName = table || table_name;
        if (!tableName) {
          throw new Error("Table name is required (use 'table' or 'table_name' parameter)");
        }

        // Reject unsupported parameters and suggest correct tool
        if (group_by || metrics || join) {
          if (tableName === "fact_feedback" && (group_by || metrics)) {
            throw new Error("query_table does NOT support 'group_by' or 'metrics' parameters. For demographic analysis questions (e.g., 'Which gender members give us the most positive feedback?'), use 'insights_feedback_demographics' tool instead. For counting or aggregating, use 'analyze_data' tool instead.");
          }
          throw new Error("query_table does NOT support 'group_by', 'metrics', or 'join' parameters. For demographic analysis, use 'insights_feedback_demographics'. For counting/aggregating, use 'analyze_data'.");
        }

        if (columns) {
          throw new Error("query_table does NOT support 'columns' parameter. Use 'select' parameter in 'get_*' tools or query all columns by omitting this parameter.");
        }

        // Validate filters format - must be an object, not an array
        if (filters && Array.isArray(filters)) {
          throw new Error("Invalid filters format: 'filters' must be an object (key-value pairs), not an array. Example: {'membership_tier': 'Red'} or {'membership_tier': {'operator': 'eq', 'value': 'Red'}}. DO NOT use array format like [{'column': '...', 'operator': '...', 'value': '...'}].");
        }

        const queryParams: Record<string, string> = {};
        if (limit) {
          queryParams.limit = String(limit);
        } else {
          // Set high limit for "all" queries
          queryParams.limit = "10000";
        }
        if (order) queryParams.order = String(order);

        // Build filter query string if filters provided
        // Supports PostgREST syntax: eq, neq, gt, gte, lt, lte, like, ilike, is, in
        // Also supports date ranges with gte and lte in same object
        if (filters && typeof filters === 'object' && !Array.isArray(filters) && Object.keys(filters).length > 0) {
          Object.entries(filters).forEach(([key, value]) => {
            // If value is an object with operator, use it (e.g., {operator: 'gt', value: 100})
            if (typeof value === 'object' && value !== null && 'operator' in value) {
              const op = (value as any).operator || 'eq';
              let val = (value as any).value;
              // Automatically add wildcards for ilike and like operators for partial matching
              if ((op === 'ilike' || op === 'like') && typeof val === 'string') {
                // Only add wildcards if they're not already present
                if (!val.startsWith('%')) val = '%' + val;
                if (!val.endsWith('%')) val = val + '%';
              }
              queryParams[key] = `${op}.${val}`;
            } 
            // Handle date ranges: {gte: "2018-01-01", lte: "2018-12-31"}
            // Supabase PostgREST format: field=gte.value1&field=lte.value2
            else if (typeof value === 'object' && value !== null && ('gte' in value || 'lte' in value || 'gt' in value || 'lt' in value)) {
              // Handle multiple operators on same field (date ranges)
              // Store them with the field name as key, we'll handle them in querySupabaseTable
              if ('gte' in value) {
                queryParams[`${key}.gte`] = String(value.gte);
              }
              if ('lte' in value) {
                queryParams[`${key}.lte`] = String(value.lte);
              }
              if ('gt' in value) {
                queryParams[`${key}.gt`] = String(value.gt);
              }
              if ('lt' in value) {
                queryParams[`${key}.lt`] = String(value.lt);
              }
            } else {
              // Default to equality
              queryParams[key] = `eq.${value}`;
            }
          });
        }

        const data = await querySupabaseTable(tableName, queryParams);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "insights_sales_root_cause": {
        const { month, resort_name, region } = args as { month: string; resort_name?: string; region?: string };
        const curr = monthRange(month);
        const prevYm = previousMonth(month);
        const prev = monthRange(prevYm);

        const resortFiltersCurr: Record<string, any> = { activity_date: { gte: curr.start, lte: curr.end } };
        const resortFiltersPrev: Record<string, any> = { activity_date: { gte: prev.start, lte: prev.end } };
        if (resort_name) { resortFiltersCurr.resort_name = { operator: "ilike", value: resort_name }; resortFiltersPrev.resort_name = { operator: "ilike", value: resort_name }; }
        if (region) { resortFiltersCurr.resort_region = { operator: "ilike", value: region }; resortFiltersPrev.resort_region = { operator: "ilike", value: region }; }

        const resortsCurr = await querySupabaseTable("fact_resort", buildQuery(resortFiltersCurr));
        const resortsPrev = await querySupabaseTable("fact_resort", buildQuery(resortFiltersPrev));

        const roll = (rows: any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            const sum = (f: string) => arr.reduce((a:any,r:any)=>a+safeNumber(r[f]),0);
            const avg = (f: string) => arr.length ? sum(f)/arr.length : 0;
            out[k] = {
              total_revenue_inr: sum("total_revenue_inr"),
              occupancy_rate_avg: avg("occupancy_rate_perc"),
              member_rooms_booked: sum("member_rooms_booked"),
              total_rooms_available: sum("total_rooms_available"),
              region: arr[0]?.resort_region ?? null
            };
          }
          return out;
        };

        const A = roll(resortsCurr);
        const B = roll(resortsPrev);

        const regions = Array.from(new Set(Object.values(A).map((x:any)=>x.region).filter(Boolean) as string[]));
        const events = await querySupabaseTable("fact_event", buildQuery({
          event_date: { gte: curr.start, lte: curr.end },
          ...(regions.length ? { impact_region: { operator: "in", value: regions } } : {})
        }));

        const prev2Ym = previousMonth(prevYm);
        const prev2 = monthRange(prev2Ym);
        const feedback = await querySupabaseTable("fact_feedback", buildQuery({
          feedback_date: { gte: prev2.start, lte: prev.end },
          ...(resort_name ? { resort_name: { operator: "ilike", value: resort_name } } : {})
        }));

        const feedbackByResort = groupBy(feedback, (f:any)=>f.resort_name || "Unknown");
        const eventsByRegion = groupBy(events, (e:any)=>e.impact_region || "Unknown");

        const result: any[] = [];
        for (const [resort, cur] of Object.entries(A)) {
          const prevv = B[resort] || { total_revenue_inr:0, occupancy_rate_avg:0, member_rooms_booked:0, total_rooms_available:0, region:null };
          const revDelta = safeNumber((cur as any).total_revenue_inr) - safeNumber(prevv.total_revenue_inr);
          const occDelta = safeNumber((cur as any).occupancy_rate_avg) - safeNumber(prevv.occupancy_rate_avg);
          const regionKey = (cur as any).region || "Unknown";
          const evts = eventsByRegion[regionKey] || [];
          const fbs = feedbackByResort[resort] || [];
          const negF = fbs.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3);
          const fbThemes = topKeywords(negF.map((x:any)=>x.issue_details_text || x.details_text || ""), 6);

          result.push({
            resort_name: resort,
            month,
            region: regionKey,
            revenue_current_inr: (cur as any).total_revenue_inr,
            revenue_prev_inr: prevv.total_revenue_inr,
            revenue_delta_inr: revDelta,
            occupancy_current_perc: (cur as any).occupancy_rate_avg,
            occupancy_prev_perc: prevv.occupancy_rate_avg,
            occupancy_delta_perc: occDelta,
            likely_drivers: {
              events_count: evts.length,
              event_samples: evts.slice(0,5).map((e:any)=>({
                event_type:e.event_type, date:e.event_date,
                weather_condition:e.weather_condition, competitor_name:e.competitor_name,
                details:e.details_description, relevance_score:e.relevance_score
              })),
              negative_feedback_count: negF.length,
              negative_feedback_themes: fbThemes
            }
          });
        }

        return { content: [{ type: "text", text: JSON.stringify({ summary: result }, null, 2) }] };
      }

      case "insights_events_impact": {
        const { start_date, end_date } = args as { start_date: string; end_date: string };
        const events = await querySupabaseTable("fact_event", buildQuery({ event_date: { gte: start_date, lte: end_date } }));
        
        // Filter for negative events (weather, competitor promos, economic news, etc.)
        // If no specific negative types found, include all events as potentially negative
        const negativeEvents = (events || []).filter((e:any) => {
          const eventType = (e.event_type || "").toLowerCase();
          return eventType.includes("weather") || 
                 eventType.includes("competitor") || 
                 eventType.includes("economic") ||
                 eventType.includes("negative") ||
                 (e.relevance_score && safeNumber(e.relevance_score) > 5) ||
                 // If no events match, include all events (they might all be negative)
                 (events.length > 0 && events.every((ev:any) => {
                   const et = (ev.event_type || "").toLowerCase();
                   return !et.includes("weather") && !et.includes("competitor") && !et.includes("economic");
                 }));
        });
        
        // If filtered list is empty but events exist, use all events
        const finalEvents = negativeEvents.length > 0 ? negativeEvents : (events || []);
        
        const byRegion = groupBy(finalEvents, (e:any)=>e.impact_region || "Unknown");

        const resorts = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: start_date, lte: end_date } }));

        // previous window of equal length
        const start = new Date(start_date); const end = new Date(end_date);
        const days = Math.ceil((end.getTime() - start.getTime())/86400000)+1;
        const prevStart = new Date(start.getTime()-days*86400000).toISOString().slice(0,10);
        const prevEnd = new Date(start.getTime()-86400000).toISOString().slice(0,10);
        const resortsPrev = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: prevStart, lte: prevEnd } }));

        const rollByResort = (rows:any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
              region: arr[0]?.resort_region ?? null,
              occupancy_avg: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupied_percentage || r.occupancy_rate_perc),0)/(arr.length||1)
            };
          }
          return out;
        };

        const A = rollByResort(resorts);
        const B = rollByResort(resortsPrev);

        const impacted: any[] = [];
        const potentiallyAffected: any[] = [];
        
        // Get all unique regions with events
        const regionsWithEvents = Object.keys(byRegion);
        
        for (const [resort, cur] of Object.entries(A)) {
          const prev = B[resort] || { revenue: 0, occupancy_avg: 0, region: null };
          const delta = safeNumber((cur as any).revenue) - safeNumber(prev.revenue);
          const region = (cur as any).region || "Unknown";
          const evts = byRegion[region] || [];
          const drop = prev.revenue ? delta/prev.revenue : 0;
          
          // If resort is in a region with negative events, include it
          if (evts.length > 0) {
            const resortData = {
              resort_name: resort,
              region,
              revenue_prev_inr: prev.revenue,
              revenue_curr_inr: (cur as any).revenue,
              change_pct: prev.revenue ? +((delta/prev.revenue)*100).toFixed(1) : 0,
              occupancy_change: +((cur as any).occupancy_avg - prev.occupancy_avg).toFixed(1),
              events: evts.map((e:any)=>({
                date:e.event_date, 
                type:e.event_type, 
                weather:e.weather_condition,
                competitor:e.competitor_name, 
                details:e.details_description || e.event_details_description, 
                relevance_score:e.relevance_score || e.event_relevance_score
              }))
            };
            
            // If revenue dropped significantly, mark as confirmed impact
            if (drop < -0.05) {
              impacted.push(resortData);
            } else {
              // Otherwise, mark as potentially affected
              potentiallyAffected.push(resortData);
            }
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ 
          impacted: impacted.sort((a,b)=>a.change_pct - b.change_pct),
          potentially_affected: potentiallyAffected,
          summary: {
            total_events: finalEvents.length,
            regions_with_events: regionsWithEvents,
            confirmed_impact: impacted.length,
            potentially_affected_count: potentiallyAffected.length
          }
        }, null, 2) }] };
      }

      case "insights_feedback_drag": {
        const { month } = args as { month: string };
        const curr = monthRange(month);
        const prevYm = previousMonth(month);
        const prev = monthRange(prevYm);

        const resortsCurr = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: curr.start, lte: curr.end } }));
        const resortsPrev = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: prev.start, lte: prev.end } }));

        const roll = (rows:any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            const sum = (f:string)=>arr.reduce((a:any,r:any)=>a+safeNumber(r[f]),0);
            out[k] = { revenue: sum("total_revenue_inr"), region: arr[0]?.resort_region ?? null };
          }
          return out;
        };

        const A = roll(resortsCurr);
        const B = roll(resortsPrev);

        // Look back 1–2 months feedback (prev-1, prev-2)
        const prev2Ym = previousMonth(prevYm);
        const prev2 = monthRange(prev2Ym);
        const fb = await querySupabaseTable("fact_feedback", buildQuery({
          log_date: { gte: prev2.start, lte: prev.end }
        }));
        const fbByResort = groupBy(fb, (x:any)=>x.resort_name || "Unknown");

        const impacted: any[] = [];
        for (const [resort, cur] of Object.entries(A)) {
          const prevv = B[resort] || { revenue: 0 };
          const delta = safeNumber((cur as any).revenue) - safeNumber(prevv.revenue);
          const dropPct = prevv.revenue ? (delta/prevv.revenue)*100 : 0;
          if (dropPct < -5) {
            const fbs = fbByResort[resort] || [];
            const neg = fbs.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3);
            impacted.push({
              resort_name: resort,
              revenue_prev_inr: prevv.revenue,
              revenue_curr_inr: (cur as any).revenue,
              change_pct: +dropPct.toFixed(1),
              negative_feedback_count: neg.length,
              themes: topKeywords(neg.map((x:any)=>x.issue_details_text || x.details_text || ""), 6)
            });
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ impacted }, null, 2) }] };
      }

      case "insights_surge_forecast": {
        const { month } = args as { month: string };
        // Use previous two months as trend, plus recent feedback and events in forecast month (lack of negatives)
        const prevYm = previousMonth(month);
        const prev2Ym = previousMonth(prevYm);

        const r1 = monthRange(prev2Ym);
        const r2 = monthRange(prevYm);
        const forecastWindow = monthRange(month);

        const res1 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r1.start, lte: r1.end } })) || [];
        const res2 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r2.start, lte: r2.end } })) || [];
        
        // If res2 is empty (future month like November doesn't exist), compare September (r1) to October (r1)
        // Otherwise, compare October (r1) to November (r2)
        let olderData = res1;
        let recentData = res2;
        
        // If November doesn't exist, we need to go back one more month for comparison
        if (res2.length === 0 && res1.length > 0) {
          // Compare September (prev2Ym) to October (prevYm)
          const prev3Ym = previousMonth(prev2Ym);
          const r0 = monthRange(prev3Ym);
          olderData = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r0.start, lte: r0.end } })) || [];
          recentData = res1; // October becomes the recent data
        }

        const roll = (rows:any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = { 
              revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0), 
              occupancy_avg: arr.length ? arr.reduce((a:any,r:any)=>a+safeNumber(r.occupied_percentage || r.occupancy_rate_perc),0)/arr.length : 0, 
              region: arr[0]?.resort_region ?? null 
            };
          }
          return out;
        };

        const A = roll(olderData); // older
        const B = roll(recentData); // recent (or same as older if future month)
        const events = await querySupabaseTable("fact_event", buildQuery({ event_date: { gte: forecastWindow.start, lte: forecastWindow.end } }));
        const fb = await querySupabaseTable("fact_feedback", buildQuery({ feedback_date: { gte: r2.start, lte: forecastWindow.start } }));

        const evByRegion = groupBy(events, (e:any)=>e.impact_region || "Unknown");
        const fbByResort = groupBy(fb, (x:any)=>x.resort_name || "Unknown");

        const forecast: any[] = [];
        for (const [resort, newer] of Object.entries(B)) {
          const older = A[resort] || { revenue: 0, occupancy_avg: 0, region: null };
          const trendRevPct = older.revenue ? ((newer as any).revenue - older.revenue)/older.revenue : 0;
          const trendOcc = safeNumber((newer as any).occupancy_avg) - safeNumber(older.occupancy_avg);

          const region = (newer as any).region || "Unknown";
          const evts = evByRegion[region] || [];
          const hasNegativeEvent = evts.some((e:any)=> {
            const et = String(e.event_type || "").toLowerCase();
            return et.includes("weather") || et.includes("economic") || et.includes("competitor");
          });

          const fbs = fbByResort[resort] || [];
          const negCount = fbs.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3).length;
          const posCount = fbs.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="positive") || safeNumber(x.nps_score) >= 7 || safeNumber(x.csat_score) >= 4).length;

          // Heuristic: rising revenue OR occupancy + low negatives + no adverse forecast events
          // Also consider resorts with improving trends even if not perfect
          // For December forecast, we're comparing Oct (older) vs Nov (recent), or Sep vs Oct if Nov doesn't exist
          const hasPositiveTrend = trendRevPct > 0.01 || trendOcc > 0.3 || (trendRevPct > 0 && trendOcc > 0);
          const hasLowNegatives = negCount <= 8; // More lenient - allow up to 8 negative feedback
          // Don't exclude resorts just because there are events - events might not affect all resorts equally
          // Only exclude if there are MAJOR negative events AND the resort has declining trends
          const hasMajorNegativeEvents = hasNegativeEvent && (trendRevPct < -0.05 || trendOcc < -2);
          const hasPositiveFeedback = posCount > negCount; // More positive than negative
          
          // Include resorts with:
          // 1. Positive trend (revenue or occupancy growth)
          // 2. Stable performance with low negatives
          // 3. More positive feedback than negative (good sentiment)
          // 4. Any resort with low negatives and no major declining trend
          const isStableWithLowNegatives = trendRevPct >= -0.05 && trendOcc >= -1 && negCount <= 5;
          const hasGoodSentiment = hasPositiveFeedback && negCount <= 5;
          const hasMinimalDecline = trendRevPct >= -0.10 && trendOcc >= -2 && negCount <= 5; // Small decline is okay
          
          // Include if: positive trend OR stable with low negatives OR good sentiment OR minimal decline
          // AND not excluded by major negative events with strong decline
          if ((hasPositiveTrend || isStableWithLowNegatives || hasGoodSentiment || hasMinimalDecline) && hasLowNegatives && !hasMajorNegativeEvents) {
            const drivers: string[] = [];
            if (trendRevPct > 0.01) drivers.push(`Revenue growth of ${(trendRevPct*100).toFixed(1)}%`);
            if (trendOcc > 0.3) drivers.push(`Occupancy increase of ${trendOcc.toFixed(1)}%`);
            if (trendRevPct >= -0.05 && trendOcc >= -1 && trendRevPct < 0.01 && trendOcc < 0.3) drivers.push(`Stable performance with low negatives`);
            if (hasPositiveFeedback) drivers.push(`More positive feedback (${posCount}) than negative (${negCount})`);
            if (negCount <= 2) drivers.push(`Very low negative feedback (${negCount})`);
            else if (negCount <= 5) drivers.push(`Low negative feedback (${negCount})`);
            if (evts.length === 0) drivers.push(`No negative events forecasted`);
            else if (!hasNegativeEvent) drivers.push(`No major negative events forecasted`);
            
            forecast.push({
              resort_name: resort,
              region,
              expected_surge: true,
              drivers: {
                trend_revenue_pct: +((trendRevPct)*100).toFixed(1),
                trend_occupancy_delta: +trendOcc.toFixed(1),
                recent_negative_feedback: negCount,
                notable_events_in_forecast_window: evts.length,
                key_drivers: drivers
              }
            });
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ 
          month,
          forecast: forecast.sort((a,b)=>b.drivers.trend_revenue_pct - a.drivers.trend_revenue_pct),
          summary: {
            total_resorts_forecasted: forecast.length,
            top_forecasted: forecast.length > 0 ? forecast[0] : null
          }
        }, null, 2) }] };
      }

      case "insights_red_tier_attraction": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const memberFilters: Record<string, any> = { membership_tier: { operator: "eq", value: "Red" } };
        if (start_date || end_date) memberFilters.date_joined = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        // We assume member records include a preferred_or_recent_resort field or mapping; if not, this will return tier counts only.
        const members = await querySupabaseTable("fact_member", buildQuery(memberFilters));

        // Try to bind by recent feedback/reference to a resort
        const fb = await querySupabaseTable("fact_feedback", buildQuery({
          ...(start_date || end_date ? { feedback_date: { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) } } : {}),
          // Only Red tier members if your feedback table contains member_id_fk
        }));

        // Aggregate by resort_name_fk from feedback as proxy for engagement
        const byResort = groupBy(fb.filter((x:any)=> x.membership_tier === "Red" || members.some((m:any)=> m.member_id === x.member_id_fk && m.membership_tier === "Red")), (x:any)=>x.resort_name || "Unknown");
        const ranking = Object.entries(byResort)
          .map(([resort, arr])=>({ resort_name: resort, red_tier_interactions: arr.length }))
          .sort((a,b)=>b.red_tier_interactions - a.red_tier_interactions);

        return { content: [{ type: "text", text: JSON.stringify({ ranking }, null, 2) }] };
      }

      case "insights_red_tier_poor_feedback": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const fbFilters: Record<string, any> = {};
        if (start_date || end_date) fbFilters.feedback_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };
        const fb = await querySupabaseTable("fact_feedback", buildQuery(fbFilters));

        // Filter to Red tier (assuming feedback carries membership_tier OR join to members if needed)
        const members = await querySupabaseTable("fact_member", buildQuery({ membership_tier: { operator: "eq", value: "Red" } }));
        const redFb = fb.filter((x:any)=> {
          const member = members.find((m:any)=> m.member_id === x.member_id_fk);
          return member && member.membership_tier === "Red";
        });
        const byResort = groupBy(redFb, (x:any)=>x.resort_name || "Unknown");

        const out = Object.entries(byResort).map(([resort, arr]) => {
          // Filter for negative feedback: sentiment is "negative" OR NPS <= 6 OR CSAT <= 3
          // Also exclude if sentiment is explicitly "positive" or scores indicate positive
          const neg = arr.filter((x:any)=> {
            const sentiment = x.sentiment ? String(x.sentiment).toLowerCase() : "";
            const nps = safeNumber(x.nps_score);
            const csat = safeNumber(x.csat_score);
            
            // Explicitly exclude positive feedback
            if (sentiment === "positive" || nps >= 7 || csat >= 4) {
              return false;
            }
            
            // Include if explicitly negative OR low scores
            return sentiment === "negative" || nps <= 6 || csat <= 3;
          });
          
          // Only include sample quotes from verified negative feedback
          const negativeQuotes = neg.slice(0, 5).map((x:any)=> {
            const quote = x.issue_details_text || x.details_text || "";
            return quote.trim();
          }).filter((q: string) => q.length > 0);
          
          return {
            resort_name: resort,
            negative_count: neg.length,
            sample_quotes: negativeQuotes,
            themes: topKeywords(neg.map((x:any)=>x.issue_details_text || x.details_text || ""), 8)
          };
        }).sort((a,b)=>b.negative_count - a.negative_count);

        return { content: [{ type: "text", text: JSON.stringify({ resorts: out }, null, 2) }] };
      }

      case "insights_blue_tier_feedback": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const fbFilters: Record<string, any> = {};
        if (start_date || end_date) fbFilters.feedback_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };
        const fb = await querySupabaseTable("fact_feedback", buildQuery(fbFilters));

        const members = await querySupabaseTable("fact_member", buildQuery({ membership_tier: { operator: "eq", value: "Blue" } }));
        const blueFb = fb.filter((x:any)=> {
          const member = members.find((m:any)=> m.member_id === x.member_id_fk);
          return member && member.membership_tier === "Blue";
        });
        const byResort = groupBy(blueFb, (x:any)=>x.resort_name || "Unknown");

        const out = Object.entries(byResort).map(([resort, arr]) => {
          // Filter for negative feedback: sentiment is "negative" OR NPS <= 6 OR CSAT <= 3
          // Also exclude if sentiment is explicitly "positive" or scores indicate positive
          const neg = arr.filter((x:any)=> {
            const sentiment = x.sentiment ? String(x.sentiment).toLowerCase() : "";
            const nps = safeNumber(x.nps_score);
            const csat = safeNumber(x.csat_score);
            
            // Explicitly exclude positive feedback
            if (sentiment === "positive" || nps >= 7 || csat >= 4) {
              return false;
            }
            
            // Include if explicitly negative OR low scores
            return sentiment === "negative" || nps <= 6 || csat <= 3;
          });
          
          // Only include sample quotes from verified negative feedback
          const negativeQuotes = neg.slice(0, 5).map((x:any)=> {
            const quote = x.issue_details_text || x.details_text || "";
            return quote.trim();
          }).filter((q: string) => q.length > 0);
          
          return {
            resort_name: resort,
            total_feedback: arr.length,
            negative_count: neg.length,
            negative_percentage: arr.length ? +((neg.length/arr.length)*100).toFixed(1) : 0,
            sample_quotes: negativeQuotes,
            themes: topKeywords(neg.map((x:any)=>x.issue_details_text || x.details_text || ""), 8)
          };
        }).sort((a,b)=>b.negative_count - a.negative_count);

        return { content: [{ type: "text", text: JSON.stringify({ resorts: out }, null, 2) }] };
      }

      case "insights_resort_feedback_analysis": {
        const { resort_name, date_range } = args as { resort_name: string; date_range: { start: string; end: string } };
        const { start, end } = date_range;

        const feedback = await querySupabaseTable("fact_feedback", buildQuery({
          resort_name: { operator: "ilike", value: resort_name },
          feedback_date: { gte: start, lte: end }
        }));

        // Fetch resort info to get region for event filtering
        let region: string | null = null;
        try {
          const resorts = await querySupabaseTable("fact_resort", buildQuery({ 
            resort_name: { operator: "ilike", value: resort_name }
          }));
          if (resorts && resorts.length > 0) {
            region = resorts[0].resort_region || null;
          }
        } catch (error) {
          console.error("Error fetching resort info:", error);
        }

        // Fetch events for the same date range and region
        let events: any[] = [];
        try {
          const eventFilters: Record<string, any> = { event_date: { gte: start, lte: end } };
          if (region) eventFilters.impact_region = { operator: "ilike", value: region };
          events = await querySupabaseTable("fact_event", buildQuery(eventFilters)) || [];
        } catch (error) {
          console.error("Error fetching events:", error);
        }

        // Format events with all details
        const formattedEvents = events.map((e:any)=>({
          event_type: e.event_type || null,
          event_date: e.event_date || null,
          impact_region: e.impact_region || null,
          details: e.details_description || e.event_details_description || e.details || null,
          weather_condition: e.weather_condition || null,
          competitor_name: e.competitor_name || null,
          relevance_score: e.relevance_score || e.event_relevance_score || null
        }));

        if (!Array.isArray(feedback) || feedback.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ 
            resort_name, 
            date_range: { start, end },
            message: "No feedback found for this resort in the specified date range",
            total_feedback: 0,
            events: formattedEvents,
            total_events: formattedEvents.length
          }, null, 2) }] };
        }

        const total = feedback.length;
        const positive = feedback.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="positive") || safeNumber(x.nps_score) >= 7 || safeNumber(x.csat_score) >= 4);
        const negative = feedback.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3);
        const neutral = feedback.filter((x:any)=> {
          const sent = x.sentiment ? String(x.sentiment).toLowerCase() : "";
          const nps = safeNumber(x.nps_score);
          const csat = safeNumber(x.csat_score);
          return sent !== "positive" && sent !== "negative" && nps > 6 && nps < 7 && csat > 3 && csat < 4;
        });

        const npsScores = feedback.map((x:any)=>safeNumber(x.nps_score)).filter(n=>n>0);
        const csatScores = feedback.map((x:any)=>safeNumber(x.csat_score)).filter(n=>n>0);

        const avgNPS = npsScores.length ? npsScores.reduce((a,b)=>a+b,0)/npsScores.length : 0;
        const avgCSAT = csatScores.length ? csatScores.reduce((a,b)=>a+b,0)/csatScores.length : 0;

        const themes = topKeywords(feedback.map((x:any)=>x.issue_details_text || x.details_text || ""), 10);
        const positiveThemes = topKeywords(positive.map((x:any)=>x.issue_details_text || x.details_text || ""), 5);
        const negativeThemes = topKeywords(negative.map((x:any)=>x.issue_details_text || x.details_text || ""), 5);

        const byPlatform = groupBy(feedback, (x:any)=>x.platform || "Unknown");
        const byIssueType = groupBy(feedback, (x:any)=>x.issue_type_category || "Unknown");

        const result = {
          resort_name,
          date_range: { start, end },
          summary: {
            total_feedback: total,
            positive_count: positive.length,
            negative_count: negative.length,
            neutral_count: neutral.length,
            positive_percentage: total ? +((positive.length/total)*100).toFixed(1) : 0,
            negative_percentage: total ? +((negative.length/total)*100).toFixed(1) : 0,
            average_nps: +avgNPS.toFixed(2),
            average_csat: +avgCSAT.toFixed(2)
          },
          themes: {
            overall: themes,
            positive_themes: positiveThemes,
            negative_themes: negativeThemes
          },
          breakdown: {
            by_platform: Object.entries(byPlatform).map(([platform, arr])=>({
              platform,
              count: arr.length,
              percentage: +((arr.length/total)*100).toFixed(1)
            })),
            by_issue_type: Object.entries(byIssueType).map(([issue, arr])=>({
              issue_type: issue,
              count: arr.length,
              percentage: +((arr.length/total)*100).toFixed(1)
            }))
          },
          sample_quotes: {
            positive: positive.slice(0, 3).map((x:any)=>({
              quote: x.issue_details_text || x.details_text,
              nps_score: x.nps_score,
              csat_score: x.csat_score,
              platform: x.platform,
              date: x.feedback_date
            })),
            negative: negative.slice(0, 5).map((x:any)=>({
              quote: x.issue_details_text || x.details_text,
              nps_score: x.nps_score,
              csat_score: x.csat_score,
              platform: x.platform,
              issue_type: x.issue_type_category,
              date: x.feedback_date
            }))
          },
          events: formattedEvents,
          total_events: formattedEvents.length,
          events_summary: {
            by_type: Object.entries(groupBy(formattedEvents, (e:any)=>e.event_type || "Unknown")).map(([type, arr])=>({
              event_type: type,
              count: arr.length
            }))
          }
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "insights_member_lifetime_value": {
        const { region, membership_tier, start_date, end_date } = args as { region?: string; membership_tier?: string; start_date?: string; end_date?: string };
        const memberFilters: Record<string, any> = {};
        if (region) memberFilters.home_region = { operator: "ilike", value: region };
        if (membership_tier) memberFilters.membership_tier = { operator: "eq", value: membership_tier };
        if (start_date || end_date) memberFilters.date_joined = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const members = await querySupabaseTable("fact_member", buildQuery(memberFilters));
        if (!Array.isArray(members) || members.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No members found", total: 0 }, null, 2) }] };
        }

        const byRegion = groupBy(members, (m:any)=>m.home_region || "Unknown");
        const byTier = groupBy(members, (m:any)=>m.membership_tier || "Unknown");
        const byYear = groupBy(members, (m:any)=>m.date_joined ? m.date_joined.substring(0,4) : "Unknown");

        const ltvStats = {
          total_members: members.length,
          average_ltv: members.reduce((a:any,m:any)=>a+safeNumber(m.lifetime_value_inr),0)/members.length,
          median_ltv: members.map((m:any)=>safeNumber(m.lifetime_value_inr)).sort((a,b)=>a-b)[Math.floor(members.length/2)],
          min_ltv: Math.min(...members.map((m:any)=>safeNumber(m.lifetime_value_inr))),
          max_ltv: Math.max(...members.map((m:any)=>safeNumber(m.lifetime_value_inr)))
        };

        const regionAnalysis = Object.entries(byRegion).map(([reg, arr])=>({
          region: reg,
          member_count: arr.length,
          average_ltv: arr.reduce((a:any,m:any)=>a+safeNumber(m.lifetime_value_inr),0)/arr.length,
          total_ltv: arr.reduce((a:any,m:any)=>a+safeNumber(m.lifetime_value_inr),0)
        })).sort((a,b)=>b.average_ltv - a.average_ltv);

        const tierAnalysis = Object.entries(byTier).map(([tier, arr])=>({
          membership_tier: tier,
          member_count: arr.length,
          average_ltv: arr.reduce((a:any,m:any)=>a+safeNumber(m.lifetime_value_inr),0)/arr.length,
          total_ltv: arr.reduce((a:any,m:any)=>a+safeNumber(m.lifetime_value_inr),0)
        })).sort((a,b)=>b.average_ltv - a.average_ltv);

        // Identify highest and lowest spending tiers
        const highestLtvTier = tierAnalysis.length > 0 ? {
          membership_tier: tierAnalysis[0].membership_tier,
          average_ltv: tierAnalysis[0].average_ltv,
          total_ltv: tierAnalysis[0].total_ltv,
          member_count: tierAnalysis[0].member_count
        } : null;

        const lowestLtvTier = tierAnalysis.length > 0 ? {
          membership_tier: tierAnalysis[tierAnalysis.length - 1].membership_tier,
          average_ltv: tierAnalysis[tierAnalysis.length - 1].average_ltv,
          total_ltv: tierAnalysis[tierAnalysis.length - 1].total_ltv,
          member_count: tierAnalysis[tierAnalysis.length - 1].member_count
        } : null;

        const atRisk = members.filter((m:any)=> {
          const ltv = safeNumber(m.lifetime_value_inr);
          const isActive = m.is_active === true;
          const nps = safeNumber(m.last_feedback_nps);
          const feeStatus = m.annual_fee_collection_status;
          const lastHoliday = m.last_holiday_date;
          const daysSinceHoliday = lastHoliday ? Math.floor((Date.now() - new Date(lastHoliday).getTime())/86400000) : 9999;
          return (!isActive || ltv < 300000 || nps < 6 || feeStatus === "Due" || daysSinceHoliday > 180);
        }).map((m:any)=>({
          member_id: m.member_id,
          membership_tier: m.membership_tier,
          lifetime_value_inr: safeNumber(m.lifetime_value_inr),
          is_active: m.is_active,
          last_feedback_nps: safeNumber(m.last_feedback_nps),
          annual_fee_collection_status: m.annual_fee_collection_status,
          last_holiday_date: m.last_holiday_date,
          risk_factors: [
            !m.is_active ? "inactive" : null,
            safeNumber(m.lifetime_value_inr) < 300000 ? "low_ltv" : null,
            safeNumber(m.last_feedback_nps) < 6 ? "poor_feedback" : null,
            m.annual_fee_collection_status === "Due" ? "payment_due" : null,
            (m.last_holiday_date ? Math.floor((Date.now() - new Date(m.last_holiday_date).getTime())/86400000) : 9999) > 180 ? "no_recent_holiday" : null
          ].filter(Boolean)
        }));

        return { content: [{ type: "text", text: JSON.stringify({ 
          ltv_statistics: ltvStats, 
          by_region: regionAnalysis, 
          by_tier: tierAnalysis,
          highest_ltv_tier: highestLtvTier,
          lowest_ltv_tier: lowestLtvTier,
          at_risk_members: atRisk.slice(0,50) 
        }, null, 2) }] };
      }

      case "insights_regional_performance": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const resortFilters: Record<string, any> = {};
        if (start_date || end_date) resortFilters.activity_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const resorts = await querySupabaseTable("fact_resort", buildQuery(resortFilters));
        if (!Array.isArray(resorts) || resorts.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No resort data found" }, null, 2) }] };
        }

        const byRegion = groupBy(resorts, (r:any)=>r.resort_region || "Unknown");
        const regionAnalysis = Object.entries(byRegion).map(([region, arr])=>({
          region,
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
          average_occupancy: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length,
          total_rooms_booked: arr.reduce((a:any,r:any)=>a+safeNumber(r.member_rooms_booked),0),
          resort_count: new Set(arr.map((r:any)=>r.resort_name)).size,
          average_revenue_per_resort: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0) / new Set(arr.map((r:any)=>r.resort_name)).size
        })).sort((a,b)=>b.total_revenue - a.total_revenue);

        return { content: [{ type: "text", text: JSON.stringify({ regional_performance: regionAnalysis }, null, 2) }] };
      }

      case "insights_resort_theme_analysis": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const resortFilters: Record<string, any> = {};
        if (start_date || end_date) resortFilters.activity_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const resorts = await querySupabaseTable("fact_resort", buildQuery(resortFilters));
        if (!Array.isArray(resorts) || resorts.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No resort data found" }, null, 2) }] };
        }

        const byTheme = groupBy(resorts, (r:any)=>r.resort_theme || "Unknown");
        const themeAnalysis = Object.entries(byTheme).map(([theme, arr])=>({
          theme,
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
          average_occupancy: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length,
          total_bookings: arr.reduce((a:any,r:any)=>a+safeNumber(r.member_rooms_booked),0),
          resort_count: new Set(arr.map((r:any)=>r.resort_name)).size,
          average_revenue_per_resort: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0) / new Set(arr.map((r:any)=>r.resort_name)).size
        })).sort((a,b)=>b.total_revenue - a.total_revenue);

        return { content: [{ type: "text", text: JSON.stringify({ theme_analysis: themeAnalysis }, null, 2) }] };
      }

      case "insights_revenue_stream_analysis": {
        const { resort_name, region, start_date, end_date } = args as { resort_name?: string; region?: string; start_date?: string; end_date?: string };
        const resortFilters: Record<string, any> = {};
        if (resort_name) resortFilters.resort_name = { operator: "ilike", value: resort_name };
        if (region) resortFilters.resort_region = { operator: "ilike", value: region };
        if (start_date || end_date) resortFilters.activity_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const resorts = await querySupabaseTable("fact_resort", buildQuery(resortFilters));
        if (!Array.isArray(resorts) || resorts.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No resort data found" }, null, 2) }] };
        }

        const totalAncillary = resorts.reduce((a:any,r:any)=>a+safeNumber(r.activity_revenue || r.ancillary_revenue_inr),0);
        const totalRestaurant = resorts.reduce((a:any,r:any)=>a+safeNumber(r.restaurant_revenue || r.restaurant_revenue_inr),0);
        const totalRevenue = resorts.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0);

        const byResort = groupBy(resorts, (r:any)=>r.resort_name || "Unknown");
        const resortAnalysis = Object.entries(byResort).map(([resort, arr])=>({
          resort_name: resort,
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
          ancillary_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.activity_revenue || r.ancillary_revenue_inr),0),
          restaurant_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.restaurant_revenue || r.restaurant_revenue_inr),0),
          ancillary_percentage: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0) > 0 ? 
            +((arr.reduce((a:any,r:any)=>a+safeNumber(r.activity_revenue || r.ancillary_revenue_inr),0) / arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0))*100).toFixed(1) : 0,
          restaurant_percentage: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0) > 0 ? 
            +((arr.reduce((a:any,r:any)=>a+safeNumber(r.restaurant_revenue || r.restaurant_revenue_inr),0) / arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0))*100).toFixed(1) : 0
        })).sort((a,b)=>b.total_revenue - a.total_revenue);

        return { content: [{ type: "text", text: JSON.stringify({ 
          overall: {
            total_revenue: totalRevenue,
            ancillary_revenue: totalAncillary,
            restaurant_revenue: totalRestaurant,
            ancillary_percentage: totalRevenue > 0 ? +((totalAncillary/totalRevenue)*100).toFixed(1) : 0,
            restaurant_percentage: totalRevenue > 0 ? +((totalRestaurant/totalRevenue)*100).toFixed(1) : 0
          },
          by_resort: resortAnalysis
        }, null, 2) }] };
      }

      case "insights_competitor_impact": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const eventFilters: Record<string, any> = { event_type: { operator: "eq", value: "Competitor Promo" } };
        if (start_date || end_date) eventFilters.event_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const events = await querySupabaseTable("fact_event", buildQuery(eventFilters));
        if (!Array.isArray(events) || events.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No competitor events found", impacted: [] }, null, 2) }] };
        }

        const byRegion = groupBy(events, (e:any)=>e.impact_region || "Unknown");
        const regions = Array.from(new Set(events.map((e:any)=>e.impact_region).filter(Boolean)));

        const resortFilters: Record<string, any> = {};
        if (start_date || end_date) resortFilters.activity_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };
        if (regions.length) resortFilters.resort_region = { operator: "in", value: regions };

        const resorts = await querySupabaseTable("fact_resort", buildQuery(resortFilters));
        const start = start_date ? new Date(start_date) : new Date();
        const end = end_date ? new Date(end_date) : new Date();
        const days = Math.ceil((end.getTime() - start.getTime())/86400000)+1;
        const prevStart = new Date(start.getTime()-days*86400000).toISOString().slice(0,10);
        const prevEnd = new Date(start.getTime()-86400000).toISOString().slice(0,10);
        const prevResortFilters = { ...resortFilters, activity_date: { gte: prevStart, lte: prevEnd } };
        const resortsPrev = await querySupabaseTable("fact_resort", buildQuery(prevResortFilters));

        const rollByResort = (rows:any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
              region: arr[0]?.resort_region ?? null
            };
          }
          return out;
        };

        const A = rollByResort(resorts);
        const B = rollByResort(resortsPrev);

        const impacted: any[] = [];
        for (const [resort, cur] of Object.entries(A)) {
          const prev = B[resort] || { revenue: 0, region: null };
          const delta = safeNumber((cur as any).revenue) - safeNumber(prev.revenue);
          const region = (cur as any).region || "Unknown";
          const evts = byRegion[region] || [];
          const drop = prev.revenue ? delta/prev.revenue : 0;
          if (drop < -0.05 && evts.length) {
            impacted.push({
              resort_name: resort,
              region,
              revenue_prev_inr: prev.revenue,
              revenue_curr_inr: (cur as any).revenue,
              change_pct: +((delta/prev.revenue)*100).toFixed(1),
              competitor_events: evts.map((e:any)=>({
                date: e.event_date,
                competitor: e.competitor_name,
                details: e.details_description,
                relevance_score: e.relevance_score
              }))
            });
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ impacted }, null, 2) }] };
      }

      case "insights_weather_impact": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const eventFilters: Record<string, any> = {};
        if (start_date || end_date) eventFilters.event_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        // First try to get all events in the date range, then filter for weather
        let events = await querySupabaseTable("fact_event", buildQuery(eventFilters)) || [];
        
        // Filter for weather events: check event_type contains "weather" OR weather_condition field has value
        events = events.filter((e:any) => {
          const eventType = (e.event_type || "").toLowerCase();
          return eventType.includes("weather") || (e.weather_condition && String(e.weather_condition).trim() !== "");
        });
        
        if (!Array.isArray(events) || events.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No weather events found", impacted: [] }, null, 2) }] };
        }

        const byRegion = groupBy(events, (e:any)=>e.impact_region || "Unknown");
        const regions = Array.from(new Set(events.map((e:any)=>e.impact_region).filter(Boolean)));

        const resortFilters: Record<string, any> = {};
        if (start_date || end_date) resortFilters.activity_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };
        if (regions.length) resortFilters.resort_region = { operator: "in", value: regions };

        const resorts = await querySupabaseTable("fact_resort", buildQuery(resortFilters));
        const start = start_date ? new Date(start_date) : new Date();
        const end = end_date ? new Date(end_date) : new Date();
        const days = Math.ceil((end.getTime() - start.getTime())/86400000)+1;
        const prevStart = new Date(start.getTime()-days*86400000).toISOString().slice(0,10);
        const prevEnd = new Date(start.getTime()-86400000).toISOString().slice(0,10);
        const prevResortFilters = { ...resortFilters, activity_date: { gte: prevStart, lte: prevEnd } };
        const resortsPrev = await querySupabaseTable("fact_resort", buildQuery(prevResortFilters));

        const rollByResort = (rows:any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
              occupancy: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length,
              region: arr[0]?.resort_region ?? null
            };
          }
          return out;
        };

        const A = rollByResort(resorts);
        const B = rollByResort(resortsPrev);

        const impacted: any[] = [];
        for (const [resort, cur] of Object.entries(A)) {
          const prev = B[resort] || { revenue: 0, occupancy: 0, region: null };
          const revenueDelta = safeNumber((cur as any).revenue) - safeNumber(prev.revenue);
          const occupancyDelta = safeNumber((cur as any).occupancy) - safeNumber(prev.occupancy);
          const region = (cur as any).region || "Unknown";
          const evts = byRegion[region] || [];
          const drop = prev.revenue ? revenueDelta/prev.revenue : 0;
          if (drop < -0.05 && evts.length) {
            impacted.push({
              resort_name: resort,
              region,
              revenue_prev_inr: prev.revenue,
              revenue_curr_inr: (cur as any).revenue,
              revenue_change_pct: +((revenueDelta/prev.revenue)*100).toFixed(1),
              occupancy_prev_perc: prev.occupancy,
              occupancy_curr_perc: (cur as any).occupancy,
              occupancy_change_perc: +occupancyDelta.toFixed(1),
              weather_events: evts.map((e:any)=>({
                date: e.event_date,
                weather_condition: e.weather_condition,
                details: e.details_description,
                relevance_score: e.relevance_score
              }))
            });
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ impacted }, null, 2) }] };
      }

      case "insights_platform_issue_analysis": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const fbFilters: Record<string, any> = {};
        if (start_date || end_date) fbFilters.feedback_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const feedback = await querySupabaseTable("fact_feedback", buildQuery(fbFilters));
        if (!Array.isArray(feedback) || feedback.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No feedback found" }, null, 2) }] };
        }

        const byPlatform = groupBy(feedback, (f:any)=>f.platform || "Unknown");
        const platformAnalysis = Object.entries(byPlatform).map(([platform, arr])=>({
          platform,
          total_feedback: arr.length,
          average_nps: arr.filter((x:any)=>safeNumber(x.nps_score)>0).length ? 
            arr.filter((x:any)=>safeNumber(x.nps_score)>0).reduce((a:any,x:any)=>a+safeNumber(x.nps_score),0) / arr.filter((x:any)=>safeNumber(x.nps_score)>0).length : 0,
          average_csat: arr.filter((x:any)=>safeNumber(x.csat_score)>0).length ? 
            arr.filter((x:any)=>safeNumber(x.csat_score)>0).reduce((a:any,x:any)=>a+safeNumber(x.csat_score),0) / arr.filter((x:any)=>safeNumber(x.csat_score)>0).length : 0,
          negative_count: arr.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3).length,
          negative_percentage: arr.length ? +((arr.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3).length/arr.length)*100).toFixed(1) : 0,
          issue_types: Object.entries(groupBy(arr, (x:any)=>x.issue_type_category || "Unknown")).map(([issue, items])=>({
            issue_type: issue,
            count: items.length
          })).sort((a,b)=>b.count - a.count)
        })).sort((a,b)=>b.negative_percentage - a.negative_percentage);

        return { content: [{ type: "text", text: JSON.stringify({ platform_analysis: platformAnalysis }, null, 2) }] };
      }

      case "insights_issue_type_trends": {
        const { resort_name, start_date, end_date } = args as { resort_name?: string; start_date?: string; end_date?: string };
        const fbFilters: Record<string, any> = {};
        if (resort_name) fbFilters.resort_name = { operator: "ilike", value: resort_name };
        if (start_date || end_date) fbFilters.feedback_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const feedback = await querySupabaseTable("fact_feedback", buildQuery(fbFilters));
        if (!Array.isArray(feedback) || feedback.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No feedback found" }, null, 2) }] };
        }

        const byIssueType = groupBy(feedback, (f:any)=>f.issue_type_category || "Unknown");
        const byResort = groupBy(feedback, (f:any)=>f.resort_name || "Unknown");

        const issueAnalysis = Object.entries(byIssueType).map(([issue, arr])=>({
          issue_type: issue,
          total_count: arr.length,
          percentage: +((arr.length/feedback.length)*100).toFixed(1),
          average_nps: arr.filter((x:any)=>safeNumber(x.nps_score)>0).length ? 
            arr.filter((x:any)=>safeNumber(x.nps_score)>0).reduce((a:any,x:any)=>a+safeNumber(x.nps_score),0) / arr.filter((x:any)=>safeNumber(x.nps_score)>0).length : 0,
          negative_count: arr.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3).length
        })).sort((a,b)=>b.total_count - a.total_count);

        const resortIssueCount = Object.entries(byResort).map(([resort, arr])=>({
          resort_name: resort,
          total_issues: arr.length,
          issue_breakdown: Object.entries(groupBy(arr, (x:any)=>x.issue_type_category || "Unknown")).map(([issue, items])=>({
            issue_type: issue,
            count: items.length
          })).sort((a,b)=>b.count - a.count)
        })).sort((a,b)=>b.total_issues - a.total_issues);

        return { content: [{ type: "text", text: JSON.stringify({ issue_type_analysis: issueAnalysis, by_resort: resortIssueCount }, null, 2) }] };
      }

      case "insights_member_churn_risk": {
        const { risk_level } = args as { risk_level?: string };
        const members = await querySupabaseTable("fact_member", buildQuery({}));
        if (!Array.isArray(members) || members.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No members found" }, null, 2) }] };
        }

        const now = Date.now();
        const atRisk = members.map((m:any)=> {
          const ltv = safeNumber(m.lifetime_value_inr);
          const isActive = m.is_active === true;
          const nps = safeNumber(m.last_feedback_nps);
          const feeStatus = m.annual_fee_collection_status;
          const lastHoliday = m.last_holiday_date;
          const daysSinceHoliday = lastHoliday ? Math.floor((now - new Date(lastHoliday).getTime())/86400000) : 9999;
          const dateJoined = m.date_joined ? new Date(m.date_joined).getTime() : 0;
          const daysSinceJoined = dateJoined ? Math.floor((now - dateJoined)/86400000) : 0;

          let riskScore = 0;
          const factors: string[] = [];
          if (!isActive) { riskScore += 30; factors.push("inactive"); }
          if (ltv < 300000) { riskScore += 20; factors.push("low_ltv"); }
          if (nps < 6 && nps > 0) { riskScore += 15; factors.push("poor_feedback"); }
          if (feeStatus === "Due") { riskScore += 25; factors.push("payment_due"); }
          if (daysSinceHoliday > 180) { riskScore += 10; factors.push("no_recent_holiday"); }
          if (daysSinceJoined > 365 && ltv < 500000) { riskScore += 10; factors.push("low_engagement"); }

          let level = "low";
          if (riskScore >= 50) level = "high";
          else if (riskScore >= 30) level = "medium";

          return {
            member_id: m.member_id,
            membership_tier: m.membership_tier,
            home_region: m.home_region,
            lifetime_value_inr: ltv,
            is_active: isActive,
            last_feedback_nps: nps,
            annual_fee_collection_status: feeStatus,
            last_holiday_date: lastHoliday,
            days_since_last_holiday: daysSinceHoliday,
            risk_score: riskScore,
            risk_level: level,
            risk_factors: factors
          };
        }).filter((m:any)=> !risk_level || m.risk_level === risk_level).sort((a,b)=>b.risk_score - a.risk_score);

        const summary = {
          total_members: members.length,
          high_risk: atRisk.filter((m:any)=>m.risk_level === "high").length,
          medium_risk: atRisk.filter((m:any)=>m.risk_level === "medium").length,
          low_risk: atRisk.filter((m:any)=>m.risk_level === "low").length
        };

        return { content: [{ type: "text", text: JSON.stringify({ summary, at_risk_members: atRisk.slice(0,100) }, null, 2) }] };
      }

      case "insights_resort_performance_ranking": {
        const { start_date, end_date, metric } = args as { start_date?: string; end_date?: string; metric?: string };
        const resortFilters: Record<string, any> = {};
        if (start_date || end_date) resortFilters.activity_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const resorts = await querySupabaseTable("fact_resort", buildQuery(resortFilters));
        const feedback = await querySupabaseTable("fact_feedback", buildQuery({}));

        if (!Array.isArray(resorts) || resorts.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No resort data found" }, null, 2) }] };
        }

        const byResort = groupBy(resorts, (r:any)=>r.resort_name || "Unknown");
        const fbByResort = groupBy(feedback, (f:any)=>f.resort_name_fk || "Unknown");

        const rankings = Object.entries(byResort).map(([resort, arr])=>({
          resort_name: resort,
          region: arr[0]?.resort_region ?? null,
          theme: arr[0]?.resort_theme ?? null,
          metrics: {
            total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
            average_occupancy: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length,
            total_bookings: arr.reduce((a:any,r:any)=>a+safeNumber(r.member_rooms_booked),0),
            feedback_count: (fbByResort[resort] || []).length,
            average_nps: (fbByResort[resort] || []).filter((x:any)=>safeNumber(x.nps_score)>0).length ? 
              (fbByResort[resort] || []).filter((x:any)=>safeNumber(x.nps_score)>0).reduce((a:any,x:any)=>a+safeNumber(x.nps_score),0) / (fbByResort[resort] || []).filter((x:any)=>safeNumber(x.nps_score)>0).length : 0
          }
        }));

        // Normalize scores (0-100)
        const maxRevenue = Math.max(...rankings.map((r:any)=>r.metrics.total_revenue));
        const maxOccupancy = Math.max(...rankings.map((r:any)=>r.metrics.average_occupancy));
        const maxNPS = Math.max(...rankings.map((r:any)=>r.metrics.average_nps).filter(n=>n>0));

        const scored = rankings.map((r:any)=>({
          ...r,
          scores: {
            revenue_score: maxRevenue > 0 ? +((r.metrics.total_revenue/maxRevenue)*100).toFixed(1) : 0,
            occupancy_score: maxOccupancy > 0 ? +((r.metrics.average_occupancy/maxOccupancy)*100).toFixed(1) : 0,
            feedback_score: r.metrics.feedback_count > 0 ? Math.min(100, r.metrics.feedback_count * 2) : 0,
            nps_score: maxNPS > 0 ? +((r.metrics.average_nps/maxNPS)*100).toFixed(1) : 0
          },
          overall_score: +(((
            (maxRevenue > 0 ? (r.metrics.total_revenue/maxRevenue)*100 : 0) * 0.4 +
            (maxOccupancy > 0 ? (r.metrics.average_occupancy/maxOccupancy)*100 : 0) * 0.3 +
            (r.metrics.feedback_count > 0 ? Math.min(100, r.metrics.feedback_count * 2) : 0) * 0.1 +
            (maxNPS > 0 ? (r.metrics.average_nps/maxNPS)*100 : 0) * 0.2
          )).toFixed(1))
        }));

        const sortKey = metric === "revenue" ? "metrics.total_revenue" : 
                       metric === "occupancy" ? "metrics.average_occupancy" :
                       metric === "feedback" ? "metrics.feedback_count" : "overall_score";

        const sorted = scored.sort((a:any,b:any)=> {
          const aVal = sortKey === "overall_score" ? a.overall_score : 
                      sortKey === "metrics.total_revenue" ? a.metrics.total_revenue :
                      sortKey === "metrics.average_occupancy" ? a.metrics.average_occupancy :
                      a.metrics.feedback_count;
          const bVal = sortKey === "overall_score" ? b.overall_score : 
                      sortKey === "metrics.total_revenue" ? b.metrics.total_revenue :
                      sortKey === "metrics.average_occupancy" ? b.metrics.average_occupancy :
                      b.metrics.feedback_count;
          return bVal - aVal;
        });

        return { content: [{ type: "text", text: JSON.stringify({ rankings: sorted }, null, 2) }] };
      }

      case "insights_seasonal_trends": {
        const { year } = args as { year?: string };
        const y = year || "2025";
        const startDate = `${y}-01-01`;
        const endDate = `${y}-12-31`;

        const resorts = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: startDate, lte: endDate } }));
        const feedback = await querySupabaseTable("fact_feedback", buildQuery({ feedback_date: { gte: startDate, lte: endDate } }));

        if (!Array.isArray(resorts) || resorts.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No data found for year", year: y }, null, 2) }] };
        }

        const byMonth = groupBy(resorts, (r:any)=>r.activity_date ? r.activity_date.substring(0,7) : "Unknown");
        const fbByMonth = groupBy(feedback, (f:any)=>f.feedback_date ? f.feedback_date.substring(0,7) : "Unknown");

        const monthlyTrends = Object.entries(byMonth).map(([month, arr])=>({
          month,
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
          average_occupancy: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length,
          total_bookings: arr.reduce((a:any,r:any)=>a+safeNumber(r.member_rooms_booked),0),
          feedback_count: (fbByMonth[month] || []).length,
          average_nps: (fbByMonth[month] || []).filter((x:any)=>safeNumber(x.nps_score)>0).length ? 
            (fbByMonth[month] || []).filter((x:any)=>safeNumber(x.nps_score)>0).reduce((a:any,x:any)=>a+safeNumber(x.nps_score),0) / (fbByMonth[month] || []).filter((x:any)=>safeNumber(x.nps_score)>0).length : 0
        })).sort((a,b)=>a.month.localeCompare(b.month));

        const peakMonths = monthlyTrends.sort((a,b)=>b.total_revenue - a.total_revenue).slice(0,3).map((m:any)=>m.month);
        const lowMonths = monthlyTrends.sort((a,b)=>a.total_revenue - b.total_revenue).slice(0,3).map((m:any)=>m.month);

        return { content: [{ type: "text", text: JSON.stringify({ 
          year: y,
          monthly_trends: monthlyTrends,
          peak_seasons: peakMonths,
          low_seasons: lowMonths,
          summary: {
            total_revenue: monthlyTrends.reduce((a:any,m:any)=>a+m.total_revenue,0),
            average_monthly_revenue: monthlyTrends.reduce((a:any,m:any)=>a+m.total_revenue,0)/monthlyTrends.length,
            peak_month: peakMonths[0],
            low_month: lowMonths[0]
          }
        }, null, 2) }] };
      }

      case "insights_monthly_sales_comparison": {
        const { month1, month2 } = args as { month1: string; month2: string };
        if (!month1 || !month1.match(/^\d{4}-\d{2}$/) || !month2 || !month2.match(/^\d{4}-\d{2}$/)) {
          throw new Error("Both months must be in format 'YYYY-MM' (e.g., '2025-09', '2025-10')");
        }
        const r1 = monthRange(month1);
        const r2 = monthRange(month2);

        let resorts1: any[] = [];
        let resorts2: any[] = [];
        try {
          resorts1 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r1.start, lte: r1.end } })) || [];
          resorts2 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r2.start, lte: r2.end } })) || [];
        } catch (error) {
          console.error("Error in insights_monthly_sales_comparison:", error);
        }

        const rollByResort = (rows: any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
              occupancy_avg: arr.length ? arr.reduce((a:any,r:any)=>a+safeNumber(r.occupied_percentage || r.occupancy_rate_perc),0)/arr.length : 0,
              region: arr[0]?.resort_region ?? null
            };
          }
          return out;
        };

        const A = rollByResort(resorts1);
        const B = rollByResort(resorts2);

        const lowSales: any[] = [];
        const increasedSales: any[] = [];
        for (const [resort, m2] of Object.entries(B)) {
          const m1 = A[resort] || { total_revenue: 0 };
          const delta = safeNumber((m2 as any).total_revenue) - safeNumber(m1.total_revenue);
          const pctChange = m1.total_revenue ? (delta / m1.total_revenue) * 100 : 0;
          const resortData = {
            resort_name: resort,
            month1_revenue_inr: m1.total_revenue,
            month2_revenue_inr: (m2 as any).total_revenue,
            revenue_delta_inr: delta,
            percentage_change: +pctChange.toFixed(1),
            region: (m2 as any).region
          };
          if (delta < 0) {
            lowSales.push(resortData);
          } else if (delta > 0) {
            increasedSales.push(resortData);
          }
        }

        // Sort by percentage_change in descending order (highest % first)
        lowSales.sort((a,b)=>b.percentage_change - a.percentage_change);
        increasedSales.sort((a,b)=>b.percentage_change - a.percentage_change);

        // Add formatted amounts to each resort
        const addFormattedAmounts = (resorts: any[]) => {
          return resorts.map((r: any) => ({
            ...r,
            revenue_delta_formatted: formatInrToLakhsCrores(r.revenue_delta_inr),
            month1_revenue_formatted: formatInrToLakhsCrores(r.month1_revenue_inr),
            month2_revenue_formatted: formatInrToLakhsCrores(r.month2_revenue_inr)
          }));
        };

        const lowSalesFormatted = addFormattedAmounts(lowSales);
        const increasedSalesFormatted = addFormattedAmounts(increasedSales);

        return { content: [{ type: "text", text: JSON.stringify({ 
          month1,
          month2,
          resorts_with_low_sales: lowSalesFormatted,
          resorts_with_increased_sales: increasedSalesFormatted,
          summary: {
            total_resorts_with_decline: lowSales.length,
            total_resorts_with_increase: increasedSales.length,
            largest_decline: lowSales.length ? lowSalesFormatted[0] : null,
            largest_increase: increasedSales.length ? increasedSalesFormatted[0] : null
          }
        }, null, 2) }] };
      }

      case "insights_resort_revenue_reasons": {
        const { resort_name, month } = args as { resort_name: string; month: string };
        if (!resort_name) {
          throw new Error("Resort name is required");
        }
        if (!month || !month.match(/^\d{4}-\d{2}$/)) {
          throw new Error("Month must be in format 'YYYY-MM' (e.g., '2025-10')");
        }
        const curr = monthRange(month);
        const prevYm = previousMonth(month);
        const prev = monthRange(prevYm);

        const resortFiltersCurr: Record<string, any> = { 
          activity_date: { gte: curr.start, lte: curr.end },
          resort_name: { operator: "ilike", value: resort_name }
        };
        const resortFiltersPrev: Record<string, any> = { 
          activity_date: { gte: prev.start, lte: prev.end },
          resort_name: { operator: "ilike", value: resort_name }
        };

        let resortsCurr: any[] = [];
        let resortsPrev: any[] = [];
        let events: any[] = [];
        let feedback: any[] = [];
        
        try {
          resortsCurr = await querySupabaseTable("fact_resort", buildQuery(resortFiltersCurr)) || [];
          resortsPrev = await querySupabaseTable("fact_resort", buildQuery(resortFiltersPrev)) || [];
        } catch (error) {
          console.error("Error fetching resort data:", error);
        }

        const roll = (rows: any[]) => {
          if (!rows.length) return { total_revenue: 0, occupancy_avg: 0, member_rooms: 0, total_rooms: 0 };
          return {
            total_revenue: rows.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
            occupancy_avg: rows.reduce((a:any,r:any)=>a+safeNumber(r.occupied_percentage || r.occupancy_rate_perc),0)/rows.length,
            member_rooms: rows.reduce((a:any,r:any)=>a+safeNumber(r.member_rooms_booked),0),
            total_rooms: rows.reduce((a:any,r:any)=>a+safeNumber(r.total_rooms_available),0),
            region: rows[0]?.resort_region ?? null
          };
        };

        const currData = roll(resortsCurr);
        const prevData = roll(resortsPrev);
        const revenueDelta = currData.total_revenue - prevData.total_revenue;
        const revenuePctChange = prevData.total_revenue ? (revenueDelta / prevData.total_revenue) * 100 : 0;

        const region = currData.region || prevData.region;
        try {
          const eventFilters: Record<string, any> = { event_date: { gte: curr.start, lte: curr.end } };
          if (region) eventFilters.impact_region = { operator: "ilike", value: region };
          events = await querySupabaseTable("fact_event", buildQuery(eventFilters)) || [];
        } catch (error) {
          console.error("Error fetching events:", error);
        }

        try {
          const feedbackFilters: Record<string, any> = { 
            feedback_date: { gte: prev.start, lte: curr.end },
            resort_name: { operator: "ilike", value: resort_name }
          };
          feedback = await querySupabaseTable("fact_feedback", buildQuery(feedbackFilters)) || [];
        } catch (error) {
          console.error("Error fetching feedback:", error);
        }
        const negativeFeedback = (feedback || []).filter((f:any)=>safeNumber(f.nps_score) < 7 || (f.sentiment && f.sentiment.toLowerCase().includes('negative')));
        const positiveFeedback = (feedback || []).filter((f:any)=>safeNumber(f.nps_score) >= 7 || (f.sentiment && f.sentiment.toLowerCase().includes('positive')));

        const reasons: string[] = [];
        const positiveReasons: string[] = [];
        const eventDetails: any[] = [];
        const positiveEventDetails: any[] = [];
        
        if (events && events.length) {
          const weatherEvents = events.filter((e:any)=>e.event_type === "Major Weather");
          const competitorEvents = events.filter((e:any)=>e.event_type === "Competitor Promo");
          const localEvents = events.filter((e:any)=>e.event_type === "Local Event");
          const positiveEvents = events.filter((e:any)=>e.event_type === "Local Event" || (e.relevance_score && safeNumber(e.relevance_score) < 3));
          
          if (weatherEvents.length) {
            reasons.push("Weather events");
            eventDetails.push(...weatherEvents.map((e:any)=>({ type: "Weather", date: e.event_date, details: e.details_description })));
          }
          if (competitorEvents.length) {
            reasons.push("Competitor promotions");
            eventDetails.push(...competitorEvents.map((e:any)=>({ type: "Competitor", date: e.event_date, competitor: e.competitor_name, details: e.details_description })));
          }
          if (localEvents.length && revenueDelta < 0) {
            reasons.push("Local events");
            eventDetails.push(...localEvents.map((e:any)=>({ type: "Local Event", date: e.event_date, details: e.details_description })));
          }
          if (positiveEvents.length && revenueDelta > 0) {
            positiveReasons.push("Positive local events");
            positiveEventDetails.push(...positiveEvents.map((e:any)=>({ type: "Local Event", date: e.event_date, details: e.details_description })));
          }
        }
        if (negativeFeedback.length && revenueDelta < 0) {
          reasons.push("Negative feedback from previous period");
        }
        if (positiveFeedback.length && revenueDelta > 0) {
          positiveReasons.push("Positive feedback from previous period");
        }
        if (currData.occupancy_avg < prevData.occupancy_avg - 5) {
          reasons.push("Lower occupancy rate");
        }
        if (currData.occupancy_avg > prevData.occupancy_avg + 5) {
          positiveReasons.push("Higher occupancy rate");
        }

        return { content: [{ type: "text", text: JSON.stringify({ 
          resort_name,
          month,
          revenue_comparison: {
            previous_month: prevData.total_revenue,
            current_month: currData.total_revenue,
            delta_inr: revenueDelta,
            percentage_change: +revenuePctChange.toFixed(1)
          },
          occupancy_comparison: {
            previous_month: prevData.occupancy_avg,
            current_month: currData.occupancy_avg,
            delta: +(currData.occupancy_avg - prevData.occupancy_avg).toFixed(1)
          },
          identified_reasons: revenueDelta < 0 ? reasons : positiveReasons,
          negative_reasons: reasons,
          positive_reasons: positiveReasons,
          events: eventDetails,
          positive_events: positiveEventDetails,
          negative_feedback_count: negativeFeedback.length,
          positive_feedback_count: positiveFeedback.length,
          negative_feedback_themes: negativeFeedback.length > 0 ? topKeywords(negativeFeedback.map((f:any)=>f.issue_details_text || f.details_text || "").filter(Boolean), 5) : [],
          positive_feedback_themes: positiveFeedback.length > 0 ? topKeywords(positiveFeedback.map((f:any)=>f.issue_details_text || f.details_text || "").filter(Boolean), 5) : []
        }, null, 2) }] };
      }

      case "insights_revenue_feedback_correlation": {
        const { month } = args as { month: string };
        if (!month || !month.match(/^\d{4}-\d{2}$/)) {
          throw new Error("Month must be in format 'YYYY-MM' (e.g., '2025-10')");
        }
        const curr = monthRange(month);
        const prevYm = previousMonth(month);
        const prev = monthRange(prevYm);

        let resortsCurr: any[] = [];
        let resortsPrev: any[] = [];
        let feedback: any[] = [];
        
        try {
          resortsCurr = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: curr.start, lte: curr.end } })) || [];
          resortsPrev = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: prev.start, lte: prev.end } })) || [];
          feedback = await querySupabaseTable("fact_feedback", buildQuery({ feedback_date: { gte: prev.start, lte: prev.end } })) || [];
        } catch (error) {
          // If queries fail, return empty results rather than error
          console.error("Error in insights_revenue_feedback_correlation:", error);
        }

        const rollByResort = (rows: any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
              occupancy_avg: arr.length ? arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length : 0
            };
          }
          return out;
        };

        const A = rollByResort(resortsPrev);
        const B = rollByResort(resortsCurr);

        const fbByResort = groupBy(feedback || [], (f:any)=>f.resort_name || "Unknown");
        const negativeFbByResort: Record<string, any[]> = {};
        for (const [resort, fbs] of Object.entries(fbByResort)) {
          const neg = (fbs as any[]).filter((f:any)=>safeNumber(f.nps_score) < 7 || (f.sentiment && f.sentiment.toLowerCase().includes('negative')));
          if (neg.length) negativeFbByResort[resort] = neg;
        }

        const correlated: any[] = [];
        for (const [resort, m2] of Object.entries(B)) {
          const m1 = A[resort] || { total_revenue: 0 };
          const delta = safeNumber((m2 as any).total_revenue) - safeNumber(m1.total_revenue);
          const pctChange = m1.total_revenue ? (delta / m1.total_revenue) * 100 : 0;
          const negFb = negativeFbByResort[resort] || [];
          // Include resorts with revenue decline and negative feedback, or significant revenue decline (>5%) even with minimal feedback
          if (delta < 0 && (negFb.length > 0 || pctChange < -5)) {
            correlated.push({
              resort_name: resort,
              revenue_decline_inr: delta,
              revenue_decline_pct: +pctChange.toFixed(1),
              negative_feedback_count: negFb.length,
              feedback_themes: negFb.length > 0 ? topKeywords(negFb.map((f:any)=>f.issue_details_text || f.details_text || "").filter(Boolean), 5) : [],
              correlation_strength: negFb.length > 5 ? "Strong" : negFb.length > 2 ? "Moderate" : negFb.length > 0 ? "Weak" : "Potential (significant revenue decline, no feedback recorded)"
            });
          }
        }

        correlated.sort((a,b)=>a.revenue_decline_inr - b.revenue_decline_inr);

        return { content: [{ type: "text", text: JSON.stringify({ 
          month,
          resorts_with_correlation: correlated,
          summary: {
            total_resorts: correlated.length,
            strongest_correlation: correlated[0] || null
          }
        }, null, 2) }] };
      }

      case "insights_unpaid_asf_feedback": {
        // Directly filter members with annual_asf_fee_missed_years > 2
        const unpaidMembers = await querySupabaseTable("fact_member", buildQuery({ 
          annual_asf_fee_missed_years: { operator: "gt", value: 2 }
        })) || [];

        if (unpaidMembers.length === 0) {
          // Provide diagnostic information to help understand why no members were found
          const allMembers = await querySupabaseTable("fact_member", buildQuery({})) || [];
          const membersWithAsfField = (allMembers || []).filter((m:any) => 
            m.annual_asf_fee_missed_years !== null && m.annual_asf_fee_missed_years !== undefined
          );
          const sampleAsfValues = [...new Set((allMembers || []).slice(0, 50)
            .map((m:any) => m.annual_asf_fee_missed_years)
            .filter((v:any) => v !== null && v !== undefined))];
          
          return { content: [{ type: "text", text: JSON.stringify({ 
            message: "No members found with unpaid ASF for 2+ years (annual_asf_fee_missed_years > 2)",
            diagnostic_info: {
              total_members_checked: allMembers.length,
              members_with_asf_field: membersWithAsfField.length,
              sample_asf_fee_missed_years_values: sampleAsfValues.slice(0, 10),
              note: "Filtering by annual_asf_fee_missed_years > 2. If you expected results, check if the annual_asf_fee_missed_years column has values greater than 2."
            },
            members: []
          }, null, 2) }] };
        }

        const memberIds = unpaidMembers.map((m:any)=>m.member_id);
        const feedbackFilters: Record<string, any> = { 
          member_id_fk: { operator: "in", value: memberIds }
        };
        const feedback = await querySupabaseTable("fact_feedback", buildQuery(feedbackFilters));
        const fbByMember = groupBy(feedback || [], (f:any)=>f.member_id_fk || "Unknown");

        const result = unpaidMembers.map((m:any) => {
          const memberFb = fbByMember[m.member_id] || [];
          const negativeFb = memberFb.filter((f:any)=>safeNumber(f.nps_score) < 7 || (f.sentiment && f.sentiment.toLowerCase().includes('negative')));
          return {
            member_id: m.member_id,
            member_name: `${m.member_first_name || ""} ${m.member_last_name || ""}`.trim(),
            membership_tier: m.membership_tier,
            annual_fee_status: m.annual_fee_collection_status,
            annual_asf_fee_missed_years: m.annual_asf_fee_missed_years,
            last_holiday_date: m.last_holiday_date,
            date_joined: m.date_joined,
            total_feedback_count: memberFb.length,
            negative_feedback_count: negativeFb.length,
            negative_feedback: negativeFb.length > 0 ? negativeFb.map((f:any)=>({
              date: f.feedback_date,
              resort: f.resort_name,
              nps_score: f.nps_score,
              csat_score: f.csat_score,
              sentiment: f.sentiment,
              details: f.issue_details_text || f.details_text || f.feedback_text || ""
            })) : [],
            all_feedback: memberFb.length > 0 ? memberFb.map((f:any)=>({
              date: f.feedback_date,
              resort: f.resort_name,
              nps_score: f.nps_score,
              csat_score: f.csat_score,
              sentiment: f.sentiment,
              details: f.issue_details_text || f.details_text || f.feedback_text || ""
            })) : []
          };
        });

        return { content: [{ type: "text", text: JSON.stringify({ 
          total_unpaid_members: result.length,
          members_with_feedback: result.filter((m:any)=>m.total_feedback_count > 0).length,
          members_with_negative_feedback: result.filter((m:any)=>m.negative_feedback_count > 0).length,
          members_with_complaints: result.filter((m:any)=>m.negative_feedback_count > 0).length,
          filter_criteria: "annual_asf_fee_missed_years > 2",
          members: result
        }, null, 2) }] };
      }

      case "insights_resort_event_decline": {
        const { resort_name, month } = args as { resort_name: string; month?: string };
        
        const resorts = await querySupabaseTable("fact_resort", buildQuery({ 
          resort_name: { operator: "ilike", value: resort_name }
        }));
        
        if (!resorts || resorts.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ 
            message: `Resort '${resort_name}' not found`,
            events: []
          }, null, 2) }] };
        }

        const resort = resorts[0];
        const region = resort.resort_region;
        const resortDates = resorts.map((r:any)=>r.activity_date).filter(Boolean);
        if (resortDates.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ 
            message: "No activity dates found for resort",
            events: []
          }, null, 2) }] };
        }

        const minDate = Math.min(...resortDates.map((d:any)=>new Date(d).getTime()));
        const maxDate = Math.max(...resortDates.map((d:any)=>new Date(d).getTime()));
        const startDate = new Date(minDate).toISOString().slice(0, 10);
        const endDate = new Date(maxDate).toISOString().slice(0, 10);

        let events: any[] = [];
        try {
          const eventFilters: Record<string, any> = { event_date: { gte: startDate, lte: endDate } };
          if (region) eventFilters.impact_region = { operator: "ilike", value: region };
          events = await querySupabaseTable("fact_event", buildQuery(eventFilters)) || [];
        } catch (error) {
          console.error("Error fetching events:", error);
        }

        const rollByResort = (rows: any[]) => {
          const g = groupBy(rows, (r:any)=>r.activity_date ? r.activity_date.substring(0,7) : "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue || r.total_revenue_inr),0),
              occupancy_avg: arr.length ? arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length : 0
            };
          }
          return out;
        };

        const resortByMonth = rollByResort(resorts);
        const months = Object.keys(resortByMonth).sort();
        const revenueDeclines: any[] = [];

        for (let i = 1; i < months.length; i++) {
          const prevMonth = resortByMonth[months[i-1]];
          const currMonth = resortByMonth[months[i]];
          const delta = currMonth.total_revenue - prevMonth.total_revenue;
          if (delta < 0) {
            const monthEvents = (events || []).filter((e:any)=>e.event_date && e.event_date.substring(0,7) === months[i]);
            if (monthEvents.length > 0) {
              revenueDeclines.push({
                month: months[i],
                revenue_decline_inr: delta,
                revenue_decline_pct: prevMonth.total_revenue ? ((delta / prevMonth.total_revenue) * 100).toFixed(1) : 0,
                events: monthEvents.map((e:any)=>({
                  event_type: e.event_type || null,
                  event_date: e.event_date || null,
                  impact_region: e.impact_region || null,
                  details: e.details_description || e.event_details_description || e.details || null,
                  weather_condition: e.weather_condition || null,
                  competitor_name: e.competitor_name || null,
                  relevance_score: e.relevance_score || e.event_relevance_score || null
                }))
              });
            }
          }
        }

        // If month is specified, also return all events for that month even if there's no revenue decline
        let allEventsForMonth: any[] = [];
        if (month) {
          const monthEvents = (events || []).filter((e:any)=>e.event_date && e.event_date.substring(0,7) === month);
          allEventsForMonth = monthEvents.map((e:any)=>({
            event_type: e.event_type || null,
            event_date: e.event_date || null,
            impact_region: e.impact_region || null,
            details: e.details_description || e.event_details_description || e.details || null,
            weather_condition: e.weather_condition || null,
            competitor_name: e.competitor_name || null,
            relevance_score: e.relevance_score || e.event_relevance_score || null
          }));
        }

        const result: any = {
          resort_name,
          region,
          analysis_period: { start_date: startDate, end_date: endDate },
          revenue_declines_with_events: revenueDeclines,
          summary: {
            total_decline_periods: revenueDeclines.length,
            total_events: revenueDeclines.reduce((a:any,r:any)=>a+r.events.length, 0)
          }
        };

        // Add all events for specified month if month parameter was provided
        if (month && allEventsForMonth.length > 0) {
          result.all_events_for_month = {
            month: month,
            events: allEventsForMonth,
            total_events: allEventsForMonth.length
          };
        } else if (month) {
          result.all_events_for_month = {
            month: month,
            events: [],
            total_events: 0
          };
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "insights_feedback_demographics": {
        const { sentiment, dimension, start_date, end_date } = args as { 
          sentiment?: string; 
          dimension?: string; 
          start_date?: string; 
          end_date?: string;
        };

        try {
          // Build feedback filters
          const feedbackFilters: Record<string, any> = {};
          if (sentiment) {
            feedbackFilters.sentiment = { operator: "ilike", value: sentiment };
          }
          if (start_date || end_date) {
            feedbackFilters.feedback_date = {};
            if (start_date) feedbackFilters.feedback_date.gte = start_date;
            if (end_date) feedbackFilters.feedback_date.lte = end_date;
          }

          // Fetch feedback
          const feedback = await querySupabaseTable("fact_feedback", buildQuery(feedbackFilters)) || [];
          
          if (feedback.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({ 
              message: "No feedback found matching criteria",
              breakdown: {}
            }, null, 2) }] };
          }

          // Get member IDs from feedback
          const memberIds = [...new Set(feedback.map((f:any) => f.member_id_fk).filter(Boolean))];
          
          // Fetch members
          const members = await querySupabaseTable("fact_member", buildQuery({
            member_id: { operator: "in", value: memberIds }
          })) || [];

          // Create member lookup map
          const memberMap = new Map(members.map((m:any) => [m.member_id, m]));

          // Join feedback with member data
          const feedbackWithDemographics = feedback.map((f:any) => {
            const member: any = memberMap.get(f.member_id_fk);
            return {
              ...f,
              gender: member?.gender || "Unknown",
              member_region: member?.member_region || member?.home_region || "Unknown",
              age_group: member?.age_group || "Unknown"
            };
          });

          // Determine which dimensions to analyze
          const dimensionsToAnalyze = dimension ? [dimension] : ["gender", "member_region", "age_group"];

          const breakdown: Record<string, any> = {};
          const totalFeedback = feedbackWithDemographics.length;

          for (const dim of dimensionsToAnalyze) {
            const grouped = groupBy(feedbackWithDemographics, (f:any) => {
              if (dim === "gender") return f.gender || "Unknown";
              if (dim === "member_region") return f.member_region || "Unknown";
              if (dim === "age_group") return f.age_group || "Unknown";
              return "Unknown";
            });

            const dimBreakdown = Object.entries(grouped).map(([key, arr]) => ({
              [dim]: key,
              count: arr.length,
              percentage: totalFeedback > 0 ? ((arr.length / totalFeedback) * 100).toFixed(2) : "0.00"
            })).sort((a, b) => b.count - a.count);

            breakdown[dim] = dimBreakdown;
          }

          return { content: [{ type: "text", text: JSON.stringify({ 
            sentiment: sentiment || "all",
            total_feedback: totalFeedback,
            breakdown
          }, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: JSON.stringify({ 
            error: "Failed to analyze feedback demographics",
            message: error.message || "Unknown error"
          }, null, 2) }] };
        }
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

// Create HTTP server
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer();

// Store transports per session
const transportStore = new Map<string, StreamableHTTPServerTransport>();

// Create a shared server instance
const createTransport = (sessionId: string) => {
  if (!transportStore.has(sessionId)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });
    server.connect(transport).catch((error) => {
      console.error("Failed to connect server to transport:", error);
    });
    transportStore.set(sessionId, transport);
  }
  return transportStore.get(sessionId)!;
};

httpServer.on("request", async (req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // Parse body for POST requests
    let parsedBody: unknown = undefined;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString();
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }
      }
    }

    // Get or create session ID
    let sessionId = req.headers["mcp-session-id"] as string;
    const isInitializeRequest = 
      parsedBody && 
      typeof parsedBody === "object" && 
      "method" in parsedBody && 
      parsedBody.method === "initialize";

    // If no session ID, create one and auto-initialize
    if (!sessionId && req.method === "POST" && parsedBody && !isInitializeRequest) {
      sessionId = randomUUID();
      req.headers["mcp-session-id"] = sessionId;
      
      // Get or create transport for this session
      const transport = createTransport(sessionId);
      
      // First, handle initialize internally
      const initReq = { ...req, headers: { ...req.headers, "mcp-session-id": sessionId } };
      const initializePayload = {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "devrev-mcp-client",
            version: "1.0.0"
          }
        },
        id: 0
      };
      
      // Create a mock response for initialization
      const initRes = {
        writeHead: () => {},
        setHeader: () => {},
        end: () => {},
        write: () => true,
        on: () => {},
        once: () => {},
        emit: () => true,
        headersSent: false,
        statusCode: 200,
        getHeader: () => undefined,
        removeHeader: () => {},
        flushHeaders: () => {}
      };

      // Initialize session
      await transport.handleRequest(initReq as any, initRes as any, initializePayload);
      
      // Now handle the actual request
      await transport.handleRequest(initReq as any, res, parsedBody);
      return;
    }

    // Use existing session or create new one
    if (!sessionId) {
      sessionId = randomUUID();
    }
    
    const transport = createTransport(sessionId);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error("Request handling error:", error);
    console.error("Error details:", error instanceof Error ? error.stack : String(error));
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error)
        },
        id: null
      }));
    }
  }
});

// Start HTTP server
httpServer.listen(PORT, () => {
  console.error(`Supabase MCP server (SSE/Streamable HTTP) running on http://localhost:${PORT}`);
  console.error(`MCP endpoint: http://localhost:${PORT}/`);
  console.error(`Connect MCP clients to: http://localhost:${PORT}/`);
});

