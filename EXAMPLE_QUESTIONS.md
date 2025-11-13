# Example Questions for Supabase MCP Server

This document provides a comprehensive list of questions that can be asked to the agent using this MCP server. Questions are organized by category and complexity.

---

## 📊 BASIC DATA RETRIEVAL QUESTIONS

### Members
- "Show me all members"
- "List the first 10 members"
- "Display all active members"
- "Get members who joined in 2018"
- "Show me Red tier members"
- "Find members from the West region"
- "List members who haven't paid their annual fee"
- "Show members with lifetime value above 500,000 INR"
- "Get all members sorted by date joined"

### Resorts
- "Show me all resorts"
- "List the first 5 resorts"
- "Display resorts in the South region"
- "Get resorts with activity date in October 2025"
- "Show me Beach theme resorts"
- "Find resorts with occupancy rate above 80%"
- "List resorts sorted by total revenue"

### Feedback
- "Show me all feedback"
- "Display feedback from September 2025"
- "Get feedback for Assanora resort"
- "Show negative feedback (NPS < 7)"
- "List feedback from Red tier members"
- "Get feedback by platform (Mobile/Web)"
- "Show feedback with specific issue types"

### Events
- "Show me all events"
- "Display events in October 2025"
- "Get weather events"
- "Show competitor promotion events"
- "List events affecting the West region"
- "Get events with high relevance score"

---

## 🔢 COUNTING & AGGREGATION QUESTIONS

### Simple Counts
- "How many members do we have?"
- "What's the total number of resorts?"
- "Count all feedback records"
- "How many events are there?"
- "How many active members?"
- "Count Red tier members"
- "How many members joined in 2018?"
- "Count resorts in the South region"
- "How many feedback entries in September 2025?"

### Aggregations
- "What's the average lifetime value of members?"
- "What's the total revenue across all resorts?"
- "What's the maximum occupancy rate?"
- "What's the minimum NPS score?"
- "What's the average NPS score?"
- "What's the sum of total revenue in October 2025?"
- "What's the average occupancy rate by region?"
- "What's the total ancillary revenue?"

### Aggregated Table Queries
- "What's the total number of Red tier members?" (uses fact_member_aggregated)
- "What were the sales in July in Acacia?" (uses fact_resort_aggregated)
- "Show me aggregated member statistics"
- "Get aggregated resort revenue by month"

---

## 💰 SALES & REVENUE ANALYSIS QUESTIONS

### Root Cause Analysis
- "Why were the sales low in the month of September 2025?"
- "What caused low revenue for Assanora resort in September 2025?"
- "What were the reasons for lower revenue in Acacia Palms in October 2025?"
- "Why did Saj resort have low sales in October?"
- "What factors led to revenue decline in the West region in September?"

### Sales Comparisons
- "Which resorts showed low sales in October than in September 2025?"
- "Compare sales between September and October 2025"
- "Which resorts had declining revenue month-over-month?"
- "Show me resorts with revenue drop in October compared to September"

### Revenue Correlation
- "Which resorts saw a lower revenue in a month with a co-relation to negative feedback?"
- "Which resorts had revenue decline correlated with poor feedback?"
- "Show me resorts where negative feedback affected sales"

### Event Impact on Sales
- "Which resorts sales were affected by external events during the period of October 2025, what were those events?"
- "What external events led to decline in revenue for Saj resort?"
- "Which resorts were impacted by weather events in September?"
- "How did competitor promotions affect resort sales in October?"

### Feedback Impact on Sales
- "Sales of which resorts were affected in a specific month due to poor feedback in the previous months?"
- "Which resorts had sales decline due to negative feedback?"
- "Show me resorts where feedback affected revenue"

### Forecasting
- "Which resorts are expected to see a surge in bookings? What are the key factors driving growth?"
- "Forecast booking surges for November 2025"
- "Which resorts are likely to see growth next month?"
- "What are the key factors driving growth for top resorts?"

---

## 👥 CUSTOMER & MEMBER ANALYSIS QUESTIONS

### Member Segmentation
- "Which resorts attract the most red tier customer?"
- "Rank resorts by Red-tier customer attraction"
- "Show me resorts popular with Red tier members"
- "Which resorts do White tier members prefer?"

### Member Feedback
- "Which resorts have got a poor feedback from red tier customer and what are they saying?"
- "What are Red tier customers complaining about?"
- "Show me feedback themes from Red tier members"
- "What do high-value members say about our resorts?"

### Member Value Analysis
- "What is the average lifetime value by region?"
- "Which members are most valuable?"
- "Show me LTV analysis by membership tier"
- "What's the average lifetime value for Red tier members?"
- "Compare member lifetime value across regions"

### Churn Risk
- "Which members are at risk of churning?"
- "Identify members at risk"
- "Show me members likely to cancel"
- "Which members haven't visited in a long time?"

### Payment Issues
- "Is there any negative feedback from members who have not paid ASF for 2 years, what is it?"
- "Show me feedback from unpaid members"
- "What are members with unpaid ASF saying?"
- "Find members with payment issues and their feedback"

---

## 📈 PERFORMANCE & TREND ANALYSIS QUESTIONS

### Regional Performance
- "How do regions compare in performance?"
- "Which region performs best?"
- "Compare regional performance in 2025"
- "Show me revenue by region"
- "Which region has highest occupancy?"
- "Rank regions by performance"

### Theme Analysis
- "Which resort themes perform best?"
- "Compare performance by resort theme"
- "Which themes (Beach, Waterpark) generate most revenue?"
- "Show me revenue by resort theme"
- "What's the occupancy rate by theme?"

