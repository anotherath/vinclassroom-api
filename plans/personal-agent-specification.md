# Personal Agent Specification

> **Purpose:** Define the architecture, data structures, and API flows for Personal Agents in VinClassroom - AI agents that belong to individual users for 1-on-1 private conversations.

---

## Overview

### What is a Personal Agent?

A **Personal Agent** is an AI assistant dedicated to a single user. It provides personalized help, tutoring, and conversation in a private 1-on-1 setting outside of any Space context.

### Key Characteristics

| Feature | Description |
|---------|-------------|
| **Ownership** | Each user can have one or more personal agents |
| **Privacy** | Conversations are private between user and their agent only |
| **No Space Context** | Personal agents are NOT tied to any Space |
| **Persistent Memory** | Agents remember conversation history across sessions |
| **Customizable** | Users can configure agent personality, name, and capabilities |

---

## Architecture

### 1. Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                         User                                │
│                      (user_123)                             │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ 1:N
               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Personal Agent                            │
│              (agent-personal-user_123-math)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  - agentId, name, persona, config                  │   │
│  │  - createdAt, lastActive, status                   │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────────────────────┘
               │
               │ 1:1 Conversation (DM Structure)
               ▼
┌─────────────────────────────────────────────────────────────┐
│              DM: user_123 ↔ agent-personal-...              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Messages (Sorted Set)                             │   │
│  │  - msg:1712345678001, msg:1712345678002, ...       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2. Agent Lifecycle

```
User Registration
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Create     │────▶│   Configure  │────▶│   Activate   │
│   Default    │     │   Persona    │     │   Agent      │
│   Agent      │     │   & Name     │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                    ┌─────────────────────────────┘
                    ▼
           ┌──────────────┐
           │    Chat      │◄────────────────┐
           │   Session    │                 │
           └──────────────┘                 │
                  │                         │
                  ▼                         │
           ┌──────────────┐                 │
           │   Store      │─────────────────┘
           │   Context    │     (Continue
           │   & Memory   │      Conversation)
           └──────────────┘
```

---

## Redis Data Structures

### 2.1 Agent Metadata

```
agent:personal:{userId}:{agentSlug}
  ├── agentId: "agent-personal-user123-math"    # Unique identifier
  ├── userId: "user123"                          # Owner
  ├── name: "Trợ lý Toán học"                    # Display name
  ├── slug: "math"                               # Short identifier
  ├── type: "personal"                           # Agent type
  ├── status: "active" | "paused" | "archived"   # Lifecycle status
  ├── avatar: "https://..."                      # Avatar URL
  ├── persona: "math-tutor-vietnamese"           # Personality preset
  ├── config: '{                                 # JSON configuration
  │     "model": "gpt-4",
  │     "language": "vi",
  │     "responseStyle": "encouraging",
  │     "expertise": ["mathematics", "physics"]
  │   }'
  ├── memoryEnabled: "true"                      # Long-term memory
  ├── createdAt: "1712345678000"
  ├── updatedAt: "1712345678000"
  └── lastActive: "1712345678000"
```

### 2.2 User's Personal Agents Index

```
user:agents:personal:{userId}                    # Sorted Set
  └── member: "agent-personal-user123-math", score: lastActive
  └── member: "agent-personal-user123-english", score: lastActive
```

### 2.3 DM Conversation (Reuses DM Structure)

```
# DM ID Generation (same as regular DMs)
dm:{userId}:{agentId}  # userId and agentId sorted alphabetically
Example: dm:agent-personal-user123-math:user123

# DM Metadata Hash
dm:{dmId}
  ├── id: "dm:agent-personal-user123-math:user123"
  ├── user1Id: "user123"
  ├── user2Id: "agent-personal-user123-math"
  ├── user1Type: "human"
  ├── user2Type: "agent"
  ├── lastMessageId: "msg:1712345678001"
  ├── lastMessageAt: "1712345678001"
  ├── user1Unread: "0"                          # User's unread
  ├── user2Unread: "0"                          # Agent's unread (usually 0)
  ├── createdAt: "1712345678000"
  └── contextWindow: "20"                        # Messages in context

# DM Messages (Sorted Set)
dm:messages:{dmId}
  └── member: "msg:1712345678001", score: 1712345678001
  └── member: "msg:1712345678002", score: 1712345678002

# Message Hash
msg:{messageId}
  ├── id: "1712345678001"
  ├── dmId: "dm:agent-personal-user123-math:user123"
  ├── senderId: "user123"
  ├── senderType: "human" | "agent"
  ├── content: "Giải thích đạo hàm cho tôi"
  ├── contentType: "text" | "image" | "file"
  ├── timestamp: "1712345678001"
  ├── replyTo: ""                                 # Thread support
  ├── metadata: '{"tokens":150,"model":"gpt-4"}'  # AI metadata
  ├── feedback: '{"rating":5,"comment":"rất hay"}' # User feedback
  └── edited: "false"

# User's DMs Index (includes both human and agent DMs)
user:dms:{userId}                                # Sorted Set
  └── member: "dm:agent-personal-user123-math:user123", score: lastMessageAt
  └── member: "dm:friend456:user123", score: lastMessageAt
```

