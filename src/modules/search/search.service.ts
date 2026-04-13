import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import { SearchDto, SearchType, SearchResultDto, SearchResponseDto } from './dto';
import { createHash } from 'crypto';

interface SearchCache {
  results: SearchResultDto[];
  total: number;
  byType: Record<string, number>;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly SEARCH_CACHE_TTL = 300; // 5 minutes
  private readonly MAX_QUERY_LENGTH = 100;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Global search across all content types
   */
  async search(userId: string, dto: SearchDto): Promise<SearchResponseDto> {
    const { query, type = SearchType.ALL, spaceId, roomId, page = 1, limit = 20 } = dto;

    // Validate query
    if (!query || query.trim().length < 2) {
      return {
        query: query || '',
        results: [],
        total: 0,
        hasMore: false,
        page,
        limit,
        byType: {},
      };
    }

    const sanitizedQuery = this.sanitizeQuery(query);
    
    // Try cache first
    const cacheKey = this.getCacheKey(userId, dto);
    const cached = await this.getCachedSearch(cacheKey);
    
    if (cached) {
      const offset = (page - 1) * limit;
      return {
        query: sanitizedQuery,
        results: cached.results.slice(offset, offset + limit),
        total: cached.total,
        hasMore: cached.total > offset + limit,
        page,
        limit,
        byType: cached.byType,
      };
    }

    // Perform searches based on type
    const results: SearchResultDto[] = [];
    const byType: Record<string, number> = {};

    if (type === SearchType.ALL || type === SearchType.MESSAGES) {
      const messageResults = await this.searchMessages(userId, sanitizedQuery, spaceId, roomId);
      results.push(...messageResults);
      byType['messages'] = messageResults.length;
    }

    if (type === SearchType.ALL || type === SearchType.USERS) {
      const userResults = await this.searchUsers(userId, sanitizedQuery);
      results.push(...userResults);
      byType['users'] = userResults.length;
    }

    if (type === SearchType.ALL || type === SearchType.SPACES) {
      const spaceResults = await this.searchSpaces(userId, sanitizedQuery);
      results.push(...spaceResults);
      byType['spaces'] = spaceResults.length;
    }

    if (type === SearchType.ALL || type === SearchType.FILES) {
      const fileResults = await this.searchFiles(userId, sanitizedQuery, spaceId);
      results.push(...fileResults);
      byType['files'] = fileResults.length;
    }

    // Sort by relevance (score) and date
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Cache results
    await this.cacheSearch(cacheKey, {
      results,
      total: results.length,
      byType,
    });

    // Paginate
    const offset = (page - 1) * limit;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      query: sanitizedQuery,
      results: paginatedResults,
      total: results.length,
      hasMore: results.length > offset + limit,
      page,
      limit,
      byType,
    };
  }

  /**
   * Search messages
   */
  private async searchMessages(
    userId: string,
    query: string,
    spaceId?: string,
    roomId?: string,
  ): Promise<SearchResultDto[]> {
    try {
      // Get user's spaces for permission check
      const { data: memberships } = await this.supabaseService
        .from('space_members')
        .select('space_id')
        .eq('user_id', userId);

      const userSpaceIds = memberships?.map(m => m.space_id) || [];

      if (userSpaceIds.length === 0 && !roomId) {
        return [];
      }

      // Build query - using ilike for pattern matching
      let dbQuery = this.supabaseService
        .from('messages')
        .select(`
          id,
          content,
          created_at,
          room_id,
          user_id,
          author:profiles!messages_user_id_fkey(display_name, avatar_url),
          rooms!inner(name, space_id)
        `)
        .ilike('content', `%${query}%`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50);

      // Filter by room if specified
      if (roomId) {
        dbQuery = dbQuery.eq('room_id', roomId);
      }

      // Filter by space if specified
      if (spaceId) {
        dbQuery = dbQuery.eq('rooms.space_id', spaceId);
      } else if (!roomId) {
        // Limit to user's spaces
        dbQuery = dbQuery.in('rooms.space_id', userSpaceIds);
      }

      const { data: messages, error } = await dbQuery;

      if (error) {
        this.logger.error('Failed to search messages:', error.message);
        return [];
      }

      return (messages || []).map((msg: any) => ({
        type: 'message',
        id: msg.id,
        title: `Message in ${msg.rooms?.name || 'Unknown Room'}`,
        content: msg.content,
        highlight: this.extractHighlight(msg.content, query),
        metadata: {
          authorName: msg.author?.display_name,
          authorAvatar: msg.author?.avatar_url,
          roomId: msg.room_id,
          spaceId: msg.rooms?.space_id,
        },
        score: this.calculateScore(msg.content, query),
        createdAt: msg.created_at,
      }));
    } catch (error) {
      this.logger.error('Error searching messages:', error);
      return [];
    }
  }

  /**
   * Search users
   */
  private async searchUsers(userId: string, query: string): Promise<SearchResultDto[]> {
    try {
      const { data: users, error } = await this.supabaseService
        .from('profiles')
        .select('id, email, display_name, avatar_url, bio, status, created_at')
        .or(`display_name.ilike.%${query}%,email.ilike.%${query}%`)
        .neq('id', userId) // Exclude self
        .limit(20);

      if (error) {
        this.logger.error('Failed to search users:', error.message);
        return [];
      }

      return (users || []).map((user: any) => ({
        type: 'user',
        id: user.id,
        title: user.display_name,
        content: user.bio,
        highlight: user.email,
        metadata: {
          email: user.email,
          avatarUrl: user.avatar_url,
          status: user.status,
        },
        score: this.calculateScore(user.display_name + ' ' + user.email, query),
        createdAt: user.created_at,
      }));
    } catch (error) {
      this.logger.error('Error searching users:', error);
      return [];
    }
  }

  /**
   * Search spaces
   */
  private async searchSpaces(userId: string, query: string): Promise<SearchResultDto[]> {
    try {
      // Get user's spaces
      const { data: memberships } = await this.supabaseService
        .from('space_members')
        .select('space_id')
        .eq('user_id', userId);

      const userSpaceIds = memberships?.map(m => m.space_id) || [];

      if (userSpaceIds.length === 0) {
        return [];
      }

      const { data: spaces, error } = await this.supabaseService
        .from('spaces')
        .select('id, name, description, icon_url, created_at')
        .in('id', userSpaceIds)
        .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
        .limit(20);

      if (error) {
        this.logger.error('Failed to search spaces:', error.message);
        return [];
      }

      return (spaces || []).map((space: any) => ({
        type: 'space',
        id: space.id,
        title: space.name,
        content: space.description,
        highlight: this.extractHighlight(space.description, query),
        metadata: {
          iconUrl: space.icon_url,
        },
        score: this.calculateScore(space.name + ' ' + space.description, query),
        createdAt: space.created_at,
      }));
    } catch (error) {
      this.logger.error('Error searching spaces:', error);
      return [];
    }
  }

  /**
   * Search files
   */
  private async searchFiles(
    userId: string,
    query: string,
    spaceId?: string,
  ): Promise<SearchResultDto[]> {
    try {
      let dbQuery = this.supabaseService
        .from('files')
        .select('id, file_name, file_url, file_type, description, created_at, space_id, uploader_id')
        .ilike('file_name', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      // If spaceId specified, search within that space
      if (spaceId) {
        dbQuery = dbQuery.eq('space_id', spaceId);
      } else {
        // Get user's spaces
        const { data: memberships } = await this.supabaseService
          .from('space_members')
          .select('space_id')
          .eq('user_id', userId);

        const userSpaceIds = memberships?.map(m => m.space_id) || [];

        // Files uploaded by user OR in user's spaces
        if (userSpaceIds.length > 0) {
          dbQuery = dbQuery.or(`uploader_id.eq.${userId},space_id.in.(${userSpaceIds.join(',')})`);
        } else {
          dbQuery = dbQuery.eq('uploader_id', userId);
        }
      }

      const { data: files, error } = await dbQuery;

      if (error) {
        this.logger.error('Failed to search files:', error.message);
        return [];
      }

      return (files || []).map((file: any) => ({
        type: 'file',
        id: file.id,
        title: file.file_name,
        content: file.description,
        highlight: file.file_type,
        metadata: {
          fileUrl: file.file_url,
          fileType: file.file_type,
          spaceId: file.space_id,
        },
        score: this.calculateScore(file.file_name + ' ' + file.description, query),
        createdAt: file.created_at,
      }));
    } catch (error) {
      this.logger.error('Error searching files:', error);
      return [];
    }
  }

  /**
   * Get popular searches (for suggestions)
   */
  async getPopularSearches(type?: string): Promise<string[]> {
    const cacheKey = RedisKeys.search.popular(type || 'all');
    const cached = await this.redisService.lrange(cacheKey, 0, 9);

    if (cached && cached.length > 0) {
      return cached;
    }

    // Default popular searches
    return ['welcome', 'help', 'announcement'];
  }

  /**
   * Record search query for analytics
   */
  async recordSearch(userId: string, query: string, type: string): Promise<void> {
    try {
      // Add to popular searches (using a sorted set with timestamps)
      const cacheKey = RedisKeys.search.popular(type);
      await this.redisService.lpush(cacheKey, query);
      await this.redisService.ltrim(cacheKey, 0, 99); // Keep top 100
      await this.redisService.expire(cacheKey, 86400); // 24 hours
    } catch (error) {
      // Non-critical, just log
      this.logger.warn('Failed to record search:', error);
    }
  }

  /**
   * Clear search cache for a user
   */
  async clearUserSearchCache(userId: string): Promise<void> {
    // This would need a pattern-based delete, which is not efficient in Redis
    // For now, we'll just let them expire naturally
    this.logger.log(`Search cache for user ${userId} will expire naturally`);
  }

  // ==================== Private helper methods ====================

  /**
   * Sanitize search query
   */
  private sanitizeQuery(query: string): string {
    return query
      .trim()
      .substring(0, this.MAX_QUERY_LENGTH)
      .replace(/[%_]/g, '') // Remove SQL wildcards
      .replace(/[<>]/g, ''); // Remove potential HTML
  }

  /**
   * Generate cache key for search
   */
  private getCacheKey(userId: string, dto: SearchDto): string {
    const keyData = `${userId}:${dto.query}:${dto.type}:${dto.spaceId}:${dto.roomId}`;
    const hash = createHash('md5').update(keyData).digest('hex');
    return RedisKeys.search.result(hash);
  }

  /**
   * Get cached search results
   */
  private async getCachedSearch(cacheKey: string): Promise<SearchCache | null> {
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Cache miss or corrupted
    }
    return null;
  }

  /**
   * Cache search results
   */
  private async cacheSearch(cacheKey: string, data: SearchCache): Promise<void> {
    try {
      await this.redisService.set(
        cacheKey,
        JSON.stringify(data),
        this.SEARCH_CACHE_TTL,
      );
    } catch (error) {
      this.logger.warn('Failed to cache search:', error);
    }
  }

  /**
   * Calculate relevance score
   */
  private calculateScore(text: string, query: string): number {
    if (!text) return 0;
    
    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
    
    let score = 0;

    // Exact match gets highest score
    if (normalizedText === normalizedQuery) {
      score += 100;
    }

    // Starts with query
    if (normalizedText.startsWith(normalizedQuery)) {
      score += 50;
    }

    // Contains exact query
    if (normalizedText.includes(normalizedQuery)) {
      score += 30;
    }

    // Word matches
    queryWords.forEach(word => {
      if (normalizedText.includes(word)) {
        score += 10;
      }
    });

    return score;
  }

  /**
   * Extract highlight snippet
   */
  private extractHighlight(text: string, query: string, snippetLength: number = 100): string {
    if (!text) return '';
    
    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    const index = normalizedText.indexOf(normalizedQuery);

    if (index === -1) {
      // Return first snippetLength characters
      return text.substring(0, snippetLength) + (text.length > snippetLength ? '...' : '');
    }

    // Calculate snippet bounds
    const start = Math.max(0, index - snippetLength / 2);
    const end = Math.min(text.length, index + query.length + snippetLength / 2);

    let snippet = text.substring(start, end);
    
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
  }
}