### Revenue Streams
- "Compare ancillary vs restaurant revenue"
- "Which resorts have best revenue mix?"
- "Analyze revenue mix for Assanora"
- "Show me revenue breakdown by stream"
- "Which resorts have highest ancillary revenue percentage?"

### Resort Rankings
- "Rank resorts by performance"
- "Which resorts are top performers?"
- "Top resorts by revenue in 2025"
- "Rank all resorts by overall performance"
- "Show me top 10 resorts by occupancy"
- "Which resorts rank highest by feedback quality?"

### Seasonal Trends
- "What are the seasonal patterns?"
- "When are peak booking seasons?"
- "What are the seasonal trends in 2025?"
- "Show me monthly revenue trends"
- "Which months have highest bookings?"
- "Identify peak and low seasons"

---

## 🌍 EXTERNAL FACTOR ANALYSIS QUESTIONS

### Competitor Impact
- "Which resorts are affected by competitor promotions?"
- "What is the impact of competitor events?"
- "Which resorts were affected by competitor promotions in October 2025?"
- "Show me competitor impact on sales"
- "How did competitor promotions affect our resorts?"

### Weather Impact
- "How does weather affect resort performance?"
- "Which resorts were impacted by weather events?"
- "How did weather events affect resorts in September 2025?"
- "Show me weather impact on revenue"
- "Which resorts are most affected by weather?"

### General Event Impact
- "Which resorts were affected by external events in October?"
- "What events impacted sales in September 2025?"
- "Show me all external events and their impact"
- "Which events had the biggest impact on revenue?"

---

## 🐛 ISSUE & PLATFORM ANALYSIS QUESTIONS

### Platform Analysis
- "Which platforms have most issues?"
- "Compare feedback quality by platform"
- "Which platforms have most negative feedback?"
- "Show me feedback breakdown by platform"
- "What's the NPS score by platform?"

### Issue Type Analysis
- "What are the most common issues?"
- "Which resorts have most problems?"
- "What issues does Assanora have?"
- "Show me issue type trends"
- "What are the top 5 issue categories?"
- "Which issue types are increasing?"

### Feedback Analysis
- "Analyze feedback for Assanora resort"
- "What are customers saying about Saj resort?"
- "Show me feedback themes for top resorts"
- "What are the main complaints?"
- "Show me positive feedback themes"

---

## 🔍 ADVANCED ANALYTICAL QUESTIONS

### Multi-Factor Analysis
- "Why did revenue drop in October for multiple resorts?"
- "What factors contributed to low sales across regions?"
- "Analyze the correlation between events, feedback, and revenue"
- "Show me resorts with multiple issues (low occupancy, poor feedback, events)"

### Comparative Analysis
- "Compare Assanora's performance with Saj resort"
- "How does West region compare to South region?"
- "Compare Beach theme vs Waterpark theme performance"
- "Show me month-over-month trends for top 5 resorts"

### Predictive Questions
- "Which resorts are likely to see growth based on current trends?"
- "Forecast revenue for November based on historical data"
- "Which members are at risk based on their behavior patterns?"
- "Predict which resorts will need attention next month"

### Correlation Questions
- "Is there a correlation between feedback scores and revenue?"
- "Do weather events consistently affect certain regions?"
- "How does competitor activity correlate with our sales?"
- "Show me correlations between member tier and resort preference"

---

## 📅 TIME-BASED QUESTIONS

### Date Range Queries
- "Show me all members who joined between 2018-01-01 and 2018-12-31"
- "Get resorts with activity date in September 2025"
- "Show feedback from October 1 to October 31, 2025"
- "List events between September and October 2025"

### Monthly Analysis
- "What happened in September 2025?"
- "Compare September vs October 2025 performance"
- "Show me monthly revenue trends for 2025"
- "Which month had the highest revenue in 2025?"

### Year-over-Year
- "Compare 2024 vs 2025 performance"
- "Show me year-over-year growth"
- "What's the trend compared to last year?"

---

## 🎯 SPECIFIC RESORT QUESTIONS

- "What's the performance of Assanora resort?"
- "Show me all data for Saj resort"
- "Analyze Acacia Palms resort"
- "What are customers saying about [resort name]?"
- "Why did [resort name] have low revenue in [month]?"
- "What events affected [resort name]?"
- "Show me feedback for [resort name]"
- "What's the revenue trend for [resort name]?"

---

## 💡 TIPS FOR ASKING QUESTIONS

1. **Be Specific**: Include dates, resort names, or regions when relevant
2. **Use Natural Language**: The agent understands conversational questions
3. **Ask Follow-ups**: You can ask clarifying questions based on initial responses
4. **Combine Concepts**: Ask complex questions that require multi-table analysis
5. **Request Comparisons**: Ask to compare time periods, resorts, or regions
6. **Ask for Insights**: Request root cause analysis, trends, or forecasts

---

## 🚫 WHAT THE AGENT CANNOT DO

- Modify or delete data (read-only access)
- Access data outside the fact tables
- Perform real-time calculations not supported by the tools
- Access historical data beyond what's in the database
- Make predictions beyond the available analytical tools

---

## 📝 NOTES

- All dates should be in format: "YYYY-MM-DD" or "YYYY-MM"
- Resort names are case-insensitive (use natural names like "Assanora", "Saj", "Acacia Palms")
- The agent will automatically select the best tool for your question
- Complex questions may take longer to process
- Results are returned in structured JSON format, formatted for readability