### 2.4 Agent Memory & Context

```
# Conversation Summary (for long-term memory)
agent:memory:summary:{agentId}
  ├── currentTopic: "Đạo hàm và ứng dụng"
  ├── userProficiency: "intermediate"
  ├── keyLearnings: '["user struggles with chain rule", "prefers visual examples"]'
  ├── lastSummaryAt: "1712345678000"
  └── summaryVersion: "3"

# Context Window Cache (recent messages for AI context)
agent:memory:context:{agentId}:{userId}          # List (LRU)
  └── LPUSH: '{"role":"user","content":"..."}'
  └── LPUSH: '{"role":"assistant","content":"..."}'
  └── LTRIM 0 49                                 # Keep last 50

# User Preferences Learned by Agent
agent:memory:prefs:{agentId}:{userId}
  ├── explanationStyle: "visual"
  ├── detailLevel: "detailed"
  ├── preferredExamples: "real-world"
  ├── knownTopics: '["algebra", "calculus-basic"]'
  ├── strugglingTopics: '["integration-by-parts"]'
  └── pacePreference: "moderate"
```

### 2.5 Agent Activity & Analytics

```
# Agent Session Tracking
agent:session:{agentId}:{sessionId}              # Hash
  ├── sessionId: "sess-1712345678000"
  ├── startedAt: "1712345678000"
  ├── endedAt: ""
  ├── messageCount: "15"
  ├── totalTokens: "2500"
  └── status: "active"

# Daily Usage Stats
agent:stats:daily:{agentId}:{yyyy-mm-dd}
  ├── messageCount: "45"
  ├── userMessages: "20"
  ├── agentMessages: "25"
  ├── totalTokens: "8500"
  ├── avgResponseTime: "2.5"
  └── sessions: "3"
```

---

## API Endpoints

### 3.1 Agent Management

```typescript
// Create Personal Agent
POST /api/agents/personal
Request: {
  name: "Trợ lý Toán học",
  slug: "math",                           // unique per user
  persona: "math-tutor-vietnamese",       // preset or custom
  config: {
    model: "gpt-4",
    language: "vi",
    responseStyle: "encouraging"
  }
}
Response: {
  agentId: "agent-personal-user123-math",
  name: "Trợ lý Toán học",
  createdAt: "..."
}

// List Personal Agents
GET /api/agents/personal
Response: {
  agents: [{
    agentId: "agent-personal-user123-math",
    name: "Trợ lý Toán học",
    status: "active",
    lastActive: "...",
    unreadCount: 0,
    lastMessage: { ... }
  }]
}

// Get Agent Details
GET /api/agents/personal/:agentId
Response: {
  agentId: "...",
  name: "...",
  persona: "...",
  config: { ... },
  stats: {
    totalMessages: 150,
    totalSessions: 20,
    avgSessionLength: 15
  }
}

// Update Agent Configuration
PATCH /api/agents/personal/:agentId
Request: {
  name: "Trợ lý Toán cao cấp",
  config: { ... }
}

// Pause/Archive Agent
PATCH /api/agents/personal/:agentId/status
Request: {
  status: "paused" | "archived" | "active"
}

// Delete Agent (soft delete)
DELETE /api/agents/personal/:agentId
```

### 3.2 Conversation APIs

