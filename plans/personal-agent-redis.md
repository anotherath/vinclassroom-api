# Personal Agent - Redis Data Structure

> Redis data structures for Personal Agents (1-on-1 AI assistants belonging to individual users)

---

## Overview

Personal Agents are AI assistants dedicated to a single user, operating outside of any Space context. Conversations are private 1-on-1 between user and their agent.

---

## Redis Key Patterns

```
agent:personal:{userId}:{agentSlug}              # Agent metadata Hash
user:agents:personal:{userId}                    # User's agents Sorted Set
user:agents:personal:default:{userId}            # Default agent String

dm:{userId}:{agentId}                            # DM metadata Hash
dm:messages:{dmId}                               # DM messages Sorted Set
dm:typing:{userId}:{agentId}                     # Typing indicator Set (TTL: 10s)

msg:{messageId}                                  # Message Hash

agent:memory:context:{agentId}:{userId}          # Conversation context List
agent:memory:prefs:{agentId}:{userId}            # Learned preferences Hash

agent:stats:daily:{agentId}:{yyyy-mm-dd}         # Daily stats Hash

channel:dm:{userId}:{agentId}                    # Pub/Sub channel
```

---

## Data Structures

### 1. Agent Metadata

```
agent:personal:{userId}:{agentSlug}
  ├── agentId: "agent-personal-user123-math"
  ├── userId: "user123"
  ├── name: "Trợ lý Toán học"
  ├── slug: "math"
  ├── type: "personal"
  ├── status: "active" | "paused" | "archived"
  ├── avatar: "https://..."
  ├── persona: "math-tutor-vietnamese"
  ├── config: '{"model":"gpt-4","language":"vi"}'
  ├── memoryEnabled: "true"
  ├── createdAt: "1712345678000"
  ├── updatedAt: "1712345678000"
  └── lastActive: "1712345678000"
```

### 2. User's Personal Agents Index

```
user:agents:personal:{userId}                    # Sorted Set
  └── member: "agent-personal-user123-math", score: lastActive
  └── member: "agent-personal-user123-english", score: lastActive

user:agents:personal:default:{userId}            # String
  └── "agent-personal-user123-assistant"
```

### 3. DM Conversation

```
dm:{userId}:{agentId}                            # Hash
  ├── id: "dm:user123:agent-personal-user123-math"
  ├── user1Id: "user123"
  ├── user2Id: "agent-personal-user123-math"
  ├── user1Type: "human"
  ├── user2Type: "agent"
  ├── lastMessageId: "msg:1712345678001"
  ├── lastMessageAt: "1712345678001"
  ├── user1Unread: "0"
  ├── user2Unread: "0"
  ├── contextWindow: "20"
  └── createdAt: "1712345678000"

dm:messages:{dmId}                               # Sorted Set
  └── member: "msg:1712345678001", score: timestamp
  └── member: "msg:1712345678002", score: timestamp

dm:typing:{userId}:{agentId}                     # Set (TTL: 10s)
  └── member: "user123" | "agent-personal-user123-math"
```

### 4. Message

```
msg:{messageId}                                  # Hash
  ├── id: "1712345678001"
  ├── dmId: "dm:user123:agent-personal-user123-math"
  ├── senderId: "user123"
  ├── senderType: "human" | "agent"
  ├── content: "Giải thích đạo hàm"
  ├── contentType: "text" | "image" | "file"
  ├── timestamp: "1712345678001"
  ├── replyTo: ""
  ├── metadata: '{"tokens":150,"model":"gpt-4"}'
  ├── feedback: '{"rating":5}'
  └── edited: "false"
```

### 5. Agent Memory

```
agent:memory:context:{agentId}:{userId}          # List (max 50)
  └── LPUSH: '{"role":"user","content":"..."}'
  └── LPUSH: '{"role":"assistant","content":"..."}'

agent:memory:prefs:{agentId}:{userId}            # Hash
  ├── explanationStyle: "visual"
  ├── detailLevel: "detailed"
  ├── knownTopics: '["algebra","calculus"]'
  ├── strugglingTopics: '["integration"]'
  └── pacePreference: "moderate"
```

### 6. Statistics

