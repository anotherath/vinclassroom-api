import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RedisService } from '../../redis/redis.service';
import { RedisKeys } from '../../redis/keys';
import { UploadFileDto, QueryFilesDto, FileType } from './dto';

interface FileRecord {
  id: string;
  uploader_id: string;
  space_id: string | null;
  room_id: string | null;
  file_name: string;
  file_url: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  description: string | null;
  created_at: string;
}

interface FileUploadResult {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly FILE_CACHE_TTL = 3600; // 1 hour
  private readonly RECENT_FILES_LIMIT = 20;
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private readonly ALLOWED_MIME_TYPES: Record<string, string[]> = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
    audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
    document: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ],
  };

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Upload a file to Supabase Storage
   */
  async uploadFile(
    userId: string,
    file: Express.Multer.File,
    dto: UploadFileDto,
  ): Promise<FileUploadResult> {
    // Validate file
    this.validateFile(file);

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = this.sanitizeFileName(file.originalname);
    const filePath = `${userId}/${timestamp}_${sanitizedName}`;

    // Determine file type category
    const fileTypeCategory = this.getFileTypeCategory(file.mimetype);

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await this.supabaseService
      .getClient()
      .storage
      .from('files')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      this.logger.error('Failed to upload file to storage:', uploadError.message);
      throw new BadRequestException('Failed to upload file');
    }

    // Get public URL
    const { data: publicUrlData } = this.supabaseService
      .getClient()
      .storage
      .from('files')
      .getPublicUrl(filePath);

    const fileUrl = publicUrlData.publicUrl;

    // Save metadata to database
    const { data: fileRecord, error: dbError } = await this.supabaseService
      .from('files')
      .insert({
        uploader_id: userId,
        space_id: dto.spaceId || null,
        room_id: dto.roomId || null,
        file_name: file.originalname,
        file_url: fileUrl,
        file_type: dto.fileType || fileTypeCategory,
        mime_type: file.mimetype,
        file_size: file.size,
        description: dto.description || null,
      })
      .select()
      .single();

    if (dbError) {
      // Rollback: delete from storage
      await this.supabaseService
        .getClient()
        .storage
        .from('files')
        .remove([filePath]);
      
      this.logger.error('Failed to save file metadata:', dbError.message);
      throw new BadRequestException('Failed to save file metadata');
    }

    // Cache file metadata
    await this.cacheFile(fileRecord as FileRecord);

    // Add to recent files list
    await this.addToRecentFiles(userId, fileRecord as FileRecord);

    // If in a space, add to space files
    if (dto.spaceId) {
      await this.redisService.sadd(
        RedisKeys.space.filesShared(dto.spaceId),
        fileRecord.id,
      );
    }

    this.logger.log(`File ${fileRecord.id} uploaded by user ${userId}`);

    return {
      id: fileRecord.id,
      fileName: fileRecord.file_name,
      fileUrl: fileRecord.file_url,
      fileType: fileRecord.file_type,
      fileSize: fileRecord.file_size,
      mimeType: fileRecord.mime_type,
    };
  }

  /**
   * Get file by ID
   */
  async getFileById(fileId: string, userId: string): Promise<FileRecord> {
    // Try cache first
    const cached = await this.getCachedFile(fileId);
    if (cached) {
      // Check access permission
      await this.checkFileAccess(cached, userId);
      return cached;
    }

    // Fetch from database
    const { data: file, error } = await this.supabaseService
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (error || !file) {
      throw new NotFoundException('File not found');
    }

    // Check access permission
    await this.checkFileAccess(file as FileRecord, userId);

    // Cache file
    await this.cacheFile(file as FileRecord);

    return file as FileRecord;
  }

  /**
   * Get files list
   */
  async getFiles(
    userId: string,
    query: QueryFilesDto,
  ): Promise<{ files: FileRecord[]; total: number; hasMore: boolean }> {
    const { page = 1, limit = 20, spaceId, roomId, fileType, search } = query;
    const offset = (page - 1) * limit;

    // Build query
    let dbQuery = this.supabaseService
      .from('files')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (spaceId) {
      dbQuery = dbQuery.eq('space_id', spaceId);
    }

    if (roomId) {
      dbQuery = dbQuery.eq('room_id', roomId);
    }

    if (fileType) {
      dbQuery = dbQuery.eq('file_type', fileType);
    }

    if (search) {
      dbQuery = dbQuery.ilike('file_name', `%${search}%`);
    }

    // If no space/room filter, show user's files and files from their spaces
    if (!spaceId && !roomId) {
      // Get user's spaces
      const { data: memberships } = await this.supabaseService
        .from('space_members')
        .select('space_id')
        .eq('user_id', userId);

      const spaceIds = memberships?.map(m => m.space_id) || [];

      // Files uploaded by user OR in user's spaces
      if (spaceIds.length > 0) {
        dbQuery = dbQuery.or(`uploader_id.eq.${userId},space_id.in.(${spaceIds.join(',')})`);
      } else {
        dbQuery = dbQuery.eq('uploader_id', userId);
      }
    }

    const { data: files, error, count } = await dbQuery;

    if (error) {
      this.logger.error('Failed to fetch files:', error.message);
      throw new BadRequestException('Failed to fetch files');
    }

    return {
      files: (files || []) as FileRecord[],
      total: count || 0,
      hasMore: (count || 0) > offset + limit,
    };
  }

  /**
   * Get recent files for user
   */
  async getRecentFiles(userId: string, limit: number = 10): Promise<FileRecord[]> {
    // Try cache first
    const cacheKey = RedisKeys.user.filesRecent(userId);
    const cached = await this.redisService.lrange(cacheKey, 0, limit - 1);

    if (cached && cached.length > 0) {
      try {
        const files = cached.map(item => JSON.parse(item));
        // Verify files still exist in database
        return files;
      } catch {
        // Cache corrupted, fetch from DB
      }
    }

    // Fetch from database
    const { data: files, error } = await this.supabaseService
      .from('files')
      .select('*')
      .eq('uploader_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error('Failed to fetch recent files:', error.message);
      return [];
    }

    // Update cache
    if (files && files.length > 0) {
      await this.cacheRecentFiles(userId, files as FileRecord[]);
    }

    return (files || []) as FileRecord[];
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await this.getFileById(fileId, userId);

    // Check ownership
    if (file.uploader_id !== userId) {
      throw new ForbiddenException('You can only delete your own files');
    }

    // Extract file path from URL
    const filePath = this.extractFilePathFromUrl(file.file_url);

    // Delete from Supabase Storage
    if (filePath) {
      const { error: storageError } = await this.supabaseService
        .getClient()
        .storage
        .from('files')
        .remove([filePath]);

      if (storageError) {
        this.logger.warn('Failed to delete file from storage:', storageError.message);
        // Continue to delete from database
      }
    }

    // Delete from database
    const { error: dbError } = await this.supabaseService
      .from('files')
      .delete()
      .eq('id', fileId);

    if (dbError) {
      this.logger.error('Failed to delete file metadata:', dbError.message);
      throw new BadRequestException('Failed to delete file');
    }

    // Clear caches
    await this.clearFileCache(fileId);
    await this.redisService.lrem(RedisKeys.user.filesRecent(userId), 0, JSON.stringify(file));

    if (file.space_id) {
      await this.redisService.srem(RedisKeys.space.filesShared(file.space_id), fileId);
    }

    this.logger.log(`File ${fileId} deleted by user ${userId}`);
  }

  /**
   * Get space files
   */
  async getSpaceFiles(
    spaceId: string,
    userId: string,
    query: QueryFilesDto,
  ): Promise<{ files: FileRecord[]; total: number; hasMore: boolean }> {
    // Check if user is space member
    const { data: membership, error: membershipError } = await this.supabaseService
      .from('space_members')
      .select('id')
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      throw new ForbiddenException('You are not a member of this space');
    }

    // Use getFiles with space filter
    return this.getFiles(userId, { ...query, spaceId });
  }

  /**
   * Get file statistics for user
   */
  async getUserFileStats(userId: string): Promise<{
    totalFiles: number;
    totalSize: number;
    byType: Record<string, number>;
  }> {
    const { data: files, error } = await this.supabaseService
      .from('files')
      .select('file_type, file_size')
      .eq('uploader_id', userId);

    if (error) {
      this.logger.error('Failed to get file stats:', error.message);
      return { totalFiles: 0, totalSize: 0, byType: {} };
    }

    const fileList = files || [];
    const byType: Record<string, number> = {};
    let totalSize = 0;

    fileList.forEach((file: any) => {
      byType[file.file_type] = (byType[file.file_type] || 0) + 1;
      totalSize += file.file_size || 0;
    });

    return {
      totalFiles: fileList.length,
      totalSize,
      byType,
    };
  }

  // ==================== Private helper methods ====================

  /**
   * Validate file
   */
  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(`File size exceeds maximum allowed (${this.MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    // Check if MIME type is allowed
    const isAllowed = Object.values(this.ALLOWED_MIME_TYPES)
      .flat()
      .includes(file.mimetype);

    if (!isAllowed) {
      throw new BadRequestException(`File type ${file.mimetype} is not allowed`);
    }
  }

  /**
   * Get file type category from MIME type
   */
  private getFileTypeCategory(mimeType: string): string {
    for (const [category, types] of Object.entries(this.ALLOWED_MIME_TYPES)) {
      if (types.includes(mimeType)) {
        return category;
      }
    }
    return 'other';
  }

  /**
   * Sanitize file name
   */
  private sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 100);
  }

  /**
   * Extract file path from URL
   */
  private extractFilePathFromUrl(url: string): string | null {
    try {
      // Supabase storage URL format: .../storage/v1/object/public/files/{path}
      const match = url.match(/\/files\/(.+)$/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Check file access permission
   */
  private async checkFileAccess(file: FileRecord, userId: string): Promise<void> {
    // Owner always has access
    if (file.uploader_id === userId) {
      return;
    }

    // If in a space, check space membership
    if (file.space_id) {
      const { data: membership } = await this.supabaseService
        .from('space_members')
        .select('id')
        .eq('space_id', file.space_id)
        .eq('user_id', userId)
        .single();

      if (membership) {
        return;
      }
    }

    throw new ForbiddenException('You do not have access to this file');
  }

  /**
   * Cache file metadata
   */
  private async cacheFile(file: FileRecord): Promise<void> {
    const cacheKey = `file:${file.id}`;
    await this.redisService.hset(cacheKey, {
      id: file.id,
      uploader_id: file.uploader_id,
      space_id: file.space_id || '',
      room_id: file.room_id || '',
      file_name: file.file_name,
      file_url: file.file_url,
      file_type: file.file_type,
      mime_type: file.mime_type,
      file_size: String(file.file_size),
      description: file.description || '',
      created_at: file.created_at,
    });
    await this.redisService.expire(cacheKey, this.FILE_CACHE_TTL);
  }

  /**
   * Get cached file
   */
  private async getCachedFile(fileId: string): Promise<FileRecord | null> {
    const cacheKey = `file:${fileId}`;
    const cached = await this.redisService.hgetall(cacheKey);

    if (!cached || Object.keys(cached).length === 0) {
      return null;
    }

    return {
      id: cached.id,
      uploader_id: cached.uploader_id,
      space_id: cached.space_id || null,
      room_id: cached.room_id || null,
      file_name: cached.file_name,
      file_url: cached.file_url,
      file_type: cached.file_type,
      mime_type: cached.mime_type,
      file_size: parseInt(cached.file_size, 10) || 0,
      description: cached.description || null,
      created_at: cached.created_at,
    };
  }

  /**
   * Clear file cache
   */
  private async clearFileCache(fileId: string): Promise<void> {
    await this.redisService.del(`file:${fileId}`);
  }

  /**
   * Add file to recent files list
   */
  private async addToRecentFiles(userId: string, file: FileRecord): Promise<void> {
    const cacheKey = RedisKeys.user.filesRecent(userId);
    
    // Add to list
    await this.redisService.lpush(cacheKey, JSON.stringify(file));
    
    // Trim to keep only recent files
    await this.redisService.ltrim(cacheKey, 0, this.RECENT_FILES_LIMIT - 1);
    
    // Set expiration
    await this.redisService.expire(cacheKey, this.FILE_CACHE_TTL);
  }

  /**
   * Cache recent files
   */
  private async cacheRecentFiles(userId: string, files: FileRecord[]): Promise<void> {
    if (files.length === 0) return;

    const cacheKey = RedisKeys.user.filesRecent(userId);
    
    // Clear existing
    await this.redisService.del(cacheKey);
    
    // Add all files
    const values = files.map(f => JSON.stringify(f));
    await this.redisService.rpush(cacheKey, ...values);
    
    // Set expiration
    await this.redisService.expire(cacheKey, this.FILE_CACHE_TTL);
  }
}
