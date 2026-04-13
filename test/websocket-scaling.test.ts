/**
 * WebSocket Horizontal Scaling Test
 * 
 * This test verifies that WebSocket events are properly broadcast
 * across multiple server instances using Redis Pub/Sub.
 * 
 * Prerequisites:
 * - Redis server running
 * - Multiple API server instances running on different ports
 * 
 * Usage:
 *   npm run test:scaling
 * 
 * Or manually:
 *   # Terminal 1: Start server on port 3000
 *   PORT=3000 npm run start:dev
 *   
 *   # Terminal 2: Start server on port 3001
 *   PORT=3001 npm run start:dev
 *   
 *   # Terminal 3: Run scaling test
 *   npx ts-node test/websocket-scaling.test.ts
 */

import { io, Socket } from 'socket.io-client';
import Redis from 'ioredis';
import { config } from 'dotenv';

config();

// Test configuration
const TEST_CONFIG = {
  serverUrls: [
    process.env.SERVER_URL_1 || 'http://localhost:3000',
    process.env.SERVER_URL_2 || 'http://localhost:3001',
  ],
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  testTimeout: 30000,
  messageDelay: 500,
};

// Test user tokens (in real scenario, these would be valid JWT tokens)
interface TestUser {
  id: string;
  token: string;
  socket?: Socket;
}

const testUsers: TestUser[] = [
  { id: 'user-1', token: 'test-token-1' },
  { id: 'user-2', token: 'test-token-2' },
];

// Test results
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