```typescript
// Get Chat History (uses DM structure)
GET /api/agents/personal/:agentId/messages
Query: {
  before?: string,      // cursor pagination
  after?: string,
  limit?: number        // default 50, max 100
}
Response: {
  messages: [{
    id: "msg:...",
    senderId: "user123",
    senderType: "human",
    content: "...",
    timestamp: "...",
    replyTo?: "..."
  }],
  hasMore: true,
  nextCursor: "..."
}

// Send Message & Get AI Response
POST /api/agents/personal/:agentId/messages
Request: {
  content: "Giải thích đạo hàm",
  contentType: "text",
  replyTo?: "msg:...",
  attachments?: [{
    type: "image" | "file",
    url: "...",
    name: "..."
  }]
}
Response: {
  userMessage: { ... },
  agentMessage: { ... },  // AI response (may be streamed)
  processingTime: 2.5
}

// Stream AI Response (WebSocket or SSE)
WS /ws/agents/personal/:agentId
Events:
  - "message:start"    # Agent starts typing/thinking
  - "message:chunk"    # Streaming response chunk
  - "message:complete" # Response complete
  - "message:error"    # Error occurred

// Send Feedback on Agent Response
POST /api/agents/personal/:agentId/messages/:messageId/feedback
Request: {
  rating: 1-5,
  comment: "Giải thích rất rõ ràng",
  helpful: true
}

// Clear Conversation History
DELETE /api/agents/personal/:agentId/messages
Query: {
  keepMemory: true      // keep learned preferences, delete messages
}
```

### 3.3 Memory & Context APIs

```typescript
// Get Agent's Learned Preferences
GET /api/agents/personal/:agentId/memory/preferences
Response: {
  explanationStyle: "visual",
  detailLevel: "detailed",
  knownTopics: ["algebra", "calculus"],
  strugglingTopics: ["integration"]
}

// Update/Correct Preferences
PATCH /api/agents/personal/:agentId/memory/preferences
Request: {
  explanationStyle: "step-by-step",
  addKnownTopics: ["trigonometry"],
  removeStrugglingTopics: ["integration"]
}

// Get Conversation Summary
GET /api/agents/personal/:agentId/memory/summary
Response: {
  currentTopic: "Đạo hàm",
  userProficiency: "intermediate",
  keyLearnings: ["..."],
  suggestedTopics: ["Ứng dụng đạo hàm", "Cực trị"]
}

// Reset Agent Memory (hard reset)
POST /api/agents/personal/:agentId/memory/reset
Query: {
  keepPreferences: false,
  keepHistory: false
}
```

---

## WebSocket Events

### 4.1 Client → Server

```typescript
// Join personal agent chat
{
  type: "join",
  payload: {
    agentId: "agent-personal-user123-math"
  }
}

// Send message
{
  type: "message:send",
  payload: {
    content: "Giải thích đạo hàm",
    replyTo?: "msg:...",
    clientId: "client-generated-id"  // for deduplication
  }
}

// Typing indicator
{
  type: "typing:start" | "typing:stop",
  payload: {
    agentId: "..."
  }
}

// Provide feedback
{
  type: "feedback",
  payload: {
    messageId: "msg:...",
    rating: 5
  }
}
```

### 4.2 Server → Client

```typescript
// Message from user (echo)
{
  type: "message:sent",
  payload: {
    clientId: "...",
    message: { ... }
  }
}

// Agent starts processing
{
  type: "agent:thinking",
  payload: {
    agentId: "...",
    status: "analyzing" | "searching" | "generating"
  }
}

// Streaming response chunk
{
  type: "message:stream",
  payload: {
    messageId: "msg:...",
    chunk: "đạo hàm là...",
    isComplete: false
  }
}

// Complete message
{
  type: "message:complete",
  payload: {
    message: { ... },
    tokensUsed: 150
  }
}

// Typing indicator from agent
{
  type: "typing",
  payload: {
    agentId: "...",
    isTyping: true
  }
}
```

---

## Redis Commands Reference

### 5.1 Create Personal Agent

```bash
# Create agent metadata
HSET agent:personal:user123:math \
  agentId "agent-personal-user123-math" \
  userId "user123" \
  name "Trợ lý Toán học" \
  slug "math" \
  type "personal" \
  status "active" \
  persona "math-tutor-vietnamese" \
  config '{"model":"gpt-4","language":"vi"}' \
  createdAt "1712345678000"

# Add to user's personal agents
ZADD user:agents:personal:user123 1712345678000 agent-personal-user123-math

# Create DM metadata
HSET dm:agent-personal-user123-math:user123 \
  id "dm:agent-personal-user123-math:user123" \
  user1Id "user123" \
  user2Id "agent-personal-user123-math" \
  user1Type "human" \
  user2Type "agent" \
  createdAt "1712345678000"

# Add to user's DMs list
ZADD user:dms:user123 1712345678000 dm:agent-personal-user123-math:user123
```

### 5.2 Send Message & Get Response

