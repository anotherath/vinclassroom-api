# Phase 4 Readiness Checklist

> **Date:** 2026-04-10  
> **Purpose:** Verify all Phase 3 modules are ready for WebSocket integration

---

## ✅ Phase 3 Modules Ready for WebSocket

### 1. Messages Module ✅

| Feature | Ready | Notes |
|---------|-------|-------|
| Create message | ✅ | Need `newMessage` event |
| Edit message | ✅ | Need `messageUpdated` event |
| Delete message | ✅ | Need `messageDeleted` event |
| Reactions | ✅ | Need `reactionAdded/Removed` events |
| Thread replies | ✅ | Use same events as messages |
| Pin message | ✅ | Optional: `messagePinned` event |

**Integration Points:**
- `MessagesService.createMessage()` → Emit `newMessage`
- `MessagesService.updateMessage()` → Emit `messageUpdated`
- `MessagesService.deleteMessage()` → Emit `messageDeleted`
- `MessagesService.addReaction()` → Emit `reactionAdded`

---

### 2. DMs Module ✅

| Feature | Ready | Notes |
|---------|-------|-------|
| Send DM | ✅ | Need `newDM` event |
| Mark as read | ✅ | Need `dmRead` event |
| Typing | ✅ | Need DM typing events |
| Delete DM | ✅ | Optional: `dmDeleted` event |

**Integration Points:**
- `DMsService.sendMessage()` → Emit `newDM`
- `DMsService.markAsRead()` → Emit `dmRead`

---

### 3. Notifications Module ✅

| Feature | Ready | Notes |
|---------|-------|-------|
| Create notification | ✅ | Already has `publishNotification()` |
| Mentions | ✅ | Works via `createMentionNotification()` |
| Reactions | ✅ | Works via `createReactionNotification()` |
| DM notifications | ✅ | Works via `createDMNotification()` |

**Integration Points:**
- `NotificationsService.publishNotification()` → Already implemented
- Just needs to be called from Gateway

---

### 4. Files Module ✅

| Feature | Ready | Notes |
|---------|-------|-------|
| Upload file | ✅ | Optional: upload progress via WS |
| File metadata | ✅ | Can emit `fileUploaded` event |

**Integration Points:**
- Upload progress tracking (optional)
- Notify room when file is shared

---

### 5. Search Module ✅

| Feature | Ready | Notes |
|---------|-------|-------|
| Search | ✅ | No WS integration needed (REST only) |

**Integration Points:**
- None required - search is request/response

---

## 🔧 Redis Keys Already Defined

### For Messages
- `msg:{id}` - Message data
- `room:messages:{id}` - Room message list
- `channel:room:{id}` - Pub/Sub channel

### For DMs
- `dm:{user1}:{user2}` - DM conversation
- `dm:messages:{user1}:{user2}` - DM message list
- `channel:dm:{user1}:{user2}` - Pub/Sub channel

### For Notifications
- `user:notifications:{id}` - Recent notifications
- `user:notifications:unread:{id}` - Unread count
- `channel:user:{id}` - User-specific events

### For Presence
- `users:online` - Online users set
- `user:status:{id}` - User status

---

## 📋 Phase 4 Implementation Order

### Priority 1: Core Infrastructure (Must Have)
```
1. ChatGateway setup
2. JWT WebSocket auth
3. Connection management
4. Room join/leave
```

### Priority 2: Real-time Messages (Must Have)
```
5. newMessage event
6. messageUpdated event
7. messageDeleted event
8. typing indicators
```

### Priority 3: Notifications (Must Have)
```
9. notification event
10. mention event
```

### Priority 4: DMs (Must Have)
```
11. newDM event
12. dmRead event
13. DM typing
```

### Priority 5: Scaling (Should Have)
```
14. Redis adapter
15. Cross-server broadcasting
```

### Priority 6: Polish (Nice to Have)
```
16. Reactions real-time
17. File upload progress
18. Delivery receipts
```

---

## 🔌 WebSocket Events to Implement

### From Client to Server

| Event | Handler | Module |
|-------|---------|--------|
| `joinRoom` | `handleJoinRoom()` | Gateway |
| `leaveRoom` | `handleLeaveRoom()` | Gateway |
| `sendMessage` | `handleSendMessage()` → MessagesService | Messages |
| `editMessage` | `handleEditMessage()` → MessagesService | Messages |
| `deleteMessage` | `handleDeleteMessage()` → MessagesService | Messages |
| `typing` | `handleTyping()` | Gateway |
| `addReaction` | `handleAddReaction()` → MessagesService | Messages |
| `sendDM` | `handleSendDM()` → DMsService | DMs |
| `markAsRead` | `handleMarkAsRead()` | Messages/DMs |

### From Server to Client

| Event | Emitter | Trigger |
|-------|---------|---------|
| `newMessage` | MessagesService | After createMessage() |
| `messageUpdated` | MessagesService | After updateMessage() |
| `messageDeleted` | MessagesService | After deleteMessage() |
| `typing` | Gateway | typing event received |
| `reactionAdded` | MessagesService | After addReaction() |
| `reactionRemoved` | MessagesService | After removeReaction() |
| `notification` | NotificationsService | After createNotification() |
| `mention` | NotificationsService | After createMentionNotification() |
| `newDM` | DMsService | After sendMessage() |
| `dmRead` | DMsService | After markAsRead() |
| `userStatusChanged` | Gateway | On connect/disconnect |

---

## 📝 Code Integration Example

### Emitting from MessagesService

```typescript
// In MessagesService
async createMessage(...) {
  // ... existing code ...
  
  // Emit real-time event
  await this.redisService.publish(
    RedisKeys.channel.room(roomId),
    JSON.stringify({
      event: 'newMessage',
      data: message
    })
  );
  
  return message;
}
```

### Receiving in Gateway

```typescript
// In ChatGateway
@SubscribeMessage('sendMessage')
async handleSendMessage(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: SendMessageDto
) {
  const userId = client.data.user.id;
  const message = await this.messagesService.createMessage(
    data.roomId,
    userId,
    data
  );
  
  // Broadcast to room
  this.server.to(`room:${data.roomId}`).emit('newMessage', message);
  
  return { success: true };
}
```

---

## ✅ Ready to Start Phase 4!

All Phase 3 modules are properly prepared with:
- ✅ Business logic separated from transport layer
- ✅ Redis keys defined for pub/sub
- ✅ Helper methods for notifications
- ✅ Clean service interfaces

**Next Step:** Start with `ChatGateway` setup!
