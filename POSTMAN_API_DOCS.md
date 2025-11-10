# Postman API Documentation for Supabase MCP Server

## Base URL
```
http://localhost:3000
```

## Transport Method
**HTTP REST API** - All endpoints use standard HTTP methods (GET, POST)

## Authentication
**No authentication required** - All endpoints are open for testing

---

## API Endpoints

### 1. Health Check & API Info
**GET** `/`

**Description:** Get server information and available endpoints

**Request:**
- Method: `GET`
- URL: `http://localhost:3000/`
- Headers: None required
- Body: None

**Response:**
```json
{
  "message": "Supabase MCP HTTP Server",
  "version": "1.0.0",
  "endpoints": {
    "GET /api/tools": "List all available tools",
    "GET /api/members": "Get members data",
    "GET /api/resorts": "Get resorts data",
    "GET /api/feedback": "Get feedback data",
    "GET /api/events": "Get events data",
    "POST /api/analyze": "Perform analytical queries",
    "POST /api/query": "Generic query with filters"
  }
}
```

---

### 2. List All Tools
**GET** `/api/tools`

**Description:** Get list of all available API tools

**Request:**
- Method: `GET`
- URL: `http://localhost:3000/api/tools`
- Headers: None required
- Body: None

**Response:**
```json
{
  "tools": [
    {
      "name": "get_members",
      "description": "Retrieve member data from the fact_member table",
      "method": "GET",
      "endpoint": "/api/members"
    },
    ...
  ]
}
```

---

### 3. Get Members
**GET** `/api/members`

**Description:** Retrieve member data from the fact_member table

**Request:**
- Method: `GET`
- URL: `http://localhost:3000/api/members`
- Headers: None required
- Query Parameters (optional):
  - `limit` (number): Maximum number of records to return
  - `order` (string): Order by field (e.g., 'id.asc', 'created_at.desc')
  - `select` (string): Comma-separated list of fields to select

**Example Requests:**

1. Get all members:
   ```
   GET http://localhost:3000/api/members
   ```

2. Get first 10 members:
   ```
   GET http://localhost:3000/api/members?limit=10
   ```

3. Get members ordered by ID:
   ```
   GET http://localhost:3000/api/members?order=id.asc&limit=5
   ```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "count": 10
}
```

---

### 4. Get Resorts
**GET** `/api/resorts`

**Description:** Retrieve resort data from the fact_resort table

**Request:**
- Method: `GET`
- URL: `http://localhost:3000/api/resorts`
- Headers: None required
- Query Parameters (optional):
  - `limit` (number): Maximum number of records to return
  - `order` (string): Order by field
  - `select` (string): Comma-separated list of fields to select

**Example Request:**
```
GET http://localhost:3000/api/resorts?limit=20
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "count": 20
}
```

---

### 5. Get Feedback
**GET** `/api/feedback`

**Description:** Retrieve feedback data from the fact_feedback table

**Request:**
- Method: `GET`
- URL: `http://localhost:3000/api/feedback`
- Headers: None required
- Query Parameters (optional):
  - `limit` (number): Maximum number of records to return
  - `order` (string): Order by field
  - `select` (string): Comma-separated list of fields to select

**Example Request:**
```
GET http://localhost:3000/api/feedback?limit=50
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "count": 50
}
```

---

### 6. Get Events
**GET** `/api/events`

**Description:** Retrieve event data from the fact_event table

**Request:**
- Method: `GET`
- URL: `http://localhost:3000/api/events`
- Headers: None required
- Query Parameters (optional):
  - `limit` (number): Maximum number of records to return
  - `order` (string): Order by field
  - `select` (string): Comma-separated list of fields to select

**Example Request:**
```
GET http://localhost:3000/api/events?limit=30
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "count": 30
}
```

---

### 7. Analyze Data
**POST** `/api/analyze`

**Description:** Perform analytical queries across Supabase tables

**Request:**
- Method: `POST`
- URL: `http://localhost:3000/api/analyze`
- Headers:
  ```
  Content-Type: application/json
  ```
- Body (JSON):
  ```json
  {
    "table": "fact_member" | "fact_resort" | "fact_feedback" | "fact_event",
    "operation": "count" | "list" | "aggregate",
    "field": "string (optional, for aggregate operations)"
  }
  ```

