#!/usr/bin/env node

import express from "express";
import cors from "cors";

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

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON bodies

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Supabase MCP HTTP Server",
    version: "1.0.0",
    endpoints: {
      "GET /api/tools": "List all available tools",
      "GET /api/members": "Get members data",
      "GET /api/resorts": "Get resorts data",
      "GET /api/feedback": "Get feedback data",
      "GET /api/events": "Get events data",
      "POST /api/analyze": "Perform analytical queries",
      "POST /api/query": "Generic query with filters",
    },
  });
});

// List all available tools
app.get("/api/tools", (req, res) => {
  res.json({
    tools: [
      {
        name: "get_members",
        description: "Retrieve member data from the fact_member table",
        method: "GET",
        endpoint: "/api/members",
      },
      {
        name: "get_resorts",
        description: "Retrieve resort data from the fact_resort table",
        method: "GET",
        endpoint: "/api/resorts",
      },
      {
        name: "get_feedback",
        description: "Retrieve feedback data from the fact_feedback table",
        method: "GET",
        endpoint: "/api/feedback",
      },
      {
        name: "get_events",
        description: "Retrieve event data from the fact_event table",
        method: "GET",
        endpoint: "/api/events",
      },
      {
        name: "analyze_data",
        description: "Perform analytical queries across Supabase tables",
        method: "POST",
        endpoint: "/api/analyze",
      },
      {
        name: "query_table",
        description: "Generic query tool with advanced filtering",
        method: "POST",
        endpoint: "/api/query",
      },
    ],
  });
});

// Get members
app.get("/api/members", async (req, res) => {
  try {
    const { limit, order, select } = req.query;
    const params: Record<string, string> = {};
    
    if (limit) params.limit = String(limit);
    if (order) params.order = String(order);
    if (select) params.select = String(select);

    const data = await querySupabaseTable("fact_member", params);
    res.json({
      success: true,
      data,
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Get resorts
app.get("/api/resorts", async (req, res) => {
  try {
    const { limit, order, select } = req.query;
    const params: Record<string, string> = {};
    
    if (limit) params.limit = String(limit);
    if (order) params.order = String(order);
    if (select) params.select = String(select);

    const data = await querySupabaseTable("fact_resort", params);
    res.json({
      success: true,
      data,
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Get feedback
app.get("/api/feedback", async (req, res) => {
  try {
    const { limit, order, select } = req.query;
    const params: Record<string, string> = {};
    
    if (limit) params.limit = String(limit);
    if (order) params.order = String(order);
    if (select) params.select = String(select);

    const data = await querySupabaseTable("fact_feedback", params);
    res.json({
      success: true,
      data,
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Get events
app.get("/api/events", async (req, res) => {
  try {
    const { limit, order, select } = req.query;
    const params: Record<string, string> = {};
    
    if (limit) params.limit = String(limit);
    if (order) params.order = String(order);
    if (select) params.select = String(select);

    const data = await querySupabaseTable("fact_event", params);
    res.json({
      success: true,
      data,
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Analyze data
app.post("/api/analyze", async (req, res) => {
  try {
    const { table, operation, field } = req.body;

    if (!table || !operation) {
      return res.status(400).json({
        success: false,
        error: "Table and operation are required",
      });
    }

    if (!["fact_member", "fact_resort", "fact_feedback", "fact_event"].includes(table)) {
      return res.status(400).json({
        success: false,
        error: "Invalid table name. Must be one of: fact_member, fact_resort, fact_feedback, fact_event",
      });
    }

    if (!["count", "list", "aggregate"].includes(operation)) {
      return res.status(400).json({
        success: false,
        error: "Invalid operation. Must be one of: count, list, aggregate",
      });
    }

    const result = await performAnalyticalQuery(table, operation, field);
    res.json({
      success: true,
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Generic query with filters
app.post("/api/query", async (req, res) => {
  try {
    const { table, filters, limit, order } = req.body;

    if (!table) {
      return res.status(400).json({
        success: false,
        error: "Table name is required",
      });
    }

    if (!["fact_member", "fact_resort", "fact_feedback", "fact_event"].includes(table)) {
      return res.status(400).json({
        success: false,
        error: "Invalid table name. Must be one of: fact_member, fact_resort, fact_feedback, fact_event",
      });
    }

    const queryParams: Record<string, string> = {};
    if (limit) queryParams.limit = String(limit);
    if (order) queryParams.order = String(order);

    // Build filter query string if filters provided
    if (filters && Object.keys(filters).length > 0) {
      Object.entries(filters).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'operator' in value) {
          const op = (value as any).operator || 'eq';
          const val = (value as any).value;
          queryParams[key] = `${op}.${val}`;
        } else {
          queryParams[key] = `eq.${value}`;
        }
      });
    }

    const data = await querySupabaseTable(table, queryParams);
    res.json({
      success: true,
      data,
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Supabase MCP HTTP Server running on http://localhost:${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/`);
});