```bash
# Store user message
HSET msg:1712345679001 \
  id "1712345679001" \
  dmId "dm:agent-personal-user123-math:user123" \
  senderId "user123" \
  senderType "human" \
  content "Giải thích đạo hàm" \
  timestamp "1712345679001"

# Add to DM messages
ZADD dm:messages:agent-personal-user123-math:user123 1712345679001 msg:1712345679001

# Update DM last message
HSET dm:agent-personal-user123-math:user123 \
  lastMessageId "msg:1712345679001" \
  lastMessageAt "1712345679001"

# Update agent last active
HSET agent:personal:user123:math lastActive "1712345679001"
ZADD user:agents:personal:user123 1712345679001 agent-personal-user123-math

# After AI generates response
HSET msg:1712345679002 \
  id "1712345679002" \
  dmId "dm:agent-personal-user123-math:user123" \
  senderId "agent-personal-user123-math" \
  senderType "agent" \
  content "Đạo hàm là..." \
  timestamp "1712345679002" \
  metadata '{"tokens":150,"model":"gpt-4"}'

ZADD dm:messages:agent-personal-user123-math:user123 1712345679002 msg:1712345679002
```

### 5.3 Get Chat History

```bash
# Get last 50 messages
ZRANGE dm:messages:agent-personal-user123-math:user123 -50 -1 WITHSCORES

# Get messages before cursor (pagination)
ZRANGEBYSCORE dm:messages:... 0 1712345679001 LIMIT 0 20

# Get message details (pipeline)
HGETALL msg:1712345679001
HGETALL msg:1712345679002
...
```

### 5.4 Update Memory

```bash
# Update context window
LPUSH agent:memory:context:agent-personal-user123-math:user123 \
  '{"role":"user","content":"Giải thích đạo hàm"}'
LPUSH agent:memory:context:agent-personal-user123-math:user123 \
  '{"role":"assistant","content":"Đạo hàm là..."}'
LTRIM agent:memory:context:agent-personal-user123-math:user123 0 49

# Update preferences
HSET agent:memory:prefs:agent-personal-user123-math:user123 \
  explanationStyle "visual" \
  detailLevel "detailed"
```

---

## Implementation Notes

### 6.1 Agent ID Format

```
personal agent id: agent-personal-{userId}-{slug}
examples:
  - agent-personal-user123-math
  - agent-personal-user123-english
  - agent-personal-user456-general
```

### 6.2 Default Personal Agent

When a user registers, automatically create a default personal agent:

```javascript
{
  agentId: `agent-personal-${userId}-assistant`,
  name: "Trợ lý học tập",
  slug: "assistant",
  persona: "helpful-student-assistant",
  config: {
    model: "gpt-4",
    language: "vi",
    responseStyle: "encouraging"
  }
}
```

### 6.3 Security Considerations

1. **Ownership Validation**: Every agent operation must verify `agent.userId === currentUserId`
2. **Rate Limiting**: Apply per-agent rate limits for AI API calls
3. **Content Moderation**: Scan user inputs and AI outputs for inappropriate content
4. **Data Retention**: Allow users to export/delete their agent data (GDPR compliance)

### 6.4 Performance Optimization

1. **Context Caching**: Cache recent conversation context in Redis for quick AI inference
2. **Message Pagination**: Never load entire conversation history at once
3. **Lazy Memory Loading**: Load agent memory/preferences only when needed
4. **Connection Pooling**: Reuse WebSocket connections for active chats

---

## Database Schema (Supabase)

```sql
-- Personal Agents Table
CREATE TABLE personal_agents (
  id TEXT PRIMARY KEY,                    -- agent-personal-{userId}-{slug}
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT DEFAULT 'personal',
  status TEXT DEFAULT 'active',           -- active, paused, archived
  avatar_url TEXT,
  persona TEXT,                           -- preset personality
  config JSONB DEFAULT '{}',              -- model, language, etc.
  memory_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  
  UNIQUE(user_id, slug)
);

-- Agent Memory Table (for persistent storage)
CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT REFERENCES personal_agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type TEXT,                       -- preference, summary, fact
  key TEXT,
  value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Sessions Table
CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,                    -- sess-{timestamp}
  agent_id TEXT REFERENCES personal_agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);

-- Indexes
CREATE INDEX idx_personal_agents_user_id ON personal_agents(user_id);
CREATE INDEX idx_personal_agents_status ON personal_agents(status);
CREATE INDEX idx_agent_memories_agent_id ON agent_memories(agent_id);
CREATE INDEX idx_agent_sessions_agent_id ON agent_sessions(agent_id);
```

---

_Specification for VinClassroom Personal Agent Feature_
_Last Updated: 2026-04-11_
