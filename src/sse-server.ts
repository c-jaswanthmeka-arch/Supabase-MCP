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
      "Retrieve member data from the fact_member table. Use ONLY when user wants to SEE member records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. Column names: 'date_joined' for date queries (NOT 'joining_date'), 'is_active' for active status (NOT 'status'), 'membership_tier' for tier (e.g., 'Red', 'White'), 'home_region' for region, 'lifetime_value_inr' for customer value. Use to analyze customer segments by membership_tier, region, or date_joined. For customer analysis: Query members by membership_tier to identify which resorts attract specific customer tiers, cross-reference with resort data to find resorts popular with Red tier customers. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Retrieve resort data from the fact_resort table. Use ONLY when user wants to SEE resort records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. Column names: 'activity_date' for date queries, 'resort_name' for resort name (use 'ilike' operator for case-insensitive matching), 'resort_region' for region, 'total_revenue_inr', 'ancillary_revenue_inr', 'restaurant_revenue_inr' for revenue, 'occupancy_rate_perc', 'member_rooms_booked', 'total_rooms_available' for occupancy. Use to analyze resort performance, compare revenue across time periods, identify trends, and correlate with events or feedback. For sales analysis: Query resort data for specific months/resorts, compare revenue and occupancy rates, identify low-performing periods. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Retrieve feedback data from the fact_feedback table. Use ONLY when user wants to SEE feedback records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. Column names: 'log_date' (NOT 'feedback_date') for date queries, 'resort_name_fk' for resort name, 'member_id_fk' for member, 'nps_score' for NPS score, 'csat_score' for CSAT score, 'sentiment' for sentiment, 'details_text' for feedback text. Use to analyze feedback by resort, date range, or nps_score. For feedback analysis: Query feedback by resort_name_fk to see resort-specific feedback, filter by log_date (NOT feedback_date) to correlate with sales performance, filter by nps_score to find poor feedback. Cross-reference with resort data to identify resorts affected by poor feedback. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Retrieve event data from the fact_event table. Use ONLY when user wants to SEE event records (not count them). NEVER use for counting - always use analyze_data for counts. When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. Column names: 'event_date' for date queries, 'impact_region' for regional filtering. Event types: 'Local News', 'Economic News', 'Major Weather', 'Competitor Promo', 'Local Event'. Use 'weather_condition', 'competitor_name', 'relevance_score', 'details_description' for analysis. Important for sales/revenue analysis: Query events table to find potential reasons for low sales (weather, competitor promotions, economic factors, local events). Use to identify which resorts were affected by external events in a specific time period. Filter by 'impact_region' to find events affecting specific regions. Cross-reference with resort data to identify correlations between events and sales performance. For questions about resorts affected by events: Query events for a specific time period/region, then cross-reference with resort data to identify affected resorts. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Perform analytical queries across the Supabase tables. This is the ONLY correct tool for counting records and aggregations. NEVER use get_members/get_resorts/get_feedback/get_events for counting. Use when user asks for 'count', 'total number', 'how many', 'number of', 'average', 'min', 'max', 'sum'. Supports counting filtered results if filters are provided. For date ranges, use column names: 'date_joined' (NOT 'joining_date') for fact_member, 'activity_date' for fact_resort, 'event_date' for fact_event, 'log_date' (NOT 'feedback_date') for fact_feedback. Format: filters: {'date_joined': {'gte': '2018-01-01', 'lte': '2018-12-31'}}. For aggregations, specify the field parameter (e.g., 'total_revenue_inr' for revenue analysis). Can combine with filters to analyze specific time periods, resorts, or conditions. Use this tool to compare revenue across months, resorts, or regions. For sales analysis: compare revenue between months, identify low-performing periods, analyze occupancy rates. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Generic query tool for any Supabase table with advanced filtering and querying capabilities. Use when user wants filtered results or to SHOW/DISPLAY records with conditions. CRITICAL: Table name MUST be one of: 'fact_member', 'fact_resort', 'fact_feedback', 'fact_event' (always use 'fact_' prefix, never use 'resorts', 'members', 'feedback', or 'events'). Supports advanced filtering with operators (eq, gt, gte, lt, lte, like, ilike). When user asks for 'all' records, omit the limit parameter. When user asks for a specific number, set limit to that number. For date ranges, use column names: 'date_joined' (NOT 'joining_date') for fact_member, 'activity_date' for fact_resort, 'event_date' for fact_event, 'log_date' (NOT 'feedback_date') for fact_feedback. CRITICAL FORMAT: 'filters' MUST be an OBJECT (not an array). Examples: Simple equality: {'membership_tier': 'Red'}. With operator: {'membership_tier': {'operator': 'eq', 'value': 'Red'}}. Date range: {'date_joined': {'gte': '2018-01-01', 'lte': '2018-12-31'}}. Multiple filters: {'membership_tier': 'Red', 'is_active': true}. For resort names, use 'ilike' operator for case-insensitive matching: {'resort_name': {'operator': 'ilike', 'value': 'Assanora'}}. DO NOT use array format like [{'column': '...', 'operator': '...', 'value': '...'}]. There is NO 'columns' parameter. For sales/revenue analysis: Query fact_resort data for specific time periods/resorts, then query fact_event table for the same time period to find potential reasons (weather, competitor promotions, economic factors, local events). For feedback analysis: Query fact_feedback by resort_name_fk, log_date (NOT feedback_date), or nps_score. For customer analysis: Query fact_member by membership_tier, region, or date_joined. For cross-referencing: Query resorts affected by events in a specific region/time, resorts with poor feedback, resorts attracting specific customer tiers. IMPORTANT: Execute queries directly without showing your thinking process or step-by-step reasoning. Provide concise responses with only the results.",
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
      "Find which resorts' sales were affected by external events within a date range. Input: start_date, end_date. Output: resorts with revenue/occupancy dips aligned to events, listing the events. Do not expose internal steps.",
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
      "Heuristic forecast of upcoming booking surges using recent trends (revenue, occupancy), improving sentiment, and benign events. Input: month ('YYYY-MM') to forecast. Output: resorts expected to surge and key drivers. Do not expose internal steps.",
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
    name: "insights_resort_feedback_analysis",
    description:
      "Analyze feedback for a specific resort within a date range. Provides comprehensive feedback analysis including sentiment breakdown, key themes, NPS/CSAT scores, and sample quotes. Input: resort_name (required), date_range with start and end (required, format: YYYY-MM-DD). Output: JSON summary with feedback statistics, themes, and insights. Do not expose internal steps.",
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
      "Analyze member lifetime value (LTV) by region, membership tier, or date joined. Identifies high-value segments, average LTV trends, and members at risk. Optional filters: region, membership_tier, start_date, end_date. Output: JSON with LTV statistics, segment analysis, and risk indicators. Do not expose internal steps.",
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
      "Analyze how weather conditions affect resort performance. Correlates weather events with revenue and occupancy changes. Optional date range. Output: JSON with weather-impacted resorts, performance changes, and weather event details. Do not expose internal steps.",
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
      "Compare sales between two months to identify resorts with low sales. Input: month1 ('YYYY-MM'), month2 ('YYYY-MM'). Output: JSON with resorts showing lower sales in month2 compared to month1, with revenue deltas and percentage changes. Use for questions like 'Which resorts showed low sales in October than in September 2025'. Do not expose internal steps.",
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
      "Analyze reasons for lower revenue for a specific resort in a specific month. Combines resort performance data, events, and feedback to identify root causes. Input: resort_name, month ('YYYY-MM'). Output: JSON with revenue comparison vs previous month, identified reasons (events, feedback, occupancy), and key drivers. Use for questions like 'What were the reasons for lower revenue in Acacia Palms in October 2025'. Do not expose internal steps.",
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
      "Identify resorts where lower revenue in a month correlates with negative feedback from previous months. Input: month ('YYYY-MM') of the revenue month to evaluate. Output: JSON with resorts showing revenue decline, associated negative feedback themes, and correlation strength. Use for questions like 'Which resorts saw a lower revenue in a month with a co-relation to negative feedback'. Do not expose internal steps.",
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
      "Find feedback from members who have not paid Annual Subscription Fee (ASF) for 2 years. Identifies members with unpaid ASF for 2+ years and retrieves their feedback. Output: JSON with member details, ASF payment status, and their feedback (if any). Use for questions like 'Is there any negative feedback from members who have not paid ASF for 2 years, what is it'. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "insights_resort_event_decline",
    description:
      "Identify external events that led to revenue decline for a specific resort. Analyzes events in the resort's region/time period and correlates with revenue drops. Input: resort_name. Output: JSON with events affecting the resort, revenue impact, and event details. Use for questions like 'What external events led to decline in revenue for Saj resort'. Do not expose internal steps.",
    inputSchema: {
      type: "object",
      properties: {
        resort_name: { type: "string", description: "Name of the resort (e.g., 'Saj')" }
      },
      required: ["resort_name"]
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

      case "get_events": {
        const eventParams: Record<string, string> = {};
        if (args?.limit) {
          eventParams.limit = String(args.limit);
        } else {
          eventParams.limit = "10000";
        }
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
        const { table, operation, field, filters } = args as {
          table: string;
          operation: string;
          field?: string;
          filters?: Record<string, any>;
        };

        if (!table || !operation) {
          throw new Error("Table and operation are required");
        }

        const result = await performAnalyticalQuery(table, operation, field, filters);
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
              const val = (value as any).value;
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
          log_date: { gte: prev2.start, lte: prev.end },
          ...(resort_name ? { resort_name_fk: { operator: "ilike", value: resort_name } } : {})
        }));

        const feedbackByResort = groupBy(feedback, (f:any)=>f.resort_name_fk || "Unknown");
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
          const fbThemes = topKeywords(negF.map((x:any)=>x.details_text || ""), 6);

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
        const byRegion = groupBy(events, (e:any)=>e.impact_region || "Unknown");

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
            const sum = (f:string)=>arr.reduce((a:any,r:any)=>a+safeNumber(r[f]),0);
            out[k] = {
              revenue: sum("total_revenue_inr"),
              region: arr[0]?.resort_region ?? null,
              occupancy_avg: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/(arr.length||1)
            };
          }
          return out;
        };

        const A = rollByResort(resorts);
        const B = rollByResort(resortsPrev);

        const impacted: any[] = [];
        for (const [resort, cur] of Object.entries(A)) {
          const prev = B[resort] || { revenue: 0, occupancy_avg: 0, region: null };
          const delta = safeNumber((cur as any).revenue) - safeNumber(prev.revenue);
          const region = (cur as any).region || "Unknown";
          const evts = byRegion[region] || [];
          const drop = prev.revenue ? delta/prev.revenue : 0;
          if (drop < -0.10 && evts.length) {
            impacted.push({
              resort_name: resort,
              region,
              revenue_prev_inr: prev.revenue,
              revenue_curr_inr: (cur as any).revenue,
              change_pct: +((delta/prev.revenue)*100).toFixed(1),
              events: evts.map((e:any)=>({
                date:e.event_date, type:e.event_type, weather:e.weather_condition,
                competitor:e.competitor_name, details:e.details_description, relevance_score:e.relevance_score
              }))
            });
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ impacted }, null, 2) }] };
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
        const fbByResort = groupBy(fb, (x:any)=>x.resort_name_fk || "Unknown");

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
              themes: topKeywords(neg.map((x:any)=>x.details_text || ""), 6)
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

        const res1 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r1.start, lte: r1.end } }));
        const res2 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r2.start, lte: r2.end } }));

        const roll = (rows:any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            const sum = (f:string)=>arr.reduce((a:any,r:any)=>a+safeNumber(r[f]),0);
            const avg = (f:string)=>arr.length ? sum(f)/arr.length : 0;
            out[k] = { revenue: sum("total_revenue_inr"), occupancy_avg: avg("occupancy_rate_perc"), region: arr[0]?.resort_region ?? null };
          }
          return out;
        };

        const A = roll(res1); // older
        const B = roll(res2); // recent
        const events = await querySupabaseTable("fact_event", buildQuery({ event_date: { gte: forecastWindow.start, lte: forecastWindow.end } }));
        const fb = await querySupabaseTable("fact_feedback", buildQuery({ log_date: { gte: r2.start, lte: forecastWindow.start } }));

        const evByRegion = groupBy(events, (e:any)=>e.impact_region || "Unknown");
        const fbByResort = groupBy(fb, (x:any)=>x.resort_name_fk || "Unknown");

        const forecast: any[] = [];
        for (const [resort, newer] of Object.entries(B)) {
          const older = A[resort] || { revenue: 0, occupancy_avg: 0, region: null };
          const trendRevPct = older.revenue ? ((newer as any).revenue - older.revenue)/older.revenue : 0;
          const trendOcc = safeNumber((newer as any).occupancy_avg) - safeNumber(older.occupancy_avg);

          const region = (newer as any).region || "Unknown";
          const evts = evByRegion[region] || [];
          const hasNegativeEvent = evts.some((e:any)=> String(e.event_type).match(/Major Weather|Economic News|Competitor Promo/i));

          const fbs = fbByResort[resort] || [];
          const negCount = fbs.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3).length;

          // Heuristic: rising revenue OR occupancy + low negatives + no adverse forecast events
          if ((trendRevPct > 0.08 || trendOcc > 2) && !hasNegativeEvent && negCount <= 2) {
            forecast.push({
              resort_name: resort,
              region,
              expected_surge: true,
              drivers: {
                trend_revenue_pct: +((trendRevPct)*100).toFixed(1),
                trend_occupancy_delta: +trendOcc.toFixed(1),
                recent_negative_feedback: negCount,
                notable_events_in_forecast_window: evts.length
              }
            });
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ forecast }, null, 2) }] };
      }

      case "insights_red_tier_attraction": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const memberFilters: Record<string, any> = { membership_tier: { operator: "eq", value: "Red" } };
        if (start_date || end_date) memberFilters.date_joined = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        // We assume member records include a preferred_or_recent_resort field or mapping; if not, this will return tier counts only.
        const members = await querySupabaseTable("fact_member", buildQuery(memberFilters));

        // Try to bind by recent feedback/reference to a resort
        const fb = await querySupabaseTable("fact_feedback", buildQuery({
          ...(start_date || end_date ? { log_date: { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) } } : {}),
          // Only Red tier members if your feedback table contains member_id_fk
        }));

        // Aggregate by resort_name_fk from feedback as proxy for engagement
        const byResort = groupBy(fb.filter((x:any)=> x.membership_tier === "Red" || members.some((m:any)=> m.member_id === x.member_id_fk && m.membership_tier === "Red")), (x:any)=>x.resort_name_fk || "Unknown");
        const ranking = Object.entries(byResort)
          .map(([resort, arr])=>({ resort_name: resort, red_tier_interactions: arr.length }))
          .sort((a,b)=>b.red_tier_interactions - a.red_tier_interactions);

        return { content: [{ type: "text", text: JSON.stringify({ ranking }, null, 2) }] };
      }

      case "insights_red_tier_poor_feedback": {
        const { start_date, end_date } = args as { start_date?: string; end_date?: string };
        const fbFilters: Record<string, any> = {};
        if (start_date || end_date) fbFilters.log_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };
        const fb = await querySupabaseTable("fact_feedback", buildQuery(fbFilters));

        // Filter to Red tier (assuming feedback carries membership_tier OR join to members if needed)
        const members = await querySupabaseTable("fact_member", buildQuery({ membership_tier: { operator: "eq", value: "Red" } }));
        const redFb = fb.filter((x:any)=> {
          const member = members.find((m:any)=> m.member_id === x.member_id_fk);
          return member && member.membership_tier === "Red";
        });
        const byResort = groupBy(redFb, (x:any)=>x.resort_name_fk || "Unknown");

        const out = Object.entries(byResort).map(([resort, arr]) => {
          const neg = arr.filter((x:any)=> (x.sentiment && String(x.sentiment).toLowerCase()==="negative") || safeNumber(x.nps_score) <= 6 || safeNumber(x.csat_score) <= 3);
          return {
            resort_name: resort,
            negative_count: neg.length,
            sample_quotes: neg.slice(0,5).map((x:any)=> x.details_text).filter(Boolean),
            themes: topKeywords(neg.map((x:any)=>x.details_text || ""), 8)
          };
        }).sort((a,b)=>b.negative_count - a.negative_count);

        return { content: [{ type: "text", text: JSON.stringify({ resorts: out }, null, 2) }] };
      }

      case "insights_resort_feedback_analysis": {
        const { resort_name, date_range } = args as { resort_name: string; date_range: { start: string; end: string } };
        const { start, end } = date_range;

        const feedback = await querySupabaseTable("fact_feedback", buildQuery({
          resort_name_fk: { operator: "ilike", value: resort_name },
          log_date: { gte: start, lte: end }
        }));

        if (!Array.isArray(feedback) || feedback.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ 
            resort_name, 
            date_range: { start, end },
            message: "No feedback found for this resort in the specified date range",
            total_feedback: 0
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

        const themes = topKeywords(feedback.map((x:any)=>x.details_text || ""), 10);
        const positiveThemes = topKeywords(positive.map((x:any)=>x.details_text || ""), 5);
        const negativeThemes = topKeywords(negative.map((x:any)=>x.details_text || ""), 5);

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
              quote: x.details_text,
              nps_score: x.nps_score,
              csat_score: x.csat_score,
              platform: x.platform,
              date: x.log_date
            })),
            negative: negative.slice(0, 5).map((x:any)=>({
              quote: x.details_text,
              nps_score: x.nps_score,
              csat_score: x.csat_score,
              platform: x.platform,
              issue_type: x.issue_type_category,
              date: x.log_date
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

        return { content: [{ type: "text", text: JSON.stringify({ ltv_statistics: ltvStats, by_region: regionAnalysis, by_tier: tierAnalysis, at_risk_members: atRisk.slice(0,50) }, null, 2) }] };
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
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
          average_occupancy: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length,
          total_rooms_booked: arr.reduce((a:any,r:any)=>a+safeNumber(r.member_rooms_booked),0),
          resort_count: new Set(arr.map((r:any)=>r.resort_name)).size,
          average_revenue_per_resort: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0) / new Set(arr.map((r:any)=>r.resort_name)).size
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
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
          average_occupancy: arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length,
          total_bookings: arr.reduce((a:any,r:any)=>a+safeNumber(r.member_rooms_booked),0),
          resort_count: new Set(arr.map((r:any)=>r.resort_name)).size,
          average_revenue_per_resort: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0) / new Set(arr.map((r:any)=>r.resort_name)).size
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

        const totalAncillary = resorts.reduce((a:any,r:any)=>a+safeNumber(r.ancillary_revenue_inr),0);
        const totalRestaurant = resorts.reduce((a:any,r:any)=>a+safeNumber(r.restaurant_revenue_inr),0);
        const totalRevenue = resorts.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0);

        const byResort = groupBy(resorts, (r:any)=>r.resort_name || "Unknown");
        const resortAnalysis = Object.entries(byResort).map(([resort, arr])=>({
          resort_name: resort,
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
          ancillary_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.ancillary_revenue_inr),0),
          restaurant_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.restaurant_revenue_inr),0),
          ancillary_percentage: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0) > 0 ? 
            +((arr.reduce((a:any,r:any)=>a+safeNumber(r.ancillary_revenue_inr),0) / arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0))*100).toFixed(1) : 0,
          restaurant_percentage: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0) > 0 ? 
            +((arr.reduce((a:any,r:any)=>a+safeNumber(r.restaurant_revenue_inr),0) / arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0))*100).toFixed(1) : 0
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
              revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
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
        const eventFilters: Record<string, any> = { event_type: { operator: "eq", value: "Major Weather" } };
        if (start_date || end_date) eventFilters.event_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const events = await querySupabaseTable("fact_event", buildQuery(eventFilters));
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
              revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
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
        if (start_date || end_date) fbFilters.log_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

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
        if (resort_name) fbFilters.resort_name_fk = { operator: "ilike", value: resort_name };
        if (start_date || end_date) fbFilters.log_date = { ...(start_date ? { gte: start_date } : {}), ...(end_date ? { lte: end_date } : {}) };

        const feedback = await querySupabaseTable("fact_feedback", buildQuery(fbFilters));
        if (!Array.isArray(feedback) || feedback.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No feedback found" }, null, 2) }] };
        }

        const byIssueType = groupBy(feedback, (f:any)=>f.issue_type_category || "Unknown");
        const byResort = groupBy(feedback, (f:any)=>f.resort_name_fk || "Unknown");

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
            total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
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
        const feedback = await querySupabaseTable("fact_feedback", buildQuery({ log_date: { gte: startDate, lte: endDate } }));

        if (!Array.isArray(resorts) || resorts.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No data found for year", year: y }, null, 2) }] };
        }

        const byMonth = groupBy(resorts, (r:any)=>r.activity_date ? r.activity_date.substring(0,7) : "Unknown");
        const fbByMonth = groupBy(feedback, (f:any)=>f.log_date ? f.log_date.substring(0,7) : "Unknown");

        const monthlyTrends = Object.entries(byMonth).map(([month, arr])=>({
          month,
          total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
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
        const r1 = monthRange(month1);
        const r2 = monthRange(month2);

        const resorts1 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r1.start, lte: r1.end } }));
        const resorts2 = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: r2.start, lte: r2.end } }));

        const rollByResort = (rows: any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
              occupancy_avg: arr.length ? arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length : 0,
              region: arr[0]?.resort_region ?? null
            };
          }
          return out;
        };

        const A = rollByResort(resorts1);
        const B = rollByResort(resorts2);

        const lowSales: any[] = [];
        for (const [resort, m2] of Object.entries(B)) {
          const m1 = A[resort] || { total_revenue: 0 };
          const delta = safeNumber((m2 as any).total_revenue) - safeNumber(m1.total_revenue);
          const pctChange = m1.total_revenue ? (delta / m1.total_revenue) * 100 : 0;
          if (delta < 0) {
            lowSales.push({
              resort_name: resort,
              month1_revenue_inr: m1.total_revenue,
              month2_revenue_inr: (m2 as any).total_revenue,
              revenue_delta_inr: delta,
              percentage_change: +pctChange.toFixed(1),
              region: (m2 as any).region
            });
          }
        }

        lowSales.sort((a,b)=>a.revenue_delta_inr - b.revenue_delta_inr);

        return { content: [{ type: "text", text: JSON.stringify({ 
          month1,
          month2,
          resorts_with_low_sales: lowSales,
          summary: {
            total_resorts_with_decline: lowSales.length,
            largest_decline: lowSales[0] || null
          }
        }, null, 2) }] };
      }

      case "insights_resort_revenue_reasons": {
        const { resort_name, month } = args as { resort_name: string; month: string };
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

        const resortsCurr = await querySupabaseTable("fact_resort", buildQuery(resortFiltersCurr));
        const resortsPrev = await querySupabaseTable("fact_resort", buildQuery(resortFiltersPrev));

        const roll = (rows: any[]) => {
          if (!rows.length) return { total_revenue: 0, occupancy_avg: 0, member_rooms: 0, total_rooms: 0 };
          return {
            total_revenue: rows.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
            occupancy_avg: rows.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/rows.length,
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
        const eventFilters: Record<string, any> = { event_date: { gte: curr.start, lte: curr.end } };
        if (region) eventFilters.impact_region = { operator: "ilike", value: region };
        const events = await querySupabaseTable("fact_event", buildQuery(eventFilters));

        const feedbackFilters: Record<string, any> = { 
          log_date: { gte: prev.start, lte: curr.end },
          resort_name_fk: { operator: "ilike", value: resort_name }
        };
        const feedback = await querySupabaseTable("fact_feedback", buildQuery(feedbackFilters));
        const negativeFeedback = (feedback || []).filter((f:any)=>safeNumber(f.nps_score) < 7 || (f.sentiment && f.sentiment.toLowerCase().includes('negative')));

        const reasons: string[] = [];
        const eventDetails: any[] = [];
        if (events && events.length) {
          const weatherEvents = events.filter((e:any)=>e.event_type === "Major Weather");
          const competitorEvents = events.filter((e:any)=>e.event_type === "Competitor Promo");
          const localEvents = events.filter((e:any)=>e.event_type === "Local Event");
          if (weatherEvents.length) {
            reasons.push("Weather events");
            eventDetails.push(...weatherEvents.map((e:any)=>({ type: "Weather", date: e.event_date, details: e.details_description })));
          }
          if (competitorEvents.length) {
            reasons.push("Competitor promotions");
            eventDetails.push(...competitorEvents.map((e:any)=>({ type: "Competitor", date: e.event_date, competitor: e.competitor_name, details: e.details_description })));
          }
          if (localEvents.length) {
            reasons.push("Local events");
            eventDetails.push(...localEvents.map((e:any)=>({ type: "Local Event", date: e.event_date, details: e.details_description })));
          }
        }
        if (negativeFeedback.length) {
          reasons.push("Negative feedback from previous period");
        }
        if (currData.occupancy_avg < prevData.occupancy_avg - 5) {
          reasons.push("Lower occupancy rate");
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
          identified_reasons: reasons,
          events: eventDetails,
          negative_feedback_count: negativeFeedback.length,
          negative_feedback_themes: negativeFeedback.length > 0 ? topKeywords(negativeFeedback.map((f:any)=>f.details_text || "").filter(Boolean), 5) : []
        }, null, 2) }] };
      }

      case "insights_revenue_feedback_correlation": {
        const { month } = args as { month: string };
        const curr = monthRange(month);
        const prevYm = previousMonth(month);
        const prev = monthRange(prevYm);

        const resortsCurr = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: curr.start, lte: curr.end } }));
        const resortsPrev = await querySupabaseTable("fact_resort", buildQuery({ activity_date: { gte: prev.start, lte: prev.end } }));
        const feedback = await querySupabaseTable("fact_feedback", buildQuery({ log_date: { gte: prev.start, lte: prev.end } }));

        const rollByResort = (rows: any[]) => {
          const g = groupBy(rows, (r:any)=>r.resort_name || "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
              occupancy_avg: arr.length ? arr.reduce((a:any,r:any)=>a+safeNumber(r.occupancy_rate_perc),0)/arr.length : 0
            };
          }
          return out;
        };

        const A = rollByResort(resortsPrev);
        const B = rollByResort(resortsCurr);

        const fbByResort = groupBy(feedback || [], (f:any)=>f.resort_name_fk || "Unknown");
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
          if (delta < 0 && negFb.length) {
            correlated.push({
              resort_name: resort,
              revenue_decline_inr: delta,
              revenue_decline_pct: +pctChange.toFixed(1),
              negative_feedback_count: negFb.length,
              feedback_themes: topKeywords(negFb.map((f:any)=>f.details_text || "").filter(Boolean), 5),
              correlation_strength: negFb.length > 5 ? "Strong" : negFb.length > 2 ? "Moderate" : "Weak"
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
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const cutoffDate = twoYearsAgo.toISOString().slice(0, 10);

        const members = await querySupabaseTable("fact_member", buildQuery({}));
        const unpaidMembers = (members || []).filter((m:any) => {
          const asfStatus = m.annual_fee_collection_status;
          const lastPaid = m.last_holiday_date || m.date_joined;
          if (asfStatus && (asfStatus.toLowerCase() === "unpaid" || asfStatus.toLowerCase() === "late")) {
            if (!lastPaid || lastPaid < cutoffDate) {
              return true;
            }
          }
          return false;
        });

        if (unpaidMembers.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ 
            message: "No members found with unpaid ASF for 2+ years",
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
            last_holiday_date: m.last_holiday_date,
            date_joined: m.date_joined,
            total_feedback_count: memberFb.length,
            negative_feedback_count: negativeFb.length,
            negative_feedback: negativeFb.length > 0 ? negativeFb.map((f:any)=>({
              date: f.log_date,
              resort: f.resort_name_fk,
              nps_score: f.nps_score,
              sentiment: f.sentiment,
              details: f.details_text
            })) : []
          };
        });

        return { content: [{ type: "text", text: JSON.stringify({ 
          total_unpaid_members: result.length,
          members_with_feedback: result.filter((m:any)=>m.total_feedback_count > 0).length,
          members_with_negative_feedback: result.filter((m:any)=>m.negative_feedback_count > 0).length,
          members: result
        }, null, 2) }] };
      }

      case "insights_resort_event_decline": {
        const { resort_name } = args as { resort_name: string };
        
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

        const eventFilters: Record<string, any> = { event_date: { gte: startDate, lte: endDate } };
        if (region) eventFilters.impact_region = { operator: "ilike", value: region };
        const events = await querySupabaseTable("fact_event", buildQuery(eventFilters));

        const rollByResort = (rows: any[]) => {
          const g = groupBy(rows, (r:any)=>r.activity_date ? r.activity_date.substring(0,7) : "Unknown");
          const out: Record<string, any> = {};
          for (const [k, arr] of Object.entries(g)) {
            out[k] = {
              total_revenue: arr.reduce((a:any,r:any)=>a+safeNumber(r.total_revenue_inr),0),
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
                  event_type: e.event_type,
                  event_date: e.event_date,
                  impact_region: e.impact_region,
                  details: e.details_description,
                  weather_condition: e.weather_condition,
                  competitor_name: e.competitor_name,
                  relevance_score: e.relevance_score
                }))
              });
            }
          }
        }

        return { content: [{ type: "text", text: JSON.stringify({ 
          resort_name,
          region,
          analysis_period: { start_date: startDate, end_date: endDate },
          revenue_declines_with_events: revenueDeclines,
          summary: {
            total_decline_periods: revenueDeclines.length,
            total_events: revenueDeclines.reduce((a:any,r:any)=>a+r.events.length, 0)
          }
        }, null, 2) }] };
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

