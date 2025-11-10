# Quick Start Guide - Testing MCP Server in Postman

## 🚀 Start the HTTP Server

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```

3. **Start the HTTP server**:
   ```bash
   npm run start:http
   ```

   Server will start on: `http://localhost:3000`

---

## 📮 Postman Setup

### Option 1: Import Collection (Recommended)
1. Open Postman
2. Click **Import** button
3. Select the file: `postman_collection.json`
4. All requests will be imported automatically

### Option 2: Manual Setup
Follow the examples below to create requests manually.

---

## 🔗 API Endpoints Summary

### Base URL
```
http://localhost:3000
```

### Transport Method
**HTTP REST API** - Standard HTTP GET/POST requests

### Authentication
**None required** - All endpoints are open

---

## 📋 API Endpoints

### 1. Health Check
```
GET http://localhost:3000/
```

### 2. List Tools
```
GET http://localhost:3000/api/tools
```

### 3. Get Members
```
GET http://localhost:3000/api/members?limit=10
```

### 4. Get Resorts
```
GET http://localhost:3000/api/resorts?limit=20
```

### 5. Get Feedback
```
GET http://localhost:3000/api/feedback?limit=50
```

### 6. Get Events
```
GET http://localhost:3000/api/events?limit=30
```

### 7. Analyze Data
```
POST http://localhost:3000/api/analyze
Content-Type: application/json

Body:
{
  "table": "fact_member",
  "operation": "count"
}
```

### 8. Query with Filters
```
POST http://localhost:3000/api/query
Content-Type: application/json

Body:
{
  "table": "fact_member",
  "filters": {
    "status": "active"
  },
  "limit": 10
}
```

---

## 📝 Example Postman Requests

### Example 1: Get All Members
- **Method:** GET
- **URL:** `http://localhost:3000/api/members`
- **Headers:** None
- **Body:** None

### Example 2: Count Members
- **Method:** POST
- **URL:** `http://localhost:3000/api/analyze`
- **Headers:** 
  - `Content-Type: application/json`
- **Body (raw JSON):**
  ```json
  {
    "table": "fact_member",
    "operation": "count"
  }
  ```

### Example 3: Query with Filters
- **Method:** POST
- **URL:** `http://localhost:3000/api/query`
- **Headers:**
  - `Content-Type: application/json`
- **Body (raw JSON):**
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

---

## ✅ Response Format

### Success Response
```json
{
  "success": true,
  "data": [...],
  "count": 10
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message"
}
```

---

## 🎯 Quick Test

1. Start server: `npm run start:http`
2. Open Postman
3. Import `postman_collection.json`
4. Run "Health Check" request
5. You should see server info and available endpoints

---

## 📚 Full Documentation

See `POSTMAN_API_DOCS.md` for complete API documentation with all examples.