```
agent:stats:daily:{agentId}:{yyyy-mm-dd}         # Hash
  ├── messageCount: "45"
  ├── userMessages: "20"
  ├── agentMessages: "25"
  ├── totalTokens: "8500"
  └── sessions: "3"
```

---

## Redis Commands

### Create Agent

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
  memoryEnabled "true" \
  createdAt "1712345678000"

# Add to user's agents
ZADD user:agents:personal:user123 1712345678000 agent-personal-user123-math

# Create DM
HSET dm:user123:agent-personal-user123-math \
  id "dm:user123:agent-personal-user123-math" \
  user1Id "user123" \
  user2Id "agent-personal-user123-math" \
  user1Type "human" \
  user2Type "agent" \
  createdAt "1712345678000"
```

### Send Message

```bash
# Store user message
HSET msg:1712345679001 \
  id "1712345679001" \
  dmId "dm:user123:agent-personal-user123-math" \
  senderId "user123" \
  senderType "human" \
  content "Giải thích đạo hàm" \
  timestamp "1712345679001" \
  edited "false"

# Add to DM messages
ZADD dm:messages:dm:user123:agent-personal-user123-math 1712345679001 msg:1712345679001

# Update DM metadata
HSET dm:user123:agent-personal-user123-math \
  lastMessageId "msg:1712345679001" \
  lastMessageAt "1712345679001"

# Update context
LPUSH agent:memory:context:agent-personal-user123-math:user123 \
  '{"role":"user","content":"Giải thích đạo hàm"}'
LTRIM agent:memory:context:agent-personal-user123-math:user123 0 49
```

### Get Messages

```bash
# Last 50 messages
ZRANGE dm:messages:dm:user123:agent-personal-user123-math -50 -1 WITHSCORES

# Pagination
ZRANGEBYSCORE dm:messages:dm:user123:agent-personal-user123-math 0 1712345679001 LIMIT 0 20

# Get message details
HGETALL msg:1712345679001
```

### Typing Indicator

```bash
# Start typing
SADD dm:typing:user123:agent-personal-user123-math user123
EXPIRE dm:typing:user123:agent-personal-user123-math 10

# Stop typing
SREM dm:typing:user123:agent-personal-user123-math user123

# Get typing users
SMEMBERS dm:typing:user123:agent-personal-user123-math
```

### Pub/Sub

```bash
# Publish message event
PUBLISH channel:dm:user123:agent-personal-user123-math \
  '{"event":"message:new","data":{"messageId":"msg:..."}}'

# Subscribe to channel
SUBSCRIBE channel:dm:user123:agent-personal-user123-math
```

---

## Key Reference Table

| Key | Type | TTL | Description |
|-----|------|-----|-------------|
| `agent:personal:{userId}:{slug}` | Hash | - | Agent metadata |
| `user:agents:personal:{userId}` | Sorted Set | - | User's agents list |
| `user:agents:personal:default:{userId}` | String | - | Default agent ID |
| `dm:{userId}:{agentId}` | Hash | - | DM metadata |
| `dm:messages:{dmId}` | Sorted Set | - | Messages list |
| `dm:typing:{userId}:{agentId}` | Set | 10s | Typing indicator |
| `msg:{messageId}` | Hash | - | Message data |
| `agent:memory:context:{agentId}:{userId}` | List | - | Context window (50) |
| `agent:memory:prefs:{agentId}:{userId}` | Hash | - | Learned preferences |
| `agent:stats:daily:{agentId}:{date}` | Hash | 30d | Daily statistics |
| `channel:dm:{userId}:{agentId}` | Channel | - | Pub/Sub channel |

---

## ID Formats

| Entity | Format | Example |
|--------|--------|---------|
| Agent ID | `agent-personal-{userId}-{slug}` | `agent-personal-user123-math` |
| DM ID | `dm:{userId}:{agentId}` (sorted) | `dm:user123:agent-personal-user123-math` |
| Message ID | `{timestamp}{random}` | `1712345678001` |
| Session ID | `sess-{timestamp}` | `sess-1712345678000` |

---

_Single source of truth for Personal Agent Redis data structures_
_Last Updated: 2026-04-11_