// Helper: Delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Connect to WebSocket server
async function connectToServer(url: string, token: string, userId: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${url}/chat`, {
      auth: { token: `Bearer ${token}` },
      transports: ['websocket'],
      timeout: 10000,
    });

    socket.on('connect', () => {
      console.log(`✓ ${userId} connected to ${url}`);
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      reject(new Error(`Connection failed for ${userId}: ${error.message}`));
    });

    setTimeout(() => {
      reject(new Error(`Connection timeout for ${userId}`));
    }, 10000);
  });
}

// Test 1: Redis Connectivity
async function testRedisConnectivity(): Promise<TestResult> {
  const startTime = Date.now();
  const name = 'Redis Connectivity';

  try {
    const redis = new Redis(TEST_CONFIG.redisUrl);
    
    // Test ping
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }

    // Test pub/sub
    const pub = new Redis(TEST_CONFIG.redisUrl);
    const sub = new Redis(TEST_CONFIG.redisUrl);
    
    const testMessage = JSON.stringify({ test: 'message', timestamp: Date.now() });
    const testChannel = 'test:scaling:channel';
    
    const receivedMessage = await new Promise<string>((resolve, reject) => {
      sub.subscribe(testChannel, (err) => {
        if (err) reject(err);
      });

      sub.on('message', (channel, message) => {
        if (channel === testChannel) {
          resolve(message);
        }
      });

      setTimeout(() => {
        reject(new Error('Pub/Sub timeout'));
      }, 5000);

      setTimeout(async () => {
        await pub.publish(testChannel, testMessage);
      }, 100);
    });

    if (receivedMessage !== testMessage) {
      throw new Error('Pub/Sub message mismatch');
    }

    await redis.quit();
    await pub.quit();
    await sub.quit();

    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Test 2: Cross-Server Message Broadcasting
async function testCrossServerBroadcasting(): Promise<TestResult> {
  const startTime = Date.now();
  const name = 'Cross-Server Message Broadcasting';

  try {
    // Connect users to different servers
    const user1Socket = await connectToServer(
      TEST_CONFIG.serverUrls[0],
      testUsers[0].token,
      testUsers[0].id
    );
    testUsers[0].socket = user1Socket;

    const user2Socket = await connectToServer(
      TEST_CONFIG.serverUrls[1],
      testUsers[1].token,
      testUsers[1].id
    );
    testUsers[1].socket = user2Socket;

    // Join a test room
    const testRoomId = 'test-room-scaling';
    
    await new Promise<void>((resolve, reject) => {
      user1Socket.emit('joinRoom', { roomId: testRoomId });
      user1Socket.on('joinedRoom', (data) => {
        if (data.success) resolve();
        else reject(new Error('Failed to join room'));
      });
      setTimeout(() => reject(new Error('Join room timeout')), 5000);
    });

    await new Promise<void>((resolve, reject) => {
      user2Socket.emit('joinRoom', { roomId: testRoomId });
      user2Socket.on('joinedRoom', (data) => {
        if (data.success) resolve();
        else reject(new Error('Failed to join room'));
      });
      setTimeout(() => reject(new Error('Join room timeout')), 5000);
    });

    // Test message broadcasting
    const testMessage = {
      content: 'Cross-server test message',
      timestamp: Date.now(),
    };

    const receivedMessage = await new Promise<any>((resolve, reject) => {
      // User 2 listens for newMessage
      user2Socket.on('newMessage', (message) => {
        if (message.content === testMessage.content) {
          resolve(message);
        }
      });

      // User 1 sends message
      setTimeout(() => {
        user1Socket.emit('sendMessage', {
          roomId: testRoomId,
          content: testMessage.content,
        });
      }, 100);

      setTimeout(() => {
        reject(new Error('Message broadcast timeout'));
      }, 10000);
    });

    if (!receivedMessage || receivedMessage.content !== testMessage.content) {
      throw new Error('Message broadcast failed');
    }

    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Test 3: Typing Indicator Across Servers
async function testTypingIndicator(): Promise<TestResult> {
  const startTime = Date.now();
  const name = 'Typing Indicator Across Servers';

  try {
    const user1Socket = testUsers[0].socket;
    const user2Socket = testUsers[1].socket;

    if (!user1Socket || !user2Socket) {
      throw new Error('Sockets not connected');
    }

    const testRoomId = 'test-room-scaling';

    const receivedTyping = await new Promise<any>((resolve, reject) => {
      user2Socket.on('typing', (data) => {
        if (data.isTyping) {
          resolve(data);
        }
      });

      setTimeout(() => {
        user1Socket.emit('typing', { roomId: testRoomId, isTyping: true });
      }, 100);

      setTimeout(() => {
        reject(new Error('Typing indicator timeout'));
      }, 5000);
    });

    if (!receivedTyping || !receivedTyping.isTyping) {
      throw new Error('Typing indicator failed');
    }

    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Test 4: User Presence Across Servers
async function testUserPresence(): Promise<TestResult> {
  const startTime = Date.now();
  const name = 'User Presence Across Servers';

  try {
    const user1Socket = testUsers[0].socket;

    if (!user1Socket) {
      throw new Error('Socket not connected');
    }

    const receivedStatus = await new Promise<any>((resolve, reject) => {
      user1Socket.on('userStatusChanged', (data) => {
        if (data.userId === testUsers[1].id && data.status === 'online') {
          resolve(data);
        }
      });

      setTimeout(() => {
        reject(new Error('User presence timeout'));
      }, 5000);
    });

    if (!receivedStatus) {
      throw new Error('User presence sync failed');
    }

    return {
      name,
      passed: true,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Cleanup function
async function cleanup() {
  console.log('\n🧹 Cleaning up...');
  
  for (const user of testUsers) {
    if (user.socket) {
      user.socket.disconnect();
      console.log(`✓ Disconnected ${user.id}`);
    }
  }
}

// Main test runner
async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  WebSocket Horizontal Scaling Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Configuration:');
  console.log(`  Server 1: ${TEST_CONFIG.serverUrls[0]}`);
  console.log(`  Server 2: ${TEST_CONFIG.serverUrls[1]}`);
  console.log(`  Redis: ${TEST_CONFIG.redisUrl.replace(/:\/\/.*@/, '://***@')}`);
  console.log('');

  // Run tests
  results.push(await testRedisConnectivity());
  await delay(TEST_CONFIG.messageDelay);

  results.push(await testCrossServerBroadcasting());
  await delay(TEST_CONFIG.messageDelay);

  results.push(await testTypingIndicator());
  await delay(TEST_CONFIG.messageDelay);

  results.push(await testUserPresence());

  // Cleanup
  await cleanup();

  // Print results
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Test Results');
  console.log('═══════════════════════════════════════════════════════════\n');

  let passedCount = 0;
  let failedCount = 0;

  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const duration = `${result.duration}ms`;
    
    console.log(`${status} | ${result.name} (${duration})`);
    
    if (!result.passed && result.error) {
      console.log(`       Error: ${result.error}`);
      failedCount++;
    } else if (result.passed) {
      passedCount++;
    }
  }

  console.log('\n───────────────────────────────────────────────────────────');
  console.log(`Total: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(failedCount > 0 ? 1 : 0);
}

// Handle uncaught errors
process.on('unhandledRejection', async (error) => {
  console.error('Unhandled rejection:', error);
  await cleanup();
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n\nInterrupted by user');
  await cleanup();
  process.exit(0);
});

// Run tests
runTests().catch(async (error) => {
  console.error('Test runner error:', error);
  await cleanup();
  process.exit(1);
});