**Example Requests:**

1. Count members:
   ```json
   {
     "table": "fact_member",
     "operation": "count"
   }
   ```

2. List all resorts:
   ```json
   {
     "table": "fact_resort",
     "operation": "list"
   }
   ```

3. Aggregate feedback:
   ```json
   {
     "table": "fact_feedback",
     "operation": "aggregate",
     "field": "rating"
   }
   ```

**Response:**
```json
{
  "success": true,
  "result": {
    "count": 100
  }
}
```

---

### 8. Query Table with Filters
**POST** `/api/query`

**Description:** Generic query tool with advanced filtering capabilities

**Request:**
- Method: `POST`
- URL: `http://localhost:3000/api/query`
- Headers:
  ```
  Content-Type: application/json
  ```
- Body (JSON):
  ```json
  {
    "table": "fact_member" | "fact_resort" | "fact_feedback" | "fact_event",
    "filters": {
      "field_name": "value",
      "field_name2": {
        "operator": "gt" | "lt" | "eq" | "neq" | "gte" | "lte" | "like" | "ilike",
        "value": "value"
      }
    },
    "limit": 10,
    "order": "id.asc"
  }
  ```

**Example Requests:**

1. Simple filter (equality):
   ```json
   {
     "table": "fact_member",
     "filters": {
       "status": "active"
     },
     "limit": 10
   }
   ```

2. Advanced filter with operator:
   ```json
   {
     "table": "fact_resort",
     "filters": {
       "rating": {
         "operator": "gte",
         "value": "4"
       }
     },
     "limit": 20,
     "order": "rating.desc"
   }
   ```

3. Multiple filters:
   ```json
   {
     "table": "fact_feedback",
     "filters": {
       "status": "published",
       "rating": {
         "operator": "gt",
         "value": "3"
       }
     },
     "limit": 50
   }
   ```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "count": 10
}
```

---

## Postman Collection Setup

### Import Collection
1. Open Postman
2. Click "Import"
3. Create a new collection named "Supabase MCP Server"
4. Add the following requests:

### Request 1: Health Check
- **Name:** Health Check
- **Method:** GET
- **URL:** `http://localhost:3000/`

### Request 2: List Tools
- **Name:** List Tools
- **Method:** GET
- **URL:** `http://localhost:3000/api/tools`

### Request 3: Get Members
- **Name:** Get Members
- **Method:** GET
- **URL:** `http://localhost:3000/api/members`
- **Params:** 
  - Key: `limit`, Value: `10`

### Request 4: Get Resorts
- **Name:** Get Resorts
- **Method:** GET
- **URL:** `http://localhost:3000/api/resorts`
- **Params:**
  - Key: `limit`, Value: `20`

### Request 5: Get Feedback
- **Name:** Get Feedback
- **Method:** GET
- **URL:** `http://localhost:3000/api/feedback`
- **Params:**
  - Key: `limit`, Value: `50`

### Request 6: Get Events
- **Name:** Get Events
- **Method:** GET
- **URL:** `http://localhost:3000/api/events`
- **Params:**
  - Key: `limit`, Value: `30`

### Request 7: Analyze Data - Count
- **Name:** Analyze Data - Count Members
- **Method:** POST
- **URL:** `http://localhost:3000/api/analyze`
- **Headers:**
  - Key: `Content-Type`, Value: `application/json`
- **Body (raw JSON):**
  ```json
  {
    "table": "fact_member",
    "operation": "count"
  }
  ```

### Request 8: Query with Filters
- **Name:** Query Members with Filters
- **Method:** POST
- **URL:** `http://localhost:3000/api/query`
- **Headers:**
  - Key: `Content-Type`, Value: `application/json`
- **Body (raw JSON):**
  ```json
  {
    "table": "fact_member",
    "filters": {
      "status": "active"
    },
    "limit": 10
  }
  ```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `500` - Internal Server Error

---

## Running the Server

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Start the HTTP server:
   ```bash
   npm run start:http
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev:http
   ```

4. Server will start on `http://localhost:3000`

---

## Notes

- All endpoints are open (no authentication required)
- CORS is enabled for all origins
- The server uses HTTP REST API (not stdio)
- All responses are in JSON format
- Query parameters are optional for GET requests
- POST requests require JSON body

